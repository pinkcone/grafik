const {
  findPairRoute,
  canAssignEmployeeToRouteWithPair,
  routeRequiresStaffing,
  getAssignmentBlockReason,
  getEmployeeCapabilityTier,
  getRouteRestrictionTierWithPair,
  hasSpecialPermissions,
} = require('./routeAssignment');
const { isRouteOperatingOnDate, getIsoWeekday } = require('./routeOperatingDays');
const {
  generateDw5Proposals,
  isSaturday,
  planSaturdayDw5Package,
  hasDw5AfterSaturday,
  getDw5CandidateWeekdays,
  DW5_LABEL_CODE,
} = require('./scheduleRules');
const { hasEmployeeLabelOnDay } = require('./scheduleLabels');
const {
  getEmployeeRouteSlotCountOnDay,
  canEmployeeHaveAnotherRouteOnDay,
} = require('./scheduleConstraints');
const { getAssignmentBlockReason: getRouteAssignmentBlockReason } = require('./routeAssignment');
const {
  getRouteDurationHours,
  getTargetMonthHours,
  getEmployeeMonthHours,
  routesTimeOverlap,
} = require('./scheduleHours');

const daysInMonth = (month, year) => new Date(year, month, 0).getDate();

const buildDate = (year, month, day) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const employeeDayKey = (date, employeeId) => `${date}|${employeeId}`;
const routeSlotKey = (date, routeId) => `${date}|${routeId}`;

const findRouteAssignment = (date, routeId, schedules) =>
  schedules.find((s) => s.date === date && s.route_id?.toString() === routeId.toString());

