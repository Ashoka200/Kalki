/* App bootstrap: wires views, composer, voice, theme studio, profile,
   region, backup, reminders and the service worker together. */
import { store, fmtBytes, exportData, importData } from './store.js';
import * as theme from './theme.js';
import * as ui from './ui.js';
import { Brain } from './brain.js';
import { REGIONS, getRegion } from './regions.js';
import { listBookings, listReminders, removeBooking, removeReminder, restoreBooking, restoreReminder, updateBooking, popDueReminders, fmtWhen, repeatLabel, iconFor } from './skills.js';
import { popDueTimers } from './personal.js';
import * as llm from './llm.js';

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
  const resp = brain.handle(t);
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
for (const [id, key] of [['p-name', 'name'], ['p-city', 'city'], ['p-budget', 'budget'], ['p-spend', 'spendBudget']]) {
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
  renderSettings();
};

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
