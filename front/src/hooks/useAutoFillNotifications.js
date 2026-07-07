import { useEffect } from 'react';
import { fetchNotificationDetail } from '../api/scheduleApi';

const belongsHere = (n, cityId, month, year) =>
  String(n.cityId) === String(cityId) && n.month === month && n.year === year;

// Obsługuje powiadomienia auto-uzupełniania: nasłuch zdarzeń okna oraz listę
// powiadomień z kontekstu. Po zakończeniu joba wczytuje debug i odświeża grafik.
export default function useAutoFillNotifications({
  cityId,
  month,
  year,
  notifications,
  applyDebug,
  refetch,
}) {
  // 1) Zdarzenia okna (job-completed / job-failed)
  useEffect(() => {
    const applyDebugFromNotification = (n) => {
      const debug = n.result?.debug;
      if (!debug) return;
      applyDebug(debug);
      console.group('[Auto-fill] Diagnostyka');
      console.log('Podsumowanie po zapisie:', debug.afterPersist?.summary);
      console.log('Pominięte zapisy:', debug.persistSkipped);
      (debug.logs || []).forEach((line) => console.log(line));
      console.groupEnd();
    };

    const applyCompletedJob = async (n) => {
      const appliedKey = `grafik-applied-job:${n.id}`;
      if (sessionStorage.getItem(appliedKey)) return;

      let detail = n;
      const token = localStorage.getItem('token');
      if (token && n.id) {
        try {
          const fetched = await fetchNotificationDetail(n.id, token);
          if (fetched) detail = fetched;
        } catch {
          // użyj wersji z listy
        }
      }

      sessionStorage.setItem(appliedKey, '1');
      applyDebugFromNotification(detail);
      await refetch();
    };

    const onCompleted = async (e) => {
      const n = e.detail;
      if (!belongsHere(n, cityId, month, year)) return;
      await applyCompletedJob(n);
    };

    const onFailed = (e) => {
      const n = e.detail;
      if (!belongsHere(n, cityId, month, year)) return;
      alert(`Auto-uzupełnianie nie powiodło się: ${n.error || n.message}`);
    };

    window.addEventListener('grafik-job-completed', onCompleted);
    window.addEventListener('grafik-job-failed', onFailed);
    return () => {
      window.removeEventListener('grafik-job-completed', onCompleted);
      window.removeEventListener('grafik-job-failed', onFailed);
    };
  }, [cityId, month, year, applyDebug, refetch]);

  // 2) Lista powiadomień z kontekstu (dogranie najnowszego ukończonego joba)
  useEffect(() => {
    const pending = notifications
      .filter(
        (n) =>
          n.type === 'auto_fill' &&
          n.status === 'completed' &&
          belongsHere(n, cityId, month, year)
      )
      .sort((a, b) => new Date(b.finishedAt || 0) - new Date(a.finishedAt || 0));

    if (pending.length === 0) return;

    const latest = pending[0];
    const appliedKey = `grafik-applied-job:${latest.id}`;
    if (sessionStorage.getItem(appliedKey)) return;

    (async () => {
      const token = localStorage.getItem('token');
      let detail = latest;
      if (token) {
        try {
          const fetched = await fetchNotificationDetail(latest.id, token);
          if (fetched) detail = fetched;
        } catch {
          // ignore
        }
      }

      sessionStorage.setItem(appliedKey, '1');
      const debug = detail.result?.debug;
      if (debug) applyDebug(debug);
      await refetch();
    })();
  }, [cityId, month, year, notifications, applyDebug, refetch]);

  return notifications.some(
    (n) =>
      n.type === 'auto_fill' &&
      n.status === 'running' &&
      belongsHere(n, cityId, month, year)
  );
}
