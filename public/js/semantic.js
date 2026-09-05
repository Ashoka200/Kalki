/* On-device semantic understanding — the keyless brain layer.

   The regex NLU (nlu.js) only recognises phrasings someone wrote a rule for.
   This module understands MEANING instead: a small sentence-embedding model
   (bge-small-en-v1.5, ~34 MB quantised) runs right here in the browser via
   Transformers.js (ONNX Runtime / WebAssembly — no GPU needed, works in
   iPhone Safari). Every skill has a handful of example phrasings; a message
   is routed to the skill whose examples it is closest to in meaning, so
   "somewhere cheap to crash in vegas" lands on rent even though no rule
   mentions "crash".

   No API key, no server, nothing leaves the phone. The model is downloaded
   once from the Hugging Face CDN and cached by the browser; afterwards it
   works offline. Loading is lazy and every failure degrades silently to the
   built-in rules. Turn it off in Settings if data is precious. */
import { store } from './store.js';

const CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';
const MODEL = 'Xenova/bge-small-en-v1.5';
const POOLING = 'cls'; // what bge was trained with
/* The accept threshold is CALIBRATED at load time rather than hard-coded:
   different embedding models place "unrelated" at very different cosine
   levels (MiniLM ~0.3, bge ~0.6). We embed a set of messages that must NOT
   route to a skill (chit-chat, general questions, things other modules
   handle) and set the bar just above the best score any of them reaches.
   FLOOR is a sanity minimum; MARGIN is how clearly the winning skill must
   beat the runner-up so ambiguous messages fall through instead of guessing. */
export const FLOOR = 0.3;
export const MARGIN = 0.015;
export const NEGATIVES = [
  'how are you', 'tell me a joke', 'what is the capital of france', 'thanks a lot', 'good morning',
  'who is marie curie', 'why is the sky blue', 'what time is it', 'hello there', 'translate good morning to spanish',
  'set a timer for 10 minutes', 'spent 40 on groceries', 'add milk to shopping list', 'what is 15 percent of 80',
  'weather in austin', 'convert 100 usd to inr', 'search chat for rent', 'show my bookings', 'my spending this month',
];

/* One entry per user-startable skill (ids match skills.js). These are the
   "training data": varied, casual, real-world phrasings. */
export const EXAMPLES = {
  rent: ['find me an apartment to rent', 'looking for a place to rent', 'somewhere cheap to crash in vegas', 'need a flat under 1500 a month', '2 bedroom rentals near downtown', 'apartment hunting, any deals?', 'i need a new place to live', 'cheap rooms for rent'],
  hotel: ['book a hotel in paris', 'need a place to stay for two nights', 'hotel deals for the weekend', 'find me a cheap hotel near the airport', 'where should i stay in goa', 'looking for accommodation next friday', 'compare hotel prices'],
  flight: ['find flights to delhi', 'cheapest flight to london next month', 'book me a plane ticket', 'airfare from austin to nyc', 'i need to fly out friday', 'round trip tickets to mumbai', 'flight prices for august'],
  trip: ['plan a trip to bali', 'plan our anniversary getaway', 'weekend trip ideas', 'help me plan a vacation next month', 'organize a holiday for two', 'we want to travel to japan in spring'],
  events: ['any festivals in austin?', "what's happening this weekend", 'concerts near me', 'things to do tonight', 'events in the city', 'any comedy shows around', 'fairs and festivals nearby'],
  court: ['book a badminton court', 'reserve a tennis court for saturday', 'where can i play pickleball', 'find a basketball court near me', 'book a game of squash', 'courts to play football'],
  shopping: ['best deal on running shoes', 'price check on airpods', 'where is the cheapest laptop', 'i want to buy a tv', 'find discounts on a coffee maker', 'compare prices for a phone', 'deals on headphones'],
  groceries: ['order groceries for the week', 'cheapest place for milk and eggs', 'compare grocery prices', 'grocery shopping list prices', 'where to buy vegetables cheap', 'weekly grocery deals'],
  rides: ['get me a cab', 'book an uber to downtown', 'i need a ride home', 'taxi to the mall', 'call me a car', 'ride to the office'],
  transfer: ['book an uber to the airport', 'airport pickup tomorrow morning', 'transfer from the airport to my hotel', 'get me from jfk to manhattan', 'airport shuttle for 4 people', 'ride from the airport at 6am'],
  apply: ['apply to this job', 'tailor my resume for this posting', 'write a cover letter for this role', 'help me apply for this position', 'match my resume to this job description'],
  jobs: ['find software engineer jobs', 'looking for a job in marketing', 'job openings near me', 'remote developer positions', 'accountant vacancies in pune', 'help me find work'],
  meds: ['price for my medication', 'cheapest atorvastatin', 'where to buy metformin cheap', 'pharmacy prices for insulin', 'discount on my prescription', 'generic version of my medicine'],
  gas: ['cheapest petrol near me', 'where is gas cheap right now', 'fuel prices nearby', 'cheapest diesel around', 'gas station deals', 'where to fill up cheap'],
  usedcar: ['buy a used car', 'second hand honda city under 5 lakh', 'pre-owned suv deals', 'looking for a used toyota', 'cheap used cars near me', 'second-hand vehicle under 10k'],
  bills: ['track my electricity bill', 'remind me when the internet bill is due', 'my rent is due on the 5th every month', 'keep track of my phone bill', 'netflix renewal reminder monthly', 'water bill due friday'],
  insurance: ['i need health insurance', 'compare health plans', 'medical insurance for my family', 'cheapest health cover', 'insurance quotes for 2 people', 'health plan options near me'],
  appointment: ['book a dentist appointment', 'see a doctor tomorrow at 10', 'schedule a check-up', 'i need to visit a cardiologist', 'doctor appointment next week', 'book me in with a dermatologist'],
  reservation: ['reserve a table for dinner', 'book a restaurant for 4 tonight', 'table for two at 8pm', 'dinner reservation saturday', 'book us a table at an italian place', 'reserve seats at a restaurant'],
  reminder: ['remind me to pay rent', 'set a reminder for tomorrow 5pm', "don't let me forget to call mom", 'remind me every friday to submit the report', 'nudge me in 2 hours', 'reminder to take my pills at 9'],
};

