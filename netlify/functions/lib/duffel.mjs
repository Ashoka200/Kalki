/* Shared Duffel client + safety rules for the flight and hotel functions.
   Lives in lib/ so Netlify doesn't publish it as its own endpoint. */

const API = 'https://api.duffel.com';

export const clip = (s, n) => String(s ?? '').slice(0, n);
export const token = () => process.env.DUFFEL_TOKEN;
export const isTest = (t = token()) => /^duffel_test_/.test(t || '');
export const mode = () => (isTest() ? 'test' : 'live');

/** True when a real-money booking is allowed. Live tokens need an explicit
    opt-in so a genuine purchase can never happen by accident. */
export const bookingAllowed = () => isTest() || process.env.DUFFEL_ALLOW_LIVE === 'true';

export async function duffel(path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Duffel-Version': 'v2',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const e = json?.errors?.[0];
    throw Object.assign(new Error(e ? `${e.title}: ${e.message}` : `Duffel error ${res.status}`), { status: res.status });
  }
  return json;
}

/** City name → coordinates, via Open-Meteo's free keyless geocoder. */
export async function geocode(place) {
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(clip(place, 60))}&count=1&language=en&format=json`);
  const { results } = await res.json();
  const hit = results?.[0];
  if (!hit) throw new Error(`I couldn’t find a place called “${place}”.`);
  return { lat: hit.latitude, lon: hit.longitude, name: hit.name, country: hit.country_code };
}

/** Standard JSON error response with Duffel's own message preserved. */
export const fail = (e) => Response.json({ error: e.message || 'duffel_error' }, { status: e.status === 400 ? 400 : 502 });
