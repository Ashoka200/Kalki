/* Personal data skills: expense tracking, named lists, and timers.
   Pure parsers are exported separately from the store-backed operations
   so they can be unit-tested in Node. */
import { store } from './store.js';
import { parseMoney } from './nlu.js';

/* ---------- expenses ---------- */

const CATEGORIES = {
  groceries: /grocer|vegetable|fruit|milk|supermarket|bigbasket|instacart/,
  food: /food|lunch|dinner|breakfast|coffee|chai|tea|snack|restaurant|zomato|swiggy|pizza|burger|meal/,
  transport: /uber|ola|lyft|taxi|cab|bus|train|metro|fuel|petrol|gas|diesel|parking|toll|auto\b/,
  rent: /rent\b|lease/,
  utilities: /electric|water bill|internet|wifi|phone|mobile|recharge|utility|broadband/,
  health: /doctor|medicine|pharmacy|hospital|dentist|gym|clinic/,
  entertainment: /movie|netflix|spotify|game|concert|party|club|subscription/,
  shopping: /clothes|shoes|amazon|flipkart|mall|gadget|electronics/,
};

export function categorize(note) {
  const t = (note || '').toLowerCase();
  for (const [cat, re] of Object.entries(CATEGORIES)) if (re.test(t)) return cat;
  return 'other';
}

/** "spent $40 on groceries" / "paid 250 for chai" / "add expense 120 taxi"
    → { amt, note, cat } or null. */
export function parseExpense(text) {
  const m = text.match(/\b(?:spent|paid|blew|bought .*? for|add(?:ed)? expense|expense of|log)\s*\$?([\d][\d,]*(?:\.\d+)?k?)\s*(?:rs\.?|rupees|dollars|pounds|bucks)?\s*(?:on|for|at|-)?\s*(.*)$/i)
       || text.match(/^\$?([\d][\d,]*(?:\.\d+)?k?)\s+(?:on|for)\s+(.+)$/i);
  if (!m) return null;
  const amt = parseMoney(m[1]);
  if (!amt) return null;
  const note = (m[2] || '').replace(/\b(today|yesterday|this morning)\b/gi, '').trim() || 'expense';
  return { amt, note, cat: categorize(note) };
}

export function addExpense(e) {
  const all = store.get('expenses', []);
  const rec = { id: Date.now().toString(36), ...e, ts: e.ts || Date.now() };
  all.push(rec);
  store.set('expenses', all);
  return rec;
}
export function listExpenses() { return store.get('expenses', []); }
export function removeExpense(id) {
  store.set('expenses', store.get('expenses', []).filter((e) => e.id !== id));
}

/** This month's expenses, newest first. */
export function monthExpenses(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return listExpenses().filter((e) => e.ts >= start).sort((a, b) => b.ts - a.ts);
}

export function summarize(expenses) {
  const total = expenses.reduce((s, e) => s + e.amt, 0);
  const byCat = {};
  for (const e of expenses) byCat[e.cat] = (byCat[e.cat] || 0) + e.amt;
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  return { total, cats, count: expenses.length };
}

export function expensesCSV(expenses) {
  const esc = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  return ['date,amount,category,note',
    ...expenses.map((e) => `${new Date(e.ts).toISOString().slice(0, 10)},${e.amt},${e.cat},${esc(e.note)}`),
  ].join('\n');
}

/* ---------- lists ---------- */

/** Parse a list command → { op, item?, list } or null.
    Ops: add, remove, check, show, clear, overview. */
