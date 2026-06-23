import React from 'react';
import { useNavigate } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';
import '../styles/Header.css';

function Header({ onLogout }) {
  const navigate = useNavigate();
  const token = localStorage.getItem('token');
  let userName = '';
  let initials = 'U';

  if (token) {
    try {
      const decoded = jwtDecode(token);
      if (decoded.first_name && decoded.last_name) {
        userName = `${decoded.first_name} ${decoded.last_name}`;
        initials = `${decoded.first_name[0]}${decoded.last_name[0]}`.toUpperCase();
      } else {
        userName = decoded.email || 'użytkowniku';
        initials = userName[0]?.toUpperCase() || 'U';
      }
    } catch (error) {
      console.error('Błąd dekodowania tokena:', error);
      userName = 'użytkowniku';
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('token');
    window.dispatchEvent(new Event('grafik-auth'));
    onLogout?.();
    navigate('/login');
  };

  const handleStartPage = () => {
    navigate('/');
  };

  return (
    <header className="app-header">
      <div className="app-header__inner">
        <button type="button" className="app-header__brand" onClick={handleStartPage}>
          <span className="app-header__logo" aria-hidden="true">G</span>
          <span className="app-header__brand-text">
            <span className="app-header__title">JaGrafiko</span>
            <span className="app-header__subtitle">Zarządzanie grafikami</span>
          </span>
        </button>

        <div className="app-header__actions">
          <div className="app-header__user">
            <span className="app-header__avatar" aria-hidden="true">{initials}</span>
            <span className="app-header__name">Witaj, {userName}</span>
          </div>
          <button type="button" className="app-header__logout" onClick={handleLogout}>
            Wyloguj
          </button>
        </div>
      </div>
    </header>
  );
}

export default Header;
