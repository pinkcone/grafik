const {
  findPairRoute,
  canAssignEmployeeToRouteWithPair,
  routeRequiresStaffing,
  getAssignmentBlockReason,
  getEmployeeCapabilityTier,
  getRouteRestrictionTierWithPair,
  hasSpecialPermissions,
  sortRoutesByAssignmentPriority,
  compareEmployeesForRoute,
} = require('./routeAssignment');
const { isRouteOperatingOnDate, getIsoWeekday } = require('./routeOperatingDays');
const {
  generateDw5Proposals,
  isSaturday,
  planSaturdayDw5Package,
  hasDw5AfterSaturday,
  getDw5CandidateWeekdays,
  DW5_LABEL_CODE,
  getSaturdayDw5BlockReason,
  pickDw5DateWithFallback,
  listDw5CandidateDatesForEmployee,
  buildDw5LabelProposal,
  buildDw5ScheduleEntry,
} = require('./scheduleRules');
const { hasEmployeeLabelOnDay } = require('./scheduleLabels');
const {
  ENABLE_ROUTE_STACKING,
  MAX_EMPLOYEE_ROUTE_SLOTS_PER_DAY,
  getEmployeeRouteSlotCountOnDay,
  getMaxRouteSlotsPerDay,
  canEmployeeHaveAnotherRouteOnDay,
  canPersistRouteAssignment,
} = require('./scheduleConstraints');
const { getAssignmentBlockReason: getRouteAssignmentBlockReason } = require('./routeAssignment');
const {
  getRouteDurationHours,
  getTargetMonthHours,
  getTargetQuarterHours,
  getTargetDailyHours,
  getEmployeePartTime,
  getEmployeeMonthHours,
  getQuarterMonths,
  routesTimeOverlap,
} = require('./scheduleHours');
const { buildAutoFillAlgorithmReport } = require('./scheduleAutoFillDebug');

const daysInMonth = (month, year) => new Date(year, month, 0).getDate();

const buildDate = (year, month, day) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const employeeDayKey = (date, employeeId) => `${date}|${employeeId}`;
const routeSlotKey = (date, routeId) => `${date}|${routeId}`;

/**
 * Zamienia wiersz grafiku na czysty obiekt. Instancje Sequelize przechowują dane
 * w dataValues (gettery na prototypie), więc {...instancja} gubi date/route_id/employee_id.
 * Bez tego algorytm „nie widzi” istniejących wpisów i proponuje na zajęte sloty.
 */
const toPlainSchedule = (s) => {
  if (!s) return s;
  if (typeof s.get === 'function') return s.get({ plain: true });
  if (typeof s.toJSON === 'function') return s.toJSON();
  return { ...s };
};

/** Przesuwa datę 'YYYY-MM-DD' o `days` dni (kalendarzowo). */
const shiftDateStr = (dateStr, days) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return buildDate(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
};

/** Poniedziałek tygodnia zawierającego datę. */
const getWeekMonday = (dateStr) => shiftDateStr(dateStr, 1 - getIsoWeekday(dateStr));

/** Daty pn–sb tygodnia zawierającego datę. */
const getWeekWorkDates = (dateStr) => {
  const monday = getWeekMonday(dateStr);
  const out = [];
  for (let i = 0; i < 6; i += 1) out.push(shiftDateStr(monday, i));
  return out;
};

/** Wpis z trasą lub etykietą — puste placeholdery (assignment_type none) nie blokują auto-fill. */
const hasMeaningfulAssignment = (s) =>
  s.route_id != null || (s.label != null && String(s.label).trim() !== '');

const findRouteAssignment = (date, routeId, schedules) =>
  schedules.find((s) => s.date === date && s.route_id?.toString() === routeId.toString());

/**
 * Snapshot stanu sprzed auto-fill.
 * Z1: WSZYSTKO co już jest w bazie (ręczne ORAZ wcześniej auto_filled) jest święte —
 * algorytm może wyłącznie dopełniać puste sloty, nie rusza istniejących wpisów.
 */
const buildInitialSnapshot = (schedules) => {
  const initialEmployeeDays = new Set();
  const initialRouteSlots = new Set();

  for (const s of schedules) {
    if (s.employee_id != null && s.date && hasMeaningfulAssignment(s)) {
      initialEmployeeDays.add(employeeDayKey(s.date, s.employee_id));
    }
    if (s.route_id != null && s.date) {
      initialRouteSlots.add(routeSlotKey(s.date, s.route_id));
    }
  }

  return { initialEmployeeDays, initialRouteSlots };
};

const buildLockedRouteSlots = (schedules) => {
  const { initialRouteSlots } = buildInitialSnapshot(schedules);
  return initialRouteSlots;
};

const isRouteSlotSwappable = (date, routeId, initialRouteSlots) =>
  !initialRouteSlots.has(routeSlotKey(date, routeId));

const isEmployeeDayMutable = (employeeId, date, initialEmployeeDays) =>
  !initialEmployeeDays.has(employeeDayKey(date, employeeId));

const isEmployeeDayFreeForRoute = (employeeId, date, ctx) => {
  if (!isEmployeeDayMutable(employeeId, date, ctx.initialEmployeeDays)) return false;
  if (hasPendingOrPersistedLabelOnDay(ctx, employeeId, date)) return false;
  return getEmployeeRouteSlotCountOnDay(employeeId, date, ctx.workingSchedules, ctx.routes) === 0;
};

const getRouteBlockHours = (route, routes) => {
  if (!route) return 0;
  const pair = findPairRoute(route, routes);
  let hours = getRouteDurationHours(route);
  if (pair) hours += getRouteDurationHours(pair);
  return hours;
};

const getHourGap = (employee, ctx) => {
  const target = getTargetMonthHours(employee, ctx.month, ctx.year);
  const current = getEmployeeMonthHours(
    employee.id,
    ctx.workingSchedules,
    ctx.routes,
    ctx.month,
    ctx.year
  );
  return target - current;
};

/** Godziny w kwartale (inne miesiące = snapshot z bazy, bieżący = workingSchedules). */
const getEmployeeQuarterHoursInCtx = (employeeId, ctx) => {
  let total = 0;
  for (const m of getQuarterMonths(ctx.month)) {
    const scheds =
      m === ctx.month ? ctx.workingSchedules : ctx.quarterSchedules || [];
    total += getEmployeeMonthHours(employeeId, scheds, ctx.routes, m, ctx.year);
  }
  return total;
};

const getQuarterHourGap = (employee, ctx) =>
  getTargetQuarterHours(employee, ctx.month, ctx.year) -
  getEmployeeQuarterHoursInCtx(employee.id, ctx);

const getGapCloseThreshold = (employee, ctx) => {
  const target = getTargetMonthHours(employee, ctx.month, ctx.year);
  return Math.max(2, target * 0.04);
};

/**
 * Kolejność układania kierowców: najpierw najrzadsi (C+SP), na końcu B.
 * 0 = C + SP, 1 = samo C, 2 = B + SP, 3 = samo B.
 */
const getEmployeeFillOrderRank = (employee) => {
  const hasSP = hasSpecialPermissions(employee?.special_permissions);
  const isC = employee?.license_category === 'C';
  if (isC && hasSP) return 0;
  if (isC) return 1;
  if (hasSP) return 2;
  return 3;
};

const sortEmployeesForFillOrder = (employees) =>
  [...employees].sort(
    (a, b) =>
      getEmployeeFillOrderRank(a) - getEmployeeFillOrderRank(b) || a.id - b.id
  );

/** Te same reguły co dropdown w widoku pracowników (+ DW5 w sobotę dla auto-fill). */
const canEmployeeTakeRouteOnDay = (
  employee,
  route,
  routes,
  date,
  schedules,
  month,
  year,
  options = {}
) => {
  if (!employee || !route || !date) return false;
  if (hasEmployeeLabelOnDay(employee.id, date, schedules)) return false;

  const taken = findRouteAssignment(date, route.id, schedules);
  if (taken && taken.employee_id?.toString() !== employee.id.toString()) {
    return false;
  }

  if (!canAssignEmployeeToRouteWithPair(employee, route, routes, date, schedules)) {
    return false;
  }

  if (
    !options.skipDw5Check &&
    isSaturday(date) &&
    (options.employeeCount || 0) > 0
  ) {
    const dw5Reason = getSaturdayDw5BlockReason(
      employee,
      date,
      schedules,
      routes,
      options.employeeCount,
      {
        initialEmployeeDays: options.initialEmployeeDays,
        relaxedDw5: options.relaxedDw5,
      }
    );
    if (dw5Reason) return false;
  }

  return true;
};

const pushDw5Package = (ctx, employeeId, saturdayDate) => {
  if (hasDw5AfterSaturday(employeeId, saturdayDate, ctx.workingSchedules)) {
    return true;
  }
  return forceDw5ForSaturday(ctx, employeeId, saturdayDate);
};

/** Usuwa DW5 dodany przez algorytm po danej sobocie (gdy znika ostatnia trasa sobotnia tego tygodnia). */
const removeDw5AfterSaturday = (ctx, employeeId, saturdayDate) => {
  const stillWorksSaturday = ctx.workingSchedules.some(
    (s) =>
      s.employee_id?.toString() === employeeId.toString() &&
      s.date === saturdayDate &&
      s.route_id
  );
  if (stillWorksSaturday) return;

  const candidateDays = new Set(getDw5CandidateWeekdays(saturdayDate));
  const isInitial = (date) => ctx.initialEmployeeDays.has(employeeDayKey(date, employeeId));

  ctx.workingSchedules = ctx.workingSchedules.filter(
    (s) =>
      !(
        s.employee_id?.toString() === employeeId.toString() &&
        s.label === DW5_LABEL_CODE &&
        candidateDays.has(s.date) &&
        !isInitial(s.date)
      )
  );
  ctx.labelAssignments = ctx.labelAssignments.filter(
    (l) =>
      !(
        l.employee_id?.toString() === employeeId.toString() &&
        l.label === DW5_LABEL_CODE &&
        candidateDays.has(l.date)
      )
  );
  if (ctx.persistSim) {
    ctx.persistSim = ctx.persistSim.filter(
      (s) =>
        !(
          s.employee_id?.toString() === employeeId.toString() &&
          s.label === DW5_LABEL_CODE &&
          candidateDays.has(s.date) &&
          !isInitial(s.date)
        )
    );
  }
};

const getEmployeeLicenseCategory = (employeeId, employees) => {
  const emp = employees?.find((e) => e.id?.toString() === employeeId?.toString());
  return emp?.license_category ?? null;
};

