const {
  findPairRoute,
  canAssignEmployeeToRouteWithPair,
  sortRoutesByAssignmentPriority,
  compareEmployeesForRoute,
} = require('./routeAssignment');
const { isRouteOperatingOnDate } = require('./routeOperatingDays');

const daysInMonth = (month, year) => new Date(year, month, 0).getDate();

const buildDate = (year, month, day) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

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

const fillRouteOnDay = ({
  route,
  pairRoute,
  date,
  day,
  employees,
  routes,
  workingSchedules,
  assignments,
  user_id,
}) => {
  if (!isRouteOperatingOnDate(route, date)) return;

  if (findRouteAssignment(date, route.id, workingSchedules)) return;

  const existingPairAssignment = pairRoute
    ? findRouteAssignment(date, pairRoute.id, workingSchedules)
    : null;

  if (existingPairAssignment) {
    const pairedEmployee = employees.find(
      (e) => e.id.toString() === existingPairAssignment.employee_id.toString()
    );
    if (
      pairedEmployee &&
      canAssignEmployeeToRouteWithPair(pairedEmployee, route, routes, date) &&
      !hasLabelOnDay(pairedEmployee.id, date, workingSchedules)
    ) {
      pushAssignment(assignments, workingSchedules, {
        date,
        route_id: route.id,
        employee_id: pairedEmployee.id,
        user_id,
      });
    }
    return;
  }

  const candidates = employees.filter((emp) => {
    if (!canAssignEmployeeToRouteWithPair(emp, route, routes, date)) return false;
    if (hasLabelOnDay(emp.id, date, workingSchedules)) return false;
    if (isEmployeeBusyOnDay(emp.id, date, workingSchedules, routes, route.id)) return false;
    return true;
  });

  if (candidates.length === 0) return;

  candidates.sort((a, b) =>
    compareEmployeesForAutoFill(a, b, route, routes, {
      schedules: workingSchedules,
      date,
      day,
    })
  );

  const picked = candidates[0];

  pushAssignment(assignments, workingSchedules, {
    date,
    route_id: route.id,
    employee_id: picked.id,
    user_id,
  });

  if (pairRoute && !findRouteAssignment(date, pairRoute.id, workingSchedules)) {
    pushAssignment(assignments, workingSchedules, {
      date,
      route_id: pairRoute.id,
      employee_id: picked.id,
      user_id,
    });
  }
};

/**
 * Proponuje przypisania tras na puste sloty.
 * Dzień po dniu, w każdym dniu najpierw trasy C/SP, z rotacją kierowców.
 */
function generateAutoFillAssignments({ employees, routes, schedules, month, year, user_id }) {
  const assignments = [];
  const workingSchedules = schedules.map((s) => ({ ...s }));
  const sortedRoutes = sortRoutesByAssignmentPriority(routes);
  const dim = daysInMonth(month, year);

  for (let day = 1; day <= dim; day++) {
    const date = buildDate(year, month, day);

    for (const route of sortedRoutes) {
      fillRouteOnDay({
        route,
        pairRoute: findPairRoute(route, routes),
        date,
        day,
        employees,
        routes,
        workingSchedules,
        assignments,
        user_id,
      });
    }
  }

  return assignments;
}

module.exports = {
  generateAutoFillAssignments,
  countEmployeeRouteDays,
  compareEmployeesForAutoFill,
};
