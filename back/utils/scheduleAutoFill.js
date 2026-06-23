const {
  findPairRoute,
  canAssignEmployeeToRouteWithPair,
  sortRoutesByAssignmentPriority,
  compareEmployeesForRoute,
} = require('./routeAssignment');

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

/**
 * Proponuje przypisania tras na puste sloty.
 * Kolejność tras: najpierw C+SP, potem C, potem SP, na końcu zwykłe B.
 * Na trasach wymagających — „rzadcy” kierowcy; na B — oszczędzamy C/SP.
 */
function generateAutoFillAssignments({ employees, routes, schedules, month, year, user_id }) {
  const assignments = [];
  const workingSchedules = schedules.map((s) => ({ ...s }));
  const sortedRoutes = sortRoutesByAssignmentPriority(routes);
  const dim = daysInMonth(month, year);

  for (const route of sortedRoutes) {
    const pairRoute = findPairRoute(route, routes);

    for (let day = 1; day <= dim; day++) {
      const date = buildDate(year, month, day);

      if (findRouteAssignment(date, route.id, workingSchedules)) continue;

      const existingPairAssignment = pairRoute
        ? findRouteAssignment(date, pairRoute.id, workingSchedules)
        : null;

      if (existingPairAssignment) {
        const pairedEmployee = employees.find(
          (e) => e.id.toString() === existingPairAssignment.employee_id.toString()
        );
        if (
          pairedEmployee &&
          canAssignEmployeeToRouteWithPair(pairedEmployee, route, routes) &&
          !hasLabelOnDay(pairedEmployee.id, date, workingSchedules)
        ) {
          pushAssignment(assignments, workingSchedules, {
            date,
            route_id: route.id,
            employee_id: pairedEmployee.id,
            user_id,
          });
        }
        continue;
      }

      const candidates = employees.filter((emp) => {
        if (!canAssignEmployeeToRouteWithPair(emp, route, routes)) return false;
        if (hasLabelOnDay(emp.id, date, workingSchedules)) return false;
        if (isEmployeeBusyOnDay(emp.id, date, workingSchedules, routes, route.id)) return false;
        return true;
      });

      candidates.sort((a, b) => compareEmployeesForRoute(a, b, route, routes));

      const picked = candidates[0];
      if (!picked) continue;

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
    }
  }

  return assignments;
}

module.exports = {
  generateAutoFillAssignments,
};