export function parseListCmd(text) {
  const t = text.trim();
  let m = t.match(/^add\s+(.+?)\s+to\s+(?:my\s+)?(?:([\w ]+?)\s+)?list$/i);
  if (m) return { op: 'add', item: m[1], list: (m[2] || 'shopping').toLowerCase() };
  m = t.match(/^(?:remove|delete)\s+(.+?)\s+from\s+(?:my\s+)?(?:([\w ]+?)\s+)?list$/i);
  if (m) return { op: 'remove', item: m[1], list: (m[2] || 'shopping').toLowerCase() };
  m = t.match(/^(?:check(?:\s+off)?|tick|mark)\s+(.+?)(?:\s+(?:as\s+)?done)?(?:\s+(?:on|from)\s+(?:my\s+)?(?:([\w ]+?)\s+)?list)?$/i);
  if (m && /\b(check|tick|mark)\b/i.test(t)) return { op: 'check', item: m[1].replace(/\s+(as\s+)?done$/i, ''), list: (m[2] || 'shopping').toLowerCase() };
  m = t.match(/^(?:show|open|read)\s+(?:my\s+)?(?:([\w ]+?)\s+)?list$/i)
   || t.match(/^what'?s\s+(?:on|in)\s+(?:my\s+)?(?:([\w ]+?)\s+)?list\??$/i);
  if (m) return { op: 'show', list: (m[1] || 'shopping').toLowerCase() };
  m = t.match(/^clear\s+(?:my\s+)?(?:([\w ]+?)\s+)?list$/i);
  if (m) return { op: 'clear', list: (m[1] || 'shopping').toLowerCase() };
  if (/^(?:show\s+)?(?:my\s+)?lists$/i.test(t)) return { op: 'overview' };
  return null;
}

const getLists = () => store.get('lists', {});
const setLists = (l) => store.set('lists', l);

export function runListCmd(cmd) {
  const lists = getLists();
  const name = cmd.list;
  switch (cmd.op) {
    case 'add': {
      (lists[name] = lists[name] || []).push({ t: cmd.item, done: false });
      setLists(lists);
      return { done: true, text: `Added **${cmd.item}** to your ${name} list (${lists[name].length} item${lists[name].length > 1 ? 's' : ''}).` };
    }
    case 'remove': {
      if (!lists[name]) return { done: false, text: `You don’t have a ${name} list yet.` };
      const before = lists[name].length;
      lists[name] = lists[name].filter((i) => i.t.toLowerCase() !== cmd.item.toLowerCase());
      if (lists[name].length === before) return { done: false, text: `Couldn’t find “${cmd.item}” on your ${name} list.` };
      if (!lists[name].length) delete lists[name];
      setLists(lists);
      return { done: true, text: `Removed **${cmd.item}** from your ${name} list.` };
    }
    case 'check': {
      const it = (lists[name] || []).find((i) => i.t.toLowerCase() === cmd.item.toLowerCase());
      if (!it) return { done: false, text: `Couldn’t find “${cmd.item}” on your ${name} list.` };
      it.done = true;
      setLists(lists);
      return { done: true, text: `☑ **${cmd.item}** — done.` };
    }
    case 'show': {
      const items = lists[name];
      if (!items || !items.length) return { done: false, text: `Your ${name} list is empty. Say “add ⟨something⟩ to ${name} list”.` };
      const lines = items.map((i) => `${i.done ? '☑' : '☐'} ${i.t}`);
      return { done: true, text: `**${cap(name)} list** (${items.filter((i) => !i.done).length} to go):\n\n${lines.join('\n')}` };
    }
    case 'clear': {
      delete lists[name];
      setLists(lists);
      return { done: true, text: `Cleared your ${name} list.` };
    }
    case 'overview': {
      const names = Object.keys(lists);
      if (!names.length) return { done: false, text: 'No lists yet. Say “add milk to shopping list” to start one.' };
      return { done: true, text: 'Your lists:\n\n' + names.map((n) => `📝 **${cap(n)}** — ${lists[n].filter((i) => !i.done).length} open / ${lists[n].length} total`).join('\n') };
    }
  }
}

/* ---------- timers ---------- */

/** "set a timer for 10 minutes" / "20 min timer" → seconds, or null. */
export function parseTimer(text) {
  const m = text.match(/\btimer\b.*?\bfor\s+(\d{1,3})\s*(sec(?:ond)?s?|min(?:ute)?s?|h(?:ou)?rs?)\b/i)
       || text.match(/\b(\d{1,3})\s*(sec(?:ond)?s?|min(?:ute)?s?|h(?:ou)?rs?)\s+timer\b/i);
  if (!m) return null;
  const n = +m[1];
  const u = m[2][0].toLowerCase();
  return n * (u === 's' ? 1 : u === 'h' ? 3600 : 60);
}

export function addTimer(seconds, label) {
  const all = store.get('timers', []);
  const t = { id: Date.now().toString(36), label: label || fmtDur(seconds), end: Date.now() + seconds * 1000 };
  all.push(t);
  store.set('timers', all);
  return t;
}
export function listTimers() { return store.get('timers', []); }
export function clearTimers() { store.remove('timers'); }

/** Timers that have finished; removes them from the store. */
export function popDueTimers(now = Date.now()) {
  const all = store.get('timers', []);
  const due = all.filter((t) => t.end <= now);
  if (due.length) store.set('timers', all.filter((t) => t.end > now));
  return due;
}

export function fmtDur(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1).replace('.0', '')} h`;
}

/* ---------- habits ---------- */

const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Parse a habit command → { op, name? } or null.
    'log' only fires for names that exist (checked in runHabitCmd). */
export function parseHabitCmd(text) {
  const t = text.trim();
  let m = t.match(/^(?:start\s+)?track(?:ing)?\s+(?:a\s+)?(?:new\s+)?habit:?\s+(.+)$/i)
       || t.match(/^(?:add|new)\s+habit:?\s+(.+)$/i);
  if (m) return { op: 'add', name: m[1].toLowerCase() };
  m = t.match(/^(?:stop tracking|drop|remove)\s+(?:habit\s+)?(.+?)(?:\s+habit)?$/i);
  if (m && /habit/i.test(t)) return { op: 'remove', name: m[1].toLowerCase() };
  if (/^(?:show\s+)?(?:my\s+)?(?:habits?|streaks?)$/i.test(t)) return { op: 'show' };
  m = t.match(/^(?:i\s+)?(?:did|done|completed?|logged?)\s+(?:my\s+)?(.+?)(?:\s+today)?[.!]?$/i);
  if (m) return { op: 'log', name: m[1].toLowerCase() };
  return null;
}

const getHabits = () => store.get('habits', {});
const setHabits = (h) => store.set('habits', h);

/** Consecutive-day streak ending today or yesterday. */
export function streakOf(days, now = new Date()) {
  const set = new Set(days);
  const d = new Date(now);
  if (!set.has(dayKey(d))) d.setDate(d.getDate() - 1); // today not logged yet → count from yesterday
  let n = 0;
  while (set.has(dayKey(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export function runHabitCmd(cmd, now = new Date()) {
  const habits = getHabits();
  switch (cmd.op) {
    case 'add': {
      if (habits[cmd.name]) return { done: false, text: `Already tracking **${cmd.name}**.` };
      habits[cmd.name] = [];
      setHabits(habits);
      return { done: true, text: `Tracking **${cmd.name}** 💪 — tell me “did ${cmd.name}” each day you do it and I’ll keep your streak.` };
    }
    case 'log': {
      if (!(cmd.name in habits)) return { done: false, unknown: true };
      const today = dayKey(now);
      if (habits[cmd.name].includes(today)) {
        return { done: true, text: `Already logged **${cmd.name}** today. 🔥 Streak: **${streakOf(habits[cmd.name], now)}**.` };
      }
      habits[cmd.name].push(today);
      setHabits(habits);
      const s = streakOf(habits[cmd.name], now);
      return { done: true, text: `Logged ✅ **${cmd.name}** — 🔥 streak: **${s} day${s > 1 ? 's' : ''}** (${habits[cmd.name].length} total).` };
    }
    case 'remove': {
      if (!(cmd.name in habits)) return { done: false, text: `Not tracking “${cmd.name}”.` };
      delete habits[cmd.name];
      setHabits(habits);
      return { done: true, text: `Stopped tracking **${cmd.name}**.` };
    }
    case 'show': {
      const names = Object.keys(habits);
      if (!names.length) return { done: false, text: 'No habits yet. Say “**track habit workout**” to start one.' };
      const lines = names.map((n) => {
        const s = streakOf(habits[n], now);
        return `${s > 0 ? '🔥' : '⚪'} **${cap(n)}** — ${s} day streak (${habits[n].length} total)`;
      });
      return { done: true, text: 'Your habits:\n\n' + lines.join('\n') };
    }
  }
}

/* ---------- chat search ---------- */

/** "search chat for rent" → query, or null. Requires the chat/history word
    so it never hijacks deal searches like "search for flights". */
export function parseSearchCmd(text) {
  const m = text.trim().match(/^(?:search|find)\s+(?:my\s+)?(?:chat|messages?|history)\s+(?:for\s+)?(.+)$/i);
  return m ? m[1].trim() : null;
}

export function searchChat(query) {
  const q = query.toLowerCase();
  const hits = store.get('messages', [])
    .filter((m) => m.t && m.t.toLowerCase().includes(q)
      && !/^(?:search|find)\s+(?:my\s+)?(?:chat|messages?|history)/i.test(m.t))
    .slice(-5)
    .reverse();
  if (!hits.length) return `Nothing in the chat matches “${query}”.`;
  const lines = hits.map((m) => {
    const when = new Date(m.ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
    const text = m.t.replace(/\*\*/g, '').replace(/\s+/g, ' ').slice(0, 80);
    return `${m.r === 'u' ? '🙂' : '🤖'} ${when}: ${text}${m.t.length > 80 ? '…' : ''}`;
  });
  return `Found ${hits.length} match${hits.length > 1 ? 'es' : ''} for “${query}”:\n\n${lines.join('\n')}`;
}

/* ---------- quick math ---------- */

/** Tip/split/percent/arithmetic → answer string, or null. */
export function quickMath(text) {
  const t = text.toLowerCase().replace(/[,₹£$]/g, '');
  let m = t.match(/(\d+(?:\.\d+)?)\s*%\s*(?:tip\s*)?(?:on|of)\s*(\d+(?:\.\d+)?)/);
  if (m) {
    const [p, base] = [+m[1], +m[2]];
    const part = base * p / 100;
    return /tip/.test(t)
      ? `${p}% tip on ${base} = **${round(part)}** (total **${round(base + part)}**)`
      : `${p}% of ${base} = **${round(part)}**`;
  }
  m = t.match(/split\s+(\d+(?:\.\d+)?)\s+(?:between|among|by)\s+(\d{1,2})(?:.*?(\d+(?:\.\d+)?)\s*%\s*tip)?/);
  if (m) {
    const total = +m[1] * (m[3] ? 1 + +m[3] / 100 : 1);
    const each = total / +m[2];
    return `${m[3] ? `With ${m[3]}% tip, ` : ''}**${round(each)} each** (${m[2]} ways of ${round(total)}).`;
  }
  m = t.match(/^(?:what'?s\s+|calculate\s+|calc\s+)?([\d\s+\-*/().]+)$/);
  if (m && /\d\s*[+\-*/]\s*\d/.test(m[1])) {
    try {
      const v = Function('"use strict"; return (' + m[1].replace(/[^-\d\s+*/().]/g, '') + ')')();
      if (Number.isFinite(v)) return `= **${round(v)}**`;
    } catch { /* not an expression after all */ }
  }
  return null;
}

const round = (n) => (Math.round(n * 100) / 100).toLocaleString('en-US');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
