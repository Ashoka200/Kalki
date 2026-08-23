/* App bootstrap: wires views, composer, voice, theme studio, profile,
   region, backup, reminders and the service worker together. */
import { store, fmtBytes, exportData, importData } from './store.js';
import * as theme from './theme.js';
import * as ui from './ui.js';
import { Brain } from './brain.js';
import { REGIONS, getRegion } from './regions.js';
import { listBookings, listReminders, removeBooking, removeReminder, restoreBooking, restoreReminder, updateBooking, popDueReminders, fmtWhen, repeatLabel, iconFor, onRemindersChanged, STATUS_LABEL, addBooking } from './skills.js';
import { popDueTimers } from './personal.js';
import * as llm from './llm.js';
import * as web from './web.js';
import { splitCompound } from './personal.js';
import * as push from './push.js';
import { lookupVenue, requestMessage, contactCards } from './venues.js';
import * as flights from './flights.js';
import * as hotels from './hotels.js';

const brain = new Brain();
theme.apply();

/* ---------- PIN lock ---------- */

// Not encryption — a shoulder-surfing gate. Data stays readable in devtools.
async function hashPin(pin) {
  if (crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('kalki:' + pin));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 5381; // djb2 fallback for non-secure contexts
  for (const c of 'kalki:' + pin) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  return 'x' + h.toString(16);
}

function showLock() {
  const overlay = document.createElement('div');
  overlay.id = 'lock';
  overlay.innerHTML = '<div class="lockbox"><div class="lockicon">🔒</div><p>Enter your PIN</p><input type="password" inputmode="numeric" maxlength="8" aria-label="PIN"><p class="lockerr" hidden>Wrong PIN</p></div>';
  document.body.appendChild(overlay);
  const inp = overlay.querySelector('input');
  inp.oninput = async () => {
    if (inp.value.length < 4) return;
    if (await hashPin(inp.value) === store.get('profile', {}).pinHash) {
      overlay.remove();
    } else if (inp.value.length >= 6) {
      overlay.querySelector('.lockerr').hidden = false;
      inp.value = '';
    }
  };
  inp.focus();
}
if (store.get('profile', {}).pinHash) showLock();

/* ---------- views ---------- */
const views = { chat: 'view-chat', bookings: 'view-bookings', settings: 'view-settings' };
function show(view) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  Object.entries(views).forEach(([name, id]) => document.getElementById(id).classList.toggle('active', name === view));
  if (view === 'bookings') renderBookings();
  if (view === 'settings') renderSettings();
}
document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => show(b.dataset.view)));

/* ---------- chat ---------- */
const $input = document.getElementById('input');

function botRespond(resp) {
  if (!resp) return;
  ui.addBot(resp, (r) => { if (r.open) show(r.open); });
}

async function send(text) {
  const t = text.trim();
  if (!t) return;
  ui.addUser(t);
  // Compound commands: "remind me to call mom at 5 and add milk to
  // shopping list" run as separate actions, in order.
  const parts = brain.flow ? [t] : splitCompound(t);
  for (const part of parts) await handleOne(part);
}

async function handleOne(t) {
  const resp = brain.handle(t);
  // Free internet answers (weather, currency, crypto, define, what-is) —
  // keyless public services, fetched right here in the browser.
  if (resp?.web) {
    ui.typing(true);
    try {
      const a = await web.answer(resp.web);
      ui.typing(false);
      ui.addBot(a);
    } catch (e) {
      ui.typing(false);
      if (e.offline) {
        ui.addBot({ text: '🌐 I need internet for that one and you seem to be offline. Everything else still works!' });
      } else if (e.notFound && llm.enabled()) {
        // Wikipedia came up empty — let Claude take a shot if available.
        try {
          ui.typing(true);
          const reply = await llm.ask(t);
          ui.typing(false);
          ui.addBot({ text: reply });
        } catch {
          ui.typing(false);
          ui.addBot({ text: e.message });
        }
      } else {
        ui.addBot({ text: e.message });
      }
    }
    return;
  }
  // Unmatched question-like message → try Wikipedia search first (free,
  // keyless) before any AI.
  if (resp?.llmQuery && /\?\s*$|^(what|who|where|when|why|how|which|tell me)\b/i.test(resp.llmQuery)) {
    ui.typing(true);
    try {
      const a = await web.answer({ kind: 'wiki', topic: resp.llmQuery.replace(/\?+\s*$/, ''), search: true });
      ui.typing(false);
      ui.addBot(a);
      return;
    } catch {
      ui.typing(false); // fall through to Claude / built-in fallback
    }
  }
  // Unmatched message → ask Claude (hosted backend by default, personal
  // key if the user set one). Falls back to the built-in reply when no
  // AI is reachable.
  if (resp?.llmQuery && llm.enabled()) {
    ui.typing(true);
    try {
      const reply = await llm.ask(resp.llmQuery);
      ui.typing(false);
      ui.addBot({ text: reply });
    } catch (e) {
      ui.typing(false);
      if (e.unavailable) botRespond(resp); // no backend on this build — plain fallback
      else ui.addBot({ text: `${resp.text}\n\n(🧠 Claude couldn’t help: ${e.message})`, chips: resp.chips });
    }
    return;
  }
  botRespond(resp);
  if (resp?.venueLookup) enrichWithVenue(resp.venueLookup);
  if (resp?.flightSearch) liveFlightSearch(resp.flightSearch);
  if (resp?.bookFlight) completeBooking(resp.bookFlight);
  if (resp?.staySearch) liveHotelSearch(resp.staySearch);
  if (resp?.fetchRates) showRates(resp.fetchRates);
  if (resp?.bookStay) completeStayBooking(resp.bookStay);
}

