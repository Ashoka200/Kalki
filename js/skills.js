/* Skills: what Kalki can actually do. Each skill declares the slots it needs
   (with extractors for free-text and parsers for direct answers) and a
   finish() that produces the reply. Deal-finders build pre-filled deep links
   into the big marketplaces — no accounts, no API keys, nothing leaves the
   device until the user taps a link. */
import { store } from './store.js';
import * as nlu from './nlu.js';

const enc = encodeURIComponent;
const slug = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');
const money = (n) => '$' + n.toLocaleString('en-US');
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* Dynamic-pricing sites fingerprint repeat searches; every deal reply
   carries this warning and cards get a ⧉ copy button for pasting links
   into a private window. */
const PRIVACY_TIP = '\n\n🕵️ **Open links in a private/incognito window** — these sites track repeat searches and quietly raise prices. Tap ⧉ to copy a link, then paste it in incognito.';

export const iconFor = (kind) => ({ appointment: '🏥', reservation: '🍽️', court: '🎾' }[kind] || '📌');

/* ---------- saved bookings & reminders ---------- */

export function listBookings() {
  return store.get('bookings', []).sort((a, b) => a.when.localeCompare(b.when));
}
export function addBooking(b) {
  const all = store.get('bookings', []);
  b.id = Date.now().toString(36);
  all.push(b);
  store.set('bookings', all);
  return b;
}
export function removeBooking(id) {
  store.set('bookings', store.get('bookings', []).filter((b) => b.id !== id));
}

export function listReminders() {
  return store.get('reminders', []).sort((a, b) => a.when.localeCompare(b.when));
}
export function addReminder(text, whenISO) {
  const all = store.get('reminders', []);
  const r = { id: Date.now().toString(36), text, when: whenISO };
  all.push(r);
  store.set('reminders', all);
  return r;
}
export function removeReminder(id) {
  store.set('reminders', store.get('reminders', []).filter((r) => r.id !== id));
}
/** Reminders that are due; removes them from the store. */
export function popDueReminders(now = new Date()) {
  const all = store.get('reminders', []);
  const due = all.filter((r) => new Date(r.when) <= now);
  if (due.length) store.set('reminders', all.filter((r) => new Date(r.when) > now));
  return due;
}

/* ---------- calendar export ---------- */

const icsStamp = (d) =>
  d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') +
  'T' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + '00';

export function buildICS(booking) {
  const start = new Date(booking.when);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kalki//EN', 'BEGIN:VEVENT',
    `UID:${booking.id}@kalki`, `DTSTAMP:${icsStamp(new Date(booking.when))}`,
    `DTSTART:${icsStamp(start)}`, `DTEND:${icsStamp(end)}`,
    `SUMMARY:${booking.title}`, booking.place ? `LOCATION:${booking.place}` : '',
    'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
}

