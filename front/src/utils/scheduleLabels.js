export const hasEmployeeLabelOnDay = (employeeId, date, schedules, labelCode = null) => {
  if (!employeeId || !date || !Array.isArray(schedules)) return false;
  return schedules.some((s) => {
    if (s.employee_id?.toString() !== employeeId.toString()) return false;
    if (s.date !== date) return false;
    const label = s.label;
    if (label == null || String(label).trim() === '') return false;
    if (labelCode != null) return String(label).trim() === String(labelCode).trim();
    return true;
  });
};
