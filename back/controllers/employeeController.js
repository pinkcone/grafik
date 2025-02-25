const { Employee } = require('../models');

exports.createEmployee = async (req, res) => {
  try {
    const { first_name, last_name, part_time, city_id } = req.body;
    const user_id = req.user.id;
    const employee = await Employee.create({ first_name, last_name, part_time, city_id, user_id });
    res.status(201).json({ message: 'Pracownik utworzony', employee });
  } catch (error) {
    res.status(500).json({ error: 'Błąd przy tworzeniu pracownika', details: error.message });
  }
};

exports.getEmployeesByCity = async (req, res) => {
  try {
    const { cityId } = req.params;
    const user_id = req.user.id;
    const employees = await Employee.findAll({ where: { city_id: cityId, user_id } });
    res.json(employees);
  } catch (error) {
    res.status(500).json({ error: 'Błąd przy pobieraniu pracowników', details: error.message });
  }
};

exports.updateEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const { first_name, last_name, part_time, city_id } = req.body;
    const user_id = req.user.id;
    const employee = await Employee.findOne({ where: { id, user_id } });
    if (!employee) return res.status(404).json({ error: 'Pracownik nie znaleziony' });
    await employee.update({ first_name, last_name, part_time, city_id });
    res.json({ message: 'Pracownik zaktualizowany', employee });
  } catch (error) {
    res.status(500).json({ error: 'Błąd przy aktualizacji pracownika', details: error.message });
  }
};

exports.deleteEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.user.id;
    const employee = await Employee.findOne({ where: { id, user_id } });
    if (!employee) return res.status(404).json({ error: 'Pracownik nie znaleziony' });
    await employee.destroy();
    res.json({ message: 'Pracownik usunięty' });
  } catch (error) {
    res.status(500).json({ error: 'Błąd przy usuwaniu pracownika', details: error.message });
  }
};
