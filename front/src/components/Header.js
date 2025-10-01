import React from 'react';
import { jwtDecode } from 'jwt-decode';
import "../styles/Header.css";

function Header() {
  const token = localStorage.getItem('token');
  let userName = '';

  if (token) {
    try {
      const decoded = jwtDecode(token);
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

  const handleStartPage = () => {
    window.location.href = "/";
  };
  return (
    <div className='header-div'>

      <p onClick={handleStartPage}>Witaj, {userName || 'użytkowniku'}!</p>
      <button onClick={handleLogout}>Wyloguj</button>
    </div>
  );
}

export default Header;