async function liveHotelSearch(params) {
  const cap = await hotels.capability();
  if (!cap.live) return;
  ui.typing(true);
  try {
    const { results, mode, city } = await hotels.search(params);
    ui.typing(false);
    if (!results?.length) { ui.addBot({ text: 'No live hotel rates came back for those dates — the links above still work.' }); return; }
    brain.lastHotels = results;
    ui.addBot({
      text: `🏨 **Live rates in ${city}**${mode === 'test' ? '\n🧪 *Test mode — real hotel data, no money and no reservation.*' : ''}\n\nTotal for your stay. Tap **Rooms** to see options:`,
      cards: results.map(hotels.hotelCard),
      chips: ['Rooms 1', 'Show my bookings'],
    });
  } catch (e) {
    ui.typing(false);
    ui.addBot({ text: `Couldn’t load live hotel rates (${e.message}). The links above still work.` });
  }
}

async function showRates(hotel) {
  ui.typing(true);
  try {
    const { rates } = await hotels.rates(hotel.id);
    ui.typing(false);
    if (!rates?.length) { ui.addBot({ text: `No rooms available at ${hotel.name} for those dates.` }); return; }
    brain.lastRates = rates;
    ui.addBot({ text: `**${hotel.name}** — room options:`, cards: rates.map(hotels.rateCard), chips: ['Book room 1', 'Show my bookings'] });
  } catch (e) {
    ui.typing(false);
    ui.addBot({ text: `Couldn’t load rooms (${e.message}).` });
  }
}

async function completeStayBooking({ guest }) {
  const rate = brain.pendingRate;
  if (!rate) { ui.addBot({ text: 'That rate expired — search again for fresh prices.' }); return; }
  ui.typing(true);
  try {
    const r = await hotels.book({ rateId: rate.id, guest, hotel: brain.pendingHotel });
    ui.typing(false);
    brain.setProfile({ firstName: guest.given_name, lastName: guest.family_name, email: guest.email, phone: guest.phone_number });
    const b = addBooking({ kind: 'hotel', title: `${r.hotel} — ${r.checkIn} → ${r.checkOut}`, when: new Date(r.checkIn + 'T15:00:00').toISOString(), place: r.hotel, status: 'confirmed' });
    ui.addBot({
      text: `🏨 **Reserved — reference ${r.reference}**\n${r.hotel}, ${r.checkIn} → ${r.checkOut} · ${r.currency} ${r.price}${r.mode === 'test' ? '\n\n🧪 *Test booking: sandbox order — no charge and no real reservation.*' : ''}`,
      cards: [{ t: 'Add to calendar', s: r.checkIn, ics: b.id }],
      chips: ['Show my bookings', 'Help'],
    });
    brain.pendingRate = null;
  } catch (e) {
    ui.typing(false);
    ui.addBot({ text: `Reservation failed: ${e.message}` });
  }
}

/* Real fares from the airlines, via Kalki's own backend. */
async function liveFlightSearch(params) {
  const cap = await flights.capability();
  if (!cap.live) return; // no backend configured — deep links stand alone
  ui.typing(true);
  try {
    const { offers, mode } = await flights.search(params);
    ui.typing(false);
    if (!offers?.length) { ui.addBot({ text: 'No live fares came back for those dates — the links above still work.' }); return; }
    brain.lastOffers = offers;
    ui.addBot({
      text: `✈️ **Live fares** ${offers[0].from} → ${offers[0].to}${mode === 'test' ? '\n🧪 *Test mode — real airline data, but no money and no ticket.*' : ''}\n\nTap **Book** on any fare:`,
      cards: offers.map(flights.offerCard),
      chips: ['Book flight 1', 'Show my bookings'],
    });
  } catch (e) {
    ui.typing(false);
    ui.addBot({ text: `Couldn’t load live fares (${e.message}). The links above still work.` });
  }
}

