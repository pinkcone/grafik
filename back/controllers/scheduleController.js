// controllers/scheduleController.js
const { Schedule, Employee, Route } = require('../models');
const { Op } = require('sequelize');
const { canAssignEmployeeToRoute, getAssignmentBlockReason, findPairRoute } = require('../utils/routeAssignment');
const { generateAutoFillAssignments } = require('../utils/scheduleAutoFill');

const parseWorkingHours = (wh) => {
  if (!wh) return null;
  if (typeof wh === 'object') return wh;
  try {
    return JSON.parse(wh);
  } catch {
    return null;
  }
};

const routeHasSegments = (route) => {
  const wh = parseWorkingHours(route.working_hours);
  return !!(wh && Array.isArray(wh.segments) && wh.segments.length > 0);
};

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
      const userRoutes = await Route.findAll({ where: { user_id } });
      const pairedRoute = findPairRoute(route, userRoutes);
      if (!canAssignEmployeeToRoute(employee, route, { pairedRoute })) {
        const reason = getAssignmentBlockReason(employee, route, { pairedRoute });
        return res.status(400).json({
          message: reason || 'Pracownik nie spełnia wymagań trasy.',
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

/**
 * POST /api/schedule/city/:cityId/auto-fill?month=MM&year=YYYY
 * Uzupełnia puste sloty tras (nie nadpisuje etykiet ani istniejących tras).
 */
exports.autoFillRoutes = async (req, res) => {
  const { cityId } = req.params;
  const { month, year } = req.query;
  const user_id = req.user.id;

  try {
    const monthNum = parseInt(month, 10);
    const yearNum = parseInt(year, 10);
    if (!monthNum || !yearNum) {
      return res.status(400).json({ message: 'Podaj month i year w query.' });
    }

    const lastDay = new Date(yearNum, monthNum, 0).getDate();
    const startDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-01`;
    const endDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const [employees, routes, schedules] = await Promise.all([
      Employee.findAll({ where: { city_id: cityId, user_id } }),
      Route.findAll({ where: { main_city_id: cityId, user_id } }),
      Schedule.findAll({
        where: { date: { [Op.between]: [startDate, endDate] } },
      }),
    ]);

    const activeRoutes = routes.filter(routeHasSegments);
    const cityEmployeeIds = new Set(employees.map((e) => e.id.toString()));
    const citySchedules = schedules.filter((s) =>
      cityEmployeeIds.has(s.employee_id?.toString())
    );

    const proposals = generateAutoFillAssignments({
      employees,
      routes: activeRoutes,
      schedules: citySchedules,
      month: monthNum,
      year: yearNum,
      user_id,
    });

    if (proposals.length === 0) {
      return res.json({
        message: 'Brak pustych slotów tras do uzupełnienia.',
        created: 0,
        assignments: [],
      });
    }

    const created = [];
    for (const item of proposals) {
      const existing = await Schedule.findOne({
        where: { date: item.date, route_id: item.route_id },
      });
      if (existing) continue;

      const row = await Schedule.create({
        date: item.date,
        employee_id: item.employee_id,
        route_id: item.route_id,
        label: null,
        assignment_type: 'route',
        user_id,
      });
      created.push(row);
    }

    return res.json({
      message: `Uzupełniono ${created.length} przypisań tras.`,
      created: created.length,
      assignments: created,
    });
  } catch (error) {
    console.error('Błąd w autoFillRoutes:', error);
    return res.status(500).json({
      message: 'Błąd auto-uzupełniania grafiku',
      error: error.message,
    });
  }
};

/**
 * DELETE /api/schedule/city/:cityId/month?month=MM&year=YYYY
 * Usuwa wszystkie wpisy grafiku pracowników danego miasta w wybranym miesiącu.
 */
exports.clearMonth = async (req, res) => {
  const { cityId } = req.params;
  const { month, year } = req.query;
  const user_id = req.user.id;

  try {
    const monthNum = parseInt(month, 10);
    const yearNum = parseInt(year, 10);
    if (!monthNum || !yearNum) {
      return res.status(400).json({ message: 'Podaj month i year w query.' });
    }

    const lastDay = new Date(yearNum, monthNum, 0).getDate();
    const startDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-01`;
    const endDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const employees = await Employee.findAll({ where: { city_id: cityId, user_id } });
    const employeeIds = employees.map((e) => e.id);

    if (employeeIds.length === 0) {
      return res.json({ message: 'Brak pracowników w tym mieście.', deleted: 0 });
    }

    const deleted = await Schedule.destroy({
      where: {
        user_id,
        employee_id: { [Op.in]: employeeIds },
        date: { [Op.between]: [startDate, endDate] },
      },
    });

    return res.json({
      message: deleted > 0
        ? `Usunięto ${deleted} wpis(ów) z grafiku za ${monthNum}.${yearNum}.`
        : `Brak wpisów do usunięcia za ${monthNum}.${yearNum}.`,
      deleted,
    });
  } catch (error) {
    console.error('Błąd w clearMonth:', error);
    return res.status(500).json({
      message: 'Błąd czyszczenia grafiku miesiąca',
      error: error.message,
    });
  }
};