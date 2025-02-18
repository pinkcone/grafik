// models/index.js
const sequelize = require('../config/database');
const { DataTypes } = require('sequelize');

// Import modeli jako funkcje
const CityModel = require('./City');
const EmployeeModel = require('./Employee');
const RouteModel = require('./Route');
const RouteDayModel = require('./RouteDay');
const ScheduleModel = require('./Schedule');
const LabelModel = require('./Label');

// Inicjalizacja modeli
const City = CityModel(sequelize, DataTypes);
const Employee = EmployeeModel(sequelize, DataTypes);
const Route = RouteModel(sequelize, DataTypes);
const RouteDay = RouteDayModel(sequelize, DataTypes);
const Schedule = ScheduleModel(sequelize, DataTypes);
const Label = LabelModel ? LabelModel(sequelize, DataTypes) : null; // opcjonalnie

// Definicja relacji

// Relacje: City ↔ Employee
Employee.belongsTo(City, { foreignKey: 'city_id', as: 'city' });
City.hasMany(Employee, { foreignKey: 'city_id', as: 'employees' });

// Relacje: Route ↔ RouteDay
Route.hasMany(RouteDay, { foreignKey: 'route_id', as: 'days' });
RouteDay.belongsTo(Route, { foreignKey: 'route_id', as: 'route' });

// Relacje: Employee ↔ Schedule
Employee.hasMany(Schedule, { foreignKey: 'employee_id', as: 'schedules' });
Schedule.belongsTo(Employee, { foreignKey: 'employee_id', as: 'employee' });

// Relacje: Route ↔ Schedule
Route.hasMany(Schedule, { foreignKey: 'route_id', as: 'schedules' });
Schedule.belongsTo(Route, { foreignKey: 'route_id', as: 'route' });

// Relacja samoreferencyjna w Route (linked_route)
Route.belongsTo(Route, { foreignKey: 'linked_route_id', as: 'linkedRoute' });
Route.hasOne(Route, { foreignKey: 'linked_route_id', as: 'parentRoute' });

// (Opcjonalnie) Możesz zdefiniować relacje dla Label, jeśli to potrzebne

// Synchronizacja modeli (utworzenie lub modyfikacja tabel)
sequelize.sync({ alter: true })
  .then(() => {
    console.log('Tabele zostały utworzone/synchronizowane w bazie danych.');
  })
  .catch((err) => {
    console.error('Błąd podczas synchronizacji tabel:', err);
  });

module.exports = {
  sequelize,
  City,
  Employee,
  Route,
  RouteDay,
  Schedule,
  Label,
};
