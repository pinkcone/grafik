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

/** Wpis z trasą lub etykietą — puste placeholdery (assignment_type none) nie blokują auto-fill. */
const hasMeaningfulAssignment = (s) =>
  s.route_id != null || (s.label != null && String(s.label).trim() !== '');

const findRouteAssignment = (date, routeId, schedules) =>
  schedules.find((s) => s.date === date && s.route_id?.toString() === routeId.toString());

/** Snapshot stanu sprzed auto-fill — tylko ręczne wpisy (auto_filled można uzupełniać). */
const buildInitialSnapshot = (schedules) => {
  const initialEmployeeDays = new Set();
  const initialRouteSlots = new Set();

  for (const s of schedules) {
    if (s.auto_filled) continue;
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
  if (hasEmployeeLabelOnDay(employeeId, date, ctx.workingSchedules)) return false;
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
      { initialEmployeeDays: options.initialEmployeeDays }
    );
    if (dw5Reason) return false;
  }

  return true;
};

const pushDw5Package = (ctx, employeeId, saturdayDate) => {
  // Tylko JEDEN DW5 na tydzień po danej sobocie.
  if (hasDw5AfterSaturday(employeeId, saturdayDate, ctx.workingSchedules)) {
    return true;
  }

  const pkg = planSaturdayDw5Package(
    saturdayDate,
    employeeId,
    ctx.workingSchedules,
    ctx.routes,
    ctx.employees.length,
    ctx.user_id,
    { initialEmployeeDays: ctx.initialEmployeeDays }
  );
  if (!pkg) return false;

  ctx.labelAssignments.push(pkg.labelProposal);
  ctx.workingSchedules.push(pkg.scheduleEntry);
  return true;
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
};

const getEmployeeLicenseCategory = (employeeId, employees) => {
  const emp = employees?.find((e) => e.id?.toString() === employeeId?.toString());
  return emp?.license_category ?? null;
};

