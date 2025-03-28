// src/pages/HomePage.js
import React from 'react';
import { Link } from 'react-router-dom';
import "../styles/HomePage.css";
function HomePage() {
  return (
    <div className='mainHome'>
      <h2>Strona Główna</h2>
      <ul>
        <li><Link to="/cities">Moje Miasta</Link></li>
        <li><Link to="/labels">Moje Lebale</Link></li>
      </ul>
    </div>
  );
}

export default HomePage;
