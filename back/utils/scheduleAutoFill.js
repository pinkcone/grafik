const {
  findPairRoute,
  canAssignEmployeeToRouteWithPair,
  sortRoutesByAssignmentPriority,
  compareEmployeesForRoute,
  routeRequiresStaffing,
} = require('./routeAssignment');
const { isRouteOperatingOnDate } = require('./routeOperatingDays');
const { generateDw5Proposals } = require('./scheduleRules');
const { hasEmployeeLabelOnDay } = require('./scheduleLabels');
const {
  getEmployeeRouteSlotCountOnDay,
  canEmployeeHaveAnotherRouteOnDay,
} = require('./scheduleConstraints');
const {
  getHoursRatio,
  wouldExceedTargetHours,
} = require('./scheduleHours');

const daysInMonth = (month, year) => new Date(year, month, 0).getDate();

const buildDate = (year, month, day) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const getMondayOfWeek = (dateStr) => {
  const d = new Date(`${dateStr}T12:00:00`);
  const isoDay = d.getDay() === 0 ? 7 : d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (isoDay - 1));
  return buildDate(monday.getFullYear(), monday.getMonth() + 1, monday.getDate());
};

const getWeeksInMonth = (month, year) => {
  const dim = daysInMonth(month, year);
  const weekMap = new Map();

  for (let day = 1; day <= dim; day++) {
    const date = buildDate(year, month, day);
    const weekKey = getMondayOfWeek(date);
    if (!weekMap.has(weekKey)) weekMap.set(weekKey, []);
    weekMap.get(weekKey).push(date);
  }

  return [...weekMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekKey, dates]) => ({ weekKey, dates }));
};

const findRouteAssignment = (date, routeId, schedules) =>
  schedules.find((s) => s.date === date && s.route_id?.toString() === routeId.toString());

const countEmployeeRouteDays = (employeeId, routeId, schedules, routes) => {
  const { getPairRouteIdsIncludingSelf } = require('./scheduleConstraints');
  const pairIds = new Set(getPairRouteIdsIncludingSelf(routeId, routes).map(String));
  return schedules.filter(
    (s) =>
      s.employee_id?.toString() === employeeId.toString() &&
      s.route_id &&
      pairIds.has(s.route_id.toString())
  ).length;
};

const droveRouteYesterday = (employeeId, routeId, date, schedules, routes) => {
  const { getPairRouteIdsIncludingSelf } = require('./scheduleConstraints');
  const [y, m, d] = date.split('-').map(Number);
  const prev = new Date(y, m - 1, d - 1);
  const prevDate = buildDate(prev.getFullYear(), prev.getMonth() + 1, prev.getDate());
  const pairIds = new Set(getPairRouteIdsIncludingSelf(routeId, routes).map(String));

  return schedules.some(
    (s) =>
      s.date === prevDate &&
      s.employee_id?.toString() === employeeId.toString() &&
      s.route_id &&
      pairIds.has(s.route_id.toString())
  );
};

const canEmployeeTakeRouteOnDay = (employee, route, routes, date, schedules, month, year) => {
  if (!employee || !route) return false;
  if (!canEmployeeHaveAnotherRouteOnDay(employee.id, route.id, date, schedules, routes)) {
    return false;
  }
  if (!canAssignEmployeeToRouteWithPair(employee, route, routes, date, schedules)) {
    return false;
  }
  if (month && year && wouldExceedTargetHours(employee, route, schedules, routes, month, year)) {
    return false;
  }
  return true;
};

const compareEmployeesForAutoFill = (employeeA, employeeB, route, routes, ctx) => {
  const { schedules, date, day, month, year } = ctx;

  const ratioA = getHoursRatio(employeeA, schedules, routes, month, year);
  const ratioB = getHoursRatio(employeeB, schedules, routes, month, year);
  if (Math.abs(ratioA - ratioB) > 0.02) return ratioA - ratioB;

  const countA = countEmployeeRouteDays(employeeA.id, route.id, schedules, routes);
  const countB = countEmployeeRouteDays(employeeB.id, route.id, schedules, routes);
  if (countA !== countB) return countA - countB;

  const streakA = droveRouteYesterday(employeeA.id, route.id, date, schedules, routes) ? 1 : 0;
  const streakB = droveRouteYesterday(employeeB.id, route.id, date, schedules, routes) ? 1 : 0;
  if (streakA !== streakB) return streakA - streakB;

  const scarcity = compareEmployeesForRoute(employeeA, employeeB, route, routes);
  if (scarcity !== 0) return scarcity;

  return (employeeA.id + day) % 97 - (employeeB.id + day) % 97;
};

