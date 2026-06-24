const { DEFAULT_OPERATING_DAYS } = require('../utils/routeOperatingDays');

/**
 * Dla tras bez wpisów w route_days ustawia domyślnie pn–pt (1–5).
 * Bezpieczne do wielokrotnego uruchomienia — uzupełnia tylko brakujące trasy.
 */
async function ensureDefaultRouteDays(Route, RouteDay) {
  const routes = await Route.findAll({ attributes: ['id'] });
  if (!routes.length) return;

  const routeIds = routes.map((r) => r.id);
  const existingRows = await RouteDay.findAll({
    attributes: ['route_id'],
    where: { route_id: routeIds },
    raw: true,
  });
  const withDays = new Set(existingRows.map((row) => row.route_id));

  const missing = routes.filter((r) => !withDays.has(r.id));
  if (!missing.length) return;

  const rows = missing.flatMap((route) =>
    DEFAULT_OPERATING_DAYS.map((day_of_week) => ({
      route_id: route.id,
      day_of_week,
    }))
  );

  await RouteDay.bulkCreate(rows);
  console.log(`Ustawiono domyślne dni kursowania (pn–pt) dla ${missing.length} tras.`);
}

module.exports = { ensureDefaultRouteDays };
