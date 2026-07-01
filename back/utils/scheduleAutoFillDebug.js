const {
  getAssignmentBlockReason,
  findPairRoute,
  canAssignEmployeeToRouteWithPair,
} = require('./routeAssignment');
const { hasEmployeeLabelOnDay } = require('./scheduleLabels');
const { getEmployeeRouteSlotCountOnDay } = require('./scheduleConstraints');
const { isRouteOperatingOnDate } = require('./routeOperatingDays');
const {
  getTargetMonthHours,
  getTargetQuarterHours,
  getEmployeeMonthHours,
  getQuarterMonths,
  getEmployeePartTime,
} = require('./scheduleHours');
const { isSaturday, getSaturdayDw5BlockReason } = require('./scheduleRules');

const employeeDayKey = (date, employeeId) => `${date}|${employeeId}`;

const findRouteAssignment = (date, routeId, schedules) =>
  schedules.find((s) => s.date === date && s.route_id?.toString() === routeId.toString());

const listWeekdaysInMonth = (month, year) => {
  const dim = new Date(year, month, 0).getDate();
  const dates = [];
  for (let d = 1; d <= dim; d++) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const wd = new Date(`${date}T12:00:00`).getDay();
    if (wd >= 1 && wd <= 5) dates.push(date);
  }
  return dates;
};

const employeeDisplayName = (employee) => {
  if (!employee) return '?';
  const name = `${employee.last_name || ''} ${employee.first_name || ''}`.trim();
  return name || `#${employee.id}`;
};

const getQuarterHourGapForSchedules = (employee, schedules, quarterSchedules, routes, month, year) => {
  const target = getTargetQuarterHours(employee, month, year);
  let current = 0;
  for (const m of getQuarterMonths(month)) {
    const scheds = m === month ? schedules : quarterSchedules || [];
    current += getEmployeeMonthHours(employee.id, scheds, routes, m, year);
  }
  return target - current;
};

const explainRouteForEmployee = (employee, route, date, schedules, routes, options = {}) => {
  const reasons = [];
  const { initialEmployeeDays, employeeCount = 0 } = options;

  if (initialEmployeeDays?.has?.(employeeDayKey(date, employee.id))) {
    reasons.push('Dzień zamrożony (ręczny wpis przed auto-fill)');
  }
  if (hasEmployeeLabelOnDay(employee.id, date, schedules)) {
    reasons.push('Pracownik ma etykietę tego dnia');
  }

  const taken = findRouteAssignment(date, route.id, schedules);
  if (taken && taken.employee_id?.toString() !== employee.id.toString()) {
    reasons.push(`Trasa zajęta przez innego kierowcę (#${taken.employee_id})`);
  }

  if (!isRouteOperatingOnDate(route, date)) {
    reasons.push('Trasa nie kursuje tego dnia');
  }

  if (!canAssignEmployeeToRouteWithPair(employee, route, routes, date, schedules)) {
    const block = getAssignmentBlockReason(employee, route, {
      pairedRoute: findPairRoute(route, routes),
      date,
      schedules,
      allRoutes: routes,
    });
    if (block) reasons.push(block);
    else reasons.push('Nie spełnia wymagań trasy (para/uprawnienia)');
  }

  if (
    isSaturday(date) &&
    employeeCount > 0 &&
    !options.skipDw5Check
  ) {
    const dw5 = getSaturdayDw5BlockReason(
      employee,
      date,
      schedules,
      routes,
      employeeCount,
      { initialEmployeeDays }
    );
    if (dw5) reasons.push(dw5);
  }

  return reasons;
};

/**
 * Raport luk w grafiku — puste dni pracowników, wolne trasy, deficyty godzin.
 */
