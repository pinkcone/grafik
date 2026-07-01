const { canDriveWithCategory } = require('./licenseCategories');
const { getOperatingDayBlockReason } = require('./routeOperatingDays');
const { getSaturdayAssignmentBlockReason, getSaturdayDw5BlockReason, isSaturday } = require('./scheduleRules');
const { hasEmployeeLabelOnDay } = require('./scheduleLabels');
const { canEmployeeHaveAnotherRouteOnDay } = require('./scheduleConstraints');

const toBoolean = (value) => {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return false;
};

const hasSpecialPermissions = (value) => toBoolean(value);

/** Domyślnie true — trasa musi być obsadzona, jeśli są dostępni kierowcy */
const routeRequiresStaffing = (route) => {
  if (!route) return true;
  if (route.requires_staffing === undefined || route.requires_staffing === null) return true;
  return toBoolean(route.requires_staffing);
};

const findPairRoute = (route, allRoutes = []) => {
  if (!route || !Array.isArray(allRoutes)) return null;
  const idStr = route.id.toString();

  if (route.linked_route_id != null) {
    return allRoutes.find((r) => r.id.toString() === route.linked_route_id.toString()) || null;
  }

  return allRoutes.find(
    (r) => r.linked_route_id != null && r.linked_route_id.toString() === idStr
  ) || null;
};

const getAssignmentBlockReason = (employee, route, options = {}) => {
  const { pairedRoute = null, date = null, schedules = null, allRoutes = [], employeeCount = 0, initialEmployeeDays = null, skipSlotCheck = false, skipDw5Check = false } = options;

  if (!employee || !route) {
    return 'Brak danych pracownika lub trasy.';
  }

  if (date && schedules && hasEmployeeLabelOnDay(employee.id, date, schedules)) {
    return 'Pracownik ma wpisaną etykietę tego dnia — nie można przypisać trasy.';
  }

  if (!skipSlotCheck && date && schedules && allRoutes.length > 0) {
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

  if (!skipDw5Check && date && isSaturday(date) && employeeCount > 0 && schedules) {
    const dw5Reason = getSaturdayDw5BlockReason(
      employee,
      date,
      schedules,
      allRoutes,
      employeeCount,
      { initialEmployeeDays }
    );
    if (dw5Reason) return dw5Reason;
  }

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
    const pairReason = getAssignmentBlockReason(employee, pairedRoute, {
      date,
      schedules,
      allRoutes,
      employeeCount,
      initialEmployeeDays,
      skipSlotCheck,
      skipDw5Check,
    });
    if (pairReason) {
      return `Trasa powiązana „${pairedRoute.name}”: ${pairReason}`;
    }
  }

  return null;
};

const canAssignEmployeeToRoute = (employee, route, options = {}) => {
  return getAssignmentBlockReason(employee, route, options) === null;
};

const canAssignEmployeeToRouteWithPair = (employee, route, allRoutes = [], date = null, schedules = null) => {
  const pairedRoute = findPairRoute(route, allRoutes);
  return canAssignEmployeeToRoute(employee, route, { pairedRoute, date, schedules, allRoutes });
};

/** Wyższy tier = trudniejsza trasa → uzupełniać wcześniej */
const getRouteRestrictionTier = (route) => {
  if (!route) return 0;
  const needsC = (route.required_license_category || 'B') === 'C';
  const needsSP = hasSpecialPermissions(route.requires_special_permissions);
  if (needsC && needsSP) return 4;
  if (needsC) return 3;
  if (needsSP) return 2;
  return 1;
};

const getRouteRestrictionTierWithPair = (route, allRoutes = []) => {
  const pair = findPairRoute(route, allRoutes);
  return Math.max(getRouteRestrictionTier(route), getRouteRestrictionTier(pair));
};

/** Wyższy tier = bardziej „cenny” kierowca (C / SP) */
const getEmployeeCapabilityTier = (employee) => {
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

const sortRoutesByAssignmentPriority = (routes = []) => {
  return [...routes].sort((a, b) => {
    const tierDiff = getRouteRestrictionTierWithPair(b, routes) - getRouteRestrictionTierWithPair(a, routes);
    if (tierDiff !== 0) return tierDiff;
    return (a.name || '').localeCompare(b.name || '', 'pl');
  });
};

/** Na trasach wymagających C/SP — najpierw „rzadkich” kierowców; na B — oszczędzamy C/SP */
const compareEmployeesForRoute = (employeeA, employeeB, route, allRoutes = []) => {
  const routeTier = getRouteRestrictionTierWithPair(route, allRoutes);
  const tierA = getEmployeeCapabilityTier(employeeA);
  const tierB = getEmployeeCapabilityTier(employeeB);
  if (routeTier >= 2) return tierB - tierA;
  return tierA - tierB;
};

module.exports = {
  toBoolean,
  hasSpecialPermissions,
  routeRequiresStaffing,
  findPairRoute,
  getAssignmentBlockReason,
  canAssignEmployeeToRoute,
  canAssignEmployeeToRouteWithPair,
  getRouteRestrictionTier,
  getRouteRestrictionTierWithPair,
  getEmployeeCapabilityTier,
  sortRoutesByAssignmentPriority,
  compareEmployeesForRoute,
};
