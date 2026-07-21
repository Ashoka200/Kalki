/* Rule-based natural-language understanding: intent scoring + entity
   extraction. No network, no ML runtime — runs entirely on-device. */

const INTENTS = [
  ['reminder',    /\b(remind(er)?s?)\b/g],
  ['rent',        /\b(rent(al)?s?|apartment|apartments|flat|studio|condo|lease|housing|house for rent)\b/g],
  ['insurance',   /\b(insurance|health plan|coverage|premium|deductible|medicaid|medicare|obamacare|aca)\b/g],
  ['appointment', /\b(appointment|doctor|dentist|hospital|clinic|check-?up|physician|specialist|dermatologist|cardiologist)\b/g],
  ['hotel',       /\b(hotels?|motel|hostel|resort|airbnb|lodging|accommodation|place to stay)\b/g],
  ['flight',      /\b(flights?|fly|flying|airfare|air ticket|plane ticket)\b/g],
  ['events',      /\b(events?|festivals?|concerts?|gigs?|things to do|happening|carnival|fair|expo)\b/g],
  ['court',       /\b(courts?|turf|badminton|tennis|pickleball|basketball|futsal|squash|volleyball|cricket net|table tennis|ping pong)\b/g],
  ['reservation', /\b(reservation|reserve|restaurant|table|dine|dinner|lunch|brunch)\b/g],
  ['shopping',    /\b(buy|shop(ping)?|deal|deals|price|prices|discount|cheap(est)?|bargain|purchase|coupon|promo)\b/g],
  ['bookings',    /\b(my (bookings?|appointments?|reservations?|reminders?|schedule)|upcoming|what.s (booked|scheduled))\b/g],
  ['theme',       /\b(theme|dark mode|light mode|wallpaper|customi[sz]e|colou?rs?)\b/g],
  ['help',        /\b(help|what can you do|features|abilities)\b/g],
  ['greet',       /^(hi|hiya|hello|hey|yo|good (morning|afternoon|evening))\b/g],
  ['thanks',      /\b(thanks?|thank you|thx)\b/g],
];

/** Best-scoring intent for a message, or null. Order breaks ties. */
export function detect(text) {
  const t = text.toLowerCase();
  let best = null, bestScore = 0;
  for (const [intent, re] of INTENTS) {
    const score = (t.match(re) || []).length;
    if (score > bestScore) { best = intent; bestScore = score; }
  }
  return best;
}

