// controllers/scheduleController.js
const { Schedule, Employee, Route } = require('../models');
const { Op } = require('sequelize');
const { canAssignEmployeeToRoute, getAssignmentBlockReason, findPairRoute } = require('../utils/routeAssignment');
const { enrichRouteWithOperatingDays, attachOperatingDays } = require('../utils/routeDayHelpers');
const { generateAutoFillAssignments } = require('../utils/scheduleAutoFill');
const { generateMonthRouteAssignments } = require('../utils/assignMonth');
const { generateDw5Proposals } = require('../utils/scheduleRules');
const { getIsoWeekday } = require('../utils/routeOperatingDays');

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

const addDaysToDate = (dateStr, days) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

const persistRouteProposals = async (proposals, user_id) => {
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
      user_id: item.user_id || user_id,
    });
    created.push(row);
  }
  return created;
};

const persistLabelProposals = async (proposals, user_id) => {
  const created = [];
  for (const item of proposals) {
    const existing = await Schedule.findOne({
      where: { date: item.date, employee_id: item.employee_id },
    });
    if (existing?.label === item.label) continue;
    if (existing?.label) continue;

    if (existing) {
      await existing.update({
        label: item.label,
        route_id: null,
        assignment_type: 'label',
        user_id: item.user_id || user_id,
      });
      created.push(existing);
    } else {
      const row = await Schedule.create({
        date: item.date,
        employee_id: item.employee_id,
        route_id: null,
        label: item.label,
        assignment_type: 'label',
        user_id: item.user_id || user_id,
      });
      created.push(row);
    }
  }
  return created;
};

