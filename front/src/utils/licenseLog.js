/** Logi kategorii prawa jazdy — pracownik i trasa. Filtr w konsoli: prawo-jazdy */

function log(kind, krok, dane) {
  if (dane !== undefined) {
    console.log(`[prawo-jazdy:${kind}]`, krok, dane);
  } else {
    console.log(`[prawo-jazdy:${kind}]`, krok);
  }
}

export function logEmployeeLicense(krok, dane) {
  log('pracownik', krok, dane);
}

export function logRouteLicense(krok, dane) {
  log('trasa', krok, dane);
}

export function logLicenseReady(dane) {
  console.log('[prawo-jazdy]', 'logi aktywne (pracownik + trasa)', dane);
}
