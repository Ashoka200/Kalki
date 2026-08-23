/* Live flight search + booking via Duffel.

   The Duffel token is a secret and stays server-side: set DUFFEL_TOKEN on
   the site. A test token (duffel_test_…) books against Duffel's sandbox —
   real API, real airline data, no money and no ticket. Booking with a LIVE
   token is refused unless DUFFEL_ALLOW_LIVE=true is also set, so a real
   purchase can never happen by accident.

   Without a token the endpoint reports live:false and the app falls back
   to its existing deep links. */

const API = 'https://api.duffel.com';
const clip = (s, n) => String(s ?? '').slice(0, n);

const isTest = (tok) => /^duffel_test_/.test(tok || '');

async function duffel(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Duffel-Version': 'v2',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    // Surface Duffel's own message — it names the exact offending field.
    const e = json?.errors?.[0];
    throw Object.assign(new Error(e ? `${e.title}: ${e.message}` : `Duffel error ${res.status}`), { status: res.status });
  }
  return json;
}

/** "Las Vegas" → "LAS". Passes through anything already an IATA code. */
async function toIata(place, token) {
  const p = clip(place, 60).trim();
  if (/^[A-Za-z]{3}$/.test(p)) return p.toUpperCase();
  const { data } = await duffel(`/places/suggestions?query=${encodeURIComponent(p)}`, { token });
  const hit = (data || []).find((d) => d.iata_code);
  if (!hit) throw new Error(`I couldn’t find an airport for “${p}”.`);
  return hit.iata_code;
}

const mins = (iso8601) => {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(iso8601 || '') || [];
  return (+(m[1] || 0) * 1440) + (+(m[2] || 0) * 60) + +(m[3] || 0);
};
const fmtDur = (d) => `${Math.floor(d / 60)}h ${d % 60}m`;

function simplify(offer) {
  const slice = offer.slices?.[0] || {};
  const segs = slice.segments || [];
  const first = segs[0] || {};
  const last = segs[segs.length - 1] || {};
  return {
    id: offer.id,
    price: offer.total_amount,
    currency: offer.total_currency,
    airline: offer.owner?.name || first.marketing_carrier?.name || 'Airline',
    from: first.origin?.iata_code,
    to: last.destination?.iata_code,
    departs: first.departing_at,
    arrives: last.arriving_at,
    duration: fmtDur(mins(slice.duration)),
    stops: Math.max(0, segs.length - 1),
    passengerIds: (offer.passengers || []).map((p) => p.id),
  };
}

export default async (req) => {
  const token = process.env.DUFFEL_TOKEN;
  const live = !!token;
  const mode = isTest(token) ? 'test' : 'live';

  if (req.method === 'GET') return Response.json({ live, mode: live ? mode : null });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!live) return Response.json({ error: 'flights_not_configured' }, { status: 503 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'bad_request' }, { status: 400 }); }

  try {
    if (body.action === 'search') {
      const [origin, destination] = await Promise.all([toIata(body.from, token), toIata(body.to, token)]);
      const date = clip(body.date, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ error: 'bad_date' }, { status: 400 });
      const count = Math.min(Math.max(parseInt(body.passengers, 10) || 1, 1), 6);
      const slices = [{ origin, destination, departure_date: date }];
      if (/^\d{4}-\d{2}-\d{2}$/.test(clip(body.returnDate, 10))) {
        slices.push({ origin: destination, destination: origin, departure_date: clip(body.returnDate, 10) });
      }
      const { data } = await duffel('/air/offer_requests?return_offers=true&supplier_timeout=20000', {
        token, method: 'POST',
        body: { data: { slices, passengers: Array.from({ length: count }, () => ({ type: 'adult' })), cabin_class: clip(body.cabin, 20) || 'economy' } },
      });
      const offers = (data.offers || [])
        .sort((a, b) => parseFloat(a.total_amount) - parseFloat(b.total_amount))
        .slice(0, 5)
        .map(simplify);
      return Response.json({ mode, origin, destination, offers });
    }

    if (body.action === 'book') {
      if (mode === 'live' && process.env.DUFFEL_ALLOW_LIVE !== 'true') {
        return Response.json({ error: 'live_booking_disabled' }, { status: 403 });
      }
      const p = body.passenger || {};
      const required = ['given_name', 'family_name', 'born_on', 'email', 'phone_number'];
      const missing = required.filter((k) => !p[k]);
      if (missing.length) return Response.json({ error: `missing: ${missing.join(', ')}` }, { status: 400 });

      const { data } = await duffel('/air/orders', {
        token, method: 'POST',
        body: {
          data: {
            type: 'instant',
            selected_offers: [clip(body.offerId, 60)],
            passengers: (body.passengerIds || []).map((id) => ({
              id,
              title: clip(p.title, 8) || 'mr',
              gender: clip(p.gender, 1) || 'm',
              given_name: clip(p.given_name, 40),
              family_name: clip(p.family_name, 40),
              born_on: clip(p.born_on, 10),
              email: clip(p.email, 120),
              phone_number: clip(p.phone_number, 24),
            })),
            payments: [{ type: 'balance', amount: clip(body.amount, 16), currency: clip(body.currency, 3) }],
          },
        },
      });
      return Response.json({ mode, reference: data.booking_reference, orderId: data.id });
    }

    return Response.json({ error: 'bad_action' }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e.message || 'flight_error' }, { status: e.status === 400 ? 400 : 502 });
  }
};

export const config = { path: '/api/flights' };
