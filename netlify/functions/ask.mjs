/* Kalki's hosted brain: a serverless proxy so users never need their own
   API key. The site owner sets ANTHROPIC_API_KEY once in the Netlify site
   settings (Site configuration → Environment variables); the app calls
   /api/ask and this function forwards to the Claude API. The system prompt
   and the routing tool live here, server-side, so the endpoint can't be
   repurposed.

   Two jobs, one endpoint:
   1. Plain question  → returns { reply }.
   2. Routing (body.route)  → the model either answers a general question
      ({ reply }) OR decides the message is one of Kalki's task skills and
      returns { intent, details } so the app can start that skill's flow.

   Model: Haiku 4.5 — fast and cheap ($1/$5 per M tokens), plenty for intent
   routing and short chat. The system prompt + tool are marked for prompt
   caching, so the fixed part of every call is billed at a fraction after
   the first. Keep the account spend bounded with a limit in the Anthropic
   Console (Settings → Limits); this proxy also caps tokens and history. */

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TEXT = 2000;
const MAX_HISTORY = 8;

const clip = (s, n) => String(s ?? '').slice(0, n);

/* Skills the router may dispatch to, with the detail keys it should try to
   fill. Keys match the slot names in public/js/skills.js exactly; the app
   validates every value through that slot's own parser, so loose values are
   safe — anything missing or unparseable is simply asked for. Sub-flows that
   only start from a picked result (staybook, flightbook) are intentionally
   excluded. */
const SKILLS_GUIDE = {
  rent: 'find a rental home/apartment. details: city, budget (max monthly, number), beds (0=studio)',
  hotel: 'find/compare hotels. details: city, checkin (date phrase), nights (number), guests (number)',
  flight: 'find flights/fares. details: from, to, date (depart), return (date, omit if one-way)',
  trip: 'plan a whole trip. details: dest, start (date), end (date), occasion',
  events: 'what’s on — concerts, festivals, fairs. details: city, kind (music/food/art/comedy)',
  court: 'find/book a sports court. details: sport, area, date, time',
  shopping: 'compare prices to buy a product. details: item, budget (number)',
  groceries: 'compare grocery prices. details: items',
  rides: 'get a taxi/ride somewhere. details: to, from',
  transfer: 'airport transfer. details: from, to, date, time, pax (number)',
  apply: 'tailor a job application to a pasted job description. details: jd (the job text)',
  jobs: 'search for jobs. details: role, city',
  meds: 'find medication cheaper. details: drug',
  gas: 'find cheapest fuel nearby. details: area',
  usedcar: 'find used-car deals. details: model, budget (number), city',
  bills: 'track a recurring bill/renewal. details: what, amount (number), date (next due)',
  insurance: 'compare health insurance. details: zip, household (number)',
  appointment: 'book/save a medical appointment. details: specialty, date, time, place',
  reservation: 'reserve a restaurant table. details: venue, date, time, size (number)',
  reminder: 'set a reminder. details: what, when (natural phrase e.g. "tomorrow 5pm"), repeat (daily/weekly/monthly)',
};

const INTENTS = Object.keys(SKILLS_GUIDE);

function routerSystem(facts = {}) {
  const bits = [
    facts.name && `The user's name is ${clip(facts.name, 40)}.`,
    facts.city && `They live in ${clip(facts.city, 60)}.`,
    facts.region && `Their region code is ${clip(facts.region, 5)}.`,
  ].filter(Boolean).join(' ');
  const menu = INTENTS.map((id) => `• ${id} — ${SKILLS_GUIDE[id]}`).join('\n');
  return `You are Kalki, a friendly personal assistant living in a tiny app on the user's phone. ${bits}

You have two jobs for each message:
1. If the message is a request Kalki can DO, call the start_skill tool with the best-matching intent and any details you can confidently pull from the message. Understand paraphrase, typos, slang and combined phrasing ("somewhere cheap to crash in vegas" → rent; "get me to the airport" → rides). Only include details you are sure of — leave the rest out and Kalki will ask. Never invent a city, date or number the user didn't give.
2. Otherwise (a question, advice, explanation, translation, chit-chat), DON'T call the tool — just answer directly, briefly and mobile-friendly. Use **bold** sparingly; no headings or tables.

Kalki's skills:
${menu}

Also handled elsewhere (do NOT use the tool for these — just answer or point to the phrasing): timers ("set a timer for 10 min"), expenses ("spent $40 on food"), lists ("add milk to shopping list"), quick math, weather/currency/definitions. Only ever act as Kalki.`;
}

const START_SKILL_TOOL = {
  name: 'start_skill',
  description: 'Start one of Kalki’s built-in task skills for the user, with any details extracted from their message.',
  input_schema: {
    type: 'object',
    properties: {
      intent: { type: 'string', enum: INTENTS, description: 'Which skill best matches the request.' },
      details: {
        type: 'object',
        description: 'Slot values you are confident about, keyed by the detail names listed for that skill. Omit anything uncertain.',
        additionalProperties: { type: ['string', 'number'] },
      },
    },
    required: ['intent'],
  },
  cache_control: { type: 'ephemeral' },
};

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return Response.json({ error: 'brain_not_configured' }, { status: 503 });

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  const text = clip(body.text, MAX_TEXT).trim();
  if (!text) return Response.json({ error: 'bad_request' }, { status: 400 });
  const routing = !!body.route;

  const history = (Array.isArray(body.history) ? body.history : [])
    .slice(-MAX_HISTORY)
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: clip(m.content, MAX_TEXT) }));

  const payload = {
    model: MODEL,
    max_tokens: routing ? 640 : 1024,
    system: [{ type: 'text', text: routerSystem(body.facts), cache_control: { type: 'ephemeral' } }],
    messages: [...history, { role: 'user', content: text }],
  };
  if (routing) {
    payload.tools = [START_SKILL_TOOL];
    payload.tool_choice = { type: 'auto' };
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    return Response.json(
      { error: err?.error?.message || `upstream_${res.status}` },
      { status: res.status === 429 ? 429 : 502 },
    );
  }

  const data = await res.json();
  if (data.stop_reason === 'refusal') return Response.json({ error: 'declined' }, { status: 200 });

  const blocks = data.content || [];
  // A tool call means "run this skill"; otherwise it's a plain reply.
  const tool = blocks.find((b) => b.type === 'tool_use' && b.name === 'start_skill');
  if (tool && INTENTS.includes(tool.input?.intent)) {
    return Response.json({ intent: tool.input.intent, details: tool.input.details || {} });
  }
  const reply = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  return Response.json({ reply });
};

export const config = { path: '/api/ask' };
