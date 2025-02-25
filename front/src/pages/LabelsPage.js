// src/pages/LabelsPage.js
import React, { useState, useEffect } from 'react';
import Popup from '../components/Popup';

const backendUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';

function LabelsPage() {
  const token = localStorage.getItem('token');
  const [labels, setLabels] = useState([]);

  // Stany dla modal (popup) – tryb dodawania/edycji
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('add'); // 'add' lub 'edit'
  const [currentCode, setCurrentCode] = useState('');
  const [code, setCode] = useState('');
  const [defaultHours, setDefaultHours] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    fetchLabels();
  }, []);

  const fetchLabels = async () => {
    try {
      const res = await fetch(`/api/labels`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      // Zakładamy, że API zwraca tablicę etykiet
      setLabels(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Błąd pobierania etykiet:", error);
    }
  };

  const openModalForAdd = () => {
    setModalMode('add');
    setCode('');
    setDefaultHours('');
    setDescription('');
    setIsModalOpen(true);
  };

  const openModalForEdit = (label) => {
    setModalMode('edit');
    setCurrentCode(label.code);
    setCode(label.code);
    setDefaultHours(label.default_hours);
    setDescription(label.description || '');
    setIsModalOpen(true);
  };

  const handleModalSubmit = async (e) => {
    e.preventDefault();
    const labelData = {
      code,
      default_hours: defaultHours,
      description,
    };
    try {
      let res;
      if (modalMode === 'add') {
        res = await fetch(`/api/labels`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(labelData)
        });
      } else {
        res = await fetch(`/api/labels/${currentCode}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(labelData)
        });
      }
      if (res.ok) {
        fetchLabels();
        setIsModalOpen(false);
      } else {
        alert("Błąd przy zapisie etykiety");
      }
    } catch (error) {
      console.error("Błąd przy zapisie etykiety:", error);
    }
  };

  const handleDelete = async (labelCode) => {
    if (!window.confirm("Czy na pewno usunąć etykietę?")) return;
    try {
      const res = await fetch(`/api/labels/${labelCode}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        fetchLabels();
      } else {
        alert("Błąd przy usuwaniu etykiety");
      }
    } catch (error) {
      console.error("Błąd przy usuwaniu etykiety:", error);
    }
  };

  return (
    <div>
      <h2>Moje Lebale</h2>
      <button onClick={openModalForAdd}>Dodaj etykietę</button>
      <table border="1" cellPadding="5">
        <thead>
          <tr>
            <th>Kod</th>
            <th>Domyślne godziny</th>
            <th>Opis</th>
            <th>Akcje</th>
          </tr>
        </thead>
        <tbody>
          {labels.map(label => (
            <tr key={label.code}>
              <td>{label.code}</td>
              <td>{label.default_hours}</td>
              <td>{label.description}</td>
              <td>
                <button onClick={() => openModalForEdit(label)}>Edytuj</button>
                <button onClick={() => handleDelete(label.code)}>Usuń</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Popup isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <h3>{modalMode === 'add' ? 'Dodaj etykietę' : 'Edytuj etykietę'}</h3>
        <form onSubmit={handleModalSubmit}>
          <div>
            <label>Kod:</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              disabled={modalMode === 'edit'}
            />
          </div>
          <div>
            <label>Domyślne godziny:</label>
            <input
              type="number"
              value={defaultHours}
              onChange={(e) => setDefaultHours(e.target.value)}
              required
              step="0.1"
            />
          </div>
          <div>
            <label>Opis:</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <button type="submit">{modalMode === 'add' ? 'Dodaj' : 'Zaktualizuj'}</button>
        </form>
      </Popup>
    </div>
  );
}

export default LabelsPage;
