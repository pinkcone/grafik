import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { canAssignEmployeeToRouteWithPair, getAssignmentBlockReason, findPairRoute, sortRoutesByAssignmentPriority } from '../utils/routeAssignment';
import { hasEmployeeLabelOnDay } from '../utils/scheduleLabels';
import { getEmployeeRouteSlotCountOnDay, canEmployeeHaveAnotherRouteOnDay } from '../utils/scheduleConstraints';
import { useNotifications } from '../context/NotificationsContext';
import { useDialog } from '../context/DialogContext';
import { getQuarterMonths, daysInMonth, calculateDuration } from '../utils/scheduleViewHelpers';
import { exportScheduleXLSX, exportScheduleCSV } from '../utils/scheduleExport';
import {
  updateCell,
  deleteScheduleEntry,
  clearMonth as apiClearMonth,
  autoFillMonth as apiAutoFillMonth,
  assignMonth as apiAssignMonth,
} from '../api/scheduleApi';
import useScheduleData from '../hooks/useScheduleData';
import useAutoFillNotifications from '../hooks/useAutoFillNotifications';
import ScheduleMonthNav from './schedule/ScheduleMonthNav';
import ScheduleToolbar from './schedule/ScheduleToolbar';
import AutoFillDebugPanel from './schedule/AutoFillDebugPanel';
import AssignMonthModal from './schedule/AssignMonthModal';
import BulkAssignModal from './schedule/BulkAssignModal';
import EmployeesScheduleTable from './schedule/EmployeesScheduleTable';
import RoutesScheduleTable from './schedule/RoutesScheduleTable';
import '../styles/ScheduleView.css';
import '../styles/ScheduleDayMenu.css';

