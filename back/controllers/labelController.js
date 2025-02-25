const { Label } = require('../models');

exports.createLabel = async (req, res) => {
  try {
    const { code, default_hours, description } = req.body;
    const user_id = req.user.id;
    const label = await Label.create({ code, default_hours, description, user_id });
    res.status(201).json({ message: 'Etykieta utworzona', label });
  } catch (error) {
    res.status(500).json({ error: 'Błąd przy tworzeniu etykiety', details: error.message });
  }
};

exports.getLabels = async (req, res) => {
  try {
    const user_id = req.user.id;
    const labels = await Label.findAll({ where: { user_id } });
    res.json(labels);
  } catch (error) {
    res.status(500).json({ error: 'Błąd przy pobieraniu etykiet', details: error.message });
  }
};

exports.updateLabel = async (req, res) => {
  try {
    const { code } = req.params; // przyjmujemy, że etykieta jest identyfikowana przez swój unikalny kod
    const { default_hours, description } = req.body;
    const user_id = req.user.id;
    const label = await Label.findOne({ where: { code, user_id } });
    if (!label) return res.status(404).json({ error: 'Etykieta nie znaleziona' });
    await label.update({ default_hours, description });
    res.json({ message: 'Etykieta zaktualizowana', label });
  } catch (error) {
    res.status(500).json({ error: 'Błąd przy aktualizacji etykiety', details: error.message });
  }
};

exports.deleteLabel = async (req, res) => {
  try {
    const { code } = req.params;
    const user_id = req.user.id;
    const label = await Label.findOne({ where: { code, user_id } });
    if (!label) return res.status(404).json({ error: 'Etykieta nie znaleziona' });
    await label.destroy();
    res.json({ message: 'Etykieta usunięta' });
  } catch (error) {
    res.status(500).json({ error: 'Błąd przy usuwaniu etykiety', details: error.message });
  }
};
