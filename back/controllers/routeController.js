const { Route, RouteDay } = require('../models');
const { toBoolean } = require('../utils/routeAssignment');
const {
  syncRouteDays,
  attachOperatingDays,
} = require('../utils/routeDayHelpers');
const { normalizeOperatingDays } = require('../utils/routeOperatingDays');

const formatRouteResponse = async (route, operatingDays) => {
  const plain = route.toJSON ? route.toJSON() : { ...route };
  plain.operating_days = operatingDays ?? normalizeOperatingDays(null);
  return plain;
};

exports.createRoute = async (req, res) => {
  try {
    const {
      name,
      main_city_id,
      additional_city_id,
      working_hours,
      linked_route_id,
      required_license_category,
      requires_special_permissions,
      requires_staffing,
      operating_days,
    } = req.body;
    const user_id = req.user.id;
    const route = await Route.create({
      name,
      main_city_id,
      additional_city_id,
      working_hours,
      linked_route_id,
      required_license_category: required_license_category || 'B',
      requires_special_permissions: toBoolean(requires_special_permissions),
      requires_staffing: requires_staffing === undefined ? true : toBoolean(requires_staffing),
      user_id,
    });
    const days = await syncRouteDays(route.id, operating_days);
    res.status(201).json({
      message: 'Trasa utworzona',
      route: await formatRouteResponse(route, days),
    });
  } catch (error) {
    res.status(500).json({ error: 'Błąd przy tworzeniu trasy', details: error.message });
  }
};

exports.getRoutesByCity = async (req, res) => {
  try {
    const { cityId } = req.params;
    const user_id = req.user.id;
    const routes = await Route.findAll({ where: { main_city_id: cityId, user_id } });
    const withDays = await attachOperatingDays(routes);
    res.json(withDays);
  } catch (error) {
    res.status(500).json({ error: 'Błąd przy pobieraniu tras', details: error.message });
  }
};

exports.updateRoute = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      main_city_id,
      additional_city_id,
      working_hours,
      linked_route_id,
      required_license_category,
      requires_special_permissions,
      requires_staffing,
      operating_days,
    } = req.body;
    const user_id = req.user.id;
    const route = await Route.findOne({ where: { id, user_id } });
    if (!route) return res.status(404).json({ error: 'Trasa nie znaleziona' });
    await route.update({
      name,
      main_city_id,
      additional_city_id,
      working_hours,
      linked_route_id,
      required_license_category: required_license_category || 'B',
      requires_special_permissions: toBoolean(requires_special_permissions),
      requires_staffing: requires_staffing === undefined ? route.requires_staffing : toBoolean(requires_staffing),
    });
    let days;
    if (operating_days !== undefined) {
      days = await syncRouteDays(route.id, operating_days);
    } else {
      const [withDays] = await attachOperatingDays([route]);
      days = withDays.operating_days;
    }
    res.json({
      message: 'Trasa zaktualizowana',
      route: await formatRouteResponse(route, days),
    });
  } catch (error) {
    res.status(500).json({ error: 'Błąd przy aktualizacji trasy', details: error.message });
  }
};

exports.deleteRoute = async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.user.id;
    const route = await Route.findOne({ where: { id, user_id } });
    if (!route) return res.status(404).json({ error: 'Trasa nie znaleziona' });
    await RouteDay.destroy({ where: { route_id: id } });
    await route.destroy();
    res.json({ message: 'Trasa usunięta' });
  } catch (error) {
    res.status(500).json({ error: 'Błąd przy usuwaniu trasy', details: error.message });
  }
};
