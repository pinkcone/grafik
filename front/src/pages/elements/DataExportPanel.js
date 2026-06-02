import React, { useState } from 'react';
import '../../styles/DataExportPanel.css';

function DataExportPanel() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastExport, setLastExport] = useState(null);

  const handleExport = async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      setError('Brak zalogowania — zaloguj się ponownie.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/export/data', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        let msg = `Błąd ${res.status}`;
        try {
          const data = await res.json();
          msg = data.message || msg;
        } catch {
          /* odpowiedź nie-JSON */
        }
        throw new Error(msg);
      }

      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition');
      let filename = `grafik-export-${new Date().toISOString().slice(0, 10)}.json`;
      if (disposition) {
        const match = disposition.match(/filename="?([^"]+)"?/);
        if (match) filename = match[1];
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setLastExport(new Date().toLocaleString('pl-PL'));
    } catch (e) {
      console.error('Export error:', e);
      setError(e.message || 'Nie udało się pobrać eksportu.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="data-export-panel">
      <h2>Eksport danych</h2>
      <p className="data-export-panel__desc">
        Pobierz plik JSON ze wszystkimi swoimi miastami, pracownikami, trasami,
        etykietami i grafikiem. Zawiera też sekcję <strong>podsumowanie</strong> ze
        statystykami ułatwiającymi analizę sposobu układania grafiku.
      </p>
      <button
        type="button"
        className="data-export-panel__btn"
        onClick={handleExport}
        disabled={loading}
      >
        {loading ? 'Przygotowuję plik…' : 'Pobierz eksport (JSON)'}
      </button>
      {lastExport && (
        <p className="data-export-panel__success">
          Ostatni eksport: {lastExport}
        </p>
      )}
      {error && <p className="data-export-panel__error">{error}</p>}
    </section>
  );
}

export default DataExportPanel;