const pushAssignment = (ctx, { date, route_id, employee_id }, options = {}) => {
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
  if (hasEmployeeLabelOnDay(employee_id, date, ctx.workingSchedules)) {
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
  return true;
};

/** Symulacja zapisu — tylko propozycje, które przejdą walidację persist. */
const filterPersistableAssignments = (
  proposals,
  workingSchedules,
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

  const isProposalRow = (s, proposal) =>
    s.date === proposal.date &&
    s.route_id?.toString() === proposal.route_id?.toString() &&
    s.employee_id?.toString() === proposal.employee_id?.toString();

  const sim = workingSchedules
    .filter((s) => !deduped.some((p) => isProposalRow(s, p)))
    .map((s) => ({ ...s }));
  const kept = [];

  for (const item of deduped) {
    if (findRouteAssignment(item.date, item.route_id, sim)) {
      continue;
    }
    if (hasEmployeeLabelOnDay(item.employee_id, item.date, sim)) {
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

  return kept;
};

const routeCheckOptions = (ctx) => ({
  employeeCount: ctx.employees.length,
  initialEmployeeDays: ctx.initialEmployeeDays,
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

  if (isSaturday(date)) {
    const pkg = planSaturdayDw5Package(
      date,
      employee.id,
      ctx.workingSchedules,
      ctx.routes,
      ctx.employees.length,
      ctx.user_id,
      { initialEmployeeDays: ctx.initialEmployeeDays }
    );
    if (!pkg) return false;
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

  if (isSaturday(date)) {
    pushDw5Package(ctx, employee.id, date);
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

/** Ile razy kierowca jechał trasę w kwartale (miesiące wcześniejsze + bieżący). */
const countEmployeeRouteInQuarter = (employeeId, routeId, ctx) => {
  let count = countEmployeeRouteInMonth(employeeId, routeId, ctx);
  const rid = routeId.toString();

  for (const m of getQuarterMonths(ctx.month)) {
    if (m === ctx.month) continue;
    const prefix = `${ctx.year}-${String(m).padStart(2, '0')}`;
    count += (ctx.quarterSchedules || []).filter(
      (s) =>
        s.employee_id?.toString() === employeeId.toString() &&
        s.route_id?.toString() === rid &&
        s.date?.startsWith(prefix)
    ).length;
  }

  return count;
};

/** Seria tej samej trasy w kolejnych dniach roboczych przed `date`. */
const countSameRouteStreakBefore = (employeeId, routeId, date, ctx) => {
  const prefix = `${ctx.year}-${String(ctx.month).padStart(2, '0')}`;
  const rid = routeId.toString();
  const priorDates = ctx.workingSchedules
    .filter(
      (s) =>
        s.employee_id?.toString() === employeeId.toString() &&
        s.route_id &&
        s.date < date &&
        s.date.startsWith(prefix)
    )
    .map((s) => s.date)
    .filter((d, i, arr) => arr.indexOf(d) === i)
    .sort((a, b) => b.localeCompare(a));

  let streak = 0;
  for (const d of priorDates) {
    const droveSame = ctx.workingSchedules.some(
      (s) =>
        s.employee_id?.toString() === employeeId.toString() &&
        s.date === d &&
        s.route_id?.toString() === rid
    );
    if (droveSame) streak += 1;
    else break;
  }
  return streak;
};

/**
 * Kara za brak rotacji — nie chcemy „tej samej trasy codziennie”.
 * Im więcej powtórzeń w miesiącu/kwartale i im dłuższa seria, tym wyższy score (gorzej).
 */
const getRouteRotationPenalty = (employee, route, date, ctx) => {
  if (!date || !route) return 0;

  const monthCount = countEmployeeRouteInMonth(employee.id, route.id, ctx);
  const quarterCount = countEmployeeRouteInQuarter(employee.id, route.id, ctx);
  const streak = countSameRouteStreakBefore(employee.id, route.id, date, ctx);

  let penalty = 0;

  if (streak > 0) {
    penalty += streak * 3.5;
  }
  if (monthCount > 0) {
    penalty += monthCount * 1.4;
  }
  if (quarterCount > monthCount) {
    penalty += (quarterCount - monthCount) * 0.45;
  }

  const prefix = `${ctx.year}-${String(ctx.month).padStart(2, '0')}`;
  const monthRouteIds = new Set(
    ctx.workingSchedules
      .filter(
        (s) =>
          s.employee_id?.toString() === employee.id.toString() &&
          s.route_id &&
          s.date?.startsWith(prefix)
      )
      .map((s) => s.route_id.toString())
  );
  if (monthCount === 0 && monthRouteIds.size > 0) {
    penalty -= 1.1;
  }

  return penalty;
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

      const backup = {
        workingSchedules: ctx.workingSchedules.map((s) => ({ ...s })),
        assignments: ctx.assignments.map((a) => ({ ...a })),
        labelAssignments: ctx.labelAssignments.map((l) => ({ ...l })),
      };

      removeRouteSlot(date, route.id, ctx);
      assignRouteToEmployee(employee, route, date, ctx);

      let otherRecovery = null;
      const refill = findBestEmptySlot(other, ctx);
      if (refill) {
        assignRouteToEmployee(other, refill.route, refill.date, ctx);
        otherRecovery = refill;
      }

      const otherGapAfter = getHourGap(other, ctx);
      const otherQGapAfter = getQuarterHourGap(other, ctx);
      const employeeGapAfter = getHourGap(employee, ctx);
      const employeeQGapAfter = getQuarterHourGap(employee, ctx);
      const totalScore =
        Math.abs(employeeGapAfter) * 0.5 +
        Math.abs(employeeQGapAfter) * 0.5 +
        (Math.abs(otherGapAfter) * 0.5 + Math.abs(otherQGapAfter) * 0.5) * 0.8 +
        scoreAfterTake * 0.2;

      if (
        !best ||
        totalScore < best.totalScore ||
        (totalScore === best.totalScore && Math.abs(employeeGapAfter) < Math.abs(best.employeeGapAfter))
      ) {
        best = {
          date,
          route,
          other,
          otherRecovery,
          totalScore,
          employeeGapAfter,
        };
      }

      ctx.workingSchedules = backup.workingSchedules;
      ctx.assignments = backup.assignments;
      ctx.labelAssignments = backup.labelAssignments;
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
      if (!isEmployeeWeekdayEmpty(emp.id, date, ctx)) continue;
      const route = findBestRouteForEmployeeOnDay(emp, date, ctx, { forceCoverage: true });
      if (route) assignRouteToEmployee(emp, route, date, ctx);
    }
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

  for (let pass = 0; pass < 100; pass++) {
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
          if (swap.otherRecovery) {
            assignRouteToEmployee(swap.other, swap.otherRecovery.route, swap.otherRecovery.date, ctx);
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
  if (hasEmployeeLabelOnDay(employeeId, date, ctx.workingSchedules)) return false;
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

    const backup = {
      workingSchedules: ctx.workingSchedules.map((s) => ({ ...s })),
      assignments: ctx.assignments.map((a) => ({ ...a })),
      labelAssignments: ctx.labelAssignments.map((l) => ({ ...l })),
    };

    removeRouteSlot(date, takenRoute.id, ctx);
    if (!assignRouteToEmployee(employee, takenRoute, date, ctx)) {
      ctx.workingSchedules = backup.workingSchedules;
      ctx.assignments = backup.assignments;
      ctx.labelAssignments = backup.labelAssignments;
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

  while (changed && guard < 500) {
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

      const backup = {
        workingSchedules: ctx.workingSchedules.map((s) => ({ ...s })),
        assignments: ctx.assignments.map((a) => ({ ...a })),
        labelAssignments: ctx.labelAssignments.map((l) => ({ ...l })),
      };

      removeRouteSlot(date, currentRoute.id, ctx);

      const okDemanding = assignRouteToEmployee(occupant, route, date, ctx);
      const okFree = okDemanding && assignRouteToEmployee(freeEmp, currentRoute, date, ctx);

      if (okDemanding && okFree) {
        return true;
      }

      ctx.workingSchedules = backup.workingSchedules;
      ctx.assignments = backup.assignments;
      ctx.labelAssignments = backup.labelAssignments;
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

  while (changed && guard < 600) {
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

  const backup = {
    workingSchedules: ctx.workingSchedules.map((s) => ({ ...s })),
    assignments: ctx.assignments.map((a) => ({ ...a })),
    labelAssignments: ctx.labelAssignments.map((l) => ({ ...l })),
  };

  removeRouteSlot(date, routeA.id, ctx);
  removeRouteSlot(date, routeB.id, ctx);

  const ok =
    assignRouteToEmployee(empA, routeB, date, ctx) &&
    assignRouteToEmployee(empB, routeA, date, ctx);

  if (!ok) {
    ctx.workingSchedules = backup.workingSchedules;
    ctx.assignments = backup.assignments;
    ctx.labelAssignments = backup.labelAssignments;
    return false;
  }

  const gapAfter =
    Math.abs(getHourGap(empA, ctx)) +
    Math.abs(getQuarterHourGap(empA, ctx)) +
    Math.abs(getHourGap(empB, ctx)) +
    Math.abs(getQuarterHourGap(empB, ctx));
  if (!allowWorse && gapAfter >= gapBefore) {
    ctx.workingSchedules = backup.workingSchedules;
    ctx.assignments = backup.assignments;
    ctx.labelAssignments = backup.labelAssignments;
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

  while (changed && guard < 500) {
    changed = false;
    guard += 1;

    for (const date of listMonthDates(ctx.month, ctx.year)) {
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

  if (isSaturday(date)) {
    const pkg = planSaturdayDw5Package(
      date,
      employee.id,
      ctx.workingSchedules,
      ctx.routes,
      ctx.employees.length,
      ctx.user_id,
      { initialEmployeeDays: ctx.initialEmployeeDays }
    );
    if (!pkg) return false;
  }

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
    pushDw5Package(ctx, employee.id, date);
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
  const workingSchedules = schedules.map((s) => ({ ...s }));
  const { initialEmployeeDays, initialRouteSlots } = buildInitialSnapshot(schedules);

  const ctx = {
    employees: sortEmployeesForFillOrder(employees),
    routes,
    workingSchedules,
    quarterSchedules: quarterSchedules.map((s) => ({ ...s })),
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

  const extraLabels = generateDw5Proposals(
    ctx.workingSchedules,
    user_id,
    routes,
    ctx.employees.length
  );

  // Dedup etykiet po (pracownik|data|label) — DW5 maks. raz na dzień/tydzień
  const seenLabels = new Set();
  const labelAssignments = [...ctx.labelAssignments, ...extraLabels].filter((l) => {
    const key = `${l.employee_id}|${l.date}|${l.label}`;
    if (seenLabels.has(key)) return false;
    seenLabels.add(key);
    return true;
  });

  return {
    routeAssignments: filterPersistableAssignments(
      ctx.assignments,
      ctx.workingSchedules,
      routes,
      ctx.employees
    ),
    labelAssignments,
    debug: {
      afterAlgorithm: buildAutoFillAlgorithmReport(ctx),
      proposedRoutes: ctx.assignments.length,
      proposedLabels: labelAssignments.length,
    },
  };
}

/**
 * Uzupełnienie luk po zapisie do bazy — tylko puste dni + deficyt godzin.
 */
function generateGapFillOnly({
  employees,
  routes,
  schedules,
  quarterSchedules = [],
  month,
  year,
  user_id,
}) {
  const workingSchedules = schedules.map((s) => ({ ...s }));
  const manualSchedules = schedules.filter((s) => !s.auto_filled);
  const { initialEmployeeDays, initialRouteSlots } = buildInitialSnapshot(manualSchedules);

  const ctx = {
    employees: sortEmployeesForFillOrder(employees),
    routes,
    workingSchedules,
    quarterSchedules: quarterSchedules.map((s) => ({ ...s })),
    assignments: [],
    labelAssignments: [],
    initialEmployeeDays,
    initialRouteSlots,
    month,
    year,
    user_id,
  };

  for (let pass = 0; pass < 15; pass++) {
    let any = false;
    const before = ctx.assignments.length;
    fillRemainingEmptyEmployeeDays(ctx);
    fillUnderHourEmployeeGaps(ctx);
    fillRemainingEmptyEmployeeDays(ctx);
    fillSaturdayRoutes(ctx);
    if (ctx.assignments.length > before) {
      any = true;
    }
    if (!any) break;
  }

  return {
    routeAssignments: filterPersistableAssignments(
      ctx.assignments,
      ctx.workingSchedules,
      routes,
      employees
    ),
  };
}

module.exports = {
  generateAutoFillAssignments,
  generateGapFillOnly,
  filterPersistableAssignments,
  buildLockedRouteSlots,
  buildInitialSnapshot,
  hasMeaningfulAssignment,
  canEmployeeTakeRouteOnDay,
  balanceEmployeeMonth,
};
