// src/components/Header.js
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';
import "../styles/Header.css";
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
        console.log(decoded.first_name);
    } catch (error) {
      console.error('Błąd dekodowania tokena:', error);
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('token');
    window.location.href = "/login";
  };

  return (
    <div className='header-div'>
      <span>Witaj, {userName || 'użytkowniku'}!</span>
      <button onClick={handleLogout}>Wyloguj</button>
    </div>
  );
}

export default Header;
