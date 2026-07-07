import React from 'react';
import Popup from '../../components/Popup';
import { sortRoutesByAssignmentPriority } from '../../utils/routeAssignment';
import { calculateDuration, MONTH_NAMES, isoWeekdayIndex } from '../../utils/scheduleViewHelpers';

const WEEKDAY_HEADERS = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];

function BulkCalendar({ month, year, days, selectedDays, onToggleDay }) {
  const firstIso = isoWeekdayIndex(year, month, 1); // Pn=0
  const blanks = Array.from({ length: firstIso }, (_, i) => <div key={`b-${i}`} />);
  const dayCells = days.map((day) => {
    const selected = selectedDays.includes(day);
    const isWeekend = isoWeekdayIndex(year, month, day) >= 5;
    return (
      <button
        key={day}
        type="button"
        onClick={() => onToggleDay(day)}
        style={{
          padding: '8px 0',
          borderRadius: 6,
          border: selected ? '2px solid #2563eb' : '1px solid #ccc',
          background: selected ? '#2563eb' : (isWeekend ? '#f3f4f6' : '#fff'),
          color: selected ? '#fff' : (isWeekend ? '#6b7280' : '#111'),
          fontWeight: selected ? 700 : 400,
          cursor: 'pointer',
        }}
      >
        {day}
      </button>
    );
  });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
      {WEEKDAY_HEADERS.map((d) => (
        <div key={d} style={{ textAlign: 'center', fontSize: '0.8em', fontWeight: 600, opacity: 0.7 }}>
          {d}
        </div>
      ))}
      {blanks}
      {dayCells}
    </div>
  );
}

function BulkAssignModal({
  isOpen,
  loading,
  employees,
  routes,
  labels,
  month,
  year,
  days,
  employeeId,
  value,
  selectedDays,
  onEmployeeChange,
  onValueChange,
  onToggleDay,
  onClearDays,
  onSubmit,
  onClose,
}) {
  return (
    <Popup
      isOpen={isOpen}
      onClose={() => {
        if (loading) return;
        onClose();
      }}
    >
      <h3>Przypisz na wybrane dni</h3>
      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 340 }}>
        <div>
          <label>Pracownik:</label>
          <select value={employeeId} onChange={(e) => onEmployeeChange(e.target.value)} required>
            <option value="">-- wybierz --</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.last_name} {emp.first_name}
                {emp.license_category ? ` [${emp.license_category}]` : ''}
                {emp.special_permissions ? ' [SP]' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Trasa / etykieta:</label>
          <select value={value} onChange={(e) => onValueChange(e.target.value)} required>
            <option value="">-- wybierz --</option>
            <optgroup label="Trasy">
              {sortRoutesByAssignmentPriority(routes).map((rt) => (
                <option key={`r-${rt.id}`} value={`R:${rt.id}`}>
                  {rt.name} ({calculateDuration(rt).toFixed(2)}h) [{rt.required_license_category || 'B'}]
                  {rt.requires_special_permissions ? ' [SP]' : ''}
                </option>
              ))}
            </optgroup>
            <optgroup label="Etykiety">
              {labels.map((l) => (
                <option key={`l-${l.code}`} value={`L:${l.code}`}>
                  {l.code}{l.description ? ` — ${l.description}` : ''}
                </option>
              ))}
            </optgroup>
          </select>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <label style={{ margin: 0 }}>Dni ({MONTH_NAMES[month - 1]} {year}):</label>
            <span style={{ fontSize: '0.85em', opacity: 0.8 }}>
              zaznaczono: {selectedDays.length}
              {selectedDays.length > 0 && (
                <button
                  type="button"
                  onClick={onClearDays}
                  style={{ marginLeft: 8, fontSize: '0.85em', cursor: 'pointer' }}
                >
                  wyczyść
                </button>
              )}
            </span>
          </div>
          <BulkCalendar
            month={month}
            year={year}
            days={days}
            selectedDays={selectedDays}
            onToggleDay={onToggleDay}
          />
        </div>

        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Przypisywanie…' : `Przypisz na ${selectedDays.length} dni`}
        </button>
      </form>
    </Popup>
  );
}

export default BulkAssignModal;
