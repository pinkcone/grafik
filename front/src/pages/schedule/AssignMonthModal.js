import React from 'react';
import Popup from '../../components/Popup';
import { sortRoutesByAssignmentPriority } from '../../utils/routeAssignment';
import { calculateDuration } from '../../utils/scheduleViewHelpers';

function AssignMonthModal({
  isOpen,
  loading,
  employees,
  routes,
  month,
  year,
  employeeId,
  routeId,
  onEmployeeChange,
  onRouteChange,
  onSubmit,
  onClose,
}) {
  return (
    <Popup isOpen={isOpen} onClose={() => !loading && onClose()}>
      <h3>Przypisz na cały miesiąc</h3>
      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 320 }}>
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
          <label>Trasa:</label>
          <select value={routeId} onChange={(e) => onRouteChange(e.target.value)} required>
            <option value="">-- wybierz --</option>
            {sortRoutesByAssignmentPriority(routes).map((rt) => (
              <option key={rt.id} value={rt.id}>
                {rt.name} ({calculateDuration(rt).toFixed(2)}h)
              </option>
            ))}
          </select>
        </div>
        <p style={{ margin: 0, fontSize: '0.9em', opacity: 0.85 }}>
          Przypisanie obejmuje każdy dzień kursowania trasy w {month}.{year},
          gdy slot trasy jest wolny i pracownik nie ma innej trasy ani etykiety.
        </p>
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Przypisywanie…' : 'Przypisz'}
        </button>
      </form>
    </Popup>
  );
}

export default AssignMonthModal;
