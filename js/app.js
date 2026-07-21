/* App bootstrap: wires views, composer, theme studio, profile, reminders
   and the service worker together. */
import { store, fmtBytes } from './store.js';
import * as theme from './theme.js';
import * as ui from './ui.js';
import { Brain } from './brain.js';
import { listBookings, listReminders, removeBooking, removeReminder, popDueReminders, fmtWhen, iconFor } from './skills.js';

const brain = new Brain();
theme.apply();

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

function send(text) {
  const t = text.trim();
  if (!t) return;
  ui.addUser(t);
  botRespond(brain.handle(t));
}

document.getElementById('composer').onsubmit = (e) => {
  e.preventDefault();
  send($input.value);
  $input.value = '';
  $input.focus();
};
ui.showChips.onPick = send;

if (ui.restore() === 0) botRespond(brain.welcome());

/* ---------- bookings view ---------- */
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
    row.querySelector('.s').textContent = fmtWhen(it.when) + (it.place ? ' · ' + it.place : '');
    const actions = row.querySelector('.actions');
    if (it.isBooking) {
      const ics = document.createElement('button');
      ics.textContent = '📆';
      ics.title = 'Add to calendar';
      ics.onclick = () => ui.downloadICS(it);
      actions.appendChild(ics);
    }
    const del = document.createElement('button');
    del.textContent = '🗑️';
    del.title = 'Delete';
    del.onclick = () => { (it.isBooking ? removeBooking : removeReminder)(it.id); renderBookings(); };
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

/* ---------- settings: profile / notifications / storage ---------- */
for (const [id, key] of [['p-name', 'name'], ['p-city', 'city'], ['p-budget', 'budget']]) {
  document.getElementById(id).onchange = (e) => {
    const v = e.target.type === 'number' ? +e.target.value || null : e.target.value.trim() || null;
    brain.setProfile({ [key]: v });
  };
}

document.getElementById('notif-btn').onclick = async () => {
  if ('Notification' in window) await Notification.requestPermission();
  renderSettings();
};

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

/* ---------- reminder loop ---------- */
function checkReminders() {
  for (const r of popDueReminders()) {
    const text = `⏰ Reminder: **${r.text}**`;
    ui.addBot({ text });
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Kalki reminder', { body: r.text, icon: 'icon-192.png' });
    }
  }
}
checkReminders();
setInterval(checkReminders, 30 * 1000);

/* ---------- PWA ---------- */
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js');
}
