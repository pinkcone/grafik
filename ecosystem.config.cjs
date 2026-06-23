const path = require('path');
const fs = require('fs');

/** Wczytaj back/.env do env PM2 — inaczej po pm2 restart zostają tylko domyślne root/'' */
function loadBackEnv() {
  const envPath = path.join(__dirname, 'back', '.env');
  const vars = {};

  if (!fs.existsSync(envPath)) {
    console.warn(`[ecosystem] Brak pliku ${envPath}`);
    return vars;
  }

  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    vars[key] = val;
  }

  return vars;
}

const envFromFile = loadBackEnv();

module.exports = {
  apps: [
    {
      name: 'grafik-api',
      cwd: './back',
      script: 'server.js',
      instances: 1,
      autorestart: true,
      max_memory_restart: '300M',
      env_production: {
        NODE_ENV: 'production',
        PORT: 5000,
        ...envFromFile,
      },
    },
  ],
};
