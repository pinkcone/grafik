const { Schedule, Route, Employee } = require('../models');
const { attachOperatingDays } = require('./routeDayHelpers');
const { hasEmployeeLabelOnDay } = require('./scheduleLabels');
const { canPersistRouteAssignment } = require('./scheduleConstraints');

const persistRouteProposals = async (proposals, user_id, { autoFilled = false } = {}) => {
  const created = [];
  const skipped = [];
  const routesCache = new Map();
  const dayStateCache = new Map();
  const employeeLicenseCache = new Map();

  for (const item of proposals) {
    const existing = await Schedule.findOne({
      where: { date: item.date, route_id: item.route_id },
    });
    if (existing) {
      if (existing.employee_id?.toString() === item.employee_id?.toString()) {
        const rowJson = existing.toJSON ? existing.toJSON() : existing;
        const dayKey = `${item.date}|${item.employee_id}`;
        if (!dayStateCache.has(dayKey)) {
          const dayEntries = await Schedule.findAll({
            where: { date: item.date, employee_id: item.employee_id },
          });
          dayStateCache.set(
            dayKey,
            dayEntries.map((s) => (s.toJSON ? s.toJSON() : s))
          );
        }
        created.push(existing);
        continue;
      }
      skipped.push({
        date: item.date,
        route_id: item.route_id,
        employee_id: item.employee_id,
        reason: `Slot trasy już zajęty (kierowca #${existing.employee_id})`,
      });
      continue;
    }

    const dayKey = `${item.date}|${item.employee_id}`;
    if (!dayStateCache.has(dayKey)) {
      const dayEntries = await Schedule.findAll({
        where: { date: item.date, employee_id: item.employee_id },
      });
      dayStateCache.set(
        dayKey,
        dayEntries.map((s) => (s.toJSON ? s.toJSON() : s))
      );
    }
    const daySchedules = dayStateCache.get(dayKey);

    if (hasEmployeeLabelOnDay(item.employee_id, item.date, daySchedules)) {
      skipped.push({
        date: item.date,
        route_id: item.route_id,
        employee_id: item.employee_id,
        reason: 'Pracownik ma etykietę tego dnia',
      });
      continue;
    }

    if (!routesCache.has(user_id)) {
      routesCache.set(
        user_id,
        await attachOperatingDays(await Route.findAll({ where: { user_id } }))
      );
    }
    const userRoutes = routesCache.get(user_id);

    if (!employeeLicenseCache.has(item.employee_id)) {
      const emp = await Employee.findByPk(item.employee_id, {
        attributes: ['license_category'],
      });
      employeeLicenseCache.set(item.employee_id, emp?.license_category ?? null);
    }

    const canTake = canPersistRouteAssignment(
      item.employee_id,
      item.route_id,
      item.date,
      daySchedules,
      userRoutes,
      { licenseCategory: employeeLicenseCache.get(item.employee_id) }
    );
    if (!canTake) {
      skipped.push({
        date: item.date,
        route_id: item.route_id,
        employee_id: item.employee_id,
        reason: 'Pracownik ma już inną trasę tego dnia (limit slotów)',
      });
      continue;
    }

    const row = await Schedule.create({
      date: item.date,
      employee_id: item.employee_id,
      route_id: item.route_id,
      label: null,
      assignment_type: 'route',
      user_id: item.user_id || user_id,
      auto_filled: autoFilled,
    });
    const rowJson = row.toJSON ? row.toJSON() : row;
    daySchedules.push(rowJson);
    created.push(row);
  }
  return { created, skipped };
};

const persistLabelProposals = async (proposals, user_id, { autoFilled = false } = {}) => {
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
        auto_filled: autoFilled,
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
        auto_filled: autoFilled,
      });
      created.push(row);
    }
  }
  return created;
};

module.exports = {
  persistRouteProposals,
  persistLabelProposals,
};
