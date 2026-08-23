/* Live hotel search & booking client — talks only to Kalki's own
   /api/hotels function. Falls back silently when not configured. */

const API = 'api/hotels';
let cached = null;

export async function capability() {
  if (cached) return cached;
  try {
    const res = await fetch(API);
    cached = res.ok ? await res.json() : { live: false };
  } catch { cached = { live: false }; }
  return cached;
}

async function post(body) {
  const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Hotel lookup failed (${res.status})`);
  return data;
}

export const search = (p) => post({ action: 'search', ...p });
export const rates = (resultId) => post({ action: 'rates', resultId });
export const book = (p) => post({ action: 'book', ...p });

export function hotelCard(h, i) {
  const stars = h.rating ? ' ' + '★'.repeat(Math.min(5, Math.round(h.rating))) : '';
  return {
    t: `${i + 1}. ${h.name}${stars} — ${h.currency} ${h.price}`,
    s: [h.address, h.review ? `guest score ${h.review}` : null].filter(Boolean).join(' · ') || 'total for your stay',
    act: `rates ${i + 1}`,
    actLabel: 'Rooms',
  };
}

export function rateCard(r, i) {
  return {
    t: `${i + 1}. ${r.room} — ${r.currency} ${r.price}`,
    s: `${r.board}${r.refundable ? ' · free cancellation' : ' · non-refundable'}`,
    act: `book room ${i + 1}`,
    actLabel: 'Book',
  };
}
