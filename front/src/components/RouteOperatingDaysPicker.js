import React from 'react';
import { WEEKDAY_OPTIONS } from '../utils/routeOperatingDays';

function RouteOperatingDaysPicker({ selectedDays, onChange }) {
  const toggleDay = (day) => {
    const set = new Set(selectedDays);
    if (set.has(day)) {
      set.delete(day);
    } else {
      set.add(day);
    }
    const next = [...set].sort((a, b) => a - b);
    if (next.length === 0) {
      alert('Trasa musi kursować co najmniej jeden dzień w tygodniu.');
      return;
    }
    onChange(next);
  };

  return (
    <div className="route-days-picker">
      <span className="route-days-picker__label">Dni kursowania:</span>
      <div className="route-days-picker__days">
        {WEEKDAY_OPTIONS.map(({ value, label }) => (
          <label key={value} className="route-days-picker__day">
            <input
              type="checkbox"
              checked={selectedDays.includes(value)}
              onChange={() => toggleDay(value)}
            />
            {label}
          </label>
        ))}
      </div>
      <p className="route-days-picker__hint">
        Każda nowa trasa domyślnie kursuje od poniedziałku do piątku.
        Sobota, niedziela lub inne dni — zaznacz ręcznie tylko tam, gdzie trasa faktycznie jeździ.
      </p>
    </div>
  );
}

export default RouteOperatingDaysPicker;
