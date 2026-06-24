const {
  findPairRoute,
  canAssignEmployeeToRouteWithPair,
  routeRequiresStaffing,
  getAssignmentBlockReason,
} = require('./routeAssignment');
const { isRouteOperatingOnDate } = require('./routeOperatingDays');
const { generateDw5Proposals, isSaturday, planSaturdayDw5Package } = require('./scheduleRules');
const { hasEmployeeLabelOnDay } = require('./scheduleLabels');
const {
  getEmployeeRouteSlotCountOnDay,
  canEmployeeHaveAnotherRouteOnDay,
} = require('./scheduleConstraints');
const {
  getRouteDurationHours,
  getTargetMonthHours,
  getEmployeeMonthHours,
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

  const already = ctx.workingSchedules.some(
    (s) =>
      s.employee_id?.toString() === employeeId.toString() &&
      s.date === pkg.dw5Date &&
      s.label === pkg.scheduleEntry.label
  );
  if (!already) {
    ctx.labelAssignments.push(pkg.labelProposal);
    ctx.workingSchedules.push(pkg.scheduleEntry);
  }
  return true;
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

const scoreForGap = (gap, blockHours) => {
  const after = gap - blockHours;
  return Math.abs(after);
};

const findBestEmptySlot = (employee, ctx, { maxOvershoot = 1.1 } = {}) => {
  const gap = getHourGap(employee, ctx);
  const target = getTargetMonthHours(employee, ctx.month, ctx.year);
  const current = target - gap;
  let best = null;

  for (const date of listMonthDates(ctx.month, ctx.year)) {
    if (!isEmployeeDayFreeForRoute(employee.id, date, ctx)) continue;

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

      const blockHours = getRouteBlockHours(route, ctx.routes);
      const after = current + blockHours;
      if (gap <= 0 && after > target * maxOvershoot) continue;
      if (gap > 0 && after > target * maxOvershoot) continue;

      const mandatoryBonus = routeRequiresStaffing(route) ? -0.5 : 0;
      const score = scoreForGap(gap, blockHours) + mandatoryBonus;

      if (!best || score < best.score) {
        best = { date, route, blockHours, score };
      }
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
      };

      removeRouteSlot(date, route.id, ctx);
      assignRouteToEmployee(employee, route, date, ctx);

      let otherRecovery = null;
      const refill = findBestEmptySlot(other, ctx, { maxOvershoot: 1.15 });
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
    }
  }

  return best;
};

const findRemovableAlgoAssignment = (employee, ctx) => {
  const candidates = [];

  for (const s of ctx.workingSchedules) {
    if (s.employee_id?.toString() !== employee.id.toString() || !s.route_id) continue;
    if (!isRouteSlotSwappable(s.date, s.route_id, ctx.initialRouteSlots)) continue;

    const route = ctx.routes.find((r) => r.id.toString() === s.route_id.toString());
    if (!route) continue;

    candidates.push({
      date: s.date,
      route,
      hours: getRouteBlockHours(route, ctx.routes),
    });
  }

  if (candidates.length === 0) return null;

  const gap = getHourGap(employee, ctx);
  candidates.sort((a, b) => {
    const scoreA = Math.abs(gap + a.hours);
    const scoreB = Math.abs(gap + b.hours);
    return scoreA - scoreB;
  });

  return candidates[0];
};

const balanceEmployeeMonth = (employee, ctx) => {
  const threshold = getGapCloseThreshold(employee, ctx);

  for (let pass = 0; pass < 200; pass++) {
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

    if (gap < -threshold) {
      const removable = findRemovableAlgoAssignment(employee, ctx);
      if (!removable) break;
      removeRouteSlot(removable.date, removable.route.id, ctx);
      continue;
    }
  }
};

const fillRemainingMandatorySlots = (ctx) => {
  for (const date of listMonthDates(ctx.month, ctx.year)) {
    const mandatoryRoutes = ctx.routes
      .filter((r) => routeRequiresStaffing(r) && isRouteOperatingOnDate(r, date))
      .sort((a, b) => getRouteBlockHours(b, ctx.routes) - getRouteBlockHours(a, ctx.routes));

    for (const route of mandatoryRoutes) {
      if (findRouteAssignment(date, route.id, ctx.workingSchedules)) continue;

      const ordered = [...ctx.employees].sort((a, b) => {
        const gapA = getHourGap(a, ctx);
        const gapB = getHourGap(b, ctx);
        return gapB - gapA;
      });

      for (const emp of ordered) {
        if (!isEmployeeDayFreeForRoute(emp.id, date, ctx)) continue;
        if (assignRouteToEmployee(emp, route, date, ctx)) break;
      }
    }
  }
};

/**
 * Auto-fill miesięczny:
 * 1. Snapshot — ręczne wpisy (etykiety, trasy) są zamrożone
 * 2. Kierowca po kierowcy — dopasowanie godzin na cały miesiąc
 * 3. Puste sloty → zamiany z innymi (tylko przypisania algorytmu)
 * 4. Na końcu — wypełnienie obowiązkowych tras
 * 5. DW5
 */
function generateAutoFillAssignments({ employees, routes, schedules, month, year, user_id }) {
  const workingSchedules = schedules.map((s) => ({ ...s }));
  const { initialEmployeeDays, initialRouteSlots } = buildInitialSnapshot(schedules);

  const ctx = {
    employees: [...employees].sort((a, b) => a.id - b.id),
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

  for (const employee of ctx.employees) {
    balanceEmployeeMonth(employee, ctx);
  }

  fillRemainingMandatorySlots(ctx);

  const extraLabels = generateDw5Proposals(
    ctx.workingSchedules,
    user_id,
    routes,
    ctx.employees.length
  );
  const labelAssignments = [...ctx.labelAssignments, ...extraLabels];

  return { routeAssignments: ctx.assignments, labelAssignments };
}

module.exports = {
  generateAutoFillAssignments,
  buildLockedRouteSlots,
  buildInitialSnapshot,
  canEmployeeTakeRouteOnDay,
  balanceEmployeeMonth,
};
