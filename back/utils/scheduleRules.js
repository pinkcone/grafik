const { getIsoWeekday, isRouteOperatingOnDate } = require('./routeOperatingDays');
const { hasEmployeeLabelOnDay } = require('./scheduleLabels');

const DW5_LABEL_CODE = 'DW5';

const toBoolean = (value) => {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return false;
};

const hasSpecialPermissions = (value) => toBoolean(value);

const routeRequiresStaffing = (route) => {
  if (!route) return true;
  if (route.requires_staffing === undefined || route.requires_staffing === null) return true;
  return toBoolean(route.requires_staffing);
};

const parseWorkingHours = (wh) => {
  if (!wh) return null;
  if (typeof wh === 'object') return wh;
  try {
    return JSON.parse(wh);
  } catch {
    return null;
  }
};

const routeHasSegments = (route) => {
  const wh = parseWorkingHours(route?.working_hours);
  return !!(wh && Array.isArray(wh.segments) && wh.segments.length > 0);
};

const findRouteAssignment = (date, routeId, schedules) =>
  schedules.find((s) => s.date === date && s.route_id?.toString() === routeId.toString());

const isSaturday = (dateStr) => dateStr && getIsoWeekday(dateStr) === 6;

const buildDate = (year, month, day) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const addDays = (dateStr, days) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return buildDate(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
};

const getNextWeekMonday = (dateStr) => addDays(dateStr, 8 - getIsoWeekday(dateStr));

/** Kolejność: poniedziałek, piątek, wt–czw */
const getDw5CandidateWeekdays = (saturdayDate) => {
  const monday = getNextWeekMonday(saturdayDate);
  return [
    monday,
    addDays(monday, 4),
    addDays(monday, 1),
    addDays(monday, 2),
    addDays(monday, 3),
  ];
};

/** Trasy z requires_staffing=false (opcjonalne) nie wchodzą w licznik — mogą zostać puste. */
const countMandatoryOperatingRoutes = (date, routes) => {
  if (!Array.isArray(routes)) return 0;
  return routes.filter(
    (route) =>
      routeHasSegments(route) &&
      routeRequiresStaffing(route) &&
      isRouteOperatingOnDate(route, date)
  ).length;
};

/** Czy da się obsadzić wszystkie obowiązkowe trasy (opcjonalne ignorujemy). */
const isDayStructurallyStaffable = (date, routes, employeeCount) => {
  if (!employeeCount || employeeCount <= 0) return false;
  return countMandatoryOperatingRoutes(date, routes) <= employeeCount;
};

const hasEmployeeRouteOnDay = (employeeId, date, schedules) =>
  schedules.some(
    (s) =>
      s.employee_id?.toString() === employeeId.toString() &&
      s.date === date &&
      s.route_id
  );

const employeeDayKey = (date, employeeId) => `${date}|${employeeId}`;

const isEmployeeDayBlockedForDw5 = (employeeId, date, schedules, initialEmployeeDays = null) => {
  if (initialEmployeeDays?.has(employeeDayKey(date, employeeId))) return true;
  if (hasEmployeeRouteOnDay(employeeId, date, schedules)) return true;
  if (hasEmployeeLabelOnDay(employeeId, date, schedules)) return true;
  return false;
};

/**
 * Wybiera dzień DW5 w następnym tygodniu po sobocie.
 * pn → pt → wt → śr → czw.
 * Dzień musi być wykonalny: tylko trasy obowiązkowe ≤ liczba kierowców (opcjonalne nie liczą się).
 * Pracownik musi mieć ten dzień wolny.
 */
const pickDw5Date = (saturdayDate, employeeId, schedules, routes, employeeCount, options = {}) => {
  const { initialEmployeeDays = null } = options;
  const activeRoutes = routes.filter(routeHasSegments);
  const candidates = getDw5CandidateWeekdays(saturdayDate);

  for (const date of candidates) {
    if (!isDayStructurallyStaffable(date, activeRoutes, employeeCount)) continue;
    if (isEmployeeDayBlockedForDw5(employeeId, date, schedules, initialEmployeeDays)) continue;
    return date;
  }

  return null;
};

const hasDw5AfterSaturday = (employeeId, saturdayDate, schedules) => {
  const candidates = getDw5CandidateWeekdays(saturdayDate);
  return candidates.some((date) =>
    hasEmployeeLabelOnDay(employeeId, date, schedules, DW5_LABEL_CODE)
  );
};

const canAssignSaturdayRouteWithDw5 = (
  saturdayDate,
  employeeId,
  schedules,
  routes,
  employeeCount,
  options = {}
) => pickDw5Date(saturdayDate, employeeId, schedules, routes, employeeCount, options) != null;