async function completeBooking({ passenger }) {
  const offer = brain.pendingOffer;
  if (!offer) { ui.addBot({ text: 'That fare expired — search again and I’ll pull fresh ones.' }); return; }
  ui.typing(true);
  try {
    const r = await flights.book({
      offerId: offer.id, amount: offer.price, currency: offer.currency,
      passengerIds: offer.passengerIds, passenger,
    });
    ui.typing(false);
    // Remember the traveller so the next booking is one tap.
    brain.setProfile({ firstName: passenger.given_name, lastName: passenger.family_name,
      bornOn: passenger.born_on, email: passenger.email, phone: passenger.phone_number });
    const b = addBooking({ kind: 'flight', title: `${offer.airline} ${offer.from}→${offer.to}`, when: offer.departs, place: offer.from, status: 'confirmed' });
    ui.addBot({
      text: `🎟️ **Booked — reference ${r.reference}**\n${offer.airline}, ${offer.from} → ${offer.to}, ${new Date(offer.departs).toLocaleString()}\n${r.mode === 'test' ? '\n🧪 *Test booking: this is a sandbox order — no charge, and it is not a real ticket.*' : ''}`,
      cards: [{ t: 'Add to calendar', s: new Date(offer.departs).toLocaleString(), ics: b.id }],
      chips: ['Show my bookings', 'Help'],
    });
    brain.pendingOffer = null;
  } catch (e) {
    ui.typing(false);
    ui.addBot({ text: `Booking failed: ${e.message}` });
  }
}

/* Find the venue's real contact details, then offer one-tap ways to send
   a complete booking request. Silent when offline or not found. */
async function enrichWithVenue(v) {
  const venue = await lookupVenue(v.name, v.area);
  const p = brain.profile;
  const msg = requestMessage({
    what: v.what, when: v.when, place: venue?.name || v.name,
    party: v.party, name: p.name, phone: p.phone,
  });
  const missing = !p.name || !p.phone;
  if (!venue?.phone && !venue?.website) {
    ui.addBot({
      text: `I couldn’t find contact details for **${v.name}** automatically. Search them below, then tell me “**request sent**” and I’ll track it.`,
      cards: [{ t: `🔎 Find ${v.name}`, s: 'Phone, hours, booking page', url: `https://www.google.com/search?q=${encodeURIComponent(v.name + ' ' + v.area + ' phone booking')}` },
              { t: '✉️ Email the request', s: 'Opens your mail app', url: `mailto:?subject=${encodeURIComponent(v.title)}&body=${encodeURIComponent(msg)}` }],
      chips: ['Request sent', 'Show my bookings'],
    });
    return;
  }
  ui.addBot({
    text: `📇 Found **${venue.name}**${venue.address ? `\n${venue.address}` : ''}${venue.phone ? `\n📞 ${venue.phone}` : ''}\n\nI’ve written your booking request${missing ? ' (add your name & phone in ⚙️ Settings so they’re included)' : ''} — one tap sends it:`,
    cards: contactCards(venue, msg, v.title),
    chips: ['Request sent', 'Mark confirmed', 'Show my bookings'],
  });
}

document.getElementById('composer').onsubmit = (e) => {
  e.preventDefault();
  send($input.value);
  $input.value = '';
  $input.focus();
};
ui.showChips.onPick = send;

if (ui.restore() === 0) botRespond(brain.welcome());

/* ---------- voice input ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const $mic = document.getElementById('mic');
if (!SR) {
  $mic.hidden = true;
} else {
  let rec = null;
  $mic.onclick = () => {
    if (rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = true;
    $mic.classList.add('rec');
    rec.onresult = (e) => {
      $input.value = Array.from(e.results).map((r) => r[0].transcript).join('');
      if (e.results[e.results.length - 1].isFinal) rec.stop();
    };
    rec.onerror = () => rec.stop();
    rec.onend = () => { $mic.classList.remove('rec'); rec = null; $input.focus(); };
    rec.start();
  };
}

/* ---------- bookings view ---------- */

