import React from 'react';

function ScheduleToolbar({
  onExportXLSX,
  onExportCSV,
  onAutoFill,
  autoFillRunning,
  onAssignMonth,
  onBulkAssign,
  onClearMonth,
}) {
  return (
    <div className="schedule-toolbar">
      <button type="button" onClick={onExportXLSX}>Eksport do XLSX</button>
      <button type="button" onClick={onExportCSV}>Eksport do CSV</button>
      <button
        type="button"
        className="btn-primary"
        onClick={onAutoFill}
        disabled={autoFillRunning}
      >
        {autoFillRunning ? 'Uzupełnianie…' : 'Uzupełnij trasy'}
      </button>
      <button type="button" className="btn-primary" onClick={onAssignMonth}>
        Przypisz na cały miesiąc
      </button>
      <button type="button" className="btn-primary" onClick={onBulkAssign}>
        Przypisz na wybrane dni
      </button>
      <button type="button" className="btn-danger" onClick={onClearMonth}>
        Wyczyść auto miesiąca
      </button>
    </div>
  );
}

export default ScheduleToolbar;
