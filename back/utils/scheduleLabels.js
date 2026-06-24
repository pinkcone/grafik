/**
 * Etykieta w danym dniu wyklucza przypisanie trasy — bez wyjątków.
 */
const hasEmployeeLabelOnDay = (employeeId, date, schedules) => {
  if (!employeeId || !date || !Array.isArray(schedules)) return false;
  return schedules.some(
    (s) =>
      s.employee_id?.toString() === employeeId.toString() &&
      s.date === date &&
      s.label
  );
};

module.exports = {
  hasEmployeeLabelOnDay,
};
