import React, { useState, useEffect } from 'react';
import Popup from '../components/Popup';

const backendUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';

function EmployeesPage() {
  const [employees, setEmployees] = useState([]);
  const [sortColumn, setSortColumn] = useState('id');
  const [sortOrder, setSortOrder] = useState('asc');

  // Stany do obsługi popupu
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [popupMode, setPopupMode] = useState('add'); // 'add' lub 'edit'
  const [currentEmployee, setCurrentEmployee] = useState(null);

  // Pola formularza dla pracownika
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [partTime, setPartTime] = useState(1);
  const [cityId, setCityId] = useState('');

  useEffect(() => {
    fetchEmployees();
  }, []);

  const fetchEmployees = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${backendUrl}/api/employees`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      setEmployees(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching employees:', error);
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
    setIsPopupOpen(true);
  };

  const handleEditEmployeeClick = (emp) => {
    setPopupMode('edit');
    setCurrentEmployee(emp);
    setFirstName(emp.first_name);
    setLastName(emp.last_name);
    setPartTime(emp.part_time);
    setCityId(emp.city_id);
    setIsPopupOpen(true);
  };

  const handleDeleteEmployee = async (id) => {
    if (!window.confirm('Czy na pewno usunąć pracownika?')) return;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${backendUrl}/api/employees/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) fetchEmployees();
      else alert('Błąd przy usuwaniu pracownika');
    } catch (error) {
      console.error(error);
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
    };

    if (popupMode === 'add') {
      try {
        const res = await fetch(`${backendUrl}/api/employees`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(employeeData),
        });
        if (res.ok) {
          fetchEmployees();
          setIsPopupOpen(false);
        } else {
          alert('Błąd przy dodawaniu pracownika');
        }
      } catch (error) {
        console.error(error);
      }
    } else if (popupMode === 'edit' && currentEmployee) {
      try {
        const res = await fetch(`${backendUrl}/api/employees/${currentEmployee.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(employeeData),
        });
        if (res.ok) {
          fetchEmployees();
          setIsPopupOpen(false);
        } else {
          alert('Błąd przy edycji pracownika');
        }
      } catch (error) {
        console.error(error);
      }
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
          <button type="submit">{popupMode === 'add' ? 'Dodaj' : 'Zaktualizuj'}</button>
        </form>
      </Popup>
    </div>
  );
}

export default EmployeesPage;
