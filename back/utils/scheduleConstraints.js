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

/** Liczba tras (para = 1) przypisanych pracownikowi w danym dniu */
const getEmployeeRouteSlotCountOnDay = (employeeId, date, schedules, routes) => {
  const routeIds = schedules
    .filter(
      (s) =>
        s.date === date &&
        s.employee_id?.toString() === employeeId.toString() &&
        s.route_id
    )
    .map((s) => s.route_id.toString());

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
  schedules.some(
    (s) =>
      s.employee_id?.toString() === employeeId.toString() &&
      s.date === date &&
      s.route_id
  );

/** Czy pracownik może dostać tę trasę — max 1 trasa/dzień (para liczy się jako jedna) */
const canEmployeeHaveAnotherRouteOnDay = (employeeId, routeId, date, schedules, routes) => {
  if (hasEmployeeLabelOnDay(employeeId, date, schedules)) return false;

  const slotCount = getEmployeeRouteSlotCountOnDay(employeeId, date, schedules, routes);
  if (slotCount === 0) return true;

  const pairIds = new Set(getPairRouteIdsIncludingSelf(routeId, routes).map(String));
  const onlyPairRoutes = schedules
    .filter(
      (s) =>
        s.date === date &&
        s.employee_id?.toString() === employeeId.toString() &&
        s.route_id
    )
    .every((s) => pairIds.has(s.route_id.toString()));

  return slotCount === 1 && onlyPairRoutes;
};

module.exports = {
  getPairRouteIdsIncludingSelf,
  getEmployeeRouteSlotCountOnDay,
  hasEmployeeRouteOnDay,
  canEmployeeHaveAnotherRouteOnDay,
};
