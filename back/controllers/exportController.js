const { Op } = require('sequelize');
const {
  User,
  City,
  Employee,
  Route,
  RouteDay,
  Schedule,
  Label,
} = require('../models');

const parseWorkingHours = (wh) => {
  if (!wh) return null;
  if (typeof wh === 'object') return wh;
  try {
    return JSON.parse(wh);
  } catch {
    return null;
  }
};

const routeDurationHours = (route) => {
  const wh = parseWorkingHours(route.working_hours);
  if (!wh?.segments?.length) return 0;
  let totalMinutes = 0;
  wh.segments.forEach((seg) => {
    const [startH, startM] = seg.start.split(':').map(Number);
    const [endH, endM] = seg.end.split(':').map(Number);
    let startMinutes = startH * 60 + startM;
    let endMinutes = endH * 60 + endM;
    if (endMinutes < startMinutes) endMinutes += 24 * 60;
    totalMinutes += endMinutes - startMinutes;
  });
  return Math.round((totalMinutes / 60) * 100) / 100;
};

const DAY_NAMES = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];

const buildPodsumowanie = ({
  cities,
  employees,
  routes,
  schedules,
  labels,
}) => {
  const routeById = Object.fromEntries(routes.map((r) => [r.id, r]));
  const labelByCode = Object.fromEntries(labels.map((l) => [l.code, l]));
  const employeeById = Object.fromEntries(employees.map((e) => [e.id, e]));

  const wpisyTrasy = schedules.filter((s) => s.route_id);
  const wpisyEtykiety = schedules.filter((s) => s.label);

  const licznikEtykiet = {};
  const licznikTras = {};
  const licznikPracownikow = {};
  const godzinyPerPracownik = {};
  const dniTygodniaTrasy = {};

  schedules.forEach((s) => {
    const empKey = s.employee_id ?? 'brak';
    licznikPracownikow[empKey] = (licznikPracownikow[empKey] || 0) + 1;

    if (s.label) {
      licznikEtykiet[s.label] = (licznikEtykiet[s.label] || 0) + 1;
      const lbl = labelByCode[s.label];
      const emp = employeeById[s.employee_id];
      const pt = emp?.part_time ?? 1;
      if (lbl?.default_hours) {
        godzinyPerPracownik[s.employee_id] =
          (godzinyPerPracownik[s.employee_id] || 0) + lbl.default_hours * pt;
      }
    }

    if (s.route_id) {
      licznikTras[s.route_id] = (licznikTras[s.route_id] || 0) + 1;
      const route = routeById[s.route_id];
      if (route) {
        godzinyPerPracownik[s.employee_id] =
          (godzinyPerPracownik[s.employee_id] || 0) + routeDurationHours(route);
      }
      const d = new Date(s.date);
      const dow = DAY_NAMES[d.getDay()];
      dniTygodniaTrasy[dow] = (dniTygodniaTrasy[dow] || 0) + 1;
    }
  });

  const daty = schedules.map((s) => s.date).filter(Boolean).sort();
  const trasyPowiazane = routes.filter(
    (r) => r.linked_route_id != null || routes.some((x) => x.linked_route_id === r.id)
  );

  const topEtykiety = Object.entries(licznikEtykiet)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([kod, liczba]) => ({
      kod,
      opis: labelByCode[kod]?.description || null,
      liczba_wpisow: liczba,
    }));

  const topTrasy = Object.entries(licznikTras)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, liczba]) => ({
      route_id: Number(id),
      nazwa: routeById[id]?.name || `Trasa #${id}`,
      liczba_wpisow: liczba,
    }));

  const topPracownicy = Object.entries(licznikPracownikow)
    .filter(([id]) => id !== 'brak')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, liczba]) => {
      const emp = employeeById[Number(id)];
      return {
        employee_id: Number(id),
        imie_nazwisko: emp ? `${emp.first_name} ${emp.last_name}` : `#${id}`,
        liczba_wpisow: liczba,
        szacowane_godziny_z_grafiku: Math.round((godzinyPerPracownik[id] || 0) * 100) / 100,
        czesc_etatu: emp?.part_time ?? null,
      };
    });

  return {
    opis:
      'Sekcja pomocnicza do analizy — pokazuje, jak użytkownik korzysta z aplikacji (skala, etykiety, trasy, obciążenie).',
    liczba_miast: cities.length,
    liczba_pracownikow: employees.length,
    liczba_tras: routes.length,
    liczba_tras_powiazanych_par: trasyPowiazane.length,
    liczba_etykiet: labels.length,
    liczba_wpisow_grafiku: schedules.length,
    wpisy_trasa: wpisyTrasy.length,
    wpisy_etykieta: wpisyEtykiety.length,
    zakres_dat_grafiku:
      daty.length > 0 ? { od: daty[0], do: daty[daty.length - 1] } : null,
    najczestsze_etykiety: topEtykiety,
    najczestsze_trasy: topTrasy,
    najaktywniejsi_pracownicy: topPracownicy,
    rozklad_wpisow_po_dniu_tygodnia: dniTygodniaTrasy,
    srednia_czesc_etatu:
      employees.length > 0
        ? Math.round(
            (employees.reduce((s, e) => s + (e.part_time ?? 1), 0) / employees.length) * 100
          ) / 100
        : null,
  };
};

