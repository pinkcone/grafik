const { findPairRoute, canAssignEmployeeToRouteWithPair } = require('./routeAssignment');
const { isRouteOperatingOnDate } = require('./routeOperatingDays');
const {
  generateDw5Proposals,
  isSaturday,
  planSaturdayDw5Package,
} = require('./scheduleRules');
const { hasEmployeeLabelOnDay } = require('./scheduleLabels');
const { canEmployeeHaveAnotherRouteOnDay } = require('./scheduleConstraints');
const { canEmployeeTakeRouteOnDay, buildInitialSnapshot } = require('./scheduleAutoFill');

const daysInMonth = (month, year) => new Date(year, month, 0).getDate();

const buildDate = (year, month, day) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const findRouteAssignment = (date, routeId, schedules) =>
  schedules.find((s) => s.date === date && s.route_id?.toString() === routeId.toString());

const pushRouteAssignment = (assignments, workingSchedules, { date, route_id, employee_id, user_id }) => {
  if (hasEmployeeLabelOnDay(employee_id, date, workingSchedules)) return false;
  assignments.push({ date, route_id, employee_id, user_id });
  workingSchedules.push({
    date,
    route_id,
    employee_id,
    label: null,
    assignment_type: 'route',
    user_id,
  });
  return true;
};

function generateMonthRouteAssignments({
  employee,
  route,
  routes,
  schedules,
  month,
  year,
  user_id,
  employees = [],
}) {
  const routeAssignments = [];
  const labelAssignments = [];
  const workingSchedules = schedules.map((s) => ({ ...s }));
  const pairRoute = findPairRoute(route, routes);
  const dim = daysInMonth(month, year);
  const employeeCount = employees.length > 0 ? employees.length : 1;
  const { initialEmployeeDays } = buildInitialSnapshot(schedules);
  const routeOptions = { employeeCount, initialEmployeeDays, skipDw5Check: true };

  for (let day = 1; day <= dim; day++) {
    const date = buildDate(year, month, day);
    if (!isRouteOperatingOnDate(route, date)) continue;
    if (findRouteAssignment(date, route.id, workingSchedules)) continue;
    if (hasEmployeeLabelOnDay(employee.id, date, workingSchedules)) continue;
    if (!canEmployeeHaveAnotherRouteOnDay(employee.id, route.id, date, workingSchedules, routes)) {
      continue;
    }
    if (!canEmployeeTakeRouteOnDay(
      employee,
      route,
      routes,
      date,
      workingSchedules,
      month,
      year,
      routeOptions
    )) {
      continue;
    }

    let saturdayPkg = null;
    if (isSaturday(date)) {
      saturdayPkg = planSaturdayDw5Package(
        date,
        employee.id,
        workingSchedules,
        routes,
        employeeCount,
        user_id,
        { initialEmployeeDays }
      );
    }

    if (!pushRouteAssignment(routeAssignments, workingSchedules, {
      date,
      route_id: route.id,
      employee_id: employee.id,
      user_id,
    })) {
      continue;
    }

    if (pairRoute && !findRouteAssignment(date, pairRoute.id, workingSchedules)) {
      if (
        canAssignEmployeeToRouteWithPair(employee, pairRoute, routes, date, workingSchedules) &&
        canEmployeeHaveAnotherRouteOnDay(employee.id, pairRoute.id, date, workingSchedules, routes, {
          allowPairLeg: true,
        })
      ) {
        pushRouteAssignment(routeAssignments, workingSchedules, {
          date,
          route_id: pairRoute.id,
          employee_id: employee.id,
          user_id,
        });
      }
    }

    if (saturdayPkg) {
      labelAssignments.push(saturdayPkg.labelProposal);
      workingSchedules.push(saturdayPkg.scheduleEntry);
    }
  }

  const extraLabels = generateDw5Proposals(workingSchedules, user_id, routes, employeeCount);
  labelAssignments.push(...extraLabels);

  return { routeAssignments, labelAssignments };
}

module.exports = {
  generateMonthRouteAssignments,
};
