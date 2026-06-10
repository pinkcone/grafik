// src/pages/HomePage.js
import React from 'react';
import "../styles/HomePage.css";
import CitiesPage from "./CitiesPage"
import LabelsPage from './LabelsPage';

function HomePage() {
  return (
    <div className='mainHome'>
        <CitiesPage />
        <LabelsPage />
    </div>
  );
}

export default HomePage;
