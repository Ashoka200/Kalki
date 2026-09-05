/* On-device language model — Kalki's opt-in "brain" that needs no API key.

   Runs a small instruct model entirely in the browser with WebLLM (WebGPU).
   Nothing is sent anywhere; after the one-time download it works offline.
   It is NOT a frontier model: it sharpens detail extraction from messy
   phrasing (grammar-constrained JSON, so the shape is always valid) and can
   give short local answers — which we label as such, because small models
   can be confidently wrong on facts.

   Device gating is strict so it never crashes a phone that can't run it:
   WebGPU must exist, the adapter must accept large buffers, and storage
   quota must fit the model. The model is chosen from WebLLM's own prebuilt
   list at runtime (by preference, not a hard-coded id):
     • capable Android / desktop (≥6 GB RAM): Qwen3 1.7B, ~2 GB
     • constrained (iPhone, small phones):    Llama 3.2 1B, ~0.9 GB
   iPhone Safari kills a tab above ~1.5–2 GB and allows ~1 GB of storage per
   site, so the 1B model is the realistic ceiling there and is marked
   experimental. The engine is unloaded when the page is hidden to stay
   under memory pressure. */
import { store } from './store.js';
import { SKILLS } from './skills.js';

const CDN = 'https://esm.run/@mlc-ai/web-llm';

/* Preference order per device class. `match` is tested against WebLLM's
   prebuilt model ids, so a rename upstream degrades to the next choice. */
export const CHOICES = {
  capable: [
    { match: /^Qwen3-1\.7B-q4f16_1-MLC$/i, label: 'Qwen3 1.7B', gb: 2.0, thinking: true },
    { match: /^Llama-3\.2-3B-Instruct-q4f16_1-MLC$/i, label: 'Llama 3.2 3B', gb: 2.2 },
    { match: /^Llama-3\.2-1B-Instruct-q4f16_1-MLC$/i, label: 'Llama 3.2 1B', gb: 0.9 },
  ],
  constrained: [
    { match: /^Llama-3\.2-1B-Instruct-q4f16_1-MLC$/i, label: 'Llama 3.2 1B', gb: 0.9 },
    { match: /^Qwen2\.5-0\.5B-Instruct-q4f16_1-MLC$/i, label: 'Qwen2.5 0.5B', gb: 0.5 },
    { match: /^SmolLM2-360M-Instruct-q4f16_1-MLC$/i, label: 'SmolLM2 360M', gb: 0.4 },
  ],
};

const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Which class is this device? Pure so it's testable. */
export function deviceClass({ ios, deviceMemory, maxStorageBufferBindingSize }) {
  if (ios) return 'constrained';
  if (deviceMemory != null && deviceMemory < 6) return 'constrained';
  if (maxStorageBufferBindingSize != null && maxStorageBufferBindingSize < 512 * 1024 * 1024) return 'constrained';
  return 'capable';
}

/** First preferred model that WebLLM actually ships. Pure. */
export function pickModel(modelIds, cls) {
  for (const c of CHOICES[cls]) {
    const id = modelIds.find((m) => c.match.test(m));
    if (id) return { id, ...c };
  }
  return null;
}

/** JSON schema for a skill's askable slots — every value a string; the
    app's own slot parsers validate and convert afterwards. */
export function schemaFor(intent) {
  const skill = SKILLS[intent];
  if (!skill) return null;
  const properties = {};
  for (const s of skill.slots) if (!s.hidden) properties[s.name] = { type: 'string' };
  return { type: 'object', properties, additionalProperties: false };
}

let webllm = null, engine = null, model = null;
let state = 'idle'; // idle | checking | unsupported | loading | ready | failed
let progress = 0, note = '';
let loading = null;

export const status = () => ({ state, progress, note, model: model?.label || null, size: model?.gb || null, ios: typeof navigator !== 'undefined' && isIOS() });
export const enabled = () => !!store.get('profile', {}).localLLM?.enabled;
export const ready = () => enabled() && state === 'ready' && !!engine;