const buildDw5LabelProposal = (dw5Date, employeeId, user_id) => ({
  date: dw5Date,
  employee_id: employeeId,
  route_id: null,
  label: DW5_LABEL_CODE,
  assignment_type: 'label',
  user_id,
});

const buildDw5ScheduleEntry = (dw5Date, employeeId, user_id) => ({
  date: dw5Date,
  employee_id: employeeId,
  route_id: null,
  label: DW5_LABEL_CODE,
  assignment_type: 'label',
  user_id,
});

/** Trasa sobotnia + DW5 to jeden pakiet — zwraca propozycję etykiety lub null */
const planSaturdayDw5Package = (
  saturdayDate,
  employeeId,
  schedules,
  routes,
  employeeCount,
  user_id,
  options = {}
) => {
  if (!isSaturday(saturdayDate)) return null;

  const dw5Date = pickDw5Date(
    saturdayDate,
    employeeId,
    schedules,
    routes,
    employeeCount,
    options
  );
  if (!dw5Date) return null;

  return {
    dw5Date,
    labelProposal: buildDw5LabelProposal(dw5Date, employeeId, user_id),
    scheduleEntry: buildDw5ScheduleEntry(dw5Date, employeeId, user_id),
  };
};

const getSaturdayAssignmentBlockReason = (employee, route, dateStr, labelPrefix = 'Trasa') => {
  if (!employee || !route || !dateStr || !isSaturday(dateStr)) return null;

  if (employee.license_category === 'C') {
    return 'Kierowcy z prawem jazdy kat. C nie jeżdżą w soboty.';
  }

  if (
    !hasSpecialPermissions(route.requires_special_permissions) &&
    hasSpecialPermissions(employee.special_permissions)
  ) {
    return `W sobotę na trasę bez wkładki (${labelPrefix} „${route.name}”) można przydzielić tylko pracownika bez specjalnych uprawnień.`;
  }

  return null;
};

const getSaturdayDw5BlockReason = (
  employee,
  saturdayDate,
  schedules,
  routes,
  employeeCount,
  options = {}
) => {
  if (!employee || !saturdayDate || !isSaturday(saturdayDate)) return null;

  if (
    canAssignSaturdayRouteWithDw5(
      saturdayDate,
      employee.id,
      schedules,
      routes,
      employeeCount,
      options
    )
  ) {
    return null;
  }

  return (
    'Brak wolnego dnia na DW5 w następnym tygodniu (pn → pt → inny dzień roboczy). ' +
    'Trasa sobotnia wymaga DW5 — nie można przypisać samej trasy.'
  );
};

/** Uzupełnia DW5 dla sobot z trasą, które jeszcze nie mają powiązanego DW5 */
const generateDw5Proposals = (schedules, user_id, routes = [], employeeCount = 0) => {
  const activeRoutes = routes.filter(routeHasSegments);
  const proposals = [];
  const working = schedules.map((s) => ({ ...s }));
  const seen = new Set();

  const staffCount =
    employeeCount > 0
      ? employeeCount
      : new Set(schedules.map((s) => s.employee_id).filter(Boolean)).size;

  for (const entry of schedules) {
    if (!entry.route_id || !isSaturday(entry.date)) continue;

    const empId = entry.employee_id.toString();
    const satKey = `sat-${empId}-${entry.date}`;
    if (seen.has(satKey)) continue;
    seen.add(satKey);

    if (hasDw5AfterSaturday(entry.employee_id, entry.date, working)) continue;

    const dw5Date = pickDw5Date(entry.date, empId, working, activeRoutes, staffCount);
    if (!dw5Date) continue;

    const dw5Key = `dw5-${empId}-${dw5Date}`;
    if (seen.has(dw5Key)) continue;

    proposals.push(buildDw5LabelProposal(dw5Date, entry.employee_id, user_id));
    working.push(buildDw5ScheduleEntry(dw5Date, entry.employee_id, user_id));
    seen.add(dw5Key);
  }

  return proposals;
};

module.exports = {
  DW5_LABEL_CODE,
  isSaturday,
  getSaturdayAssignmentBlockReason,
  getSaturdayDw5BlockReason,
  routeHasSegments,
  countMandatoryOperatingRoutes,
  isDayStructurallyStaffable,
  getDw5CandidateWeekdays,
  pickDw5Date,
  canAssignSaturdayRouteWithDw5,
  planSaturdayDw5Package,
  hasDw5AfterSaturday,
  generateDw5Proposals,
};
