/* Kalki's AI brain. Two paths, no user setup required:

   1. Hosted (default): the app POSTs to /api/ask — a serverless function
      deployed with the site that holds the site owner's API key. Users
      never configure anything; it just works over the internet.
   2. Personal key (optional override): a user can paste their own
      Anthropic API key in Settings; then calls go directly from the
      browser to Anthropic (works even in the single-file build).

   If neither is available (e.g. the single file opened offline), the
   rule-based skills keep working and unmatched messages get the plain
   built-in fallback. */
import { store } from './store.js';
import { getRegion } from './regions.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const HOSTED_URL = 'api/ask'; // relative — same origin as the deployed site
const MODEL = 'claude-haiku-4-5-20251001';

// Remembered per session so a missing backend costs one failed probe, not
// a spinner on every unmatched message.
let hostedDown = false;

const hasKey = () => !!store.get('profile', {}).apiKey;
export const enabled = () => hasKey() || !hostedDown;

const unavailable = (msg) => Object.assign(new Error(msg), { unavailable: true });

function profileFacts() {
  const p = store.get('profile', {});
  return { name: p.name, city: p.city, region: getRegion() };
}

function systemPrompt() {
  const p = store.get('profile', {});
  const facts = [
    p.name && `The user's name is ${p.name}.`,
    p.city && `They live in ${p.city}.`,
    `Their region is ${getRegion().toUpperCase()}.`,
  ].filter(Boolean).join(' ');
  return `You are Kalki, a personal assistant living inside a tiny on-device app on the user's phone. ${facts}
Kalki's built-in skills already handle: deal hunting (rent, shopping, groceries, hotels, flights, rides, jobs, medication, fuel, used cars, insurance), bookings, reminders, timers, lists, expenses, habits and a morning brief — so for those, briefly point the user to the built-in phrasing (e.g. "say: find a rental in Pune"). For everything else — questions, advice, ideas, explanations, translations — answer directly.
Keep replies short and mobile-friendly (a few sentences). Use **bold** sparingly for emphasis; no headers or tables.`;
}

/** Recent conversation as Claude messages. */
function recentHistory(limit = 8) {
  return store.get('messages', []).slice(-limit)
    .filter((m) => m.t)
    .map((m) => ({ role: m.r === 'u' ? 'user' : 'assistant', content: m.t }));
}

/** Ask via the site's own serverless function — no user key involved. */
async function askHosted(text) {
  let res;
  try {
    res = await fetch(HOSTED_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, history: recentHistory(), facts: profileFacts() }),
    });
  } catch {
    hostedDown = true;
    throw unavailable('No AI backend reachable.');
  }
  if ([404, 405, 501, 503].includes(res.status)) {
    hostedDown = true;
    throw unavailable('No AI backend on this deployment.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error(data?.error || `Backend error ${res.status}`);
  if (data.error === 'declined') throw new Error('Claude declined to answer that.');
  if (!data.reply) throw new Error(data.error || 'Empty reply');
  return data.reply;
}

/** Ask directly with the user's own key (Settings → Claude brain). */
async function askDirect(text) {
  const key = store.get('profile', {}).apiKey;
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      // Required for browser (CORS) calls with a user-provided key.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt(),
      messages: [...recentHistory(), { role: 'user', content: text }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error?.message || `API error ${res.status}`);
  }
  const data = await res.json();
  if (data.stop_reason === 'refusal') throw new Error('Claude declined to answer that.');
  const reply = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (!reply) throw new Error('Empty reply');
  return reply;
}

/** Ask Claude. Personal key wins if set; otherwise the hosted backend.
    Throws (with .unavailable on missing-backend) on failure. */
export function ask(text) {
  return hasKey() ? askDirect(text) : askHosted(text);
}

/** Route a message through the hosted brain. Returns either
    { intent, details } — start that skill's flow — or { reply } — show the
    text. The model decides which. Personal-key users (no hosted backend)
    can't route server-side, so they get a plain answer instead.
    Throws (with .unavailable) when no AI is reachable. */
export async function route(text) {
  if (hasKey()) return { reply: await askDirect(text) };
  let res;
  try {
    res = await fetch(HOSTED_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, route: true, history: recentHistory(), facts: profileFacts() }),
    });
  } catch {
    hostedDown = true;
    throw unavailable('No AI backend reachable.');
  }
  if ([404, 405, 501, 503].includes(res.status)) {
    hostedDown = true;
    throw unavailable('No AI backend on this deployment.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error(data?.error || `Backend error ${res.status}`);
  if (data.error === 'declined') throw new Error('Claude declined to answer that.');
  return data; // { intent, details } | { reply }
}
