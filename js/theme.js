/* Theme engine: presets + free-form customization, applied via CSS variables.
   Bubble text color is derived from bubble luminance so any custom color
   stays readable — something WhatsApp doesn't do. */
import { store } from './store.js';

export const PRESETS = {
  classic:  { accent: '#00a884', bg: '#0b141a', panel: '#111b21', sent: '#005c4b', recv: '#202c33', wallpaper: 'dots' },
  daylight: { accent: '#008069', bg: '#efeae2', panel: '#ffffff', sent: '#d9fdd3', recv: '#ffffff', wallpaper: 'dots' },
  midnight: { accent: '#7c8cff', bg: '#0a0a12', panel: '#14142a', sent: '#2c2c54', recv: '#1d1d38', wallpaper: 'grid' },
  ocean:    { accent: '#00b4d8', bg: '#03192b', panel: '#07293f', sent: '#075985', recv: '#0b3a52', wallpaper: 'waves' },
  sunset:   { accent: '#ff7849', bg: '#1f1013', panel: '#2c181c', sent: '#7c2d12', recv: '#3a2126', wallpaper: 'gradient' },
  rose:     { accent: '#e75480', bg: '#fdf2f6', panel: '#ffffff', sent: '#fbd0e0', recv: '#ffffff', wallpaper: 'none' },
};

const DEFAULTS = { ...PRESETS.classic, fontSize: 16, radius: 14 };

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}
const textOn = (hex) => (luminance(hex) > 0.55 ? '#111b21' : '#e9edef');

export function getTheme() {
  return { ...DEFAULTS, ...store.get('theme', {}) };
}

export function setTheme(patch) {
  const t = { ...getTheme(), ...patch };
  store.set('theme', t);
  apply(t);
  return t;
}

export function resetTheme() {
  store.remove('theme');
  apply(DEFAULTS);
  return { ...DEFAULTS };
}

export function apply(t = getTheme()) {
  const r = document.documentElement.style;
  r.setProperty('--accent', t.accent);
  r.setProperty('--bg', t.bg);
  r.setProperty('--panel', t.panel);
  r.setProperty('--sent', t.sent);
  r.setProperty('--recv', t.recv);
  r.setProperty('--sent-text', textOn(t.sent));
  r.setProperty('--recv-text', textOn(t.recv));
  r.setProperty('--text', textOn(t.panel));
  r.setProperty('--dim', luminance(t.panel) > 0.55 ? '#54656f' : '#8696a0');
  r.setProperty('--fs', t.fontSize + 'px');
  r.setProperty('--radius', t.radius + 'px');
  document.body.className = 'wallpaper-' + t.wallpaper;
  document.querySelector('meta[name=theme-color]').content = t.panel;
}

/** Name of the preset the current theme matches, or null if customized. */
export function activePreset(t = getTheme()) {
  for (const [name, p] of Object.entries(PRESETS)) {
    if (Object.entries(p).every(([k, v]) => t[k] === v)) return name;
  }
  return null;
}
