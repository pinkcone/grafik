const { hasEmployeeLabelOnDay } = require('./scheduleLabels');

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

/**
 * Czy można dodać trasę. Domyślnie: zero tras w dniu i brak etykiety.
 * allowPairLeg=true tylko przy dopinaniu drugiej nogi pary w tej samej operacji.
 */
const canEmployeeHaveAnotherRouteOnDay = (
  employeeId,
  routeId,
  date,
  schedules,
  routes,
  { allowPairLeg = false } = {}
) => {
  if (hasEmployeeLabelOnDay(employeeId, date, schedules)) return false;

  const slotCount = getEmployeeRouteSlotCountOnDay(employeeId, date, schedules, routes);
  if (slotCount === 0) return true;
  if (!allowPairLeg) return false;

  const pairIds = new Set(getPairRouteIdsIncludingSelf(routeId, routes).map(String));
  const employeeRouteIds = getEmployeeRouteIdsOnDay(employeeId, date, schedules);
  return (
    employeeRouteIds.length === 1 &&
    pairIds.has(employeeRouteIds[0]) &&
    pairIds.size > 1
  );
};

module.exports = {
  getPairRouteIdsIncludingSelf,
  getEmployeeRouteSlotCountOnDay,
  hasEmployeeRouteOnDay,
  canEmployeeHaveAnotherRouteOnDay,
};
