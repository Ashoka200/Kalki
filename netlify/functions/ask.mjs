/* Kalki's hosted brain: a serverless proxy so users never need their own
   API key. The site owner sets ANTHROPIC_API_KEY once in the Netlify site
   settings (Site configuration → Environment variables); the app calls
   /api/ask and this function forwards to the Claude API. The system prompt
   lives here, server-side, so the endpoint can't be repurposed. */

const MODEL = 'claude-opus-5';
const MAX_TEXT = 2000;
const MAX_HISTORY = 12;

const clip = (s, n) => String(s ?? '').slice(0, n);

function systemPrompt(facts = {}) {
  const bits = [
    facts.name && `The user's name is ${clip(facts.name, 40)}.`,
    facts.city && `They live in ${clip(facts.city, 60)}.`,
    facts.region && `Their region code is ${clip(facts.region, 5)}.`,
  ].filter(Boolean).join(' ');
  return `You are Kalki, a personal assistant living inside a tiny on-device app on the user's phone. ${bits}
Kalki's built-in skills already handle: deal hunting (rent, shopping, groceries, hotels, flights, rides, jobs, medication, fuel, used cars, insurance), bookings, reminders, timers, lists, expenses, habits and a morning brief — for those, briefly point the user to the built-in phrasing (e.g. "say: find a rental in Pune"). For everything else — questions, advice, ideas, explanations, translations — answer directly.
Keep replies short and mobile-friendly (a few sentences). Use **bold** sparingly; no headers or tables. Only ever act as Kalki the personal assistant.`;
}

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return Response.json({ error: 'brain_not_configured' }, { status: 503 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  const text = clip(body.text, MAX_TEXT).trim();
  if (!text) return Response.json({ error: 'bad_request' }, { status: 400 });

  const history = (Array.isArray(body.history) ? body.history : [])
    .slice(-MAX_HISTORY)
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: clip(m.content, MAX_TEXT) }));

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt(body.facts),
      messages: [...history, { role: 'user', content: text }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    return Response.json(
      { error: err?.error?.message || `upstream_${res.status}` },
      { status: res.status === 429 ? 429 : 502 },
    );
  }

  const data = await res.json();
  if (data.stop_reason === 'refusal') {
    return Response.json({ error: 'declined' }, { status: 200 });
  }
  const reply = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  return Response.json({ reply });
};

export const config = { path: '/api/ask' };
