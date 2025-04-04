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
  // Pobieramy token z localStorage, aby określić czy użytkownik jest zalogowany
  const token = localStorage.getItem('token');

  return (
    <div>
      {token && <Header />}
      
      <Routes>
        {token ? (
          <>
            <Route path="/" element={<HomePage />} />
            <Route path="/cities" element={<CitiesPage />} />
            <Route path="/cities/:cityId" element={<CityDetailPage />} />
            <Route path="/labels" element={<LabelsPage />} />
            {/* Wszystkie nieznane ścieżki przekierowujemy do strony głównej */}
            <Route path="*" element={<LoginPage />} />
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