const serializeRoute = (route, routeDaysByRouteId) => ({
  id: route.id,
  nazwa: route.name,
  wymagana_kategoria_prawa_jazdy: route.required_license_category || 'B',
  main_city_id: route.main_city_id,
  additional_city_id: route.additional_city_id,
  linked_route_id: route.linked_route_id,
  godziny_pracy: parseWorkingHours(route.working_hours),
  czas_trwania_godz: routeDurationHours(route),
  dni_tygodnia_trasy: (routeDaysByRouteId[route.id] || []).map((d) => {
    const DOW_ROUTE = ['', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'];
    return {
      day_of_week: d.day_of_week,
      nazwa: DOW_ROUTE[d.day_of_week] || `dzień ${d.day_of_week}`,
    };
  }),
});

const serializeSchedule = (s, employeeById, routeById) => ({
  id: s.id,
  data: s.date,
  employee_id: s.employee_id,
  pracownik: (() => {
    const e = employeeById[s.employee_id];
    return e ? `${e.first_name} ${e.last_name}` : null;
  })(),
  route_id: s.route_id,
  trasa: s.route_id ? routeById[s.route_id]?.name || null : null,
  label: s.label,
  assignment_type: s.assignment_type,
  worked_hours: s.worked_hours,
});

exports.exportUserData = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findByPk(userId, {
      attributes: ['id', 'first_name', 'last_name', 'email'],
    });
    if (!user) {
      return res.status(404).json({ message: 'Użytkownik nie znaleziony.' });
    }

    const [cities, employees, routes, schedules, labels] = await Promise.all([
      City.findAll({ where: { user_id: userId }, raw: true }),
      Employee.findAll({ where: { user_id: userId }, raw: true }),
      Route.findAll({ where: { user_id: userId }, raw: true }),
      Schedule.findAll({ where: { user_id: userId }, raw: true, order: [['date', 'ASC']] }),
      Label ? Label.findAll({ where: { user_id: userId }, raw: true }) : [],
    ]);

    const routeIds = routes.map((r) => r.id);
    const routeDays =
      routeIds.length > 0
        ? await RouteDay.findAll({
            where: { route_id: { [Op.in]: routeIds } },
            raw: true,
          })
        : [];

    const routeDaysByRouteId = routeDays.reduce((acc, rd) => {
      if (!acc[rd.route_id]) acc[rd.route_id] = [];
      acc[rd.route_id].push(rd);
      return acc;
    }, {});

    const employeeById = Object.fromEntries(employees.map((e) => [e.id, e]));
    const routeById = Object.fromEntries(routes.map((r) => [r.id, r]));

    const cityIds = new Set(cities.map((c) => c.id));

    const miasta = cities.map((city) => {
      const pracownicyMiasta = employees
        .filter((e) => e.city_id === city.id)
        .map((e) => ({
          id: e.id,
          imie: e.first_name,
          nazwisko: e.last_name,
          czesc_etatu: e.part_time,
          kategoria_prawa_jazdy: e.license_category,
          grafik: schedules
            .filter((s) => s.employee_id === e.id)
            .map((s) => serializeSchedule(s, employeeById, routeById)),
        }));

      const trasyMiasta = routes
        .filter((r) => r.main_city_id === city.id)
        .map((r) => ({
          ...serializeRoute(r, routeDaysByRouteId),
          grafik: schedules
            .filter((s) => s.route_id === r.id)
            .map((s) => serializeSchedule(s, employeeById, routeById)),
        }));

      return {
        id: city.id,
        nazwa: city.name,
        pracownicy: pracownicyMiasta,
        trasy: trasyMiasta,
      };
    });

    const podsumowanie = buildPodsumowanie({
      cities,
      employees,
      routes,
      schedules,
      labels,
    });

    const payload = {
      meta: {
        aplikacja: 'Grafik',
        wersja_eksportu: '1.0',
        wyeksportowano: new Date().toISOString(),
        format: 'JSON — czytelny dla człowieka i narzędzi analitycznych',
        uwaga: 'Plik nie zawiera haseł ani tokenów. Przechowuj bezpiecznie (dane osobowe pracowników).',
      },
      uzytkownik: {
        id: user.id,
        imie: user.first_name,
        nazwisko: user.last_name,
        email: user.email,
      },
      podsumowanie,
      etykiety: labels.map((l) => ({
        kod: l.code,
        domyslne_godziny: l.default_hours,
        opis: l.description,
      })),
      miasta,
      dane_surowe: {
        opis: 'Płaskie listy — wygodne do skryptów; struktura zagnieżżona w polu "miasta".',
        miasta: cities,
        pracownicy: employees.map((e) => ({
          ...e,
          miasto_nazwa: cities.find((c) => c.id === e.city_id)?.name || null,
        })),
        trasy: routes.map((r) => serializeRoute(r, routeDaysByRouteId)),
        grafik: schedules.map((s) => serializeSchedule(s, employeeById, routeById)),
        route_days: routeDays,
      },
      pracownicy_poza_miastami_uzytkownika: employees
        .filter((e) => !cityIds.has(e.city_id))
        .map((e) => ({ id: e.id, city_id: e.city_id, imie: e.first_name, nazwisko: e.last_name })),
    };

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="grafik-export-${userId}-${new Date().toISOString().slice(0, 10)}.json"`
    );
    return res.send(JSON.stringify(payload, null, 2));
  } catch (error) {
    console.error('Błąd eksportu danych użytkownika:', error);
    return res.status(500).json({
      message: 'Błąd podczas eksportu danych.',
      error: error.message,
    });
  }
};