/** Snapshot stanu sprzed auto-fill — ręczne wpisy są nietykalne */
const buildInitialSnapshot = (schedules) => {
  const initialEmployeeDays = new Set();
  const initialRouteSlots = new Set();

  for (const s of schedules) {
    if (s.employee_id != null && s.date) {
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

const getGapCloseThreshold = (employee, ctx) => {
  const target = getTargetMonthHours(employee, ctx.month, ctx.year);
  return Math.max(2, target * 0.04);
};

/**
 * Kolejność układania: najpierw najmniej elastyczni.
 * 0 = B bez SP, 1 = C bez SP, 2 = B + SP, 3 = C + SP (SP dzielą resztę na końcu).
 */
const getEmployeeFillOrderRank = (employee) => {
  const hasSP = hasSpecialPermissions(employee?.special_permissions);
  const isC = employee?.license_category === 'C';
  if (!hasSP && !isC) return 0;
  if (!hasSP && isC) return 1;
  if (hasSP && !isC) return 2;
  return 3;
};

const sortEmployeesForFillOrder = (employees) =>
  [...employees].sort(
    (a, b) =>
      getEmployeeFillOrderRank(a) - getEmployeeFillOrderRank(b) || a.id - b.id
  );

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
  if (!employee || !route) return false;
  if (hasEmployeeLabelOnDay(employee.id, date, schedules)) return false;
  if (!canEmployeeHaveAnotherRouteOnDay(employee.id, route.id, date, schedules, routes)) {
    return false;
  }
  if (!canAssignEmployeeToRouteWithPair(employee, route, routes, date, schedules)) {
    return false;
  }

  const routeOptions = {
    pairedRoute: findPairRoute(route, routes),
    date,
    schedules,
    allRoutes: routes,
    employeeCount: options.employeeCount || 0,
    initialEmployeeDays: options.initialEmployeeDays || null,
  };
  if (getAssignmentBlockReason(employee, route, routeOptions)) {
    return false;
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

const pushAssignment = (ctx, { date, route_id, employee_id }) => {
  if (hasEmployeeLabelOnDay(employee_id, date, ctx.workingSchedules)) {
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
  });
  return true;
};

const routeCheckOptions = (ctx) => ({
  employeeCount: ctx.employees.length,
  initialEmployeeDays: ctx.initialEmployeeDays,
});

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
      { allowPairLeg: true }
    ) &&
    canAssignEmployeeToRouteWithPair(
      employee,
      pairRoute,
      ctx.routes,
      date,
      ctx.workingSchedules
    )
  ) {
    pushAssignment(ctx, { date, route_id: pairRoute.id, employee_id: employee.id });
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

const countEmployeeFreeWeekdays = (employeeId, ctx) =>
  listWeekdaysInMonth(ctx.month, ctx.year).filter((date) =>
    isEmployeeDayFreeForRoute(employeeId, date, ctx)
  ).length;

/** Ile godzin „na dzień” zostało do rozłożenia (uwzględnia puste dni robocze). */
const getIdealRouteHoursForEmployee = (employee, ctx, daysRemaining = null) => {
  const gap = getHourGap(employee, ctx);
  const freeDays =
    daysRemaining != null
      ? daysRemaining
      : countEmployeeFreeWeekdays(employee.id, ctx);
  if (freeDays <= 0) return Math.max(0, gap);
  return gap / freeDays;
};

const scoreForGap = (gap, blockHours) => {
  const after = gap - blockHours;
  return Math.abs(after);
};

const scoreRouteForEmployeeHours = (employee, route, ctx, options = {}) => {
  const { daysRemaining = null, forceCoverage = false } = options;
  const gap = getHourGap(employee, ctx);
  const blockHours = getRouteBlockHours(route, ctx.routes);
  const after = gap - blockHours;
  const mandatoryBonus = routeRequiresStaffing(route) ? -0.5 : 0;
  const wastePenalty =
    Math.max(
      0,
      getEmployeeCapabilityTier(employee) -
        getRouteRestrictionTierWithPair(route, ctx.routes)
    ) * 0.35;

  // Pokrycie pn-pt: gdy brakuje trasy w dniu, weź najkrótszą możliwą (nawet nad etatem).
  if (forceCoverage) {
    return blockHours + wastePenalty + mandatoryBonus;
  }

  let score = scoreForGap(gap, blockHours);

  const ideal = getIdealRouteHoursForEmployee(employee, ctx, daysRemaining);
  score += Math.abs(blockHours - ideal) * 0.85;

  // Nad etatem — mocniej faworyzuj krótsze trasy, żeby nie zostawiać pustych dni.
  if (after < 0) {
    score += Math.abs(after) * 2 + blockHours * 0.4;
  }

  return score + mandatoryBonus + wastePenalty;
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

    const score = scoreRouteForEmployeeHours(employee, route, ctx, options);
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

    const score = scoreRouteForEmployeeHours(employee, route, ctx);
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
      const scoreAfterTake = scoreForGap(gap, blockHours);

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
      const employeeGapAfter = getHourGap(employee, ctx);
      const totalScore =
        Math.abs(employeeGapAfter) +
        Math.abs(otherGapAfter) * 0.8 +
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
      const deficitA = targetA * progress - currentA;
      const deficitB = targetB * progress - currentB;
      return (
        deficitB - deficitA ||
        getEmployeeFillOrderRank(a) - getEmployeeFillOrderRank(b) ||
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
    if (Math.abs(gap) <= threshold) break;

    if (gap > threshold) {
      const empty = findBestEmptySlot(employee, ctx);
      if (empty) {
        assignRouteToEmployee(employee, empty.route, empty.date, ctx);
        continue;
      }

      const swap = findBestSwapForEmployee(employee, ctx);
      if (swap) {
        removeRouteSlot(swap.date, swap.route.id, ctx);
        assignRouteToEmployee(employee, swap.route, swap.date, ctx);
        if (swap.otherRecovery) {
          assignRouteToEmployee(swap.other, swap.otherRecovery.route, swap.otherRecovery.date, ctx);
        }
        continue;
      }

      break;
    }

    // Nad etatem: zamień długą trasę z kimś, kto ma deficyt godzin (ten sam dzień).
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
      if (getHourGap(other, ctx) <= 0) continue;

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

const sortFreeEmployeesForCoverage = (employees, date, ctx) =>
  sortEmployeesForFillOrder(employees.filter((e) => isEmployeeDayFreeForRoute(e.id, date, ctx)))
    .sort(
      (a, b) =>
        countEmployeeRouteDaysInMonth(a.id, ctx) -
          countEmployeeRouteDaysInMonth(b.id, ctx) ||
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

      const openMandatory = sortOpenRoutesForFill(ctx.routes, date, ctx).filter((r) =>
        routeRequiresStaffing(r)
      );
      for (const route of openMandatory) {
        if (findRouteAssignment(date, route.id, ctx.workingSchedules)) continue;
        if (tryCapabilitySwapForRoute(route, date, ctx)) {
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

  const gapBefore = Math.abs(getHourGap(empA, ctx)) + Math.abs(getHourGap(empB, ctx));

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

  const gapAfter = Math.abs(getHourGap(empA, ctx)) + Math.abs(getHourGap(empB, ctx));
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

const fillRemainingMandatorySlots = (ctx) => {
  for (const date of listMonthDates(ctx.month, ctx.year)) {
    const mandatoryRoutes = ctx.routes
      .filter((r) => routeRequiresStaffing(r) && isRouteOperatingOnDate(r, date))
      .sort(
        (a, b) =>
          getRouteRestrictionTierWithPair(b, ctx.routes) -
            getRouteRestrictionTierWithPair(a, ctx.routes) ||
          getRouteBlockHours(b, ctx.routes) - getRouteBlockHours(a, ctx.routes)
      );

    for (const route of mandatoryRoutes) {
      if (findRouteAssignment(date, route.id, ctx.workingSchedules)) continue;

      const ordered = [...ctx.employees].sort((a, b) => {
        const gapA = getHourGap(a, ctx);
        const gapB = getHourGap(b, ctx);
        return gapB - gapA;
      });

      let filled = false;
      for (const emp of ordered) {
        if (!isEmployeeDayFreeForRoute(emp.id, date, ctx)) continue;
        if (assignRouteToEmployee(emp, route, date, ctx)) {
          filled = true;
          break;
        }
      }

      if (!filled) {
        tryCapabilitySwapForRoute(route, date, ctx);
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
  if (!employee || !route) return false;
  if (!isEmployeeDayMutable(employee.id, date, ctx.initialEmployeeDays)) return false;
  if (hasEmployeeLabelOnDay(employee.id, date, ctx.workingSchedules)) return false;
  if (getEmployeeRouteSlotCountOnDay(employee.id, date, ctx.workingSchedules, ctx.routes) === 0) {
    return false;
  }
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
  if (!pushAssignment(ctx, { date, route_id: route.id, employee_id: employee.id })) {
    return false;
  }

  if (
    pairRoute &&
    !findRouteAssignment(date, pairRoute.id, ctx.workingSchedules) &&
    !wouldOverlapEmployeeDay(employee.id, pairRoute, date, ctx) &&
    canAssignEmployeeToRouteWithPair(employee, pairRoute, ctx.routes, date, ctx.workingSchedules)
  ) {
    pushAssignment(ctx, { date, route_id: pairRoute.id, employee_id: employee.id });
  }

  if (isSaturday(date)) {
    pushDw5Package(ctx, employee.id, date);
  }

  return true;
};

/**
 * Faza łączenia: gdy KAŻDY ma już swoją trasę, a zostały nieobsadzone trasy —
 * dokładamy je pracownikom, którym godziny się nie pokrywają (najpierw najbardziej
 * pod etatem), żeby żadna trasa nie została pusta.
 */
const combineLeftoverRoutes = (ctx) => {
  for (const date of listWeekdaysInMonth(ctx.month, ctx.year)) {
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
          return getHourGap(b, ctx) - getHourGap(a, ctx) || a.id - b.id;
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
 * 4. Wypełnienie obowiązkowych tras + finalizacja (każdy ma min. 1 trasę)
 * 5. Łączenie: zostałe trasy dokładamy osobom z nienakładającymi się godzinami
 * 6. Wyrównanie godzin (zamiany w obrębie dnia)
 * 7. DW5 (jeden na tydzień po sobocie)
 */
function generateAutoFillAssignments({ employees, routes, schedules, month, year, user_id }) {
  const workingSchedules = schedules.map((s) => ({ ...s }));
  const { initialEmployeeDays, initialRouteSlots } = buildInitialSnapshot(schedules);

  const ctx = {
    employees: sortEmployeesForFillOrder(employees),
    routes,
    workingSchedules,
    assignments: [],
    labelAssignments: [],
    initialEmployeeDays,
    initialRouteSlots,
    month,
    year,
    user_id,
  };

  // Faza 1 — pokrycie: każdy pracownik dostaje po 1 trasie (lub ma label)
  fillWeekdaysByDay(ctx);

  for (const employee of ctx.employees) {
    balanceEmployeeMonth(employee, ctx);
  }

  fillRemainingMandatorySlots(ctx);
  finalizeDriverRouteMatching(ctx);
  ensureWeekdayCoverage(ctx);

  // Faza 2 — łączenie: dopiero gdy każdy ma swoją trasę, dokładamy zostałe trasy
  // osobom, którym godziny się nie pokrywają
  combineLeftoverRoutes(ctx);

  rebalanceHoursOnWeekdays(ctx);
  ensureWeekdayCoverage(ctx);

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

  return { routeAssignments: ctx.assignments, labelAssignments };
}

module.exports = {
  generateAutoFillAssignments,
  buildLockedRouteSlots,
  buildInitialSnapshot,
  canEmployeeTakeRouteOnDay,
  balanceEmployeeMonth,
};
