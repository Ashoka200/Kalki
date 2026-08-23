/* Free internet answers — no API key, no backend, no account. All of these
   are public, CORS-enabled, keyless services called directly from the
   browser: Open-Meteo (weather), Frankfurter (currency), CoinGecko
   (crypto), dictionaryapi.dev (definitions), Wikipedia (what/who is).
   Offline, each fails fast and Kalki says so; everything else in the app
   keeps working. */
import { store } from './store.js';

const enc = encodeURIComponent;

/* ---------- parsing ---------- */

const COINS = { bitcoin: 'bitcoin', btc: 'bitcoin', ethereum: 'ethereum', eth: 'ethereum', dogecoin: 'dogecoin', doge: 'dogecoin', solana: 'solana', sol: 'solana' };

/** Recognize a free-internet question → { kind, ... } or null. */
export function parseWebQuery(text) {
  const t = text.trim();

  let m = t.match(/^(?:what(?:'s| is) the )?weather(?: like)?(?:\s+(?:in|at|for)\s+(.{2,40}?))?\s*\??$/i);
  if (m) {
    const city = m[1] || store.get('profile', {}).city;
    return city ? { kind: 'weather', city: city.trim() } : { kind: 'weather', city: null };
  }

  m = t.match(/^(?:convert\s+)?([\d,]+(?:\.\d+)?)\s*([a-z]{3})\s*(?:to|in|into|→)\s*([a-z]{3})\s*\??$/i);
  if (m) return { kind: 'currency', amount: parseFloat(m[1].replace(/,/g, '')), from: m[2].toUpperCase(), to: m[3].toUpperCase() };

  m = t.match(/^(?:what(?:'s| is) the )?(?:price of\s+|how much is\s+)?(\w+)\s*(?:price)?\s*\??$/i);
  if (m && COINS[m[1]?.toLowerCase()]) return { kind: 'crypto', coin: COINS[m[1].toLowerCase()] };

  m = t.match(/^(?:define|definition of|meaning of|what does)\s+([a-z' -]{2,30}?)(?:\s+mean)?\s*\??$/i);
  if (m) return { kind: 'define', word: m[1].trim() };

  m = t.match(/^translate\s+(.+?)\s+(?:to|into|in)\s+([a-z]+)\s*\??$/i);
  if (m && LANGS[m[2].toLowerCase()]) return { kind: 'translate', text: m[1].trim(), to: LANGS[m[2].toLowerCase()], lang: m[2] };

  m = t.match(/^(?:what|who)\s+(?:is|are|was|were)\s+(?:a\s+|an\s+|the\s+)?(.{2,60}?)\s*\??$/i);
  if (m) return { kind: 'wiki', topic: m[1].trim() };

  m = t.match(/^(?:tell me about|where is|where are|when was|when did|when is|why is|why are|why do|why does|how do|how does|how did)\s+(.{2,70}?)\s*\??$/i);
  if (m) return { kind: 'wiki', topic: t.replace(/\?+$/, ''), search: true };

  return null;
}

const LANGS = { spanish: 'es', french: 'fr', german: 'de', hindi: 'hi', telugu: 'te', tamil: 'ta', kannada: 'kn', malayalam: 'ml', bengali: 'bn', marathi: 'mr', gujarati: 'gu', punjabi: 'pa', urdu: 'ur', japanese: 'ja', chinese: 'zh', korean: 'ko', italian: 'it', portuguese: 'pt', arabic: 'ar', russian: 'ru', dutch: 'nl', greek: 'el', turkish: 'tr', vietnamese: 'vi', thai: 'th', english: 'en' };

/* ---------- answering ---------- */

const offline = () => Object.assign(new Error('offline'), { offline: true });

async function getJSON(url) {
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw offline();
  }
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res.json();
}

const WMO = [
  [[0], '☀️ clear'], [[1, 2], '🌤️ partly cloudy'], [[3], '☁️ overcast'],
  [[45, 48], '🌫️ foggy'], [[51, 53, 55, 56, 57], '🌦️ drizzle'],
  [[61, 63, 65, 66, 67], '🌧️ rain'], [[71, 73, 75, 77, 85, 86], '🌨️ snow'],
  [[80, 81, 82], '🌦️ showers'], [[95, 96, 99], '⛈️ thunderstorms'],
];
const wmoText = (code) => (WMO.find(([codes]) => codes.includes(code)) || [null, '🌡️'])[1];

async function weather(city) {
  const geo = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${enc(city)}&count=1&language=en&format=json`);
  const place = geo.results?.[0];
  if (!place) throw new Error(`I couldn’t find a place called “${city}”.`);
  const wx = await getJSON(
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
    `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=2`,
  );
  const c = wx.current, d = wx.daily, u = wx.current_units.temperature_2m;
  const rain = d.precipitation_probability_max?.[0];
  const lines = [
    `**${place.name}${place.country_code ? ', ' + place.country_code : ''}** right now: ${wmoText(c.weather_code)}, **${Math.round(c.temperature_2m)}${u}** (feels ${Math.round(c.apparent_temperature)}${u}), humidity ${c.relative_humidity_2m}%, wind ${Math.round(c.wind_speed_10m)} ${wx.current_units.wind_speed_10m}.`,
    `Today: ${Math.round(d.temperature_2m_min[0])}–${Math.round(d.temperature_2m_max[0])}${u}${rain != null ? `, ${rain}% rain chance` : ''}. Tomorrow: ${Math.round(d.temperature_2m_min[1])}–${Math.round(d.temperature_2m_max[1])}${u}.`,
  ];
  return lines.join('\n');
}

async function currency(q) {
  const data = await getJSON(`https://api.frankfurter.app/latest?amount=${q.amount}&from=${enc(q.from)}&to=${enc(q.to)}`);
  const val = data.rates?.[q.to];
  if (val == null) throw new Error(`I couldn’t convert ${q.from} to ${q.to} — check the currency codes.`);
  return `**${q.amount.toLocaleString()} ${q.from} = ${val.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${q.to}**\n(mid-market rate, ${data.date})`;
}

async function crypto(coin) {
  const data = await getJSON(`https://api.coingecko.com/api/v3/simple/price?ids=${coin}&vs_currencies=usd,inr,eur&include_24hr_change=true`);
  const p = data[coin];
  if (!p) throw new Error('Price lookup failed.');
  const chg = p.usd_24h_change;
  const arrow = chg >= 0 ? '📈' : '📉';
  return `**${coin[0].toUpperCase() + coin.slice(1)}**: $${p.usd.toLocaleString()} ${arrow} ${chg >= 0 ? '+' : ''}${chg?.toFixed(1)}% (24h)\n₹${p.inr.toLocaleString()} · €${p.eur.toLocaleString()}`;
}

async function define(word) {
  let data;
  try {
    data = await getJSON(`https://api.dictionaryapi.dev/api/v2/entries/en/${enc(word)}`);
  } catch (e) {
    if (e.status === 404) throw new Error(`No dictionary entry for “${word}”.`);
    throw e;
  }
  const entry = data[0];
  const meanings = (entry.meanings || []).slice(0, 2).map((m) => {
    const def = m.definitions?.[0];
    return `• *${m.partOfSpeech}* — ${def?.definition}${def?.example ? `\n  e.g. “${def.example}”` : ''}`;
  });
  const phon = entry.phonetic ? ` ${entry.phonetic}` : '';
  return `**${entry.word}**${phon}\n${meanings.join('\n')}`;
}

async function wiki(topic) {
  let data;
  try {
    data = await getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${enc(topic.replace(/\s+/g, '_'))}`);
  } catch (e) {
    if (e.status === 404) throw Object.assign(new Error(`Wikipedia has no page for “${topic}”.`), { notFound: true });
    throw e;
  }
  if (data.type === 'disambiguation') {
    throw Object.assign(new Error(`“${topic}” can mean several things — try being more specific.`), { notFound: true });
  }
  const extract = (data.extract || '').trim();
  if (!extract) throw Object.assign(new Error('No summary available.'), { notFound: true });
  const url = data.content_urls?.desktop?.page;
  return { text: `**${data.title}**\n${extract}`, cards: url ? [{ t: 'Read more', s: 'Wikipedia', url }] : undefined };
}

/** Answer a parsed web query. Returns {text, cards?}; throws on failure
    (err.offline when there's no internet, err.notFound for wiki misses). */
export async function answer(q) {
  switch (q.kind) {
    case 'weather': {
      if (!q.city) return { text: 'Tell me which city — e.g. “**weather in Austin**”. (Set your home city in ⚙️ Settings and plain “weather” will work.)' };
      return { text: await weather(q.city) };
    }
    case 'currency': return { text: await currency(q) };
    case 'crypto':   return { text: await crypto(q.coin) };
    case 'define':   return { text: await define(q.word) };
    case 'translate': {
      const data = await getJSON(`https://api.mymemory.translated.net/get?q=${enc(q.text)}&langpair=en|${q.to}`);
      const out = data.responseData?.translatedText;
      if (!out) throw new Error('Translation failed.');
      return { text: `**${out}**\n(\u201c${q.text}\u201d in ${q.lang})` };
    }
    case 'wiki':     return await wiki(q.topic, !!q.search);
  }
}
