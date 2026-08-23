# Kalki — Personal Assistant (PWA)

A 360° personal assistant that runs **entirely on your phone**: no AI API, no
server, no accounts, no tracking. Total footprint ≈ 120 KB installed; user
data typically stays under a few KB (chat history is capped at 200 messages).

## What it does

| Skill | How it works |
|---|---|
| 🏠 **Rent deals** | Asks city / budget / bedrooms (or extracts them from one sentence), then opens pre-filtered searches on the rental sites for *your region* + negotiation tips |
| 🛍️ **Shopping deals** | Price comparison + price-history + coupon links for any item |
| 🛒 **Groceries** | Compare delivery apps & store prices for an item or a whole list |
| 🚐 **Airport transfers** | Pick-up/drop-off, date & time → every major transfer app and site for your region (Uber, Lyft, Ola, Rapido, Bolt, FREENOW, DiDi, 13cabs, Blacklane, Addison Lee…) plus worldwide fixed-price services (GetTransfer, Kiwitaxi, Welcome Pickups), transit comparison and local operators — saved to bookings with a reminder |
| 🚗 **Rides** | Uber opens with your destination pre-set; regional apps (Ola, Lyft, Rapido) + fare tricks |
| 🩺 **Health insurance** | Region-aware: marketplace + subsidies (US), Policybazaar/PM-JAY (India), NHS (UK)… |
| 🏨 **Hotels** | Date/guest-filled comparisons + call-direct, loyalty and refundable-rebook tricks |
| ✈️ **Flights** | Google Flights/Kayak/Skyscanner deep links + regional fare sites, alerts, ±3 day tips |
| 📄 **Job applications** | Save your resume once (on-device), then paste or share any job ad: ATS match score, the keywords you're missing, a cover letter tailored to that posting's own language, and application tracking with status. Tone and letter template are fully customizable in Settings |
| 💼 **Jobs** | Pre-filled searches on LinkedIn/Indeed + the board that matters locally (Naukri, Reed, SEEK…) |
| 💊 **Medication prices** | GoodRx/CostPlus (US), 1mg/PharmEasy (India)… + generic-substitution tips |
| ⛽ **Fuel prices** | Cheapest stations nearby, warehouse-club and cash-discount tips |
| 🚙 **Used cars** | Inspected-car marketplaces per region + the negotiation rules that actually work |
| 🎪 **Events & festivals** | What's on in any area + free-entry and early-bird tricks |
| 🏥 **Hospital appointments** | Books locally, exports `.ics` **with a built-in alarm**, auto-reminds 24h before |
| 🍽️ **Reservations** | Saves the table, `.ics` export, OpenTable/Zomato/EazyDiner handoff by region |
| 🎾 **Game courts** | Nearby courts, online booking, free public options; pencils in the game + reminder |
| 🧾 **Bill tracker** | "Track my electricity bill" → recurring due-date reminders + bill-negotiation scripts |
| ⏰ **Reminders** | Understands "in 2 hours", "day after tomorrow", "every Friday 9am" — one-shot or repeating |
| 💰 **Expense tracker** | "Spent $40 on groceries" logs & auto-categorises; monthly summary vs budget, CSV export |
| 📝 **Lists** | "Add milk to shopping list", "check off milk", any number of named lists |
| ⏱️ **Timers** | "Set a timer for 10 minutes" — second-precision, rings in-app |
| 🧮 **Quick math** | "15% tip on 84", "split 1840 between 4 with 10% tip", any arithmetic |
| 🌅 **Morning brief** | "Good morning" → today's bookings & reminders, month spending vs budget, open lists |
| 💪 **Habits** | "Track habit workout", then "did workout" daily — 🔥 streaks and totals |
| 🔎 **Chat search** | "Search chat for rent" finds past conversations |
| 🗣️ **Compound commands** | "Remind me to call mom at 5 and add milk to shopping list" runs both, in order |
| 🌍 **Translation (free, no key)** | "Translate good morning to spanish" — 25 languages via MyMemory |
| 📏 **Unit conversion (offline)** | "5 km to miles", "70 kg in lbs", "100 F to C" |
| ❓ **Open questions (free, no key)** | Any "why/how/where/when…" question is answered via Wikipedia search — "why is the sky blue?" gets a real answer, no AI required |
| 🌐 **Live answers (free, no key)** | "Weather in Austin", "convert 100 usd to inr", "bitcoin price", "define serendipity", "who is Marie Curie" — answered live from free keyless public services (Open-Meteo, Frankfurter, CoinGecko, dictionaryapi.dev, Wikipedia), fetched straight from the browser |
| 🧠 **AI brain (zero setup)** | On the hosted site, questions the built-in skills can't handle are answered by Claude automatically — a bundled serverless function (`netlify/functions/ask.mjs`) holds the site's API key, so **users never configure anything**. A personal key in Settings is an optional override for the single-file/offline build |
| 🔒 **PIN lock** | Optional 4–8 digit PIN asked on launch (privacy gate, not encryption) |

