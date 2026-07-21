/* Dialog manager: routes each message to a skill, runs slot-filling
   conversations (ask only for what wasn't already said), and remembers
   the user's profile to pre-fill answers — the "thinks like a human" part. */
import * as nlu from './nlu.js';
import { SKILLS, reminderSeed, listBookings, listReminders, fmtWhen, addReminder, iconFor } from './skills.js';
import { store } from './store.js';

const MAIN_CHIPS = ['Find a rental deal', 'Shopping deals', 'Book a hotel', 'Find flights', 'Events near me', 'Health insurance', 'Book hospital appointment', 'Reserve a table', 'Book a game court', 'Set a reminder'];

export class Brain {
  constructor() {
    this.flow = null; // { id, values: {name: value}, }
  }

  get profile() { return store.get('profile', {}); }
  setProfile(patch) { store.set('profile', { ...this.profile, ...patch }); }

  /** 24h heads-up for a booking, if that's still in the future. */
  remindBefore(booking) {
    const t = new Date(booking.when).getTime() - 24 * 3600 * 1000;
    if (t > Date.now()) addReminder(`Tomorrow: ${booking.title}`, new Date(t).toISOString());
  }

  welcome() {
    const name = this.profile.name ? `, ${this.profile.name}` : '';
    return {
      text: `Hey${name}! I’m **Kalki**, your on-device assistant. I hunt deals (rent, shopping, health insurance), book hospital appointments and restaurant tables, and remember things for you — all stored only on this phone.\n\nWhat do you need?`,
      chips: MAIN_CHIPS,
    };
  }

  handle(text) {
    const t = text.trim();
    if (!t) return null;

    if (this.flow) {
      if (nlu.wantsCancel(t)) {
        this.flow = null;
        return { text: 'Okay, cancelled. What else can I do?', chips: MAIN_CHIPS };
      }
      return this.fillSlot(t);
    }

    const fact = nlu.detectProfileFact(t);
    if (fact) {
      this.setProfile({ [fact.key]: fact.value });
      const ack = { name: `Nice to meet you, ${fact.value}! 👋`, city: `Got it — you’re in ${fact.value}.`, budget: `Noted — budget around $${(+fact.value).toLocaleString()}.` };
      return { text: ack[fact.key] + ' I’ll remember that.', chips: MAIN_CHIPS };
    }

    const intent = nlu.detect(t);
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
      case 'help':
        return {
          text: 'Here’s my full range:\n\n**🏠 Rent deals** — best rental sites, pre-filtered for your city and budget\n**🛍️ Shopping deals** — price history, coupons, cash-back stacking\n**🏨 Hotels** — date-filled comparisons + call-direct discount trick\n**✈️ Flights** — fare alerts, flexible dates, student fares\n**🎪 Events & festivals** — what’s on in any area, free-entry tricks\n**🩺 Health insurance** — marketplace plans + subsidy check for your ZIP\n**🏥 Hospital appointments** — book, calendar export, auto-reminder\n**🍽️ Reservations** — restaurant tables with OpenTable handoff\n**🎾 Game courts** — tennis/badminton/basketball & more, off-peak savings\n**⏰ Reminders** — on-device notifications\n\n🕵️ Deal links come with a ⧉ copy button — paste them into a **private/incognito window** so sites can’t inflate prices on repeat searches.\n\nI also learn: tell me “my name is …”, “I live in …”, “my budget is …”. Say **cancel** anytime to stop a flow.',
          chips: MAIN_CHIPS,
        };
      default:
        return {
          text: 'I didn’t quite catch that. I’m best at deals, bookings and reminders — pick one below or say **help**.',
          chips: MAIN_CHIPS,
        };
    }
  }

  startFlow(id, text) {
    const skill = SKILLS[id];
    this.flow = { id, values: {} };

    for (const slot of skill.slots) {
      const v = slot.extract(text);
      if (v !== null && v !== undefined) this.flow.values[slot.name] = v;
      else if (slot.profileKey && this.profile[slot.profileKey]) this.flow.values[slot.name] = this.profile[slot.profileKey];
    }
    if (id === 'reminder' && !('what' in this.flow.values)) {
      const seed = reminderSeed(text);
      if (seed) {
        const cleaned = seed.replace(/\b(today|tonight|tomorrow|at \d{1,2}(:\d{2})?\s*(am|pm)?)\b/gi, '').replace(/\s+/g, ' ').trim();
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
    if (v === null || v === undefined) {
      return { text: `Hmm, that didn’t parse. ${slot.q}\n(Or say **cancel**.)` };
    }
    this.flow.values[slot.name] = v;
    return this.advance();
  }

  /** Ask the next unfilled slot, or run the skill when complete. */
  advance(prefix) {
    const skill = SKILLS[this.flow.id];
    let next = skill.slots.find((s) => !(s.name in this.flow.values));
    // A slot that depends on a skipped slot is skipped too (e.g. time without a date).
    while (next && next.dependsOn && this.flow.values[next.dependsOn] == null) {
      this.flow.values[next.name] = null;
      next = skill.slots.find((s) => !(s.name in this.flow.values));
    }
    if (next) {
      return { text: (prefix ? prefix + '\n' : '') + next.q };
    }
    const values = this.flow.values;
    this.flow = null;
    return skill.finish(values, this);
  }

  showBookings() {
    const bookings = listBookings();
    const reminders = listReminders();
    if (!bookings.length && !reminders.length) {
      return { text: 'Nothing scheduled yet. Want to book something?', chips: ['Book hospital appointment', 'Reserve a table', 'Set a reminder'] };
    }
    const lines = [
      ...bookings.map((b) => `${iconFor(b.kind)} **${b.title}** — ${fmtWhen(b.when)}`),
      ...reminders.map((r) => `⏰ ${r.text} — ${fmtWhen(r.when)}`),
    ];
    return { text: 'Coming up:\n\n' + lines.join('\n'), open: 'bookings' };
  }
}
