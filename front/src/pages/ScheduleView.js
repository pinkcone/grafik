import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx-js-style';
import { saveAs } from 'file-saver';
import { decorateWorksheet } from './elements/decorateWorksheet';
import { downloadCsv } from '../utils/csvExport';
import { canAssignEmployeeToRouteWithPair, getAssignmentBlockReason, findPairRoute, sortRoutesByAssignmentPriority } from '../utils/routeAssignment';
import { hasEmployeeLabelOnDay } from '../utils/scheduleLabels';
import { getEmployeeRouteSlotCountOnDay, canEmployeeHaveAnotherRouteOnDay } from '../utils/scheduleConstraints';
import Popup from '../components/Popup';
import { useNotifications } from '../context/NotificationsContext';
import '../styles/ScheduleView.css';
import '../styles/ScheduleDayMenu.css';

const backendUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';

const quaters = [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]];
const getQuarterMonths = (m) => quaters.find(q => q.includes(m)) || [];

const MONTH_NAMES = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
];

function ScheduleView({ cityId }) {
  const token = localStorage.getItem('token');
  const { notifications, refresh: refreshNotifications } = useNotifications();

  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());

  const goToPrevMonth = () => {
    if (month === 1) {
      setMonth(12);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  };

  const goToNextMonth = () => {
    if (month === 12) {
      setMonth(1);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  };

  const goToToday = () => {
    const now = new Date();
    setMonth(now.getMonth() + 1);
    setYear(now.getFullYear());
  };

  const [viewType, setViewType] = useState('employees');

  const [employees, setEmployees] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [labels, setLabels] = useState([]);
  const [schedules, setSchedules] = useState([]);

  const employeesTableRef = useRef(null);
  const routesTableRef = useRef(null);
  const dayMenuDropdownRef = useRef(null);

  const [openDayMenu, setOpenDayMenu] = useState(null);

  const [assignMonthOpen, setAssignMonthOpen] = useState(false);
  const [assignMonthEmployeeId, setAssignMonthEmployeeId] = useState('');
  const [assignMonthRouteId, setAssignMonthRouteId] = useState('');
  const [assignMonthLoading, setAssignMonthLoading] = useState(false);

  const [autoFillDebug, setAutoFillDebug] = useState(null);
  const [autoFillDebugOpen, setAutoFillDebugOpen] = useState(true);

  const [quarterSchedules, setQuarterSchedules] = useState({});

  const fetchQuarterSchedules = async () => {
    const qMonths = getQuarterMonths(month);
    const results = await Promise.all(qMonths.map(async (m) => {
      try {
        const res = await fetch(
          `/api/schedule/city/${cityId}?month=${m}&year=${year}`,
          {
            headers: { 'Authorization': `Bearer ${token}` },
            cache: 'no-store'
          }
        );
        const data = await res.json();
        return [m, Array.isArray(data) ? data : []];
      } catch (e) {
        return [m, []];
      }
    }));

    const map = {};
    results.forEach(([m, arr]) => { map[m] = arr; });
    setQuarterSchedules(map);
  };

  useEffect(() => {
    fetchEmployees();
    fetchRoutes();
    fetchLabels();
    fetchSchedule();
    fetchQuarterSchedules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityId, month, year]);

  useEffect(() => {
    setOpenDayMenu(null);
  }, [month, year, viewType]);

  useEffect(() => {
    if (openDayMenu == null) return;
    const handleClickOutside = (e) => {
      if (
        !e.target.closest('.schedule-day-menu') &&
        !e.target.closest('.schedule-day-menu__dropdown--fixed')
      ) {
        setOpenDayMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openDayMenu]);

  useLayoutEffect(() => {
    const el = dayMenuDropdownRef.current;
    if (!el) return;
    el.classList.add('schedule-day-menu__dropdown--wide');
    const naturalWidth = el.scrollWidth;
    el.classList.toggle('schedule-day-menu__dropdown--wide', naturalWidth > 150);
  }, [openDayMenu]);

  const fetchEmployees = async () => {
    try {
      const res = await fetch(`/api/employees/city/${cityId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
        cache: 'no-store'
      });
      const data = await res.json();
      setEmployees(Array.isArray(data) ? data : []);
    } catch (error) {
      // ignore
    }
  };

  const fetchRoutes = async () => {
    try {
      const res = await fetch(`/api/routes/city/${cityId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
        cache: 'no-store'
      });
      const data = await res.json();
      const filtered = Array.isArray(data)
        ? data.filter(r => {
          let wh = r.working_hours;
          if (typeof wh === "string") {
            try {
              wh = JSON.parse(wh);
            } catch (e) {
              return false;
            }
          }
          return wh && Array.isArray(wh.segments) && wh.segments.length > 0;
        })
        : [];
      setRoutes(filtered);
    } catch (error) {
      // ignore
    }
  };

  const fetchLabels = async () => {
    try {
      const res = await fetch(`/api/labels`, {
        headers: { 'Authorization': `Bearer ${token}` },
        cache: 'no-store'
      });
      const data = await res.json();
      setLabels(Array.isArray(data) ? data : []);
    } catch (error) {
      // ignore
    }
  };

  const fetchSchedule = async () => {
    try {
      const res = await fetch(
        `/api/schedule/city/${cityId}?month=${month}&year=${year}`,
        {
          headers: { 'Authorization': `Bearer ${token}` },
          cache: 'no-store'
        }
      );
      const data = await res.json();
      setSchedules(Array.isArray(data) ? data : []);
    } catch (error) {
      // ignore
    }
  };

  useEffect(() => {
    const applyDebugFromNotification = (n) => {
      const debug = n.result?.debug;
      if (!debug) return;
      setAutoFillDebug(debug);
      setAutoFillDebugOpen(true);
      console.group('[Auto-fill] Diagnostyka');
      console.log('Podsumowanie po zapisie:', debug.afterPersist?.summary);
      console.log('Pominięte zapisy:', debug.persistSkipped);
      (debug.logs || []).forEach((line) => console.log(line));
      console.groupEnd();
    };

    const onCompleted = async (e) => {
      const n = e.detail;
      if (String(n.cityId) !== String(cityId) || n.month !== month || n.year !== year) return;
      applyDebugFromNotification(n);
      await fetchSchedule();
      await fetchQuarterSchedules();
    };

    const onFailed = (e) => {
      const n = e.detail;
      if (String(n.cityId) !== String(cityId) || n.month !== month || n.year !== year) return;
      alert(`Auto-uzupełnianie nie powiodło się: ${n.error || n.message}`);
    };

    window.addEventListener('grafik-job-completed', onCompleted);
    window.addEventListener('grafik-job-failed', onFailed);
    return () => {
      window.removeEventListener('grafik-job-completed', onCompleted);
      window.removeEventListener('grafik-job-failed', onFailed);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityId, month, year]);

  const autoFillRunning = notifications.some(
    (n) =>
      n.type === 'auto_fill' &&
      n.status === 'running' &&
      String(n.cityId) === String(cityId) &&
      n.month === month &&
      n.year === year
  );

  const daysInMonth = (m, y) => new Date(y, m, 0).getDate();
  const days = [];
  for (let d = 1; d <= daysInMonth(month, year); d++) days.push(d);

  const assertEmployeeCanTakeRoute = (employeeId, routeId, date) => {
    const employee = employees.find((e) => e.id.toString() === employeeId.toString());
    const route = routes.find((r) => r.id.toString() === routeId.toString());
    const reason = getAssignmentBlockReason(employee, route, {
      pairedRoute: findPairRoute(route, routes),
      date,
      schedules,
      allRoutes: routes,
    });
    if (reason) {
      throw new Error(reason);
    }
  };

  /** ================= EMPLOYEE VIEW: CREATE/UPDATE ================= */

  // Dodanie pierwszego wpisu w danym dniu (gdy brak wpisów)
  // Jeżeli wybrano TRASĘ: dodaj także trasę bliźniaczą tylko jeśli:
  // - nie jest przypisana do innego pracownika tego dnia,
  // - nie masz już tej bliźniaczej trasy przypisanej do tego samego pracownika.
  const updateScheduleCell = async (employeeId, date, newValue) => {
    let route_id = null, label = null;
    if (newValue.startsWith("R:")) route_id = Number(newValue.substring(2));
    else if (newValue.startsWith("L:")) label = newValue.substring(2);

    try {
      if (route_id) {
        assertEmployeeCanTakeRoute(employeeId, route_id, date);
        // 1) najpierw wybrana trasa
        await putScheduleCell({ date, route_id: Number(route_id), employee_id: employeeId });

        // 2) ewentualnie dokładamy bliźniaczą (tylko gdy wolna od innego pracownika)
        const pairId = getPairRoute(route_id);
        if (pairId != null) {
          const takenByOther = isRouteAssignedToAnotherEmployee(date, pairId, employeeId);
          const pairSched = findScheduleForRoute(date, pairId);
          const alreadySame = !!pairSched && pairSched.employee_id?.toString() === employeeId.toString();

          if (!takenByOther && !alreadySame) {
            await putScheduleCell({ date, route_id: Number(pairId), employee_id: employeeId });
          }
        }
      } else {
        // etykieta lub pusto – klasyczny pojedynczy update
        const res = await fetch(`/api/schedule/update-cell`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          cache: 'no-store',
          body: JSON.stringify({ date, employee_id: employeeId, route_id: null, label })
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.message || `HTTP ${res.status}`);
        }
      }

      await fetchSchedule();
      await fetchQuarterSchedules();
    } catch (error) {
      alert(`Błąd aktualizacji grafiku: ${error.message}`);
    }
  };

  // Edycja KONKRETNEGO wpisu (gdy w komórce jest wiele wpisów)
  // Jeżeli wybrano TRASĘ: jak wyżej – dodaj bliźniaczą tylko gdy wolna od innego pracownika.
  const updateExistingEntryInEmployeeCell = async (entry, date, newValue) => {
    // usuwanie pojedynczego wpisu
    if (newValue.startsWith("D:")) {
      const sure = window.confirm("Na pewno usunąć ten wpis?");
      if (!sure) return;
      await deleteSchedule(entry.id);
      return;
    }

    let route_id = null, label = null;
    if (newValue.startsWith("R:")) route_id = Number(newValue.substring(2));
    else if (newValue.startsWith("L:")) label = newValue.substring(2);

    try {
      if (route_id) {
        assertEmployeeCanTakeRoute(entry.employee_id, route_id, date);
        // 1) wybrana trasa
        await putScheduleCell({ date, route_id: Number(route_id), employee_id: entry.employee_id });

        // 2) bliźniacza tylko jeśli wolna od innego
        const pairId = getPairRoute(route_id);
        if (pairId != null) {
          const takenByOther = isRouteAssignedToAnotherEmployee(date, pairId, entry.employee_id);
          const pairSched = findScheduleForRoute(date, pairId);
          const alreadySame = !!pairSched && pairSched.employee_id?.toString() === entry.employee_id.toString();

          if (!takenByOther && !alreadySame) {
            await putScheduleCell({ date, route_id: Number(pairId), employee_id: entry.employee_id });
          }
        }
      } else {
        // zmiana na etykietę/pusto dla tego konkretnego wpisu
        const res = await fetch(`/api/schedule/update-cell`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          cache: 'no-store',
          body: JSON.stringify({
            date,
            employee_id: entry.employee_id,
            route_id: null,
            label: label ?? null,
            schedule_id: entry.id ?? null,
            prev_route_id: entry.route_id ?? null
          })
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.message || `HTTP ${res.status}`);
        }
      }

      await fetchSchedule();
      await fetchQuarterSchedules();
    } catch (error) {
      alert(`Błąd aktualizacji wpisu: ${error.message}`);
    }
  };

  /** ================= OPTIONS (EMPLOYEE VIEW) ================= */

  const getAvailableOptionsForEmployeeCell = (employeeId, day) => {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const assignedRouteIds = schedules
      .filter(s => s.date === date && s.route_id && s.employee_id !== employeeId)
      .map(s => s.route_id.toString());

    const employee = employees.find(e => e.id.toString() === employeeId.toString());

    if (hasEmployeeLabelOnDay(employeeId, date, schedules)) {
      const labelOptions = labels.map(l => ({
        value: `L:${l.code}`,
        label: `${l.code}`
      }));
      return [{ value: '', label: '-- brak --' }, ...labelOptions];
    }

    if (getEmployeeRouteSlotCountOnDay(employeeId, date, schedules, routes) > 0) {
      return [{ value: '', label: '-- brak --' }];
    }

    const availableRoutes = sortRoutesByAssignmentPriority(
      routes.filter((r) => {
        if (assignedRouteIds.includes(r.id.toString())) return false;
        return canAssignEmployeeToRouteWithPair(employee, r, routes, date, schedules);
      })
    );

    const routeOptions = availableRoutes.map(r => ({
      value: `R:${r.id}`,
      label: `${r.name} (${calculateDuration(r).toFixed(2)}h) [${r.required_license_category || 'B'}]${r.requires_special_permissions ? ' [SP]' : ''}`
    }));

    const labelOptions = labels.map(l => ({
      value: `L:${l.code}`,
      label: `${l.code}`
    }));

    return [{ value: "", label: "-- brak --" }, ...routeOptions, ...labelOptions];
  };

  /*** === POWIĄZANE TRASY (linked_route_id) === ***/

  // Zwróć ID tras z tej samej pary co routeId (dwukierunkowo) – łącznie z samą trasą
  const getPairRouteIdsIncludingSelf = (routeId) => {
    const idStr = routeId.toString();
    const rt = routes.find(r => r.id.toString() === idStr);
    if (!rt) return [idStr];

    const pair = new Set([idStr]);

    // A: jeśli ta trasa wskazuje na inną
    if (rt.linked_route_id != null) {
      pair.add(rt.linked_route_id.toString());
    }
    // B: jeżeli inna trasa wskazuje na tę
    routes.forEach(r => {
      if (r.linked_route_id != null && r.linked_route_id.toString() === idStr) {
        pair.add(r.id.toString());
      }
    });

    return Array.from(pair);
  };

  // Zwróć ID trasy bliźniaczej (drugi element pary) – działa dwukierunkowo; brak → null
  const getPairRoute = (routeId) => {
    const idStr = routeId.toString();
    const rt = routes.find(r => r.id.toString() === idStr);
    if (rt && rt.linked_route_id != null) return Number(rt.linked_route_id);
    const reverse = routes.find(r => r.linked_route_id != null && r.linked_route_id.toString() === idStr);
    if (reverse) return Number(reverse.id);
    return null;
  };

  // PUT pojedynczej (route+date) – backend tworzy/aktualizuje po {date, route_id}
  const putScheduleCell = async ({ date, route_id, employee_id }) => {
    const res = await fetch(`/api/schedule/update-cell`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      cache: 'no-store',
      body: JSON.stringify({
        date,
        employee_id: employee_id || null,
        route_id,
        label: null
      })
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const data = await res.json();
        msg = data.message || msg;
      } catch { }
      throw new Error(msg);
    }
  };

  // === NOWE helpery do kasowania i sprawdzania zajętości ===

  // Znajdź wpis dla (date, route_id)
  const findScheduleForRoute = (date, routeId) =>
    schedules.find(s => s.date === date && s.route_id?.toString() === routeId.toString());

  // Czy trasa jest zajęta przez INNEGO pracownika (tego dnia)?
  const isRouteAssignedToAnotherEmployee = (date, routeId, employeeId) => {
    const s = findScheduleForRoute(date, routeId);
    return !!(s && s.employee_id?.toString() !== (employeeId?.toString() ?? ''));
  };

  // Usuń pojedynczy wpis (bez ruszania bliźniaczej trasy)
  const removeScheduleEntry = async (scheduleId) => {
    if (!scheduleId) return;

    const res = await fetch(`/api/schedule/${scheduleId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
      cache: 'no-store'
    });
    if (!res.ok && res.status !== 204) {
      let msg = `HTTP ${res.status}`;
      try {
        const data = await res.json();
        msg = data.message || data.error || msg;
      } catch { }
      throw new Error(msg);
    }
  };

  const deleteSchedule = async (scheduleId) => {
    try {
      await removeScheduleEntry(scheduleId);
      await fetchSchedule();
      await fetchQuarterSchedules();
    } catch (e) {
      alert(`Nie udało się usunąć wpisu: ${e.message || e}`);
    }
  };

  const clearDay = async (day) => {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const entries = schedules.filter(s => s.date === date);

    if (entries.length === 0) {
      alert('Brak wpisów w tym dniu.');
      setOpenDayMenu(null);
      return;
    }

    const ok = window.confirm(
      `Wyczyścić dzień ${day}.${month}.${year}?\nUsunie ${entries.length} wpis(ów) z grafiku.`
    );
    if (!ok) return;

    setOpenDayMenu(null);

    try {
      await Promise.all(entries.map(e => removeScheduleEntry(e.id)));
      await fetchSchedule();
      await fetchQuarterSchedules();
    } catch (e) {
      alert(`Nie udało się wyczyścić dnia: ${e.message || e}`);
      await fetchSchedule();
      await fetchQuarterSchedules();
    }
  };

  // Widok TRAS – przypisanie/odpięcie pracownika.
  // Gdy przypisujemy pracownika do trasy, próbujemy dodać bliźniaczą TYLKO gdy
  // nie jest zajęta przez innego. Przy odpinaniu – nie dotykamy bliźniaczej.
  const updateScheduleForRouteCell = async (routeId, day, employeeIdRaw) => {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const employeeId = employeeIdRaw === '' ? null : (employeeIdRaw === 'DELETE' ? 'DELETE' : Number(employeeIdRaw));

    try {
      const currentCell = findScheduleForRoute(date, routeId);

      // Usunięcie istniejącego wpisu (opcja w selectcie)
      if (employeeId === 'DELETE' && currentCell) {
        const ok = window.confirm("Na pewno usunąć przypisanie tej trasy w tym dniu?");
        if (!ok) return;
        await deleteSchedule(currentCell.id);
        return;
      }

      // Zwykłe przypisanie/odpięcie
      if (employeeId != null) {
        assertEmployeeCanTakeRoute(employeeId, routeId, date);
      }
      await putScheduleCell({ date, route_id: Number(routeId), employee_id: employeeId });

      // Jeśli przypinamy pracownika – rozważ bliźniaczą
      if (employeeId != null) {
        const pairId = getPairRoute(routeId);
        if (pairId != null) {
          const takenByOther = isRouteAssignedToAnotherEmployee(date, pairId, employeeId);
          const pairSched = findScheduleForRoute(date, pairId);
          const alreadySame = !!pairSched && pairSched.employee_id?.toString() === employeeId.toString();

          if (!takenByOther && !alreadySame) {
            await putScheduleCell({ date, route_id: Number(pairId), employee_id: employeeId });
          }
        }
      }

      await fetchSchedule();
      await fetchQuarterSchedules();
    } catch (error) {
      alert(`Błąd aktualizacji grafiku: ${error.message}`);
    }
  };

  /** ================= AGGREGATIONS ================= */

  const getSchedulesForMonth = (m) => {
    if (m === month) return schedules;
    return quarterSchedules[m] || [];
  };

  const daysInM = (m, y) => new Date(y, m, 0).getDate();

  // Licz WSZYSTKIE wpisy (nie tylko pierwszy)
  const calculateEmployeeHoursForMonth = (employeeId, m) => {
    const dim = daysInM(m, year);
    let total = 0;

    const employee = employees.find(e => e.id === employeeId);
    const partTime = employee ? (employee.part_time ?? 1.0) : 1.0;

    const monthSchedules = getSchedulesForMonth(m);

    for (let d = 1; d <= dim; d++) {
      const date = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const cells = monthSchedules.filter(
        s => s.employee_id?.toString() === employeeId.toString() && s.date === date
      );

      for (const cell of cells) {
        if (cell.route_id) {
          const route = routes.find(r => r.id.toString() === cell.route_id.toString());
          if (route) total += calculateDuration(route);
        } else if (cell.label) {
          const labelObj = labels.find(l => l.code === cell.label);
          if (labelObj && typeof labelObj.default_hours === 'number') {
            total += (labelObj.default_hours * partTime);
          }
        }
      }
    }
    return total;
  };

  const calculateEmployeeHours = (employeeId) => {
    const dim = daysInM(month, year);
    let total = 0;

    const employee = employees.find(e => e.id === employeeId);
    const partTime = employee ? (employee.part_time ?? 1.0) : 1.0;

    for (let d = 1; d <= dim; d++) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const cells = schedules.filter(
        s => s.employee_id?.toString() === employeeId.toString() && s.date === date
      );

      for (const cell of cells) {
        if (cell.route_id) {
          const route = routes.find(r => r.id.toString() === cell.route_id.toString());
          if (route) total += calculateDuration(route);
        } else if (cell.label) {
          const labelObj = labels.find(l => l.code === cell.label);
          if (labelObj && typeof labelObj.default_hours === 'number') {
            total += (labelObj.default_hours * partTime);
          }
        }
      }
    }

    return total.toFixed(2);
  };

  const calculateQuarterEmployeeHours = (employeeId) => {
    const qMonths = getQuarterMonths(month);
    return qMonths.reduce((sum, m) => sum + calculateEmployeeHoursForMonth(employeeId, m), 0);
  };

  /** ================= UTIL ================= */

  const calculateDuration = (route) => {
    let wh = route.working_hours;
    if (typeof wh === "string") {
      try {
        wh = JSON.parse(wh);
      } catch (e) {
        return 0;
      }
    }
    if (wh && Array.isArray(wh.segments)) {
      let totalMinutes = 0;
      wh.segments.forEach(seg => {
        const [startH, startM] = seg.start.split(':').map(Number);
        const [endH, endM] = seg.end.split(':').map(Number);
        const startMinutes = startH * 60 + startM;
        let endMinutes = endH * 60 + endM;
        if (endMinutes < startMinutes) endMinutes += 24 * 60;
        totalMinutes += endMinutes - startMinutes;
      });
      return totalMinutes / 60;
    }
    return 0;
  };

const handleExportXLSX = () => {
  const wsDataEmployees = prepareEmployeesSheet();
  const wsDataRoutes = prepareRoutesSheet();

  const wb = XLSX.utils.book_new();

  const wsEmployees = XLSX.utils.aoa_to_sheet(wsDataEmployees);
  const wsRoutes = XLSX.utils.aoa_to_sheet(wsDataRoutes);

  decorateWorksheet({
    ws: wsEmployees,
    data: wsDataEmployees,
    days,
    year,
    month
  });

  decorateWorksheet({
    ws: wsRoutes,
    data: wsDataRoutes,
    days,
    year,
    month
  });

  XLSX.utils.book_append_sheet(wb, wsEmployees, "Grafik-Pracownicy");
  XLSX.utils.book_append_sheet(wb, wsRoutes, "Grafik-Trasy");

  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  saveAs(new Blob([wbout]), "grafik.xlsx");
};

const WEEKDAY_SHORT = ['Nd', 'Pn', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob'];

const handleExportCSV = () => {
  const header = [
    'data',
    'dzien',
    'dzien_tygodnia',
    'pracownik_id',
    'pracownik',
    'etat',
    'trasa_id',
    'trasa',
    'godziny_trasy',
    'etykieta',
    'auto_uzupelnione',
  ];

  const rows = schedules
    .slice()
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        String(a.employee_id).localeCompare(String(b.employee_id))
    )
    .map((s) => {
      const emp = employees.find(
        (e) => e.id?.toString() === s.employee_id?.toString()
      );
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

  const handleClearMonth = async () => {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    const routeCount = schedules.filter(
      (s) => s.date.startsWith(prefix) && s.route_id && (s.auto_filled === true || s.auto_filled === 1)
    ).length;

    const ok = window.confirm(
      `Wyczyścić trasy z auto-uzupełniania za ${month}.${year}?\n` +
      (routeCount > 0
        ? `Usunie ${routeCount} tras dodanych przez „Uzupełnij trasy”. Ręczne wpisy i etykiety zostaną.`
        : 'Brak tras z auto-uzupełniania do usunięcia w tym miesiącu.')
    );
    if (!ok) return;

    try {
      const res = await fetch(
        `/api/schedule/city/${cityId}/month?month=${month}&year=${year}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || `HTTP ${res.status}`);
      }
      alert(data.message || 'Miesiąc wyczyszczony.');
      await fetchSchedule();
      await fetchQuarterSchedules();
    } catch (error) {
      alert(`Nie udało się wyczyścić miesiąca: ${error.message}`);
    }
  };

  const handleAutoFillRoutes = async () => {
    const ok = window.confirm(
      'Uzupełnić puste sloty tras w tym miesiącu?\n\n' +
      'Najpierw każdy wolny kierowca dostaje po jednej trasie dziennie (bez drugiej trasy).\n' +
      'Godziny są rozkładane wg części etatu (pn–pt × 8h × etat).\n' +
      'Etykieta i trasa tego samego dnia się wykluczają.\n' +
      'Trasy sobotnie z auto-uzupełniania dostają DW5, jeśli jest wolny dzień w nast. tygodniu.\n' +
      'Brakujące DW5 po ręcznie dodanych trasach sobotnich też zostaną dopisane.\n' +
      'Etykiety (urlopy itd.) nie zostaną zmienione.'
    );
    if (!ok) return;

    try {
      const res = await fetch(
        `/api/schedule/city/${cityId}/auto-fill?month=${month}&year=${year}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || `HTTP ${res.status}`);
      }

      if (res.status === 202) {
        refreshNotifications();
        return;
      }

      if (data.debug) {
        setAutoFillDebug(data.debug);
        setAutoFillDebugOpen(true);
      }
      alert(data.message || `Uzupełniono ${data.created || 0} przypisań.`);
      await fetchSchedule();
      await fetchQuarterSchedules();
    } catch (error) {
      alert(`Nie udało się uruchomić auto-uzupełniania: ${error.message}`);
    }
  };

  const handleAssignMonth = async (e) => {
    e.preventDefault();
    if (!assignMonthEmployeeId || !assignMonthRouteId) {
      alert('Wybierz pracownika i trasę.');
      return;
    }

    const employee = employees.find((emp) => emp.id.toString() === assignMonthEmployeeId);
    const route = routes.find((rt) => rt.id.toString() === assignMonthRouteId);
    const ok = window.confirm(
      `Przypisać ${employee?.last_name} ${employee?.first_name} na trasę „${route?.name}” ` +
      `na cały ${month}.${year}?\n\n` +
      'Tylko wolne dni kursowania tej trasy, bez nadpisywania istniejących przypisań.\n' +
      'DW5 po sobotach zostanie dopisane automatycznie, jeśli jest wolny dzień w nast. tygodniu.'
    );
    if (!ok) return;

    setAssignMonthLoading(true);
    try {
      const res = await fetch(
        `/api/schedule/city/${cityId}/assign-month?month=${month}&year=${year}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            employee_id: Number(assignMonthEmployeeId),
            route_id: Number(assignMonthRouteId),
          }),
          cache: 'no-store',
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || `HTTP ${res.status}`);
      }
      alert(data.message || `Przypisano ${data.created || 0} dni.`);
      setAssignMonthOpen(false);
      setAssignMonthEmployeeId('');
      setAssignMonthRouteId('');
      await fetchSchedule();
      await fetchQuarterSchedules();
    } catch (error) {
      alert(`Nie udało się przypisać trasy: ${error.message}`);
    } finally {
      setAssignMonthLoading(false);
    }
  };



  const prepareEmployeesSheet = () => {
    const header = ["Pracownik", ...days.map(d => `${d}`), "Suma godzin"];
    const sheetData = [header];

    employees.forEach(emp => {
      const row = [`${emp.last_name} ${emp.first_name}`];
      days.forEach(day => {
        const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const cells = schedules.filter(
          s => s.employee_id?.toString() === emp.id.toString() && s.date === date
        );
        const parts = [];
        for (const cell of cells) {
          if (cell.route_id) {
            const route = routes.find(r => r.id.toString() === cell.route_id.toString());
            if (route) {
              let wh = route.working_hours;
              if (typeof wh === "string") {
                try { wh = JSON.parse(wh); } catch { wh = null; }
              }
              if (wh && Array.isArray(wh.segments) && wh.segments.length > 0) {
                parts.push(wh.segments.map(seg => `${seg.start}-${seg.end}`).join(" / "));
              } else {
                parts.push(`RouteID=${cell.route_id}`);
              }
            } else {
              parts.push(`RouteID=${cell.route_id}`);
            }
          } else if (cell.label) {
            parts.push(`${cell.label}`);
          }
        }
        row.push(parts.join("\n"));
      });
      row.push(calculateEmployeeHours(emp.id));
      sheetData.push(row);
    });

    return sheetData;
  };

