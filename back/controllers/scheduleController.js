// controllers/scheduleController.js
const { Schedule, Employee, Route, City } = require('../models');
const { runAutoFill } = require('../services/autoFillService');
const { createJob, completeJob, failJob } = require('../utils/autoFillJobStore');
const { persistRouteProposals, persistLabelProposals } = require('../utils/schedulePersist');
const { Op } = require('sequelize');
const { canAssignEmployeeToRoute, getAssignmentBlockReason, findPairRoute } = require('../utils/routeAssignment');
const { enrichRouteWithOperatingDays, attachOperatingDays } = require('../utils/routeDayHelpers');
const { generateMonthRouteAssignments } = require('../utils/assignMonth');
const { hasEmployeeLabelOnDay } = require('../utils/scheduleLabels');
const { canEmployeeHaveAnotherRouteOnDay } = require('../utils/scheduleConstraints');

const addDaysToDate = (dateStr, days) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
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

    if (label && employee_id) {
      const dayEntries = await Schedule.findAll({ where: { date, employee_id } });
      if (dayEntries.some((s) => s.route_id)) {
        return res.status(400).json({
          message: 'Pracownik ma trasę tego dnia — usuń trasę przed dodaniem etykiety.',
        });
      }
    }

    if (route_id && employee_id) {
      const dayEntries = await Schedule.findAll({ where: { date, employee_id } });
      const daySchedules = dayEntries.map((s) => (s.toJSON ? s.toJSON() : s));

      if (hasEmployeeLabelOnDay(employee_id, date, daySchedules)) {
        return res.status(400).json({
          message: 'Pracownik ma wpisaną etykietę tego dnia — nie można przypisać trasy.',
        });
      }

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
      const cityEmployees = await Employee.findAll({
        where: { city_id: employee.city_id, user_id },
      });

      const manualRouteOptions = {
        pairedRoute: findPairRoute(routeWithDays, userRoutes),
        date,
        schedules: daySchedules,
        allRoutes: userRoutes,
        employeeCount: cityEmployees.length,
        skipDw5Check: true,
      };

      const slotOpts = { licenseCategory: employee.license_category ?? null };
      const canTakeRoute =
        canEmployeeHaveAnotherRouteOnDay(employee_id, route_id, date, daySchedules, userRoutes, slotOpts) ||
        canEmployeeHaveAnotherRouteOnDay(employee_id, route_id, date, daySchedules, userRoutes, {
          ...slotOpts,
          allowPairLeg: true,
        });
      if (!canTakeRoute) {
        return res.status(400).json({
          message: 'Pracownik ma już inną trasę tego dnia — nie można przypisać drugiej.',
        });
      }

      const pairedRoute = findPairRoute(routeWithDays, userRoutes);
      if (!canAssignEmployeeToRoute(employee, routeWithDays, manualRouteOptions)) {
        const reason = getAssignmentBlockReason(employee, routeWithDays, manualRouteOptions);
        return res.status(400).json({
          message: reason || 'Pracownik nie spełnia wymagań trasy.',
        });
      }
    }

    if (!route_id && !label && employee_id) {
      await Schedule.destroy({
        where: {
          date,
          employee_id,
          route_id: { [Op.is]: null },
          [Op.or]: [{ label: null }, { label: '' }],
        },
      });
      return res.json({ message: 'Grafik zaktualizowany', schedule: null });
    }

    // WYBÓR KLUCZA WYSZUKIWANIA
    const where = route_id
      ? { date, route_id }            // dla tras: klucz to data+trasa
      : { date, employee_id };        // dla etykiet: klucz to data+pracownik

    let schedule = await Schedule.findOne({ where });

    if (schedule) {
      await schedule.update({
        route_id: route_id ?? null,
        label: label ?? null,
        assignment_type,
        employee_id,
        user_id,
        auto_filled: false,
      });
    } else {
      schedule = await Schedule.create({
        date,
        employee_id,
        route_id: route_id ?? null,
        label: label ?? null,
        assignment_type,
        user_id,
        auto_filled: false,
      });
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
 * Uruchamia uzupełnianie tras w tle (202 + jobId). Wynik w powiadomieniach.
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

    const city = await City.findOne({ where: { id: cityId, user_id } });
    if (!city) {
      return res.status(404).json({ message: 'Miasto nie znalezione.' });
    }

    const job = createJob(user_id, {
      type: 'auto_fill',
      cityId: parseInt(cityId, 10),
      cityName: city.name,
      month: monthNum,
      year: yearNum,
      title: `Auto-uzupełnianie: ${city.name} (${monthNum}/${yearNum})`,
    });

    setImmediate(() => {
      runAutoFill({ cityId: parseInt(cityId, 10), monthNum, yearNum, user_id })
        .then((result) => {
          completeJob(user_id, job.id, { message: result.message, result });
        })
        .catch((err) => {
          console.error('Błąd zadania auto-fill:', err);
          failJob(user_id, job.id, err.message || 'Błąd auto-uzupełniania grafiku');
        });
    });

    return res.status(202).json({
      jobId: job.id,
      message:
        'Uzupełnianie tras działa na serwerze w tle. Możesz zamknąć przeglądarkę — wynik pojawi się w powiadomieniach (dzwonek w nagłówku).',
    });
  } catch (error) {
    console.error('Błąd w autoFillRoutes:', error);
    return res.status(500).json({
      message: 'Nie udało się uruchomić auto-uzupełniania',
      error: error.message,
    });
  }
};

/**
 * DELETE /api/schedule/city/:cityId/month?month=MM&year=YYYY
 * Usuwa trasy dodane przez „Uzupełnij trasy” (auto_filled). Ręczne wpisy zostają.
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
        auto_filled: true,
      },
    });

    return res.json({
      message: deleted > 0
        ? `Usunięto ${deleted} tras z auto-uzupełniania za ${monthNum}.${yearNum}. Ręczne wpisy i etykiety pozostały.`
        : `Brak tras z auto-uzupełniania do usunięcia za ${monthNum}.${yearNum}.`,
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
    const cityEmployees = await Employee.findAll({ where: { city_id: cityId, user_id } });
    const cityEmployeeIds = new Set(cityEmployees.map((e) => e.id.toString()));
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
      employees: cityEmployees.map((e) => (e.toJSON ? e.toJSON() : e)),
    });

    if (routeAssignments.length === 0 && labelAssignments.length === 0) {
      return res.json({
        message: 'Brak dni do przypisania (wszystkie sloty zajęte lub pracownik niedostępny).',
        created: 0,
        labelsCreated: 0,
      });
    }

    const { created } = await persistRouteProposals(routeAssignments, user_id);
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