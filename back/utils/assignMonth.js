const { findPairRoute, canAssignEmployeeToRouteWithPair } = require('./routeAssignment');
const { isRouteOperatingOnDate } = require('./routeOperatingDays');
const { generateDw5Proposals } = require('./scheduleRules');
const { hasEmployeeLabelOnDay } = require('./scheduleLabels');
const { canEmployeeHaveAnotherRouteOnDay } = require('./scheduleConstraints');
const { wouldExceedTargetHours } = require('./scheduleHours');
const { canEmployeeTakeRouteOnDay } = require('./scheduleAutoFill');

const daysInMonth = (month, year) => new Date(year, month, 0).getDate();

const buildDate = (year, month, day) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const findRouteAssignment = (date, routeId, schedules) =>
  schedules.find((s) => s.date === date && s.route_id?.toString() === routeId.toString());

const pushRouteAssignment = (assignments, workingSchedules, { date, route_id, employee_id, user_id }) => {
  assignments.push({ date, route_id, employee_id, user_id });
  workingSchedules.push({
    date,
    route_id,
    employee_id,
    label: null,
    assignment_type: 'route',
    user_id,
  });
};

function generateMonthRouteAssignments({
  employee,
  route,
  routes,
  schedules,
  month,
  year,
  user_id,
}) {
  const routeAssignments = [];
  const workingSchedules = schedules.map((s) => ({ ...s }));
  const pairRoute = findPairRoute(route, routes);
  const dim = daysInMonth(month, year);

  for (let day = 1; day <= dim; day++) {
    const date = buildDate(year, month, day);
    if (!isRouteOperatingOnDate(route, date)) continue;
    if (findRouteAssignment(date, route.id, workingSchedules)) continue;
    if (hasEmployeeLabelOnDay(employee.id, date, workingSchedules)) continue;
    if (!canEmployeeHaveAnotherRouteOnDay(employee.id, route.id, date, workingSchedules, routes)) {
      continue;
    }
    if (!canEmployeeTakeRouteOnDay(employee, route, routes, date, workingSchedules, month, year)) {
      continue;
    }

    pushRouteAssignment(routeAssignments, workingSchedules, {
      date,
      route_id: route.id,
      employee_id: employee.id,
      user_id,
    });

    if (pairRoute && !findRouteAssignment(date, pairRoute.id, workingSchedules)) {
      if (
        canAssignEmployeeToRouteWithPair(employee, pairRoute, routes, date, workingSchedules) &&
        !hasEmployeeLabelOnDay(employee.id, date, workingSchedules) &&
        canEmployeeHaveAnotherRouteOnDay(employee.id, pairRoute.id, date, workingSchedules, routes) &&
        !wouldExceedTargetHours(employee, pairRoute, workingSchedules, routes, month, year)
      ) {
        pushRouteAssignment(routeAssignments, workingSchedules, {
          date,
          route_id: pairRoute.id,
          employee_id: employee.id,
          user_id,
        });
      }
    }
  }

  const labelAssignments = generateDw5Proposals(workingSchedules, user_id, routes);

  return { routeAssignments, labelAssignments };
}

module.exports = {
  generateMonthRouteAssignments,
};
