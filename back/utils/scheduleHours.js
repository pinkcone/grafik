const { getIsoWeekday } = require('./routeOperatingDays');

const daysInMonth = (month, year) => new Date(year, month, 0).getDate();

const buildDate = (year, month, day) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const parseWorkingHours = (wh) => {
  if (!wh) return null;
  if (typeof wh === 'object') return wh;
  try {
    return JSON.parse(wh);
  } catch {
    return null;
  }
};

const toMinutes = (hhmm) => {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
};

/** Przedziały czasowe trasy w minutach: [{ start, end }] (obsługuje przejście przez północ). */
const getRouteTimeSegments = (route) => {
  const wh = parseWorkingHours(route?.working_hours);
  if (!wh || !Array.isArray(wh.segments)) return [];

  const segments = [];
  for (const seg of wh.segments) {
    const start = toMinutes(seg.start);
    let end = toMinutes(seg.end);
    if (start == null || end == null) continue;
    if (end < start) end += 24 * 60; // trasa przez północ
    segments.push({ start, end });
  }
  return segments;
};

const segmentsOverlap = (a, b) => a.start < b.end && b.start < a.end;

/** Czy dwie trasy nakładają się czasowo (nie można ich połączyć u jednego kierowcy). */
const routesTimeOverlap = (routeA, routeB) => {
  const segsA = getRouteTimeSegments(routeA);
  const segsB = getRouteTimeSegments(routeB);
  for (const sa of segsA) {
    for (const sb of segsB) {
      if (segmentsOverlap(sa, sb)) return true;
    }
  }
  return false;
};

const getRouteDurationHours = (route) => {
  const segments = getRouteTimeSegments(route);
  if (segments.length === 0) return 0;
  const totalMinutes = segments.reduce((sum, s) => sum + (s.end - s.start), 0);
  return totalMinutes / 60;
};

/** Docelowe godziny w miesiącu: dni robocze (pn–pt) × 8h × część etatu */
const getTargetMonthHours = (employee, month, year) => {
  const partTime = parseFloat(employee?.part_time) || 1;
  const dim = daysInMonth(month, year);
  let weekdays = 0;
  for (let d = 1; d <= dim; d++) {
    const wd = getIsoWeekday(buildDate(year, month, d));
    if (wd >= 1 && wd <= 5) weekdays += 1;
  }
  return weekdays * 8 * partTime;
};

const getEmployeeMonthHours = (employeeId, schedules, routes, month, year) => {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  let total = 0;

  schedules
    .filter(
      (s) =>
        s.employee_id?.toString() === employeeId.toString() &&
        s.date?.startsWith(prefix)
    )
    .forEach((s) => {
      if (s.route_id) {
        const route = routes.find((r) => r.id.toString() === s.route_id.toString());
        total += getRouteDurationHours(route);
      }
    });

  return total;
};

const getHoursRatio = (employee, schedules, routes, month, year) => {
  const target = getTargetMonthHours(employee, month, year);
  if (target <= 0) return 0;
  return getEmployeeMonthHours(employee.id, schedules, routes, month, year) / target;
};

const wouldExceedTargetHours = (employee, route, schedules, routes, month, year, tolerance = 1.08) => {
  const target = getTargetMonthHours(employee, month, year);
  if (target <= 0) return false;
  const current = getEmployeeMonthHours(employee.id, schedules, routes, month, year);
  const next = current + getRouteDurationHours(route);
  return next > target * tolerance;
};

module.exports = {
  getRouteDurationHours,
  getRouteTimeSegments,
  routesTimeOverlap,
  getTargetMonthHours,
  getEmployeeMonthHours,
  getHoursRatio,
  wouldExceedTargetHours,
};
