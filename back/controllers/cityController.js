const { City } = require('../models');

exports.createCity = async (req, res) => {
  try {
    const { name } = req.body;
    const user_id = req.user.id;
    const city = await City.create({ name, user_id });
    res.status(201).json({ message: 'Miasto utworzone', city });
  } catch (error) {
    res.status(500).json({ error: 'Błąd przy tworzeniu miasta', details: error.message });
  }
};

exports.getCities = async (req, res) => {
  try {
    const user_id = req.user.id;
    const cities = await City.findAll({ where: { user_id } });
    res.json(cities);
  } catch (error) {
    res.status(500).json({ error: 'Błąd przy pobieraniu miast', details: error.message });
  }
};

exports.getCityById = async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.user.id;
    const city = await City.findOne({ where: { id, user_id } });
    if (!city) return res.status(404).json({ error: 'Miasto nie znalezione' });
    res.json(city);
  } catch (error) {
    res.status(500).json({ error: 'Błąd przy pobieraniu miasta', details: error.message });
  }
};

exports.updateCity = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const user_id = req.user.id;
    const city = await City.findOne({ where: { id, user_id } });
    if (!city) return res.status(404).json({ error: 'Miasto nie znalezione' });
    await city.update({ name });
    res.json({ message: 'Miasto zaktualizowane', city });
  } catch (error) {
    res.status(500).json({ error: 'Błąd przy aktualizacji miasta', details: error.message });
  }
};

exports.deleteCity = async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.user.id;
    const city = await City.findOne({ where: { id, user_id } });
    if (!city) return res.status(404).json({ error: 'Miasto nie znalezione' });
    await city.destroy();
    res.json({ message: 'Miasto usunięte' });
  } catch (error) {
    res.status(500).json({ error: 'Błąd przy usuwaniu miasta', details: error.message });
  }
};
