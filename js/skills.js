/* Skills: what Kalki can actually do. Each skill declares the slots it needs
   (with extractors for free-text and parsers for direct answers) and a
   finish() that produces the reply. Deal-finders build pre-filled deep links
   into the big marketplaces — no accounts, no API keys, nothing leaves the
   device until the user taps a link. Region-specific marketplaces come from
   regions.js; Google-based links here work everywhere. */
import { store } from './store.js';
import * as nlu from './nlu.js';
import { marketCards, fuelWord } from './regions.js';

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
export function updateBooking(id, patch) {
  store.set('bookings', store.get('bookings', []).map((b) => (b.id === id ? { ...b, ...patch } : b)));
}
export function removeBooking(id) {
  store.set('bookings', store.get('bookings', []).filter((b) => b.id !== id));
}
export function restoreBooking(b) {
  store.set('bookings', [...store.get('bookings', []), b]);
}

export function listReminders() {
  return store.get('reminders', []).sort((a, b) => a.when.localeCompare(b.when));
}
export function addReminder(text, whenISO, repeat = null) {
  const all = store.get('reminders', []);
  const r = { id: Date.now().toString(36), text, when: whenISO };
  if (repeat) r.repeat = repeat;
  all.push(r);
  store.set('reminders', all);
  return r;
}
export function removeReminder(id) {
  store.set('reminders', store.get('reminders', []).filter((r) => r.id !== id));
}
export function restoreReminder(r) {
  store.set('reminders', [...store.get('reminders', []), r]);
}

function nextOccurrence(whenISO, repeat, now) {
  const d = new Date(whenISO);
  const step = {
    daily: () => d.setDate(d.getDate() + 1),
    weekly: () => d.setDate(d.getDate() + 7),
    monthly: () => d.setMonth(d.getMonth() + 1),
  }[repeat];
  while (d <= now) step();
  return d.toISOString();
}

/** Reminders that are due. One-shot reminders are removed; repeating ones
    roll forward to their next occurrence. */
