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
const UserModel = require('./User');

// Inicjalizacja modeli
const User = UserModel(sequelize, DataTypes);
const City = CityModel(sequelize, DataTypes);
const Employee = EmployeeModel(sequelize, DataTypes);
const Route = RouteModel(sequelize, DataTypes);
const RouteDay = RouteDayModel(sequelize, DataTypes);
const Schedule = ScheduleModel(sequelize, DataTypes);
const Label = LabelModel ? LabelModel(sequelize, DataTypes) : null;

// Relacje User ↔ City
City.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
User.hasMany(City, { foreignKey: 'user_id', as: 'cities' });

// Relacje User ↔ Employee
Employee.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
User.hasMany(Employee, { foreignKey: 'user_id', as: 'employees' });

// Relacje User ↔ Route
Route.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
User.hasMany(Route, { foreignKey: 'user_id', as: 'routes' });

// Relacje User ↔ Schedule
Schedule.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
User.hasMany(Schedule, { foreignKey: 'user_id', as: 'schedules' });

// (Opcjonalnie) Relacje User ↔ Label
if (Label) {
  Label.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
  User.hasMany(Label, { foreignKey: 'user_id', as: 'labels' });
}

// Pozostałe relacje
// City ↔ Employee (jeśli pracownik należy do miasta)
Employee.belongsTo(City, { foreignKey: 'city_id', as: 'city' });
City.hasMany(Employee, { foreignKey: 'city_id', as: 'employees' });

// Route ↔ RouteDay
Route.hasMany(RouteDay, { foreignKey: 'route_id', as: 'days' });
RouteDay.belongsTo(Route, { foreignKey: 'route_id', as: 'route' });

// Employee ↔ Schedule
Employee.hasMany(Schedule, { foreignKey: 'employee_id', as: 'schedules' });
Schedule.belongsTo(Employee, { foreignKey: 'employee_id', as: 'employee' });

// Route ↔ Schedule
Route.hasMany(Schedule, { foreignKey: 'route_id', as: 'schedules' });
Schedule.belongsTo(Route, { foreignKey: 'route_id', as: 'route' });

// Relacja samoreferencyjna w Route (linked_route)
Route.belongsTo(Route, { foreignKey: 'linked_route_id', as: 'linkedRoute' });
Route.hasOne(Route, { foreignKey: 'linked_route_id', as: 'parentRoute' });

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
  User,
  City,
  Employee,
  Route,
  RouteDay,
  Schedule,
  Label,
};
