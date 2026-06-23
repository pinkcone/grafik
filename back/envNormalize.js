/** DB-HOST w .env → DB_HOST (Node nie mapuje myślników na podkreślniki). */
function normalizeEnvKeys(vars) {
  const out = { ...vars };
  for (const [key, val] of Object.entries(vars)) {
    const underscored = key.replace(/-/g, '_');
    if (out[underscored] === undefined || out[underscored] === '') {
      out[underscored] = val;
    }
  }
  return out;
}

function applyHyphenAliasesToProcessEnv() {
  for (const key of Object.keys(process.env)) {
    if (!key.includes('-')) continue;
    const underscored = key.replace(/-/g, '_');
    if (process.env[underscored] === undefined || process.env[underscored] === '') {
      process.env[underscored] = process.env[key];
    }
  }
}

module.exports = { normalizeEnvKeys, applyHyphenAliasesToProcessEnv };