const buildScheduleGapReport = ({
  employees = [],
  routes = [],
  schedules = [],
  quarterSchedules = [],
  month,
  year,
  initialEmployeeDays = null,
  title = 'Diagnostyka grafiku',
  employeeCount = 0,
}) => {
  const logs = [];
  const emptyCells = [];
  const openRouteSlots = [];
  const underHourEmployees = [];
  const weekdays = listWeekdaysInMonth(month, year);

  logs.push(`=== ${title} ===`);
  logs.push(`Miesiąc ${month}/${year}, pracowników: ${employees.length}, tras: ${routes.length}`);

  for (const emp of employees) {
    const monthTarget = getTargetMonthHours(emp, month, year);
    const monthHours = getEmployeeMonthHours(emp.id, schedules, routes, month, year);
    const monthGap = monthTarget - monthHours;
    const quarterGap = getQuarterHourGapForSchedules(
      emp,
      schedules,
      quarterSchedules,
      routes,
      month,
      year
    );

    if (monthGap > 2 || quarterGap > 2) {
      const emptyDays = weekdays.filter((date) => {
        if (hasEmployeeLabelOnDay(emp.id, date, schedules)) return false;
        return getEmployeeRouteSlotCountOnDay(emp.id, date, schedules, routes) === 0;
      }).length;

      underHourEmployees.push({
        employeeId: emp.id,
        employeeName: employeeDisplayName(emp),
        partTime: getEmployeePartTime(emp),
        monthHours: Math.round(monthHours * 100) / 100,
        monthTarget: Math.round(monthTarget * 100) / 100,
        monthGap: Math.round(monthGap * 100) / 100,
        quarterGap: Math.round(quarterGap * 100) / 100,
        emptyWeekdays: emptyDays,
      });
    }
  }

  if (underHourEmployees.length > 0) {
    logs.push('');
    logs.push('--- Deficyt godzin ---');
    for (const u of underHourEmployees.sort((a, b) => b.monthGap - a.monthGap)) {
      logs.push(
        `${u.employeeName}: brakuje ${u.monthGap}h (miesiąc ${u.monthHours}/${u.monthTarget}h), ` +
          `kwartał +${u.quarterGap}h, pustych dni roboczych: ${u.emptyWeekdays}`
      );
    }
  }

  logs.push('');
  logs.push('--- Puste dni pracowników (pn–pt) ---');

  for (const date of weekdays) {
    const dayNum = parseInt(date.split('-')[2], 10);
    const operatingRoutes = routes.filter((r) => isRouteOperatingOnDate(r, date));

    for (const emp of employees) {
      const hasLabel = hasEmployeeLabelOnDay(emp.id, date, schedules);
      const slotCount = getEmployeeRouteSlotCountOnDay(emp.id, date, schedules, routes);
      if (hasLabel || slotCount > 0) continue;

      const locked = initialEmployeeDays?.has?.(employeeDayKey(date, emp.id)) || false;
      const monthGap =
        getTargetMonthHours(emp, month, year) -
        getEmployeeMonthHours(emp.id, schedules, routes, month, year);
      const quarterGap = getQuarterHourGapForSchedules(
        emp,
        schedules,
        quarterSchedules,
        routes,
        month,
        year
      );

      const assignedToOthers = new Set(
        schedules
          .filter(
            (s) =>
              s.date === date &&
              s.route_id &&
              s.employee_id?.toString() !== emp.id.toString()
          )
          .map((s) => s.route_id.toString())
      );

      const routeChecks = operatingRoutes
        .filter((r) => !assignedToOthers.has(r.id.toString()))
        .map((r) => {
          const reasons = explainRouteForEmployee(emp, r, date, schedules, routes, {
            initialEmployeeDays,
            employeeCount,
          });
          return {
            routeId: r.id,
            routeName: r.name,
            canAssign: reasons.length === 0,
            reasons,
          };
        });

      const assignable = routeChecks.filter((r) => r.canAssign);
      let summary;
      if (locked) {
        summary = 'ZAMROŻONY (ręczny wpis) — auto-fill nie edytuje';
      } else if (assignable.length > 0) {
        summary = `PUSTY mimo ${assignable.length} tras dostępnych w dropdownie`;
      } else if (routeChecks.length > 0) {
        summary = 'PUSTY — trasy są, ale reguły blokują przypisanie';
      } else {
        summary = 'PUSTY — brak tras kursujących tego dnia';
      }

      const entry = {
        date,
        day: dayNum,
        employeeId: emp.id,
        employeeName: employeeDisplayName(emp),
        locked,
        monthGap: Math.round(monthGap * 100) / 100,
        quarterGap: Math.round(quarterGap * 100) / 100,
        assignableRouteCount: assignable.length,
        summary,
        assignableRoutes: assignable.slice(0, 6).map((r) => r.routeName),
        blockedSamples: routeChecks
          .filter((r) => !r.canAssign)
          .slice(0, 3)
          .map((r) => ({ route: r.routeName, reasons: r.reasons })),
      };

      emptyCells.push(entry);
      logs.push(
        `${date} (dz.${dayNum}) | ${entry.employeeName} | ${summary} | deficyt ${monthGap.toFixed(1)}h`
      );
      if (assignable.length > 0) {
        logs.push(`  ✓ możliwe: ${assignable.map((r) => r.routeName).join(' | ')}`);
      }
      for (const blocked of entry.blockedSamples) {
        logs.push(`  ✗ ${blocked.route}: ${blocked.reasons.join('; ')}`);
      }
    }

    const openRoutes = operatingRoutes.filter(
      (r) => !findRouteAssignment(date, r.id, schedules)
    );

    for (const route of openRoutes) {
      const eligible = employees.filter((emp) => {
        if (hasEmployeeLabelOnDay(emp.id, date, schedules)) return false;
        if (getEmployeeRouteSlotCountOnDay(emp.id, date, schedules, routes) > 0) return false;
        return (
          explainRouteForEmployee(emp, route, date, schedules, routes, {
            initialEmployeeDays,
            employeeCount,
          }).length === 0
        );
      });

      if (eligible.length === 0) {
        openRouteSlots.push({
          date,
          day: dayNum,
          routeId: route.id,
          routeName: route.name,
          eligibleCount: 0,
        });
        logs.push(`${date} | WOLNA TRASA „${route.name}” — 0 kierowców może jechać`);
      }
    }
  }

  const emptyWithRoutes = emptyCells.filter((c) => !c.locked && c.assignableRouteCount > 0);

  logs.push('');
  logs.push('--- Podsumowanie ---');
  logs.push(`Pustych dni pracowników: ${emptyCells.length}`);
  logs.push(`Pustych z dostępnymi trasami (bug?): ${emptyWithRoutes.length}`);
  logs.push(`Wolnych tras bez kierowcy: ${openRouteSlots.length}`);
  logs.push(`Pracowników z deficytem godzin: ${underHourEmployees.length}`);

  return {
    title,
    summary: {
      emptyEmployeeDays: emptyCells.length,
      emptyWithAssignableRoutes: emptyWithRoutes.length,
      openRouteSlots: openRouteSlots.length,
      underHourEmployees: underHourEmployees.length,
    },
    logs,
    emptyCells,
    openRouteSlots,
    underHourEmployees,
  };
};

/** Raport ze stanu ctx po zakończeniu algorytmu (pamięć). */
const buildAutoFillAlgorithmReport = (ctx) =>
  buildScheduleGapReport({
    employees: ctx.employees,
    routes: ctx.routes,
    schedules: ctx.workingSchedules,
    quarterSchedules: ctx.quarterSchedules,
    month: ctx.month,
    year: ctx.year,
    initialEmployeeDays: ctx.initialEmployeeDays,
    employeeCount: ctx.employees.length,
    title: 'Po algorytmie (pamięć, przed zapisem do bazy)',
  });

module.exports = {
  buildScheduleGapReport,
  buildAutoFillAlgorithmReport,
  explainRouteForEmployee,
};
