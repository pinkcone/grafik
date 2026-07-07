import React from 'react';
import { buildDate, calculateDuration } from '../../utils/scheduleViewHelpers';

function RoutesScheduleTable({
  tableRef,
  routes,
  schedules,
  days,
  year,
  month,
  renderDayHeader,
  getAvailableEmployeesForRouteCell,
  updateScheduleForRouteCell,
}) {
  return (
    <div className="schedule-routes-container" style={{ overflowX: 'auto', maxWidth: '100%' }} ref={tableRef}>
      <table className="schedule-routes" border="1" cellPadding="5">
        <thead>
          <tr>
            <th>Trasa</th>
            {days.map((day) => renderDayHeader(day))}
          </tr>
        </thead>
        <tbody>
          {routes.map((rt) => {
            const isPaired =
              rt.linked_route_id != null ||
              routes.some((r) => r.linked_route_id != null && r.linked_route_id.toString() === rt.id.toString());
            return (
              <tr key={rt.id}>
                <td>
                  {rt.name} ({calculateDuration(rt).toFixed(2)}h)
                  {isPaired && (
                    <span style={{ marginLeft: 6, opacity: 0.7 }} title="Trasa powiązana (para)">
                      (para)
                    </span>
                  )}
                </td>
                {days.map((day) => {
                  const date = buildDate(year, month, day);
                  const cell = schedules.find((s) => s.date === date && s.route_id?.toString() === rt.id.toString());
                  const selectedEmployee = cell ? cell.employee_id : '';
                  const options = getAvailableEmployeesForRouteCell(rt.id, day);
                  return (
                    <td key={day}>
                      <select
                        value={selectedEmployee}
                        onChange={(e) => updateScheduleForRouteCell(rt.id, day, e.target.value)}
                      >
                        {cell && <option value="DELETE">🗑 Usuń tę trasę (dzień)</option>}
                        {options.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default RoutesScheduleTable;
