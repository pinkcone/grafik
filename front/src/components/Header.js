import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';
import { useNotifications } from '../context/NotificationsContext';
import '../styles/Header.css';

function formatTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('pl-PL', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function Header({ onLogout }) {
  const navigate = useNavigate();
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef(null);

  const token = localStorage.getItem('token');
  let userName = '';
  let initials = 'U';

  if (token) {
    try {
      const decoded = jwtDecode(token);
      if (decoded.first_name && decoded.last_name) {
        userName = `${decoded.first_name} ${decoded.last_name}`;
        initials = `${decoded.first_name[0]}${decoded.last_name[0]}`.toUpperCase();
      } else {
        userName = decoded.email || 'użytkowniku';
        initials = userName[0]?.toUpperCase() || 'U';
      }
    } catch {
      userName = 'użytkowniku';
    }
  }

  useEffect(() => {
    const onDocClick = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setPanelOpen(false);
      }
    };
    if (panelOpen) {
      document.addEventListener('mousedown', onDocClick);
    }
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [panelOpen]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    window.dispatchEvent(new Event('grafik-auth'));
    onLogout?.();
    navigate('/login');
  };

  const handleStartPage = () => {
    navigate('/');
  };

  const handleNotificationClick = (n) => {
    if (!n.read) markRead(n.id);
    if (n.cityId) {
      navigate(`/cities/${n.cityId}`);
      setPanelOpen(false);
    }
  };

  return (
    <header className="app-header">
      <div className="app-header__inner">
        <button type="button" className="app-header__brand" onClick={handleStartPage}>
          <span className="app-header__logo" aria-hidden="true">G</span>
          <span className="app-header__brand-text">
            <span className="app-header__title">JaGrafiko</span>
            <span className="app-header__subtitle">Zarządzanie grafikami</span>
          </span>
        </button>

        <div className="app-header__actions">
          <div className="app-header__notifications" ref={panelRef}>
            <button
              type="button"
              className="app-header__notifications-btn"
              onClick={() => setPanelOpen((o) => !o)}
              aria-label="Powiadomienia"
              aria-expanded={panelOpen}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 2a5 5 0 00-5 5v2.5c0 .7-.3 1.4-.8 1.9L4.5 13.5A1 1 0 005.4 15h13.2a1 1 0 00.7-1.7l-1.7-2.1c-.5-.5-.8-1.2-.8-1.9V7a5 5 0 00-5-5z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
                <path
                  d="M10 18a2 2 0 004 0"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
              {unreadCount > 0 && (
                <span className="app-header__notifications-badge">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {panelOpen && (
              <div className="app-header__notifications-panel">
                <div className="app-header__notifications-head">
                  <strong>Powiadomienia</strong>
                  {notifications.length > 0 && (
                    <button
                      type="button"
                      className="app-header__notifications-mark-all"
                      onClick={markAllRead}
                    >
                      Oznacz wszystkie
                    </button>
                  )}
                </div>

                {notifications.length === 0 ? (
                  <p className="app-header__notifications-empty">Brak powiadomień</p>
                ) : (
                  <ul className="app-header__notifications-list">
                    {notifications.map((n) => (
                      <li key={n.id}>
                        <button
                          type="button"
                          className={`app-header__notification${n.read ? '' : ' app-header__notification--unread'}`}
                          onClick={() => handleNotificationClick(n)}
                        >
                          <span className={`app-header__notification-status app-header__notification-status--${n.status}`} />
                          <span className="app-header__notification-body">
                            <span className="app-header__notification-title">{n.title}</span>
                            <span className="app-header__notification-message">
                              {n.status === 'running'
                                ? 'Trwa na serwerze — możesz zamknąć stronę'
                                : n.message}
                            </span>
                            <span className="app-header__notification-time">
                              {formatTime(n.finishedAt || n.createdAt)}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="app-header__user">
            <span className="app-header__avatar" aria-hidden="true">{initials}</span>
            <span className="app-header__name">Witaj, {userName}</span>
          </div>
          <button type="button" className="app-header__logout" onClick={handleLogout}>
            Wyloguj
          </button>
        </div>
      </div>
    </header>
  );
}

export default Header;
