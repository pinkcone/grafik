import React, { useState, useEffect } from 'react';
import Popup from '../components/Popup';

const backendUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';

function RoutesPage() {
  const [routes, setRoutes] = useState([]);
  const [cities, setCities] = useState([]); // Lista miast do selectów
  const [sortColumn, setSortColumn] = useState('id');
  const [sortOrder, setSortOrder] = useState('asc');

  // Stany dla popupu
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [popupMode, setPopupMode] = useState('add'); // 'add' lub 'edit'
  const [currentRoute, setCurrentRoute] = useState(null);

  // Pola formularza dla trasy
  const [name, setName] = useState('');
  const [mainCityId, setMainCityId] = useState('');
  const [additionalCityId, setAdditionalCityId] = useState('');
  const [linkedRouteId, setLinkedRouteId] = useState('');

  // Zarządzanie segmentami czasu
  const [segments, setSegments] = useState([]);
  const [segmentStart, setSegmentStart] = useState('');
  const [segmentEnd, setSegmentEnd] = useState('');

  useEffect(() => {
    fetchRoutes();
    fetchCities();
  }, []);

  const fetchRoutes = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/routes`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      setRoutes(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching routes:', error);
    }
  };

  const fetchCities = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/cities`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      setCities(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching cities:', error);
    }
  };

  const sortData = (column) => {
    let order = 'asc';
    if (sortColumn === column && sortOrder === 'asc') order = 'desc';
    setSortColumn(column);
    setSortOrder(order);
    const sorted = [...routes].sort((a, b) => {
      if (a[column] < b[column]) return order === 'asc' ? -1 : 1;
      if (a[column] > b[column]) return order === 'asc' ? 1 : -1;
      return 0;
    });
    setRoutes(sorted);
  };

  const handleAddRouteClick = () => {
    setPopupMode('add');
    setName('');
    setMainCityId('');
    setAdditionalCityId('');
    setLinkedRouteId('');
    setSegments([]);
    setSegmentStart('');
    setSegmentEnd('');
    setIsPopupOpen(true);
  };

  const handleEditRouteClick = (route) => {
    setPopupMode('edit');
    setCurrentRoute(route);
    setName(route.name);
    setMainCityId(route.main_city_id);
    setAdditionalCityId(route.additional_city_id || '');
    setLinkedRouteId(route.linked_route_id || '');
    // Przyjmujemy, że working_hours jest obiektem zawierającym tablicę segmentów
    setSegments(route.working_hours?.segments || []);
    setSegmentStart('');
    setSegmentEnd('');
    setIsPopupOpen(true);
  };

  const handleDeleteRoute = async (id) => {
    if (!window.confirm('Czy na pewno usunąć trasę?')) return;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/routes/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) fetchRoutes();
      else alert('Błąd przy usuwaniu trasy');
    } catch (error) {
      console.error(error);
    }
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

  const handlePopupSubmit = async (e) => {
    e.preventDefault();
    const token = localStorage.getItem('token');

    const routeData = {
      name,
      main_city_id: mainCityId,
      additional_city_id: additionalCityId || null,
      working_hours: { segments },
      linked_route_id: linkedRouteId || null,
    };

    if (popupMode === 'add') {
      try {
        const res = await fetch(`/api/routes`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(routeData),
        });
        if (res.ok) {
          fetchRoutes();
          setIsPopupOpen(false);
        } else {
          alert('Błąd przy dodawaniu trasy');
        }
      } catch (error) {
        console.error(error);
      }
    } else if (popupMode === 'edit' && currentRoute) {
      try {
        const res = await fetch(`/api/routes/${currentRoute.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(routeData),
        });
        if (res.ok) {
          fetchRoutes();
          setIsPopupOpen(false);
        } else {
          alert('Błąd przy edycji trasy');
        }
      } catch (error) {
        console.error(error);
      }
    }
  };

  return (
    <div>
      <h2>Moje Trasy</h2>
      <button onClick={handleAddRouteClick}>Dodaj trasę</button>
      <table border="1">
        <thead>
          <tr>
            <th onClick={() => sortData('id')}>ID</th>
            <th onClick={() => sortData('name')}>Nazwa</th>
            <th onClick={() => sortData('main_city_id')}>ID Głównego Miasta</th>
            <th>Godziny pracy</th>
            <th>Akcje</th>
          </tr>
        </thead>
        <tbody>
          {routes.map(r => (
            <tr key={r.id}>
              <td>{r.id}</td>
              <td>{r.name}</td>
              <td>{r.main_city_id}</td>
              <td>{JSON.stringify(r.working_hours)}</td>
              <td>
                <button onClick={() => handleEditRouteClick(r)}>Edytuj</button>
                <button onClick={() => handleDeleteRoute(r.id)}>Usuń</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Popup isOpen={isPopupOpen} onClose={() => setIsPopupOpen(false)}>
        <h3>{popupMode === 'add' ? 'Dodaj trasę' : 'Edytuj trasę'}</h3>
        <form onSubmit={handlePopupSubmit}>
          <div>
            <label>Nazwa:</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div>
            <label>ID Głównego Miasta:</label>
            <select
              value={mainCityId}
              onChange={(e) => setMainCityId(e.target.value)}
              required
            >
              <option value="">-- Wybierz miasto --</option>
              {cities.map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>ID Dodatkowego Miasta:</label>
            <select
              value={additionalCityId}
              onChange={(e) => setAdditionalCityId(e.target.value)}
            >
              <option value="">-- Brak --</option>
              {cities.map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Godziny pracy:</label>
            <div>
              <input
                type="time"
                value={segmentStart}
                onChange={(e) => setSegmentStart(e.target.value)}
              />
              <span> do </span>
              <input
                type="time"
                value={segmentEnd}
                onChange={(e) => setSegmentEnd(e.target.value)}
              />
              <button type="button" onClick={addSegment}>
                Dodaj segment
              </button>
            </div>
            {segments.length > 0 && (
              <ul>
                {segments.map((seg, idx) => (
                  <li key={idx}>
                    {seg.start} - {seg.end}{' '}
                    <button type="button" onClick={() => removeSegment(idx)}>
                      Usuń
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <label>ID Powiązanej Trasy (opcjonalnie):</label>
            <input
              type="text"
              value={linkedRouteId}
              onChange={(e) => setLinkedRouteId(e.target.value)}
            />
          </div>
          <button type="submit">
            {popupMode === 'add' ? 'Dodaj' : 'Zaktualizuj'}
          </button>
        </form>
      </Popup>
    </div>
  );
}

export default RoutesPage;