const prepareRoutesSheet = () => {
  const header = ["Trasa", ...days.map(d => `${d}`)];
  const sheetData = [header];

  /** === WIERSZE TRAS === **/
  routes.forEach(rt => {
    const row = [rt.name];

    days.forEach(day => {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const cell = schedules.find(
        s => s.date === date && s.route_id?.toString() === rt.id.toString()
      );

      if (cell?.employee_id) {
        const emp = employees.find(e => e.id === cell.employee_id);
        row.push(emp ? `${emp.last_name} ${emp.first_name}` : "");
      } else {
        row.push("");
      }
    });

    sheetData.push(row);
  });

  /** === SEPARATOR === **/
  sheetData.push([]);

  /** === LABELS (RAZ) === **/
  labels.forEach(label => {
    const labelRow = [`↳ ${label.code}`];

    days.forEach(day => {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      const names = schedules
        .filter(s => s.date === date && s.label === label.code)
        .map(s => {
          const emp = employees.find(e => e.id === s.employee_id);
          return emp ? `${emp.last_name} ${emp.first_name}` : null;
        })
        .filter(Boolean);

      // ENTER w komórce
      labelRow.push(names.join("\n"));
    });

    sheetData.push(labelRow);
  });

  return sheetData;
};


  // Opcje pracowników dla komórki w widoku TRAS.
  // Pozwala wybrać pracownika nawet jeśli jest już przypisany do TRASY z pary.
  // Blokuje pracowników przypisanych tego dnia do innych (niezwiązanych) tras.
  const getAvailableEmployeesForRouteCell = (routeId, day) => {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    const route = routes.find(r => r.id.toString() === routeId.toString());
    if (!route) {
      return [{ value: '', label: '-- brak --' }];
    }

    return [
      { value: "", label: "-- brak --" },
      ...employees
        .filter(emp => {
          if (hasEmployeeLabelOnDay(emp.id, date, schedules)) return false;
          if (!canAssignEmployeeToRouteWithPair(emp, route, routes, date, schedules)) return false;
          return (
            canEmployeeHaveAnotherRouteOnDay(emp.id, routeId, date, schedules, routes) ||
            canEmployeeHaveAnotherRouteOnDay(emp.id, routeId, date, schedules, routes, {
              allowPairLeg: true,
            })
          );
        })
        .map(emp => ({
          value: emp.id,
          label: `${emp.first_name} ${emp.last_name}${emp.license_category ? ` [${emp.license_category}]` : ''}${emp.special_permissions ? ' [SP]' : ''}`
        }))
    ];
  };

  /*** === NOWE helpery dla widoku pracowników (multi-wpisy) === ***/
  const getCellSchedulesAll = (employeeId, date) =>
    schedules.filter(
      s => s.employee_id?.toString() === employeeId.toString() && s.date === date
    );

  const buildDisplayOptionForEntry = (entry) => {
    if (entry.route_id) {
      const r = routes.find(rr => rr.id.toString() === entry.route_id.toString());
      if (r) return { value: `R:${r.id}`, label: `${r.name} (${calculateDuration(r).toFixed(2)}h)` };
      return { value: `R:${entry.route_id}`, label: `Trasa ID=${entry.route_id}` };
    }
    if (entry.label) return { value: `L:${entry.label}`, label: `${entry.label}` };
    return { value: "", label: "-- brak --" };
  };

  const openDayMenuFor = (day, triggerEl) => {
    const rect = triggerEl.getBoundingClientRect();
    setOpenDayMenu((prev) => {
      if (prev?.day === day) return null;
      return { day, top: rect.bottom + 4, left: rect.right };
    });
  };

  const renderDayHeader = (day) => {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const weekday = new Date(date).getDay();
    let bgColor = '';
    if (weekday === 0) bgColor = 'red';
    else if (weekday === 6) bgColor = 'gray';

    const isOpen = openDayMenu?.day === day;

    return (
      <th key={day} style={{ backgroundColor: bgColor }}>
        <div className="schedule-day-header">
          <span className="schedule-day-header__num">{day}</span>
          <div className="schedule-day-menu">
            <button
              type="button"
              className="schedule-day-menu__trigger"
              title="Opcje dnia"
              aria-label={`Opcje dnia ${day}`}
              aria-expanded={isOpen}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openDayMenuFor(day, e.currentTarget);
              }}
            >
              ⋮
            </button>
          </div>
        </div>
      </th>
    );
  };

  const dayMenuPortal = openDayMenu && createPortal(
    <div
      ref={dayMenuDropdownRef}
      className="schedule-day-menu__dropdown schedule-day-menu__dropdown--fixed"
      style={{ top: openDayMenu.top, left: openDayMenu.left }}
      role="menu"
    >
      <button
        type="button"
        className="schedule-day-menu__item schedule-day-menu__item--danger"
        role="menuitem"
        onClick={() => clearDay(openDayMenu.day)}
      >
        Wyczyść dzień
      </button>
    </div>,
    document.body
  );

  return (
    <div>
      <h2>Ułóż grafik – Widok: {viewType === 'employees' ? "wg Pracowników" : "wg Tras"}</h2>

      <nav className="schedule-month-nav" aria-label="Wybór miesiąca">
        <button
          type="button"
          className="schedule-month-nav__arrow"
          onClick={goToPrevMonth}
          aria-label="Poprzedni miesiąc"
          title="Poprzedni miesiąc"
        >
          ‹
        </button>
        <div className="schedule-month-nav__label">
          <span className="schedule-month-nav__month">{MONTH_NAMES[month - 1]}</span>
          <span className="schedule-month-nav__year">{year}</span>
        </div>
        <button
          type="button"
          className="schedule-month-nav__arrow"
          onClick={goToNextMonth}
          aria-label="Następny miesiąc"
          title="Następny miesiąc"
        >
          ›
        </button>
        <button
          type="button"
          className="schedule-month-nav__today"
          onClick={goToToday}
          title="Przejdź do bieżącego miesiąca"
        >
          Dziś
        </button>
      </nav>

      <div className="schedule-toolbar">
        <button type="button" onClick={handleExportXLSX}>Eksport do XLSX</button>
        <button type="button" onClick={handleExportCSV}>Eksport do CSV</button>
        <button
          type="button"
          className="btn-primary"
          onClick={handleAutoFillRoutes}
          disabled={autoFillRunning}
        >
          {autoFillRunning ? 'Uzupełnianie…' : 'Uzupełnij trasy'}
        </button>
        <button type="button" className="btn-primary" onClick={() => setAssignMonthOpen(true)}>
          Przypisz na cały miesiąc
        </button>
        <button type="button" className="btn-danger" onClick={handleClearMonth}>
          Wyczyść trasy miesiąca
        </button>
      </div>

      {autoFillDebug && (
        <div className="auto-fill-debug">
          <div className="auto-fill-debug__header">
            <strong>Log auto-uzupełniania</strong>
            {autoFillDebug.afterPersist?.summary && (
              <span className="auto-fill-debug__stats">
                Puste dni: {autoFillDebug.afterPersist.summary.emptyEmployeeDays}
                {' · '}
                z trasami w dropdownie: {autoFillDebug.afterPersist.summary.emptyWithAssignableRoutes}
                {' · '}
                wolne trasy: {autoFillDebug.afterPersist.summary.openRouteSlots}
                {' · '}
                deficyt godzin: {autoFillDebug.afterPersist.summary.underHourEmployees}
                {autoFillDebug.persistSkippedCount > 0 && (
                  <> · pominięte zapisy: {autoFillDebug.persistSkippedCount}</>
                )}
              </span>
            )}
            <button
              type="button"
              className="auto-fill-debug__toggle"
              onClick={() => setAutoFillDebugOpen((v) => !v)}
            >
              {autoFillDebugOpen ? 'Zwiń' : 'Rozwiń'}
            </button>
            <button
              type="button"
              className="auto-fill-debug__close"
              onClick={() => setAutoFillDebug(null)}
              title="Zamknij log"
            >
              ×
            </button>
          </div>
          {autoFillDebugOpen && (
            <pre className="auto-fill-debug__log">
              {(autoFillDebug.logs || []).join('\n')}
            </pre>
          )}
        </div>
      )}

      <Popup isOpen={assignMonthOpen} onClose={() => !assignMonthLoading && setAssignMonthOpen(false)}>
        <h3>Przypisz na cały miesiąc</h3>
        <form onSubmit={handleAssignMonth} style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 320 }}>
          <div>
            <label>Pracownik:</label>
            <select
              value={assignMonthEmployeeId}
              onChange={(e) => setAssignMonthEmployeeId(e.target.value)}
              required
            >
              <option value="">-- wybierz --</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.last_name} {emp.first_name}
                  {emp.license_category ? ` [${emp.license_category}]` : ''}
                  {emp.special_permissions ? ' [SP]' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Trasa:</label>
            <select
              value={assignMonthRouteId}
              onChange={(e) => setAssignMonthRouteId(e.target.value)}
              required
            >
              <option value="">-- wybierz --</option>
              {sortRoutesByAssignmentPriority(routes).map((rt) => (
                <option key={rt.id} value={rt.id}>
                  {rt.name} ({calculateDuration(rt).toFixed(2)}h)
                </option>
              ))}
            </select>
          </div>
          <p style={{ margin: 0, fontSize: '0.9em', opacity: 0.85 }}>
            Przypisanie obejmuje każdy dzień kursowania trasy w {month}.{year},
            gdy slot trasy jest wolny i pracownik nie ma innej trasy ani etykiety.
          </p>
          <button type="submit" className="btn-primary" disabled={assignMonthLoading}>
            {assignMonthLoading ? 'Przypisywanie…' : 'Przypisz'}
          </button>
        </form>
      </Popup>

      <div className="btn-tabs schedule-toolbar">
        <button
          type="button"
          className={`btn-tab${viewType === 'employees' ? ' btn-tab--active' : ''}`}
          onClick={() => setViewType('employees')}
        >
          Ułóż wg Pracowników
        </button>
        <button
          type="button"
          className={`btn-tab${viewType === 'routes' ? ' btn-tab--active' : ''}`}
          onClick={() => setViewType('routes')}
        >
          Ułóż wg Tras
        </button>
      </div>

      {viewType === 'employees' && (
        <div
          ref={employeesTableRef}
          style={{ overflowX: 'auto', maxWidth: '100%' }}
          className="schedule-container"
        >
          <table className="schedule-table">
            <thead>
              <tr>
                <th>Pracownik</th>
                {days.map(day => renderDayHeader(day))}
                <th>Godziny miesiąc</th>
                <th>Godziny kwartał</th>
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => (
                <tr key={emp.id}>
                  <td>{emp.last_name} {emp.first_name}</td>
                  {days.map(day => {
                    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

                    const entries = getCellSchedulesAll(emp.id, date);

                    if (entries.length === 0) {
                      // brak wpisów -> edytowalny select do dodania pierwszego wpisu
                      const options = getAvailableOptionsForEmployeeCell(emp.id, day);
                      return (
                        <td key={day}>
                          <select
                            value=""
                            onChange={(e) => updateScheduleCell(emp.id, date, e.target.value)}
                          >
                            {options.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </td>
                      );
                    }

                    // są wpisy -> pokaż każdy jako EDYTOWALNY select; przy trasie próbujemy dodać bliźniaczą tylko jeśli wolna
                    return (
                      <td key={day}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {entries.map((entry) => {
                            const opt = buildDisplayOptionForEntry(entry);
                            const options = getAvailableOptionsForEmployeeCell(emp.id, day);
                            return (
                              <select
                                key={entry.id || `${opt.value}-${date}`}
                                value={opt.value}
                                onChange={(e) => updateExistingEntryInEmployeeCell(entry, date, e.target.value)}
                              >
                                {/* zawsze pokaż aktualną opcję, nawet jeśli nie ma jej w availableOptions */}
                                <option value={opt.value}>{opt.label}</option>
                                {/* opcja usunięcia tego wpisu */}
                                <option value={`D:${entry.id}`}>🗑 Usuń ten wpis</option>
                                {/* pozostałe opcje */}
                                {options
                                  .filter(o => o.value !== opt.value) // bez duplikatu aktualnej
                                  .map(o => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                  ))}
                              </select>
                            );
                          })}
                        </div>
                      </td>
                    );
                  })}
                  <td>{calculateEmployeeHours(emp.id)}</td>
                  <td>{calculateQuarterEmployeeHours(emp.id).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewType === 'routes' && (
        <div className="schedule-routes-container" style={{ overflowX: 'auto', maxWidth: '100%' }} ref={routesTableRef}>
          <table className="schedule-routes" border="1" cellPadding="5">
            <thead>
              <tr>
                <th>Trasa</th>
                {days.map(day => renderDayHeader(day))}
              </tr>
            </thead>
            <tbody>
              {routes.map(rt => {
                const isPaired =
                  rt.linked_route_id != null ||
                  routes.some(r => r.linked_route_id != null && r.linked_route_id.toString() === rt.id.toString());
                return (
                  <tr key={rt.id}>
                    <td>
                      {rt.name} ({calculateDuration(rt).toFixed(2)}h)
                      {isPaired && (
                        <span style={{ marginLeft: 6, opacity: 0.7 }} title="Trasa powiązana (para)">
                          (para)
                        </span>
                      )}
                    </td>
                    {days.map(day => {
                      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                      const cell = schedules.find(s => s.date === date && s.route_id?.toString() === rt.id.toString());
                      const selectedEmployee = cell ? cell.employee_id : "";
                      const options = getAvailableEmployeesForRouteCell(rt.id, day);
                      return (
                        <td key={day}>
                          <select
                            value={selectedEmployee}
                            onChange={(e) => updateScheduleForRouteCell(rt.id, day, e.target.value)}
                          >
                            {/* jeśli jest wpis – pozwól szybko usunąć */}
                            {cell && <option value="DELETE">🗑 Usuń tę trasę (dzień)</option>}
                            {options.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {dayMenuPortal}
    </div>
  );
}

export default ScheduleView;
