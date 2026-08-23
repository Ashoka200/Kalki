/* Venue lookup — finds a clinic's or restaurant's real phone number,
   address and website so a booking request can actually reach them.
   Uses OpenStreetMap's Nominatim: free, keyless, CORS-enabled. Offline or
   on a miss, the booking flow simply falls back to search links. */

const enc = encodeURIComponent;
const CACHE_KEY = 'venueCache';

/** { name, address, phone, website, mapUrl } or null. */
export async function lookupVenue(name, area = '') {
  const q = `${name} ${area}`.trim();
  if (q.length < 3) return null;

  // Small on-device cache: venues rarely move, and Nominatim asks for
  // light usage (max ~1 req/sec).
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem('kalki.' + CACHE_KEY) || '{}'); } catch { cache = {}; }
  if (cache[q] !== undefined) return cache[q];

  let hit = null;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${enc(q)}&format=json&extratags=1&addressdetails=1&limit=1`);
    if (res.ok) {
      const [r] = await res.json();
      if (r) {
        const x = r.extratags || {};
        hit = {
          name: r.name || name,
          address: (r.display_name || '').split(',').slice(0, 4).join(',').trim(),
          phone: (x.phone || x['contact:phone'] || '').split(';')[0].trim() || null,
          website: x.website || x['contact:website'] || null,
          mapUrl: `https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lon}#map=18/${r.lat}/${r.lon}`,
        };
      }
    }
  } catch { /* offline — fall through to null */ }

  try {
    cache[q] = hit;
    const keys = Object.keys(cache);
    if (keys.length > 40) delete cache[keys[0]];
    localStorage.setItem('kalki.' + CACHE_KEY, JSON.stringify(cache));
  } catch { /* quota — skip caching */ }
  return hit;
}

/** Digits-only phone for tel:/wa.me links. */
const dialable = (phone) => (phone || '').replace(/[^\d+]/g, '');

/** The message actually sent to the venue. */
export function requestMessage({ what, when, place, party, name, phone }) {
  const lines = [
    `Hi${place ? ` ${place}` : ''}, I'd like to book ${what} on ${when}.`,
    party ? `Party size: ${party}` : null,
    name ? `Name: ${name}` : null,
    phone ? `Phone: ${phone}` : null,
    'Could you please confirm availability? Thank you.',
  ].filter(Boolean);
  return lines.join('\n');
}

/** One-tap contact cards for a booking request. */
export function contactCards(venue, msg, subject) {
  const cards = [];
  const tel = dialable(venue?.phone);
  if (tel) {
    cards.push({ t: `📞 Call ${venue.name}`, s: venue.phone, url: `tel:${tel}` });
    cards.push({ t: '💬 WhatsApp the request', s: 'Message is pre-written', url: `https://wa.me/${tel.replace(/^\+/, '')}?text=${enc(msg)}` });
    cards.push({ t: '💬 Text the request', s: 'Opens your SMS app', url: `sms:${tel}?&body=${enc(msg)}` });
  }
  if (venue?.website) cards.push({ t: '🌐 Book on their site', s: venue.website.replace(/^https?:\/\//, '').slice(0, 40), url: venue.website });
  cards.push({ t: '✉️ Email the request', s: 'Opens your mail app', url: `mailto:?subject=${enc(subject)}&body=${enc(msg)}` });
  return cards;
}
