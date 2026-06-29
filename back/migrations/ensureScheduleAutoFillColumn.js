const { DataTypes } = require('sequelize');

/**
 * Znacznik wpisów dodanych przez „Uzupełnij trasy”.
 * Tylko takie trasy usuwa „Wyczyść trasy miesiąca”.
 */
async function ensureScheduleAutoFillColumn(sequelize) {
  const qi = sequelize.getQueryInterface();
  const schedule = await qi.describeTable('schedule').catch(() => null);
  if (schedule && !schedule.auto_filled) {
    await qi.addColumn('schedule', 'auto_filled', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'true = wpis z auto-uzupełniania tras (Uzupełnij trasy)',
    });
  }
}

module.exports = { ensureScheduleAutoFillColumn };
