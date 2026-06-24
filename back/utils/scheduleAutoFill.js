const {
  findPairRoute,
  canAssignEmployeeToRouteWithPair,
  sortRoutesByAssignmentPriority,
  compareEmployeesForRoute,
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

const hasLabelOnDay = (employeeId, date, schedules) =>
  schedules.some(
    (s) =>
      s.employee_id?.toString() === employeeId.toString() &&
      s.date === date &&
      s.label
  );

const isEmployeeBusyOnDay = (employeeId, date, schedules, routes, routeIdForPair) => {
  const pairIds = new Set(getPairRouteIdsIncludingSelf(routeIdForPair, routes).map(String));

  return schedules.some((s) => {
    if (s.date !== date || !s.route_id) return false;
    if (s.employee_id?.toString() !== employeeId.toString()) return false;
    return !pairIds.has(s.route_id.toString());
  });
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
  if (!canAssignEmployeeToRouteWithPair(employee, route, routes, date)) return false;
  if (hasLabelOnDay(employee.id, date, schedules)) return false;
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

const pickWeekDriver = ({
  route,
  routes,
  employees,
  operatingDates,
  workingSchedules,
}) => {
  const emptyDates = operatingDates.filter(
    (date) => !findRouteAssignment(date, route.id, workingSchedules)
  );
  if (!emptyDates.length) return null;

  const referenceDate = emptyDates[0];
  const referenceDay = parseInt(referenceDate.split('-')[2], 10);

  const candidates = employees.filter((emp) =>
    emptyDates.some((date) =>
      canEmployeeTakeRouteOnDay(emp, route, routes, date, workingSchedules)
    )
  );

  if (!candidates.length) return null;

  candidates.sort((a, b) =>
    compareEmployeesForAutoFill(a, b, route, routes, {
      schedules: workingSchedules,
      date: referenceDate,
      day: referenceDay,
    })
  );

  return candidates[0];
};

const pickSubstituteForDay = ({
  route,
  routes,
  employees,
  date,
  day,
  workingSchedules,
  excludeEmployeeId = null,
}) => {
  const candidates = employees.filter((emp) => {
    if (excludeEmployeeId && emp.id.toString() === excludeEmployeeId.toString()) return false;
    return canEmployeeTakeRouteOnDay(emp, route, routes, date, workingSchedules);
  });

  if (!candidates.length) return null;

  candidates.sort((a, b) =>
    compareEmployeesForAutoFill(a, b, route, routes, {
      schedules: workingSchedules,
      date,
      day,
    })
  );

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
 * Wypełnia trasę w danym tygodniu jednym kierowcą na wszystkie dni kursowania,
 * o ile to możliwe. Dni z „wolnym” lub konfliktem dostają zastępcę tylko na ten dzień.
 */
const fillRouteForWeek = ({
  route,
  pairRoute,
  dates,
  employees,
  routes,
  workingSchedules,
  assignments,
  user_id,
}) => {
  const operatingDates = dates.filter((date) => isRouteOperatingOnDate(route, date));
  if (!operatingDates.length) return;

  const existingWeekDriverId = getWeekDriverFromExisting(route.id, operatingDates, workingSchedules);
  let weekDriver = existingWeekDriverId
    ? employees.find((e) => e.id.toString() === existingWeekDriverId.toString())
    : null;

  if (!weekDriver) {
    weekDriver = pickWeekDriver({
      route,
      routes,
      employees,
      operatingDates,
      workingSchedules,
    });
  }

  for (const date of operatingDates) {
    if (findRouteAssignment(date, route.id, workingSchedules)) continue;

    const day = parseInt(date.split('-')[2], 10);
    let assigned = false;

    if (weekDriver) {
      assigned = assignDriverToRouteOnDay({
        route,
        pairRoute,
        date,
        employee: weekDriver,
        employees,
        routes,
        workingSchedules,
        assignments,
        user_id,
      });
    }

    if (!assigned) {
      const substitute = pickSubstituteForDay({
        route,
        routes,
        employees,
        date,
        day,
        workingSchedules,
        excludeEmployeeId: weekDriver?.id,
      });

      if (substitute) {
        assignDriverToRouteOnDay({
          route,
          pairRoute,
          date,
          employee: substitute,
          employees,
          routes,
          workingSchedules,
          assignments,
          user_id,
        });
      }
    }
  }
};

/**
 * Proponuje przypisania tras na puste sloty.
 * Tydzień po tygodniu — ten sam kierowca na tej samej trasie przez cały tydzień,
 * z zastępstwem w dniach wolnych lub niedostępnych.
 */
function generateAutoFillAssignments({ employees, routes, schedules, month, year, user_id }) {
  const assignments = [];
  const workingSchedules = schedules.map((s) => ({ ...s }));
  const sortedRoutes = sortRoutesByAssignmentPriority(routes);
  const weeks = getWeeksInMonth(month, year);

  for (const { dates } of weeks) {
    for (const route of sortedRoutes) {
      fillRouteForWeek({
        route,
        pairRoute: findPairRoute(route, routes),
        dates,
        employees,
        routes,
        workingSchedules,
        assignments,
        user_id,
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
  getWeeksInMonth,
  fillRouteForWeek,
  pickWeekDriver,
};
