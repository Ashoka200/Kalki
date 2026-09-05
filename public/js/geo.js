/* Device location — the one thing Kalki couldn't do before: actually know
   where you are. It never had any geolocation code, so it only ever knew the
   city you typed. This adds a robust, mobile-aware lookup:

     1. Ask the browser Geolocation API (needs HTTPS + a one-time tap).
     2. Reverse-geocode the coordinates to a city + region — free, keyless,
        CORS-enabled (BigDataCloud).
     3. If GPS is denied, times out, or is unavailable (common on installed
        iOS PWAs, where the prompt can hang), fall back to approximate
        IP-based location (ipwho.is, also keyless) so we still get a city.
     4. The manual Home-city field in Settings remains the final fallback.

   Coordinates are used for one lookup and never stored or sent anywhere but
   the geocoder. Always call this from an explicit user gesture — mobile
   browsers deny surprise, load-time location requests. */

const REGION_BY_CC = { US: 'us', IN: 'in', GB: 'uk', CA: 'ca', AU: 'au' };

/** Wrap getCurrentPosition in a promise. City-level accuracy only, so we
    keep enableHighAccuracy off (faster, less likely to hang) and always set
    a finite timeout — without one, the iOS standalone-PWA bug waits forever. */
function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(Object.assign(new Error('unsupported'), { reason: 'unsupported' }));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 8000,
      maximumAge: 300000, // a fix from the last 5 min is fine
    });
  });
}

/** Coordinates → { city, region, countryName } via a keyless reverse geocoder. */
async function reverseGeocode(lat, lon) {
  const res = await fetch(
    `https://api.bigdatacloud.net/data/reverse-geocode-client` +
    `?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
  );
  if (!res.ok) throw new Error(`geocode ${res.status}`);
  const d = await res.json();
  const city = d.city || d.locality || d.principalSubdivision || null;
  return { city, region: REGION_BY_CC[d.countryCode] || null, countryName: d.countryName || null };
}

/** Approximate location from the IP address — keyless, CORS-enabled. Used
    only when GPS can't answer. City-level and sometimes off by a lot on
    mobile networks, so we flag it approximate to the caller. */
async function ipLocate() {
  const res = await fetch('https://ipwho.is/');
  if (!res.ok) throw new Error(`ip ${res.status}`);
  const d = await res.json();
  if (!d.success || !d.city) throw new Error('ip-empty');
  return { city: d.city, region: REGION_BY_CC[d.country_code] || null, countryName: d.country || null };
}

/** Full flow. Resolves to { city, region, approx }. Throws a tagged error
    (with .reason) only when every path — GPS and IP — fails. */
export async function locate() {
  let gpsReason = 'unavailable';
  try {
    const pos = await currentPosition();
    const place = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
    if (place.city) return { ...place, approx: false };
  } catch (e) {
    // PERMISSION_DENIED=1, POSITION_UNAVAILABLE=2, TIMEOUT=3
    gpsReason = e.reason || (e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable');
  }
  // GPS didn't yield a city — try the IP fallback before giving up.
  try {
    const place = await ipLocate();
    return { ...place, approx: true };
  } catch {
    throw Object.assign(new Error(gpsReason), { reason: gpsReason });
  }
}

/** Turn a thrown reason into something a human wants to read. */
export function explain(reason) {
  switch (reason) {
    case 'denied':
      return '📍 I need location permission. Tap the 🔒/ⓘ icon by the address bar → **Location → Allow**, then try again — or just type your city in ⚙️ Settings.';
    case 'timeout':
      return '📍 Your device took too long to get a fix (this happens on some installed iPhone apps). Try again, or set your **Home city** in ⚙️ Settings.';
    case 'unsupported':
      return '📍 This browser can’t share location. Set your **Home city** in ⚙️ Settings and everything works.';
    default:
      return '📍 I couldn’t get your location just now — no internet, or location is off. Try again, or set your **Home city** in ⚙️ Settings.';
  }
}
