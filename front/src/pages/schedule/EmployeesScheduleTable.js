import React from 'react';
import { buildDate } from '../../utils/scheduleViewHelpers';

function EmployeesScheduleTable({
  tableRef,
  employees,
  days,
  year,
  month,
  renderDayHeader,
  getCellSchedulesAll,
  getAvailableOptionsForEmployeeCell,
  buildDisplayOptionForEntry,
  updateScheduleCell,
  updateExistingEntryInEmployeeCell,
  calculateEmployeeHours,
  calculateQuarterEmployeeHours,
}) {
  return (
    <div
      ref={tableRef}
      style={{ overflowX: 'auto', maxWidth: '100%' }}
      className="schedule-container"
    >
      <table className="schedule-table">
        <thead>
          <tr>
            <th>Pracownik</th>
            {days.map((day) => renderDayHeader(day))}
            <th>Godziny miesiąc</th>
            <th>Godziny kwartał</th>
          </tr>
        </thead>
        <tbody>
          {employees.map((emp) => (
            <tr key={emp.id}>
              <td>{emp.last_name} {emp.first_name}</td>
              {days.map((day) => {
                const date = buildDate(year, month, day);
                const entries = getCellSchedulesAll(emp.id, date);

                if (entries.length === 0) {
                  const options = getAvailableOptionsForEmployeeCell(emp.id, day);
                  return (
                    <td key={day}>
                      <select
                        value=""
                        onChange={(e) => updateScheduleCell(emp.id, date, e.target.value)}
                      >
                        {options.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </td>
                  );
                }

                return (
                  <td key={day}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {entries.map((entry) => {
                        const opt = buildDisplayOptionForEntry(entry);
                        const options = getAvailableOptionsForEmployeeCell(emp.id, day);
                        return (
                          <select
                            key={entry.id || `${opt.value}-${date}`}
                            value={opt.value}
                            onChange={(e) => updateExistingEntryInEmployeeCell(entry, date, e.target.value)}
                          >
                            <option value={opt.value}>{opt.label}</option>
                            <option value={`D:${entry.id}`}>🗑 Usuń ten wpis</option>
                            {options
                              .filter((o) => o.value !== opt.value)
                              .map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                          </select>
                        );
                      })}
                    </div>
                  </td>
                );
              })}
              <td>{calculateEmployeeHours(emp.id)}</td>
              <td>{calculateQuarterEmployeeHours(emp.id).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default EmployeesScheduleTable;
