# Kalki — Personal Assistant (PWA)

A 360° personal assistant that runs **entirely on your phone**: no AI API, no
server, no accounts, no tracking. Total footprint ≈ 100 KB installed; user
data typically stays under a few KB (chat history is capped at 200 messages).

## What it does

| Skill | How it works |
|---|---|
| 🏠 **Rent deals** | Asks city / budget / bedrooms (or extracts them from one sentence), then opens pre-filtered searches on Zillow, Apartments.com, HotPads, FB Marketplace + negotiation tips |
| 🛍️ **Shopping deals** | Price comparison + price-history + coupon links for any item |
| 🩺 **Health insurance** | Marketplace plan preview for your ZIP, subsidy calculator, Medicaid check + enrollment tips |
| 🏨 **Hotels** | Date/guest-filled comparisons (Booking, Google Hotels, Kayak, Airbnb) + call-direct, AAA/loyalty and refundable-rebook tricks |
| ✈️ **Flights** | Google Flights/Kayak/Skyscanner deep links, fare alerts, ±3 day and budget-carrier tips, student fares |
| 🎪 **Events & festivals** | What's on in any area (Google Events, Eventbrite, AllEvents, Songkick) + free-entry and early-bird tricks |
| 🏥 **Hospital appointments** | Books locally, exports `.ics` to your calendar, auto-reminds 24h before, Zocdoc handoff to find a doctor |
| 🍽️ **Reservations** | Saves the table, `.ics` export, OpenTable handoff |
| 🎾 **Game courts** | Tennis, badminton, basketball, pickleball… nearby courts, online booking, free public options; pencils in the game + reminder |
| ⏰ **Reminders** | On-device notifications while the app is installed |

**Price-tracking protection:** travel and shopping sites raise prices on
repeat searches. Every deal reply warns about this, and each result card has
a ⧉ button that copies the link so you can paste it into a private/incognito
window (web apps aren't allowed to open incognito directly). Kalki itself
sends nothing anywhere — links only ever open when you tap them.

It "thinks like a human" the cheap way: a rule-based NLU (`js/nlu.js`)
extracts intents and entities (dates like *"friday"*, money like *"$1.8k"*,
*"2br"*, party sizes, ZIP codes…), a slot-filling dialog manager
(`js/brain.js`) asks **only** for what you didn't already say, and a profile
(name, home city, budget — learned from conversation or set in Settings)
pre-fills answers so repeat requests get shorter.

## UI & themes

WhatsApp-style chat, mobile-first. The **Theme studio** (⚙️) goes further
than WhatsApp: 6 presets plus free-form accent / background / per-bubble
colors, 5 wallpapers, text size and bubble roundness — with bubble text color
auto-derived from luminance so any combination stays readable. Themes persist
on-device.

## Storage discipline

- Zero dependencies, no build step, no framework runtime.
- Everything in namespaced `localStorage` keys; chat capped at 200 messages;
  Settings shows exact bytes used, with **Clear chat** / **Erase all data**.
- Service worker pre-caches the shell → works fully offline after first load.

## Run

Any static file server:

```bash
python3 -m http.server 8080     # open http://localhost:8080
```

On a phone: serve over HTTPS (any static host — GitHub Pages, Netlify,
Railway), open in the browser → "Add to Home Screen". It installs and works
offline.

## Test

```bash
node --test tests/nlu.test.mjs
```

## Extending

Add a skill in `js/skills.js` (slots + `finish()`), add its trigger regex in
`js/nlu.js` — that's it. The architecture is deliberately pluggable: a future
LLM backend could replace `nlu.js`/`brain.js` behind the same interfaces, but
nothing requires one.
