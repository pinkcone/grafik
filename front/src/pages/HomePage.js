// src/pages/HomePage.js
import React from 'react';
import { Link } from 'react-router-dom';

function HomePage() {
  return (
    <div>
      <h2>Strona Główna</h2>
      <ul>
        <li><Link to="/cities">Moje Miasta</Link></li>
        <li><Link to="/labels">Moje Lebale</Link></li>
      </ul>
    </div>
  );
}

export default HomePage;
