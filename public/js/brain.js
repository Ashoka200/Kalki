/* Dialog manager: routes each message to a skill, runs slot-filling
   conversations (ask only for what wasn't already said), and remembers
   the user's profile to pre-fill answers — the "thinks like a human" part.
   Also owns the single-turn skills: expenses, lists, timers, quick math,
   the morning brief, and follow-up tweaks to the last deal search. */
import * as nlu from './nlu.js';
import { SKILLS, reminderSeed, cleanSeed, listBookings, listReminders, fmtWhen, repeatLabel, addReminder, iconFor, setBookingStatus } from './skills.js';
import * as personal from './personal.js';
import * as resume from './resume.js';
import { parseWebQuery } from './web.js';
import { currencySymbol } from './regions.js';
import { store } from './store.js';

const MAIN_CHIPS = ['Morning brief', 'Weather', 'My spending', 'Shopping list', 'My habits', 'Plan a trip', 'Find a rental', 'Shopping deals', 'Groceries', 'Book a ride', 'Airport transfer', 'Book a hotel', 'Find flights', 'Events near me', 'Find a job', 'Apply to a job', 'Medication prices', 'Fuel prices', 'Used car deals', 'Health insurance', 'Doctor appointment', 'Reserve a table', 'Book a game court', 'Track a bill', 'Set a timer', 'Set a reminder'];

/* Deal searches remember their last run so "what about mumbai?" works. */
const DEAL_SKILLS = new Set(['trip', 'rent', 'hotel', 'flight', 'events', 'shopping', 'groceries', 'rides', 'jobs', 'meds', 'gas', 'usedcar', 'insurance']);
/* Which slot a bare follow-up like "what about pune" most likely replaces. */
const PLACE_SLOTS = ['dest', 'city', 'area', 'to', 'item', 'items', 'model', 'role', 'drug', 'venue'];

export class Brain {
  constructor() {
    this.flow = null; // { id, values: {name: value} }
    this.lastBooking = null; // most recent booking made this session
    this.lastDeal = null; // { id, values } of the last completed deal search
    this.context = {}; // cross-turn memory (e.g. last mentioned place)
    this.lastOffers = null; // live flight offers awaiting a "book flight N"
    this.pendingOffer = null; // the offer being booked
    this.lastHotels = null; // live hotel results awaiting "rates N"
    this.lastRates = null; // room rates awaiting "book room N"
    this.pendingRate = null; // the rate being booked
    this.pendingHotel = null;
  }

  get profile() { return store.get('profile', {}); }
  setProfile(patch) { store.set('profile', { ...this.profile, ...patch }); }

  /** 24h heads-up for a booking, if that's still in the future. */
  remindBefore(booking) {
    const t = new Date(booking.when).getTime() - 24 * 3600 * 1000;
    if (t > Date.now()) addReminder(`Tomorrow: ${booking.title}`, new Date(t).toISOString());
  }

  noteBooking(booking) { this.lastBooking = booking; }

  welcome() {
    const name = this.profile.name ? `, ${this.profile.name}` : '';
    return {
      text: `Hey${name}! I’m **Kalki**, your on-device assistant. I hunt deals, track your spending and lists, book appointments, run timers and remember things for you — all stored only on this phone.\n\nWhat do you need?`,
      chips: MAIN_CHIPS,
    };
  }

