// src/components/Header.js
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';

function Header() {
  const navigate = useNavigate();
  const token = localStorage.getItem('token');
  let userName = '';

  if (token) {
    try {
      const decoded = jwtDecode(token);
      // Zakładamy, że token zawiera pola "first_name" i "last_name".
      // Jeśli nie – możesz zamiast tego wyświetlić np. decoded.email.
      userName = decoded.first_name && decoded.last_name 
        ? `${decoded.first_name} ${decoded.last_name}` 
        : decoded.email;
    } catch (error) {
      console.error('Błąd dekodowania tokena:', error);
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('token');
    // Jeśli zapisywałeś dodatkowe dane, usuń je również (np. localStorage.removeItem('userName'))
    window.location.href = "/login";
  };

  return (
    <div style={{
      padding: '10px', 
      backgroundColor: '#eee', 
      display: 'flex', 
      justifyContent: 'space-between', 
      alignItems: 'center'
    }}>
      <span>Witaj, {userName || 'użytkowniku'}!</span>
      <button onClick={handleLogout}>Wyloguj</button>
    </div>
  );
}

export default Header;