/** "my name is X" / "i live in Y" / "my budget is Z" — profile facts. */
export function detectProfileFact(text) {
  const t = text.trim();
  let m = t.match(/\bmy name('?s| is)\s+([a-z][a-z .'-]{0,30})/i) || t.match(/\bi'?m called\s+([a-z][a-z .'-]{0,30})/i);
  if (m) return { key: 'name', value: title(m[m.length - 1]) };
  m = t.match(/\bi (live|stay) in\s+([a-z][a-z .'-]{0,40})/i);
  if (m) return { key: 'city', value: title(m[2]) };
  m = t.match(/\bmy (rent )?budget is\s+\$?([\d,.]+)\s*k?/i);
  if (m) return { key: 'budget', value: parseMoney(m[2] + (t.match(/[\d,.]+\s*k\b/i) ? 'k' : '')) };
  return null;
}

const title = (s) => s.trim().replace(/[.!?]+$/, '').replace(/\b\w/g, (c) => c.toUpperCase());

/* ---------- entity parsers ---------- */

/** "$1,500" | "1500" | "1.5k" → 1500 (number) or null. */
export function parseMoney(text) {
  const m = String(text).match(/\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?/i);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ''));
  if (m[2]) n *= 1000;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** Money only when clearly marked as such inside a longer sentence. */
export function extractMoney(text) {
  const m = text.match(/(?:under|below|around|about|max|up to|budget(?: of| is)?)\s*\$?\s*([\d,.]+\s*k?)/i)
        || text.match(/\$\s*([\d,.]+\s*k?)/);
  return m ? parseMoney(m[1]) : null;
}

/** "in Austin, under $2k" → "Austin". */
export function extractCity(text) {
  const m = text.match(/\b(?:in|near|around)\s+([a-zÀ-ɏ][a-zÀ-ɏ' ]{1,30}?)(?=\s+(?:under|below|around|for|with|at|by|next|this|on)\b|[,.!?]|$)/i);
  if (!m || /^(me|here|us|my|town|the)$/i.test(m[1].trim())) return null;
  return title(m[1]);
}

/** "flight from austin to new york" → "Austin" / "New York". */
export function extractOrigin(text) {
  const m = text.match(/\bfrom\s+([a-zÀ-ɏ'. ]{2,30}?)(?=\s+(?:to|on|next|this)\b|[,.!?]|$)/i);
  return m ? title(m[1]) : null;
}
export function extractDest(text) {
  const m = text.match(/\bto\s+([a-zÀ-ɏ'. ]{2,30}?)(?=\s+(?:on|from|next|this|tomorrow|today)\b|[,.!?]|$)/i);
  return m ? title(m[1]) : null;
}

/** "3 nights" → 3. */
export function extractNights(text) {
  const m = text.match(/\b(\d{1,2})\s*nights?\b/i);
  return m ? parseInt(m[1], 10) : null;
}

const SPORTS = ['badminton', 'tennis', 'pickleball', 'basketball', 'futsal', 'squash',
  'volleyball', 'table tennis', 'ping pong', 'cricket', 'soccer', 'football', 'golf'];
export function extractSport(text) {
  const t = text.toLowerCase();
  return SPORTS.find((s) => new RegExp('\\b' + s + '\\b').test(t)) || null;
}

export function extractEventKind(text) {
  const m = text.toLowerCase().match(/\b(music|concerts?|food|art|tech|comedy|sports?|cultural|film|theat(?:er|re)|festivals?)\b/);
  return m ? m[1] : null;
}

/** "2br" / "2 bedroom" / "studio" → number of bedrooms. */
export function extractBeds(text) {
  if (/\bstudio\b/i.test(text)) return 0;
  const m = text.match(/\b(\d{1,2})\s*(?:br|bed(?:room)?s?)\b/i);
  return m ? parseInt(m[1], 10) : null;
}

/** "for 4" / "party of 6" / "2 people" → party size. */
export function extractPartySize(text) {
  const m = text.match(/\b(?:for|party of|table for)\s+(\d{1,2})\b(?!\s*night)/i)
        || text.match(/\b(\d{1,2})\s+(?:people|persons?|guests?)\b/i);
  return m ? parseInt(m[1], 10) : null;
}

export function extractZip(text) {
  const m = text.match(/\b(\d{5})(?:-\d{4})?\b/);
  return m ? m[1] : null;
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Natural date → Date at local midnight, or null. `base` for testability. */
export function parseDate(text, base = new Date()) {
  const t = text.toLowerCase();
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  if (/\btoday\b|\btonight\b/.test(t)) return d;
  if (/\btomorrow\b/.test(t)) { d.setDate(d.getDate() + 1); return d; }
  for (let i = 0; i < 7; i++) {
    if (new RegExp('\\b' + DAYS[i].slice(0, 3) + '(' + DAYS[i].slice(3) + ')?\\b').test(t)) {
      const diff = (i - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      return d;
    }
  }
  let m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (m) {
    const y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : d.getFullYear();
    const r = new Date(y, +m[1] - 1, +m[2]);
    if (!m[3] && r < d) r.setFullYear(r.getFullYear() + 1);
    return r;
  }
  m = t.match(new RegExp('\\b(' + MONTHS.join('|') + ')[a-z]*\\.?\\s+(\\d{1,2})\\b'))
   || t.match(new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(' + MONTHS.join('|') + ')[a-z]*\\b'));
  if (m) {
    const [mon, day] = isNaN(+m[1]) ? [m[1], +m[2]] : [m[2], +m[1]];
    const r = new Date(d.getFullYear(), MONTHS.indexOf(mon), day);
    if (r < d) r.setFullYear(r.getFullYear() + 1);
    return r;
  }
  return null;
}

/** Natural time → {h, m} (24h), or null. */
export function parseTime(text) {
  const t = text.toLowerCase();
  let m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (m) {
    let h = +m[1] % 12;
    if (m[3] === 'pm') h += 12;
    return { h, m: +(m[2] || 0) };
  }
  m = t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m && +m[1] < 24 && +m[2] < 60) return { h: +m[1], m: +m[2] };
  if (/\bnoon\b/.test(t)) return { h: 12, m: 0 };
  if (/\bmidnight\b/.test(t)) return { h: 0, m: 0 };
  if (/\bmorning\b/.test(t)) return { h: 9, m: 0 };
  if (/\bafternoon\b/.test(t)) return { h: 14, m: 0 };
  if (/\bevening\b|\btonight\b/.test(t)) return { h: 19, m: 0 };
  return null;
}

const SPECIALTIES = ['dentist', 'dermatologist', 'cardiologist', 'optometrist', 'ophthalmologist',
  'gynecologist', 'pediatrician', 'orthopedist', 'physiotherapist', 'therapist', 'psychiatrist',
  'neurologist', 'urologist', 'ent', 'general practitioner', 'gp', 'doctor'];

export function extractSpecialty(text) {
  const t = text.toLowerCase();
  for (const s of SPECIALTIES) {
    if (new RegExp('\\b' + s + '\\b').test(t)) return s === 'gp' ? 'general practitioner' : s;
  }
  return null;
}

export const wantsSkip = (text) => /^(skip|any|no|none|n\/a|whatever|doesn'?t matter|-)$/i.test(text.trim());
export const wantsCancel = (text) => /^(cancel|stop|never ?mind|forget it|quit|abort)$/i.test(text.trim());
