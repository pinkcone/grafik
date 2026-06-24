const {
  findPairRoute,
  canAssignEmployeeToRouteWithPair,
  sortRoutesByAssignmentPriority,
  compareEmployeesForRoute,
  routeRequiresStaffing,
} = require('./routeAssignment');
const { isRouteOperatingOnDate } = require('./routeOperatingDays');
const { generateDw5Proposals } = require('./scheduleRules');

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

const getPairRouteIdsIncludingSelf = (routeId, routes) => {
  const idStr = routeId.toString();
  const rt = routes.find((r) => r.id.toString() === idStr);
  if (!rt) return [idStr];

  const pair = new Set([idStr]);
  if (rt.linked_route_id != null) {
    pair.add(rt.linked_route_id.toString());
  }
  routes.forEach((r) => {
    if (r.linked_route_id != null && r.linked_route_id.toString() === idStr) {
      pair.add(r.id.toString());
    }
  });
  return Array.from(pair);
};

const findRouteAssignment = (date, routeId, schedules) =>
  schedules.find((s) => s.date === date && s.route_id?.toString() === routeId.toString());

const isEmployeeBusyOnDay = (employeeId, date, schedules, routes, routeIdForPair) => {
  const pairIds = new Set(getPairRouteIdsIncludingSelf(routeIdForPair, routes).map(String));

  return schedules.some((s) => {
    if (s.date !== date || !s.route_id) return false;
    if (s.employee_id?.toString() !== employeeId.toString()) return false;
    return !pairIds.has(s.route_id.toString());
  });
};

/** Liczba „zajęć” kierowcy w danym dniu (para tras = 1 zajęcie) */
const getEmployeeAssignmentCountOnDay = (employeeId, date, schedules, routes) => {
  const routeIds = schedules
    .filter(
      (s) =>
        s.date === date &&
        s.employee_id?.toString() === employeeId.toString() &&
        s.route_id
    )
    .map((s) => s.route_id.toString());

  const seenPairs = new Set();
  let count = 0;
  for (const rid of routeIds) {
    const pairKey = getPairRouteIdsIncludingSelf(rid, routes).sort().join('-');
    if (!seenPairs.has(pairKey)) {
      seenPairs.add(pairKey);
      count += 1;
    }
  }
  return count;
};

const countEmployeeRouteDays = (employeeId, routeId, schedules, routes) => {
  const pairIds = new Set(getPairRouteIdsIncludingSelf(routeId, routes).map(String));
  return schedules.filter(
    (s) =>
      s.employee_id?.toString() === employeeId.toString() &&
      s.route_id &&
      pairIds.has(s.route_id.toString())
  ).length;
};

