/* Runs every minute: sends a Web Push for each due reminder, then drops it
   from the store (the client re-syncs future ones whenever it opens).
   Dead subscriptions (404/410 from the push service) are cleaned up. */
import { getStore } from '@netlify/blobs';
import webpush from 'web-push';

export const _deps = { getStore, webpush }; // injectable for tests

export default async () => {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return new Response('vapid not configured', { status: 200 });
  _deps.webpush.setVapidDetails(VAPID_SUBJECT || 'https://kalki-mylife.netlify.app', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const store = _deps.getStore('push');
  const now = Date.now();
  const { blobs } = await store.list({ prefix: 'rem:' });
  let sent = 0;
  for (const { key } of blobs) {
    const id = key.slice(4);
    const rems = (await store.get(key, { type: 'json' })) || [];
    const due = rems.filter((r) => Date.parse(r.when) <= now);
    if (!due.length) continue;
    const sub = await store.get('sub:' + id, { type: 'json' });
    if (!sub) { await store.delete(key); continue; }
    let dead = false;
    for (const r of due) {
      try {
        await _deps.webpush.sendNotification(sub, JSON.stringify({ title: '⏰ Kalki reminder', body: r.text }));
        sent++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) dead = true;
      }
    }
    if (dead) {
      await store.delete('sub:' + id);
      await store.delete(key);
    } else {
      const left = rems.filter((r) => Date.parse(r.when) > now);
      if (left.length) await store.setJSON(key, left);
      else await store.delete(key);
    }
  }
  return new Response(`sent ${sent}`);
};

export const config = { schedule: '* * * * *' };
