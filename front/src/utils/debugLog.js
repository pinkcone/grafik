const MAX_LOGS = 150;

const logs = [];

/** Logi trafiają do konsoli ORAZ do bufora — przetrwają przeładowanie (sessionStorage). */
export function debugLog(...args) {
  const entry = {
    time: new Date().toISOString(),
    message: args.map((a) => {
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    }).join(' '),
  };

  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.shift();

  try {
    sessionStorage.setItem('grafik_debug_logs', JSON.stringify(logs));
  } catch {
    // sessionStorage pełny lub niedostępny
  }

  console.log('[grafik]', ...args);
}

export function getDebugLogs() {
  try {
    const stored = sessionStorage.getItem('grafik_debug_logs');
    if (stored) return JSON.parse(stored);
  } catch {
    // ignore
  }
  return logs;
}

if (typeof window !== 'undefined') {
  window.__grafikDebugLogs = getDebugLogs;
  window.showGrafikLogs = () => {
    getDebugLogs().forEach((e) => console.log(e.time, e.message));
  };
}
