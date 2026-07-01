const { hasEmployeeLabelOnDay } = require('./scheduleLabels');
const { routesTimeOverlap } = require('./scheduleHours');

/** Maks. liczba niezależnych tras (para = 1 slot) u kierowcy B w dniu. */
const MAX_EMPLOYEE_ROUTE_SLOTS_PER_DAY = 2;

const getMaxRouteSlotsPerDay = (licenseCategory) =>
  licenseCategory === 'C' ? 1 : MAX_EMPLOYEE_ROUTE_SLOTS_PER_DAY;

const getPairRouteIdsIncludingSelf = (routeId, routes) => {
  const idStr = routeId.toString();
  const rt = routes.find((r) => r.id.toString() === idStr);
  if (!rt) return [idStr];

  const pair = new Set([idStr]);
  if (rt.linked_route_id != null) {
    pair.add(rt.linked_route_id.toString());
  }
  routes.forEach((r) => {
    if (r.linked_route_id != null && r.linked_route_id.toString() === idStr) {
      pair.add(r.id.toString());
    }
  });
  return Array.from(pair);
};

const getEmployeeRouteIdsOnDay = (employeeId, date, schedules) =>
  schedules
    .filter(
      (s) =>
        s.date === date &&
        s.employee_id?.toString() === employeeId.toString() &&
        s.route_id
    )
    .map((s) => s.route_id.toString());

/** Liczba tras (para = 1) przypisanych pracownikowi w danym dniu */
const getEmployeeRouteSlotCountOnDay = (employeeId, date, schedules, routes) => {
  const routeIds = getEmployeeRouteIdsOnDay(employeeId, date, schedules);
  const seenPairs = new Set();
  let count = 0;
  for (const rid of routeIds) {
    const pairKey = getPairRouteIdsIncludingSelf(rid, routes).sort().join('-');
    if (!seenPairs.has(pairKey)) {
      seenPairs.add(pairKey);
      count += 1;
    }
  }
  return count;
};

const hasEmployeeRouteOnDay = (employeeId, date, schedules) =>
  getEmployeeRouteIdsOnDay(employeeId, date, schedules).length > 0;

const getEmployeeRouteObjectsOnDay = (employeeId, date, schedules, routes) =>
  getEmployeeRouteIdsOnDay(employeeId, date, schedules)
    .map((rid) => routes.find((r) => r.id.toString() === rid.toString()))
    .filter(Boolean);

const getRouteObjectsToAdd = (routeId, routes) => {
  const route = routes.find((r) => r.id.toString() === routeId.toString());
  if (!route) return [];
  const pairIds = getPairRouteIdsIncludingSelf(routeId, routes);
  const objects = [route];
  for (const pid of pairIds) {
    if (pid === route.id.toString()) continue;
    const pairRoute = routes.find((r) => r.id.toString() === pid);
    if (pairRoute) objects.push(pairRoute);
  }
  return objects;
};

const wouldNewRouteOverlapEmployeeDay = (employeeId, routeId, date, schedules, routes) => {
  const existing = getEmployeeRouteObjectsOnDay(employeeId, date, schedules, routes);
  const toAdd = getRouteObjectsToAdd(routeId, routes);
  return toAdd.some((cand) => existing.some((ex) => routesTimeOverlap(cand, ex)));
};

/**
 * Czy można dodać trasę. Domyślnie: zero tras w dniu i brak etykiety.
 * allowPairLeg=true tylko przy dopinaniu drugiej nogi pary w tej samej operacji.
 * allowStackedRoute=true gdy godziny się nie nakładają (druga niezależna trasa tego dnia).
 */
const canEmployeeHaveAnotherRouteOnDay = (
  employeeId,
  routeId,
  date,
  schedules,
  routes,
  { allowPairLeg = false, allowStackedRoute = false, licenseCategory = null } = {}
) => {
  if (hasEmployeeLabelOnDay(employeeId, date, schedules)) return false;

  const slotCount = getEmployeeRouteSlotCountOnDay(employeeId, date, schedules, routes);
  const maxSlots = getMaxRouteSlotsPerDay(licenseCategory);

  if (slotCount === 0) return true;

  if (allowPairLeg) {
    const pairIds = new Set(getPairRouteIdsIncludingSelf(routeId, routes).map(String));
    const employeeRouteIds = getEmployeeRouteIdsOnDay(employeeId, date, schedules);
    if (
      employeeRouteIds.length === 1 &&
      pairIds.has(employeeRouteIds[0]) &&
      pairIds.size > 1
    ) {
      return true;
    }
  }

  if (slotCount >= maxSlots) return false;

  if (allowStackedRoute) {
    return !wouldNewRouteOverlapEmployeeDay(employeeId, routeId, date, schedules, routes);
  }

  return false;
};

/** Te same reguły co przy zapisie propozycji do bazy. */
const canPersistRouteAssignment = (
  employeeId,
  routeId,
  date,
  schedules,
  routes,
  { licenseCategory = null } = {}
) => {
  const base = { licenseCategory };
  return (
    canEmployeeHaveAnotherRouteOnDay(employeeId, routeId, date, schedules, routes, base) ||
    canEmployeeHaveAnotherRouteOnDay(employeeId, routeId, date, schedules, routes, {
      ...base,
      allowPairLeg: true,
    }) ||
    canEmployeeHaveAnotherRouteOnDay(employeeId, routeId, date, schedules, routes, {
      ...base,
      allowStackedRoute: true,
    })
  );
};

module.exports = {
  MAX_EMPLOYEE_ROUTE_SLOTS_PER_DAY,
  getMaxRouteSlotsPerDay,
  getPairRouteIdsIncludingSelf,
  getEmployeeRouteSlotCountOnDay,
  hasEmployeeRouteOnDay,
  getEmployeeRouteObjectsOnDay,
  canEmployeeHaveAnotherRouteOnDay,
  canPersistRouteAssignment,
};
