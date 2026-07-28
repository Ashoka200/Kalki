/* Optional Claude-powered brain. Kalki works 100% offline without this;
   when the user pastes their own Anthropic API key in Settings, messages
   the rule-based NLU can't handle are answered by Claude instead of the
   generic fallback. The key is stored only in this device's localStorage
   and requests go directly from the browser to Anthropic — no middleman.
   Raw fetch (not the SDK) keeps Kalki's zero-dependency, no-build design. */
import { store } from './store.js';
import { getRegion } from './regions.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-5';

export const hasKey = () => !!store.get('profile', {}).apiKey;

function systemPrompt() {
  const p = store.get('profile', {});
  const facts = [
    p.name && `The user's name is ${p.name}.`,
    p.city && `They live in ${p.city}.`,
    `Their region is ${getRegion().toUpperCase()}.`,
  ].filter(Boolean).join(' ');
  return `You are Kalki, a personal assistant living inside a tiny on-device app on the user's phone. ${facts}
Kalki's built-in skills already handle: deal hunting (rent, shopping, groceries, hotels, flights, rides, jobs, medication, fuel, used cars, insurance), bookings, reminders, timers, lists, expenses and a morning brief — so for those, briefly point the user to the built-in phrasing (e.g. "say: find a rental in Pune"). For everything else — questions, advice, ideas, explanations, translations — answer directly.
Keep replies short and mobile-friendly (a few sentences). Use **bold** sparingly for emphasis; no headers or tables.`;
}

/** Recent conversation as Claude messages (user/assistant alternating-ish). */
function recentHistory(limit = 8) {
  const msgs = store.get('messages', []).slice(-limit);
  return msgs
    .filter((m) => m.t)
    .map((m) => ({ role: m.r === 'u' ? 'user' : 'assistant', content: m.t }));
}

/** Ask Claude. Returns reply text, or throws on any failure. */
export async function ask(text) {
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
  if (data.stop_reason === 'refusal') {
    throw new Error('Claude declined to answer that.');
  }
  const reply = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (!reply) throw new Error('Empty reply');
  return reply;
}
