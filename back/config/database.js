require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { Sequelize } = require('sequelize');

// localhost → ::1 (IPv6); MySQL na Ubuntu zwykle słucha tylko 127.0.0.1
const dbHost = process.env.DB_HOST || '127.0.0.1';
const resolvedHost = dbHost === 'localhost' ? '127.0.0.1' : dbHost;

const sequelize = new Sequelize(
  process.env.DB_NAME || 'graf',
  process.env.DB_USER || 'root',
  process.env.DB_PASSWORD || '',
  {
    host: resolvedHost,
    dialect: 'mysql',
    logging: false,
  }
);

module.exports = sequelize;
