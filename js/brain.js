/* Dialog manager: routes each message to a skill, runs slot-filling
   conversations (ask only for what wasn't already said), and remembers
   the user's profile to pre-fill answers — the "thinks like a human" part. */
import * as nlu from './nlu.js';
import { SKILLS, reminderSeed, cleanSeed, listBookings, listReminders, fmtWhen, repeatLabel, addReminder, iconFor } from './skills.js';
import { store } from './store.js';

const MAIN_CHIPS = ['Find a rental', 'Shopping deals', 'Groceries', 'Book a ride', 'Book a hotel', 'Find flights', 'Events near me', 'Find a job', 'Medication prices', 'Fuel prices', 'Used car deals', 'Health insurance', 'Doctor appointment', 'Reserve a table', 'Book a game court', 'Track a bill', 'Set a reminder'];

export class Brain {
  constructor() {
    this.flow = null; // { id, values: {name: value} }
    this.lastBooking = null; // most recent booking made this session
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
      text: `Hey${name}! I’m **Kalki**, your on-device assistant. I hunt deals (rent, shopping, groceries, rides, cars, medication…), book appointments and tables, track bills and remember things for you — all stored only on this phone.\n\nWhat do you need?`,
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
          text: 'Here’s my full range:\n\n**🏠 Rent deals** — best rental sites for your region, pre-filtered\n**🛍️ Shopping deals** — price history, coupons, cash-back stacking\n**🛒 Groceries** — compare delivery apps & store prices\n**🚗 Rides** — Uber/Ola/Lyft with your destination pre-set, fare tricks\n**🏨 Hotels** — date-filled comparisons + call-direct discount trick\n**✈️ Flights** — fare alerts, flexible dates, regional booking sites\n**💼 Jobs** — pre-filled searches on the boards that matter here\n**💊 Medication prices** — generics, coupons, pharmacy comparison\n**⛽ Fuel prices** — cheapest stations nearby\n**🚙 Used cars** — inspected-car sites + negotiation rules\n**🎪 Events & festivals** — what’s on, free-entry tricks\n**🩺 Health insurance** — compare plans for your area\n**🏥 Appointments** — book, calendar export with built-in alarm\n**🍽️ Reservations** — tables + regional booking apps\n**🎾 Game courts** — find & pencil in games\n**🧾 Bill tracker** — recurring due-date reminders + negotiation scripts\n**⏰ Reminders** — “in 2 hours”, “every Friday 9am”, all understood\n\n🕵️ Deal links come with a ⧉ copy button — paste them into a **private/incognito window** so sites can’t inflate prices on repeat searches.\n\nI also learn: tell me “my name is …”, “I live in …”, “my budget is …”. Set your **region** in ⚙️ Settings for local marketplaces. Say **cancel** anytime to stop a flow.',
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
    // Hidden slots are never asked; a slot depending on a skipped slot is skipped too.
    while (next && (next.hidden || (next.dependsOn && this.flow.values[next.dependsOn] == null))) {
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
      return { text: 'Nothing scheduled yet. Want to book something?', chips: ['Doctor appointment', 'Reserve a table', 'Track a bill', 'Set a reminder'] };
    }
    const lines = [
      ...bookings.map((b) => `${iconFor(b.kind)} **${b.title}** — ${fmtWhen(b.when)}`),
      ...reminders.map((r) => `⏰ ${r.text} — ${fmtWhen(r.when)}${r.repeat ? ` (${repeatLabel(r.repeat)})` : ''}`),
    ];
    return { text: 'Coming up:\n\n' + lines.join('\n'), open: 'bookings' };
  }
}
