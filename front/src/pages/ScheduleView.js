import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import '../styles/ScheduleView.css';

const backendUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';

const quaters = [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]];
const getQuarterMonths = (m) => quaters.find(q => q.includes(m)) || [];

function ScheduleView({ cityId }) {
  const token = localStorage.getItem('token');

  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());

  const [viewType, setViewType] = useState('employees');

  const [employees, setEmployees] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [labels, setLabels] = useState([]);
  const [schedules, setSchedules] = useState([]);

  const employeesTableRef = useRef(null);
  const routesTableRef = useRef(null);

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
        console.error("Error fetching quarter schedule for month", m, e);
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

  const fetchEmployees = async () => {
    try {
      const res = await fetch(`/api/employees/city/${cityId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
        cache: 'no-store'
      });
      const data = await res.json();
      setEmployees(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error fetching employees:", error);
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
      console.error("Error fetching routes:", error);
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
      console.error("Error fetching labels:", error);
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
      console.error("Error fetching schedule:", error);
    }
  };

  const daysInMonth = (m, y) => new Date(y, m, 0).getDate();
  const days = [];
  for (let d = 1; d <= daysInMonth(month, year); d++) days.push(d);

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
      console.error("Update schedule error (employee view):", error);
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
      console.error("Update specific entry error:", error);
      alert(`Błąd aktualizacji wpisu: ${error.message}`);
    }
  };

  /** ================= OPTIONS (EMPLOYEE VIEW) ================= */

  const getAvailableOptionsForEmployeeCell = (employeeId, day) => {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const assignedRouteIds = schedules
      .filter(s => s.date === date && s.route_id && s.employee_id !== employeeId)
      .map(s => s.route_id.toString());

    const availableRoutes = routes.filter(r => !assignedRouteIds.includes(r.id.toString()));

    const routeOptions = availableRoutes.map(r => ({
      value: `R:${r.id}`,
      label: `${r.name} (${calculateDuration(r).toFixed(2)}h)`
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
  const deleteSchedule = async (scheduleId) => {
    try {
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
          msg = data.message || msg;
        } catch { }
        throw new Error(msg);
      }

      await fetchSchedule();
      await fetchQuarterSchedules();
    } catch (e) {
      console.error('Delete schedule error:', e);
      alert(`Nie udało się usunąć wpisu: ${e.message || e}`);
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
      console.error("Update schedule error (route pair):", error);
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
      const cells = monthSchedules.filter(s => s.employee_id === employeeId && s.date === date);

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
      const cells = schedules.filter(s => s.employee_id === employeeId && s.date === date);

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
        console.error("Error parsing working_hours:", e);
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
    XLSX.utils.book_append_sheet(wb, wsEmployees, "Grafik-Pracownicy");

    const wsRoutes = XLSX.utils.aoa_to_sheet(wsDataRoutes);
    XLSX.utils.book_append_sheet(wb, wsRoutes, "Grafik-Trasy");

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

    saveAs(new Blob([wbout], { type: "application/octet-stream" }), 'grafik.xlsx');
  };

  const prepareEmployeesSheet = () => {
    const header = ["Pracownik", ...days.map(d => `${d}`), "Suma godzin"];
    const sheetData = [header];

    employees.forEach(emp => {
      const row = [`${emp.last_name} ${emp.first_name}`];
      days.forEach(day => {
        const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const cells = schedules.filter(s => s.employee_id === emp.id && s.date === date);
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

    routes.forEach(rt => {
      const row = [`${rt.name}`];
      days.forEach(day => {
        const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const cell = schedules.find(s => s.date === date && s.route_id?.toString() === rt.id.toString());
        let cellValue = "";
        if (cell && cell.employee_id) {
          const emp = employees.find(e => e.id === cell.employee_id);
          cellValue = emp ? `${emp.last_name} ${emp.first_name}` : `EmpID=${cell.employee_id}`;
        }
        row.push(cellValue);
      });
      sheetData.push(row);
    });

    return sheetData;
  };

  // Opcje pracowników dla komórki w widoku TRAS.
  // Pozwala wybrać pracownika nawet jeśli jest już przypisany do TRASY z pary.
  // Blokuje pracowników przypisanych tego dnia do innych (niezwiązanych) tras.
  const getAvailableEmployeesForRouteCell = (routeId, day) => {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    // Zbierz ID tras z pary (ta + powiązana)
    const pairIds = new Set(getPairRouteIdsIncludingSelf(routeId).map(String));

    // Mapa: route_id -> set(employee_id) tego dnia
    const assignedByRoute = schedules
      .filter(s => s.date === date && s.route_id)
      .reduce((map, s) => {
        const rid = s.route_id.toString();
        if (!map.has(rid)) map.set(rid, new Set());
        map.get(rid).add(s.employee_id.toString());
        return map;
      }, new Map());

    // Zbiór wszystkich pracowników przypisanych do jakiejkolwiek trasy tego dnia
    const assignedAnywhere = new Set(
      schedules
        .filter(s => s.date === date && s.route_id)
        .map(s => s.employee_id.toString())
    );

    return [
      { value: "", label: "-- brak --" },
      ...employees
        .filter(emp => {
          const empId = emp.id.toString();

          // Jeśli pracownik jest już na którejś trasie z pary → dopuść (żeby móc edytować)
          for (const rid of pairIds) {
            if (assignedByRoute.get(rid)?.has(empId)) return true;
          }

          // W przeciwnym razie – dopuść tylko, jeśli NIE jest przypisany nigdzie indziej tego dnia
          return !assignedAnywhere.has(empId);
        })
        .map(emp => ({
          value: emp.id,
          label: `${emp.first_name} ${emp.last_name}`
        }))
    ];
  };

  /*** === NOWE helpery dla widoku pracowników (multi-wpisy) === ***/
  const getCellSchedulesAll = (employeeId, date) =>
    schedules.filter(s => s.employee_id === employeeId && s.date === date);

  const buildDisplayOptionForEntry = (entry) => {
    if (entry.route_id) {
      const r = routes.find(rr => rr.id.toString() === entry.route_id.toString());
      if (r) return { value: `R:${r.id}`, label: `${r.name} (${calculateDuration(r).toFixed(2)}h)` };
      return { value: `R:${entry.route_id}`, label: `Trasa ID=${entry.route_id}` };
    }
    if (entry.label) return { value: `L:${entry.label}`, label: `${entry.label}` };
    return { value: "", label: "-- brak --" };
  };

  return (
    <div>
      <h2>Ułóż grafik – Widok: {viewType === 'employees' ? "wg Pracowników" : "wg Tras"}</h2>

      <div style={{ marginBottom: '10px' }}>
        <button onClick={handleExportXLSX}>Eksport do XLSX</button>
      </div>

      <div style={{ marginBottom: '10px' }}>
        <label>Miesiąc: </label>
        <select value={month} onChange={(e) => setMonth(parseInt(e.target.value, 10))}>
          {[...Array(12).keys()].map(i => (
            <option key={i + 1} value={i + 1}>{i + 1}</option>
          ))}
        </select>
        <label> Rok: </label>
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(parseInt(e.target.value, 10))}
          style={{ width: '80px' }}
        />
      </div>

      <div style={{ marginBottom: '10px' }}>
        <button onClick={() => setViewType('employees')}>Ułóż wg Pracowników</button>
        <button onClick={() => setViewType('routes')}>Ułóż wg Tras</button>
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
                {days.map(day => {
                  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const weekday = new Date(date).getDay();
                  let bgColor = '';
                  if (weekday === 0) bgColor = 'red';
                  else if (weekday === 6) bgColor = 'gray';
                  return <th key={day} style={{ backgroundColor: bgColor }}>{day}</th>;
                })}
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
                {days.map(day => {
                  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const weekday = new Date(date).getDay();
                  let bgColor = '';
                  if (weekday === 0) bgColor = 'red';
                  else if (weekday === 6) bgColor = 'gray';
                  return <th key={day} style={{ backgroundColor: bgColor }}>{day}</th>;
                })}
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
    </div>
  );
}

export default ScheduleView;
