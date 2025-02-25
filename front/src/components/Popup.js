// src/components/Popup.js
import React from 'react';

const popupStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.5)',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
};

const popupContentStyle = {
  background: '#fff',
  padding: '20px',
  borderRadius: '5px',
  minWidth: '300px',
};

const Popup = ({ isOpen, onClose, children }) => {
  if (!isOpen) return null;

  return (
    <div style={popupStyle}>
      <div style={popupContentStyle}>
        {children}
        <button onClick={onClose} style={{ marginTop: '10px' }}>
          Zamknij
        </button>
      </div>
    </div>
  );
};

export default Popup;
