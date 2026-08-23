/* Web Push client: opt-in when the user enables notifications. Subscribes
   this device and mirrors upcoming reminders (text + time only) to the
   site's push service so they fire even when Kalki is closed. Without the
   hosted backend (offline/single-file builds) everything degrades to the
   in-app reminder loop. */
import { store } from './store.js';
import { listReminders } from './skills.js';

const API = 'api/push';

function deviceId() {
  let id = store.get('deviceId');
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : 'd-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
    store.set('deviceId', id);
  }
  return id;
}

const b64ToU8 = (s) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** Subscribe this device and do a first sync. Returns true when push is
    actually live (backend present, permission granted, SW registered). */
export async function enablePush() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || Notification.permission !== 'granted') return false;
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await (await fetch(API)).json();
    if (!publicKey) return false;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(publicKey) });
    await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'subscribe', id: deviceId(), subscription: sub.toJSON() }),
    });
    await syncNow();
    return true;
  } catch {
    return false;
  }
}

let syncTimer = null;
/** Debounced reminder mirror — called whenever reminders change. */
export function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, 1500);
}

async function syncNow() {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const reminders = listReminders().map((r) => ({ id: r.id, text: r.text, when: r.when }));
    await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync', id: deviceId(), reminders }),
    });
  } catch { /* no backend — in-app reminders still work */ }
}
