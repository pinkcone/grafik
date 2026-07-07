import { useState, useEffect, useCallback } from 'react';
import {
  fetchEmployees as apiFetchEmployees,
  fetchRoutes as apiFetchRoutes,
  fetchLabels as apiFetchLabels,
  fetchScheduleMonth,
} from '../api/scheduleApi';
import { getQuarterMonths } from '../utils/scheduleViewHelpers';

// Zarządza danymi grafiku (pracownicy, trasy, etykiety, wpisy + wpisy kwartału)
// dla danego miasta/miesiąca/roku i udostępnia funkcje odświeżające.
export default function useScheduleData(cityId, month, year, token) {
  const [employees, setEmployees] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [labels, setLabels] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [quarterSchedules, setQuarterSchedules] = useState({});

  const loadEmployees = useCallback(async () => {
    try {
      setEmployees(await apiFetchEmployees(cityId, token));
    } catch { /* ignore */ }
  }, [cityId, token]);

  const loadRoutes = useCallback(async () => {
    try {
      setRoutes(await apiFetchRoutes(cityId, token));
    } catch { /* ignore */ }
  }, [cityId, token]);

  const loadLabels = useCallback(async () => {
    try {
      setLabels(await apiFetchLabels(token));
    } catch { /* ignore */ }
  }, [token]);

  const fetchSchedule = useCallback(async () => {
    try {
      setSchedules(await fetchScheduleMonth(cityId, month, year, token));
    } catch { /* ignore */ }
  }, [cityId, month, year, token]);

  const fetchQuarterSchedules = useCallback(async () => {
    const qMonths = getQuarterMonths(month);
    const results = await Promise.all(
      qMonths.map(async (m) => {
        try {
          return [m, await fetchScheduleMonth(cityId, m, year, token)];
        } catch {
          return [m, []];
        }
      })
    );
    const map = {};
    results.forEach(([m, arr]) => { map[m] = arr; });
    setQuarterSchedules(map);
  }, [cityId, month, year, token]);

  const refetch = useCallback(async () => {
    await fetchSchedule();
    await fetchQuarterSchedules();
  }, [fetchSchedule, fetchQuarterSchedules]);

  useEffect(() => {
    loadEmployees();
    loadRoutes();
    loadLabels();
    fetchSchedule();
    fetchQuarterSchedules();
  }, [loadEmployees, loadRoutes, loadLabels, fetchSchedule, fetchQuarterSchedules]);

  return {
    employees,
    routes,
    labels,
    schedules,
    quarterSchedules,
    refetch,
  };
}
