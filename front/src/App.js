// src/App.js
import React from 'react';
import { Routes, Route, Link, Navigate } from 'react-router-dom';
import HomePage from './pages/HomePage';
import CitiesPage from './pages/CitiesPage';
import CityDetailPage from './pages/CityDetailPage';
import LabelsPage from './pages/LabelsPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import Header from './components/Header';

function App() {
  const token = localStorage.getItem('token');

  return (
    <div>
      {token && <Header />}
      <nav>
        <ul>
          {token ? (
            <>
              <li><Link to="/cities">Moje Miasta</Link></li>
              <li><Link to="/labels">Moje Lebale</Link></li>
            </>
          ) : (
            <>
              <li><Link to="/login">Logowanie</Link></li>
              <li><Link to="/register">Rejestracja</Link></li>
            </>
          )}
        </ul>
      </nav>
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
            <Route path="*" element={<Navigate to="/login" replace />} />
          </>
        )}
      </Routes>
    </div>
  );
}

export default App;
