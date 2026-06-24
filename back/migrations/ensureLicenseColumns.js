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
  }

  const routes = await qi.describeTable('routes').catch(() => null);
  if (routes && !routes.required_license_category) {
    await qi.addColumn('routes', 'required_license_category', {
      type: DataTypes.ENUM('B', 'C'),
      allowNull: false,
      defaultValue: 'B',
      comment: 'Wymagana kategoria prawa jazdy na trasie',
    });
  }

  if (employees && !employees.special_permissions) {
    await qi.addColumn('employees', 'special_permissions', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Czy pracownik posiada specjalne uprawnienia',
    });
  }

  if (routes && !routes.requires_special_permissions) {
    await qi.addColumn('routes', 'requires_special_permissions', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Czy trasa wymaga specjalnych uprawnień pracownika',
    });
  }

  if (routes && !routes.requires_staffing) {
    await qi.addColumn('routes', 'requires_staffing', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: 'Czy trasa musi być obsadzona (false = może zostać pusta przy braku kierowców)',
    });
  }
}

module.exports = { ensureLicenseColumns };