const applyDw5AfterSaturdayRoute = async (employee_id, saturdayDate, user_id) => {
  const employee = await Employee.findOne({ where: { id: employee_id, user_id } });
  if (!employee) return [];

  const endDate = addDaysToDate(saturdayDate, 14);
  const cityEmployees = await Employee.findAll({
    where: { city_id: employee.city_id, user_id },
  });
  const employeeIds = cityEmployees.map((e) => e.id);

  const [citySchedulesRaw, routesRaw] = await Promise.all([
    Schedule.findAll({
      where: {
        employee_id: { [Op.in]: employeeIds },
        date: { [Op.between]: [saturdayDate, endDate] },
      },
    }),
    Route.findAll({ where: { main_city_id: employee.city_id, user_id } }),
  ]);

  const routes = await attachOperatingDays(routesRaw);
  const proposals = generateDw5Proposals(
    citySchedulesRaw.map((s) => (s.toJSON ? s.toJSON() : s)),
    user_id,
    routes
  );
  return persistLabelProposals(proposals, user_id);
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
      const routeWithDays = await enrichRouteWithOperatingDays(route);
      const userRoutes = await attachOperatingDays(await Route.findAll({ where: { user_id } }));
      const pairedRoute = findPairRoute(routeWithDays, userRoutes);
      if (!canAssignEmployeeToRoute(employee, routeWithDays, { pairedRoute, date })) {
        const reason = getAssignmentBlockReason(employee, routeWithDays, { pairedRoute, date });
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

    if (route_id && getIsoWeekday(date) === 6) {
      await applyDw5AfterSaturdayRoute(employee_id, date, user_id);
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

    const [employees, routesRaw, schedules] = await Promise.all([
      Employee.findAll({ where: { city_id: cityId, user_id } }),
      Route.findAll({ where: { main_city_id: cityId, user_id } }),
      Schedule.findAll({
        where: { date: { [Op.between]: [startDate, endDate] } },
      }),
    ]);

    const routes = await attachOperatingDays(routesRaw);
    const activeRoutes = routes.filter(routeHasSegments);
    const cityEmployeeIds = new Set(employees.map((e) => e.id.toString()));
    const citySchedules = schedules.filter((s) =>
      cityEmployeeIds.has(s.employee_id?.toString())
    );

    const { routeAssignments, labelAssignments } = generateAutoFillAssignments({
      employees,
      routes: activeRoutes,
      schedules: citySchedules,
      month: monthNum,
      year: yearNum,
      user_id,
    });

    if (routeAssignments.length === 0 && labelAssignments.length === 0) {
      return res.json({
        message: 'Brak pustych slotów tras do uzupełnienia.',
        created: 0,
        labelsCreated: 0,
        assignments: [],
      });
    }

    const created = await persistRouteProposals(routeAssignments, user_id);
    const labelsCreated = await persistLabelProposals(labelAssignments, user_id);

    return res.json({
      message: `Uzupełniono ${created.length} przypisań tras` +
        (labelsCreated.length > 0 ? ` i ${labelsCreated.length} etykiet DW5.` : '.'),
      created: created.length,
      labelsCreated: labelsCreated.length,
      assignments: created,
      labels: labelsCreated,
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
 * Usuwa przypisania tras (nie etykiety) pracowników danego miasta w wybranym miesiącu.
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
        route_id: { [Op.ne]: null },
      },
    });

    return res.json({
      message: deleted > 0
        ? `Usunięto ${deleted} przypisań tras za ${monthNum}.${yearNum}. Etykiety pozostały bez zmian.`
        : `Brak tras do usunięcia za ${monthNum}.${yearNum}.`,
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

/**
 * POST /api/schedule/city/:cityId/assign-month?month=MM&year=YYYY
 * Body: { employee_id, route_id }
 * Przypisuje pracownika do trasy na każdy dzień kursowania w miesiącu (pomija zajęte sloty).
 */
exports.assignMonth = async (req, res) => {
  const { cityId } = req.params;
  const { month, year } = req.query;
  const { employee_id, route_id } = req.body;
  const user_id = req.user.id;

  try {
    const monthNum = parseInt(month, 10);
    const yearNum = parseInt(year, 10);
    const employeeId = parseInt(employee_id, 10);
    const routeId = parseInt(route_id, 10);

    if (!monthNum || !yearNum || !employeeId || !routeId) {
      return res.status(400).json({ message: 'Podaj month, year, employee_id i route_id.' });
    }

    const lastDay = new Date(yearNum, monthNum, 0).getDate();
    const startDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-01`;
    const endDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const [employee, routeRaw, routesRaw, schedules] = await Promise.all([
      Employee.findOne({ where: { id: employeeId, city_id: cityId, user_id } }),
      Route.findOne({ where: { id: routeId, main_city_id: cityId, user_id } }),
      Route.findAll({ where: { main_city_id: cityId, user_id } }),
      Schedule.findAll({
        where: { date: { [Op.between]: [startDate, endDate] } },
      }),
    ]);

    if (!employee) {
      return res.status(404).json({ message: 'Pracownik nie znaleziony w tym mieście.' });
    }
    if (!routeRaw) {
      return res.status(404).json({ message: 'Trasa nie znaleziona w tym mieście.' });
    }

    const routes = await attachOperatingDays(routesRaw);
    const route = routes.find((r) => r.id.toString() === routeId.toString()) || routeRaw;
    const cityEmployeeIds = new Set(
      (await Employee.findAll({ where: { city_id: cityId, user_id } })).map((e) => e.id.toString())
    );
    const citySchedules = schedules.filter((s) =>
      cityEmployeeIds.has(s.employee_id?.toString())
    ).map((s) => (s.toJSON ? s.toJSON() : s));

    const { routeAssignments, labelAssignments } = generateMonthRouteAssignments({
      employee: employee.toJSON ? employee.toJSON() : employee,
      route,
      routes,
      schedules: citySchedules,
      month: monthNum,
      year: yearNum,
      user_id,
    });

    if (routeAssignments.length === 0 && labelAssignments.length === 0) {
      return res.json({
        message: 'Brak dni do przypisania (wszystkie sloty zajęte lub pracownik niedostępny).',
        created: 0,
        labelsCreated: 0,
      });
    }

    const created = await persistRouteProposals(routeAssignments, user_id);
    const labelsCreated = await persistLabelProposals(labelAssignments, user_id);

    return res.json({
      message: `Przypisano trasę na ${created.length} dni` +
        (labelsCreated.length > 0 ? ` i dodano ${labelsCreated.length} etykiet DW5.` : '.'),
      created: created.length,
      labelsCreated: labelsCreated.length,
      assignments: created,
      labels: labelsCreated,
    });
  } catch (error) {
    console.error('Błąd w assignMonth:', error);
    return res.status(500).json({
      message: 'Błąd przypisywania trasy na miesiąc',
      error: error.message,
    });
  }
};