/** Czy propozycja trasy przejdzie filtr zapisu (baseline + już zaakceptowane w persistSim). */
const wouldPersistRouteProposal = (ctx, { date, route_id, employee_id }) => {
  const sim = ctx.persistSim || ctx.workingSchedules;
  const existing = findRouteAssignment(date, route_id, sim);
  if (existing) {
    return existing.employee_id?.toString() === employee_id?.toString();
  }
  if (hasPendingOrPersistedLabelOnDay(ctx, employee_id, date)) {
    return false;
  }
  return canPersistRouteAssignment(
    employee_id,
    route_id,
    date,
    sim,
    ctx.routes,
    { licenseCategory: getEmployeeLicenseCategory(employee_id, ctx.employees) }
  );
};

const pushPersistSimRoute = (ctx, { date, route_id, employee_id }) => {
  if (!ctx.persistSim) return;
  ctx.persistSim.push({
    date,
    route_id,
    employee_id,
    label: null,
    auto_filled: true,
  });
};

const pushPersistSimLabel = (ctx, labelProposal) => {
  if (!ctx.persistSim) return;
  ctx.persistSim.push({
    date: labelProposal.date,
    employee_id: labelProposal.employee_id,
    label: labelProposal.label,
    route_id: null,
    auto_filled: true,
  });
};

const removePersistSimRouteSlot = (ctx, date, routeId) => {
  if (!ctx.persistSim) return;
  if (ctx.initialRouteSlots.has(routeSlotKey(date, routeId))) return;
  ctx.persistSim = ctx.persistSim.filter(
    (s) => !(s.date === date && s.route_id?.toString() === routeId.toString())
  );
};

