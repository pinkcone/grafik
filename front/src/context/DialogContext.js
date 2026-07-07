import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from 'react';
import { createPortal } from 'react-dom';
import '../styles/Dialog.css';

const DialogContext = createContext(null);

// Reużywalne dialogi alert/confirm zwracające Promise.
// Użycie:
//   const dialog = useDialog();
//   await dialog.alert('Zapisano.');
//   const ok = await dialog.confirm('Na pewno usunąć?', { danger: true });
export function DialogProvider({ children }) {
  const [current, setCurrent] = useState(null);
  const queueRef = useRef([]);

  const enqueue = useCallback((req) => new Promise((resolve) => {
    const entry = { ...req, resolve };
    setCurrent((cur) => {
      if (cur) {
        queueRef.current.push(entry);
        return cur;
      }
      return entry;
    });
  }), []);

  const resolveCurrent = useCallback((value) => {
    setCurrent((cur) => {
      if (cur?.resolve) cur.resolve(value);
      return queueRef.current.shift() || null;
    });
  }, []);

  const alert = useCallback(
    (message, opts = {}) => enqueue({ type: 'alert', message, ...opts }),
    [enqueue]
  );

  const confirm = useCallback(
    (message, opts = {}) => enqueue({ type: 'confirm', message, ...opts }),
    [enqueue]
  );

  const value = useMemo(() => ({ alert, confirm }), [alert, confirm]);

  return (
    <DialogContext.Provider value={value}>
      {children}
      {current && (
        <DialogModal
          dialog={current}
          onConfirm={() => resolveCurrent(true)}
          onCancel={() => resolveCurrent(current.type === 'confirm' ? false : undefined)}
        />
      )}
    </DialogContext.Provider>
  );
}

function DialogModal({ dialog, onConfirm, onCancel }) {
  const {
    type,
    title,
    message,
    confirmText,
    cancelText,
    danger,
  } = dialog;

  const confirmRef = useRef(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onConfirm, onCancel]);

  const defaultTitle = type === 'confirm' ? 'Potwierdzenie' : 'Informacja';

  return createPortal(
    <div className="dialog-overlay" onMouseDown={onCancel}>
      <div
        className="dialog-card"
        role={type === 'confirm' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="dialog-title">{title || defaultTitle}</h3>
        <div className="dialog-message">{message}</div>
        <div className="dialog-actions">
          {type === 'confirm' && (
            <button type="button" className="btn-secondary" onClick={onCancel}>
              {cancelText || 'Anuluj'}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            className={danger ? 'btn-danger' : 'btn-primary'}
            onClick={onConfirm}
          >
            {confirmText || (type === 'confirm' ? 'OK' : 'Rozumiem')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error('useDialog musi być użyte wewnątrz <DialogProvider>');
  }
  return ctx;
}

export default DialogContext;
