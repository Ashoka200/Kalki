/* Rule-based natural-language understanding: intent scoring + entity
   extraction. No network, no ML runtime — runs entirely on-device. */

const INTENTS = [
  ['timer',       /\b(timers?|countdown)\b/g],
  ['reminder',    /\b(remind(er)?s?)\b/g],
  ['expense',     /\b(spent|expenses?|spending|paid\b|budget left|where.{0,10}money)\b/g],
  ['list',        /\b(lists?)\b/g],
  ['brief',       /\b(good morning|morning brief|brief me|my day|today'?s plan|what'?s (on )?today)\b/g],
  ['bills',       /\b(bills?|subscriptions?|renewals?|due date|utilit(y|ies))\b/g],
  ['rent',        /\b(rent(al)?s?|apartment|apartments|flat|studio|condo|lease|housing|house for rent)\b/g],
  ['insurance',   /\b(insurance|health plan|coverage|premium|deductible|medicaid|medicare|obamacare|aca)\b/g],
  ['meds',        /\b(medications?|medicines?|prescriptions?|pharmacy|drug prices?|tablets?|generic drug)\b/g],
  ['appointment', /\b(appointment|doctor|dentist|hospital|clinic|check-?up|physician|specialist|dermatologist|cardiologist)\b/g],
  ['hotel',       /\b(hotels?|motel|hostel|resort|airbnb|lodging|accommodation|place to stay)\b/g],
  ['flight',      /\b(flights?|fly|flying|airfare|air ticket|plane ticket)\b/g],
  ['rides',       /\b(rides?|uber|lyft|ola|rapido|taxi|cab|rideshare)\b/g],
  ['groceries',   /\b(grocer(y|ies)|supermarket|vegetables|fruits|food delivery|instacart|bigbasket|blinkit)\b/g],
  ['gas',         /\b(gas station|gas price|petrol|diesel|fuel|fill (up|the tank))\b/g],
  ['usedcar',     /\b(used cars?|second ?hand cars?|buy a car|car deals?|pre-?owned)\b/g],
  ['jobs',        /\b(jobs?|hiring|vacanc(y|ies)|internships?|career|resume|naukri)\b/g],
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
  return best || fuzzyDetect(t);
}

/* Typo tolerance: when nothing matches exactly, compare each word against
   a keyword lexicon allowing one edit ("remnid me", "grocry deals"). */
const LEXICON = [
  ['reminder', 'reminder'], ['remind', 'reminder'], ['apartment', 'rent'], ['rental', 'rent'],
  ['hotel', 'hotel'], ['flight', 'flight'], ['flights', 'flight'], ['grocery', 'groceries'],
  ['groceries', 'groceries'], ['doctor', 'appointment'], ['appointment', 'appointment'],
  ['insurance', 'insurance'], ['medicine', 'meds'], ['medication', 'meds'], ['petrol', 'gas'],
  ['events', 'events'], ['festival', 'events'], ['restaurant', 'reservation'],
  ['reservation', 'reservation'], ['shopping', 'shopping'], ['budget', 'expense'],
  ['expense', 'expense'], ['spending', 'expense'], ['timer', 'timer'],
];

