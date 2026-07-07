// Warstwa dostępu do API grafiku. Każda funkcja przyjmuje token jawnie,
// żeby była łatwo testowalna i niezależna od komponentów.

const authHeaders = (token) => ({ Authorization: `Bearer ${token}` });
const jsonHeaders = (token) => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`,
});

const asArray = (data) => (Array.isArray(data) ? data : []);

const hasSegments = (r) => {
  let wh = r.working_hours;
  if (typeof wh === 'string') {
    try {
      wh = JSON.parse(wh);
    } catch (e) {
      return false;
    }
  }
  return wh && Array.isArray(wh.segments) && wh.segments.length > 0;
};

export async function fetchEmployees(cityId, token) {
  const res = await fetch(`/api/employees/city/${cityId}`, {
    headers: authHeaders(token),
    cache: 'no-store',
  });
  return asArray(await res.json());
}

export async function fetchRoutes(cityId, token) {
  const res = await fetch(`/api/routes/city/${cityId}`, {
    headers: authHeaders(token),
    cache: 'no-store',
  });
  return asArray(await res.json()).filter(hasSegments);
}

export async function fetchLabels(token) {
  const res = await fetch(`/api/labels`, {
    headers: authHeaders(token),
    cache: 'no-store',
  });
  return asArray(await res.json());
}

export async function fetchScheduleMonth(cityId, month, year, token) {
  const res = await fetch(
    `/api/schedule/city/${cityId}?month=${month}&year=${year}`,
    { headers: authHeaders(token), cache: 'no-store' }
  );
  return asArray(await res.json());
}

// Wspólny PUT komórki grafiku (trasa lub etykieta). Rzuca z komunikatem przy błędzie.
export async function updateCell(body, token) {
  const res = await fetch(`/api/schedule/update-cell`, {
    method: 'PUT',
    headers: jsonHeaders(token),
    cache: 'no-store',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      msg = data.message || msg;
    } catch {
      // brak treści błędu
    }
    throw new Error(msg);
  }
}

export async function deleteScheduleEntry(scheduleId, token) {
  if (!scheduleId) return;
  const res = await fetch(`/api/schedule/${scheduleId}`, {
    method: 'DELETE',
    headers: authHeaders(token),
    cache: 'no-store',
  });
  if (!res.ok && res.status !== 204) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      msg = data.message || data.error || msg;
    } catch {
      // brak treści błędu
    }
    throw new Error(msg);
  }
}

// Akcje zwracające { ok, status, data } — sterowanie przepływem robi wywołujący.
export async function clearMonth(cityId, month, year, token) {
  const res = await fetch(
    `/api/schedule/city/${cityId}/month?month=${month}&year=${year}`,
    { method: 'DELETE', headers: authHeaders(token), cache: 'no-store' }
  );
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function autoFillMonth(cityId, month, year, token) {
  const res = await fetch(
    `/api/schedule/city/${cityId}/auto-fill?month=${month}&year=${year}`,
    { method: 'POST', headers: authHeaders(token), cache: 'no-store' }
  );
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function assignMonth(cityId, month, year, body, token) {
  const res = await fetch(
    `/api/schedule/city/${cityId}/assign-month?month=${month}&year=${year}`,
    {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify(body),
      cache: 'no-store',
    }
  );
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function fetchNotificationDetail(id, token) {
  const res = await fetch(`/api/notifications/${id}`, {
    headers: authHeaders(token),
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.notification || null;
}
