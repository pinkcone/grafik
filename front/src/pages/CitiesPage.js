import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Popup from '../components/Popup';
import "../styles/CityPage.css";


function CitiesPage() {
  const [cities, setCities] = useState([]);
  const [sortColumn, setSortColumn] = useState('id');
  const [sortOrder, setSortOrder] = useState('asc');

  // Stany dla popupu (modal) – do dodawania/edycji
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [popupMode, setPopupMode] = useState('add'); // 'add' lub 'edit'
  const [currentCity, setCurrentCity] = useState(null);
  const [cityName, setCityName] = useState('');

  useEffect(() => {
    fetchCities();
  }, []);

  const fetchCities = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/cities`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      setCities(data);
    } catch (error) {
      console.error('Error fetching cities:', error);
    }
  };

  const sortData = (column) => {
    let order = 'asc';
    if (sortColumn === column && sortOrder === 'asc') order = 'desc';
    setSortColumn(column);
    setSortOrder(order);
    const sorted = [...cities].sort((a, b) => {
      if (a[column] < b[column]) return order === 'asc' ? -1 : 1;
      if (a[column] > b[column]) return order === 'asc' ? 1 : -1;
      return 0;
    });
    setCities(sorted);
  };

  const handleAddCityClick = () => {
    setPopupMode('add');
    setCityName('');
    setIsPopupOpen(true);
  };

  const handleEditCityClick = (city) => {
    setPopupMode('edit');
    setCurrentCity(city);
    setCityName(city.name);
    setIsPopupOpen(true);
  };

  const handleDeleteCity = async (cityId) => {
    if (!window.confirm('Czy na pewno chcesz usunąć to miasto?')) return;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/cities/${cityId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        fetchCities();
      } else {
        alert('Błąd przy usuwaniu miasta');
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handlePopupSubmit = async (e) => {
    e.preventDefault();
    const token = localStorage.getItem('token');

    if (popupMode === 'add') {
      // Dodawanie miasta
      try {
        const res = await fetch(`/api/cities`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ name: cityName }),
        });
        if (res.ok) {
          fetchCities();
          setIsPopupOpen(false);
        } else {
          alert('Błąd przy dodawaniu miasta');
        }
      } catch (error) {
        console.error(error);
      }
    } else if (popupMode === 'edit' && currentCity) {
      // Edycja miasta
      try {
        const res = await fetch(`/api/cities/${currentCity.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ name: cityName }),
        });
        if (res.ok) {
          fetchCities();
          setIsPopupOpen(false);
        } else {
          alert('Błąd przy edycji miasta');
        }
      } catch (error) {
        console.error(error);
      }
    }
  };

  return (
    <div className='main'>
      <h2>Moje Miasta</h2>
      <button onClick={handleAddCityClick}>Dodaj miasto</button>
      <table border="1">
        <thead>
          <tr>
            <th onClick={() => sortData('id')}>ID</th>
            <th onClick={() => sortData('name')}>Nazwa</th>
            <th>Akcje</th>
          </tr>
        </thead>
        <tbody>
          {cities.map((city) => (
            <tr key={city.id}>
              <td>{city.id}</td>
              <td>
                <Link to={`/cities/${city.id}`}>{city.name}</Link>
              </td>
              <td>
                <button onClick={() => handleEditCityClick(city)}>Edytuj</button>
                <button onClick={() => handleDeleteCity(city.id)}>Usuń</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Popup isOpen={isPopupOpen} onClose={() => setIsPopupOpen(false)}>
        <h3>{popupMode === 'add' ? 'Dodaj miasto' : 'Edytuj miasto'}</h3>
        <form onSubmit={handlePopupSubmit}>
          <div>
            <label>Nazwa miasta:</label>
            <input
              type="text"
              value={cityName}
              onChange={(e) => setCityName(e.target.value)}
              required
            />
          </div>
          <button type="submit">{popupMode === 'add' ? 'Dodaj' : 'Zaktualizuj'}</button>
        </form>
      </Popup>
    </div>
  );
}

export default CitiesPage;
