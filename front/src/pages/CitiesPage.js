import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Popup from '../components/Popup';
import "../styles/CityPage.css";

function CitiesPage() {
  const [cities, setCities] = useState([]);
  const [sortOrder, setSortOrder] = useState('asc');

  // Popup: formularz dodawania/edycji
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formMode, setFormMode] = useState('add'); // 'add' | 'edit'
  const [currentCity, setCurrentCity] = useState(null);
  const [cityName, setCityName] = useState('');

  // Popup: akcje dla wybranego miasta
  const [isActionsOpen, setIsActionsOpen] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
    fetchCities();
  }, []);

  const fetchCities = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/cities`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        console.error('Błąd pobierania miast:', res.status);
        return;
      }
      const data = await res.json();
      setCities(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching cities:', error);
    }
  };

  const sortByName = () => {
    const next = sortOrder === 'asc' ? 'desc' : 'asc';
    setSortOrder(next);
    setCities(prev =>
      [...prev].sort((a, b) =>
        next === 'asc'
          ? String(a.name).localeCompare(String(b.name))
          : String(b.name).localeCompare(String(a.name))
      )
    );
  };

  const openAddForm = () => {
    setFormMode('add');
    setCityName('');
    setCurrentCity(null);
    setIsFormOpen(true);
  };

  const openEditForm = (city) => {
    setFormMode('edit');
    setCurrentCity(city);
    setCityName(city?.name || '');
    setIsFormOpen(true);
  };

  const handleDeleteCity = async (cityId) => {
    if (!window.confirm('Czy na pewno chcesz usunąć to miasto?')) return;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/cities/${cityId}`, {
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      if (res.ok) {
        setIsActionsOpen(false);
        await fetchCities();
      } else {
        alert('Błąd przy usuwaniu miasta');
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    const token = localStorage.getItem('token');
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    };

    try {
      const url = formMode === 'add'
        ? `/api/cities`
        : `/api/cities/${currentCity.id}`;
      const method = formMode === 'add' ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers,
        body: JSON.stringify({ name: cityName }),
      });

      if (!res.ok) {
        alert(`Błąd przy ${formMode === 'add' ? 'dodawaniu' : 'edycji'} miasta`);
        return;
      }

      await fetchCities();
      setIsFormOpen(false);
    } catch (error) {
      console.error(error);
    }
  };

  const handleCityClick = (city) => {
    setCurrentCity(city);
    setIsActionsOpen(true);
  };

  const openCity = (cityId) => {
    setIsActionsOpen(false);
    navigate(`/cities/${cityId}`);
  };

  return (
    <div className='main-cities'>
      <h2>Moje Miasta</h2>

      <div className="toolbar">
        <button onClick={openAddForm}>Dodaj miasto</button>
        <button onClick={sortByName}>
          Sortuj po nazwie ({sortOrder === 'asc' ? 'A→Z' : 'Z→A'})
        </button>
      </div>

      {/* Lista miast (bez tabeli) */}
      <div className="city-list">
        {cities.map((city) => (
            <button
              type="button"
              className="city-name-button"
              onClick={() => handleCityClick(city)}
              title="Pokaż akcje"
            >
              {city.name}
            </button>
        ))}
      </div>

      {/* POPUP: Akcje dla miasta */}
      <Popup isOpen={isActionsOpen} onClose={() => setIsActionsOpen(false)}>
        <h3>Miasto: {currentCity?.name}</h3>
        <div className="actions">
          <button onClick={() => openCity(currentCity.id)}>Otwórz</button>
          <button onClick={() => { setIsActionsOpen(false); openEditForm(currentCity); }}>
            Edytuj
          </button>
          <button onClick={() => handleDeleteCity(currentCity.id)}>
            Usuń
          </button>
        </div>
      </Popup>

      {/* POPUP: Formularz dodawania/edycji */}
      <Popup isOpen={isFormOpen} onClose={() => setIsFormOpen(false)}>
        <h3>{formMode === 'add' ? 'Dodaj miasto' : 'Edytuj miasto'}</h3>
        <form onSubmit={handleFormSubmit}>
          <div>
            <label htmlFor="cityName">Nazwa miasta:&nbsp;</label>
            <input
              id="cityName"
              type="text"
              value={cityName}
              onChange={(e) => setCityName(e.target.value)}
              required
            />
          </div>
          <button type="submit">
            {formMode === 'add' ? 'Dodaj' : 'Zaktualizuj'}
          </button>
        </form>
      </Popup>
    </div>
  );
}

export default CitiesPage;