**Conversational memory:** Kalki remembers the last place you talked about — "book a hotel **there**", "weather **there**" just work. Mid-flow, it reads your whole reply (date, time, and details in one sentence), switches flows when you change your mind, and after any deal search, tweak one thing —
*"what about denver?"*, *"try a studio"*, *"now friday"* — and Kalki re-runs
the search with just that slot changed. Typos are tolerated too
(*"remnid me…"*, *"fligth"*) via an on-device fuzzy matcher.

**Regions:** a Settings switch (auto-detected from your browser locale) swaps
every deal skill's marketplaces between 🇺🇸 US, 🇮🇳 India, 🇬🇧 UK, 🇨🇦 Canada and
🇦🇺 Australia versions. Google-based links work everywhere as the baseline.

**Price-tracking protection:** travel and shopping sites raise prices on
repeat searches. Every deal reply warns about this, and each result card has
a ⧉ button that copies the link so you can paste it into a private/incognito
window. Kalki itself sends nothing anywhere — links only ever open when you
tap them.

It "thinks like a human" the cheap way: a rule-based NLU (`js/nlu.js`)
extracts intents and entities (dates like *"day after tomorrow"*, relative
times like *"in 20 minutes"*, money, *"2br"*, party sizes, postcodes,
recurrence like *"every friday"*…), a slot-filling dialog manager
(`js/brain.js`) asks **only** for what you didn't already say, and a profile
(name, home city, budget, region — learned from conversation or set in
Settings) pre-fills answers so repeat requests get shorter.

## UI & extras

WhatsApp-style chat, mobile-first.

- 🎙️ **Voice input** (Web Speech API, where the browser supports it) and an
  optional **speak-replies-aloud** toggle.
- **Theme studio** (⚙️): 6 presets plus free-form accent / background /
  per-bubble colors, 5 wallpapers, text size and bubble roundness — bubble
  text color auto-derived from luminance so any combination stays readable.
- **Bookings tab**: reschedule inline (✏️), delete with **Undo**, calendar
  export — the `.ics` carries a VALARM so the alarm fires from your calendar
  app even when Kalki is closed.
- **Share from any app**: Kalki registers as a share target, so a product
  page, address or note shared from any app or website lands in the chat
  with actions (compare the price, add to a list, remind me about it).
- **Backup**: export all data to a JSON file, import it on a new phone.
- Quick-reply chips survive restarts; an install button appears when the
  browser allows one-tap install.

## Storage discipline

- Zero dependencies, no build step, no framework runtime.
- Everything in namespaced `localStorage` keys; chat capped at 200 messages;
  Settings shows exact bytes used, with **Clear chat** / **Erase all data**.
- Service worker pre-caches the shell → works fully offline after first load.

## Real flight & hotel booking (Duffel)

`netlify/functions/flights.mjs` (`/api/flights`) and
`netlify/functions/hotels.mjs` (`/api/hotels`) talk to
[Duffel](https://duffel.com) — genuine airline and hotel search, rooms,
and orders, sharing one token. Set `DUFFEL_TOKEN` on the site:

- A **test token** (`duffel_test_…`, free self-serve signup) books against
  Duffel's sandbox: real airlines and fares, no money, no ticket.
- A **live token** additionally requires `DUFFEL_ALLOW_LIVE=true` — without
  it, booking is refused, so a real purchase can never happen by accident.

Without a token both endpoints report `live:false` and the flight and
hotel skills fall back to their pre-filled deep links.

## Deploying the AI brain

The repo ships a Netlify Function at `netlify/functions/ask.mjs` serving
`/api/ask`. After connecting the repo in Netlify, set **one** environment
variable on the site — `ANTHROPIC_API_KEY` (Site configuration →
Environment variables) — and every visitor gets Claude answers with no
setup. Without the variable the endpoint returns 503 and the app quietly
falls back to its built-in replies; all other features are unaffected.

## Run

Any static file server:

```bash
python3 -m http.server 8080 -d public   # open http://localhost:8080
```

On a phone: serve over HTTPS (any static host — Netlify, GitHub Pages,
Railway), open in the browser → "Add to Home Screen". It installs and works
offline.

## Test

```bash
node --test tests/nlu.test.mjs
```

## Extending

Add a skill in `public/js/skills.js` (slots + `finish()`), add its trigger regex in
`js/nlu.js`, and optionally a per-region link pack in `js/regions.js` —
that's it. The architecture is deliberately pluggable: a future LLM backend
could replace `nlu.js`/`brain.js` behind the same interfaces, but nothing
requires one.
