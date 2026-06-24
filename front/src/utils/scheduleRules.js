import { getIsoWeekday } from './routeOperatingDays';

const toBoolean = (value) => {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return false;
};

const hasSpecialPermissions = (value) => toBoolean(value);

export const isSaturday = (dateStr) => dateStr && getIsoWeekday(dateStr) === 6;

export const getSaturdayAssignmentBlockReason = (employee, route, dateStr, labelPrefix = 'Trasa') => {
  if (!employee || !route || !dateStr || !isSaturday(dateStr)) return null;

  if (employee.license_category === 'C') {
    return 'Kierowcy z prawem jazdy kat. C nie jeżdżą w soboty.';
  }

  if (
    !hasSpecialPermissions(route.requires_special_permissions) &&
    hasSpecialPermissions(employee.special_permissions)
  ) {
    return `W sobotę na trasę bez wkładki (${labelPrefix} „${route.name}”) można przydzielić tylko pracownika bez specjalnych uprawnień.`;
  }

  return null;
};
