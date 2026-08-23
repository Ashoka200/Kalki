/* Live flight search & booking client. Talks only to Kalki's own
   /api/flights function — the Duffel token never reaches the browser.
   When the backend isn't configured (or we're offline), capability()
   reports false and the flight skill keeps its deep links. */

const API = 'api/flights';
let cached = null;

export async function capability() {
  if (cached) return cached;
  try {
    const res = await fetch(API);
    cached = res.ok ? await res.json() : { live: false };
  } catch {
    cached = { live: false };
  }
  return cached;
}

async function post(body) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Search failed (${res.status})`);
  return data;
}

export const search = (params) => post({ action: 'search', ...params });
export const book = (params) => post({ action: 'book', ...params });

const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Offer → chat card with a Book action. */
export function offerCard(o, i) {
  const stops = o.stops === 0 ? 'nonstop' : `${o.stops} stop${o.stops > 1 ? 's' : ''}`;
  return {
    t: `${i + 1}. ${o.airline} — ${o.currency} ${o.price}`,
    s: `${time(o.departs)} → ${time(o.arrives)} · ${o.duration} · ${stops}`,
    act: `book flight ${i + 1}`,
    actLabel: 'Book',
  };
}
