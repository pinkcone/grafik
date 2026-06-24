/** ISO: 1 = poniedziałek … 7 = niedziela */
const WEEKDAY_OPTIONS = [
  { value: 1, label: 'Pon' },
  { value: 2, label: 'Wt' },
  { value: 3, label: 'Śr' },
  { value: 4, label: 'Czw' },
  { value: 5, label: 'Pt' },
  { value: 6, label: 'Sob' },
  { value: 7, label: 'Nd' },
];

const DEFAULT_OPERATING_DAYS = [1, 2, 3, 4, 5];

const normalizeOperatingDays = (days) => {
  if (!Array.isArray(days)) return [...DEFAULT_OPERATING_DAYS];
  const nums = [...new Set(
    days.map((d) => parseInt(d, 10)).filter((d) => d >= 1 && d <= 7)
  )].sort((a, b) => a - b);
  return nums.length > 0 ? nums : [...DEFAULT_OPERATING_DAYS];
};

const getIsoWeekday = (dateStr) => {
  const d = new Date(`${dateStr}T12:00:00`);
  const js = d.getDay();
  return js === 0 ? 7 : js;
};

const getRouteOperatingDays = (route) =>
  normalizeOperatingDays(route?.operating_days);

const isRouteOperatingOnDate = (route, dateStr) => {
  if (!route || !dateStr) return true;
  const allowed = getRouteOperatingDays(route);
  return allowed.includes(getIsoWeekday(dateStr));
};

const formatOperatingDays = (route) => {
  const days = getRouteOperatingDays(route);
  if (days.length === 7) return 'codziennie';
  return days
    .map((d) => WEEKDAY_OPTIONS.find((o) => o.value === d)?.label || d)
    .join(', ');
};

const getOperatingDayBlockReason = (route, dateStr, labelPrefix = 'Trasa') => {
  if (!route || !dateStr) return null;
  if (isRouteOperatingOnDate(route, dateStr)) return null;
  const weekday = WEEKDAY_OPTIONS.find((o) => o.value === getIsoWeekday(dateStr))?.label || '';
  return `${labelPrefix} „${route.name}” nie kursuje w ${weekday} (${dateStr}).`;
};

module.exports = {
  WEEKDAY_OPTIONS,
  DEFAULT_OPERATING_DAYS,
  normalizeOperatingDays,
  getIsoWeekday,
  getRouteOperatingDays,
  isRouteOperatingOnDate,
  formatOperatingDays,
  getOperatingDayBlockReason,
};
