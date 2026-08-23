/* Chat rendering. All content is built with textContent (never innerHTML),
   so user input can't inject markup. History is capped to keep storage flat. */
import { store } from './store.js';
import { listBookings, buildICS } from './skills.js';

const MAX_HISTORY = 200;

const $messages = document.getElementById('messages');
const $chips = document.getElementById('chips');

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/** Minimal markdown: **bold** only. Safe — built from text nodes. */
function renderRich(target, text) {
  text.split(/\*\*(.+?)\*\*/g).forEach((part, i) => {
    if (i % 2) target.appendChild(el('b', '', part));
    else target.appendChild(document.createTextNode(part));
  });
}

const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function downloadICS(booking) {
  const blob = new Blob([buildICS(booking)], { type: 'text/calendar' });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = booking.title.replace(/[^\w]+/g, '-').toLowerCase() + '.ics';
  a.click();
  URL.revokeObjectURL(a.href);
}

function renderCard(card) {
  const c = el('div', 'rcard');
  const meta = el('div', 'meta');
  meta.appendChild(el('div', 't', card.t));
  if (card.s) meta.appendChild(el('div', 's', card.s));
  c.appendChild(meta);
  if (card.url) {
    // ⧉ copies the link so it can be pasted into a private/incognito window
    // (pages can't open incognito themselves) — defeats search-based pricing.
    const copy = el('button', 'copybtn', '⧉');
    copy.type = 'button';
    copy.title = 'Copy link — paste in a private window';
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(card.url); } catch { return; }
      copy.textContent = '✓';
      setTimeout(() => { copy.textContent = '⧉'; }, 1200);
    };
    c.appendChild(copy);
    const a = el('a', '', 'Open');
    a.href = card.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    c.appendChild(a);
  } else if (card.ics) {
    const booking = listBookings().find((b) => b.id === card.ics);
    if (booking) {
      const b = el('button', 'icsbtn', '.ics');
      b.type = 'button';
      b.onclick = () => downloadICS(booking);
      c.appendChild(b);
    }
  } else if (card.copy) {
    const b = el('button', 'icsbtn', 'Copy');
    b.type = 'button';
    b.onclick = async () => {
      try { await navigator.clipboard.writeText(card.copy); b.textContent = '✓ Copied'; }
      catch { b.textContent = 'Press & hold to copy'; }
      setTimeout(() => { b.textContent = 'Copy'; }, 1800);
    };
    c.appendChild(b);
    const pre = el('div', 'copytext', card.copy);
    c.appendChild(pre);
  } else if (card.act) {
    const b = el('button', 'icsbtn', card.actLabel || 'Go');
    b.type = 'button';
    b.onclick = () => showChips.onPick?.(card.act);
    c.appendChild(b);
  } else if (card.dl) {
    const b = el('button', 'icsbtn', 'Save');
    b.type = 'button';
    b.onclick = () => {
      const blob = new Blob([card.dl.content], { type: card.dl.mime || 'text/plain' });
      const a = el('a');
      a.href = URL.createObjectURL(blob);
      a.download = card.dl.name;
      a.click();
      URL.revokeObjectURL(a.href);
    };
    c.appendChild(b);
  }
  return c;
}

function renderMsg(m) {
  const div = el('div', 'msg ' + m.r);
  renderRich(div, m.t);
  if (m.cards) {
    const wrap = el('div', 'cards');
    m.cards.forEach((c) => wrap.appendChild(renderCard(c)));
    div.appendChild(wrap);
  }
  div.appendChild(el('span', 'time', fmtTime(m.ts)));
  $messages.appendChild(div);
}

const scrollDown = () => { $messages.scrollTop = $messages.scrollHeight; };

function persist(m) {
  const history = store.get('messages', []);
  history.push(m);
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  store.set('messages', history);
}

export function addUser(text) {
  const m = { r: 'u', t: text, ts: Date.now() };
  persist(m);
  renderMsg(m);
  showChips([]);
  scrollDown();
}

/** Speak a bot reply aloud (opt-in via Settings). Markdown/emoji stripped. */
export function speak(text) {
  if (!('speechSynthesis' in window)) return;
  const plain = text.replace(/\*\*/g, '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').split('\n')[0];
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(plain));
}

/** Persistent typing indicator for slow (network) replies. */
let $typing = null;
export function typing(on) {
  $typing?.remove();
  $typing = null;
  if (on) {
    $typing = el('div', 'typing', 'Kalki is thinking…');
    $messages.appendChild($typing);
    scrollDown();
  }
}

/** Render a bot response after a short "typing…" beat. */
export function addBot(resp, onDone) {
  const typing = el('div', 'typing', 'Kalki is typing…');
  $messages.appendChild(typing);
  scrollDown();
  setTimeout(() => {
    typing.remove();
    const m = { r: 'b', t: resp.text, ts: Date.now() };
    if (resp.cards) m.cards = resp.cards;
    persist(m);
    renderMsg(m);
    showChips(resp.chips || []);
    if (store.get('profile', {}).tts) speak(resp.text);
    scrollDown();
    if (onDone) onDone(resp);
  }, 350);
}

export function showChips(chips, onPick) {
  $chips.textContent = '';
  store.set('chips', chips); // survive reloads
  chips.forEach((label) => {
    const b = el('button', 'chip', label);
    b.type = 'button';
    b.onclick = () => (onPick || showChips.onPick)?.(label);
    $chips.appendChild(b);
  });
}
showChips.onPick = null;

export function restore() {
  const history = store.get('messages', []);
  history.forEach(renderMsg);
  const chips = store.get('chips', []);
  if (chips.length) {
    // render without re-persisting
    chips.forEach((label) => {
      const b = el('button', 'chip', label);
      b.type = 'button';
      b.onclick = () => showChips.onPick?.(label);
      $chips.appendChild(b);
    });
  }
  scrollDown();
  return history.length;
}

export function clearChatView() {
  $messages.textContent = '';
  $chips.textContent = '';
  store.remove('chips');
}

/* ---------- snackbar (undo etc.) ---------- */

let snackTimer = null;
export function snack(text, actionLabel, onAction) {
  document.getElementById('snackbar')?.remove();
  clearTimeout(snackTimer);
  const bar = el('div', '', text);
  bar.id = 'snackbar';
  if (actionLabel) {
    const btn = el('button', '', actionLabel);
    btn.onclick = () => { bar.remove(); clearTimeout(snackTimer); onAction?.(); };
    bar.appendChild(btn);
  }
  document.body.appendChild(bar);
  snackTimer = setTimeout(() => bar.remove(), 5000);
}
