import React from 'react';
import { MONTH_NAMES } from '../../utils/scheduleViewHelpers';

function ScheduleMonthNav({ month, year, onPrev, onNext, onToday }) {
  return (
    <nav className="schedule-month-nav" aria-label="Wybór miesiąca">
      <button
        type="button"
        className="schedule-month-nav__arrow"
        onClick={onPrev}
        aria-label="Poprzedni miesiąc"
        title="Poprzedni miesiąc"
      >
        ‹
      </button>
      <div className="schedule-month-nav__label">
        <span className="schedule-month-nav__month">{MONTH_NAMES[month - 1]}</span>
        <span className="schedule-month-nav__year">{year}</span>
      </div>
      <button
        type="button"
        className="schedule-month-nav__arrow"
        onClick={onNext}
        aria-label="Następny miesiąc"
        title="Następny miesiąc"
      >
        ›
      </button>
      <button
        type="button"
        className="schedule-month-nav__today"
        onClick={onToday}
        title="Przejdź do bieżącego miesiąca"
      >
        Dziś
      </button>
    </nav>
  );
}

export default ScheduleMonthNav;
