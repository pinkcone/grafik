const { Schedule, Employee, Route } = require('../models');
const { Op } = require('sequelize');
const { attachOperatingDays } = require('../utils/routeDayHelpers');
const {
  generateAutoFillAssignments,
  generateGapFillOnly,
  filterPersistableAssignments,
  hasMeaningfulAssignment,
} = require('../utils/scheduleAutoFill');
const { buildScheduleGapReport } = require('../utils/scheduleAutoFillDebug');
const { getQuarterMonths } = require('../utils/scheduleHours');
const { persistRouteProposals, persistLabelProposals } = require('../utils/schedulePersist');
const { isSaturday } = require('../utils/scheduleRules');

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

const toSchedulePlain = (s) => (s.toJSON ? s.toJSON() : { ...s });

const pushFilterRejections = (rejected, target) => {
  for (const r of rejected) {
    target.push({
      date: r.item.date,
      route_id: r.item.route_id,
      employee_id: r.item.employee_id,
      reason: `Odfiltrowano przed zapisem: ${r.reason}`,
    });
  }
};

const pushCreatedToLiveSchedules = (rows, liveSchedules) => {
  const seen = new Set(
    liveSchedules.map(
      (s) => `${s.date}|${s.route_id?.toString()}|${s.employee_id?.toString()}`
    )
  );
  for (const row of rows) {
    const plain = toSchedulePlain(row);
    const key = `${plain.date}|${plain.route_id?.toString()}|${plain.employee_id?.toString()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    liveSchedules.push(plain);
  }
};

async function runAutoFill({ cityId, monthNum, yearNum, user_id }) {
  const lastDay = new Date(yearNum, monthNum, 0).getDate();
  const startDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-01`;
  const endDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const qMonths = getQuarterMonths(monthNum);
  const startQuarter = `${yearNum}-${String(qMonths[0]).padStart(2, '0')}-01`;

  const employees = await Employee.findAll({ where: { city_id: cityId, user_id } });
  const employeeIds = employees.map((e) => e.id);
  if (employeeIds.length > 0) {
    await Schedule.destroy({
      where: {
        date: { [Op.between]: [startDate, endDate] },
        employee_id: { [Op.in]: employeeIds },
        route_id: { [Op.is]: null },
        [Op.or]: [{ label: null }, { label: '' }],
      },
    });
    await Schedule.destroy({
      where: {
        date: { [Op.between]: [startDate, endDate] },
        employee_id: { [Op.in]: employeeIds },
        auto_filled: true,
      },
    });
  }

  const [routesRaw, schedules, quarterSchedulesRaw] = await Promise.all([
    Route.findAll({ where: { main_city_id: cityId, user_id } }),
    Schedule.findAll({
      where: { date: { [Op.between]: [startDate, endDate] } },
    }),
    Schedule.findAll({
      where: { date: { [Op.between]: [startQuarter, endDate] } },
    }),
  ]);

  const routes = await attachOperatingDays(routesRaw);
  const activeRoutes = routes.filter(routeHasSegments);
  const cityEmployeeIds = new Set(employees.map((e) => e.id.toString()));
  const citySchedules = schedules
    .filter((s) => cityEmployeeIds.has(s.employee_id?.toString()))
    .filter(hasMeaningfulAssignment);
  const quarterSchedules = quarterSchedulesRaw
    .filter((s) => cityEmployeeIds.has(s.employee_id?.toString()))
    .filter((s) => parseInt(s.date.split('-')[1], 10) !== monthNum)
    .filter(hasMeaningfulAssignment);

  const { routeAssignments, labelAssignments, debug: algorithmDebug } =
    generateAutoFillAssignments({
      employees,
      routes: activeRoutes,
      schedules: citySchedules,
      quarterSchedules,
      month: monthNum,
      year: yearNum,
      user_id,
    });

  const persistSkipped = [];
  let created = [];
  let labelsCreated = [];
  let gapFillRounds = 0;

  const runPersistBatch = async (proposals) => {
    if (!proposals || proposals.length === 0) {
      return { created: [], skipped: [] };
    }
    return persistRouteProposals(proposals, user_id, { autoFilled: true });
  };

  let firstBatchCreated = 0;

  if (routeAssignments.length > 0 || labelAssignments.length > 0) {
    let firstBatchSkipped = [];
    const liveSchedules = citySchedules.map(toSchedulePlain);
    for (const proposal of routeAssignments) {
      const { kept, rejected } = filterPersistableAssignments(
        [proposal],
        liveSchedules,
        activeRoutes,
        employees
      );
      pushFilterRejections(rejected, persistSkipped);
      const persistable = kept[0];
      if (!persistable) continue;

      const routeResult = await runPersistBatch([persistable]);
      firstBatchCreated += routeResult.created.length;
      created.push(...routeResult.created);
      firstBatchSkipped.push(...routeResult.skipped);
      pushCreatedToLiveSchedules(routeResult.created, liveSchedules);
    }
    persistSkipped.push(...firstBatchSkipped);
    labelsCreated = await persistLabelProposals(labelAssignments, user_id, {
      autoFilled: true,
    });
  }

  let gapSchedules = await Schedule.findAll({
    where: { date: { [Op.between]: [startDate, endDate] } },
  });

  for (let round = 0; round < 25; round++) {
    const gapCitySchedules = gapSchedules.filter((s) =>
      cityEmployeeIds.has(s.employee_id?.toString())
    );

    const { routeAssignments: gapProposals } = generateGapFillOnly({
      employees,
      routes: activeRoutes,
      schedules: gapCitySchedules,
      quarterSchedules,
      month: monthNum,
      year: yearNum,
      user_id,
    });

    if (gapProposals.length === 0) break;

    let roundCreated = 0;
    const liveSchedules = gapCitySchedules.map(toSchedulePlain);
    for (const proposal of gapProposals) {
      const { kept, rejected } = filterPersistableAssignments(
        [proposal],
        liveSchedules,
        activeRoutes,
        employees
      );
      pushFilterRejections(rejected, persistSkipped);
      const persistable = kept[0];
      if (!persistable) continue;

      const gapResult = await runPersistBatch([persistable]);
      roundCreated += gapResult.created.length;
      created.push(...gapResult.created);
      persistSkipped.push(...gapResult.skipped);
      pushCreatedToLiveSchedules(gapResult.created, liveSchedules);
    }
    if (roundCreated === 0) break;

    gapFillRounds += 1;
    gapSchedules = await Schedule.findAll({
      where: { date: { [Op.between]: [startDate, endDate] } },
    });
  }

  const afterSchedules = gapSchedules;
  const afterCitySchedules = afterSchedules.filter((s) =>
    cityEmployeeIds.has(s.employee_id?.toString())
  );

  const afterPersist = buildScheduleGapReport({
    employees,
    routes: activeRoutes,
    schedules: afterCitySchedules,
    quarterSchedules,
    month: monthNum,
    year: yearNum,
    employeeCount: employees.length,
    title: 'Po zapisie do bazy (stan widoczny w UI)',
  });

  const persistLogs = persistSkipped.map(
    (s) =>
      `POMINIĘTO ZAPIS: ${s.date} trasa #${s.route_id} → kierowca #${s.employee_id}: ${s.reason}`
  );

  const debug = {
    proposedRoutes: routeAssignments.length,
    proposedLabels: labelAssignments.length,
    createdRoutes: created.length,
    createdLabels: labelsCreated.length,
    persistSkippedCount: persistSkipped.length,
    gapFillRounds,
    afterAlgorithm: algorithmDebug?.afterAlgorithm || null,
    afterPersist,
    persistSkipped,
    logs: [
      ...(algorithmDebug?.afterAlgorithm?.logs || []),
      '',
      '--- Zapis do bazy ---',
      'Wersja: diff workingSchedules vs baseline + filtr na baseline',
      `Zaproponowano tras: ${routeAssignments.length} (w tym soboty: ${routeAssignments.filter((r) => isSaturday(r.date)).length})`,
      `Zapisano w 1. partii: ${firstBatchCreated}`,
      `Dodatkowe rundy domykania luk: ${gapFillRounds}`,
      `Łącznie zapisano tras: ${created.length}, pominięto: ${persistSkipped.length}`,
      ...persistLogs,
      '',
      ...(afterPersist.logs || []),
    ],
  };

  if (routeAssignments.length === 0 && labelAssignments.length === 0) {
    return {
      message: 'Brak pustych slotów tras do uzupełnienia i brak brakujących DW5.',
      created: 0,
      labelsCreated: 0,
      assignments: [],
      debug,
      cityId,
      month: monthNum,
      year: yearNum,
    };
  }

  let message = '';
  if (created.length > 0) {
    message = `Uzupełniono ${created.length} przypisań tras`;
  }
  if (labelsCreated.length > 0) {
    message += message
      ? ` i ${labelsCreated.length} etykiet DW5.`
      : `Dodano ${labelsCreated.length} brakujących etykiet DW5 (po ręcznych trasach sobotnich).`;
  }
  if (!message) message = 'Grafik bez zmian.';

  const gapHint =
    afterPersist.summary?.emptyWithAssignableRoutes > 0
      ? ` Uwaga: ${afterPersist.summary.emptyWithAssignableRoutes} pustych dni nadal ma dostępne trasy — zobacz log diagnostyczny.`
      : '';

  return {
    message: message + gapHint,
    created: created.length,
    labelsCreated: labelsCreated.length,
    assignments: created,
    labels: labelsCreated,
    debug,
    cityId,
    month: monthNum,
    year: yearNum,
  };
}

module.exports = { runAutoFill };