const pushAssignment = (assignments, workingSchedules, { date, route_id, employee_id, user_id }) => {
  assignments.push({ date, route_id, employee_id });
  workingSchedules.push({
    date,
    route_id,
    employee_id,
    label: null,
    assignment_type: 'route',
    user_id,
  });
};

const buildLockedRouteSlots = (schedules) =>
  new Set(
    schedules
      .filter((s) => s.route_id)
      .map((s) => `${s.date}|${s.route_id}`)
  );

const isRouteSlotLocked = (date, routeId, lockedRouteSlots) =>
  lockedRouteSlots.has(`${date}|${routeId}`);

const getWeekDriverFromExisting = (routeId, dates, schedules) => {
  const counts = {};
  for (const date of dates) {
    const existing = findRouteAssignment(date, routeId, schedules);
    if (existing) {
      const id = existing.employee_id.toString();
      counts[id] = (counts[id] || 0) + 1;
    }
  }
  const entries = Object.entries(counts);
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
};

const sortRoutesForDayFill = (routes) =>
  sortRoutesByAssignmentPriority(routes).sort((a, b) => {
    const mandatoryA = routeRequiresStaffing(a) ? 0 : 1;
    const mandatoryB = routeRequiresStaffing(b) ? 0 : 1;
    return mandatoryA - mandatoryB;
  });

const pickBestEmployeeForRoute = ({
  route,
  routes,
  employees,
  date,
  day,
  workingSchedules,
  month,
  year,
  preferEmployeeId = null,
}) => {
  const candidates = employees.filter((emp) =>
    canEmployeeTakeRouteOnDay(emp, route, routes, date, workingSchedules, month, year)
  );

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    if (preferEmployeeId) {
      const aPref = a.id.toString() === preferEmployeeId.toString() ? 0 : 1;
      const bPref = b.id.toString() === preferEmployeeId.toString() ? 0 : 1;
      if (aPref !== bPref) return aPref - bPref;
    }

    const slotsA = getEmployeeRouteSlotCountOnDay(a.id, date, workingSchedules, routes);
    const slotsB = getEmployeeRouteSlotCountOnDay(b.id, date, workingSchedules, routes);
    if (slotsA !== slotsB) return slotsA - slotsB;

    return compareEmployeesForAutoFill(a, b, route, routes, {
      schedules: workingSchedules,
      date,
      day,
      month,
      year,
    });
  });

  return candidates[0];
};

const assignDriverToRouteOnDay = ({
  route,
  pairRoute,
  date,
  employee,
  employees,
  routes,
  workingSchedules,
  assignments,
  user_id,
  month,
  year,
}) => {
  if (!employee) return false;

  const existingPairAssignment = pairRoute
    ? findRouteAssignment(date, pairRoute.id, workingSchedules)
    : null;

  if (existingPairAssignment) {
    const pairedEmployee = employees.find(
      (e) => e.id.toString() === existingPairAssignment.employee_id.toString()
    );
    if (
      pairedEmployee &&
      canEmployeeTakeRouteOnDay(pairedEmployee, route, routes, date, workingSchedules, month, year)
    ) {
      pushAssignment(assignments, workingSchedules, {
        date,
        route_id: route.id,
        employee_id: pairedEmployee.id,
        user_id,
      });
      return true;
    }
    return false;
  }

  if (!canEmployeeTakeRouteOnDay(employee, route, routes, date, workingSchedules, month, year)) {
    return false;
  }

  pushAssignment(assignments, workingSchedules, {
    date,
    route_id: route.id,
    employee_id: employee.id,
    user_id,
  });

  if (pairRoute && !findRouteAssignment(date, pairRoute.id, workingSchedules)) {
    pushAssignment(assignments, workingSchedules, {
      date,
      route_id: pairRoute.id,
      employee_id: employee.id,
      user_id,
    });
  }

  return true;
};

/**
 * 1) Kierowcy bez trasy dostają po jednej trasie (wg etatu godzin).
 * 2) Pozostałe obowiązkowe trasy — wolni kierowcy.
 * 3) Opcjonalne trasy — tylko jeśli są wolni ludzie.
 * Nigdy druga trasa tego samego dnia (para = wyjątek).
 */
