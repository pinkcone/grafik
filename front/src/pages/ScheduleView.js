// src/pages/ScheduleView.js
import React, { useState, useEffect, useRef } from 'react';
import { useReactToPrint } from 'react-to-print';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

const backendUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';

function ScheduleView({ cityId }) {
  const token = localStorage.getItem('token');

  // Ustawienia okresu grafiku
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());

  // Widok: "employees" lub "routes"
  const [viewType, setViewType] = useState('employees');

  // Dane pobierane z backendu
  const [employees, setEmployees] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [labels, setLabels] = useState([]);
  const [schedules, setSchedules] = useState([]); // rekordy Schedule

  // Referencje do elementów, które chcemy drukować
  const employeesTableRef = useRef(null);
  const routesTableRef = useRef(null);

  // Handler do drukowania (react-to-print)
  // W zależności od widoku drukujemy inną tabelę
  const handlePrintEmployees = useReactToPrint({
    content: () => employeesTableRef.current,
    documentTitle: 'Grafik - Widok Pracowników'
  });
  const handlePrintRoutes = useReactToPrint({
    content: () => routesTableRef.current,
    documentTitle: 'Grafik - Widok Tras'
  });

  // Przy ładowaniu lub zmianie cityId, month, year pobieramy dane
  useEffect(() => {
    fetchEmployees();
    fetchRoutes();
    fetchLabels();
    fetchSchedule();
  }, [cityId, month, year]);

  const fetchEmployees = async () => {
    try {
      const res = await fetch(`/api/employees/city/${cityId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
        // WYMUSZAMY brak cache
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
        // WYMUSZAMY brak cache
        cache: 'no-store'
      });
      const data = await res.json();
      // Filtrujemy tylko trasy z niepustymi segmentami
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
        // WYMUSZAMY brak cache
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
          // WYMUSZAMY brak cache
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

  // Generacja tablicy dni miesiąca
  const daysInMonth = (m, y) => new Date(y, m, 0).getDate();
  const days = [];
  for (let d = 1; d <= daysInMonth(month, year); d++) {
    days.push(d);
  }

  // Obliczenie czasu trasy w godzinach na podstawie segmentów
  // const calculateDuration = (route) => {
  //   let wh = route.working_hours;
  //   if (typeof wh === "string") {
  //     try {
  //       wh = JSON.parse(wh);
  //     } catch (e) {
  //       console.error("Error parsing working_hours:", e);
  //       return 0;
  //     }
  //   }
  //   if (wh && Array.isArray(wh.segments)) {
  //     let totalMinutes = 0;
  //     wh.segments.forEach(seg => {
  //       const [startH, startM] = seg.start.split(':').map(Number);
  //       const [endH, endM] = seg.end.split(':').map(Number);
  //       totalMinutes += (endH * 60 + endM) - (startH * 60 + startM);
  //     });
  //     return totalMinutes / 60;
  //   }
  //   return 0;
  // };

  // Update w widoku pracowników
  // Aktualizacja komórki harmonogramu dla widoku "wg pracowników"
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
      // Wymuszenie, aby przeglądarka nie korzystała z cache:
      cache: 'no-store',
      body: JSON.stringify({ date, employee_id: employeeId, route_id, label })
    });
    if (!res.ok) {
      const data = await res.json();
      console.error("Error updating schedule (employee view):", data);
      alert(data.message || "Błąd aktualizacji grafiku");
    }
    await fetchSchedule(); // odświeżenie harmonogramu
  } catch (error) {
    console.error("Update schedule error (employee view):", error);
    alert("Błąd aktualizacji grafiku (exception)");
  }
};

// Funkcja pomocnicza, która zwraca dostępne opcje dla danej komórki (widok wg pracowników)
const getAvailableOptionsForEmployeeCell = (employeeId, day) => {
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  // Pobieramy ID tras, które są już przypisane do innego pracownika tego dnia
  const assignedRouteIds = schedules
    .filter(s => s.date === date && s.route_id && s.employee_id !== employeeId)
    .map(s => s.route_id.toString());

  // Dostępne trasy to te, które nie są przypisane do innego pracownika tego dnia
  const availableRoutes = routes.filter(r => !assignedRouteIds.includes(r.id.toString()));

  // Mapujemy dostępne trasy na opcje selecta
  const routeOptions = availableRoutes.map(r => ({
    value: `R:${r.id}`,
    label: `${r.name} (${calculateDuration(r).toFixed(2)}h)`
  }));

  // Mapujemy etykiety na opcje selecta (wszystkie są dostępne)
  const labelOptions = labels.map(l => ({
    value: `L:${l.code}`,
    label: `${l.code}`
  }));

  // Zwracamy listę opcji – pierwsza opcja to pusta wartość
  return [{ value: "", label: "-- brak --" }, ...routeOptions, ...labelOptions];
};


  // Update w widoku tras
  const updateScheduleForRouteCell = async (routeId, day, employeeId) => {
    const date = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    console.log("Updating schedule (route view):", { date, routeId, employeeId });
    try {
      const res = await fetch(`/api/schedule/update-cell`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        // WYMUSZAMY brak cache
        cache: 'no-store',
        body: JSON.stringify({ date, employee_id: employeeId, route_id: routeId, label: null })
      });
      if (!res.ok) {
        const data = await res.json();
        console.error("Error updating schedule (route view):", data);
        alert(data.message || "Błąd aktualizacji grafiku");
      }
      await fetchSchedule();
    } catch (error) {
      console.error("Update schedule error (route view):", error);
      alert("Błąd aktualizacji grafiku (exception)");
    }
  };

  // Funkcja pomocnicza – w widoku pracowników filtruje trasy, które są już przypisane do innego pracownika
 

  // Funkcja pomocnicza – w widoku tras filtruje pracowników
  const getAvailableEmployeesForRouteCell = (routeId, day) => {
    const date = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const assignedEmployeeIds = schedules
      .filter(s => s.date === date && s.route_id)
      .map(s => s.employee_id.toString());
    const availableEmployees = employees.filter(emp => {
      const empId = emp.id.toString();
      // Zezwalamy, jeśli pracownik nie jest przypisany do innej trasy w tym dniu
      // albo już jest przypisany do tej trasy
      return (!assignedEmployeeIds.includes(empId)) || 
             (schedules.find(s => s.date === date && s.route_id?.toString() === routeId.toString() && s.employee_id.toString() === empId));
    });
    return [{ value: "", label: "-- brak --" }, ...availableEmployees.map(emp => ({
      value: emp.id,
      label: `${emp.first_name} ${emp.last_name}`
    }))];
  };

  // Obliczenie podsumowania godzin dla pracownika
  const daysInM = (m, y) => new Date(y, m, 0).getDate();
  const calculateEmployeeHours = (employeeId) => {
    const dim = daysInM(month, year); // liczba dni w miesiącu
    let total = 0;
  
    // Znajdź obiekt pracownika, aby odczytać jego part_time
    const employee = employees.find(e => e.id === employeeId);
    const partTime = employee ? employee.part_time : 1.0; // domyślnie 1.0, jeśli brak
  
    for (let d = 1; d <= dim; d++) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      // Znajdź rekord w schedule
      const cell = schedules.find(s => s.employee_id === employeeId && s.date === date);
  
      if (!cell) continue; // brak wpisu – brak godzin
  
      // Jeśli mamy przypisaną trasę
      if (cell.route_id) {
        // Szukamy obiektu trasy
        const route = routes.find(r => r.id.toString() === cell.route_id.toString());
        if (route) {
          total += calculateDuration(route); 
        }
      }
      // Jeśli mamy przypisaną etykietę (label)
      else if (cell.label) {
        // Znajdź obiekt etykiety
        const labelObj = labels.find(l => l.code === cell.label);
        if (labelObj) {
          // Załóżmy, że labelObj.default_hours to liczba godzin przypisanych do tej etykiety
          // Mnożymy przez part_time
          total += (labelObj.default_hours * partTime);
        }
      }
    }
  
    return total.toFixed(2);
  };
  
  // Funkcja calculateDuration – bez zmian, liczy godziny na podstawie segments w trasie
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
        // Jeśli shift kończy się po północy, endMinutes będzie mniejsze niż startMinutes.
        if (endMinutes < startMinutes) {
          endMinutes += 24 * 60; // dodajemy 24 godziny w minutach
        }
        totalMinutes += endMinutes - startMinutes;
      });
      return totalMinutes / 60;
    }
    return 0;
  };
  

  // Eksport do XLSX
  const handleExportXLSX = () => {
    // Przygotowujemy 2 arkusze: "Grafik-Pracownicy" i "Grafik-Trasy"
    const wsDataEmployees = prepareEmployeesSheet();
    const wsDataRoutes = prepareRoutesSheet();

    // Tworzymy workbook
    const wb = XLSX.utils.book_new();

    // Arkusz 1: Pracownicy
    const wsEmployees = XLSX.utils.aoa_to_sheet(wsDataEmployees);
    XLSX.utils.book_append_sheet(wb, wsEmployees, "Grafik-Pracownicy");

    // Arkusz 2: Trasy
    const wsRoutes = XLSX.utils.aoa_to_sheet(wsDataRoutes);
    XLSX.utils.book_append_sheet(wb, wsRoutes, "Grafik-Trasy");

    // Generujemy plik .xlsx
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

    // Zapisujemy
    saveAs(new Blob([wbout], { type: "application/octet-stream" }), 'grafik.xlsx');
  };

  // Konwertuje widok "employees" do tablicy 2D (AOA)
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
                const seg = wh.segments[0];
                cellValue = `${seg.start}-${seg.end}`;
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
  

  // Konwertuje widok "routes" do tablicy 2D (AOA)
  const prepareRoutesSheet = () => {
    const header = ["Trasa", ...days.map(d => `Dzień ${d}`)];
    const sheetData = [header];

    routes.forEach(rt => {
      const row = [`${rt.name} (${calculateDuration(rt).toFixed(2)}h)`];
      days.forEach(day => {
        const date = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
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

      {/* Przyciski do eksportu i drukowania */}
      <div style={{ marginBottom: '10px' }}>
        <button onClick={handleExportXLSX}>Eksport do XLSX</button>
        {viewType === 'employees' && (
          <button onClick={handlePrintEmployees}>Drukuj Widok Pracowników</button>
        )}
        {viewType === 'routes' && (
          <button onClick={handlePrintRoutes}>Drukuj Widok Tras</button>
        )}
      </div>

      {/* Wybór miesiąca i roku */}
      <div style={{ marginBottom: '10px' }}>
        <label>Miesiąc: </label>
        <select value={month} onChange={(e) => setMonth(parseInt(e.target.value))}>
          {[...Array(12).keys()].map(i => (
            <option key={i+1} value={i+1}>{i+1}</option>
          ))}
        </select>
        <label> Rok: </label>
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(parseInt(e.target.value))}
          style={{ width: '80px' }}
        />
        <button onClick={fetchSchedule}>Pobierz grafik</button>
      </div>

      {/* Przełączanie widoków */}
      <div style={{ marginBottom: '10px' }}>
        <button onClick={() => setViewType('employees')}>Ułóż wg Pracowników</button>
        <button onClick={() => setViewType('routes')}>Ułóż wg Tras</button>
      </div>

      {/* Widok wg pracowników */}
      {viewType === 'employees' && (
        <div ref={employeesTableRef /* <-- ref do drukowania */}>
          <table border="1" cellPadding="5">
            <thead>
              <tr>
                <th>Pracownik</th>
                {days.map(day => {
                  const date = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                  const weekday = new Date(date).getDay();
                  let bgColor = '';
                  if (weekday === 0) bgColor = 'red';
                  else if (weekday === 6) bgColor = 'gray';
                  return <th key={day} style={{ backgroundColor: bgColor }}>{day}</th>;
                })}
                <th>Podsumowanie godzin</th>
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => (
                <tr key={emp.id}>
                  <td>{emp.last_name} {emp.first_name}</td>
                  {days.map(day => {
                    const date = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Widok wg tras */}
      {viewType === 'routes' && (
        <div ref={routesTableRef /* <-- ref do drukowania */}>
          <table border="1" cellPadding="5">
            <thead>
              <tr>
                <th>Trasa</th>
                {days.map(day => {
                  const date = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
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
                      const date = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
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
