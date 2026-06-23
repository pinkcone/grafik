// src/App.js
import React, { useState, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import CitiesPage from './pages/CitiesPage';
import CityDetailPage from './pages/CityDetailPage';
import LabelsPage from './pages/LabelsPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import Header from './components/Header';

function readToken() {
  return localStorage.getItem('token');
}

function App() {
  const [token, setToken] = useState(readToken);

  useEffect(() => {
    const syncToken = () => setToken(readToken());
    window.addEventListener('grafik-auth', syncToken);
    window.addEventListener('storage', syncToken);
    return () => {
      window.removeEventListener('grafik-auth', syncToken);
      window.removeEventListener('storage', syncToken);
    };
  }, []);

  return (
    <div>
      {token && <Header onLogout={() => setToken(null)} />}

      <Routes>
        {token ? (
          <>
            <Route path="/" element={<HomePage />} />
            <Route path="/cities" element={<CitiesPage />} />
            <Route path="/cities/:cityId" element={<CityDetailPage />} />
            <Route path="/labels" element={<LabelsPage />} />
            <Route path="*" element={<HomePage />} />
          </>
        ) : (
          <>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="*" element={<LoginPage />} />
          </>
        )}
      </Routes>
    </div>
  );
}

export default App;