export function popDueReminders(now = new Date()) {
  const all = store.get('reminders', []);
  const due = [], keep = [];
  for (const r of all) {
    if (new Date(r.when) <= now) {
      due.push(r);
      if (r.repeat) keep.push({ ...r, when: nextOccurrence(r.when, r.repeat, now) });
    } else {
      keep.push(r);
    }
  }
  if (due.length) store.set('reminders', keep);
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
    // Alarm fires from the calendar app even when Kalki is closed.
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${booking.title}`, 'TRIGGER:-PT24H', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
}

export function fmtWhen(iso) {
  return new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
export const repeatLabel = (r) => ({ daily: 'repeats daily', weekly: 'repeats weekly', monthly: 'repeats monthly' }[r] || '');

/* ---------- slot helpers ---------- */

const textSlot = (name, q) => ({
  name, q,
  extract: () => null,
  parse: (t) => (!nlu.wantsSkip(t) && t.trim().length > 1 ? t.trim() : null),
});
const dateSlot = { name: 'date', q: 'What day? (e.g. tomorrow, Friday, Aug 3)', extract: nlu.parseDate, parse: nlu.parseDate };
const timeSlot = { name: 'time', q: 'What time? (e.g. 10am, 5:30 pm)', extract: nlu.parseTime, parse: nlu.parseTime };
/* Filled from the first message when present, never asked. */
const repeatSlot = { name: 'repeat', hidden: true, extract: nlu.extractRepeat };

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
        text: `Here’s everywhere worth checking for${bedTxt} rentals in **${s.city}**${budTxt}.\n\n💰 Deal tips: listings drop 3–5% in winter, ask for one month free on 12+ month leases, look for “move-in special” filters, and always counter the first quote.${PRIVACY_TIP}`,
        cards: [
          ...marketCards('rent', s),
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
        text: `Comparing **${s.city}** hotels, ${ci} → ${co}, ${g} guest${g > 1 ? 's' : ''}.\n\n💰 Discount checklist: compare here, then **call the hotel and ask them to beat the online price** (they save ~15% commission and often will). Stack AAA/loyalty/corporate rates, sign-up perks (Booking Genius level 2 ≈ 10–15% off), and book refundable so you can rebook if the price drops.${PRIVACY_TIP}`,
        cards: [
          { t: 'Booking.com', s: 'Genius discounts, free cancellation filter', url: `https://www.booking.com/searchresults.html?ss=${enc(s.city)}&checkin=${ci}&checkout=${co}&group_adults=${g}` },
          { t: 'Google Hotels', s: 'Price graph shows cheap dates', url: `https://www.google.com/travel/hotels/${enc(s.city)}` },
          ...marketCards('hotel', s),
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
        text: `Searching **${s.from} → ${s.to}**, ${dep}${ret ? ` back ${ret}` : ' (one-way)'}.\n\n💰 Cheapest-fare checklist: set a **price alert** on Google Flights and wait for a dip; check ±3 days (Tue/Wed departures are cheapest); check nearby airports; look at budget carriers separately; students get 10–30% off via student portals.${PRIVACY_TIP}`,
        cards: [
          { t: 'Google Flights', s: 'Best price graph + free alerts', url: `https://www.google.com/travel/flights?q=${enc(gq)}` },
          ...marketCards('flight', s),
          { t: 'Kayak', s: '±3 days flexible-date view', url: `https://www.kayak.com/flights/${enc(s.from)}-${enc(s.to)}/${dep}${ret ? '/' + ret : ''}` },
          { t: 'Skyscanner', s: '"Cheapest month" tool', url: 'https://www.skyscanner.com/' },
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
        ctx.noteBooking(b);
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
      const capTxt = s.budget ? ` under ${money(s.budget)}` : '';
      return {
        text: `Price-hunting **${s.item}**${capTxt}. Compare across these before paying sticker price.\n\n💰 Stack the savings: price history first (“deals” above the 90-day average aren’t deals) → coupon code → cash-back portal → discounted gift cards. Refurb/open-box knocks off another 20–40%.${PRIVACY_TIP}`,
        cards: [
          { t: 'Google Shopping', s: 'Compare every store at once', url: `https://www.google.com/search?tbm=shop&q=${enc(s.item)}` },
          ...marketCards('shopping', s),
          { t: 'Coupon codes', s: 'Active promo codes for this item', url: `https://www.google.com/search?q=${enc(s.item + ' coupon code promo')}` },
        ],
        chips: ['Find another deal', 'Remind me to check prices Friday', 'Help'],
      };
    },
  },

  groceries: {
    intro: 'Let’s cut your grocery bill. 🛒',
    slots: [
      textSlot('items', 'What do you need? (an item or a whole list — e.g. "milk, rice, veggies")'),
    ],
    finish(s) {
      return {
        text: `Comparing prices for **${s.items}**.\n\n💰 Grocery hacks: store brands are 25–40% cheaper for identical quality; delivery apps run first-order coupons — rotate them; buy staples in bulk when they hit a sale cycle (~every 6 weeks); loyalty prices are often half off but only with the app.${PRIVACY_TIP}`,
        cards: [
          ...marketCards('groceries', s),
          { t: 'Google Shopping', s: 'Spot-check any single item', url: `https://www.google.com/search?tbm=shop&q=${enc(s.items)}` },
        ],
        chips: ['Track a bill', 'Set a reminder', 'Help'],
      };
    },
  },

  rides: {
    intro: 'Getting you a ride. 🚗',
    slots: [
      { name: 'to', q: 'Where are you headed?', extract: nlu.extractDest,
        parse: (t) => (t.trim().length > 1 ? t.trim() : null) },
      { name: 'from', q: 'Pickup from? (or "skip" for current location)', extract: nlu.extractOrigin,
        parse: (t) => (t.trim().length > 1 ? t.trim() : null), optional: true },
    ],
    finish(s) {
      const dir = s.from
        ? `https://www.google.com/maps/dir/?api=1&origin=${enc(s.from)}&destination=${enc(s.to)}`
        : `https://www.google.com/maps/dir/?api=1&destination=${enc(s.to)}`;
      return {
        text: `Ride to **${s.to}**${s.from ? ` from **${s.from}**` : ''}.\n\n💰 Fare tricks: **compare two apps before booking** — the same trip can differ 20–40%; prices spike for ~10 min after a surge starts, so waiting 5–10 minutes often drops the fare; airport pickups have flat-rate zones — walking 2 minutes to departures can halve the price; for short hops check bike/auto options.`,
        cards: [
          { t: 'Uber', s: 'Opens with your destination set', url: `https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff%5Bformatted_address%5D=${enc(s.to)}` },
          ...marketCards('rides', s),
          { t: 'Google Maps', s: 'Compare with transit & walking', url: dir },
        ],
        chips: ['Book a hotel', 'Events near me', 'Help'],
      };
    },
  },

  jobs: {
    intro: 'Job hunt on. 💼',
    slots: [
      textSlot('role', 'What role are you looking for? (e.g. accountant, react developer, nurse)'),
      { name: 'city', q: 'Which city? (or "remote")', extract: nlu.extractCity,
        parse: (t) => (t.trim().length > 1 ? t.trim() : null), profileKey: 'city' },
    ],
    finish(s) {
      return {
        text: `Searching **${s.role}** roles in **${s.city}**.\n\n💼 Get-hired tips: apply within 24h of posting (first 25 applicants get 4× the callbacks); mirror the job ad’s exact keywords in your resume (beats the ATS filter); set alerts on two boards, not five; message the hiring manager on LinkedIn after applying — one line, not an essay.`,
        cards: [
          { t: 'LinkedIn Jobs', s: 'Set an alert for this search', url: `https://www.linkedin.com/jobs/search/?keywords=${enc(s.role)}&location=${enc(s.city)}` },
          ...marketCards('jobs', s),
          { t: 'Google Jobs', s: 'Aggregates every board', url: `https://www.google.com/search?q=${enc(s.role + ' jobs in ' + s.city)}&ibp=htl;jobs` },
        ],
        chips: ['Remind me to follow up in 3 days', 'Help'],
      };
    },
  },

  meds: {
    intro: 'Let’s find that medication cheaper. 💊',
    slots: [
      textSlot('drug', 'Which medication? (name or generic, e.g. atorvastatin)'),
    ],
    finish(s) {
      return {
        text: `Price-checking **${s.drug}**.\n\n💊 Pharmacy tricks: always ask for the **generic** (50–90% cheaper, chemically identical); prices differ wildly between pharmacies for the same drug — check two; a 90-day supply usually beats 3×30; manufacturer sites often run copay coupons for brand-name drugs.\n\n⚠️ Check dosage changes with your doctor or pharmacist — this is price help, not medical advice.`,
        cards: [
          ...marketCards('meds', s),
          { t: 'Price search', s: 'Compare local pharmacy prices', url: `https://www.google.com/search?q=${enc(s.drug + ' price pharmacy compare')}` },
        ],
        chips: ['Book a doctor appointment', 'Remind me to refill monthly', 'Help'],
      };
    },
  },

  gas: {
    intro: `Cheapest ${fuelWord()} nearby. ⛽`,
    slots: [
      { name: 'area', q: 'Which area or city?', extract: nlu.extractCity,
        parse: (t) => (t.trim().length > 1 ? t.trim() : null), profileKey: 'city' },
    ],
    finish(s) {
      const word = fuelWord();
      return {
        text: `Finding the cheapest **${word}** around **${s.area}**.\n\n⛽ Fuel-saving tips: prices are lowest early in the week and rise before weekends; warehouse clubs (Costco/Sam’s) run 20–40¢ cheaper; many stations discount for cash; loyalty apps stack another few cents per litre/gallon.`,
        cards: [
          ...marketCards('gas', s),
          { t: 'Stations map', s: 'All stations near you with prices', url: `https://www.google.com/maps/search/${enc(word + ' station near ' + s.area)}` },
          { t: 'Cheapest search', s: `Today’s cheapest ${word} in ${s.area}`, url: `https://www.google.com/search?q=${enc('cheapest ' + word + ' price ' + s.area + ' today')}` },
        ],
        chips: ['Used car deals', 'Set a reminder', 'Help'],
      };
    },
  },

  usedcar: {
    intro: 'Car-deal mode. 🚙',
    slots: [
      textSlot('model', 'Which car or type? (e.g. Honda City, compact SUV)'),
      { name: 'budget', q: 'Max budget? (or "skip")', extract: nlu.extractMoney, parse: nlu.parseMoney, optional: true },
      { name: 'city', q: 'Which city? (or "skip")', extract: nlu.extractCity,
        parse: (t) => (t.trim().length > 1 ? t.trim() : null), profileKey: 'city', optional: true },
    ],
    finish(s) {
      const budTxt = s.budget ? ` under ${money(s.budget)}` : '';
      return {
        text: `Hunting **${s.model}**${budTxt}${s.city ? ` around **${s.city}**` : ''}.\n\n🚙 Deal rules: private sellers run 10–20% below dealers; **always get a pre-purchase inspection** (~$100–150, saves thousands); check the vehicle history report before you fall in love; dealers discount hardest at month/quarter end to hit quotas; certified pre-owned adds warranty for ~5% more.${PRIVACY_TIP}`,
        cards: [
          ...marketCards('usedcar', s),
          { t: 'Facebook Marketplace', s: 'Private sellers — most negotiable', url: `https://www.facebook.com/marketplace/search/?query=${enc('used ' + s.model)}` },
        ],
        chips: ['Fuel prices', 'Remind me to follow up tomorrow', 'Help'],
      };
    },
  },

  bills: {
    intro: 'Let’s make sure you never miss it. 🧾',
    slots: [
      textSlot('what', 'Which bill or renewal? (e.g. electricity, car insurance, Netflix)'),
      { name: 'amount', q: 'Roughly how much is it? (or "skip")', extract: nlu.extractMoney, parse: nlu.parseMoney, optional: true },
      { ...dateSlot, q: 'When is it next due? (e.g. 5th Aug, Friday, end of month)' },
      repeatSlot,
    ],
    finish(s) {
      const repeat = s.repeat || 'monthly';
      const when = new Date(s.date);
      when.setHours(9, 0, 0, 0);
      const label = `Pay ${s.what}${s.amount ? ` (~${money(s.amount)})` : ''}`;
      addReminder(label, when.toISOString(), repeat);
      return {
        text: `Tracked ✅ **${label}** — first due ${fmtWhen(when.toISOString())}, then ${repeatLabel(repeat)}.\n\n💰 Bill-cutting tip: call once a year and ask for the **retention department** — “I’m thinking of switching” knocks 10–30% off internet, phone and insurance more often than not. Autopay discounts are usually another 5%.`,
        cards: [
          { t: 'Negotiation script', s: `How to lower your ${s.what} bill`, url: `https://www.google.com/search?q=${enc('how to negotiate lower ' + s.what + ' bill script')}` },
        ],
        chips: ['Track another bill', 'Show my bookings', 'Help'],
      };
    },
  },

  insurance: {
    intro: 'Let’s compare health insurance properly. 🩺',
    slots: [
      { name: 'zip', q: 'What’s your ZIP / PIN / postcode? (plans are priced by area — or "skip")',
        extract: nlu.extractZip, parse: nlu.parsePostcode, optional: true },
      { name: 'household', q: 'How many people need coverage? (or "skip")',
        extract: nlu.extractPartySize, parse: (t) => (/^\d{1,2}$/.test(t.trim()) ? +t.trim() : nlu.extractPartySize(t)), optional: true },
    ],
    finish(s) {
      const hh = s.household ? ` for ${s.household} ${s.household === 1 ? 'person' : 'people'}` : '';
      return {
        text: `Comparing health plans${s.zip ? ` near **${s.zip}**` : ''}${hh}.\n\n💡 Deal tips: check subsidy/government-scheme eligibility first — most households qualify for something; compare the **total** (premium + deductible + copays), not just the monthly price; staying in-network is where the real savings are.`,
        cards: [
          ...marketCards('insurance', s),
          { t: 'Compare plans', s: 'All local options side by side', url: `https://www.google.com/search?q=${enc('compare health insurance plans ' + (s.zip || ''))}` },
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
      ctx.noteBooking(b);
      return {
        text: `Booked ✅ **${b.title}** — ${fmtWhen(when)}${b.place ? ` at ${b.place}` : ''}.\nI’ll remind you 24h before. Add it to your calendar below (the calendar alarm works even when Kalki is closed).`,
        cards: [
          { t: 'Add to calendar', s: fmtWhen(when), ics: b.id },
          ...marketCards('appointment', s, ctx.profile),
          { t: 'Clinics nearby', s: `${cap(s.specialty)} options around you`, url: `https://www.google.com/maps/search/${enc(s.specialty + ' near ' + (ctx.profile.city || 'me'))}` },
        ],
        chips: ['Remind me 2 hours before', 'Show my bookings', 'Help'],
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
    finish(s, ctx) {
      const when = combine(s.date, s.time);
      const b = addBooking({ kind: 'reservation', title: `${cap(s.venue)} — table for ${s.size}`, when, place: s.venue });
      ctx.noteBooking(b);
      return {
        text: `Noted ✅ **${b.title}** — ${fmtWhen(when)}.\nConfirm the table online or by phone, then add it to your calendar.`,
        cards: [
          { t: 'Add to calendar', s: fmtWhen(when), ics: b.id },
          ...marketCards('reservation', s),
        ],
        chips: ['Remind me 2 hours before', 'Show my bookings', 'Help'],
      };
    },
  },

  reminder: {
    intro: 'Setting a reminder. ⏰',
    slots: [
      textSlot('what', 'What should I remind you about?'),
      { name: 'when', q: 'When? (e.g. in 2 hours, tomorrow 5pm, every Friday 9am)',
        extract: nlu.parseWhen, parse: nlu.parseWhen },
      repeatSlot,
    ],
    finish(s) {
      let when = s.when.when;
      if (!s.when.hasTime) {
        when = new Date(when);
        when.setHours(9, 0, 0, 0);
      }
      const r = addReminder(s.what, new Date(when).toISOString(), s.repeat);
      const note = !s.when.hasTime ? ' (9am — no time given)' : '';
      const rep = s.repeat ? `, ${repeatLabel(s.repeat)}` : '';
      return {
        text: `Reminder set ✅ — **${s.what}** on ${fmtWhen(r.when)}${note}${rep}.\nKeep Kalki installed and I’ll ping you (enable notifications in ⚙️ Settings).`,
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

/** Strip when/repeat words from a reminder seed so only the task remains. */
export function cleanSeed(seed) {
  return seed
    .replace(/\b(today|tonight|tomorrow|day after tomorrow|(this|next|coming) week-?end|end of (the )?month)\b/gi, '')
    .replace(/\bin\s+(\d+|an?|half an)\s*(min(ute)?s?|h(ou)?rs?|days?|weeks?)\b/gi, '')
    .replace(/\bevery\s+\w+\b/gi, '')
    .replace(/\b(daily|weekly|monthly)\b/gi, '')
    .replace(/\b(on\s+)?(sun|mon|tues?|wednes|thurs?|fri|satur)day\b/gi, '')
    .replace(/\bat\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b/gi, '')
    .replace(/\s+/g, ' ').trim();
}
