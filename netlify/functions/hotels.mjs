/* Live hotel search & booking via Duffel Stays. Same safety model as
   flights: token stays server-side, test tokens book the sandbox, live
   bookings need DUFFEL_ALLOW_LIVE=true. Without a token the app falls
   back to its comparison deep links. */
import { duffel, geocode, clip, token, mode, bookingAllowed, fail } from './lib/duffel.mjs';

const money = (r) => ({ price: r.total_amount, currency: r.total_currency });

export default async (req) => {
  if (req.method === 'GET') return Response.json({ live: !!token(), mode: token() ? mode() : null });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!token()) return Response.json({ error: 'hotels_not_configured' }, { status: 503 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'bad_request' }, { status: 400 }); }

  try {
    if (body.action === 'search') {
      const dates = [clip(body.checkIn, 10), clip(body.checkOut, 10)];
      if (!dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) return Response.json({ error: 'bad_dates' }, { status: 400 });
      const place = await geocode(body.city);
      const guests = Math.min(Math.max(parseInt(body.guests, 10) || 2, 1), 8);
      const { data } = await duffel('/stays/search', {
        method: 'POST',
        body: {
          data: {
            check_in_date: dates[0],
            check_out_date: dates[1],
            rooms: Math.min(Math.max(parseInt(body.rooms, 10) || 1, 1), 4),
            guests: Array.from({ length: guests }, () => ({ type: 'adult' })),
            location: { radius: 8, geographic_coordinates: { latitude: place.lat, longitude: place.lon } },
          },
        },
      });
      const results = (data.results || [])
        .filter((r) => r.cheapest_rate_total_amount)
        .sort((a, b) => parseFloat(a.cheapest_rate_total_amount) - parseFloat(b.cheapest_rate_total_amount))
        .slice(0, 5)
        .map((r) => ({
          id: r.id,
          name: r.accommodation?.name || 'Hotel',
          rating: r.accommodation?.rating || null,
          review: r.accommodation?.review_score || null,
          address: [r.accommodation?.location?.address?.line_one, r.accommodation?.location?.address?.city_name].filter(Boolean).join(', '),
          price: r.cheapest_rate_total_amount,
          currency: r.cheapest_rate_currency,
        }));
      return Response.json({ mode: mode(), city: place.name, results });
    }

    if (body.action === 'rates') {
      const { data } = await duffel(`/stays/search_results/${clip(body.resultId, 60)}/actions/fetch_all_rates`, { method: 'POST' });
      const rates = [];
      for (const room of data.accommodation?.rooms || []) {
        for (const rate of room.rates || []) {
          rates.push({
            id: rate.id,
            room: room.name || 'Room',
            board: rate.board_type ? rate.board_type.replace(/_/g, ' ') : 'room only',
            refundable: !!(rate.cancellation_timeline || []).some((c) => parseFloat(c.refund_amount) > 0),
            ...money(rate),
          });
        }
      }
      rates.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
      return Response.json({ mode: mode(), hotel: data.accommodation?.name, rates: rates.slice(0, 5) });
    }

    if (body.action === 'book') {
      if (!bookingAllowed()) return Response.json({ error: 'live_booking_disabled' }, { status: 403 });
      const g = body.guest || {};
      const missing = ['given_name', 'family_name', 'email', 'phone_number'].filter((k) => !g[k]);
      if (missing.length) return Response.json({ error: `missing: ${missing.join(', ')}` }, { status: 400 });

      const quote = await duffel('/stays/quotes', { method: 'POST', body: { data: { rate_id: clip(body.rateId, 60) } } });
      const q = quote.data;
      const booking = await duffel('/stays/bookings', {
        method: 'POST',
        body: {
          data: {
            quote_id: q.id,
            guests: [{ given_name: clip(g.given_name, 40), family_name: clip(g.family_name, 40) }],
            email: clip(g.email, 120),
            phone_number: clip(g.phone_number, 24),
          },
        },
      });
      const b = booking.data;
      return Response.json({
        mode: mode(),
        reference: b.reference || b.id,
        bookingId: b.id,
        hotel: b.accommodation?.name || body.hotel || 'Hotel',
        checkIn: b.check_in_date,
        checkOut: b.check_out_date,
        price: q.total_amount,
        currency: q.total_currency,
      });
    }

    return Response.json({ error: 'bad_action' }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
};

export const config = { path: '/api/hotels' };
