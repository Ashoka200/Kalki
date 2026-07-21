/* Tiny persistence layer over localStorage.
   All keys are namespaced so "erase all data" can't touch anything else,
   and usage() reports exactly what the app occupies. */
const NS = 'kalki.';

export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(NS + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(NS + key, JSON.stringify(value));
    } catch {
      // Quota hit: drop the bulkiest data (chat history) and retry once.
      localStorage.removeItem(NS + 'messages');
      try { localStorage.setItem(NS + key, JSON.stringify(value)); } catch {}
    }
  },
  remove(key) {
    localStorage.removeItem(NS + key);
  },
  /** Approximate bytes used by the app (UTF-16 = 2 bytes/char). */
  usage() {
    let chars = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith(NS)) chars += k.length + (localStorage.getItem(k) || '').length;
    }
    return chars * 2;
  },
  clearAll() {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k.startsWith(NS)) localStorage.removeItem(k);
    }
  },
};

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
