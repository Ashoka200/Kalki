// Run: node --test tests/nlu.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

// Browser globals for modules under test (regions.js reads both lazily).
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
  key(i) { return [...this._m.keys()][i]; },
  get length() { return this._m.size; },
};
Object.defineProperty(globalThis, 'navigator', { value: { language: 'en-US' }, configurable: true });

const nlu = await import('../js/nlu.js');
const regions = await import('../js/regions.js');
const { store } = await import('../js/store.js');

const BASE = new Date(2026, 6, 20); // Mon Jul 20 2026

test('intent detection', () => {
  assert.equal(nlu.detect('find me an apartment to rent'), 'rent');
  assert.equal(nlu.detect('best deal on running shoes'), 'shopping');
  assert.equal(nlu.detect('I need health insurance'), 'insurance');
  assert.equal(nlu.detect('book a dentist appointment'), 'appointment');
  assert.equal(nlu.detect('reserve a table for dinner'), 'reservation');
  assert.equal(nlu.detect('remind me to pay rent'), 'reminder'); // reminder outranks rent keyword
  assert.equal(nlu.detect('show my bookings'), 'bookings');
  assert.equal(nlu.detect('book a hotel in paris'), 'hotel');
  assert.equal(nlu.detect('find flights to delhi'), 'flight');
  assert.equal(nlu.detect('any festivals in austin?'), 'events');
  assert.equal(nlu.detect('book a badminton court'), 'court');
  assert.equal(nlu.detect('reserve a tennis court'), 'court'); // court beats reservation
});

test('new skill intents', () => {
  assert.equal(nlu.detect('order groceries for the week'), 'groceries');
  assert.equal(nlu.detect('book an uber to the airport'), 'rides');
  assert.equal(nlu.detect('get me a cab'), 'rides');
  assert.equal(nlu.detect('find software engineer jobs'), 'jobs');
  assert.equal(nlu.detect('cheapest petrol near me'), 'gas');
  assert.equal(nlu.detect('buy a used car'), 'usedcar'); // beats shopping's "buy"
  assert.equal(nlu.detect('price for my medication'), 'meds'); // beats shopping's "price"
  assert.equal(nlu.detect('track my electricity bill'), 'bills');
  assert.equal(nlu.detect('remind me about the water bill'), 'reminder'); // reminder outranks bills
});

test('entity extraction', () => {
  assert.equal(nlu.extractCity('apartments in San Marcos under $1200'), 'San Marcos');
  assert.equal(nlu.extractMoney('under $1.2k please'), 1200);
  assert.equal(nlu.extractBeds('a 2br near downtown'), 2);
  assert.equal(nlu.extractBeds('looking for a studio'), 0);
  assert.equal(nlu.extractPartySize('table for 6 tonight'), 6);
  assert.equal(nlu.extractZip('my zip is 78701'), '78701');
  assert.equal(nlu.extractZip('pin 560001 here'), '560001');
  assert.equal(nlu.extractSport('book a pickleball court'), 'pickleball');
  assert.equal(nlu.extractSpecialty('need a dermatologist asap'), 'dermatologist');
  assert.equal(nlu.extractOrigin('flight from austin to new york'), 'Austin');
  assert.equal(nlu.extractDest('flight from austin to new york'), 'New York');
  assert.equal(nlu.extractNights('3 nights in miami'), 3);
});

test('money parser rejects non-money counts', () => {
  assert.equal(nlu.parseMoney('2 bedrooms'), null);
  assert.equal(nlu.parseMoney('4 people'), null);
  assert.equal(nlu.parseMoney('3 nights'), null);
  assert.equal(nlu.parseMoney('$1,500'), 1500);
  assert.equal(nlu.parseMoney('1.5k'), 1500);
});

test('date parsing', () => {
  assert.equal(nlu.parseDate('tomorrow', BASE).getDate(), 21);
  assert.equal(nlu.parseDate('day after tomorrow', BASE).getDate(), 22); // not +1
  assert.equal(nlu.parseDate('friday', BASE).getDay(), 5);
  assert.equal(nlu.parseDate('aug 3', BASE).getMonth(), 7);
  assert.equal(nlu.parseDate('12/25', BASE).getDate(), 25);
  assert.equal(nlu.parseDate('nothing here', BASE), null);
});

