import * as XLSX from 'xlsx-js-style';
import { saveAs } from 'file-saver';
import { decorateWorksheet } from '../pages/elements/decorateWorksheet';
import { downloadCsv } from './csvExport';
import { buildDate, calculateDuration, parseWorkingHours, WEEKDAY_SHORT } from './scheduleViewHelpers';

const prepareEmployeesSheet = ({ employees, routes, schedules, days, year, month, calculateEmployeeHours }) => {
  const header = ['Pracownik', ...days.map((d) => `${d}`), 'Suma godzin'];
  const sheetData = [header];

  employees.forEach((emp) => {
    const row = [`${emp.last_name} ${emp.first_name}`];
    days.forEach((day) => {
      const date = buildDate(year, month, day);
      const cells = schedules.filter(
        (s) => s.employee_id?.toString() === emp.id.toString() && s.date === date
      );
      const parts = [];
      for (const cell of cells) {
        if (cell.route_id) {
          const route = routes.find((r) => r.id.toString() === cell.route_id.toString());
          const wh = route ? parseWorkingHours(route.working_hours) : null;
          if (wh && Array.isArray(wh.segments) && wh.segments.length > 0) {
            parts.push(wh.segments.map((seg) => `${seg.start}-${seg.end}`).join(' / '));
          } else {
            parts.push(`RouteID=${cell.route_id}`);
          }
        } else if (cell.label) {
          parts.push(`${cell.label}`);
        }
      }
      row.push(parts.join('\n'));
    });
    row.push(calculateEmployeeHours(emp.id));
    sheetData.push(row);
  });

  return sheetData;
};

const prepareRoutesSheet = ({ employees, routes, labels, schedules, days, year, month }) => {
  const header = ['Trasa', ...days.map((d) => `${d}`)];
  const sheetData = [header];

  routes.forEach((rt) => {
    const row = [rt.name];
    days.forEach((day) => {
      const date = buildDate(year, month, day);
      const cell = schedules.find(
        (s) => s.date === date && s.route_id?.toString() === rt.id.toString()
      );
      if (cell?.employee_id) {
        const emp = employees.find((e) => e.id === cell.employee_id);
        row.push(emp ? `${emp.last_name} ${emp.first_name}` : '');
      } else {
        row.push('');
      }
    });
    sheetData.push(row);
  });

  sheetData.push([]);

  labels.forEach((label) => {
    const labelRow = [`↳ ${label.code}`];
    days.forEach((day) => {
      const date = buildDate(year, month, day);
      const names = schedules
        .filter((s) => s.date === date && s.label === label.code)
        .map((s) => {
          const emp = employees.find((e) => e.id === s.employee_id);
          return emp ? `${emp.last_name} ${emp.first_name}` : null;
        })
        .filter(Boolean);
      labelRow.push(names.join('\n'));
    });
    sheetData.push(labelRow);
  });

  return sheetData;
};

export const exportScheduleXLSX = (ctx) => {
  const wsDataEmployees = prepareEmployeesSheet(ctx);
  const wsDataRoutes = prepareRoutesSheet(ctx);
  const { days, year, month } = ctx;

  const wb = XLSX.utils.book_new();
  const wsEmployees = XLSX.utils.aoa_to_sheet(wsDataEmployees);
  const wsRoutes = XLSX.utils.aoa_to_sheet(wsDataRoutes);

  decorateWorksheet({ ws: wsEmployees, data: wsDataEmployees, days, year, month });
  decorateWorksheet({ ws: wsRoutes, data: wsDataRoutes, days, year, month });

  XLSX.utils.book_append_sheet(wb, wsEmployees, 'Grafik-Pracownicy');
  XLSX.utils.book_append_sheet(wb, wsRoutes, 'Grafik-Trasy');

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  saveAs(new Blob([wbout]), 'grafik.xlsx');
};

export const exportScheduleCSV = ({ employees, routes, schedules, year, month, cityId }) => {
  const header = [
    'data', 'dzien', 'dzien_tygodnia', 'pracownik_id', 'pracownik', 'etat',
    'trasa_id', 'trasa', 'godziny_trasy', 'etykieta', 'auto_uzupelnione',
  ];

  const rows = schedules
    .slice()
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        String(a.employee_id).localeCompare(String(b.employee_id))
    )
    .map((s) => {
      const emp = employees.find((e) => e.id?.toString() === s.employee_id?.toString());
      const route = s.route_id
        ? routes.find((r) => r.id.toString() === s.route_id.toString())
        : null;
      const dayNum = parseInt(s.date.split('-')[2], 10);
      const dow = WEEKDAY_SHORT[new Date(`${s.date}T12:00:00`).getDay()];

      return [
        s.date,
        dayNum,
        dow,
        s.employee_id ?? '',
        emp ? `${emp.last_name} ${emp.first_name}` : '',
        emp?.part_time ?? '',
        s.route_id ?? '',
        route?.name ?? '',
        route ? calculateDuration(route).toFixed(2) : '',
        s.label ?? '',
        s.auto_filled === true || s.auto_filled === 1 ? 'tak' : 'nie',
      ];
    });

  const filename = `grafik-${year}-${String(month).padStart(2, '0')}-miasto${cityId}.csv`;
  downloadCsv(filename, [header, ...rows]);
};
