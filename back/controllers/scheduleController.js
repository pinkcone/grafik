// controllers/scheduleController.js
const { Schedule, Employee, Route } = require('../models');
const { Op } = require('sequelize');
const { canDriveWithCategory } = require('../utils/licenseCategories');
const { canAssignEmployeeToRoute } = require('../utils/routeAssignment');

/**
 * PUT /api/schedule/update-cell
 * Aktualizacja pojedynczej komórki grafiku.
 * Oczekiwane body: { date, employee_id, route_id, label }
 */
// controllers/scheduleController.js
exports.updateScheduleCell = async (req, res) => {
  const { date, employee_id, route_id, label } = req.body;

  try {
    let assignment_type = null;
    if (route_id) assignment_type = 'route';
    else if (label) assignment_type = 'label';
    else assignment_type = 'none'; // patrz pkt 2 niżej (ENUM)

    const user_id = req.user.id;

    if (route_id && employee_id) {
      const [employee, route] = await Promise.all([
        Employee.findOne({ where: { id: employee_id, user_id } }),
        Route.findOne({ where: { id: route_id, user_id } }),
      ]);
      if (!employee) {
        return res.status(400).json({ message: 'Pracownik nie znaleziony.' });
      }
      if (!route) {
        return res.status(400).json({ message: 'Trasa nie znaleziona.' });
      }
      if (!canAssignEmployeeToRoute(employee, route)) {
        const reqCat = route.required_license_category || 'B';
        const empCat = employee.license_category || 'brak';
        if (!canDriveWithCategory(employee.license_category, route.required_license_category)) {
          return res.status(400).json({
            message: `Kategoria prawa jazdy nie pasuje: trasa wymaga ${reqCat}, pracownik ma ${empCat}.`,
          });
        }
        return res.status(400).json({
          message: 'Trasa wymaga specjalnych uprawnień, których ten pracownik nie posiada.',
        });
      }
    }

    // WYBÓR KLUCZA WYSZUKIWANIA
    const where = route_id
      ? { date, route_id }            // dla tras: klucz to data+trasa
      : { date, employee_id };        // dla etykiet: klucz to data+pracownik

    let schedule = await Schedule.findOne({ where });

    if (schedule) {
      await schedule.update({ route_id: route_id ?? null, label: label ?? null, assignment_type, employee_id, user_id });
    } else {
      schedule = await Schedule.create({ date, employee_id, route_id: route_id ?? null, label: label ?? null, assignment_type, user_id });
    }

    return res.json({ message: 'Grafik zaktualizowany', schedule });
  } catch (error) {
    console.error("Błąd w updateScheduleCell:", error);
    return res.status(500).json({ message: 'Błąd aktualizacji grafiku', error: error.message });
  }
};

exports.deleteScheduleById = async (req, res) => {
  try {
    const { id } = req.params;
    // Prosta walidacja id
    if (!/^\d+$/.test(id)) {
      return res.status(400).json({ error: 'Nieprawidłowe id.' });
    }

    // Jeśli chcesz ograniczyć usuwanie do autora wpisu, użyj wariantu poniżej:
    // const userId = req.user?.id; // np. z middleware autoryzacji
    // const deleted = await Schedule.destroy({ where: { id: Number(id), user_id: userId } });

    const deleted = await Schedule.destroy({
      where: { id: Number(id) },
    });

    if (deleted === 0) {
      return res.status(404).json({ error: 'Harmonogram o podanym id nie istnieje.' });
    }

    // Brak treści w odpowiedzi przy udanym usunięciu
    return res.status(204).send();
  } catch (err) {
    console.error('Błąd przy usuwaniu harmonogramu:', err);
    return res.status(500).json({ error: 'Wystąpił błąd serwera.' });
  }
};
/**
 * GET /api/schedule/city/:cityId?month=MM&year=YYYY
 * Pobranie harmonogramu (Schedule) dla danego miasta i wybranego miesiąca/roku.
 * Zwraca tablicę rekordów z tabeli Schedule (date, employee_id, route_id, label, worked_hours, itp.)
 */
exports.getCitySchedule = async (req, res) => {
  const { cityId } = req.params;
  const { month, year } = req.query;

  try {
    // Ustalanie ostatniego dnia miesiąca dynamicznie
    const lastDay = new Date(year, month, 0).getDate();
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const schedules = await Schedule.findAll({
      where: {
        date: { [Op.between]: [startDate, endDate] }
      }
    });

    return res.json(schedules);
  } catch (error) {
    console.error("Błąd w getCitySchedule:", error);
    return res.status(500).json({
      message: 'Błąd pobierania grafiku',
      error: error.message
    });
  }
};