/** "2026-08-03T17:00" for datetime-local inputs, in local time. */
const localISO = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function renderBookings() {
  const $list = document.getElementById('booking-list');
  $list.textContent = '';
  const items = [
    ...listBookings().map((b) => ({ ...b, icon: iconFor(b.kind), label: b.title, isBooking: true })),
    ...listReminders().map((r) => ({ ...r, icon: '⏰', label: r.text })),
  ].sort((a, b) => a.when.localeCompare(b.when));

  if (!items.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Nothing scheduled. Ask Kalki to book something!';
    $list.appendChild(p);
    return;
  }
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'bk';
    row.innerHTML = '<div class="icon"></div><div class="meta"><div class="t"></div><div class="s"></div></div><div class="actions"></div>';
    row.querySelector('.icon').textContent = it.icon;
    row.querySelector('.t').textContent = it.label;
    row.querySelector('.s').textContent = fmtWhen(it.when)
      + (it.place ? ' · ' + it.place : '')
      + (it.isBooking && it.status && it.status !== 'saved' ? ' · ' + (STATUS_LABEL[it.status] || it.status) : '')
      + (it.repeat ? ' · ' + repeatLabel(it.repeat) : '');
    const actions = row.querySelector('.actions');

    if (it.isBooking) {
      const edit = document.createElement('button');
      edit.textContent = '✏️';
      edit.title = 'Reschedule';
      edit.onclick = () => {
        const meta = row.querySelector('.meta');
        meta.textContent = '';
        const inp = document.createElement('input');
        inp.type = 'datetime-local';
        inp.value = localISO(it.when);
        const save = document.createElement('button');
        save.textContent = '✓';
        save.className = 'save';
        save.onclick = () => {
          if (inp.value) updateBooking(it.id, { when: new Date(inp.value).toISOString() });
          renderBookings();
        };
        const cancel = document.createElement('button');
        cancel.textContent = '✕';
        cancel.onclick = renderBookings;
        meta.append(inp, save, cancel);
        meta.classList.add('editing');
      };
      actions.appendChild(edit);

      const ics = document.createElement('button');
      ics.textContent = '📆';
      ics.title = 'Add to calendar';
      ics.onclick = () => ui.downloadICS(it);
      actions.appendChild(ics);
    }
    const del = document.createElement('button');
    del.textContent = '🗑️';
    del.title = 'Delete';
    del.onclick = () => {
      (it.isBooking ? removeBooking : removeReminder)(it.id);
      renderBookings();
      ui.snack('Deleted.', 'Undo', () => {
        const { icon, label, isBooking, ...raw } = it;
        (isBooking ? restoreBooking : restoreReminder)(raw);
        renderBookings();
      });
    };
    actions.appendChild(del);
    $list.appendChild(row);
  }
}

/* ---------- settings: theme studio ---------- */
const $presets = document.getElementById('presets');

function renderSettings() {
  const t = theme.getTheme();
  const active = theme.activePreset(t);
  $presets.textContent = '';
  for (const [name, p] of Object.entries(theme.PRESETS)) {
    const b = document.createElement('button');
    b.className = 'preset' + (name === active ? ' active' : '');
    b.title = name;
    b.style.background = `linear-gradient(135deg, ${p.accent} 50%, ${p.bg} 50%)`;
    b.onclick = () => { theme.setTheme({ ...p }); renderSettings(); };
    $presets.appendChild(b);
  }
  document.querySelectorAll('[data-theme]').forEach((inp) => {
    inp.value = t[inp.dataset.theme];
  });
  document.getElementById('fs-val').textContent = t.fontSize + 'px';
  document.getElementById('radius-val').textContent = t.radius + 'px';

  const p = brain.profile;
  document.getElementById('p-name').value = p.name || '';
  document.getElementById('p-phone').value = p.phone || '';
  document.getElementById('p-city').value = p.city || '';
  document.getElementById('p-budget').value = p.budget || '';
  document.getElementById('p-spend').value = p.spendBudget || '';
  document.getElementById('p-region').value = getRegion();
  document.getElementById('p-tts').checked = !!p.tts;
  document.getElementById('p-apikey').value = p.apiKey || '';
  document.getElementById('pin-state').textContent = p.pinHash ? 'PIN is set. Enter a new one to change it, or clear the field and press enter to remove.' : 'No PIN set.';
  document.getElementById('storage-used').textContent = `Using ${fmtBytes(store.usage())}.`;
  document.getElementById('notif-state').textContent =
    !('Notification' in window) ? 'Not supported in this browser.' : `Status: ${Notification.permission}`;
}

