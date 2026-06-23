const path = require('path');
const dotenv = require('dotenv');

const envPath = path.join(__dirname, '.env');
const result = dotenv.config({ path: envPath });

if (result.error && process.env.NODE_ENV === 'production') {
  console.error(`[loadEnv] Nie wczytano ${envPath}:`, result.error.message);
}

module.exports = { envPath };