const groupRejectionsByReason = (rejected) => {
  const counts = {};
  for (const r of rejected) {
    const key = r.reason || 'Nieznany powód';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
};

const mergeExtraDw5Labels = (ctx, user_id, routes) => {
  const extraLabels = generateDw5Proposals(
    ctx.workingSchedules,
    user_id,
    routes,
    ctx.employees.length
  );
  const seen = new Set(
    ctx.labelAssignments.map((l) => `${l.employee_id}|${l.date}|${l.label}`)
  );
  const sim = ctx.persistSim || ctx.workingSchedules;

  for (const l of extraLabels) {
    const key = `${l.employee_id}|${l.date}|${l.label}`;
    if (seen.has(key)) continue;
    if (hasEmployeeLabelOnDay(l.employee_id, l.date, sim)) continue;
    const hasRoute = sim.some(
      (s) =>
        s.employee_id?.toString() === l.employee_id?.toString() &&
        s.date === l.date &&
        s.route_id
    );
    if (hasRoute) continue;
    if (!isEmployeeDayMutable(l.employee_id, l.date, ctx.initialEmployeeDays)) continue;

    seen.add(key);
    ctx.labelAssignments.push(l);
    ctx.workingSchedules.push({
      date: l.date,
      employee_id: l.employee_id,
      label: l.label,
      route_id: null,
      user_id,
      auto_filled: true,
    });
    pushPersistSimLabel(ctx, l);
  }
};

const hasPendingOrPersistedLabelOnDay = (ctx, employeeId, date) => {
  const sim = ctx.persistSim || ctx.workingSchedules;
  if (hasEmployeeLabelOnDay(employeeId, date, sim)) return true;
  return (ctx.labelAssignments || []).some(
    (l) =>
      l.employee_id?.toString() === employeeId?.toString() &&
      l.date === date &&
      l.label != null &&
      String(l.label).trim() !== ''
  );
};

const snapshotCtx = (ctx) => ({
  workingSchedules: ctx.workingSchedules.map((s) => ({ ...s })),
  assignments: ctx.assignments.map((a) => ({ ...a })),
  labelAssignments: ctx.labelAssignments.map((l) => ({ ...l })),
  persistSim: ctx.persistSim ? ctx.persistSim.map((s) => ({ ...s })) : null,
});

const restoreCtx = (ctx, snap) => {
  ctx.workingSchedules = snap.workingSchedules;
  ctx.assignments = snap.assignments;
  ctx.labelAssignments = snap.labelAssignments;
  if (snap.persistSim) ctx.persistSim = snap.persistSim;
};

const clearEmployeeAutoRoutesOnDay = (ctx, employeeId, date) => {
  const entries = ctx.workingSchedules.filter(
    (s) =>
      s.employee_id?.toString() === employeeId.toString() &&
      s.date === date &&
      s.route_id
  );
  for (const entry of entries) {
    removeRouteSlot(date, entry.route_id, ctx);
  }
};

const pushDw5LabelOnDate = (ctx, employeeId, dw5Date) => {
  if (!isEmployeeDayMutable(employeeId, dw5Date, ctx.initialEmployeeDays)) return false;
  if (hasPendingOrPersistedLabelOnDay(ctx, employeeId, dw5Date)) return true;

  const labelKey = `${employeeId}|${dw5Date}|${DW5_LABEL_CODE}`;
  if (
    ctx.labelAssignments.some(
      (l) => `${l.employee_id}|${l.date}|${l.label}` === labelKey
    )
  ) {
    return true;
  }

  const labelProposal = buildDw5LabelProposal(dw5Date, employeeId, ctx.user_id);
  ctx.labelAssignments.push(labelProposal);
  ctx.workingSchedules.push(buildDw5ScheduleEntry(dw5Date, employeeId, ctx.user_id));
  pushPersistSimLabel(ctx, labelProposal);
  return true;
};

/** DW5 po sobocie — 5 kandydatów, z fallbackiem (bez blokady „obsadzalności dnia”). */
const forceDw5ForSaturday = (ctx, employeeId, saturdayDate) => {
  if (hasDw5AfterSaturday(employeeId, saturdayDate, ctx.workingSchedules)) {
    return true;
  }

  const dw5Opts = { initialEmployeeDays: ctx.initialEmployeeDays };
  let dw5Date = pickDw5DateWithFallback(
    saturdayDate,
    employeeId,
    ctx.workingSchedules,
    ctx.routes,
    ctx.employees.length,
    dw5Opts
  );

  if (!dw5Date) {
    for (const date of listDw5CandidateDatesForEmployee(
      saturdayDate,
      employeeId,
      ctx.initialEmployeeDays
    )) {
      if (hasEmployeeLabelOnDay(employeeId, date, ctx.workingSchedules)) continue;
      clearEmployeeAutoRoutesOnDay(ctx, employeeId, date);
      if (
        getEmployeeRouteSlotCountOnDay(employeeId, date, ctx.workingSchedules, ctx.routes) > 0
      ) {
        continue;
      }
      dw5Date = date;
      break;
    }
  }

  if (!dw5Date) return false;
  return pushDw5LabelOnDate(ctx, employeeId, dw5Date);
};

const filterPersistableLabelAssignments = (labelAssignments, manualRows, keptRoutes) => {
  const routeDayKeys = new Set(
    keptRoutes.map((r) => `${r.date}|${r.employee_id?.toString()}`)
  );
  const baselineLabelKeys = new Set(
    manualRows
      .filter((s) => s.label != null && String(s.label).trim() !== '')
      .map((s) => `${s.date}|${s.employee_id?.toString()}|${s.label}`)
  );

  return labelAssignments.filter((l) => {
    const triplet = `${l.date}|${l.employee_id?.toString()}|${l.label}`;
    if (baselineLabelKeys.has(triplet)) return false;
    if (hasEmployeeLabelOnDay(l.employee_id, l.date, manualRows)) return false;
    if (routeDayKeys.has(`${l.date}|${l.employee_id?.toString()}`)) return false;
    return true;
  });
};

/**
 * Przycina workingSchedules do stanu faktycznie zapisywalnego (baseline + kept).
 * Po przycięciu persistSim i assignments są zsynchronizowane z tym, co trafi do bazy.
 */
const syncWorkingSchedulesToPersistable = (ctx, baselineSchedules, routes) => {
  const routeProposals = collectNewRouteProposals(
    ctx.workingSchedules,
    baselineSchedules,
    ctx.user_id
  );
  const { kept: keptRoutes, rejected } = filterPersistableAssignments(
    routeProposals,
    baselineSchedules,
    routes,
    ctx.employees
  );

  const manualRows = baselineSchedules.map((s) => ({ ...s }));
  const persistableLabels = filterPersistableLabelAssignments(
    ctx.labelAssignments,
    manualRows,
    keptRoutes
  );
  const routeDayKeys = new Set(
    persistableLabels.map((l) => `${l.date}|${l.employee_id?.toString()}`)
  );
  const finalRoutes = keptRoutes.filter(
    (r) => !routeDayKeys.has(`${r.date}|${r.employee_id?.toString()}`)
  );

  const autoRows = finalRoutes.map((item) => ({
    date: item.date,
    route_id: item.route_id,
    employee_id: item.employee_id,
    label: null,
    assignment_type: 'route',
    user_id: ctx.user_id,
    auto_filled: true,
  }));
  const labelRows = persistableLabels.map((l) => ({
    date: l.date,
    employee_id: l.employee_id,
    label: l.label,
    route_id: null,
    user_id: ctx.user_id,
    auto_filled: true,
  }));

  const nextSchedules = [...manualRows, ...autoRows, ...labelRows];
  const pruned =
    nextSchedules.length !== ctx.workingSchedules.length ||
    finalRoutes.length !== routeProposals.length ||
    persistableLabels.length !== ctx.labelAssignments.length;

  ctx.workingSchedules = nextSchedules;
  ctx.persistSim = nextSchedules.map((s) => ({ ...s }));
  ctx.assignments = finalRoutes.map((item) => ({
    date: item.date,
    route_id: item.route_id,
    employee_id: item.employee_id,
  }));
  ctx.labelAssignments = persistableLabels;

  return {
    kept: finalRoutes,
    rejected,
    routeProposals,
    persistableLabels,
    pruned,
  };
};

const pushAssignment = (ctx, { date, route_id, employee_id }, options = {}) => {
  if (!wouldPersistRouteProposal(ctx, { date, route_id, employee_id })) {
    return false;
  }
  if (findRouteAssignment(date, route_id, ctx.workingSchedules)) {
    return false;
  }
  if (
    ctx.assignments.some(
      (a) => a.date === date && a.route_id?.toString() === route_id.toString()
    )
  ) {
    return false;
  }
  if (hasPendingOrPersistedLabelOnDay(ctx, employee_id, date)) {
    return false;
  }

  const { allowPairLeg = false, allowStackedRoute = false } = options;
  const slotOpts = { licenseCategory: getEmployeeLicenseCategory(employee_id, ctx.employees) };
  const canAdd =
    canEmployeeHaveAnotherRouteOnDay(
      employee_id,
      route_id,
      date,
      ctx.workingSchedules,
      ctx.routes,
      slotOpts
    ) ||
    (allowPairLeg &&
      canEmployeeHaveAnotherRouteOnDay(
        employee_id,
        route_id,
        date,
        ctx.workingSchedules,
        ctx.routes,
        { ...slotOpts, allowPairLeg: true }
      )) ||
    (ENABLE_ROUTE_STACKING &&
      allowStackedRoute &&
      canEmployeeHaveAnotherRouteOnDay(
        employee_id,
        route_id,
        date,
        ctx.workingSchedules,
        ctx.routes,
        { ...slotOpts, allowStackedRoute: true }
      ));

  if (!canAdd) {
    return false;
  }

  ctx.assignments.push({ date, route_id, employee_id });
  ctx.workingSchedules.push({
    date,
    route_id,
    employee_id,
    label: null,
    assignment_type: 'route',
    user_id: ctx.user_id,
    auto_filled: true,
  });
  pushPersistSimRoute(ctx, { date, route_id, employee_id });
  return true;
};

/**
 * Propozycje zapisu = różnica stanu końcowego vs baseline (ręczny stan / aktualna baza).
 * Źródłem prawdy jest workingSchedules po algorytmie, nie sama lista ctx.assignments.
 */
const collectNewRouteProposals = (workingSchedules, baselineSchedules, user_id) => {
  const manualEmployeeRoutes = new Set();
  for (const s of baselineSchedules) {
    if (s.date && s.route_id && s.employee_id) {
      manualEmployeeRoutes.add(
        `${s.date}|${s.route_id.toString()}|${s.employee_id.toString()}`
      );
    }
  }

  // Sloty tras zajęte już w baseline — nie proponujemy na nie nikogo nowego.
  const seenRouteSlot = new Set();
  for (const s of baselineSchedules) {
    if (s.date && s.route_id) seenRouteSlot.add(`${s.date}|${s.route_id.toString()}`);
  }

  const proposals = [];

  for (const s of workingSchedules) {
    if (!s.date || !s.route_id || !s.employee_id) continue;
    const routeId = s.route_id.toString();
    const employeeId = s.employee_id.toString();
    const empRouteKey = `${s.date}|${routeId}|${employeeId}`;
    if (manualEmployeeRoutes.has(empRouteKey)) continue;

    const routeSlotKey = `${s.date}|${routeId}`;
    if (seenRouteSlot.has(routeSlotKey)) continue;
    seenRouteSlot.add(routeSlotKey);

    proposals.push({
      date: s.date,
      route_id: s.route_id,
      employee_id: s.employee_id,
      user_id,
    });
  }

  return proposals;
};

/** Symulacja zapisu na baseline (ręczne + już zapisane), bez innych propozycji algorytmu. */
const filterPersistableAssignments = (
  proposals,
  baselineSchedules,
  routes,
  employees = []
) => {
  const seenRouteKeys = new Set();
  const deduped = [];
  for (const item of proposals) {
    const routeKey = `${item.date}|${item.route_id?.toString()}`;
    if (seenRouteKeys.has(routeKey)) continue;
    seenRouteKeys.add(routeKey);
    deduped.push(item);
  }

  const sim = baselineSchedules.map((s) => ({ ...s }));
  const kept = [];
  const rejected = [];

  for (const item of deduped) {
    const existing = findRouteAssignment(item.date, item.route_id, sim);
    if (existing) {
      if (existing.employee_id?.toString() === item.employee_id?.toString()) {
        kept.push(item);
      } else {
        rejected.push({
          item,
          reason: `Slot trasy zajęty w baseline (kierowca #${existing.employee_id})`,
        });
      }
      continue;
    }
    if (hasEmployeeLabelOnDay(item.employee_id, item.date, sim)) {
      rejected.push({ item, reason: 'Pracownik ma etykietę tego dnia' });
      continue;
    }
    if (
      !canPersistRouteAssignment(
        item.employee_id,
        item.route_id,
        item.date,
        sim,
        routes,
        { licenseCategory: getEmployeeLicenseCategory(item.employee_id, employees) }
      )
    ) {
      rejected.push({
        item,
        reason: 'Pracownik ma już inną trasę tego dnia (limit slotów)',
      });
      continue;
    }

    kept.push(item);
    sim.push({
      date: item.date,
      route_id: item.route_id,
      employee_id: item.employee_id,
      label: null,
    });
  }

  return { kept, rejected };
};

const routeCheckOptions = (ctx, overrides = {}) => ({
  employeeCount: ctx.employees.length,
  initialEmployeeDays: ctx.initialEmployeeDays,
  relaxedDw5: true,
  ...overrides,
});

/** Trasy widoczne w dropdownie dla pracownika (jak ScheduleView). */
const getRoutesAvailableForEmployeeOnDay = (employee, date, ctx) => {
  const assignedToOthers = new Set(
    ctx.workingSchedules
      .filter(
        (s) =>
          s.date === date &&
          s.route_id &&
          s.employee_id?.toString() !== employee.id.toString()
      )
      .map((s) => s.route_id.toString())
  );

  const candidates = ctx.routes.filter((r) => {
    if (assignedToOthers.has(r.id.toString())) return false;
    const taken = findRouteAssignment(date, r.id, ctx.workingSchedules);
    if (taken && taken.employee_id?.toString() !== employee.id.toString()) {
      return false;
    }
    return canEmployeeTakeRouteOnDay(
      employee,
      r,
      ctx.routes,
      date,
      ctx.workingSchedules,
      ctx.month,
      ctx.year,
      routeCheckOptions(ctx)
    );
  });

  return sortRoutesByAssignmentPriority(candidates);
};

const assignRouteToEmployee = (employee, route, date, ctx) => {
  if (!isEmployeeDayFreeForRoute(employee.id, date, ctx)) return false;
  if (findRouteAssignment(date, route.id, ctx.workingSchedules)) return false;
  const saturday = isSaturday(date);
  const saturdaySnap = saturday ? snapshotCtx(ctx) : null;
  if (!canEmployeeTakeRouteOnDay(
    employee,
    route,
    ctx.routes,
    date,
    ctx.workingSchedules,
    ctx.month,
    ctx.year,
    routeCheckOptions(ctx)
  )) {
    return false;
  }

  const pairRoute = findPairRoute(route, ctx.routes);
  if (!pushAssignment(ctx, { date, route_id: route.id, employee_id: employee.id })) {
    return false;
  }

  if (
    pairRoute &&
    !findRouteAssignment(date, pairRoute.id, ctx.workingSchedules) &&
    canEmployeeHaveAnotherRouteOnDay(
      employee.id,
      pairRoute.id,
      date,
      ctx.workingSchedules,
      ctx.routes,
      { allowPairLeg: true, licenseCategory: employee.license_category ?? null }
    ) &&
    canAssignEmployeeToRouteWithPair(
      employee,
      pairRoute,
      ctx.routes,
      date,
      ctx.workingSchedules
    )
  ) {
    pushAssignment(
      ctx,
      { date, route_id: pairRoute.id, employee_id: employee.id },
      { allowPairLeg: true }
    );
  }

  // Z5: sobotnia trasa MUSI mieć DW5 w następnym tygodniu. Jeśli dla tego kierowcy
  // wszystkie 5 dni-kandydatów jest zablokowanych ręcznie — cofamy sobotę, żeby
  // spróbować oddać ją komuś, komu DW5 da się przypisać.
  if (saturday && !forceDw5ForSaturday(ctx, employee.id, date)) {
    restoreCtx(ctx, saturdaySnap);
    return false;
  }

  return true;
};

const removeRouteSlot = (date, routeId, ctx) => {
  if (!isRouteSlotSwappable(date, routeId, ctx.initialRouteSlots)) {
    return false;
  }

  const entry = findRouteAssignment(date, routeId, ctx.workingSchedules);
  if (!entry) return false;

  const employeeId = entry.employee_id;
  const route = ctx.routes.find((r) => r.id.toString() === routeId.toString());
  const pairRoute = route ? findPairRoute(route, ctx.routes) : null;

  const removeOne = (rid) => {
    const key = routeSlotKey(date, rid);
    if (ctx.initialRouteSlots.has(key)) return;
    ctx.workingSchedules = ctx.workingSchedules.filter(
      (s) => !(s.date === date && s.route_id?.toString() === rid.toString())
    );
    ctx.assignments = ctx.assignments.filter(
      (a) => !(a.date === date && a.route_id?.toString() === rid.toString())
    );
    removePersistSimRouteSlot(ctx, date, rid);
  };

  removeOne(routeId);

  if (pairRoute) {
    const pairEntry = findRouteAssignment(date, pairRoute.id, ctx.workingSchedules);
    if (pairEntry && pairEntry.employee_id?.toString() === employeeId?.toString()) {
      removeOne(pairRoute.id);
    }
  }

  if (isSaturday(date) && employeeId != null) {
    removeDw5AfterSaturday(ctx, employeeId, date);
  }

  return true;
};

const listMonthDates = (month, year) => {
  const dim = daysInMonth(month, year);
  const dates = [];
  for (let d = 1; d <= dim; d++) {
    dates.push(buildDate(year, month, d));
  }
  return dates;
};

const isWeekday = (date) => {
  const wd = getIsoWeekday(date);
  return wd >= 1 && wd <= 5;
};

const listWeekdaysInMonth = (month, year) =>
  listMonthDates(month, year).filter(isWeekday);

const listSaturdaysInMonth = (month, year) =>
  listMonthDates(month, year).filter(isSaturday);

/** Dni robocze + soboty (bez niedziel). */
const listFillableDaysInMonth = (month, year) =>
  listMonthDates(month, year).filter((d) => isWeekday(d) || isSaturday(d));

const listNonSundayDates = (month, year) =>
  listMonthDates(month, year).filter((d) => getIsoWeekday(d) !== 7);

const countEmployeeFreeWeekdays = (employeeId, ctx) =>
  listWeekdaysInMonth(ctx.month, ctx.year).filter((date) =>
    isEmployeeDayFreeForRoute(employeeId, date, ctx)
  ).length;

/** Ile godzin „na dzień” zostało do rozłożenia — miesiąc + perspektywa kwartału. */
const getIdealRouteHoursForEmployee = (employee, ctx, daysRemaining = null) => {
  const monthGap = getHourGap(employee, ctx);
  const quarterGap = getQuarterHourGap(employee, ctx);
  const freeDays =
    daysRemaining != null
      ? daysRemaining
      : countEmployeeFreeWeekdays(employee.id, ctx);
  const divisor = Math.max(1, freeDays);

  const monthIdeal = monthGap / divisor;
  const monthsLeft = getQuarterMonths(ctx.month).filter((m) => m >= ctx.month).length;
  const quarterDivisor = Math.max(1, freeDays + (monthsLeft - 1) * 12);
  const quarterIdeal = quarterGap / quarterDivisor;

  // Miesiąc „nad” normą, ale kwartał jeszcze w deficycie — można jechać dłuższymi trasami.
  if (monthGap < 0 && quarterGap > 12) {
    return Math.max(5, quarterIdeal);
  }
  // Kwartał nad normą — celuj w krótsze trasy, ale nie rezygnuj z pokrycia dnia.
  if (quarterGap < -12) {
    return Math.min(monthIdeal, 5.5);
  }

  return monthIdeal * 0.55 + quarterIdeal * 0.45;
};

/** Kara za trasę zbyt długą/krótką względem etatu (np. 0.5 → ~4h/dzień). */
const getPartTimeRouteFitPenalty = (employee, blockHours, ideal) => {
  const pt = getEmployeePartTime(employee);
  if (pt >= 0.99) return 0;

  const dailyNorm = getTargetDailyHours(employee);
  const targetBlock = Math.min(ideal > 0 ? ideal : dailyNorm, dailyNorm);

  let penalty = Math.abs(blockHours - targetBlock) * (1.3 / pt);

  if (blockHours > dailyNorm * 1.15) {
    penalty += (blockHours - dailyNorm) * (2.8 / pt);
  }

  return penalty;
};

/** Ile razy kierowca jechał trasę w bieżącym miesiącu (workingSchedules). */
const countEmployeeRouteInMonth = (employeeId, routeId, ctx) => {
  const prefix = `${ctx.year}-${String(ctx.month).padStart(2, '0')}`;
  const rid = routeId.toString();
  return ctx.workingSchedules.filter(
    (s) =>
      s.employee_id?.toString() === employeeId.toString() &&
      s.route_id?.toString() === rid &&
      s.date?.startsWith(prefix)
  ).length;
};

/** Trasa, którą kierowca jeździ w INNE dni tego samego tygodnia (najczęstsza). */
const getEmployeeWeekRouteId = (employeeId, date, ctx) => {
  const weekDates = new Set(getWeekWorkDates(date));
  const counts = new Map();
  for (const s of ctx.workingSchedules) {
    if (
      s.route_id &&
      s.employee_id?.toString() === employeeId.toString() &&
      s.date !== date &&
      weekDates.has(s.date)
    ) {
      const rid = s.route_id.toString();
      counts.set(rid, (counts.get(rid) || 0) + 1);
    }
  }
  let best = null;
  let bestCount = 0;
  for (const [rid, c] of counts) {
    if (c > bestCount) {
      best = rid;
      bestCount = c;
    }
  }
  return best;
};

/** Trasy, które kierowca jeździł w POPRZEDNIM tygodniu (bieżący miesiąc + kwartał). */
const getEmployeeLastWeekRouteIds = (employeeId, date, ctx) => {
  const prevMonday = shiftDateStr(getWeekMonday(date), -7);
  const prevDates = new Set();
  for (let i = 0; i < 6; i += 1) prevDates.add(shiftDateStr(prevMonday, i));
  const ids = new Set();
  const scan = (arr) => {
    for (const s of arr || []) {
      if (
        s.route_id &&
        s.employee_id?.toString() === employeeId.toString() &&
        prevDates.has(s.date)
      ) {
        ids.add(s.route_id.toString());
      }
    }
  };
  scan(ctx.workingSchedules);
  scan(ctx.quarterSchedules);
  return ids;
};

/**
 * Z8: rotacja TYGODNIOWA.
 * W obrębie tygodnia trzymamy kierowcę na TEJ SAMEJ trasie (mocny bonus za zgodność,
 * mocna kara za zmianę w środku tygodnia). Między tygodniami preferujemy zmianę trasy
 * (lekka kara za powtórzenie trasy z zeszłego tygodnia).
 */
const getRouteRotationPenalty = (employee, route, date, ctx) => {
  if (!date || !route) return 0;

  const rid = route.id.toString();
  const weekRoute = getEmployeeWeekRouteId(employee.id, date, ctx);

  if (weekRoute) {
    return weekRoute === rid ? -10 : 12;
  }

  const lastWeek = getEmployeeLastWeekRouteIds(employee.id, date, ctx);
  return lastWeek.has(rid) ? 2.5 : 0;
};

const scoreRouteForEmployeeHours = (employee, route, ctx, options = {}) => {
  const { daysRemaining = null, forceCoverage = false, date = null } = options;
  const monthGap = getHourGap(employee, ctx);
  const quarterGap = getQuarterHourGap(employee, ctx);
  const blockHours = getRouteBlockHours(route, ctx.routes);
  const mandatoryBonus = routeRequiresStaffing(route) ? -0.5 : 0;
  const wastePenalty =
    Math.max(
      0,
      getEmployeeCapabilityTier(employee) -
        getRouteRestrictionTierWithPair(route, ctx.routes)
    ) * 0.35;

  // Pokrycie pn-pt: zawsze coś przypisz — wybierz najkrótszą pasującą (szczególnie gdy kwartał nad normą).
  if (forceCoverage) {
    const ideal = getIdealRouteHoursForEmployee(employee, ctx, daysRemaining);
    let score = blockHours + wastePenalty + mandatoryBonus;
    score += getPartTimeRouteFitPenalty(employee, blockHours, ideal);
    if (date) score += getRouteRotationPenalty(employee, route, date, ctx);
    if (quarterGap < -8) score += blockHours * 1.2;
    if (monthGap < -8 && quarterGap < 0) score += blockHours * 0.6;
    return score;
  }

  const effectiveGap = monthGap * 0.5 + quarterGap * 0.5;
  const afterEffective = effectiveGap - blockHours;
  let score = Math.abs(afterEffective);

  const ideal = getIdealRouteHoursForEmployee(employee, ctx, daysRemaining);
  score += Math.abs(blockHours - ideal) * 0.9;

  // Nad normą miesiąca — faworyzuj krótsze, ale jeśli kwartał w deficycie, łagodniej.
  if (monthGap - blockHours < 0) {
    const weight = quarterGap > 8 ? 0.6 : 1.8;
    score += Math.abs(monthGap - blockHours) * weight;
  }
  if (quarterGap - blockHours < 0) {
    score += Math.abs(quarterGap - blockHours) * 1.1 + blockHours * 0.35;
  }

  score += getPartTimeRouteFitPenalty(employee, blockHours, ideal);
  if (date) score += getRouteRotationPenalty(employee, route, date, ctx);

  return score + mandatoryBonus + wastePenalty;
};

/** Najlepszy wolny kierowca na daną trasę i dzień (etat, godziny kwartału, uprawnienia). */
const findBestEmployeeForRouteOnDay = (route, date, ctx, options = {}) => {
  let best = null;

  for (const emp of ctx.employees) {
    if (!isEmployeeDayFreeForRoute(emp.id, date, ctx)) continue;
    if (!canEmployeeTakeRouteOnDay(
      emp,
      route,
      ctx.routes,
      date,
      ctx.workingSchedules,
      ctx.month,
      ctx.year,
      routeCheckOptions(ctx)
    )) {
      continue;
    }

    const score = scoreRouteForEmployeeHours(emp, route, ctx, { ...options, date });
    if (!best) {
      best = { emp, score };
      continue;
    }

    const monthCount = countEmployeeRouteInMonth(emp.id, route.id, ctx);
    const bestMonthCount = countEmployeeRouteInMonth(best.emp.id, route.id, ctx);

    if (
      score < best.score ||
      (score === best.score &&
        compareEmployeesForRoute(emp, best.emp, route, ctx.routes) < 0) ||
      (score === best.score &&
        compareEmployeesForRoute(emp, best.emp, route, ctx.routes) === 0 &&
        monthCount < bestMonthCount) ||
      (score === best.score &&
        compareEmployeesForRoute(emp, best.emp, route, ctx.routes) === 0 &&
        monthCount === bestMonthCount &&
        getEmployeePartTime(emp) < getEmployeePartTime(best.emp))
    ) {
      best = { emp, score };
    }
  }

  return best?.emp || null;
};

/** Najlepsza pusta trasa na dany dzień — dopasowana do godzin (krótsza gdy nad etatem, dłuższa gdy brakuje). */
const findBestRouteForEmployeeOnDay = (employee, date, ctx, options = {}) => {
  let best = null;

  for (const route of ctx.routes) {
    if (!isRouteOperatingOnDate(route, date)) continue;
    if (findRouteAssignment(date, route.id, ctx.workingSchedules)) continue;
    if (!canEmployeeTakeRouteOnDay(
      employee,
      route,
      ctx.routes,
      date,
      ctx.workingSchedules,
      ctx.month,
      ctx.year,
      routeCheckOptions(ctx)
    )) {
      continue;
    }

    const score = scoreRouteForEmployeeHours(employee, route, ctx, { ...options, date });
    if (!best || score < best.score) {
      best = { route, score };
    }
  }

  return best?.route || null;
};

const findBestEmptySlot = (employee, ctx) => {
  let best = null;

  for (const date of listMonthDates(ctx.month, ctx.year)) {
    if (!isEmployeeDayFreeForRoute(employee.id, date, ctx)) continue;

    const route = findBestRouteForEmployeeOnDay(employee, date, ctx);
    if (!route) continue;

    const score = scoreRouteForEmployeeHours(employee, route, ctx, { date });
    if (!best || score < best.score) {
      best = { date, route, score };
    }
  }

  return best;
};

const findBestSwapForEmployee = (employee, ctx) => {
  const gap = getHourGap(employee, ctx);
  let best = null;

  for (const date of listMonthDates(ctx.month, ctx.year)) {
    if (!isEmployeeDayFreeForRoute(employee.id, date, ctx)) continue;

    for (const route of ctx.routes) {
      if (!isRouteOperatingOnDate(route, date)) continue;

      const occupied = findRouteAssignment(date, route.id, ctx.workingSchedules);
      if (!occupied) continue;
      if (!isRouteSlotSwappable(date, route.id, ctx.initialRouteSlots)) continue;

      const otherId = occupied.employee_id;
      if (otherId?.toString() === employee.id.toString()) continue;

      const other = ctx.employees.find((e) => e.id.toString() === otherId.toString());
      if (!other) continue;

      if (!canEmployeeTakeRouteOnDay(
        employee,
        route,
        ctx.routes,
        date,
        ctx.workingSchedules,
        ctx.month,
        ctx.year,
        routeCheckOptions(ctx)
      )) {
        continue;
      }

      const blockHours = getRouteBlockHours(route, ctx.routes);
      const qGap = getQuarterHourGap(employee, ctx);
      const scoreAfterTake = Math.abs(gap * 0.5 + qGap * 0.5 - blockHours);

      const snap = snapshotCtx(ctx);
      removeRouteSlot(date, route.id, ctx);
      const assigned = assignRouteToEmployee(employee, route, date, ctx);

      let totalScore = Infinity;
      let employeeGapAfter = gap;
      if (assigned) {
        employeeGapAfter = getHourGap(employee, ctx);
        const employeeQGapAfter = getQuarterHourGap(employee, ctx);
        const otherGapAfter = getHourGap(other, ctx);
        const otherQGapAfter = getQuarterHourGap(other, ctx);
        totalScore =
          Math.abs(employeeGapAfter) * 0.5 +
          Math.abs(employeeQGapAfter) * 0.5 +
          (Math.abs(otherGapAfter) * 0.5 + Math.abs(otherQGapAfter) * 0.5) * 0.5 +
          scoreAfterTake * 0.2;
      }

      if (assigned && (!best || totalScore < best.totalScore)) {
        best = {
          date,
          route,
          other,
          totalScore,
          employeeGapAfter,
        };
      }

      restoreCtx(ctx, snap);
    }
  }

  return best;
};

/** Sobotnie trasy + DW5 — przed masowym wypełnianiem pn–pt (żeby zostawić slot DW5 w nast. tygodniu). */
const fillSaturdayRoutes = (ctx) => {
  for (const date of listSaturdaysInMonth(ctx.month, ctx.year)) {
    const openRoutes = sortOpenRoutesForFill(ctx.routes, date, ctx);

    for (const route of openRoutes) {
      if (findRouteAssignment(date, route.id, ctx.workingSchedules)) continue;

      const candidates = ctx.employees
        .filter((emp) => isEmployeeDayFreeForRoute(emp.id, date, ctx))
        .filter((emp) =>
          canEmployeeTakeRouteOnDay(
            emp,
            route,
            ctx.routes,
            date,
            ctx.workingSchedules,
            ctx.month,
            ctx.year,
            routeCheckOptions(ctx)
          )
        )
        .sort((a, b) => {
          const scoreA = scoreRouteForEmployeeHours(a, route, ctx, { date, forceCoverage: true });
          const scoreB = scoreRouteForEmployeeHours(b, route, ctx, { date, forceCoverage: true });
          return (
            scoreA - scoreB ||
            getHourGap(b, ctx) - getHourGap(a, ctx) ||
            compareEmployeesForRoute(a, b, route, ctx.routes) ||
            a.id - b.id
          );
        });

      for (const emp of candidates) {
        if (assignRouteToEmployee(emp, route, date, ctx)) break;
      }
    }

    const freeEmployees = sortFreeEmployeesForCoverage(ctx.employees, date, ctx);
    for (const emp of freeEmployees) {
      if (getEmployeeRouteSlotCountOnDay(emp.id, date, ctx.workingSchedules, ctx.routes) > 0) {
        continue;
      }
      if (!isEmployeeDayMutable(emp.id, date, ctx.initialEmployeeDays)) continue;
      if (hasPendingOrPersistedLabelOnDay(ctx, emp.id, date)) continue;
      const route = findBestRouteForEmployeeOnDay(emp, date, ctx, { forceCoverage: true });
      if (route) assignRouteToEmployee(emp, route, date, ctx);
    }
  }
};

/** Soboty: każda kursująca trasa obsadzona + DW5 dla każdego kierowcy sobotniego. */
const ensureSaturdayRoutesFilled = (ctx) => {
  for (const date of listSaturdaysInMonth(ctx.month, ctx.year)) {
    for (const route of sortOpenRoutesForFill(ctx.routes, date, ctx)) {
      if (findRouteAssignment(date, route.id, ctx.workingSchedules)) continue;
      const emp = findBestEmployeeForRouteOnDay(route, date, ctx, { forceCoverage: true });
      if (emp && assignRouteToEmployee(emp, route, date, ctx)) continue;
      tryCapabilitySwapForRoute(route, date, ctx);
    }

    for (const emp of sortFreeEmployeesForCoverage(ctx.employees, date, ctx)) {
      if (getEmployeeRouteSlotCountOnDay(emp.id, date, ctx.workingSchedules, ctx.routes) > 0) {
        continue;
      }
      if (!isEmployeeDayMutable(emp.id, date, ctx.initialEmployeeDays)) continue;
      if (hasPendingOrPersistedLabelOnDay(ctx, emp.id, date)) continue;
      const route = findBestRouteForEmployeeOnDay(emp, date, ctx, { forceCoverage: true });
      if (route) assignRouteToEmployee(emp, route, date, ctx);
    }
  }

  const saturdayWorkerKeys = new Set();
  for (const s of ctx.workingSchedules) {
    if (s.route_id && isSaturday(s.date) && s.employee_id != null) {
      saturdayWorkerKeys.add(`${s.employee_id}::${s.date}`);
    }
  }
  for (const key of saturdayWorkerKeys) {
    const sep = key.indexOf('::');
    const empId = key.slice(0, sep);
    const satDate = key.slice(sep + 2);
    forceDw5ForSaturday(ctx, empId, satDate);
  }
};

/** pn–pt: w każdym dniu rozdaj trasy — najpierw ci, którzy są najbardziej „w tyle” z godzinami. */
const fillWeekdaysByDay = (ctx) => {
  const weekdays = listWeekdaysInMonth(ctx.month, ctx.year);

  for (let i = 0; i < weekdays.length; i++) {
    const date = weekdays[i];
    const daysRemaining = weekdays.length - i;
    const progress = (i + 1) / weekdays.length;

    const ordered = [...ctx.employees].sort((a, b) => {
      const targetA = getTargetMonthHours(a, ctx.month, ctx.year);
      const targetB = getTargetMonthHours(b, ctx.month, ctx.year);
      const currentA = getEmployeeMonthHours(
        a.id,
        ctx.workingSchedules,
        ctx.routes,
        ctx.month,
        ctx.year
      );
      const currentB = getEmployeeMonthHours(
        b.id,
        ctx.workingSchedules,
        ctx.routes,
        ctx.month,
        ctx.year
      );
      const deficitA =
        targetA * progress -
        currentA +
        getQuarterHourGap(a, ctx) * 0.4;
      const deficitB =
        targetB * progress -
        currentB +
        getQuarterHourGap(b, ctx) * 0.4;
      return (
        getEmployeeFillOrderRank(a) - getEmployeeFillOrderRank(b) ||
        getEmployeePartTime(a) - getEmployeePartTime(b) ||
        deficitB - deficitA ||
        a.id - b.id
      );
    });

    for (const emp of ordered) {
      if (!isEmployeeDayFreeForRoute(emp.id, date, ctx)) continue;
      const route = findBestRouteForEmployeeOnDay(emp, date, ctx, { daysRemaining });
      if (route) assignRouteToEmployee(emp, route, date, ctx);
    }
  }
};

const balanceEmployeeMonth = (employee, ctx) => {
  const threshold = getGapCloseThreshold(employee, ctx);

  for (let pass = 0; pass < 50; pass++) {
    const gap = getHourGap(employee, ctx);
    const qGap = getQuarterHourGap(employee, ctx);
    if (Math.abs(gap) <= threshold && Math.abs(qGap) <= threshold * 1.5) break;

    if (gap > threshold || (gap < -threshold && qGap > threshold)) {
      const empty = findBestEmptySlot(employee, ctx);
      if (empty) {
        assignRouteToEmployee(employee, empty.route, empty.date, ctx);
        continue;
      }

      if (gap > threshold) {
        const swap = findBestSwapForEmployee(employee, ctx);
        if (swap) {
          removeRouteSlot(swap.date, swap.route.id, ctx);
          assignRouteToEmployee(employee, swap.route, swap.date, ctx);
          const refill = findBestEmptySlot(swap.other, ctx);
          if (refill) {
            assignRouteToEmployee(swap.other, refill.route, refill.date, ctx);
          }
          continue;
        }
      }

      if (gap > threshold) break;
    }

    // Nad normą miesiąca/kwartału: zamiana dłuższej ↔ krótszej (nie usuwamy trasy).
    if (tryRelieveOverTargetEmployee(employee, ctx)) {
      continue;
    }

    break;
  }
};

/**
 * Kierowca nad etatem oddaje dłuższą trasę osobie z deficytem — ta sama data, inna długość.
 */
const tryRelieveOverTargetEmployee = (employee, ctx) => {
  if (getHourGap(employee, ctx) >= -4 && getQuarterHourGap(employee, ctx) >= -4) {
    return false;
  }

  const prefix = `${ctx.year}-${String(ctx.month).padStart(2, '0')}`;
  const myEntries = ctx.workingSchedules
    .filter(
      (s) =>
        s.employee_id?.toString() === employee.id.toString() &&
        s.route_id &&
        s.date?.startsWith(prefix) &&
        isRouteSlotSwappable(s.date, s.route_id, ctx.initialRouteSlots)
    )
    .map((s) => ({
      date: s.date,
      route: ctx.routes.find((r) => r.id.toString() === s.route_id.toString()),
    }))
    .filter((e) => e.route)
    .sort(
      (a, b) =>
        getRouteBlockHours(b.route, ctx.routes) - getRouteBlockHours(a.route, ctx.routes)
    );

  for (const { date, route: myRoute } of myEntries) {
    const dayEntries = ctx.workingSchedules.filter(
      (s) =>
        s.date === date &&
        s.route_id &&
        s.employee_id?.toString() !== employee.id.toString() &&
        isRouteSlotSwappable(date, s.route_id, ctx.initialRouteSlots)
    );

    for (const entry of dayEntries) {
      const other = ctx.employees.find(
        (e) => e.id.toString() === entry.employee_id?.toString()
      );
      const otherRoute = ctx.routes.find(
        (r) => r.id.toString() === entry.route_id?.toString()
      );
      if (!other || !otherRoute) continue;
      if (getHourGap(other, ctx) <= 4 && getQuarterHourGap(other, ctx) <= 4) continue;

      const myHours = getRouteBlockHours(myRoute, ctx.routes);
      const otherHours = getRouteBlockHours(otherRoute, ctx.routes);
      if (myHours <= otherHours) continue;

      if (
        !canEmployeeTakeRouteOnDay(
          other,
          myRoute,
          ctx.routes,
          date,
          ctx.workingSchedules,
          ctx.month,
          ctx.year,
          routeCheckOptions(ctx)
        )
      ) {
        continue;
      }
      if (
        !canEmployeeTakeRouteOnDay(
          employee,
          otherRoute,
          ctx.routes,
          date,
          ctx.workingSchedules,
          ctx.month,
          ctx.year,
          routeCheckOptions(ctx)
        )
      ) {
        continue;
      }

      if (
        trySwapRoutesBetweenEmployees(date, employee, other, myRoute, otherRoute, ctx)
      ) {
        return true;
      }
    }
  }

  return false;
};

/**
 * Każdy pn-pt musi mieć trasę lub label — bierzemy najkrótszą pasującą trasę.
 */
const ensureWeekdayCoverage = (ctx) => {
  for (const date of listWeekdaysInMonth(ctx.month, ctx.year)) {
    const freeEmployees = sortFreeEmployeesForCoverage(ctx.employees, date, ctx);

    for (const emp of freeEmployees) {
      if (!isEmployeeDayFreeForRoute(emp.id, date, ctx)) continue;
      const route = findBestRouteForEmployeeOnDay(emp, date, ctx, { forceCoverage: true });
      if (route) assignRouteToEmployee(emp, route, date, ctx);
    }
  }
};

/** Czy pracownik nie ma nic w danym dniu (brak trasy i etykiety), a dzień jest edytowalny. */
const isEmployeeWeekdayEmpty = (employeeId, date, ctx) => {
  if (!isEmployeeDayMutable(employeeId, date, ctx.initialEmployeeDays)) return false;
  if (hasPendingOrPersistedLabelOnDay(ctx, employeeId, date)) return false;
  return (
    getEmployeeRouteSlotCountOnDay(employeeId, date, ctx.workingSchedules, ctx.routes) === 0
  );
};

/**
 * Próba obsadzenia pustego dnia: pusta trasa → dowolna pasująca → zajęta (zamiana).
 */
const tryFillEmptyDayForEmployee = (employee, date, ctx) => {
  if (!isEmployeeWeekdayEmpty(employee.id, date, ctx)) return false;

  const uiRoutes = getRoutesAvailableForEmployeeOnDay(employee, date, ctx)
    .map((route) => ({
      route,
      score: scoreRouteForEmployeeHours(employee, route, ctx, {
        forceCoverage: true,
        date,
      }),
    }))
    .sort((a, b) => a.score - b.score);

  for (const { route } of uiRoutes) {
    if (assignRouteToEmployee(employee, route, date, ctx)) {
      return true;
    }
  }

  const route = findBestRouteForEmployeeOnDay(employee, date, ctx, { forceCoverage: true });
  if (route && assignRouteToEmployee(employee, route, date, ctx)) {
    return true;
  }

  const openRoutes = sortOpenRoutesForFill(ctx.routes, date, ctx)
    .map((r) => ({
      route: r,
      score: scoreRouteForEmployeeHours(employee, r, ctx, { forceCoverage: true, date }),
    }))
    .sort((a, b) => a.score - b.score);

  for (const { route: r } of openRoutes) {
    if (assignRouteToEmployee(employee, r, date, ctx)) {
      return true;
    }
  }

  const swappableEntries = ctx.workingSchedules
    .filter(
      (s) =>
        s.date === date &&
        s.route_id &&
        isRouteSlotSwappable(date, s.route_id, ctx.initialRouteSlots)
    )
    .map((s) => ({
      route: ctx.routes.find((r) => r.id.toString() === s.route_id.toString()),
      otherId: s.employee_id,
    }))
    .filter((e) => e.route && e.otherId?.toString() !== employee.id.toString());

  for (const { route: takenRoute, otherId } of swappableEntries) {
    const other = ctx.employees.find((e) => e.id.toString() === otherId.toString());
    if (!other) continue;

    if (
      !canEmployeeTakeRouteOnDay(
        employee,
        takenRoute,
        ctx.routes,
        date,
        ctx.workingSchedules,
        ctx.month,
        ctx.year,
        routeCheckOptions(ctx)
      )
    ) {
      continue;
    }

    const snap = snapshotCtx(ctx);

    removeRouteSlot(date, takenRoute.id, ctx);
    if (!assignRouteToEmployee(employee, takenRoute, date, ctx)) {
      restoreCtx(ctx, snap);
      continue;
    }

    const otherRoute = findBestRouteForEmployeeOnDay(other, date, ctx, { forceCoverage: true });
    if (otherRoute) {
      assignRouteToEmployee(other, otherRoute, date, ctx);
    }

    return true;
  }

  for (const r of sortOpenRoutesForFill(ctx.routes, date, ctx)) {
    if (findRouteAssignment(date, r.id, ctx.workingSchedules)) {
      if (tryCapabilitySwapForRoute(r, date, ctx) && !isEmployeeWeekdayEmpty(employee.id, date, ctx)) {
        return true;
      }
    }
  }

  return false;
};

/**
 * Ostatnie przejście: pusty dzień pracownika + dostępna trasa → przypisz (pętla do skutku).
 */
const fillRemainingEmptyEmployeeDays = (ctx) => {
  let changed = true;
  let guard = 0;

  while (changed && guard < 200) {
    changed = false;
    guard += 1;

    for (const date of listFillableDaysInMonth(ctx.month, ctx.year)) {
      const emptyEmployees = ctx.employees
        .filter((e) => isEmployeeWeekdayEmpty(e.id, date, ctx))
        .sort(
          (a, b) =>
            getHourGap(b, ctx) - getHourGap(a, ctx) ||
            getQuarterHourGap(b, ctx) - getQuarterHourGap(a, ctx) ||
            countEmployeeRouteDaysInMonth(a.id, ctx) -
              countEmployeeRouteDaysInMonth(b.id, ctx) ||
            getEmployeePartTime(a) - getEmployeePartTime(b) ||
            a.id - b.id
        );

      for (const emp of emptyEmployees) {
        if (tryFillEmptyDayForEmployee(emp, date, ctx)) {
          changed = true;
        }
      }

      const stillOpen = sortOpenRoutesForFill(ctx.routes, date, ctx);
      for (const route of stillOpen) {
        if (findRouteAssignment(date, route.id, ctx.workingSchedules)) continue;

        const emp = findBestEmployeeForRouteOnDay(route, date, ctx, { forceCoverage: true });
        if (emp && assignRouteToEmployee(emp, route, date, ctx)) {
          changed = true;
        } else if (tryCapabilitySwapForRoute(route, date, ctx)) {
          changed = true;
        }
      }
    }
  }
};

/**
 * Agresywne uzupełnianie: pracownicy z deficytem godzin + pusty dzień → pierwsza trasa z dropdownu.
 */
const fillUnderHourEmployeeGaps = (ctx) => {
  for (let pass = 0; pass < 40; pass++) {
    let any = false;

    const underHour = [...ctx.employees]
      .filter((e) => getHourGap(e, ctx) > 1 || getQuarterHourGap(e, ctx) > 1)
      .sort(
        (a, b) =>
          getHourGap(b, ctx) - getHourGap(a, ctx) ||
          getQuarterHourGap(b, ctx) - getQuarterHourGap(a, ctx) ||
          a.id - b.id
      );

    for (const emp of underHour) {
      for (const date of listFillableDaysInMonth(ctx.month, ctx.year)) {
        if (!isEmployeeWeekdayEmpty(emp.id, date, ctx)) continue;

        const available = getRoutesAvailableForEmployeeOnDay(emp, date, ctx)
          .map((route) => ({
            route,
            score: scoreRouteForEmployeeHours(emp, route, ctx, {
              forceCoverage: true,
              date,
            }),
          }))
          .sort((a, b) => a.score - b.score);

        for (const { route } of available) {
          if (assignRouteToEmployee(emp, route, date, ctx)) {
            any = true;
            break;
          }
        }
      }
    }

    if (!any) break;
  }
};

/**
 * Zamiana wg uprawnień: trasa wymagająca uprawnień została pusta, a wolni pracownicy
 * jej nie wezmą. Jeśli ktoś z uprawnieniami jeździ tego dnia trasę, która ich NIE
 * wymaga — przesadzamy go na trudną trasę, a jego prostszą trasę oddajemy wolnemu.
 */
const tryCapabilitySwapForRoute = (route, date, ctx) => {
  const freeEmployees = ctx.employees
    .filter((e) => isEmployeeDayFreeForRoute(e.id, date, ctx))
    .sort((a, b) => getEmployeeCapabilityTier(a) - getEmployeeCapabilityTier(b));
  if (freeEmployees.length === 0) return false;

  const occupiedEntries = ctx.workingSchedules
    .filter(
      (s) =>
        s.date === date &&
        s.route_id &&
        s.route_id.toString() !== route.id.toString() &&
        isRouteSlotSwappable(date, s.route_id, ctx.initialRouteSlots)
    )
    .map((s) => {
      const occupant = ctx.employees.find(
        (e) => e.id.toString() === s.employee_id?.toString()
      );
      const currentRoute = ctx.routes.find(
        (r) => r.id.toString() === s.route_id.toString()
      );
      return { occupant, currentRoute };
    })
    .filter(({ occupant, currentRoute }) => occupant && currentRoute)
    .sort((a, b) => {
      const capDiff =
        getEmployeeCapabilityTier(b.occupant) - getEmployeeCapabilityTier(a.occupant);
      if (capDiff !== 0) return capDiff;
      return (
        getRouteRestrictionTierWithPair(a.currentRoute, ctx.routes) -
        getRouteRestrictionTierWithPair(b.currentRoute, ctx.routes)
      );
    });

  for (const { occupant, currentRoute } of occupiedEntries) {
    for (const freeEmp of freeEmployees) {
      if (freeEmp.id.toString() === occupant.id.toString()) continue;

      const snap = snapshotCtx(ctx);

      removeRouteSlot(date, currentRoute.id, ctx);

      const okDemanding = assignRouteToEmployee(occupant, route, date, ctx);
      const okFree = okDemanding && assignRouteToEmployee(freeEmp, currentRoute, date, ctx);

      if (okDemanding && okFree) {
        return true;
      }

      restoreCtx(ctx, snap);
    }
  }

  return false;
};

const countEmployeeRouteDaysInMonth = (employeeId, ctx) => {
  const prefix = `${ctx.year}-${String(ctx.month).padStart(2, '0')}`;
  const days = new Set();
  for (const s of ctx.workingSchedules) {
    if (
      s.employee_id?.toString() === employeeId.toString() &&
      s.route_id &&
      s.date?.startsWith(prefix)
    ) {
      days.add(s.date);
    }
  }
  return days.size;
};

const sortOpenRoutesForFill = (routes, date, ctx) =>
  [...routes]
    .filter((r) => isRouteOperatingOnDate(r, date))
    .filter((r) => !findRouteAssignment(date, r.id, ctx.workingSchedules))
    .sort((a, b) => {
      const mandA = routeRequiresStaffing(a) ? 0 : 1;
      const mandB = routeRequiresStaffing(b) ? 0 : 1;
      if (mandA !== mandB) return mandA - mandB;
      return (
        getRouteRestrictionTierWithPair(b, ctx.routes) -
          getRouteRestrictionTierWithPair(a, ctx.routes) ||
        getRouteBlockHours(b, ctx.routes) - getRouteBlockHours(a, ctx.routes)
      );
    });

/**
 * Najpierw obsadza trasy wymagające C lub SP — każda osobno, bez łączenia.
 * Kolejność tras: C+SP → C → B+SP (przed trasami czysto B).
 */
const fillRestrictedRoutesFirst = (ctx) => {
  for (const date of listWeekdaysInMonth(ctx.month, ctx.year)) {
    const openRoutes = sortOpenRoutesForFill(ctx.routes, date, ctx).filter(
      (r) => getRouteRestrictionTierWithPair(r, ctx.routes) >= 2
    );

    for (const route of openRoutes) {
      if (findRouteAssignment(date, route.id, ctx.workingSchedules)) continue;

      const emp = findBestEmployeeForRouteOnDay(route, date, ctx, { forceCoverage: true });
      if (emp && assignRouteToEmployee(emp, route, date, ctx)) {
        continue;
      }
      tryCapabilitySwapForRoute(route, date, ctx);
    }
  }
};

const sortFreeEmployeesForCoverage = (employees, date, ctx) =>
  sortEmployeesForFillOrder(employees.filter((e) => isEmployeeDayFreeForRoute(e.id, date, ctx)))
    .sort(
      (a, b) =>
        countEmployeeRouteDaysInMonth(a.id, ctx) -
          countEmployeeRouteDaysInMonth(b.id, ctx) ||
        getEmployeePartTime(a) - getEmployeePartTime(b) ||
        getQuarterHourGap(b, ctx) - getQuarterHourGap(a, ctx) ||
        getHourGap(b, ctx) - getHourGap(a, ctx) ||
        a.id - b.id
    );

/**
 * Końcowy pass: pn–pt — wolni kierowcy + puste trasy, dobór tras pod godziny.
 */
const finalizeDriverRouteMatching = (ctx) => {
  let changed = true;
  let guard = 0;

  while (changed && guard < 250) {
    changed = false;
    guard += 1;

    for (const date of listWeekdaysInMonth(ctx.month, ctx.year)) {
      const freeEmployees = sortFreeEmployeesForCoverage(ctx.employees, date, ctx);
      if (freeEmployees.length === 0) continue;

      for (const emp of freeEmployees) {
        if (!isEmployeeDayFreeForRoute(emp.id, date, ctx)) continue;
        const route = findBestRouteForEmployeeOnDay(emp, date, ctx);
        if (route && assignRouteToEmployee(emp, route, date, ctx)) {
          changed = true;
        }
      }

      const openRoutes = sortOpenRoutesForFill(ctx.routes, date, ctx).filter((r) =>
        routeRequiresStaffing(r)
      );
      for (const route of openRoutes) {
        if (findRouteAssignment(date, route.id, ctx.workingSchedules)) continue;
        const emp = findBestEmployeeForRouteOnDay(route, date, ctx);
        if (emp && assignRouteToEmployee(emp, route, date, ctx)) {
          changed = true;
        } else if (tryCapabilitySwapForRoute(route, date, ctx)) {
          changed = true;
        }
      }
    }
  }

  for (const emp of sortEmployeesForFillOrder(ctx.employees)) {
    for (const date of listWeekdaysInMonth(ctx.month, ctx.year)) {
      if (!isEmployeeDayFreeForRoute(emp.id, date, ctx)) continue;
      const route = findBestRouteForEmployeeOnDay(emp, date, ctx);
      if (route) assignRouteToEmployee(emp, route, date, ctx);
    }
  }
};

const trySwapRoutesBetweenEmployees = (date, empA, empB, routeA, routeB, ctx, options = {}) => {
  const { allowWorse = false } = options;
  if (!empA || !empB || !routeA || !routeB) return false;
  if (empA.id.toString() === empB.id.toString()) return false;
  if (routeA.id.toString() === routeB.id.toString()) return false;

  if (!isRouteSlotSwappable(date, routeA.id, ctx.initialRouteSlots)) return false;
  if (!isRouteSlotSwappable(date, routeB.id, ctx.initialRouteSlots)) return false;

  const gapBefore =
    Math.abs(getHourGap(empA, ctx)) +
    Math.abs(getQuarterHourGap(empA, ctx)) +
    Math.abs(getHourGap(empB, ctx)) +
    Math.abs(getQuarterHourGap(empB, ctx));

  const snap = snapshotCtx(ctx);

  removeRouteSlot(date, routeA.id, ctx);
  removeRouteSlot(date, routeB.id, ctx);

  const ok =
    assignRouteToEmployee(empA, routeB, date, ctx) &&
    assignRouteToEmployee(empB, routeA, date, ctx);

  if (!ok) {
    restoreCtx(ctx, snap);
    return false;
  }

  const gapAfter =
    Math.abs(getHourGap(empA, ctx)) +
    Math.abs(getQuarterHourGap(empA, ctx)) +
    Math.abs(getHourGap(empB, ctx)) +
    Math.abs(getQuarterHourGap(empB, ctx));
  if (!allowWorse && gapAfter >= gapBefore) {
    restoreCtx(ctx, snap);
    return false;
  }

  return true;
};

/** Zamiany tras w obrębie dnia — wyrównanie godzin przy różnej długości tras. */
const rebalanceHoursOnWeekdays = (ctx) => {
  for (const date of listWeekdaysInMonth(ctx.month, ctx.year)) {
  let improved = true;
  let guard = 0;
  while (improved && guard < 40) {
    improved = false;
    guard += 1;

    const dayEntries = ctx.workingSchedules.filter((s) => s.date === date && s.route_id);
    for (let i = 0; i < dayEntries.length; i++) {
      for (let j = i + 1; j < dayEntries.length; j++) {
        const entryA = dayEntries[i];
        const entryB = dayEntries[j];
        const empA = ctx.employees.find(
          (e) => e.id.toString() === entryA.employee_id?.toString()
        );
        const empB = ctx.employees.find(
          (e) => e.id.toString() === entryB.employee_id?.toString()
        );
        const routeA = ctx.routes.find(
          (r) => r.id.toString() === entryA.route_id?.toString()
        );
        const routeB = ctx.routes.find(
          (r) => r.id.toString() === entryB.route_id?.toString()
        );
        if (trySwapRoutesBetweenEmployees(date, empA, empB, routeA, routeB, ctx)) {
          improved = true;
        }
      }
    }
  }
  }
};

const fillAllOperatingRouteSlots = (ctx) => {
  let changed = true;
  let guard = 0;

  while (changed && guard < 200) {
    changed = false;
    guard += 1;

    for (const date of listNonSundayDates(ctx.month, ctx.year)) {
      const openRoutes = sortOpenRoutesForFill(ctx.routes, date, ctx);

      for (const route of openRoutes) {
        if (findRouteAssignment(date, route.id, ctx.workingSchedules)) continue;

        const emp = findBestEmployeeForRouteOnDay(route, date, ctx);
        if (emp && assignRouteToEmployee(emp, route, date, ctx)) {
          changed = true;
          continue;
        }

        if (tryCapabilitySwapForRoute(route, date, ctx)) {
          changed = true;
        }
      }
    }
  }
};

/**
 * Z7/Z9: twarde domknięcie. Dla każdego dnia (pn–sb) każda nieobsadzona trasa
 * OBOWIĄZKOWA dostaje kierowcę, o ile jest ktokolwiek uprawniony i wolny —
 * kolejność: najtrudniejsze (C+SP → C → B+SP) przed prostymi B. Godziny schodzą
 * na drugi plan (forceCoverage), bo pusta obowiązkowa trasa jest gorsza niż nadgodziny.
 */
const ensureMandatoryRoutesCovered = (ctx) => {
  for (const date of listNonSundayDates(ctx.month, ctx.year)) {
    const openRoutes = sortOpenRoutesForFill(ctx.routes, date, ctx).filter(
      routeRequiresStaffing
    );

    for (const route of openRoutes) {
      if (findRouteAssignment(date, route.id, ctx.workingSchedules)) continue;

      const emp = findBestEmployeeForRouteOnDay(route, date, ctx, { forceCoverage: true });
      if (emp && assignRouteToEmployee(emp, route, date, ctx)) continue;

      tryCapabilitySwapForRoute(route, date, ctx);
    }
  }
};

/** Trasy (obiekty) przypisane pracownikowi danego dnia. */
const getEmployeeRoutesOnDay = (employeeId, date, ctx) =>
  ctx.workingSchedules
    .filter(
      (s) =>
        s.date === date &&
        s.employee_id?.toString() === employeeId.toString() &&
        s.route_id
    )
    .map((s) => ctx.routes.find((r) => r.id.toString() === s.route_id.toString()))
    .filter(Boolean);

/** Czy pracownik jest pusty tego dnia i może dostać pierwszą trasę. */
const employeeNeedsFirstRouteOnDay = (employee, date, ctx) => {
  if (!isEmployeeWeekdayEmpty(employee.id, date, ctx)) return false;

  if (getRoutesAvailableForEmployeeOnDay(employee, date, ctx).length > 0) {
    return true;
  }

  for (const route of ctx.routes) {
    if (!isRouteOperatingOnDate(route, date)) continue;
    if (findRouteAssignment(date, route.id, ctx.workingSchedules)) continue;
    if (
      canEmployeeTakeRouteOnDay(
        employee,
        route,
        ctx.routes,
        date,
        ctx.workingSchedules,
        ctx.month,
        ctx.year,
        routeCheckOptions(ctx)
      )
    ) {
      return true;
    }
  }

  return false;
};

/** Czy na dany dzień ktoś nadal czeka na pierwszą trasę — wtedy nie dokładamy 2./3. trasy innym. */
const hasEmployeesNeedingFirstRouteOnDay = (date, ctx) =>
  ctx.employees.some((emp) => employeeNeedsFirstRouteOnDay(emp, date, ctx));

/** Czy trasa (i jej para) nakłada się czasowo na trasy, które pracownik już ma tego dnia. */
const wouldOverlapEmployeeDay = (employeeId, route, date, ctx) => {
  const existing = getEmployeeRoutesOnDay(employeeId, date, ctx);
  if (existing.length === 0) return false;

  const candidateRoutes = [route];
  const pair = findPairRoute(route, ctx.routes);
  if (pair) candidateRoutes.push(pair);

  return candidateRoutes.some((cand) =>
    existing.some((ex) => routesTimeOverlap(cand, ex))
  );
};

/**
 * Czy można DOŁOŻYĆ pracownikowi kolejną (niezależną) trasę tego dnia.
 * Wymaga: pracownik ma już co najmniej 1 trasę, brak etykiety, godziny się nie pokrywają,
 * uprawnienia pasują (pomijamy tylko blokadę „druga trasa").
 */
const canStackRouteOnEmployee = (employee, route, date, ctx) => {
  if (!ENABLE_ROUTE_STACKING) return false;
  if (!employee || !route) return false;
  if (employee.license_category === 'C') return false;
  if (hasEmployeesNeedingFirstRouteOnDay(date, ctx)) return false;
  if (!isEmployeeDayMutable(employee.id, date, ctx.initialEmployeeDays)) return false;
  if (hasEmployeeLabelOnDay(employee.id, date, ctx.workingSchedules)) return false;
  const slotCount = getEmployeeRouteSlotCountOnDay(
    employee.id,
    date,
    ctx.workingSchedules,
    ctx.routes
  );
  if (slotCount === 0) return false;
  if (slotCount >= getMaxRouteSlotsPerDay()) return false;
  if (!isRouteOperatingOnDate(route, date)) return false;
  if (findRouteAssignment(date, route.id, ctx.workingSchedules)) return false;
  if (wouldOverlapEmployeeDay(employee.id, route, date, ctx)) return false;

  const blockReason = getRouteAssignmentBlockReason(employee, route, {
    pairedRoute: findPairRoute(route, ctx.routes),
    date,
    schedules: ctx.workingSchedules,
    allRoutes: ctx.routes,
    employeeCount: ctx.employees.length,
    initialEmployeeDays: ctx.initialEmployeeDays,
    skipSlotCheck: true,
  });
  if (blockReason) return false;

  return true;
};

/** Dołożenie kolejnej, nienakładającej się trasy do pracownika, który już coś ma tego dnia. */
const assignStackedRoute = (employee, route, date, ctx) => {
  if (!canStackRouteOnEmployee(employee, route, date, ctx)) return false;

  const pairRoute = findPairRoute(route, ctx.routes);
  if (
    !pushAssignment(
      ctx,
      { date, route_id: route.id, employee_id: employee.id },
      { allowStackedRoute: true }
    )
  ) {
    return false;
  }

  if (
    pairRoute &&
    !findRouteAssignment(date, pairRoute.id, ctx.workingSchedules) &&
    !wouldOverlapEmployeeDay(employee.id, pairRoute, date, ctx) &&
    canAssignEmployeeToRouteWithPair(employee, pairRoute, ctx.routes, date, ctx.workingSchedules)
  ) {
    pushAssignment(
      ctx,
      { date, route_id: pairRoute.id, employee_id: employee.id },
      { allowStackedRoute: true }
    );
  }

  if (isSaturday(date)) {
    forceDw5ForSaturday(ctx, employee.id, date);
  }

  return true;
};

/**
 * Faza łączenia: dopiero gdy nikt nie czeka na pierwszą trasę tego dnia —
 * dokładamy max jedną dodatkową trasę (2. slot) osobom z nienakładającymi się godzinami.
 */
const combineLeftoverRoutes = (ctx) => {
  if (!ENABLE_ROUTE_STACKING) return;
  for (const date of listWeekdaysInMonth(ctx.month, ctx.year)) {
    if (hasEmployeesNeedingFirstRouteOnDay(date, ctx)) continue;

    const openRoutes = sortOpenRoutesForFill(ctx.routes, date, ctx);

    for (const route of openRoutes) {
      if (findRouteAssignment(date, route.id, ctx.workingSchedules)) continue;

      const candidates = ctx.employees
        .filter((emp) => canStackRouteOnEmployee(emp, route, date, ctx))
        .sort((a, b) => {
          const wasteA = Math.max(
            0,
            getEmployeeCapabilityTier(a) - getRouteRestrictionTierWithPair(route, ctx.routes)
          );
          const wasteB = Math.max(
            0,
            getEmployeeCapabilityTier(b) - getRouteRestrictionTierWithPair(route, ctx.routes)
          );
          if (wasteA !== wasteB) return wasteA - wasteB;
          const routeHours = getRouteBlockHours(route, ctx.routes);
          if (routeHours <= 6.5) {
            return getEmployeePartTime(a) - getEmployeePartTime(b);
          }
          if (routeHours >= 8) {
            return getEmployeePartTime(b) - getEmployeePartTime(a);
          }
          return (
            scoreRouteForEmployeeHours(a, route, ctx, { date }) -
              scoreRouteForEmployeeHours(b, route, ctx, { date }) ||
            a.id - b.id
          );
        });

      if (candidates.length > 0) {
        assignStackedRoute(candidates[0], route, date, ctx);
      }
    }
  }
};

/**
 * Auto-fill miesięczny:
 * 1. Snapshot — ręczne wpisy (etykiety, trasy) są zamrożone
 * 2. Pokrycie pn–pt: każdy dostaje po 1 trasie (dobór pod godziny)
 * 3. Bilans godzin kierowca po kierowcy (na pustych dniach)
 * 4. Wypełnienie wszystkich tras kursujących w dniu + finalizacja (każdy ma min. 1 trasę)
 * 5. Ostatnie przejście — puste dni pracowników + wolne trasy (każdy po 1 trasie)
 * 6. Wyrównanie godzin (zamiany w obrębie dnia) — bez łączenia tras (1 trasa/dzień)
 * 8. DW5 (jeden na tydzień po sobocie)
 *
 * Godziny: dobór tras pod miesiąc ORAZ kwartał kalendarzowy (I–III, IV–VI…);
 * nie pomijamy dni — wybieramy odpowiednią długość; mniejszy etat → krótsze trasy;
 * rotacja tras — unikamy jazdy tą samą trasą dzień po dniu.
 */
function generateAutoFillAssignments({
  employees,
  routes,
  schedules,
  quarterSchedules = [],
  month,
  year,
  user_id,
}) {
  // Normalizacja: wejście może być instancjami Sequelize — spread {...instancja} gubi
  // pola (date/route_id/employee_id), więc trzeba je wyciągnąć przez get/toJSON.
  const baselineSchedules = schedules.map(toPlainSchedule);
  const workingSchedules = baselineSchedules.map((s) => ({ ...s }));
  const { initialEmployeeDays, initialRouteSlots } = buildInitialSnapshot(baselineSchedules);

  const ctx = {
    employees: sortEmployeesForFillOrder(employees),
    routes,
    workingSchedules,
    persistSim: baselineSchedules.map((s) => ({ ...s })),
    quarterSchedules: quarterSchedules.map(toPlainSchedule),
    assignments: [],
    labelAssignments: [],
    initialEmployeeDays,
    initialRouteSlots,
    month,
    year,
    user_id,
  };

  // Faza 1 — najpierw trasy C/SP z dedykowanymi kierowcami (bez łączenia)
  fillRestrictedRoutesFirst(ctx);

  // Soboty przed pn–pt — rezerwacja DW5 w następnym tygodniu
  fillSaturdayRoutes(ctx);

  // Pokrycie pn–pt: każdy pracownik dostaje po 1 trasie (lub ma label)
  fillWeekdaysByDay(ctx);

  for (const employee of ctx.employees) {
    balanceEmployeeMonth(employee, ctx);
  }

  fillAllOperatingRouteSlots(ctx);
  finalizeDriverRouteMatching(ctx);
  ensureWeekdayCoverage(ctx);

  fillRemainingEmptyEmployeeDays(ctx);
  fillUnderHourEmployeeGaps(ctx);
  fillRemainingEmptyEmployeeDays(ctx);
  ensureWeekdayCoverage(ctx);
  fillAllOperatingRouteSlots(ctx);
  fillRemainingEmptyEmployeeDays(ctx);

  // Łączenie tras (2. slot) — wyłączone: najpierw każdy dostaje 1 trasę
  // combineLeftoverRoutes(ctx);

  rebalanceHoursOnWeekdays(ctx);
  ensureWeekdayCoverage(ctx);
  fillRemainingEmptyEmployeeDays(ctx);
  fillUnderHourEmployeeGaps(ctx);
  fillRemainingEmptyEmployeeDays(ctx);

  fillSaturdayRoutes(ctx);
  ensureSaturdayRoutesFilled(ctx);

  let gapFillPasses = 0;
  for (let pass = 0; pass < 15; pass++) {
    const before = ctx.assignments.length;
    fillRemainingEmptyEmployeeDays(ctx);
    fillUnderHourEmployeeGaps(ctx);
    fillRemainingEmptyEmployeeDays(ctx);
    fillSaturdayRoutes(ctx);
    if (ctx.assignments.length > before) {
      gapFillPasses += 1;
    } else {
      break;
    }
  }

  ensureSaturdayRoutesFilled(ctx);
  ensureMandatoryRoutesCovered(ctx);
  mergeExtraDw5Labels(ctx, user_id, routes);

  let syncPasses = 0;
  let finalSync = syncWorkingSchedulesToPersistable(ctx, baselineSchedules, routes);
  for (let pass = 1; pass < 15 && finalSync.pruned; pass++) {
    fillRemainingEmptyEmployeeDays(ctx);
    fillUnderHourEmployeeGaps(ctx);
    fillRemainingEmptyEmployeeDays(ctx);
    fillSaturdayRoutes(ctx);
    ensureSaturdayRoutesFilled(ctx);
    ensureMandatoryRoutesCovered(ctx);
    mergeExtraDw5Labels(ctx, user_id, routes);
    finalSync = syncWorkingSchedulesToPersistable(ctx, baselineSchedules, routes);
    syncPasses = pass;
  }

  const { kept: routeAssignments, rejected, routeProposals } = finalSync;

  return {
    routeAssignments,
    labelAssignments: ctx.labelAssignments,
    debug: {
      afterAlgorithm: buildAutoFillAlgorithmReport(ctx),
      proposedRoutes: routeProposals.length,
      persistableRoutes: routeAssignments.length,
      rejectedRoutes: rejected.length,
      rejectedByReason: groupRejectionsByReason(rejected),
      persistRejected: rejected,
      proposedLabels: ctx.labelAssignments.length,
      gapFillPasses,
      syncPasses,
    },
  };
}

module.exports = {
  generateAutoFillAssignments,
  collectNewRouteProposals,
  filterPersistableAssignments,
  buildLockedRouteSlots,
  buildInitialSnapshot,
  hasMeaningfulAssignment,
  canEmployeeTakeRouteOnDay,
  balanceEmployeeMonth,
};
