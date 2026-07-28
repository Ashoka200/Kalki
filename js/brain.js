/* Dialog manager: routes each message to a skill, runs slot-filling
   conversations (ask only for what wasn't already said), and remembers
   the user's profile to pre-fill answers — the "thinks like a human" part.
   Also owns the single-turn skills: expenses, lists, timers, quick math,
   the morning brief, and follow-up tweaks to the last deal search. */
import * as nlu from './nlu.js';
import { SKILLS, reminderSeed, cleanSeed, listBookings, listReminders, fmtWhen, repeatLabel, addReminder, iconFor } from './skills.js';
import * as personal from './personal.js';
import { currencySymbol } from './regions.js';
import { store } from './store.js';

const MAIN_CHIPS = ['Morning brief', 'My spending', 'Shopping list', 'My habits', 'Find a rental', 'Shopping deals', 'Groceries', 'Book a ride', 'Book a hotel', 'Find flights', 'Events near me', 'Find a job', 'Medication prices', 'Fuel prices', 'Used car deals', 'Health insurance', 'Doctor appointment', 'Reserve a table', 'Book a game court', 'Track a bill', 'Set a timer', 'Set a reminder'];

/* Deal searches remember their last run so "what about mumbai?" works. */
const DEAL_SKILLS = new Set(['rent', 'hotel', 'flight', 'events', 'shopping', 'groceries', 'rides', 'jobs', 'meds', 'gas', 'usedcar', 'insurance']);
/* Which slot a bare follow-up like "what about pune" most likely replaces. */
const PLACE_SLOTS = ['city', 'area', 'to', 'item', 'items', 'model', 'role', 'drug', 'venue'];

export class Brain {
  constructor() {
    this.flow = null; // { id, values: {name: value} }
    this.lastBooking = null; // most recent booking made this session
    this.lastDeal = null; // { id, values } of the last completed deal search
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
    const t = text.trim();
    if (!t) return null;

    if (this.flow) {
      if (nlu.wantsCancel(t)) {
        this.flow = null;
        return { text: 'Okay, cancelled. What else can I do?', chips: MAIN_CHIPS };
      }
      return this.fillSlot(t);
    }

    // Quick math — tip, split, percent, arithmetic. No flow, instant.
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

    // Follow-up tweak to the last deal search: "what about mumbai?"
    const follow = t.match(/^(?:what about|how about|try|same (?:but|for)|now)\s+(.+?)\??$/i);
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
          text: 'Here’s my full range:\n\n**🌅 Morning brief** — say “good morning”: today’s plan, spending, lists\n**💰 Spending** — “spent $40 on groceries” logs it; “my spending” shows the month vs budget\n**📝 Lists** — “add milk to shopping list”, “check off milk”, any number of named lists\n**💪 Habits** — “track habit workout”, then “did workout” daily; streaks with 🔥\n**🔎 Chat search** — “search chat for rent”\n**⏱️ Timers** — “set a timer for 10 minutes”\n**🧮 Math** — “15% tip on 84”, “split 1840 between 4”, any arithmetic\n**🧠 Ask anything** — add your Claude API key in ⚙️ Settings and I’ll answer questions my built-in skills can’t\n**🏠 Rent · 🛍️ Shopping · 🛒 Groceries · 🚗 Rides · 🏨 Hotels · ✈️ Flights** — deals with your region’s marketplaces\n**💼 Jobs · 💊 Medication · ⛽ Fuel · 🚙 Used cars · 🩺 Insurance** — more region-aware deal hunting\n**🎪 Events · 🏥 Appointments · 🍽️ Reservations · 🎾 Courts** — find & book, calendar export with alarms\n**🧾 Bills** — recurring due-date reminders + negotiation scripts\n**⏰ Reminders** — “in 2 hours”, “every Friday 9am”, “remind me 2 hours before”\n\nAfter any search, tweak it: “**what about mumbai?**”, “**try 2 bedrooms**”.\n\n🕵️ Deal links have a ⧉ copy button — paste into a **private window** so sites can’t inflate prices.\n\nI learn too: “my name is …”, “I live in …”. Set **region** in ⚙️ Settings. Say **cancel** to stop any flow.',
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
    const e = personal.parseExpense(t);
    if (e) {
      personal.addExpense(e);
      const { total } = personal.summarize(personal.monthExpenses());
      const budget = this.profile.spendBudget;
      const vs = budget ? ` of your ${cur}${(+budget).toLocaleString()} budget${total > budget ? ' — **over budget!**' : ''}` : '';
      return {
        text: `Logged 💸 **${cur}${e.amt.toLocaleString()}** on **${e.note}** (${e.cat}).\nThis month: **${cur}${total.toLocaleString()}**${vs}.`,
        chips: ['My spending', 'Set a spending budget', 'Help'],
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
    const id = this.flow.id;
    this.flow = null;
    if (DEAL_SKILLS.has(id)) this.lastDeal = { id, values };
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
