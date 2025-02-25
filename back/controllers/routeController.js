const { Route } = require('../models');

exports.createRoute = async (req, res) => {
  try {
    const { name, main_city_id, additional_city_id, working_hours, linked_route_id } = req.body;
    const user_id = req.user.id;
    const route = await Route.create({ name, main_city_id, additional_city_id, working_hours, linked_route_id, user_id });
    res.status(201).json({ message: 'Trasa utworzona', route });
  } catch (error) {
    res.status(500).json({ error: 'Błąd przy tworzeniu trasy', details: error.message });
  }
};

exports.getRoutesByCity = async (req, res) => {
  try {
    const { cityId } = req.params;
    const user_id = req.user.id;
    // Filtrowanie tras po głównym mieście – możesz dostosować logikę jeśli potrzebujesz również dodatkowych miast
    const routes = await Route.findAll({ where: { main_city_id: cityId, user_id } });
    res.json(routes);
  } catch (error) {
    res.status(500).json({ error: 'Błąd przy pobieraniu tras', details: error.message });
  }
};

exports.updateRoute = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, main_city_id, additional_city_id, working_hours, linked_route_id } = req.body;
    const user_id = req.user.id;
    const route = await Route.findOne({ where: { id, user_id } });
    if (!route) return res.status(404).json({ error: 'Trasa nie znaleziona' });
    await route.update({ name, main_city_id, additional_city_id, working_hours, linked_route_id });
    res.json({ message: 'Trasa zaktualizowana', route });
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
    await route.destroy();
    res.json({ message: 'Trasa usunięta' });
  } catch (error) {
    res.status(500).json({ error: 'Błąd przy usuwaniu trasy', details: error.message });
  }
};
