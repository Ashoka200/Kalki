/* Push subscription + reminder sync. Opt-in: nothing is stored until the
   user enables notifications. Data kept per anonymous device id: the push
   subscription and upcoming reminders (text + time only) — the minimum a
   server needs to deliver a reminder while the app is closed. */
import { getStore } from '@netlify/blobs';

export const _deps = { getStore }; // injectable for tests

const ID_RE = /^[a-z0-9-]{8,64}$/i;
const clip = (s, n) => String(s ?? '').slice(0, n);

export default async (req) => {
  if (req.method === 'GET') {
    return Response.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'bad_request' }, { status: 400 }); }
  if (!ID_RE.test(body.id || '')) return Response.json({ error: 'bad_id' }, { status: 400 });
  const store = _deps.getStore('push');

  switch (body.action) {
    case 'subscribe': {
      const sub = body.subscription;
      if (!sub || typeof sub.endpoint !== 'string' || !sub.endpoint.startsWith('https://') || JSON.stringify(sub).length > 2000) {
        return Response.json({ error: 'bad_subscription' }, { status: 400 });
      }
      await store.setJSON('sub:' + body.id, sub);
      return Response.json({ ok: true });
    }
    case 'sync': {
      const rems = (Array.isArray(body.reminders) ? body.reminders : [])
        .slice(0, 50)
        .map((r) => ({ id: clip(r.id, 32), text: clip(r.text, 200), when: new Date(r.when).toISOString() }))
        .filter((r) => r.text && !Number.isNaN(Date.parse(r.when)));
      if (rems.length) await store.setJSON('rem:' + body.id, rems);
      else await store.delete('rem:' + body.id);
      return Response.json({ ok: true, count: rems.length });
    }
    case 'unsubscribe': {
      await store.delete('sub:' + body.id);
      await store.delete('rem:' + body.id);
      return Response.json({ ok: true });
    }
    default:
      return Response.json({ error: 'bad_action' }, { status: 400 });
  }
};

export const config = { path: '/api/push' };
