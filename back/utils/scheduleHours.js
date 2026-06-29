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

const QUARTER_MONTHS = [
  [1, 2, 3],   // styczeń–marzec
  [4, 5, 6],   // kwiecień–czerwiec
  [7, 8, 9],   // lipiec–wrzesień
  [10, 11, 12], // październik–grudzień
];

const getQuarterMonths = (month) =>
  QUARTER_MONTHS.find((q) => q.includes(month)) || [month];

const getEmployeePartTime = (employee) => {
  const pt = parseFloat(employee?.part_time);
  if (!Number.isFinite(pt) || pt <= 0) return 1;
  return pt;
};

/** Docelowe godziny na jeden dzień roboczy (8h × etat). */
const getTargetDailyHours = (employee) => 8 * getEmployeePartTime(employee);

const countWeekdaysInMonth = (month, year) => {
  const dim = daysInMonth(month, year);
  let weekdays = 0;
  for (let d = 1; d <= dim; d++) {
    const wd = getIsoWeekday(buildDate(year, month, d));
    if (wd >= 1 && wd <= 5) weekdays += 1;
  }
  return weekdays;
};

/** Docelowe godziny w miesiącu: dni robocze (pn–pt) × 8h × część etatu */
const getTargetMonthHours = (employee, month, year) => {
  return countWeekdaysInMonth(month, year) * getTargetDailyHours(employee);
};

/** Docelowe godziny w kwartale (pn–pt × 8h × etat, suma miesięcy kwartału). */
const getTargetQuarterHours = (employee, month, year) => {
  return getQuarterMonths(month).reduce(
    (sum, m) => sum + countWeekdaysInMonth(m, year) * getTargetDailyHours(employee),
    0
  );
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

const getEmployeeQuarterHours = (employeeId, schedules, routes, month, year) => {
  const qMonths = getQuarterMonths(month);
  let total = 0;
  for (const m of qMonths) {
    total += getEmployeeMonthHours(employeeId, schedules, routes, m, year);
  }
  return total;
};

const getQuarterHourGap = (employee, schedules, routes, month, year) => {
  const target = getTargetQuarterHours(employee, month, year);
  const current = getEmployeeQuarterHours(employee.id, schedules, routes, month, year);
  return target - current;
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
  getQuarterMonths,
  getEmployeePartTime,
  getTargetDailyHours,
  countWeekdaysInMonth,
  getTargetMonthHours,
  getTargetQuarterHours,
  getEmployeeMonthHours,
  getEmployeeQuarterHours,
  getQuarterHourGap,
  getHoursRatio,
  wouldExceedTargetHours,
};
