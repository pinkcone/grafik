// src/pages/HomePage.js
import React from 'react';
import "../styles/HomePage.css";
import CitiesPage from "./CitiesPage"
import LabelsPage from './LabelsPage';
import DataExportPanel from './elements/DataExportPanel';

function HomePage() {
  return (
    <div className="home-page">
      <DataExportPanel />
      <div className="mainHome">
        <CitiesPage />
        <LabelsPage />
      </div>
    </div>
  );
}

export default HomePage;
