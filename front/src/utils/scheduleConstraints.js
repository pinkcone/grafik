import { hasEmployeeLabelOnDay } from './scheduleLabels';

export const getPairRouteIdsIncludingSelf = (routeId, routes) => {
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

export const getEmployeeRouteSlotCountOnDay = (employeeId, date, schedules, routes) => {
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

export const canEmployeeHaveAnotherRouteOnDay = (
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
  const employeeRouteIds = schedules
    .filter(
      (s) =>
        s.date === date &&
        s.employee_id?.toString() === employeeId.toString() &&
        s.route_id
    )
    .map((s) => s.route_id.toString());

  return (
    employeeRouteIds.length === 1 &&
    pairIds.has(employeeRouteIds[0]) &&
    pairIds.size > 1
  );
};