let embed = null;   // (texts: string[]) => Promise<number[][]>  (unit-normalised)
let index = null;   // [{ intent, vec }]
let state = 'idle'; // idle | loading | ready | failed
let loading = null;
let threshold = FLOOR; // recalibrated in build()

/** Calibrated accept threshold (for the Settings status line / debugging). */
export const calibration = () => ({ threshold, state });

/** On unless the user switched it off in Settings. */
export const enabled = () => store.get('profile', {}).semantic !== false;
export const status = () => (enabled() ? state : 'off');

/** Tests inject a deterministic embedder here instead of downloading a model. */
export function _setEmbedder(fn) { embed = fn; index = null; state = 'idle'; loading = null; threshold = FLOOR; }

async function defaultEmbedder() {
  const { pipeline } = await import(CDN);
  const extractor = await pipeline('feature-extraction', MODEL, { dtype: 'q8' });
  return async (texts) => (await extractor(texts, { pooling: POOLING, normalize: true })).tolist();
}

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/** Best score per intent for one query vector, sorted high → low. */
function scores(q) {
  const best = new Map();
  for (const e of index) {
    const s = dot(q, e.vec);
    if (!best.has(e.intent) || s > best.get(e.intent)) best.set(e.intent, s);
  }
  return [...best].map(([intent, score]) => ({ intent, score })).sort((a, b) => b.score - a.score);
}

async function build() {
  if (!embed) embed = await defaultEmbedder();
  const intents = Object.keys(EXAMPLES);
  const texts = intents.flatMap((id) => EXAMPLES[id]);
  const vecs = await embed([...texts, ...NEGATIVES]);
  const idx = [];
  let k = 0;
  for (const id of intents) for (let i = 0; i < EXAMPLES[id].length; i++) idx.push({ intent: id, vec: vecs[k++] });
  index = idx;
  // Calibrate: the bar sits just above the best score any must-not-route
  // message achieves against the skill examples.
  let worst = 0;
  for (let i = 0; i < NEGATIVES.length; i++) {
    const top = scores(vecs[k + i])[0];
    if (top && top.score > worst) worst = top.score;
  }
  threshold = Math.max(FLOOR, worst + 0.02);
}

/** Start loading the model + example index in the background. Safe to call
    repeatedly; the first call wins. */
export function warm() {
  if (!enabled() || state === 'ready' || state === 'failed') return loading;
  if (!loading) {
    state = 'loading';
    loading = build().then(() => { state = 'ready'; }).catch(() => { state = 'failed'; });
  }
  return loading;
}

/** Which skill does this message mean? → { intent, score } or null when
    nothing is close enough (or the layer is off / couldn't load). */
export async function route(text) {
  if (!enabled()) return null;
  if (state !== 'ready') { await warm(); if (state !== 'ready') return null; }
  const [q] = await embed([text]);
  const [best, second] = scores(q);
  if (!best || best.score < threshold) return null;
  if (second && best.score - second.score < MARGIN) return null; // too close to call
  return best;
}