const fillDay = ({
  date,
  employees,
  routes,
  workingSchedules,
  assignments,
  user_id,
  weekDriverByRoute,
  lockedRouteSlots,
  month,
  year,
}) => {
  const day = parseInt(date.split('-')[2], 10);
  const sortedRoutes = sortRoutesForDayFill(routes).filter((route) =>
    isRouteOperatingOnDate(route, date)
  );

  const tryAssignRoute = (route, employee) => {
    if (!employee) return false;
    if (findRouteAssignment(date, route.id, workingSchedules)) return false;
    if (isRouteSlotLocked(date, route.id, lockedRouteSlots)) return false;

    const pairRoute = findPairRoute(route, routes);
    if (pairRoute && findRouteAssignment(date, pairRoute.id, workingSchedules)) {
      const existingPair = findRouteAssignment(date, pairRoute.id, workingSchedules);
      const pairedEmployee = employees.find(
        (e) => e.id.toString() === existingPair.employee_id.toString()
      );
      return assignDriverToRouteOnDay({
        route,
        pairRoute,
        date,
        employee: pairedEmployee,
        employees,
        routes,
        workingSchedules,
        assignments,
        user_id,
        month,
        year,
      });
    }

    const ok = assignDriverToRouteOnDay({
      route,
      pairRoute,
      date,
      employee,
      employees,
      routes,
      workingSchedules,
      assignments,
      user_id,
      month,
      year,
    });
    if (ok && !weekDriverByRoute.has(route.id.toString())) {
      weekDriverByRoute.set(route.id.toString(), employee.id.toString());
    }
    return ok;
  };

  const employeesNeedingRoute = employees
    .filter(
      (emp) =>
        getEmployeeRouteSlotCountOnDay(emp.id, date, workingSchedules, routes) === 0 &&
        !hasEmployeeLabelOnDay(emp.id, date, workingSchedules)
    )
    .sort((a, b) =>
      getHoursRatio(a, workingSchedules, routes, month, year) -
      getHoursRatio(b, workingSchedules, routes, month, year)
    );

  for (const emp of employeesNeedingRoute) {
    const openRoutes = sortedRoutes.filter(
      (route) =>
        routeRequiresStaffing(route) &&
        !findRouteAssignment(date, route.id, workingSchedules) &&
        !isRouteSlotLocked(date, route.id, lockedRouteSlots) &&
        canEmployeeTakeRouteOnDay(emp, route, routes, date, workingSchedules, month, year)
    );
    if (!openRoutes.length) continue;
    tryAssignRoute(openRoutes[0], emp);
  }

  for (const route of sortedRoutes) {
    if (!routeRequiresStaffing(route)) continue;
    if (findRouteAssignment(date, route.id, workingSchedules)) continue;
    if (isRouteSlotLocked(date, route.id, lockedRouteSlots)) continue;

    const preferEmployeeId = weekDriverByRoute.get(route.id.toString()) || null;
    const employee = pickBestEmployeeForRoute({
      route,
      routes,
      employees,
      date,
      day,
      workingSchedules,
      month,
      year,
      preferEmployeeId,
    });
    tryAssignRoute(route, employee);
  }

  for (const route of sortedRoutes) {
    if (routeRequiresStaffing(route)) continue;
    if (findRouteAssignment(date, route.id, workingSchedules)) continue;
    if (isRouteSlotLocked(date, route.id, lockedRouteSlots)) continue;

    const employee = pickBestEmployeeForRoute({
      route,
      routes,
      employees,
      date,
      day,
      workingSchedules,
      month,
      year,
      preferEmployeeId: weekDriverByRoute.get(route.id.toString()) || null,
    });
    tryAssignRoute(route, employee);
  }
};

function generateAutoFillAssignments({ employees, routes, schedules, month, year, user_id }) {
  const assignments = [];
  const workingSchedules = schedules.map((s) => ({ ...s }));
  const lockedRouteSlots = buildLockedRouteSlots(schedules);
  const weeks = getWeeksInMonth(month, year);

  for (const { dates } of weeks) {
    const weekDriverByRoute = new Map();

    for (const route of routes) {
      const existingDriver = getWeekDriverFromExisting(route.id, dates, workingSchedules);
      if (existingDriver) {
        weekDriverByRoute.set(route.id.toString(), existingDriver);
      }
    }

    for (const date of dates) {
      fillDay({
        date,
        employees,
        routes,
        workingSchedules,
        assignments,
        user_id,
        weekDriverByRoute,
        lockedRouteSlots,
        month,
        year,
      });
    }
  }

  const labelAssignments = generateDw5Proposals(workingSchedules, user_id, routes);

  return { routeAssignments: assignments, labelAssignments };
}

module.exports = {
  generateAutoFillAssignments,
  compareEmployeesForAutoFill,
  getWeeksInMonth,
  fillDay,
  buildLockedRouteSlots,
  canEmployeeTakeRouteOnDay,
};