document.querySelectorAll('[data-theme]').forEach((inp) => {
  inp.oninput = () => {
    const key = inp.dataset.theme;
    const value = inp.type === 'range' ? +inp.value : inp.value;
    theme.setTheme({ [key]: value });
    if (key === 'fontSize') document.getElementById('fs-val').textContent = value + 'px';
    if (key === 'radius') document.getElementById('radius-val').textContent = value + 'px';
  };
});
document.getElementById('theme-reset').onclick = () => { theme.resetTheme(); renderSettings(); };

/* ---------- settings: profile / region / voice ---------- */
for (const [id, key] of [['p-name', 'name'], ['p-phone', 'phone'], ['p-city', 'city'], ['p-budget', 'budget'], ['p-spend', 'spendBudget']]) {
  document.getElementById(id).onchange = (e) => {
    const v = e.target.type === 'number' ? +e.target.value || null : e.target.value.trim() || null;
    brain.setProfile({ [key]: v });
  };
}
document.getElementById('p-region').onchange = (e) => brain.setProfile({ region: e.target.value });
document.getElementById('p-tts').onchange = (e) => brain.setProfile({ tts: e.target.checked });
document.getElementById('p-apikey').onchange = (e) => {
  brain.setProfile({ apiKey: e.target.value.trim() || null });
  ui.snack(e.target.value.trim() ? '🧠 Claude brain enabled.' : 'Claude brain disabled.');
};
document.getElementById('p-pin').onchange = async (e) => {
  const v = e.target.value.trim();
  if (!v) {
    brain.setProfile({ pinHash: null });
    ui.snack('PIN removed.');
  } else if (/^\d{4,8}$/.test(v)) {
    brain.setProfile({ pinHash: await hashPin(v) });
    ui.snack('PIN set — Kalki will ask for it on launch.');
  } else {
    ui.snack('PIN must be 4–8 digits.');
  }
  e.target.value = '';
};

document.getElementById('notif-btn').onclick = async () => {
  if ('Notification' in window) await Notification.requestPermission();
  if ('Notification' in window && Notification.permission === 'granted') {
    const live = await push.enablePush();
    ui.snack(live
      ? '🔔 Push is on — reminders reach this device even when Kalki is closed.'
      : 'Notifications on. (Push needs the hosted site; in-app reminders work everywhere.)');
  }
  renderSettings();
};

// Mirror reminders to the push service whenever they change, and
// re-attach silently on every launch if permission was already given.
onRemindersChanged(() => push.scheduleSync());
if ('Notification' in window && Notification.permission === 'granted') push.enablePush();

/* ---------- settings: backup ---------- */
document.getElementById('export-btn').onclick = () => {
  const blob = new Blob([JSON.stringify(exportData(), null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'kalki-backup.json';
  a.click();
  URL.revokeObjectURL(a.href);
};
const $importFile = document.getElementById('import-file');
document.getElementById('import-btn').onclick = () => $importFile.click();
$importFile.onchange = async () => {
  const f = $importFile.files[0];
  if (!f) return;
  try {
    importData(JSON.parse(await f.text()));
    location.reload();
  } catch {
    ui.snack('That file isn’t a Kalki backup.');
  }
};

/* ---------- settings: storage ---------- */
document.getElementById('clear-chat').onclick = () => {
  store.remove('messages');
  ui.clearChatView();
  show('chat');
  botRespond(brain.welcome());
};
document.getElementById('clear-all').onclick = () => {
  if (!confirm('Erase ALL Kalki data on this device (chat, bookings, theme, profile)?')) return;
  store.clearAll();
  location.reload();
};

/* ---------- install prompt ---------- */
let installEvent = null;
const $install = document.getElementById('install-btn');
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  $install.hidden = false;
});
$install.onclick = async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice;
  installEvent = null;
  $install.hidden = true;
};

/* ---------- reminder loop ---------- */
function checkReminders() {
  for (const r of popDueReminders()) {
    const text = `⏰ Reminder: **${r.text}**${r.repeat ? `\n(${repeatLabel(r.repeat)} — next one is queued)` : ''}`;
    ui.addBot({ text });
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Kalki reminder', { body: r.text, icon: 'icon-192.png' });
    }
  }
}
checkReminders();
setInterval(checkReminders, 30 * 1000);

/* ---------- timer loop (second precision) ---------- */
setInterval(() => {
  for (const t of popDueTimers()) {
    ui.addBot({ text: `⏱️ **Time’s up!** (${t.label})` });
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Kalki timer', { body: `${t.label} — time's up!`, icon: 'icon-192.png' });
    }
  }
}, 1000);

/* ---------- PWA ---------- */
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js');
}