function oneEditAway(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    // one substitution, or one adjacent transposition ("remnid" → "remind")
    const diffs = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs.push(i);
    if (diffs.length <= 1) return true;
    return diffs.length === 2 && diffs[1] === diffs[0] + 1
      && a[diffs[0]] === b[diffs[1]] && a[diffs[1]] === b[diffs[0]];
  }
  // one insertion/deletion
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  let i = 0, j = 0, edits = 0;
  while (i < long.length && j < short.length) {
    if (long[i] === short[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    i++;
  }
  return true;
}

function fuzzyDetect(t) {
  for (const word of t.split(/[^a-z]+/)) {
    if (word.length < 5) continue;
    for (const [kw, intent] of LEXICON) {
      if (word !== kw && oneEditAway(word, kw)) return intent;
    }
  }
  return null;
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

/** "$1,500" | "1500" | "1.5k" → 1500 (number) or null.
    Rejects counts that aren't money ("2 bedrooms", "4 people"). */
export function parseMoney(text) {
  const t = String(text);
  if (/\d[\d,.]*\s*k?\s*(bed(room)?s?|br\b|people|persons?|guests?|nights?)/i.test(t)) return null;
  const m = t.match(/\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?/i);
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

/** US ZIP (5) or India PIN (6) inside free text. */
export function extractZip(text) {
  const m = text.match(/\b(\d{5}(?:-\d{4})?|\d{6})\b/);
  return m ? m[1] : null;
}
/** Direct answer to the ZIP/PIN/postcode question — any postal format. */
export function parsePostcode(text) {
  const t = text.trim();
  return /^[a-z0-9][a-z0-9 -]{2,9}$/i.test(t) ? t.toUpperCase() : null;
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Natural date → Date at local midnight, or null. `base` for testability. */
export function parseDate(text, base = new Date()) {
  const t = text.toLowerCase();
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  if (/\bday after tomorrow\b/.test(t)) { d.setDate(d.getDate() + 2); return d; }
  if (/\btoday\b|\btonight\b/.test(t)) return d;
  if (/\btomorrow\b/.test(t)) { d.setDate(d.getDate() + 1); return d; }
  let m = t.match(/\bin\s+(\d{1,3})\s*(days?|weeks?)\b/) || t.match(/\bin\s+(a|one)\s+(day|week)\b/);
  if (m) {
    const n = /^\d/.test(m[1]) ? +m[1] : 1;
    d.setDate(d.getDate() + n * (/week/.test(m[2]) ? 7 : 1));
    return d;
  }
  if (/\b(this|next|coming)?\s*week-?end\b/.test(t)) {
    let diff = (6 - d.getDay() + 7) % 7; // upcoming Saturday (today if Saturday)
    if (/\bnext week-?end\b/.test(t)) diff += 7;
    d.setDate(d.getDate() + diff);
    return d;
  }
  if (/\bend of (the )?month\b/.test(t)) return new Date(d.getFullYear(), d.getMonth() + 1, 0);
  for (let i = 0; i < 7; i++) {
    if (new RegExp('\\b' + DAYS[i].slice(0, 3) + '(' + DAYS[i].slice(3) + ')?\\b').test(t)) {
      const diff = (i - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      return d;
    }
  }
  m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
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

/** Any point in time — relative ("in 20 minutes", "in 2 hours") or absolute
    ("tomorrow 5pm", "friday"). → { when: Date, hasTime } or null. */
export function parseWhen(text, base = new Date()) {
  const t = text.toLowerCase();
  let m = t.match(/\bin\s+(\d{1,3})\s*(min(?:ute)?s?|h(?:ou)?rs?)\b/)
       || t.match(/\bin\s+(an?)\s+(hour|minute)\b/)
       || t.match(/\bin\s+(half an)\s+(hour)\b/);
  if (m) {
    const n = /^\d/.test(m[1]) ? +m[1] : m[1] === 'half an' ? 0.5 : 1;
    const ms = /h/.test(m[2][0]) || /hour/.test(m[2]) ? n * 3600e3 : n * 60e3;
    return { when: new Date(base.getTime() + ms), hasTime: true };
  }
  const date = parseDate(t, base);
  const time = parseTime(t);
  if (date && time) {
    const d = new Date(date);
    d.setHours(time.h, time.m, 0, 0);
    return { when: d, hasTime: true };
  }
  if (date) return { when: date, hasTime: false };
  if (time) {
    const d = new Date(base);
    d.setHours(time.h, time.m, 0, 0);
    if (d <= base) d.setDate(d.getDate() + 1); // that time already passed → tomorrow
    return { when: d, hasTime: true };
  }
  return null;
}

/** "every day/friday/week/month" → 'daily' | 'weekly' | 'monthly' | null. */
export function extractRepeat(text) {
  const t = text.toLowerCase();
  if (/\b(every ?day|daily|every (morning|night|evening))\b/.test(t)) return 'daily';
  if (/\bevery\s+(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/.test(t)) return 'weekly';
  if (/\b(every ?week|weekly)\b/.test(t)) return 'weekly';
  if (/\b(every ?month|monthly)\b/.test(t)) return 'monthly';
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