test('relative + fancy dates', () => {
  assert.equal(nlu.parseDate('in 3 days', BASE).getDate(), 23);
  assert.equal(nlu.parseDate('in 2 weeks', BASE).getDate(), 3); // Aug 3
  assert.equal(nlu.parseDate('this weekend', BASE).getDay(), 6); // Saturday
  assert.equal(nlu.parseDate('next weekend', BASE).getDate(), 1); // Sat Aug 1
  assert.equal(nlu.parseDate('end of month', BASE).getDate(), 31);
});

test('time parsing', () => {
  assert.deepEqual(nlu.parseTime('at 5:30 pm'), { h: 17, m: 30 });
  assert.deepEqual(nlu.parseTime('10am'), { h: 10, m: 0 });
  assert.deepEqual(nlu.parseTime('noon'), { h: 12, m: 0 });
  assert.deepEqual(nlu.parseTime('evening works'), { h: 19, m: 0 });
});

test('parseWhen handles relative and combined datetimes', () => {
  const base = new Date(2026, 6, 20, 12, 0); // Mon Jul 20, noon
  const inTwo = nlu.parseWhen('in 2 hours', base);
  assert.equal(inTwo.hasTime, true);
  assert.equal(inTwo.when.getHours(), 14);
  const inMin = nlu.parseWhen('in 20 minutes', base);
  assert.equal(inMin.when.getMinutes(), 20);
  const combo = nlu.parseWhen('tomorrow 5pm', base);
  assert.equal(combo.when.getDate(), 21);
  assert.equal(combo.when.getHours(), 17);
  const dateOnly = nlu.parseWhen('friday', base);
  assert.equal(dateOnly.hasTime, false);
  const timeOnly = nlu.parseWhen('9am', base); // already past noon → tomorrow
  assert.equal(timeOnly.when.getDate(), 21);
  assert.equal(nlu.parseWhen('nothing', base), null);
});

test('repeat extraction', () => {
  assert.equal(nlu.extractRepeat('remind me every day to stretch'), 'daily');
  assert.equal(nlu.extractRepeat('every friday 9am'), 'weekly');
  assert.equal(nlu.extractRepeat('pay rent monthly'), 'monthly');
  assert.equal(nlu.extractRepeat('just once'), null);
});

test('profile facts', () => {
  assert.deepEqual(nlu.detectProfileFact('My name is Maya'), { key: 'name', value: 'Maya' });
  assert.deepEqual(nlu.detectProfileFact('i live in austin'), { key: 'city', value: 'Austin' });
  assert.equal(nlu.detectProfileFact('my budget is 1.8k').value, 1800);
});

test('specialty + skip/cancel', () => {
  assert.equal(nlu.extractSpecialty('gp visit'), 'general practitioner');
  assert.ok(nlu.wantsSkip('skip'));
  assert.ok(nlu.wantsSkip("doesn't matter"));
  assert.ok(nlu.wantsCancel('never mind'));
  assert.ok(!nlu.wantsCancel('cancel my subscription please'));
});

test('regions: marketplaces follow the region setting', () => {
  store.set('profile', { region: 'in' });
  const rent = regions.marketCards('rent', { city: 'Pune' });
  assert.ok(rent.some((c) => c.url.includes('nobroker.in')));
  assert.ok(rent.some((c) => c.url.includes('magicbricks.com')));
  const meds = regions.marketCards('meds', { drug: 'metformin' });
  assert.ok(meds.some((c) => c.url.includes('1mg.com')));
  assert.equal(regions.fuelWord(), 'petrol');

  store.set('profile', { region: 'us' });
  const rentUS = regions.marketCards('rent', { city: 'Austin' });
  assert.ok(rentUS.some((c) => c.url.includes('zillow.com')));
  assert.equal(regions.fuelWord(), 'gas');

  store.set('profile', { region: 'uk' });
  assert.ok(regions.marketCards('shopping', { item: 'kettle' }).some((c) => c.url.includes('hotukdeals.com')));
  // regions without a specific pack fall back to US links
  assert.ok(regions.marketCards('gas', { area: 'London' }).some((c) => c.url.includes('gasbuddy.com')));
  store.set('profile', {});
});

test('postcode answers accept international formats', () => {
  assert.equal(nlu.parsePostcode('78701'), '78701');
  assert.equal(nlu.parsePostcode('560001'), '560001');
  assert.equal(nlu.parsePostcode('SW1A 1AA'), 'SW1A 1AA');
  assert.equal(nlu.parsePostcode('this is not a postcode at all'), null);
});
