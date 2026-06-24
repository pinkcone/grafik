const { RouteDay } = require('../models');
const { normalizeOperatingDays } = require('./routeOperatingDays');

const syncRouteDays = async (routeId, operatingDays) => {
  await RouteDay.destroy({ where: { route_id: routeId } });
  const days = normalizeOperatingDays(operatingDays);
  await RouteDay.bulkCreate(
    days.map((day_of_week) => ({ route_id: routeId, day_of_week }))
  );
  return days;
};

const attachOperatingDays = async (routes) => {
  if (!routes.length) return [];

  const ids = routes.map((r) => r.id);
  const rows = await RouteDay.findAll({ where: { route_id: ids } });
  const byRoute = {};

  rows.forEach((row) => {
    if (!byRoute[row.route_id]) byRoute[row.route_id] = [];
    byRoute[row.route_id].push(row.day_of_week);
  });

  return routes.map((route) => {
    const plain = route.toJSON ? route.toJSON() : { ...route };
    const stored = byRoute[route.id];
    plain.operating_days = stored?.length
      ? [...stored].sort((a, b) => a - b)
      : normalizeOperatingDays(null);
    return plain;
  });
};

const enrichRouteWithOperatingDays = async (route) => {
  if (!route) return null;
  const [enriched] = await attachOperatingDays([route]);
  return enriched;
};

module.exports = {
  syncRouteDays,
  attachOperatingDays,
  enrichRouteWithOperatingDays,
};
