/** Logi tylko dla zapisu kategorii prawa jazdy pracownika — console.warn żeby było widać w DevTools. */
export function logLicense(krok, dane) {
  if (dane !== undefined) {
    console.warn('[prawo-jazdy]', krok, dane);
  } else {
    console.warn('[prawo-jazdy]', krok);
  }
}
