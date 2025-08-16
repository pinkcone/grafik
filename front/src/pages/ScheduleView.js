import React, { useState, useEffect, useRef } from 'react';
import { useReactToPrint } from 'react-to-print';
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

  const handlePrintEmployees = useReactToPrint({
    content: () => employeesTableRef.current,
    documentTitle: 'Grafik - Widok Pracowników'
  });
  const handlePrintRoutes = useReactToPrint({
    content: () => routesTableRef.current,
    documentTitle: 'Grafik - Widok Tras'
  });
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
      console.log("Fetched schedule:", data);
      setSchedules(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error fetching schedule:", error);
    }
  };

  const daysInMonth = (m, y) => new Date(y, m, 0).getDate();
  const days = [];
  for (let d = 1; d <= daysInMonth(month, year); d++) {
    days.push(d);
  }

  const updateScheduleCell = async (employeeId, date, newValue) => {
    let route_id = null, label = null;
    if (newValue.startsWith("R:")) {
      route_id = newValue.substring(2);
    } else if (newValue.startsWith("L:")) {
      label = newValue.substring(2);
    }
    console.log("Updating schedule (employee view):", { employeeId, date, route_id, label });
    try {
      const res = await fetch(`/api/schedule/update-cell`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        cache: 'no-store',
        body: JSON.stringify({ date, employee_id: employeeId, route_id, label })
      });
      if (!res.ok) {
        const data = await res.json();
        console.error("Error updating schedule (employee view):", data);
        alert(data.message || "Błąd aktualizacji grafiku");
      }
      await fetchSchedule();
      await fetchQuarterSchedules();
    } catch (error) {
      console.error("Update schedule error (employee view):", error);
      alert("Błąd aktualizacji grafiku (exception)");
    }
  };

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

  const updateScheduleForRouteCell = async (routeId, day, employeeId) => {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    console.log("Updating schedule (route view):", { date, routeId, employeeId });
    try {
      const res = await fetch(`/api/schedule/update-cell`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        cache: 'no-store',
        body: JSON.stringify({ date, employee_id: employeeId, route_id: routeId, label: null })
      });
      if (!res.ok) {
        const data = await res.json();
        console.error("Error updating schedule (route view):", data);
        alert(data.message || "Błąd aktualizacji grafiku");
      }
      await fetchSchedule();
      await fetchQuarterSchedules();
    } catch (error) {
      console.error("Update schedule error (route view):", error);
      alert("Błąd aktualizacji grafiku (exception)");
    }
  };

  const getSchedulesForMonth = (m) => {
    if (m === month) return schedules;
    return quarterSchedules[m] || [];
  };

  const calculateEmployeeHoursForMonth = (employeeId, m) => {
    const dim = daysInM(m, year);
    let total = 0;

    const employee = employees.find(e => e.id === employeeId);
    const partTime = employee ? (employee.part_time ?? 1.0) : 1.0;

    const monthSchedules = getSchedulesForMonth(m);

    for (let d = 1; d <= dim; d++) {
      const date = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const cell = monthSchedules.find(s => s.employee_id === employeeId && s.date === date);
      if (!cell) continue;

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
    return total;
  };

  const calculateQuarterEmployeeHours = (employeeId) => {
    const qMonths = getQuarterMonths(month);
    return qMonths.reduce((sum, m) => sum + calculateEmployeeHoursForMonth(employeeId, m), 0);
  };

  const getAvailableEmployeesForRouteCell = (routeId, day) => {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const assignedEmployeeIds = schedules
      .filter(s => s.date === date && s.route_id)
      .map(s => s.employee_id.toString());
    const availableEmployees = employees.filter(emp => {
      const empId = emp.id.toString();

      return (!assignedEmployeeIds.includes(empId)) ||
        (schedules.find(s => s.date === date && s.route_id?.toString() === routeId.toString() && s.employee_id.toString() === empId));
    });
    return [{ value: "", label: "-- brak --" }, ...availableEmployees.map(emp => ({
      value: emp.id,
      label: `${emp.first_name} ${emp.last_name}`
    }))];
  };

  const daysInM = (m, y) => new Date(y, m, 0).getDate();
  const calculateEmployeeHours = (employeeId) => {
    const dim = daysInM(month, year);
    let total = 0;

    const employee = employees.find(e => e.id === employeeId);
    const partTime = employee ? employee.part_time : 1.0;

    for (let d = 1; d <= dim; d++) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const cell = schedules.find(s => s.employee_id === employeeId && s.date === date);

      if (!cell) continue;
      if (cell.route_id) {
        const route = routes.find(r => r.id.toString() === cell.route_id.toString());
        if (route) {
          total += calculateDuration(route);
        }
      }
      else if (cell.label) {
        const labelObj = labels.find(l => l.code === cell.label);
        if (labelObj) {
          total += (labelObj.default_hours * partTime);
        }
      }
    }

    return total.toFixed(2);
  };

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
        if (endMinutes < startMinutes) {
          endMinutes += 24 * 60;
        }
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
        const cell = schedules.find(s => s.employee_id === emp.id && s.date === date);
        let cellValue = "";
        if (cell) {
          if (cell.route_id) {
            const route = routes.find(r => r.id.toString() === cell.route_id.toString());
            if (route) {
              let wh = route.working_hours;
              if (typeof wh === "string") {
                try {
                  wh = JSON.parse(wh);
                } catch (e) {
                  console.error("Error parsing working_hours:", e);
                  wh = null;
                }
              }
              if (wh && Array.isArray(wh.segments) && wh.segments.length > 0) {
                cellValue = wh.segments
                  .map(seg => `${seg.start}-${seg.end}`)
                  .join("\n");
              }
            } else {
              cellValue = `RouteID=${cell.route_id}`;
            }
          } else if (cell.label) {
            cellValue = `${cell.label}`;
          }
        }
        row.push(cellValue);
      });
      row.push(calculateEmployeeHours(emp.id));
      sheetData.push(row);
    });

    return sheetData;
  };

  const prepareRoutesSheet = () => {
    const header = ["Trasa", ...days.map(d => `Dzień ${d}`)];
    const sheetData = [header];

    routes.forEach(rt => {
      const row = [`${rt.name} (${calculateDuration(rt).toFixed(2)}h)`];
      days.forEach(day => {
        const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const cell = schedules.find(s => s.date === date && s.route_id?.toString() === rt.id.toString());
        let cellValue = "";
        if (cell && cell.employee_id) {
          const emp = employees.find(e => e.id === cell.employee_id);
          if (emp) {
            cellValue = `${emp.last_name} ${emp.first_name}`;
          } else {
            cellValue = `EmpID=${cell.employee_id}`;
          }
        }
        row.push(cellValue);
      });
      sheetData.push(row);
    });

    return sheetData;
  };

  return (
    <div>
      <h2>Ułóż grafik – Widok: {viewType === 'employees' ? "wg Pracowników" : "wg Tras"}</h2>

      <div style={{ marginBottom: '10px' }}>
        <button onClick={handleExportXLSX}>Eksport do XLSX</button>
        {viewType === 'employees' && (
          <button onClick={handlePrintEmployees}>Drukuj Widok Pracowników</button>
        )}
        {viewType === 'routes' && (
          <button onClick={handlePrintRoutes}>Drukuj Widok Tras</button>
        )}
      </div>

      <div style={{ marginBottom: '10px' }}>
        <label>Miesiąc: </label>
        <select value={month} onChange={(e) => setMonth(parseInt(e.target.value))}>
          {[...Array(12).keys()].map(i => (
            <option key={i + 1} value={i + 1}>{i + 1}</option>
          ))}
        </select>
        <label> Rok: </label>
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(parseInt(e.target.value))}
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
          style={{
            overflowX: 'auto',
            maxWidth: '100%',
          }}
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
                    const cell = schedules.find(s => s.employee_id === emp.id && s.date === date);
                    let currentValue = "";
                    if (cell) {
                      if (cell.route_id) currentValue = "R:" + cell.route_id;
                      else if (cell.label) currentValue = "L:" + cell.label;
                    }
                    const options = getAvailableOptionsForEmployeeCell(emp.id, day);
                    return (
                      <td key={day}>
                        <select
                          value={currentValue}
                          onChange={(e) => updateScheduleCell(emp.id, date, e.target.value)}
                        >
                          {options.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
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
        <div ref={routesTableRef}>
          <table border="1" cellPadding="5">
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
                return (
                  <tr key={rt.id}>
                    <td>{rt.name} ({calculateDuration(rt).toFixed(2)}h)</td>
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
