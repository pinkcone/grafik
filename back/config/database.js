const { Sequelize } = require('sequelize');

const sequelize = new Sequelize('graf', 'root', '', {
  host: 'localhost',
  dialect: 'mysql',
  logging: false,
});

module.exports = sequelize;