function ScheduleView({ cityId }) {
  const token = localStorage.getItem('token');
  const { notifications, refresh: refreshNotifications } = useNotifications();
  const dialog = useDialog();

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
  const [highlightedEmployeeId, setHighlightedEmployeeId] = useState(null);

  const toggleEmployeeHighlight = (employeeId) => {
    setHighlightedEmployeeId((prev) =>
      (prev?.toString() === employeeId.toString() ? null : employeeId)
    );
  };

  const { employees, routes, labels, schedules, quarterSchedules, refetch } =
    useScheduleData(cityId, month, year, token);

  const employeesTableRef = useRef(null);
  const routesTableRef = useRef(null);
  const dayMenuDropdownRef = useRef(null);

  const [openDayMenu, setOpenDayMenu] = useState(null);

  const [assignMonthOpen, setAssignMonthOpen] = useState(false);
  const [assignMonthEmployeeId, setAssignMonthEmployeeId] = useState('');
  const [assignMonthRouteId, setAssignMonthRouteId] = useState('');
  const [assignMonthLoading, setAssignMonthLoading] = useState(false);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkEmployeeId, setBulkEmployeeId] = useState('');
  const [bulkValue, setBulkValue] = useState(''); // 'R:<id>' lub 'L:<code>'
  const [bulkDays, setBulkDays] = useState([]); // numery dni wybrane w kalendarzu
  const [bulkLoading, setBulkLoading] = useState(false);

  const [autoFillDebug, setAutoFillDebug] = useState(null);
  const [autoFillDebugOpen, setAutoFillDebugOpen] = useState(true);

  const applyDebug = useCallback((debug) => {
    setAutoFillDebug(debug);
    setAutoFillDebugOpen(true);
  }, []);

  const autoFillRunning = useAutoFillNotifications({
    cityId,
    month,
    year,
    notifications,
    applyDebug,
    refetch,
  });

  useEffect(() => {
    setOpenDayMenu(null);
  }, [month, year, viewType]);

  useEffect(() => {
    setHighlightedEmployeeId(null);
  }, [month, year, cityId]);

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

  /*** === POWIĄZANE TRASY (linked_route_id) === ***/

  // Zwróć ID trasy bliźniaczej (drugi element pary) – działa dwukierunkowo; brak → null
  const getPairRoute = (routeId) => {
    const idStr = routeId.toString();
    const rt = routes.find(r => r.id.toString() === idStr);
    if (rt && rt.linked_route_id != null) return Number(rt.linked_route_id);
    const reverse = routes.find(r => r.linked_route_id != null && r.linked_route_id.toString() === idStr);
    if (reverse) return Number(reverse.id);
    return null;
  };

  // Znajdź wpis dla (date, route_id)
  const findScheduleForRoute = (date, routeId) =>
    schedules.find(s => s.date === date && s.route_id?.toString() === routeId.toString());

  // Czy trasa jest zajęta przez INNEGO pracownika (tego dnia)?
  const isRouteAssignedToAnotherEmployee = (date, routeId, employeeId) => {
    const s = findScheduleForRoute(date, routeId);
    return !!(s && s.employee_id?.toString() !== (employeeId?.toString() ?? ''));
  };

  // PUT trasy w danym dniu (backend tworzy/aktualizuje po {date, route_id})
  const putRouteCell = (date, routeId, employeeId) =>
    updateCell(
      { date, route_id: Number(routeId), employee_id: employeeId || null, label: null },
      token
    );

  // Dokłada trasę bliźniaczą TYLKO gdy wolna od innego i nie przypisana już temu samemu.
  const addPairIfFree = async (date, routeId, employeeId) => {
    const pairId = getPairRoute(routeId);
    if (pairId == null) return;
    const takenByOther = isRouteAssignedToAnotherEmployee(date, pairId, employeeId);
    const pairSched = findScheduleForRoute(date, pairId);
    const alreadySame = !!pairSched && pairSched.employee_id?.toString() === employeeId.toString();
    if (!takenByOther && !alreadySame) {
      await putRouteCell(date, pairId, employeeId);
    }
  };

  /** ================= EMPLOYEE VIEW: CREATE/UPDATE ================= */

  // Dodanie pierwszego wpisu w danym dniu (gdy brak wpisów).
  const updateScheduleCell = async (employeeId, date, newValue) => {
    let route_id = null, label = null;
    if (newValue.startsWith("R:")) route_id = Number(newValue.substring(2));
    else if (newValue.startsWith("L:")) label = newValue.substring(2);

    try {
      if (route_id) {
        assertEmployeeCanTakeRoute(employeeId, route_id, date);
        await putRouteCell(date, route_id, employeeId);
        await addPairIfFree(date, route_id, employeeId);
      } else {
        await updateCell({ date, employee_id: employeeId, route_id: null, label }, token);
      }
      await refetch();
    } catch (error) {
      await dialog.alert(`Błąd aktualizacji grafiku: ${error.message}`, { title: 'Błąd', danger: true });
    }
  };

  // Edycja KONKRETNEGO wpisu (gdy w komórce jest wiele wpisów).
  const updateExistingEntryInEmployeeCell = async (entry, date, newValue) => {
    if (newValue.startsWith("D:")) {
      const sure = await dialog.confirm('Na pewno usunąć ten wpis?', { danger: true, confirmText: 'Usuń' });
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
        await putRouteCell(date, route_id, entry.employee_id);
        await addPairIfFree(date, route_id, entry.employee_id);
      } else {
        await updateCell(
          {
            date,
            employee_id: entry.employee_id,
            route_id: null,
            label: label ?? null,
            schedule_id: entry.id ?? null,
            prev_route_id: entry.route_id ?? null,
          },
          token
        );
      }
      await refetch();
    } catch (error) {
      await dialog.alert(`Błąd aktualizacji wpisu: ${error.message}`, { title: 'Błąd', danger: true });
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

  /** ================= USUWANIE ================= */

  const deleteSchedule = async (scheduleId) => {
    try {
      await deleteScheduleEntry(scheduleId, token);
      await refetch();
    } catch (e) {
      await dialog.alert(`Nie udało się usunąć wpisu: ${e.message || e}`, { title: 'Błąd', danger: true });
    }
  };

  const clearDay = async (day) => {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const entries = schedules.filter(s => s.date === date);

    if (entries.length === 0) {
      setOpenDayMenu(null);
      await dialog.alert('Brak wpisów w tym dniu.');
      return;
    }

    setOpenDayMenu(null);
    const ok = await dialog.confirm(
      `Wyczyścić dzień ${day}.${month}.${year}?\nUsunie ${entries.length} wpis(ów) z grafiku.`,
      { title: 'Wyczyść dzień', danger: true, confirmText: 'Wyczyść' }
    );
    if (!ok) return;

    try {
      await Promise.all(entries.map(e => deleteScheduleEntry(e.id, token)));
      await refetch();
    } catch (e) {
      await dialog.alert(`Nie udało się wyczyścić dnia: ${e.message || e}`, { title: 'Błąd', danger: true });
      await refetch();
    }
  };

  // Usuwa z dnia tylko wpisy z auto-uzupełniania (trasy i etykiety algorytmu, np. DW5).
  const clearDayAuto = async (day) => {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const entries = schedules.filter(
      s => s.date === date && (s.auto_filled === true || s.auto_filled === 1)
    );

    if (entries.length === 0) {
      setOpenDayMenu(null);
      await dialog.alert('Brak wpisów z auto-uzupełniania w tym dniu.');
      return;
    }

    setOpenDayMenu(null);
    const ok = await dialog.confirm(
      `Usunąć wpisy z auto-uzupełniania w dniu ${day}.${month}.${year}?\n` +
      `Usunie ${entries.length} wpis(ów) dodanych przez algorytm (trasy i etykiety, np. DW5). Ręczne wpisy zostaną.`,
      { title: 'Wyczyść auto', danger: true, confirmText: 'Usuń auto' }
    );
    if (!ok) return;

    try {
      await Promise.all(entries.map(e => deleteScheduleEntry(e.id, token)));
      await refetch();
    } catch (e) {
      await dialog.alert(`Nie udało się wyczyścić dnia: ${e.message || e}`, { title: 'Błąd', danger: true });
      await refetch();
    }
  };

  // Widok TRAS – przypisanie/odpięcie pracownika (bliźniaczą dokładamy tylko gdy wolna).
  const updateScheduleForRouteCell = async (routeId, day, employeeIdRaw) => {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const employeeId = employeeIdRaw === '' ? null : (employeeIdRaw === 'DELETE' ? 'DELETE' : Number(employeeIdRaw));

    try {
      const currentCell = findScheduleForRoute(date, routeId);

      if (employeeId === 'DELETE' && currentCell) {
        const ok = await dialog.confirm('Na pewno usunąć przypisanie tej trasy w tym dniu?', { danger: true, confirmText: 'Usuń' });
        if (!ok) return;
        await deleteSchedule(currentCell.id);
        return;
      }

      if (employeeId != null) {
        assertEmployeeCanTakeRoute(employeeId, routeId, date);
      }
      await putRouteCell(date, routeId, employeeId);

      if (employeeId != null) {
        await addPairIfFree(date, routeId, employeeId);
      }

      await refetch();
    } catch (error) {
      await dialog.alert(`Błąd aktualizacji grafiku: ${error.message}`, { title: 'Błąd', danger: true });
    }
  };

  /** ================= AGREGACJE ================= */

  const getSchedulesForMonth = (m) => {
    if (m === month) return schedules;
    return quarterSchedules[m] || [];
  };

  const daysInM = (m, y) => new Date(y, m, 0).getDate();

  const sumEmployeeHours = (employeeId, m, monthSchedules) => {
    const dim = daysInM(m, year);
    let total = 0;
    const employee = employees.find(e => e.id === employeeId);
    const partTime = employee ? (employee.part_time ?? 1.0) : 1.0;

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

  const calculateEmployeeHoursForMonth = (employeeId, m) =>
    sumEmployeeHours(employeeId, m, getSchedulesForMonth(m));

  const calculateEmployeeHours = (employeeId) =>
    sumEmployeeHours(employeeId, month, schedules).toFixed(2);

  const calculateQuarterEmployeeHours = (employeeId) => {
    const qMonths = getQuarterMonths(month);
    return qMonths.reduce((sum, m) => sum + calculateEmployeeHoursForMonth(employeeId, m), 0);
  };

  /** ================= EKSPORT / AKCJE ================= */

  const handleExportXLSX = () =>
    exportScheduleXLSX({ employees, routes, labels, schedules, days, year, month, calculateEmployeeHours });

  const handleExportCSV = () =>
    exportScheduleCSV({ employees, routes, schedules, year, month, cityId });

  const handleClearMonth = async () => {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    const autoCount = schedules.filter(
      (s) => s.date.startsWith(prefix) && (s.auto_filled === true || s.auto_filled === 1)
    ).length;

    const ok = await dialog.confirm(
      `Wyczyścić wpisy z auto-uzupełniania za ${month}.${year}?\n` +
      (autoCount > 0
        ? `Usunie ${autoCount} wpisów dodanych przez „Uzupełnij trasy” (trasy i etykiety, np. DW5). Ręczne wpisy zostaną.`
        : 'Brak wpisów z auto-uzupełniania do usunięcia w tym miesiącu.'),
      { title: 'Wyczyść auto miesiąca', danger: true, confirmText: 'Wyczyść' }
    );
    if (!ok) return;

    try {
      const { ok: resOk, status, data } = await apiClearMonth(cityId, month, year, token);
      if (!resOk) throw new Error(data.message || `HTTP ${status}`);
      await dialog.alert(data.message || 'Miesiąc wyczyszczony.');
      await refetch();
    } catch (error) {
      await dialog.alert(`Nie udało się wyczyścić miesiąca: ${error.message}`, { title: 'Błąd', danger: true });
    }
  };

  const handleAutoFillRoutes = async () => {
    const ok = await dialog.confirm(
      'Uzupełnić puste sloty tras w tym miesiącu?\n\n' +
      'Najpierw każdy wolny kierowca dostaje po jednej trasie dziennie (bez drugiej trasy).\n' +
      'Godziny są rozkładane wg części etatu (pn–pt × 8h × etat).\n' +
      'Etykieta i trasa tego samego dnia się wykluczają.\n' +
      'Trasy sobotnie z auto-uzupełniania dostają DW5, jeśli jest wolny dzień w nast. tygodniu.\n' +
      'Brakujące DW5 po ręcznie dodanych trasach sobotnich też zostaną dopisane.\n' +
      'Etykiety (urlopy itd.) nie zostaną zmienione.',
      { title: 'Uzupełnij trasy', confirmText: 'Uzupełnij' }
    );
    if (!ok) return;

    try {
      const { ok: resOk, status, data } = await apiAutoFillMonth(cityId, month, year, token);
      if (!resOk) throw new Error(data.message || `HTTP ${status}`);

      if (status === 202) {
        refreshNotifications();
        await dialog.alert(
          data.message ||
            'Uzupełnianie tras działa na serwerze w tle. Możesz zamknąć przeglądarkę — ' +
              'wynik pojawi się w powiadomieniach (dzwonek w nagłówku).'
        );
        return;
      }

      if (data.debug) applyDebug(data.debug);
      await dialog.alert(data.message || `Uzupełniono ${data.created || 0} przypisań.`);
      await refetch();
    } catch (error) {
      await dialog.alert(`Nie udało się uruchomić auto-uzupełniania: ${error.message}`, { title: 'Błąd', danger: true });
    }
  };

  const handleAssignMonth = async (e) => {
    e.preventDefault();
    if (!assignMonthEmployeeId || !assignMonthRouteId) {
      await dialog.alert('Wybierz pracownika i trasę.');
      return;
    }

    const employee = employees.find((emp) => emp.id.toString() === assignMonthEmployeeId);
    const route = routes.find((rt) => rt.id.toString() === assignMonthRouteId);
    const ok = await dialog.confirm(
      `Przypisać ${employee?.last_name} ${employee?.first_name} na trasę „${route?.name}” ` +
      `na cały ${month}.${year}?\n\n` +
      'Tylko wolne dni kursowania tej trasy, bez nadpisywania istniejących przypisań.\n' +
      'DW5 po sobotach zostanie dopisane automatycznie, jeśli jest wolny dzień w nast. tygodniu.',
      { title: 'Przypisz na cały miesiąc', confirmText: 'Przypisz' }
    );
    if (!ok) return;

    setAssignMonthLoading(true);
    try {
      const { ok: resOk, status, data } = await apiAssignMonth(
        cityId,
        month,
        year,
        {
          employee_id: Number(assignMonthEmployeeId),
          route_id: Number(assignMonthRouteId),
        },
        token
      );
      if (!resOk) throw new Error(data.message || `HTTP ${status}`);
      await dialog.alert(data.message || `Przypisano ${data.created || 0} dni.`);
      setAssignMonthOpen(false);
      setAssignMonthEmployeeId('');
      setAssignMonthRouteId('');
      await refetch();
    } catch (error) {
      await dialog.alert(`Nie udało się przypisać trasy: ${error.message}`, { title: 'Błąd', danger: true });
    } finally {
      setAssignMonthLoading(false);
    }
  };

  const toggleBulkDay = (day) => {
    setBulkDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const resetBulkForm = () => {
    setBulkEmployeeId('');
    setBulkValue('');
    setBulkDays([]);
  };

  // Zbiorcze przypisanie trasy/etykiety wybranemu pracownikowi na zaznaczone dni.
  const handleBulkAssign = async (e) => {
    e.preventDefault();
    if (!bulkEmployeeId) {
      await dialog.alert('Wybierz pracownika.');
      return;
    }
    if (!bulkValue) {
      await dialog.alert('Wybierz trasę lub etykietę.');
      return;
    }
    if (bulkDays.length === 0) {
      await dialog.alert('Zaznacz przynajmniej jeden dzień w kalendarzu.');
      return;
    }

    const employeeId = Number(bulkEmployeeId);
    const isRoute = bulkValue.startsWith('R:');
    const routeId = isRoute ? Number(bulkValue.substring(2)) : null;
    const label = !isRoute ? bulkValue.substring(2) : null;

    const sortedDays = [...bulkDays].sort((a, b) => a - b);
    setBulkLoading(true);

    const failures = [];
    let done = 0;

    for (const day of sortedDays) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      try {
        if (isRoute) {
          assertEmployeeCanTakeRoute(employeeId, routeId, date);
          await putRouteCell(date, routeId, employeeId);
          await addPairIfFree(date, routeId, employeeId);
        } else {
          await updateCell({ date, employee_id: employeeId, route_id: null, label }, token);
        }
        done += 1;
      } catch (err) {
        failures.push(`${day}.${month}: ${err.message || err}`);
      }
    }

    await refetch();
    setBulkLoading(false);

    if (failures.length === 0) {
      setBulkOpen(false);
      resetBulkForm();
      await dialog.alert(`Przypisano na ${done} dni.`);
    } else {
      await dialog.alert(
        `Przypisano na ${done} dni. Pominięto ${failures.length}:\n` +
        failures.slice(0, 12).join('\n') +
        (failures.length > 12 ? `\n…i ${failures.length - 12} więcej` : ''),
        { title: 'Częściowo przypisano', danger: true }
      );
    }
  };

  /*** === helpery renderowania === ***/

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

  // Opcje pracowników dla komórki w widoku TRAS.
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
            canEmployeeHaveAnotherRouteOnDay(emp.id, routeId, date, schedules, routes, {
              licenseCategory: emp.license_category ?? null,
            }) ||
            canEmployeeHaveAnotherRouteOnDay(emp.id, routeId, date, schedules, routes, {
              licenseCategory: emp.license_category ?? null,
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
        className="schedule-day-menu__item"
        role="menuitem"
        onClick={() => clearDayAuto(openDayMenu.day)}
      >
        Wyczyść auto (trasy + DW5)
      </button>
      <button
        type="button"
        className="schedule-day-menu__item schedule-day-menu__item--danger"
        role="menuitem"
        onClick={() => clearDay(openDayMenu.day)}
      >
        Wyczyść dzień (wszystko)
      </button>
    </div>,
    document.body
  );

  return (
    <div>
      <h2>Ułóż grafik – Widok: {viewType === 'employees' ? "wg Pracowników" : "wg Tras"}</h2>

      <ScheduleMonthNav
        month={month}
        year={year}
        onPrev={goToPrevMonth}
        onNext={goToNextMonth}
        onToday={goToToday}
      />

      <ScheduleToolbar
        onExportXLSX={handleExportXLSX}
        onExportCSV={handleExportCSV}
        onAutoFill={handleAutoFillRoutes}
        autoFillRunning={autoFillRunning}
        onAssignMonth={() => setAssignMonthOpen(true)}
        onBulkAssign={() => setBulkOpen(true)}
        onClearMonth={handleClearMonth}
      />

      <AutoFillDebugPanel
        debug={autoFillDebug}
        open={autoFillDebugOpen}
        onToggle={() => setAutoFillDebugOpen((v) => !v)}
        onClose={() => setAutoFillDebug(null)}
      />

      <AssignMonthModal
        isOpen={assignMonthOpen}
        loading={assignMonthLoading}
        employees={employees}
        routes={routes}
        month={month}
        year={year}
        employeeId={assignMonthEmployeeId}
        routeId={assignMonthRouteId}
        onEmployeeChange={setAssignMonthEmployeeId}
        onRouteChange={setAssignMonthRouteId}
        onSubmit={handleAssignMonth}
        onClose={() => setAssignMonthOpen(false)}
      />

      <BulkAssignModal
        isOpen={bulkOpen}
        loading={bulkLoading}
        employees={employees}
        routes={routes}
        labels={labels}
        month={month}
        year={year}
        days={days}
        employeeId={bulkEmployeeId}
        value={bulkValue}
        selectedDays={bulkDays}
        onEmployeeChange={setBulkEmployeeId}
        onValueChange={setBulkValue}
        onToggleDay={toggleBulkDay}
        onClearDays={() => setBulkDays([])}
        onSubmit={handleBulkAssign}
        onClose={() => {
          setBulkOpen(false);
          resetBulkForm();
        }}
      />

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
        <EmployeesScheduleTable
          tableRef={employeesTableRef}
          employees={employees}
          days={days}
          year={year}
          month={month}
          highlightedEmployeeId={highlightedEmployeeId}
          onToggleEmployeeHighlight={toggleEmployeeHighlight}
          renderDayHeader={renderDayHeader}
          getCellSchedulesAll={getCellSchedulesAll}
          getAvailableOptionsForEmployeeCell={getAvailableOptionsForEmployeeCell}
          buildDisplayOptionForEntry={buildDisplayOptionForEntry}
          updateScheduleCell={updateScheduleCell}
          updateExistingEntryInEmployeeCell={updateExistingEntryInEmployeeCell}
          calculateEmployeeHours={calculateEmployeeHours}
          calculateQuarterEmployeeHours={calculateQuarterEmployeeHours}
        />
      )}

      {viewType === 'routes' && (
        <RoutesScheduleTable
          tableRef={routesTableRef}
          routes={routes}
          schedules={schedules}
          days={days}
          year={year}
          month={month}
          renderDayHeader={renderDayHeader}
          getAvailableEmployeesForRouteCell={getAvailableEmployeesForRouteCell}
          updateScheduleForRouteCell={updateScheduleForRouteCell}
        />
      )}
      {dayMenuPortal}
    </div>
  );
}

export default ScheduleView;