/** Can this device run a model at all, and which one? */
export async function capability() {
  if (!('gpu' in navigator)) return { ok: false, reason: 'This browser has no WebGPU. On iPhone you need iOS 26+; on Android, Chrome 121+.' };
  let adapter = null;
  try { adapter = await navigator.gpu.requestAdapter(); } catch { /* fallthrough */ }
  if (!adapter) return { ok: false, reason: 'No GPU adapter available to the browser.' };
  const cls = deviceClass({ ios: isIOS(), deviceMemory: navigator.deviceMemory, maxStorageBufferBindingSize: adapter.limits?.maxStorageBufferBindingSize });
  if (!webllm) webllm = await import(CDN);
  const ids = webllm.prebuiltAppConfig.model_list.map((m) => m.model_id);
  const pick = pickModel(ids, cls);
  if (!pick) return { ok: false, reason: 'No compatible model is available for this device.' };
  let quota = null;
  try { const est = await navigator.storage?.estimate(); quota = est ? (est.quota - est.usage) : null; } catch { /* ignore */ }
  if (quota != null && quota < pick.gb * 1.15 * 1e9) {
    return { ok: false, reason: `Not enough storage: the ${pick.label} model needs ~${pick.gb} GB free.`, pick, cls };
  }
  return { ok: true, pick, cls };
}

/** Download (first time) or load (from cache) the model. Resolves when ready. */
export function load(onProgress) {
  if (loading) return loading;
  state = 'checking';
  loading = (async () => {
    const cap = await capability();
    if (!cap.ok) { state = 'unsupported'; note = cap.reason; throw new Error(cap.reason); }
    model = cap.pick;
    state = 'loading';
    engine = await webllm.CreateMLCEngine(model.id, {
      initProgressCallback: (r) => { progress = r.progress || 0; note = r.text || ''; onProgress?.(progress, note); },
    });
    state = 'ready'; progress = 1; note = '';
  })().catch((e) => { if (state !== 'unsupported') { state = 'failed'; note = e.message || 'load failed'; } loading = null; throw e; });
  return loading;
}

/** Warm from cache in the background if the user enabled the brain. */
export function warm() {
  if (!enabled() || state === 'ready' || loading) return;
  load().catch(() => {});
}

/** Free memory (e.g. when the app is hidden); reloads from cache on demand. */
export async function unload() {
  if (engine) { try { await engine.unload(); } catch { /* ignore */ } }
  engine = null; loading = null;
  if (state === 'ready') state = 'idle';
}

function noThink(req) {
  if (model?.thinking) req.extra_body = { enable_thinking: false };
  return req;
}

/** Pull slot values for a skill out of a messy message. Returns a flat
    object of strings (unknowns omitted) for brain.startFlowFromModel. */
export async function extract(intent, text) {
  if (!ready()) return null;
  const schema = schemaFor(intent);
  if (!schema) return null;
  const fields = Object.keys(schema.properties).join(', ');
  const res = await engine.chat.completions.create(noThink({
    messages: [
      { role: 'system', content: `Extract fields for a "${intent}" request from the user's message. Fields: ${fields}. Copy dates, times and places as the user wrote them. Use "" for anything not stated. Reply with JSON only.` },
      { role: 'user', content: text },
    ],
    temperature: 0, max_tokens: 200,
    response_format: { type: 'json_object', schema: JSON.stringify(schema) },
  }));
  const raw = res.choices?.[0]?.message?.content || '{}';
  let obj = {};
  try { obj = JSON.parse(raw); } catch { return null; }
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  return out;
}

/** Short local answer to a general message. Caller labels it on-device. */
export async function answer(text) {
  if (!ready()) throw new Error('not ready');
  const p = store.get('profile', {});
  const history = store.get('messages', []).slice(-6).filter((m) => m.t)
    .map((m) => ({ role: m.r === 'u' ? 'user' : 'assistant', content: String(m.t).slice(0, 600) }));
  const res = await engine.chat.completions.create(noThink({
    messages: [
      { role: 'system', content: `You are Kalki, a friendly personal assistant on the user's phone.${p.name ? ` The user's name is ${p.name}.` : ''}${p.city ? ` They live in ${p.city}.` : ''} Answer in 1–3 short sentences. If you are not sure of a fact, say so plainly. No headers or tables.` },
      ...history,
      { role: 'user', content: text },
    ],
    temperature: 0.3, max_tokens: 220,
  }));
  const out = (res.choices?.[0]?.message?.content || '').trim();
  if (!out) throw new Error('empty');
  return out;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.hidden) unload(); });
}