export function fmtWhen(iso) {
  return new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/* ---------- slot helpers ---------- */

const textSlot = (name, q) => ({
  name, q,
  extract: () => null,
  parse: (t) => (t.trim().length > 1 ? t.trim() : null),
});
const dateSlot = { name: 'date', q: 'What day? (e.g. tomorrow, Friday, Aug 3)', extract: nlu.parseDate, parse: nlu.parseDate };
const timeSlot = { name: 'time', q: 'What time? (e.g. 10am, 5:30 pm)', extract: nlu.parseTime, parse: nlu.parseTime };

function combine(date, time) {
  const d = new Date(date);
  d.setHours(time.h, time.m, 0, 0);
  return d.toISOString();
}

/* ---------- the skills ---------- */

export const SKILLS = {

  rent: {
    intro: 'Let’s find you a rental deal. 🏠',
    slots: [
      { name: 'city', q: 'Which city or area should I search?', extract: nlu.extractCity,
        parse: (t) => (t.trim().length > 1 ? t.trim() : null), profileKey: 'city' },
      { name: 'budget', q: 'Max monthly rent? (e.g. $1,500 — or say "skip")', extract: nlu.extractMoney, parse: nlu.parseMoney, optional: true },
      { name: 'beds', q: 'How many bedrooms? (studio, 1, 2… — or "skip")', extract: nlu.extractBeds,
        parse: (t) => nlu.extractBeds(t) ?? (/^\d+$/.test(t.trim()) ? +t.trim() : null), optional: true },
    ],
    finish(s) {
      const bedTxt = s.beds == null ? '' : s.beds === 0 ? ' studio' : ` ${s.beds}-bed`;
      const budTxt = s.budget ? ` under ${money(s.budget)}/mo` : '';
      const q = `${s.beds === 0 ? 'studio' : s.beds ? s.beds + ' bedroom' : ''} apartments for rent ${s.city}`.trim();
      return {
        text: `Here’s everywhere worth checking for${bedTxt} rentals in **${s.city}**${budTxt}.\n\n💰 Deal tips: listings drop 3–5% Nov–Feb, ask for one month free on 12+ month leases, look for “move-in special” filters, and always counter the first quote.${PRIVACY_TIP}`,
        cards: [
          { t: 'Zillow Rentals', s: 'Largest inventory, price cuts flagged', url: `https://www.zillow.com/homes/for_rent/${enc(s.city)}_rb/` },
          { t: 'Apartments.com', s: 'Filter by move-in specials', url: `https://www.apartments.com/${slug(s.city)}/` },
          { t: 'HotPads', s: 'Map-first search, price history', url: `https://hotpads.com/${slug(s.city)}/apartments-for-rent` },
          { t: 'Facebook Marketplace', s: 'Private landlords, negotiable prices', url: `https://www.facebook.com/marketplace/search/?query=${enc(q)}` },
        ],
        chips: ['Remind me to follow up tomorrow', 'Find shopping deals', 'Help'],
      };
    },
  },

  hotel: {
    intro: 'Hunting hotel deals. 🏨',
    slots: [
      { name: 'city', q: 'Which city are you staying in?', extract: nlu.extractCity,
        parse: (t) => (t.trim().length > 1 ? t.trim() : null) },
      { ...dateSlot, name: 'checkin', q: 'Check-in date? (e.g. Friday, Aug 3)' },
      { name: 'nights', q: 'How many nights?', extract: nlu.extractNights,
        parse: (t) => nlu.extractNights(t) ?? (/^\d{1,2}$/.test(t.trim()) ? +t.trim() : null) },
      { name: 'guests', q: 'How many guests? (or "skip" for 2)', extract: nlu.extractPartySize,
        parse: (t) => (/^\d{1,2}$/.test(t.trim()) ? +t.trim() : nlu.extractPartySize(t)), optional: true },
    ],
    finish(s) {
      const out = new Date(s.checkin);
      out.setDate(out.getDate() + s.nights);
      const [ci, co, g] = [iso(s.checkin), iso(out), s.guests || 2];
      return {
        text: `Comparing **${s.city}** hotels, ${ci} → ${co}, ${g} guest${g > 1 ? 's' : ''}.\n\n💰 Discount checklist: compare here, then **call the hotel and ask them to beat the online price** (they save ~15% commission and often will). Stack AAA/AARP/military/corporate rates, loyalty sign-up perks (Booking Genius level 2 ≈ 10–15% off), and book refundable so you can rebook if the price drops.${PRIVACY_TIP}`,
        cards: [
          { t: 'Booking.com', s: 'Genius discounts, free cancellation filter', url: `https://www.booking.com/searchresults.html?ss=${enc(s.city)}&checkin=${ci}&checkout=${co}&group_adults=${g}` },
          { t: 'Google Hotels', s: 'Price graph shows cheap dates', url: `https://www.google.com/travel/hotels/${enc(s.city)}` },
          { t: 'Kayak', s: 'Aggregates all booking sites', url: `https://www.kayak.com/hotels/${enc(s.city)}/${ci}/${co}/${g}adults` },
          { t: 'Airbnb', s: 'Often cheaper for 3+ nights', url: `https://www.airbnb.com/s/${enc(s.city)}/homes?checkin=${ci}&checkout=${co}&adults=${g}` },
        ],
        chips: ['Find flights', 'Events near me', 'Remind me to book before prices rise'],
      };
    },
  },

  flight: {
    intro: 'Fare-hunting mode. ✈️',
    slots: [
      { name: 'from', q: 'Flying from which city?', extract: nlu.extractOrigin,
        parse: (t) => (t.trim().length > 1 ? t.trim() : null), profileKey: 'city' },
      { name: 'to', q: 'Flying to?', extract: nlu.extractDest,
        parse: (t) => (t.trim().length > 1 ? t.trim() : null) },
      { ...dateSlot, q: 'Departure date? (e.g. Aug 3, Friday)' },
      // extract off: a lone date in the message is the departure, not the return
      { ...dateSlot, name: 'return', q: 'Return date? (or "skip" for one-way)', extract: () => null, optional: true },
    ],
    finish(s) {
      const dep = iso(s.date);
      const ret = s.return ? iso(s.return) : null;
      const gq = `flights from ${s.from} to ${s.to} on ${dep}` + (ret ? ` returning ${ret}` : ' one way');
      return {
        text: `Searching **${s.from} → ${s.to}**, ${dep}${ret ? ` back ${ret}` : ' (one-way)'}.\n\n💰 Cheapest-fare checklist: set a **price alert** on Google Flights and wait for a dip; check ±3 days (Tue/Wed departures are cheapest); check nearby airports; look at budget carriers separately (Southwest never appears in aggregators); students get 10–30% off via StudentUniverse.${PRIVACY_TIP}`,
        cards: [
          { t: 'Google Flights', s: 'Best price graph + free alerts', url: `https://www.google.com/travel/flights?q=${enc(gq)}` },
          { t: 'Kayak', s: '±3 days flexible-date view', url: `https://www.kayak.com/flights/${enc(s.from)}-${enc(s.to)}/${dep}${ret ? '/' + ret : ''}` },
          { t: 'Skyscanner', s: '"Cheapest month" tool', url: 'https://www.skyscanner.com/' },
          { t: 'StudentUniverse', s: 'Student & under-26 fares', url: `https://www.studentuniverse.com/flights` },
        ],
        chips: ['Book a hotel', 'Remind me to check fares Friday', 'Help'],
      };
    },
  },

  events: {
    intro: 'Let’s see what’s on. 🎪',
    slots: [
      { name: 'city', q: 'Which city or area?', extract: nlu.extractCity,
        parse: (t) => (t.trim().length > 1 ? t.trim() : null), profileKey: 'city' },
      { name: 'kind', q: 'Any type in mind — music, food, art, comedy, festivals? (or "skip" for everything)',
        extract: nlu.extractEventKind, parse: nlu.extractEventKind, optional: true },
    ],
    finish(s) {
      const kind = s.kind ? s.kind + ' ' : '';
      return {
        text: `Here’s what’s happening in **${s.city}**${s.kind ? ` (${s.kind})` : ''} — festivals, concerts, fairs and more.\n\n💰 Free-and-cheap tricks: city festivals and cultural events are usually **free**; Eventbrite early-bird tiers save 20–40%; many events give free entry to volunteers; student/senior discounts are rarely advertised — always ask.`,
        cards: [
          { t: 'Google Events', s: 'Everything, filterable by date', url: `https://www.google.com/search?q=${enc(kind + 'events and festivals in ' + s.city)}&ibp=htl;events` },
          { t: 'Eventbrite', s: 'Local events, free filter', url: `https://www.eventbrite.com/d/${slug(s.city)}/${kind ? slug(kind) + '--' : ''}events/` },
          { t: 'AllEvents', s: 'Community festivals & fairs', url: `https://allevents.in/${slug(s.city)}` },
          { t: 'Songkick', s: 'Every concert, tour alerts', url: `https://www.songkick.com/search?query=${enc(s.city)}&type=upcoming` },
        ],
        chips: ['Reserve a table', 'Book a game court', 'Remind me about this weekend'],
      };
    },
  },

  court: {
    intro: 'Game on. 🎾',
    slots: [
      { name: 'sport', q: 'Which sport — tennis, badminton, basketball, pickleball…?',
        extract: nlu.extractSport, parse: (t) => nlu.extractSport(t) || (t.trim().length > 1 ? t.trim().toLowerCase() : null) },
      { name: 'area', q: 'Which area or city?', extract: nlu.extractCity,
        parse: (t) => (t.trim().length > 1 ? t.trim() : null), profileKey: 'city' },
      { ...dateSlot, q: 'When do you want to play? (or "skip" to just find courts)', optional: true },
      { ...timeSlot, q: 'What time? (or "skip")', optional: true, dependsOn: 'date' },
    ],
    finish(s, ctx) {
      let booked = '';
      const cards = [
        { t: 'Courts near you', s: 'Ratings, hours, phone numbers', url: `https://www.google.com/maps/search/${enc(s.sport + ' court near ' + s.area)}` },
        { t: 'Book online', s: 'Venues with online slot booking', url: `https://www.google.com/search?q=${enc('book ' + s.sport + ' court online ' + s.area)}` },
        { t: 'Public courts', s: 'Parks & rec — free or few $/hr', url: `https://www.google.com/search?q=${enc(s.area + ' parks and recreation ' + s.sport + ' court reservation')}` },
      ];
      if (s.date && s.time) {
        const when = combine(s.date, s.time);
        const b = addBooking({ kind: 'court', title: `${cap(s.sport)} game`, when, place: s.area });
        ctx.remindBefore(b);
        booked = `\nI’ve penciled in **${cap(s.sport)} — ${fmtWhen(when)}** and will remind you 24h before.`;
        cards.unshift({ t: 'Add to calendar', s: fmtWhen(when), ics: b.id });
      }
      return {
        text: `Finding **${s.sport}** courts around **${s.area}**.${booked}\n\n💰 Public park courts are free or nearly free; private venues drop rates 30–50% off-peak (weekday mornings/afternoons); monthly passes beat hourly if you play weekly.`,
        cards,
        chips: ['Show my bookings', 'Events near me', 'Help'],
      };
    },
  },

  shopping: {
    intro: 'Bargain hunt time. 🛍️',
    slots: [
      textSlot('item', 'What are you looking to buy?'),
      { name: 'budget', q: 'Max price? (or "skip")', extract: nlu.extractMoney, parse: nlu.parseMoney, optional: true },
    ],
    finish(s) {
      const cap = s.budget ? ` under ${money(s.budget)}` : '';
      return {
        text: `Price-hunting **${s.item}**${cap}. Compare across these before paying sticker price.\n\n💰 Stack the savings: price history first (“deals” above the 90-day average aren’t deals) → coupon code → cash-back portal (Rakuten/TopCashback) → discounted gift cards. Refurb/open-box knocks off another 20–40%.${PRIVACY_TIP}`,
        cards: [
          { t: 'Google Shopping', s: 'Compare every store at once', url: `https://www.google.com/search?tbm=shop&q=${enc(s.item)}` },
          { t: 'Slickdeals', s: 'Community-vetted discounts & coupons', url: `https://slickdeals.net/newsearch.php?q=${enc(s.item)}&searcharea=deals` },
          { t: 'CamelCamelCamel', s: 'Amazon price history & drop alerts', url: `https://camelcamelcamel.com/search?sq=${enc(s.item)}` },
          { t: 'Coupon codes', s: 'Active promo codes for this item', url: `https://www.google.com/search?q=${enc(s.item + ' coupon code promo')}` },
          { t: 'eBay', s: 'Refurb & open-box, often 20–40% off', url: `https://www.ebay.com/sch/i.html?_nkw=${enc(s.item)}` },
        ],
        chips: ['Find another deal', 'Remind me to check prices Friday', 'Help'],
      };
    },
  },

  insurance: {
    intro: 'Let’s compare health insurance properly. 🩺',
    slots: [
      { name: 'zip', q: 'What’s your ZIP code? (plans are priced by county)', extract: nlu.extractZip, parse: nlu.extractZip },
      { name: 'household', q: 'How many people need coverage? (or "skip")',
        extract: nlu.extractPartySize, parse: (t) => (/^\d{1,2}$/.test(t.trim()) ? +t.trim() : nlu.extractPartySize(t)), optional: true },
    ],
    finish(s) {
      const hh = s.household ? ` for ${s.household} ${s.household === 1 ? 'person' : 'people'}` : '';
      return {
        text: `Comparing marketplace plans near **${s.zip}**${hh}.\n\n💡 Deal tips: check the KFF calculator first — most households qualify for subsidies. Silver plans unlock cost-sharing reductions if your income is under ~2.5× the poverty line. Open enrollment is Nov 1 – Jan 15.`,
        cards: [
          { t: 'HealthCare.gov', s: 'Official marketplace — preview real prices', url: `https://www.healthcare.gov/see-plans/#/${s.zip}` },
          { t: 'KFF Subsidy Calculator', s: 'Estimate your discount in 1 minute', url: 'https://www.kff.org/interactive/subsidy-calculator/' },
          { t: 'Medicaid Eligibility', s: 'Free/low-cost coverage check', url: 'https://www.healthcare.gov/medicaid-chip/getting-medicaid-chip/' },
        ],
        chips: ['Remind me before open enrollment', 'Book a doctor appointment', 'Help'],
      };
    },
  },

  appointment: {
    intro: 'Booking a medical appointment. 🏥',
    slots: [
      { name: 'specialty', q: 'What kind of doctor or clinic? (e.g. dentist, cardiologist, general check-up)',
        extract: nlu.extractSpecialty, parse: (t) => (t.trim().length > 1 ? t.trim() : null) },
      dateSlot, timeSlot,
      { ...textSlot('place', 'Which hospital or clinic? (or "skip")'), optional: true },
    ],
    finish(s, ctx) {
      const when = combine(s.date, s.time);
      const b = addBooking({ kind: 'appointment', title: `${cap(s.specialty)} appointment`, when, place: s.place || '' });
      ctx.remindBefore(b);
      return {
        text: `Booked ✅ **${b.title}** — ${fmtWhen(when)}${b.place ? ` at ${b.place}` : ''}.\nI’ll remind you 24h before. Add it to your calendar below, and use Zocdoc if you still need to pick a doctor.`,
        cards: [
          { t: 'Add to calendar', s: fmtWhen(when), ics: b.id },
          { t: 'Zocdoc', s: `Find a ${s.specialty} with open slots`, url: `https://www.zocdoc.com/search?address=${enc(ctx.profile.city || '')}&text=${enc(s.specialty)}` },
        ],
        chips: ['Show my bookings', 'Book another appointment', 'Help'],
      };
    },
  },

  reservation: {
    intro: 'Table for how many? 🍽️',
    slots: [
      textSlot('venue', 'Which restaurant (or cuisine)?'),
      dateSlot, timeSlot,
      { name: 'size', q: 'For how many people?', extract: nlu.extractPartySize,
        parse: (t) => (/^\d{1,2}$/.test(t.trim()) ? +t.trim() : nlu.extractPartySize(t)) },
    ],
    finish(s) {
      const when = combine(s.date, s.time);
      const b = addBooking({ kind: 'reservation', title: `${cap(s.venue)} — table for ${s.size}`, when, place: s.venue });
      return {
        text: `Noted ✅ **${b.title}** — ${fmtWhen(when)}.\nConfirm the table on OpenTable or by phone, then add it to your calendar.`,
        cards: [
          { t: 'Add to calendar', s: fmtWhen(when), ics: b.id },
          { t: 'OpenTable', s: `Book "${s.venue}" online`, url: `https://www.opentable.com/s?term=${enc(s.venue)}&covers=${s.size}` },
        ],
        chips: ['Show my bookings', 'Remind me 2 hours before', 'Help'],
      };
    },
  },

  reminder: {
    intro: 'Setting a reminder. ⏰',
    slots: [
      textSlot('what', 'What should I remind you about?'),
      dateSlot, timeSlot,
    ],
    finish(s) {
      const when = combine(s.date, s.time);
      addReminder(s.what, when);
      return {
        text: `Reminder set ✅ — **${s.what}** on ${fmtWhen(when)}.\nKeep Kalki installed and I’ll ping you (enable notifications in ⚙️ Settings).`,
        chips: ['Show my bookings', 'Help'],
      };
    },
  },
};

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Pre-fill a reminder flow from a chip like "Remind me to follow up tomorrow". */
export function reminderSeed(text) {
  const m = text.match(/remind me (?:to |about )?(.+)/i);
  return m ? m[1] : null;
}