  handle(text) {
    let t = text.trim();
    if (!t) return null;

    // Pronoun memory: "book a hotel there" / "weather there" resolve to the
    // last place this conversation mentioned.
    if (this.context.place && /\b(there|that city|same place|the same city)\b/i.test(t) && !this.flow) {
      t = t.replace(/\b(in|at|near|to|around|for)\s+(?:there|that city|same place|the same city)\b/gi, `$1 ${this.context.place}`)
           .replace(/\b(?:there|that city|same place|the same city)\b/gi, `in ${this.context.place}`);
    }

    if (this.flow) {
      if (nlu.wantsCancel(t)) {
        this.flow = null;
        return { text: 'Okay, cancelled. What else can I do?', chips: MAIN_CHIPS };
      }
      return this.fillSlot(t);
    }

    // Booking request tracking: "request sent" → follow up if unconfirmed;
    // "mark confirmed" → done.
    const track = t.match(/^(?:i've |ive |i )?(request(?:ed)?(?: sent)?|sent(?: the)? request|mark(?: as)? confirmed|confirmed|it's confirmed)\b/i);
    if (track) {
      const target = this.lastBooking || listBookings().find((b) => new Date(b.when) > new Date());
      if (!target) return { text: 'Nothing to track yet — save an appointment or table first.', chips: MAIN_CHIPS };
      const confirming = /confirm/i.test(track[1]);
      setBookingStatus(target.id, confirming ? 'confirmed' : 'requested');
      if (confirming) {
        return { text: `✅ **${target.title}** is confirmed — I’ll still remind you 24h before.`, chips: ['Show my bookings', 'Help'] };
      }
      const followUp = new Date(Math.min(Date.now() + 24 * 3600e3, new Date(target.when).getTime() - 3600e3));
      if (followUp > new Date()) addReminder(`Did ${target.place || target.title} confirm your booking?`, followUp.toISOString());
      return {
        text: `📨 Noted — request sent for **${target.title}**.\nI’ll check back with you ${fmtWhen(followUp.toISOString())} if it isn’t confirmed by then. Say “**mark confirmed**” once they reply.`,
        chips: ['Mark confirmed', 'Show my bookings'],
      };
    }

    // "book flight 2" → start the passenger-details flow for that offer.
    const pick = t.match(/^book (?:flight|option|number)?\s*#?(\d{1,2})$/i);
    if (pick && this.lastOffers?.length) {
      const offer = this.lastOffers[+pick[1] - 1];
      if (!offer) return { text: `I only have ${this.lastOffers.length} fares from that search — pick 1–${this.lastOffers.length}.` };
      this.pendingOffer = offer;
      return this.startFlow('flightbook', '');
    }

    // "rates 2" → room options for that hotel; "book room 1" → reserve it.
    const rateReq = t.match(/^(?:rates|rooms)\s*#?(\d{1,2})$/i);
    if (rateReq && this.lastHotels?.length) {
      const hotel = this.lastHotels[+rateReq[1] - 1];
      if (!hotel) return { text: `I only have ${this.lastHotels.length} hotels from that search.` };
      this.pendingHotel = hotel.name;
      return { fetchRates: hotel, text: `Checking rooms at **${hotel.name}**…` };
    }
    const roomReq = t.match(/^book (?:room|rate)\s*#?(\d{1,2})$/i);
    if (roomReq && this.lastRates?.length) {
      const rate = this.lastRates[+roomReq[1] - 1];
      if (!rate) return { text: `I only have ${this.lastRates.length} room options.` };
      this.pendingRate = rate;
      return this.startFlow('staybook', '');
    }

    // Application tracker: "my applications", "mark acme interview".
    const appCmd = resume.parseApplicationCmd(t);
    if (appCmd) {
      if (appCmd.op === 'list') {
        const apps = resume.listApplications();
        if (!apps.length) return { text: 'No applications logged yet. Say “**apply**” and paste a job description — I’ll tailor it and track it.', chips: ['Apply to a job', 'Find a job'] };
        const lines = apps.slice(0, 10).map((a) => `${resume.STATUS_ICON[a.status] || '📨'} **${a.role}**${a.company ? ` · ${a.company}` : ''} — ${a.score != null ? a.score + '% match, ' : ''}${new Date(a.ts).toLocaleDateString()}`);
        return { text: `Your applications (${apps.length}):\n\n${lines.join('\n')}\n\nUpdate one with “mark ⟨company⟩ interview”.`, chips: ['Apply to a job', 'Help'] };
      }
      const hit = resume.listApplications().find((a) => `${a.company} ${a.role}`.toLowerCase().includes(appCmd.name.toLowerCase()));
      if (!hit) return { text: `I don’t have an application matching “${appCmd.name}”.`, chips: ['My applications'] };
      resume.setApplicationStatus(hit.id, appCmd.status);
      return { text: `${resume.STATUS_ICON[appCmd.status]} **${hit.role}${hit.company ? ` · ${hit.company}` : ''}** → ${appCmd.status}.`, chips: ['My applications', 'Help'] };
    }

    // Device location — app.js runs the async geolocation lookup.
    if (/^(?:where am i|what'?s my location|find|update|detect|use|get|share)\s+(?:my\s+)?(?:current\s+)?location\b|^(?:use|update|detect)\s+my location\b|^locate me\b/i.test(t)) {
      return { locate: true, text: 'Finding your location…' };
    }

    const chat = this.smallTalk(t);
    if (chat) return chat;

    // Quick math — tip, split, percent, arithmetic, unit conversion.
    const math = personal.quickMath(t);
    if (math) return { text: math };

    // List commands ("add milk to shopping list") — anchored patterns, safe early.
    const listCmd = personal.parseListCmd(t);
    if (listCmd) {
      const r = personal.runListCmd(listCmd);
      return { text: r.text, chips: listCmd.op === 'show' ? ['Clear shopping list', 'My lists'] : undefined };
    }

    // Habit commands ("track habit workout", "did workout", "my habits").
    const habitCmd = personal.parseHabitCmd(t);
    if (habitCmd) {
      const r = personal.runHabitCmd(habitCmd);
      // "did X" for an unknown X falls through to normal understanding.
      if (!r?.unknown) return { text: r.text, chips: habitCmd.op !== 'add' ? ['My habits', 'Help'] : undefined };
    }

    // Chat search ("search chat for rent").
    const query = personal.parseSearchCmd(t);
    if (query) return { text: personal.searchChat(query) };

    // Free internet answers — weather, currency, crypto, define, what/who is.
    // No API key involved; app.js runs the fetch (keyless public services).
    const webQ = parseWebQuery(t);
    if (webQ) return { web: webQ };

    // "Remind me 2 hours before" — relative to the booking just made
    // (or the next upcoming one), no flow needed.
    const rel = t.match(/^remind me\s+(\d+|an?|half an)\s*(min(?:ute)?s?|h(?:ou)?rs?|days?)\s+before\b/i);
    if (rel) {
      const target = this.lastBooking || listBookings().find((b) => new Date(b.when) > new Date());
      if (!target) return { text: 'There’s no upcoming booking yet — book something first and I’ll set the heads-up.', chips: MAIN_CHIPS };
      const n = /^\d/.test(rel[1]) ? +rel[1] : rel[1] === 'half an' ? 0.5 : 1;
      const unit = rel[2][0] === 'm' ? 60e3 : rel[2][0] === 'd' ? 86400e3 : 3600e3;
      const at = new Date(target.when).getTime() - n * unit;
      if (at <= Date.now()) return { text: `That would already be in the past — **${target.title}** is at ${fmtWhen(target.when)}.` };
      addReminder(`Heads-up: ${target.title}`, new Date(at).toISOString());
      return { text: `Will do ✅ — I’ll nudge you ${rel[1]} ${rel[2]} before **${target.title}** (${fmtWhen(new Date(at).toISOString())}).`, chips: ['Show my bookings', 'Help'] };
    }

    // Follow-up tweak to the last deal search: "what about mumbai?",
    // "around UNLV", "near downtown" — re-runs it with that slot changed.
    const follow = t.match(/^(?:what about|how about|try|same (?:but|for)|now)\s+(.+?)\??$/i)
      || (/^(?:around|near|in|closer to|close to)\s+(?!\d)(.+?)\??$/i.test(t) && t.match(/^(?:around|near|in|closer to|close to)\s+(.+?)\??$/i));
    if (follow && this.lastDeal) {
      const tweaked = this.tweakLastDeal(follow[1]);
      if (tweaked) return tweaked;
    }

    const fact = nlu.detectProfileFact(t);
    if (fact) {
      this.setProfile({ [fact.key]: fact.value });
      const ack = { name: `Nice to meet you, ${fact.value}! 👋`, city: `Got it — you’re in ${fact.value}.`, budget: `Noted — budget around $${(+fact.value).toLocaleString()}.` };
      return { text: ack[fact.key] + ' I’ll remember that.', chips: MAIN_CHIPS };
    }

    const intent = nlu.detect(t);
    if (intent === 'apply' && !resume.hasResume()) {
      return {
        text: '📄 First, save your resume — paste it into **⚙️ Settings → Resume** (it stays on this device). Then send me any job description and I’ll score the match, name the missing keywords and write a tailored cover letter.',
        open: 'settings',
        chips: ['Help'],
      };
    }
    if (intent && SKILLS[intent]) return this.startFlow(intent, t);

    switch (intent) {
      case 'greet':
        return this.welcome();
      case 'thanks':
        return { text: 'Anytime! 🙌' };
      case 'theme':
        return { text: 'Opening the theme studio — pick a preset or design your own. 🎨', open: 'settings' };
      case 'bookings':
        return this.showBookings();
      case 'expense':
        return this.handleExpense(t);
      case 'timer':
        return this.handleTimer(t);
      case 'list':
        return { text: 'Lists I can keep: say “**add milk to shopping list**”, “**show my shopping list**”, “**check off milk**”, or “**my lists**”.' };
      case 'brief':
        return this.brief();
      case 'help':
        return {
          text: 'Here’s my full range:\n\n**🌅 Morning brief** — say “good morning”: today’s plan, spending, lists\n**💰 Spending** — “spent $40 on groceries” logs it; “my spending” shows the month vs budget\n**📝 Lists** — “add milk to shopping list”, “check off milk”, any number of named lists\n**💪 Habits** — “track habit workout”, then “did workout” daily; streaks with 🔥\n**🔎 Chat search** — “search chat for rent”\n**⏱️ Timers** — “set a timer for 10 minutes”\n**🧮 Math** — “15% tip on 84”, “split 1840 between 4”, any arithmetic\n**🌐 Live answers (free, no key)** — “weather in Austin”, “convert 100 usd to inr”, “bitcoin price”, “define serendipity”, “who is Marie Curie” — answered from free public services\n**🧠 Ask anything** — on the hosted site, other questions are answered by Claude automatically\n**🏠 Rent · 🛍️ Shopping · 🛒 Groceries · 🚗 Rides · 🏨 Hotels · ✈️ Flights** — deals with your region’s marketplaces\n**💼 Jobs · 💊 Medication · ⛽ Fuel · 🚙 Used cars · 🩺 Insurance** — more region-aware deal hunting\n**🎪 Events · 🏥 Appointments · 🍽️ Reservations · 🎾 Courts** — find & book, calendar export with alarms\n**🧾 Bills** — recurring due-date reminders + negotiation scripts\n**⏰ Reminders** — “in 2 hours”, “every Friday 9am”, “remind me 2 hours before”\n\nAfter any search, tweak it: “**what about mumbai?**”, “**try 2 bedrooms**”.\n\n🕵️ Deal links have a ⧉ copy button — paste into a **private window** so sites can’t inflate prices.\n\nI learn too: “my name is …”, “I live in …”. Set **region** in ⚙️ Settings. Say **cancel** to stop any flow.',
          chips: MAIN_CHIPS,
        };
      default:
        // With a Claude API key configured, unmatched messages go to Claude
        // (app.js handles the async call); otherwise the plain fallback.
        return {
          text: 'I didn’t quite catch that. I’m best at deals, spending, lists, bookings and reminders — pick one below or say **help**.',
          chips: MAIN_CHIPS,
          llmQuery: t,
        };
    }
  }

  /* ---------- expenses ---------- */

  handleExpense(t) {
    const cur = currencySymbol();
    if (/^undo(?: that| the last)?(?: expense)?$/i.test(t)) {
      const all = personal.listExpenses();
      const last = all[all.length - 1];
      if (!last) return { text: 'No expenses logged yet.', chips: MAIN_CHIPS };
      personal.removeExpense(last.id);
      return { text: `Removed 💸 **${cur}${last.amt.toLocaleString()}** on ${last.note}.`, chips: ['My spending', 'Help'] };
    }
    const e = personal.parseExpense(t);
    if (e) {
      personal.addExpense(e);
      const { total } = personal.summarize(personal.monthExpenses());
      const budget = this.profile.spendBudget;
      const vs = budget ? ` of your ${cur}${(+budget).toLocaleString()} budget${total > budget ? ' — **over budget!**' : ''}` : '';
      return {
        text: `Logged 💸 **${cur}${e.amt.toLocaleString()}** on **${e.note}** (${e.cat}).\nThis month: **${cur}${total.toLocaleString()}**${vs}.`,
        chips: ['Undo that expense', 'My spending', 'Set a spending budget'],
      };
    }
    const bud = t.match(/(?:spending budget|budget)\s*(?:is|of|to)?\s*\$?([\d][\d,.]*k?)/i);
    if (bud) {
      const amt = nlu.parseMoney(bud[1]);
      if (amt) {
        this.setProfile({ spendBudget: amt });
        return { text: `Budget set ✅ — I’ll track this month’s spending against **${cur}${amt.toLocaleString()}**.`, chips: ['My spending'] };
      }
    }
    if (/set a spending budget/i.test(t)) {
      return { text: `Sure — how much per month? Say something like “**set spending budget 800**”.` };
    }
    if (/log an expense/i.test(t)) {
      return { text: `Just tell me naturally — “**spent ${cur}40 on groceries**”, “**paid 250 for chai**” — and I’ll log and categorise it.` };
    }
    return this.spendingSummary();
  }

  spendingSummary() {
    const cur = currencySymbol();
    const month = personal.monthExpenses();
    if (!month.length) {
      return { text: 'No expenses logged this month. Just tell me things like “**spent $40 on groceries**” or “**paid 250 for chai**” and I’ll keep the tally.', chips: ['Set a spending budget'] };
    }
    const { total, cats, count } = personal.summarize(month);
    const budget = this.profile.spendBudget;
    const bar = budget
      ? `\nBudget: **${cur}${total.toLocaleString()} / ${cur}${(+budget).toLocaleString()}** ${total > budget ? '🔴 over!' : total > budget * 0.8 ? '🟡 close' : '🟢'}`
      : '\nTip: say “**set spending budget 500**” and I’ll warn you when you’re close.';
    const lines = cats.map(([c, amt]) => `• ${c}: **${cur}${amt.toLocaleString()}**`).join('\n');
    const recent = month.slice(0, 3).map((e) => `${cur}${e.amt.toLocaleString()} ${e.note}`).join(' · ');
    return {
      text: `💰 **This month** — ${count} expense${count > 1 ? 's' : ''}, **${cur}${total.toLocaleString()}** total.${bar}\n\n${lines}\n\nRecent: ${recent}`,
      cards: [{ t: 'Download CSV', s: 'This month’s expenses as a spreadsheet', dl: { name: 'kalki-expenses.csv', content: personal.expensesCSV(month), mime: 'text/csv' } }],
      chips: ['Log an expense', 'Set a spending budget', 'Help'],
    };
  }

  /* ---------- timers ---------- */

  handleTimer(t) {
    if (/\b(cancel|stop|clear)\b/i.test(t)) {
      const n = personal.listTimers().length;
      personal.clearTimers();
      return { text: n ? `Timer${n > 1 ? 's' : ''} cancelled.` : 'No timers running.' };
    }
    const secs = personal.parseTimer(t);
    if (secs) {
      const timer = personal.addTimer(secs);
      return { text: `⏱️ Timer set — **${personal.fmtDur(secs)}**. I’ll ping you at ${new Date(timer.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. (Keep Kalki open — timers ring in-app.)` };
    }
    const active = personal.listTimers();
    if (active.length) {
      const lines = active.map((x) => `⏱️ ${x.label} — ${personal.fmtDur(Math.max(0, Math.round((x.end - Date.now()) / 1000)))} left`);
      return { text: lines.join('\n'), chips: ['Cancel timer'] };
    }
    return { text: 'Say “**set a timer for 10 minutes**” (seconds, minutes or hours).' };
  }

  /* ---------- morning brief ---------- */

  brief() {
    const cur = currencySymbol();
    const now = new Date();
    const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const today = (iso) => { const d = new Date(iso); return d >= now && d < dayEnd; };

    const bookings = listBookings().filter((b) => today(b.when));
    const reminders = listReminders().filter((r) => today(r.when));
    const plan = [...bookings.map((b) => `${iconFor(b.kind)} ${b.title} — ${new Date(b.when).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`),
                  ...reminders.map((r) => `⏰ ${r.text} — ${new Date(r.when).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`)];

    const { total } = personal.summarize(personal.monthExpenses(now));
    const budget = this.profile.spendBudget;
    const lists = store.get('lists', {});
    const open = Object.entries(lists).map(([n, items]) => [n, items.filter((i) => !i.done).length]).filter(([, c]) => c > 0);

    const name = this.profile.name ? `, ${this.profile.name}` : '';
    const parts = [`Good ${now.getHours() < 12 ? 'morning' : now.getHours() < 17 ? 'afternoon' : 'evening'}${name}! ☀️ ${now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}.`];
    parts.push(plan.length ? `**Today:**\n${plan.join('\n')}` : '**Today:** nothing scheduled — enjoy the open day.');
    if (total) parts.push(`**Spending this month:** ${cur}${total.toLocaleString()}${budget ? ` / ${cur}${(+budget).toLocaleString()}${total > budget ? ' 🔴' : ''}` : ''}`);
    if (open.length) parts.push(`**Open lists:** ${open.map(([n, c]) => `${n} (${c})`).join(', ')}`);
    return { text: parts.join('\n\n'), chips: ['Show my bookings', 'My spending', 'My lists', 'Help'] };
  }

  /* ---------- follow-up deal tweak ---------- */

  tweakLastDeal(candidate) {
    const skill = SKILLS[this.lastDeal.id];
    let slotName = null, value = null;
    for (const slot of skill.slots) {
      const v = slot.extract ? slot.extract(candidate) : null;
      if (v !== null && v !== undefined) { slotName = slot.name; value = v; break; }
    }
    if (!slotName) {
      const target = skill.slots.find((s) => PLACE_SLOTS.includes(s.name));
      if (target) {
        const v = target.parse(candidate);
        if (v !== null && v !== undefined) { slotName = target.name; value = v; }
      }
    }
    if (!slotName) return null;
    const values = { ...this.lastDeal.values, [slotName]: value };
    this.lastDeal = { id: this.lastDeal.id, values };
    return skill.finish(values, this);
  }

  /* ---------- slot-filling ---------- */

  startFlow(id, text) {
    const skill = SKILLS[id];
    this.flow = { id, values: {} };

    for (const slot of skill.slots) {
      const v = slot.extract ? slot.extract(text) : null;
      if (v !== null && v !== undefined) this.flow.values[slot.name] = v;
      else if (slot.profileKey && this.profile[slot.profileKey]) this.flow.values[slot.name] = this.profile[slot.profileKey];
    }
    if (id === 'reminder' && !('what' in this.flow.values)) {
      const seed = reminderSeed(text);
      if (seed) {
        const cleaned = cleanSeed(seed);
        if (cleaned.length > 1) this.flow.values.what = cleaned;
      }
    }
    return this.advance(skill.intro);
  }

  fillSlot(t) {
    const skill = SKILLS[this.flow.id];
    const slot = skill.slots.find((s) => !(s.name in this.flow.values));
    if (slot.optional && nlu.wantsSkip(t)) {
      this.flow.values[slot.name] = null;
      return this.advance();
    }
    const v = slot.parse(t);

    // Users often answer the narrow question with the whole request
    // ("on the weekend for a blood test after 12pm"). Mine every other
    // slot from the same message; explicit restatements override
    // earlier values, so the newest information always wins.
    const mined = {};
    for (const s of skill.slots) {
      if (s === slot || !s.extract) continue;
      const ev = s.extract(t);
      if (ev !== null && ev !== undefined) mined[s.name] = ev;
    }

    if (v === null || v === undefined) {
      // Not an answer to the question. A full fresh request for a
      // different skill switches flows instead of erroring out...
      const intent = nlu.detect(t);
      if (intent && SKILLS[intent] && intent !== this.flow.id && t.trim().split(/\s+/).length >= 4) {
        this.flow = null;
        return this.startFlow(intent, t);
      }
      // ...and a message that carried other details merges them and
      // moves on rather than complaining.
      if (Object.keys(mined).length) {
        Object.assign(this.flow.values, mined);
        return this.advance();
      }
      return { text: `Hmm, that didn’t parse. ${slot.q}\n(Or say **cancel**.)` };
    }
    this.flow.values[slot.name] = v;
    Object.assign(this.flow.values, mined);
    return this.advance();
  }

  /** Ask the next unfilled slot, or run the skill when complete. */
  advance(prefix) {
    const skill = SKILLS[this.flow.id];
    let next = skill.slots.find((s) => !(s.name in this.flow.values));
    // Hidden slots are never asked; a slot depending on a skipped slot is skipped too.
    while (next && (next.hidden || (next.dependsOn && this.flow.values[next.dependsOn] == null))) {
      this.flow.values[next.name] = null;
      next = skill.slots.find((s) => !(s.name in this.flow.values));
    }
    if (next) {
      return { text: (prefix ? prefix + '\n' : '') + next.q };
    }
    const values = this.flow.values;
    const id = this.flow.id;
    this.flow = null;
    if (DEAL_SKILLS.has(id)) {
      this.lastDeal = { id, values };
      const place = values.city || values.area || values.dest || values.to;
      if (typeof place === 'string' && place.trim()) this.context.place = place.split(/\s+or\s+/i)[0].trim();
    }
    return skill.finish(values, this);
  }

  smallTalk(t) {
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    if (/^how are you\b|^how's it going\b|^how do you do\b/i.test(t)) {
      return { text: pick(['Running light and fast — all 128 KB of me. \ud83d\ude04 What can I do for you?', 'Fully charged (I barely use any battery). What do you need?']) };
    }
    if (/\bwho (are you|made you|created you|built you)\b/i.test(t)) {
      return { text: 'I\u2019m **Kalki** \u2014 a personal assistant that lives entirely on your device. No accounts, no tracking; your data never leaves this phone. Say **help** to see everything I can do.' };
    }
    if (/\b(good ?night|going to (bed|sleep))\b/i.test(t)) {
      return { text: 'Good night! \ud83c\udf19 I\u2019ll keep your reminders warm.' };
    }
    if (/\b(i )?(love|like) (you|this app)\b|\byou('re| are) (awesome|great|amazing|the best)\b/i.test(t)) {
      return { text: pick(['\u2764\ufe0f Right back at you. Now let\u2019s save you some money.', 'Aww. \ud83e\udd70 Tell a friend \u2014 I fit in a text message.']) };
    }
    if (/\b(tell me a joke|another joke|joke|make me laugh|something funny)\b/i.test(t)) {
      return { text: pick([
        'Why don\u2019t scientists trust atoms? Because they make up everything. \ud83e\uddea',
        'I told my suitcase there\u2019s no vacation this year. Now I\u2019m dealing with emotional baggage. \ud83e\uddf3',
        'Why did the scarecrow win an award? He was outstanding in his field. \ud83c\udf3e',
        'Parallel lines have so much in common. Shame they\u2019ll never meet.',
        'I\u2019m reading a book about anti-gravity \u2014 impossible to put down. \ud83d\udcda',
      ]), chips: ['Another joke', 'Help'] };
    }
    return null;
  }

  showBookings() {
    const bookings = listBookings();
    const reminders = listReminders();
    if (!bookings.length && !reminders.length) {
      return { text: 'Nothing scheduled yet. Want to book something?', chips: ['Doctor appointment', 'Reserve a table', 'Track a bill', 'Set a reminder'] };
    }
    const lines = [
      ...bookings.map((b) => `${iconFor(b.kind)} **${b.title}** — ${fmtWhen(b.when)}`),
      ...reminders.map((r) => `⏰ ${r.text} — ${fmtWhen(r.when)}${r.repeat ? ` (${repeatLabel(r.repeat)})` : ''}`),
    ];
    return { text: 'Coming up:\n\n' + lines.join('\n'), open: 'bookings' };
  }
}
