const { getIsoWeekday, isRouteOperatingOnDate } = require('./routeOperatingDays');

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

/** Czy w danym dniu zostaje choć jedna trasa bez kierowcy */
const hasUnfilledRoutesOnDay = (date, routes, schedules) => {
  if (!Array.isArray(routes) || routes.length === 0) return true;

  return routes.some((route) => {
    if (!routeHasSegments(route)) return false;
    if (!routeRequiresStaffing(route)) return false;
    if (!isRouteOperatingOnDate(route, date)) return false;
    return !findRouteAssignment(date, route.id, schedules);
  });
};

const isDayReadyForDw5 = (date, routes, schedules) =>
  !hasUnfilledRoutesOnDay(date, routes, schedules);

const isSaturday = (dateStr) => dateStr && getIsoWeekday(dateStr) === 6;

const buildDate = (year, month, day) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const addDays = (dateStr, days) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return buildDate(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
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

const getNextWeekMonday = (dateStr) => addDays(dateStr, 8 - getIsoWeekday(dateStr));

const getFridayOfWeek = (mondayStr) => addDays(mondayStr, 4);

const hasEmployeeRouteOnDay = (employeeId, date, schedules) =>
  schedules.some(
    (s) =>
      s.employee_id?.toString() === employeeId.toString() &&
      s.date === date &&
      s.route_id
  );

const hasEmployeeLabelOnDay = (employeeId, date, schedules, labelCode = null) =>
  schedules.some((s) => {
    if (s.employee_id?.toString() !== employeeId.toString() || s.date !== date || !s.label) {
      return false;
    }
    if (labelCode) return s.label === labelCode;
    return true;
  });

const pickDw5Date = (saturdayDate, employeeId, schedules, routes) => {
  const monday = getNextWeekMonday(saturdayDate);
  const friday = getFridayOfWeek(monday);

  const isCandidateDay = (date) =>
    !hasEmployeeRouteOnDay(employeeId, date, schedules) &&
    !hasEmployeeLabelOnDay(employeeId, date, schedules) &&
    isDayReadyForDw5(date, routes, schedules);

  if (isCandidateDay(monday)) return monday;
  if (isCandidateDay(friday)) return friday;
  return null;
};

const generateDw5Proposals = (schedules, user_id, routes = []) => {
  const activeRoutes = routes.filter(routeHasSegments);
  const proposals = [];
  const working = schedules.map((s) => ({ ...s }));
  const seen = new Set();

  for (const entry of schedules) {
    if (!entry.route_id || !isSaturday(entry.date)) continue;

    const empId = entry.employee_id.toString();
    const satKey = `sat-${empId}-${entry.date}`;
    if (seen.has(satKey)) continue;
    seen.add(satKey);

    const dw5Date = pickDw5Date(entry.date, empId, working, activeRoutes);
    if (!dw5Date) continue;

    const dw5Key = `dw5-${empId}-${dw5Date}`;
    if (seen.has(dw5Key)) continue;
    if (hasEmployeeLabelOnDay(empId, dw5Date, working, DW5_LABEL_CODE)) continue;

    proposals.push({
      date: dw5Date,
      employee_id: entry.employee_id,
      route_id: null,
      label: DW5_LABEL_CODE,
      assignment_type: 'label',
      user_id,
    });
    working.push({
      date: dw5Date,
      employee_id: entry.employee_id,
      route_id: null,
      label: DW5_LABEL_CODE,
    });
    seen.add(dw5Key);
  }

  return proposals;
};

module.exports = {
  DW5_LABEL_CODE,
  isSaturday,
  getSaturdayAssignmentBlockReason,
  routeHasSegments,
  hasUnfilledRoutesOnDay,
  isDayReadyForDw5,
  pickDw5Date,
  generateDw5Proposals,
};
