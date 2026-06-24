import { canDriveWithCategory } from './licenseCategories';
import { getOperatingDayBlockReason } from './routeOperatingDays';
import { getSaturdayAssignmentBlockReason } from './scheduleRules';
import { hasEmployeeLabelOnDay } from './scheduleLabels';
import { canEmployeeHaveAnotherRouteOnDay } from './scheduleConstraints';

export const toBoolean = (value) => {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return false;
};

export const hasSpecialPermissions = (value) => toBoolean(value);

export const routeRequiresStaffing = (route) => {
  if (!route) return true;
  if (route.requires_staffing === undefined || route.requires_staffing === null) return true;
  return toBoolean(route.requires_staffing);
};

export const findPairRoute = (route, allRoutes = []) => {
  if (!route || !Array.isArray(allRoutes)) return null;
  const idStr = route.id.toString();

  if (route.linked_route_id != null) {
    return allRoutes.find((r) => r.id.toString() === route.linked_route_id.toString()) || null;
  }

  return allRoutes.find(
    (r) => r.linked_route_id != null && r.linked_route_id.toString() === idStr
  ) || null;
};

export const getAssignmentBlockReason = (employee, route, options = {}) => {
  const { pairedRoute = null, date = null, schedules = null, allRoutes = [] } = options;

  if (!employee || !route) {
    return 'Brak danych pracownika lub trasy.';
  }

  if (date && schedules && hasEmployeeLabelOnDay(employee.id, date, schedules)) {
    return 'Pracownik ma wpisaną etykietę tego dnia — nie można przypisać trasy.';
  }

  if (date && schedules && allRoutes.length > 0) {
    const canTake =
      canEmployeeHaveAnotherRouteOnDay(employee.id, route.id, date, schedules, allRoutes) ||
      canEmployeeHaveAnotherRouteOnDay(employee.id, route.id, date, schedules, allRoutes, {
        allowPairLeg: true,
      });
    if (!canTake) {
      return 'Pracownik ma już inną trasę tego dnia — nie można przypisać drugiej.';
    }
  }

  const dayReason = getOperatingDayBlockReason(route, date);
  if (dayReason) return dayReason;

  if (pairedRoute) {
    const pairDayReason = getOperatingDayBlockReason(pairedRoute, date, 'Trasa powiązana');
    if (pairDayReason) return pairDayReason;
  }

  const saturdayReason = getSaturdayAssignmentBlockReason(employee, route, date);
  if (saturdayReason) return saturdayReason;

  if (pairedRoute) {
    const pairSaturdayReason = getSaturdayAssignmentBlockReason(
      employee,
      pairedRoute,
      date,
      'Trasa powiązana'
    );
    if (pairSaturdayReason) return pairSaturdayReason;
  }

  const requiredCategory = route.required_license_category || 'B';
  const employeeCategory = employee.license_category || null;

  if (!canDriveWithCategory(employeeCategory, requiredCategory)) {
    if (!employeeCategory) {
      return `Brak ustawionej kategorii prawa jazdy (trasa wymaga ${requiredCategory}).`;
    }
    return `Kategoria prawa jazdy nie pasuje: trasa wymaga ${requiredCategory}, pracownik ma ${employeeCategory}.`;
  }

  if (hasSpecialPermissions(route.requires_special_permissions) && !hasSpecialPermissions(employee.special_permissions)) {
    return 'Trasa wymaga specjalnych uprawnień, których ten pracownik nie posiada.';
  }

  if (pairedRoute) {
    const pairReason = getAssignmentBlockReason(employee, pairedRoute, { date });
    if (pairReason) {
      return `Trasa powiązana „${pairedRoute.name}”: ${pairReason}`;
    }
  }

  return null;
};

export const canAssignEmployeeToRoute = (employee, route, options = {}) => {
  return getAssignmentBlockReason(employee, route, options) === null;
};

export const canAssignEmployeeToRouteWithPair = (employee, route, allRoutes = [], date = null, schedules = null) => {
  const pairedRoute = findPairRoute(route, allRoutes);
  return canAssignEmployeeToRoute(employee, route, { pairedRoute, date, schedules, allRoutes });
};

export const getRouteRestrictionTier = (route) => {
  if (!route) return 0;
  const needsC = (route.required_license_category || 'B') === 'C';
  const needsSP = hasSpecialPermissions(route.requires_special_permissions);
  if (needsC && needsSP) return 4;
  if (needsC) return 3;
  if (needsSP) return 2;
  return 1;
};

export const getRouteRestrictionTierWithPair = (route, allRoutes = []) => {
  const pair = findPairRoute(route, allRoutes);
  return Math.max(getRouteRestrictionTier(route), getRouteRestrictionTier(pair));
};

export const getEmployeeCapabilityTier = (employee) => {
  if (!employee) return 0;
  const hasC = employee.license_category === 'C';
  const hasB = employee.license_category === 'B';
  const hasSP = hasSpecialPermissions(employee.special_permissions);
  if (hasC && hasSP) return 4;
  if (hasC) return 3;
  if (hasB && hasSP) return 2;
  if (hasB) return 1;
  return 0;
};

export const sortRoutesByAssignmentPriority = (routes = []) => {
  return [...routes].sort((a, b) => {
    const tierDiff = getRouteRestrictionTierWithPair(b, routes) - getRouteRestrictionTierWithPair(a, routes);
    if (tierDiff !== 0) return tierDiff;
    return (a.name || '').localeCompare(b.name || '', 'pl');
  });
};

export const compareEmployeesForRoute = (employeeA, employeeB, route, allRoutes = []) => {
  const routeTier = getRouteRestrictionTierWithPair(route, allRoutes);
  const tierA = getEmployeeCapabilityTier(employeeA);
  const tierB = getEmployeeCapabilityTier(employeeB);
  if (routeTier >= 2) return tierB - tierA;
  return tierA - tierB;
};

export const formatYesNo = (value) => (hasSpecialPermissions(value) ? 'Tak' : 'Nie');
