require('../loadEnv');

const { Sequelize } = require('sequelize');

const dbHost = process.env.DB_HOST || '127.0.0.1';
const resolvedHost = dbHost === 'localhost' ? '127.0.0.1' : dbHost;
const dbName = process.env.DB_NAME;
const dbUser = process.env.DB_USER;
const dbPassword = process.env.DB_PASSWORD ?? '';

if (!dbName || !dbUser) {
  throw new Error(
    'Brak DB_NAME lub DB_USER — uzupełnij /var/www/grafik/back/.env (nie używamy domyślnego root)'
  );
}

const sequelize = new Sequelize(dbName, dbUser, dbPassword, {
  host: resolvedHost,
  dialect: 'mysql',
  logging: false,
});

module.exports = sequelize;
