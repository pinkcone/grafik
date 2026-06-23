const { DataTypes } = require('sequelize');

/**
 * Sequelize sync({ alter: true }) czasem nie dodaje kolumn ENUM na produkcji.
 * Ten skrypt robi to jawnie — bezpieczne do wielokrotnego uruchomienia.
 */
async function ensureLicenseColumns(sequelize) {
  const qi = sequelize.getQueryInterface();

  const employees = await qi.describeTable('employees').catch(() => null);
  if (employees && !employees.license_category) {
    await qi.addColumn('employees', 'license_category', {
      type: DataTypes.ENUM('B', 'C'),
      allowNull: true,
      comment: 'Najwyższa kategoria prawa jazdy (C uprawnia też do B)',
    });
    console.log('Migracja: dodano employees.license_category');
  }

  const routes = await qi.describeTable('routes').catch(() => null);
  if (routes && !routes.required_license_category) {
    await qi.addColumn('routes', 'required_license_category', {
      type: DataTypes.ENUM('B', 'C'),
      allowNull: false,
      defaultValue: 'B',
      comment: 'Wymagana kategoria prawa jazdy na trasie',
    });
    console.log('Migracja: dodano routes.required_license_category');
  }
}

module.exports = { ensureLicenseColumns };
