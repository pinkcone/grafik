// Czyste helpery widoku grafiku (bez stanu Reacta) — współdzielone przez ScheduleView i podkomponenty.

export const QUARTERS = [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]];

export const getQuarterMonths = (m) => QUARTERS.find((q) => q.includes(m)) || [];

export const MONTH_NAMES = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
];

export const WEEKDAY_SHORT = ['Nd', 'Pn', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob'];

export const daysInMonth = (m, y) => new Date(y, m, 0).getDate();

export const pad2 = (n) => String(n).padStart(2, '0');

/** Data 'YYYY-MM-DD' z (rok, miesiąc 1-12, dzień). */
export const buildDate = (year, month, day) => `${year}-${pad2(month)}-${pad2(day)}`;

/** Lista dni [1..N] danego miesiąca. */
export const listDays = (month, year) => {
  const out = [];
  for (let d = 1; d <= daysInMonth(month, year); d += 1) out.push(d);
  return out;
};

/** working_hours może być stringiem JSON lub obiektem — zwraca obiekt albo null. */
export const parseWorkingHours = (wh) => {
  if (!wh) return null;
  if (typeof wh === 'string') {
    try {
      return JSON.parse(wh);
    } catch {
      return null;
    }
  }
  return wh;
};

/** Suma godzin trasy z segmentów (obsługuje przejście przez północ). */
export const calculateDuration = (route) => {
  const wh = parseWorkingHours(route?.working_hours);
  if (!wh || !Array.isArray(wh.segments)) return 0;
  let totalMinutes = 0;
  wh.segments.forEach((seg) => {
    const [startH, startM] = seg.start.split(':').map(Number);
    const [endH, endM] = seg.end.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    let endMinutes = endH * 60 + endM;
    if (endMinutes < startMinutes) endMinutes += 24 * 60;
    totalMinutes += endMinutes - startMinutes;
  });
  return totalMinutes / 60;
};

/** Indeks dnia tygodnia z Pn=0 … Nd=6. */
export const isoWeekdayIndex = (year, month, day) =>
  (new Date(year, month - 1, day).getDay() + 6) % 7;
