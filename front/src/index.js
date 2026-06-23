import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { getDebugLogs } from './utils/debugLog';

const prevLogs = getDebugLogs();
if (prevLogs.length > 0) {
  console.log(`[grafik] ${prevLogs.length} zapisanych logów — wpisz showGrafikLogs() aby je zobaczyć`);
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
