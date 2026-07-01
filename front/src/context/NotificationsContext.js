import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

const NotificationsContext = createContext(null);

export function NotificationsProvider({ children }) {
  const [notifications, setNotifications] = useState([]);
  const prevStatusRef = useRef({});

  const fetchNotifications = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      setNotifications([]);
      return;
    }

    try {
      const res = await fetch('/api/notifications', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!res.ok) return;

      const data = await res.json();
      const list = data.notifications || [];

      for (const n of list) {
        const prev = prevStatusRef.current[n.id];
        if (n.status === 'completed' && prev === 'running') {
          let detail = n;
          try {
            const detailRes = await fetch(`/api/notifications/${n.id}`, {
              headers: { Authorization: `Bearer ${token}` },
              cache: 'no-store',
            });
            if (detailRes.ok) {
              const detailData = await detailRes.json();
              detail = detailData.notification || n;
            }
          } catch {
            // użyj wersji z listy
          }
          window.dispatchEvent(new CustomEvent('grafik-job-completed', { detail }));
        }
        if (n.status === 'failed' && prev === 'running') {
          window.dispatchEvent(new CustomEvent('grafik-job-failed', { detail: n }));
        }
        prevStatusRef.current[n.id] = n.status;
      }

      setNotifications(list);
    } catch {
      // polling w tle — błędy sieci ignorujemy
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 2500);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  useEffect(() => {
    const onAuth = () => {
      prevStatusRef.current = {};
      fetchNotifications();
    };
    window.addEventListener('grafik-auth', onAuth);
    return () => window.removeEventListener('grafik-auth', onAuth);
  }, [fetchNotifications]);

  const markRead = useCallback(async (id) => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      await fetch(`/api/notifications/${id}/read`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
    } catch {
      // ignore
    }
  }, []);

  const markAllRead = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      await fetch('/api/notifications/read-all', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {
      // ignore
    }
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationsContext.Provider
      value={{
        notifications,
        unreadCount,
        markRead,
        markAllRead,
        refresh: fetchNotifications,
      }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error('useNotifications wymaga NotificationsProvider');
  }
  return ctx;
}
