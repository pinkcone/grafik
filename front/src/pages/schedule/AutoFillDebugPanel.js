import React from 'react';

function AutoFillDebugPanel({ debug, open, onToggle, onClose }) {
  if (!debug) return null;

  return (
    <div className="auto-fill-debug">
      <div className="auto-fill-debug__header">
        <strong>Log auto-uzupełniania</strong>
        {debug.afterPersist?.summary && (
          <span className="auto-fill-debug__stats">
            Puste dni: {debug.afterPersist.summary.emptyEmployeeDays}
            {' · '}
            z trasami w dropdownie: {debug.afterPersist.summary.emptyWithAssignableRoutes}
            {' · '}
            wolne trasy: {debug.afterPersist.summary.openRouteSlots}
            {' · '}
            deficyt godzin: {debug.afterPersist.summary.underHourEmployees}
            {debug.persistSkippedCount > 0 && (
              <> · pominięte zapisy: {debug.persistSkippedCount}</>
            )}
          </span>
        )}
        <button
          type="button"
          className="auto-fill-debug__toggle"
          onClick={onToggle}
        >
          {open ? 'Zwiń' : 'Rozwiń'}
        </button>
        <button
          type="button"
          className="auto-fill-debug__close"
          onClick={onClose}
          title="Zamknij log"
        >
          ×
        </button>
      </div>
      {open && (
        <pre className="auto-fill-debug__log">
          {(debug.logs || []).join('\n')}
        </pre>
      )}
    </div>
  );
}

export default AutoFillDebugPanel;
