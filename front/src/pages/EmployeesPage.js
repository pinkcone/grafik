import React, { useState, useEffect } from 'react';
import Popup from '../components/Popup';
import { LICENSE_CATEGORIES, LICENSE_CATEGORY_LABELS } from '../utils/licenseCategories';
import { logLicense } from '../utils/licenseLog';

function EmployeesPage() {
  const [employees, setEmployees] = useState([]);
  const [sortColumn, setSortColumn] = useState('id');
  const [sortOrder, setSortOrder] = useState('asc');

  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [popupMode, setPopupMode] = useState('add');
  const [currentEmployee, setCurrentEmployee] = useState(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [partTime, setPartTime] = useState(1);
  const [cityId, setCityId] = useState('');
  const [licenseCategory, setLicenseCategory] = useState('');

  useEffect(() => {
    fetchEmployees();
  }, []);

  const fetchEmployees = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/employees`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      setEmployees(Array.isArray(data) ? data : []);
    } catch (error) {
      // ignore
    }
  };

  const sortData = (column) => {
    let order = 'asc';
    if (sortColumn === column && sortOrder === 'asc') order = 'desc';
    setSortColumn(column);
    setSortOrder(order);
    const sorted = [...employees].sort((a, b) => {
      if (a[column] < b[column]) return order === 'asc' ? -1 : 1;
      if (a[column] > b[column]) return order === 'asc' ? 1 : -1;
      return 0;
    });
    setEmployees(sorted);
  };

  const handleAddEmployeeClick = () => {
    setPopupMode('add');
    setFirstName('');
    setLastName('');
    setPartTime(1);
    setCityId('');
    setLicenseCategory('');
    setIsPopupOpen(true);
  };

  const handleEditEmployeeClick = (emp) => {
    logLicense('1. otwarcie edycji', { id: emp.id, license_category_z_bazy: emp.license_category ?? null });
    setPopupMode('edit');
    setCurrentEmployee(emp);
    setFirstName(emp.first_name);
    setLastName(emp.last_name);
    setPartTime(emp.part_time);
    setCityId(String(emp.city_id ?? ''));
    setLicenseCategory(emp.license_category || '');
    setIsPopupOpen(true);
  };

  const handleLicenseCategoryChange = (e) => {
    const value = e.target.value;
    logLicense('2. wybrano kategorię w select', { wartosc: value || null });
    setLicenseCategory(value);
  };

  const handleDeleteEmployee = async (id) => {
    if (!window.confirm('Czy na pewno usunąć pracownika?')) return;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/employees/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) fetchEmployees();
      else alert('Błąd przy usuwaniu pracownika');
    } catch (error) {
      // ignore
    }
  };

  const handlePopupSubmit = async (e) => {
    e.preventDefault();
    const token = localStorage.getItem('token');
    const employeeData = {
      first_name: firstName,
      last_name: lastName,
      part_time: partTime,
      city_id: cityId,
      license_category: licenseCategory || null,
    };
    logLicense('3. wysyłam do API', employeeData);

    const url = popupMode === 'add' ? `/api/employees` : `/api/employees/${currentEmployee.id}`;
    const method = popupMode === 'add' ? 'POST' : 'PUT';

    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(employeeData),
      });
      if (res.ok) {
        const saved = await res.json();
        logLicense('4. odpowiedź API OK', {
          license_category: saved.employee?.license_category ?? null,
          caly_pracownik: saved.employee,
        });
        fetchEmployees();
        setIsPopupOpen(false);
      } else {
        const err = await res.json().catch(() => ({}));
        logLicense('4. odpowiedź API BŁĄD', { status: res.status, ...err });
        alert(err.details || err.error || 'Błąd przy zapisie pracownika');
      }
    } catch (error) {
      logLicense('4. wyjątek sieci', { message: error.message });
    }
  };

  return (
    <div>
      <h2>Moi Pracownicy</h2>
      <button onClick={handleAddEmployeeClick}>Dodaj pracownika</button>
      <table border="1">
        <thead>
          <tr>
            <th onClick={() => sortData('id')}>ID</th>
            <th onClick={() => sortData('first_name')}>Imię</th>
            <th onClick={() => sortData('last_name')}>Nazwisko</th>
            <th onClick={() => sortData('part_time')}>Część etatu</th>
            <th onClick={() => sortData('city_id')}>ID Miasta</th>
            <th onClick={() => sortData('license_category')}>Prawo jazdy</th>
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
              <td>{emp.city_id}</td>
              <td>{emp.license_category ? LICENSE_CATEGORY_LABELS[emp.license_category] || emp.license_category : '—'}</td>
              <td>
                <button onClick={() => handleEditEmployeeClick(emp)}>Edytuj</button>
                <button onClick={() => handleDeleteEmployee(emp.id)}>Usuń</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Popup isOpen={isPopupOpen} onClose={() => setIsPopupOpen(false)}>
        <h3>{popupMode === 'add' ? 'Dodaj pracownika' : 'Edytuj pracownika'}</h3>
        <form onSubmit={handlePopupSubmit}>
          <div>
            <label>Imię:</label>
            <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
          </div>
          <div>
            <label>Nazwisko:</label>
            <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
          </div>
          <div>
            <label>Część etatu:</label>
            <input
              type="number"
              value={partTime}
              onChange={(e) => setPartTime(e.target.value)}
              required
              step="0.1"
            />
          </div>
          <div>
            <label>ID Miasta:</label>
            <input type="text" value={cityId} onChange={(e) => setCityId(e.target.value)} required />
          </div>
          <div>
            <label>Kategoria prawa jazdy:</label>
            <select value={licenseCategory} onChange={handleLicenseCategoryChange}>
              <option value="">— nie ustawiono —</option>
              {LICENSE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{LICENSE_CATEGORY_LABELS[cat]}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            onClick={() => logLicense('2b. kliknięto przycisk Zapisz', { kategoria: licenseCategory || null })}
          >
            {popupMode === 'add' ? 'Dodaj' : 'Zaktualizuj'}
          </button>
        </form>
      </Popup>
    </div>
  );
}

export default EmployeesPage;