const droveRouteYesterday = (employeeId, routeId, date, schedules, routes) => {
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

const canEmployeeTakeRouteOnDay = (employee, route, routes, date, schedules) => {
  if (!employee) return false;
  if (!canAssignEmployeeToRouteWithPair(employee, route, routes, date, schedules)) return false;
  if (isEmployeeBusyOnDay(employee.id, date, schedules, routes, route.id)) return false;
  return true;
};

const compareEmployeesForAutoFill = (employeeA, employeeB, route, routes, { schedules, date, day }) => {
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

const pickBestEmployeeForRoute = ({
  route,
  routes,
  employees,
  date,
  day,
  workingSchedules,
  requireNoRouteOnDay,
  preferEmployeeId = null,
}) => {
  let candidates = employees.filter((emp) => {
    if (!canEmployeeTakeRouteOnDay(emp, route, routes, date, workingSchedules)) return false;
    if (
      requireNoRouteOnDay &&
      getEmployeeAssignmentCountOnDay(emp.id, date, workingSchedules, routes) > 0
    ) {
      return false;
    }
    return true;
  });

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    if (preferEmployeeId) {
      const aPref = a.id.toString() === preferEmployeeId.toString() ? 0 : 1;
      const bPref = b.id.toString() === preferEmployeeId.toString() ? 0 : 1;
      if (aPref !== bPref) return aPref - bPref;
    }

    const dayCountA = getEmployeeAssignmentCountOnDay(a.id, date, workingSchedules, routes);
    const dayCountB = getEmployeeAssignmentCountOnDay(b.id, date, workingSchedules, routes);
    if (dayCountA !== dayCountB) return dayCountA - dayCountB;

    return compareEmployeesForAutoFill(a, b, route, routes, {
      schedules: workingSchedules,
      date,
      day,
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
      canEmployeeTakeRouteOnDay(pairedEmployee, route, routes, date, workingSchedules)
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

  if (!canEmployeeTakeRouteOnDay(employee, route, routes, date, workingSchedules)) {
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
 * Dzień po dniu, dwie fazy:
 * 1) każdy kierowca max 1 trasa — najpierw rozdajemy po jednej,
 * 2) zostają puste sloty — dopiero wtedy dokładamy drugie trasy.
 * Zablokowane (ręczne) sloty tras nie są ruszane.
 */
const sortRoutesForDayFill = (routes) =>
  sortRoutesByAssignmentPriority(routes).sort((a, b) => {
    const mandatoryA = routeRequiresStaffing(a) ? 0 : 1;
    const mandatoryB = routeRequiresStaffing(b) ? 0 : 1;
    return mandatoryA - mandatoryB;
  });

const fillDay = ({
  date,
  employees,
  routes,
  workingSchedules,
  assignments,
  user_id,
  weekDriverByRoute,
  lockedRouteSlots,
}) => {
  const day = parseInt(date.split('-')[2], 10);
  const sortedRoutes = sortRoutesForDayFill(routes).filter((route) =>
    isRouteOperatingOnDate(route, date)
  );

  const tryFillRoutes = (requireNoRouteOnDay) => {
    for (const route of sortedRoutes) {
      if (findRouteAssignment(date, route.id, workingSchedules)) continue;
      if (isRouteSlotLocked(date, route.id, lockedRouteSlots)) continue;

      const pairRoute = findPairRoute(route, routes);
      if (pairRoute && findRouteAssignment(date, pairRoute.id, workingSchedules)) {
        const existingPair = findRouteAssignment(date, pairRoute.id, workingSchedules);
        const pairedEmployee = employees.find(
          (e) => e.id.toString() === existingPair.employee_id.toString()
        );
        if (pairedEmployee && !isRouteSlotLocked(date, route.id, lockedRouteSlots)) {
          assignDriverToRouteOnDay({
            route,
            pairRoute,
            date,
            employee: pairedEmployee,
            employees,
            routes,
            workingSchedules,
            assignments,
            user_id,
          });
        }
        continue;
      }

      const preferEmployeeId = weekDriverByRoute.get(route.id.toString()) || null;
      const employee = pickBestEmployeeForRoute({
        route,
        routes,
        employees,
        date,
        day,
        workingSchedules,
        requireNoRouteOnDay,
        preferEmployeeId,
      });

      if (
        employee &&
        assignDriverToRouteOnDay({
          route,
          pairRoute,
          date,
          employee,
          employees,
          routes,
          workingSchedules,
          assignments,
          user_id,
        }) &&
        !weekDriverByRoute.has(route.id.toString())
      ) {
        weekDriverByRoute.set(route.id.toString(), employee.id.toString());
      }
    }
  };

  tryFillRoutes(true);
  tryFillRoutes(false);
};

/**
 * Proponuje przypisania tras na puste sloty.
 * Szanuje ręczne wpisy — nie nadpisuje i nie usuwa istniejących przypisań.
 */
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
      });
    }
  }

  const labelAssignments = generateDw5Proposals(workingSchedules, user_id, routes);

  return { routeAssignments: assignments, labelAssignments };
}

module.exports = {
  generateAutoFillAssignments,
  countEmployeeRouteDays,
  compareEmployeesForAutoFill,
  getEmployeeAssignmentCountOnDay,
  getWeeksInMonth,
  fillDay,
  buildLockedRouteSlots,
};
