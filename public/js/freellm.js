/* Free web answers — general questions without any API key. OFF by default.

   Uses public LLM endpoints that allow anonymous, keyless use:
     • Pollinations (text.pollinations.ai) — open source, browser-friendly,
       anonymous tier: ~1 request every 6 s.
     • OVHcloud AI Endpoints — documented anonymous tier, ~2 requests/min.
   These are rate-limited and unverified, so replies are clearly labelled and
   the app never depends on them: when they are busy or unreachable, Kalki
   offers a web search instead. Services that only work by reverse-
   engineering (e.g. duck.ai) are deliberately not used. */
import { store } from './store.js';

const SPACING_MS = 6500;
const TIMEOUT_MS = 20000;

const PROVIDERS = [
  {
    name: 'Pollinations',
    url: 'https://text.pollinations.ai/openai',
    body: (messages) => ({ model: 'openai', messages, seed: 7 }),
  },
  {
    name: 'OVHcloud',
    url: 'https://llama-3-1-8b-instruct.endpoints.kepler.ai.cloud.ovh.net/api/openai_compat/v1/chat/completions',
    body: (messages) => ({ model: 'Llama-3.1-8B-Instruct', messages, max_tokens: 300, temperature: 0.3 }),
  },
];

export const enabled = () => store.get('profile', {}).freeAnswers === true;

let lastCall = 0;
let cursor = 0;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function callProvider(p, messages) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(p.url, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(p.body(messages)),
    });
    if (!res.ok) throw new Error(`${p.name} ${res.status}`);
    const data = await res.json();
    const text = (data.choices?.[0]?.message?.content || '').trim();
    if (!text) throw new Error(`${p.name} empty`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/** Ask the free providers in turn. Resolves { text, provider }; throws when
    all fail (offline, rate-limited, blocked). */
export async function answer(text) {
  const p = store.get('profile', {});
  const messages = [
    { role: 'system', content: `You are Kalki, a concise personal assistant on a phone.${p.city ? ` The user lives in ${p.city}.` : ''} Answer in a few short sentences. No headers or tables.` },
    { role: 'user', content: text.slice(0, 1500) },
  ];
  const gap = SPACING_MS - (Date.now() - lastCall);
  if (gap > 0) await wait(gap);
  lastCall = Date.now();
  let lastErr = null;
  for (let i = 0; i < PROVIDERS.length; i++) {
    const prov = PROVIDERS[(cursor + i) % PROVIDERS.length];
    try {
      const out = await callProvider(prov, messages);
      cursor = (cursor + i + 1) % PROVIDERS.length; // rotate away from the one just used
      return { text: out, provider: prov.name };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('no free provider reachable');
}
