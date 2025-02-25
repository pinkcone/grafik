// src/pages/CityDetailPage.js
import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import Popup from '../components/Popup';
import ScheduleView from './ScheduleView'; 


function CityDetailPage() {
  const { cityId } = useParams();
  const token = localStorage.getItem('token');
  const [showSchedule, setShowSchedule] = useState(false);
  // Dane podstawowe
  const [city, setCity] = useState(null);
  const [activeTab, setActiveTab] = useState('employees'); // "employees" lub "routes"
  const [allCities, setAllCities] = useState([]); // lista wszystkich miast (do selectów)
  const [cityRoutes, setCityRoutes] = useState([]); // trasy przypisane do tego miasta (do selectu powiązanej trasy)

  // Dane pracowników i tras
  const [employees, setEmployees] = useState([]);
  const [routes, setRoutes] = useState([]);

  // Modal dla pracowników
  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
  const [employeeModalMode, setEmployeeModalMode] = useState('add'); // "add" lub "edit"
  const [currentEmployee, setCurrentEmployee] = useState(null);
  const [empFirstName, setEmpFirstName] = useState('');
  const [empLastName, setEmpLastName] = useState('');
  const [empPartTime, setEmpPartTime] = useState(1);
  const [empCityId, setEmpCityId] = useState(cityId);

  // Modal dla tras
  const [isRouteModalOpen, setIsRouteModalOpen] = useState(false);
  const [routeModalMode, setRouteModalMode] = useState('add'); // "add" lub "edit"
  const [currentRoute, setCurrentRoute] = useState(null);
  const [routeName, setRouteName] = useState('');
  // Główne miasto – ustalane automatycznie jako aktualne miasto
  const [routeAdditionalCityId, setRouteAdditionalCityId] = useState('');
  const [routeLinkedId, setRouteLinkedId] = useState('');
  // Segmenty czasu
  const [segments, setSegments] = useState([]);
  const [segmentStart, setSegmentStart] = useState('');
  const [segmentEnd, setSegmentEnd] = useState('');

  useEffect(() => {
    fetchCity();
    fetchEmployees();
    fetchRoutes();
    fetchAllCities();
  }, [cityId]);

  // Pobranie danych miasta
  const fetchCity = async () => {
    try {
      const res = await fetch(`/api/cities/${cityId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      setCity(data);
    } catch (error) {
      console.error('Błąd pobierania miasta:', error);
    }
  };

  // Pobranie pracowników dla danego miasta
  const fetchEmployees = async () => {
    try {
      const res = await fetch(`/api/employees/city/${cityId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      setEmployees(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Błąd pobierania pracowników:', error);
    }
  };

  // Pobranie tras dla danego miasta
  const fetchRoutes = async () => {
    try {
      const res = await fetch(`/api/routes/city/${cityId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      console.log("Fetched routes data:", data); // Debug – sprawdzamy strukturę tras
      setRoutes(Array.isArray(data) ? data : []);
      // Do selectu powiązanej trasy wykorzystujemy trasy z tego miasta
      setCityRoutes(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Błąd pobierania tras:', error);
    }
  };

  // Pobranie listy wszystkich miast (do selectów)
  const fetchAllCities = async () => {
    try {
      const res = await fetch(`/api/cities`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      setAllCities(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Błąd pobierania listy miast:', error);
    }
  };

  // Funkcje dla modala pracowników
  const openEmployeeModalForAdd = () => {
    setEmployeeModalMode('add');
    setEmpFirstName('');
    setEmpLastName('');
    setEmpPartTime(1);
    setEmpCityId(cityId); // domyślnie aktualne miasto
    setIsEmployeeModalOpen(true);
  };

  const openEmployeeModalForEdit = (emp) => {
    setEmployeeModalMode('edit');
    setCurrentEmployee(emp);
    setEmpFirstName(emp.first_name);
    setEmpLastName(emp.last_name);
    setEmpPartTime(emp.part_time);
    setEmpCityId(emp.city_id);
    setIsEmployeeModalOpen(true);
  };

  const handleEmployeeSubmit = async (e) => {
    e.preventDefault();
    const employeeData = {
      first_name: empFirstName,
      last_name: empLastName,
      part_time: empPartTime,
      city_id: empCityId,
    };
    try {
      let res;
      if (employeeModalMode === 'add') {
        res = await fetch(`/api/employees`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(employeeData),
        });
      } else {
        res = await fetch(`/api/employees/${currentEmployee.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(employeeData),
        });
      }
      if (res.ok) {
        fetchEmployees();
        setIsEmployeeModalOpen(false);
      } else {
        alert('Błąd przy zapisie pracownika');
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleEmployeeDelete = async (empId) => {
    if (!window.confirm('Czy na pewno usunąć tego pracownika?')) return;
    try {
      const res = await fetch(`/api/employees/${empId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        fetchEmployees();
      } else {
        alert('Błąd przy usuwaniu pracownika');
      }
    } catch (error) {
      console.error(error);
    }
  };

  // Funkcje dla modala tras
  const openRouteModalForAdd = () => {
    setRouteModalMode('add');
    setRouteName('');
    setRouteAdditionalCityId('');
    setSegments([]);
    setSegmentStart('');
    setSegmentEnd('');
    setRouteLinkedId('');
    setIsRouteModalOpen(true);
  };

  const openRouteModalForEdit = (rt) => {
    setRouteModalMode('edit');
    setCurrentRoute(rt);
    setRouteName(rt.name || '');
    setRouteAdditionalCityId(rt.additional_city_id || '');
    // Parsujemy working_hours – backend zwraca ciąg JSON, więc go sparsujemy jeśli to string
    let segmentsFromData = [];
    if (rt.working_hours) {
      try {
        const parsed = typeof rt.working_hours === "string" ? JSON.parse(rt.working_hours) : rt.working_hours;
        segmentsFromData = Array.isArray(parsed.segments) ? parsed.segments : [];
      } catch (e) {
        console.error("Błąd parsowania working_hours:", e);
      }
    }
    console.log(`Editing route ${rt.id}, segments:`, segmentsFromData);
    setSegments(segmentsFromData);
    setSegmentStart('');
    setSegmentEnd('');
    setRouteLinkedId(rt.linked_route_id || '');
    setIsRouteModalOpen(true);
  };

  const addSegment = () => {
    if (!segmentStart || !segmentEnd) {
      alert('Podaj zarówno godzinę rozpoczęcia, jak i zakończenia.');
      return;
    }
    setSegments([...segments, { start: segmentStart, end: segmentEnd }]);
    setSegmentStart('');
    setSegmentEnd('');
  };

  const removeSegment = (index) => {
    setSegments(segments.filter((_, idx) => idx !== index));
  };

  const handleRouteSubmit = async (e) => {
    e.preventDefault();
    const routeData = {
      name: routeName,
      main_city_id: cityId, // aktualne miasto
      additional_city_id: routeAdditionalCityId || null,
      working_hours: { segments },
      linked_route_id: routeLinkedId || null,
    };
    try {
      let res;
      if (routeModalMode === 'add') {
        res = await fetch(`/api/routes`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(routeData),
        });
      } else {
        res = await fetch(`/api/routes/${currentRoute.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(routeData),
        });
      }
      if (res.ok) {
        fetchRoutes();
        setIsRouteModalOpen(false);
      } else {
        alert('Błąd przy zapisie trasy');
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleRouteDelete = async (routeId) => {
    if (!window.confirm('Czy na pewno usunąć tę trasę?')) return;
    try {
      const res = await fetch(`/api/routes/${routeId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        fetchRoutes();
      } else {
        alert('Błąd przy usuwaniu trasy');
      }
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div>
      <h2>Szczegóły Miasta: {city ? city.name : 'Ładowanie...'}</h2>
      <div style={{ marginBottom: '20px' }}>
        <button onClick={() => setActiveTab('employees')}>Pracownicy</button>
        <button onClick={() => setActiveTab('routes')}>Trasy</button>
      </div>
      <button onClick={() => setShowSchedule(!showSchedule)}>
  {showSchedule ? 'Ukryj grafik' : 'Ułóż grafik'}
</button>

{showSchedule && <ScheduleView cityId={cityId} />}
      {activeTab === 'employees' && (
        <div>
          <h3>Pracownicy</h3>
          <button onClick={openEmployeeModalForAdd}>Dodaj pracownika</button>
          <table border="1" cellPadding="5">
            <thead>
              <tr>
                <th>ID</th>
                <th>Imię</th>
                <th>Nazwisko</th>
                <th>Część etatu</th>
                <th>Miasto</th>
                <th>Akcje</th>
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => (
                <tr key={emp.id}>
                  <td>{emp.id}</td>
                  <td>{emp.first_name}</td>
                  <td>{emp.last_name}</td>
                  <td>{emp.part_time}</td>
                  <td>
                    {allCities.find(c => c.id.toString() === emp.city_id.toString())?.name || emp.city_id}
                  </td>
                  <td>
                    <button onClick={() => openEmployeeModalForEdit(emp)}>Edytuj</button>
                    <button onClick={() => handleEmployeeDelete(emp.id)}>Usuń</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'routes' && (
        <div>
          <h3>Trasy</h3>
          <button onClick={openRouteModalForAdd}>Dodaj trasę</button>
          <table border="1" cellPadding="5">
            <thead>
              <tr>
                <th>ID</th>
                <th>Nazwa</th>
                <th>Godziny pracy</th>
                <th>Trasa powiązana</th>
                <th>Dodatkowe miasto</th>
                <th>Akcje</th>
              </tr>
            </thead>
            <tbody>
              {routes.map(rt => (
                <tr key={rt.id}>
                  <td>{rt.id}</td>
                  <td>{rt.name}</td>
                  <td>
                    {(() => {
                      // Jeśli working_hours jest stringiem, spróbuj sparsować
                      let wh = rt.working_hours;
                      if (typeof wh === "string") {
                        try {
                          wh = JSON.parse(wh);
                        } catch (e) {
                          console.error("Błąd parsowania working_hours:", e);
                          return "-";
                        }
                      }
                      return wh && Array.isArray(wh.segments) && wh.segments.length > 0
                        ? wh.segments.map(seg => `${seg.start}-${seg.end}`).join(', ')
                        : '-';
                    })()}
                  </td>
                  <td>
                    {cityRoutes.find(r => r.id.toString() === rt.linked_route_id?.toString())?.name ||
                      rt.linked_route_id ||
                      '-'}
                  </td>
                  <td>
                    {allCities.find(c => c.id.toString() === rt.additional_city_id?.toString())?.name ||
                      rt.additional_city_id ||
                      '-'}
                  </td>
                  <td>
                    <button onClick={() => openRouteModalForEdit(rt)}>Edytuj</button>
                    <button onClick={() => handleRouteDelete(rt.id)}>Usuń</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal dla pracowników */}
      <Popup isOpen={isEmployeeModalOpen} onClose={() => setIsEmployeeModalOpen(false)}>
        <h3>{employeeModalMode === 'add' ? 'Dodaj pracownika' : 'Edytuj pracownika'}</h3>
        <form onSubmit={handleEmployeeSubmit}>
          <div>
            <label>Imię:</label>
            <input type="text" value={empFirstName} onChange={(e) => setEmpFirstName(e.target.value)} required />
          </div>
          <div>
            <label>Nazwisko:</label>
            <input type="text" value={empLastName} onChange={(e) => setEmpLastName(e.target.value)} required />
          </div>
          <div>
            <label>Część etatu:</label>
            <input type="number" value={empPartTime} onChange={(e) => setEmpPartTime(e.target.value)} step="0.1" required />
          </div>
          <div>
            <label>Miasto:</label>
            <select value={empCityId} onChange={(e) => setEmpCityId(e.target.value)} required>
              {allCities.map(city => (
                <option key={city.id} value={city.id}>{city.name}</option>
              ))}
            </select>
          </div>
          <button type="submit">{employeeModalMode === 'add' ? 'Dodaj' : 'Zaktualizuj'}</button>
        </form>
      </Popup>

      {/* Modal dla tras */}
      <Popup isOpen={isRouteModalOpen} onClose={() => setIsRouteModalOpen(false)}>
        <h3>{routeModalMode === 'add' ? 'Dodaj trasę' : 'Edytuj trasę'}</h3>
        <form onSubmit={handleRouteSubmit}>
          <div>
            <label>Nazwa trasy:</label>
            <input type="text" value={routeName} onChange={(e) => setRouteName(e.target.value)} required />
          </div>
          <div>
            <label>Główne miasto:</label>
            <input type="text" value={city ? city.name : ''} disabled />
          </div>
          <div>
            <label>Dodatkowe miasto:</label>
            <select value={routeAdditionalCityId} onChange={(e) => setRouteAdditionalCityId(e.target.value)}>
              <option value="">-- Brak --</option>
              {allCities.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Segmenty czasu:</label>
            <div>
              <input type="time" value={segmentStart} onChange={(e) => setSegmentStart(e.target.value)} />
              <span> do </span>
              <input type="time" value={segmentEnd} onChange={(e) => setSegmentEnd(e.target.value)} />
              <button type="button" onClick={addSegment}>Dodaj segment</button>
            </div>
            {segments.length > 0 && (
              <ul>
                {segments.map((seg, idx) => (
                  <li key={idx}>
                    {seg.start} - {seg.end}{' '}
                    <button type="button" onClick={() => removeSegment(idx)}>Usuń</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <label>Trasa powiązana:</label>
            <select value={routeLinkedId} onChange={(e) => setRouteLinkedId(e.target.value)}>
              <option value="">-- Brak --</option>
              {cityRoutes
                .filter(r => !currentRoute || r.id !== currentRoute.id)
                .map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
            </select>
          </div>
          <button type="submit">{routeModalMode === 'add' ? 'Dodaj' : 'Zaktualizuj'}</button>
        </form>
      </Popup>
    </div>
  );
}

export default CityDetailPage;
