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

/* ---------- v4: personal skills ---------- */
const personal = await import('../js/personal.js');

test('v4 intents', () => {
  assert.equal(nlu.detect('spent $40 on groceries today'), 'expense'); // beats groceries keyword tie
  assert.equal(nlu.detect('show my spending'), 'expense');
  assert.equal(nlu.detect('add milk to shopping list'), 'list'); // beats shopping
  assert.equal(nlu.detect('set a timer for 10 minutes'), 'timer');
  assert.equal(nlu.detect('good morning'), 'brief'); // brief outranks greet
  assert.equal(nlu.detect('hello there'), 'greet');
});

test('typo tolerance', () => {
  assert.equal(nlu.detect('remnid me to call mom'), 'reminder');
  assert.equal(nlu.detect('order some grocries'), 'groceries');
  assert.equal(nlu.detect('grocry deals please'), 'shopping'); // exact keyword ("deals") beats fuzzy
  assert.equal(nlu.detect('book a fligth'), 'flight');
  assert.equal(nlu.detect('zzzz qqqq'), null); // garbage stays unknown
});

test('expense parsing + categories', () => {
  assert.deepEqual(personal.parseExpense('spent $40 on groceries'), { amt: 40, note: 'groceries', cat: 'groceries' });
  assert.equal(personal.parseExpense('paid 250 for chai').cat, 'food');
  assert.equal(personal.parseExpense('add expense 120 uber').cat, 'transport');
  assert.equal(personal.parseExpense('spent 1.5k on new phone').amt, 1500);
  assert.equal(personal.parseExpense('nothing to log here'), null);
});

test('expense store + summary + csv', () => {
  localStorage._m.clear();
  personal.addExpense({ amt: 40, note: 'groceries', cat: 'groceries' });
  personal.addExpense({ amt: 250, note: 'chai', cat: 'food' });
  personal.addExpense({ amt: 60, note: 'petrol', cat: 'transport' });
  const s = personal.summarize(personal.monthExpenses());
  assert.equal(s.total, 350);
  assert.equal(s.cats[0][0], 'food'); // biggest category first
  const csv = personal.expensesCSV(personal.monthExpenses());
  assert.ok(csv.startsWith('date,amount,category,note'));
  assert.ok(csv.includes('250,food,"chai"'));
  localStorage._m.clear();
});

test('list commands', () => {
  localStorage._m.clear();
  assert.deepEqual(personal.parseListCmd('add milk to shopping list'), { op: 'add', item: 'milk', list: 'shopping' });
  assert.deepEqual(personal.parseListCmd('add sunscreen to my packing list'), { op: 'add', item: 'sunscreen', list: 'packing' });
  assert.deepEqual(personal.parseListCmd('show my packing list'), { op: 'show', list: 'packing' });
  assert.equal(personal.parseListCmd('check off milk').op, 'check');
  assert.equal(personal.parseListCmd('remove milk from shopping list').op, 'remove');
  assert.equal(personal.parseListCmd('my lists').op, 'overview');
  assert.equal(personal.parseListCmd('just chatting about lists of things'), null);

  personal.runListCmd({ op: 'add', item: 'milk', list: 'shopping' });
  personal.runListCmd({ op: 'add', item: 'rice', list: 'shopping' });
  personal.runListCmd({ op: 'check', item: 'milk', list: 'shopping' });
  const shown = personal.runListCmd({ op: 'show', list: 'shopping' });
  assert.ok(shown.text.includes('☑ milk'));
  assert.ok(shown.text.includes('☐ rice'));
  assert.ok(shown.text.includes('(1 to go)'));
  localStorage._m.clear();
});

test('timers', () => {
  localStorage._m.clear();
  assert.equal(personal.parseTimer('set a timer for 10 minutes'), 600);
  assert.equal(personal.parseTimer('timer for 45 seconds'), 45);
  assert.equal(personal.parseTimer('2 hour timer'), 7200);
  assert.equal(personal.parseTimer('no timer words that parse'), null);
  personal.addTimer(0.001, 'test');
  const due = personal.popDueTimers(Date.now() + 100);
  assert.equal(due.length, 1);
  assert.equal(personal.listTimers().length, 0);
  localStorage._m.clear();
});

test('quick math', () => {
  assert.ok(personal.quickMath('15% tip on 84').includes('12.6'));
  assert.ok(personal.quickMath('15% tip on 84').includes('96.6'));
  assert.ok(personal.quickMath('20% of 250').includes('50'));
  assert.ok(personal.quickMath('split 1840 between 4').includes('460'));
  assert.ok(personal.quickMath('split 100 between 4 with 10% tip').includes('27.5'));
  assert.ok(personal.quickMath("what's 45*12").includes('540'));
  assert.equal(personal.quickMath('tell me about paris'), null);
});

/* ---------- v5: habits, chat search ---------- */

test('habit command parsing', () => {
  assert.deepEqual(personal.parseHabitCmd('track habit workout'), { op: 'add', name: 'workout' });
  assert.deepEqual(personal.parseHabitCmd('start tracking a habit: reading'), { op: 'add', name: 'reading' });
  assert.deepEqual(personal.parseHabitCmd('did workout'), { op: 'log', name: 'workout' });
  assert.deepEqual(personal.parseHabitCmd('I completed my reading today'), { op: 'log', name: 'reading' });
  assert.equal(personal.parseHabitCmd('my habits').op, 'show');
  assert.equal(personal.parseHabitCmd('stop tracking workout habit').op, 'remove');
  assert.equal(personal.parseHabitCmd('find me an apartment'), null);
  assert.equal(personal.parseHabitCmd('track my electricity bill'), null); // bills, not habits
});

test('habit streaks', () => {
  localStorage._m.clear();
  const day = (offset) => {
    const d = new Date(2026, 6, 26);
    d.setDate(d.getDate() + offset);
    return d;
  };
  personal.runHabitCmd({ op: 'add', name: 'workout' });
  personal.runHabitCmd({ op: 'log', name: 'workout' }, day(-2));
  personal.runHabitCmd({ op: 'log', name: 'workout' }, day(-1));
  const r = personal.runHabitCmd({ op: 'log', name: 'workout' }, day(0));
  assert.ok(r.text.includes('3 day'));
  // unknown habit falls through
  assert.equal(personal.runHabitCmd({ op: 'log', name: 'juggling' }).unknown, true);
  // streak survives when today isn't logged yet (counts from yesterday)
  assert.equal(personal.streakOf(['2026-07-24', '2026-07-25'], new Date(2026, 6, 26)), 2);
  // broken streak resets
  assert.equal(personal.streakOf(['2026-07-20'], new Date(2026, 6, 26)), 0);
  localStorage._m.clear();
});

test('chat search parsing', () => {
  assert.equal(personal.parseSearchCmd('search chat for rent'), 'rent');
  assert.equal(personal.parseSearchCmd('find my messages for austin'), 'austin');
  assert.equal(personal.parseSearchCmd('search history budget'), 'budget');
  assert.equal(personal.parseSearchCmd('search for flights to delhi'), null); // deal search, not chat search
  assert.equal(personal.parseSearchCmd('find me an apartment'), null);
});

/* ---------- v6: free internet answers ---------- */
const web = await import('../js/web.js');

test('web query parsing', () => {
  localStorage._m.clear();
  assert.deepEqual(web.parseWebQuery('weather in Austin'), { kind: 'weather', city: 'Austin' });
  assert.deepEqual(web.parseWebQuery("what's the weather like in New Delhi?"), { kind: 'weather', city: 'New Delhi' });
  assert.equal(web.parseWebQuery('weather').city, null); // no profile city set
  store.set('profile', { city: 'Pune' });
  assert.equal(web.parseWebQuery('weather').city, 'Pune');
  store.set('profile', {});

  assert.deepEqual(web.parseWebQuery('convert 100 usd to inr'), { kind: 'currency', amount: 100, from: 'USD', to: 'INR' });
  assert.deepEqual(web.parseWebQuery('2,500 EUR in GBP'), { kind: 'currency', amount: 2500, from: 'EUR', to: 'GBP' });

  assert.deepEqual(web.parseWebQuery('bitcoin price'), { kind: 'crypto', coin: 'bitcoin' });
  assert.deepEqual(web.parseWebQuery('how much is eth?'), { kind: 'crypto', coin: 'ethereum' });

  assert.deepEqual(web.parseWebQuery('define serendipity'), { kind: 'define', word: 'serendipity' });
  assert.deepEqual(web.parseWebQuery('what does ubiquitous mean'), { kind: 'define', word: 'ubiquitous' });

  assert.deepEqual(web.parseWebQuery('who is Marie Curie?'), { kind: 'wiki', topic: 'Marie Curie' });
  assert.deepEqual(web.parseWebQuery('what is a black hole'), { kind: 'wiki', topic: 'black hole' });

  // must NOT hijack other skills
  assert.equal(web.parseWebQuery('find me an apartment'), null);
  assert.equal(web.parseWebQuery('remind me to call mom'), null);
  assert.equal(web.parseWebQuery('spent $40 on groceries'), null);
  localStorage._m.clear();
});

/* ---------- v7: trip planner ---------- */

test('trip parsing', () => {
  assert.equal(nlu.detect('Plan a trip in Zion or Seattle on 14th Aug 2026 to 16th Aug 2026 for a couple on their wedding anniversary'), 'trip');
  assert.equal(nlu.extractTripDest('Plan a trip in Zion or Seattle on 14th Aug 2026'), 'Zion or Seattle');
  assert.equal(nlu.extractTripDest('vacation to Goa for new year'), 'Goa');
  assert.equal(nlu.extractOccasion('for a couple on their wedding anniversary'), 'anniversary');
  const start = nlu.parseDate('trip on 14th Aug 2026', BASE);
  assert.equal(start.getMonth(), 7); assert.equal(start.getDate(), 14);
  const ret = nlu.extractReturnDate('on 14th Aug 2026 to 16th Aug 2026 for a couple', BASE);
  assert.equal(ret.getDate(), 16);
  assert.equal(nlu.extractReturnDate('plan a trip to Zion on friday', BASE), null); // "to Zion" is not a date
});

test('explicit years are honored', () => {
  const base = new Date(2026, 7, 23); // Aug 23 2026 — past Aug 14
  assert.equal(nlu.parseDate('14th Aug 2026', base).getFullYear(), 2026); // not rolled to 2027
  assert.equal(nlu.parseDate('Aug 14, 2027', base).getFullYear(), 2027);
  assert.equal(nlu.parseDate('aug 14', base).getFullYear(), 2027); // no year + past → next occurrence
  assert.equal(nlu.parseDate('sep 2', base).getFullYear(), 2026);
});

/* ---------- v8: context understanding mid-flow ---------- */
const { Brain } = await import('../js/brain.js');

test('mid-flow answers are fully mined (the blood-test chat)', () => {
  localStorage._m.clear();
  const b = new Brain();
  const r1 = b.handle('Doctor appointment');
  assert.ok(r1.text.includes('What day?')); // specialty "doctor" already extracted
  const r2 = b.handle('Book a doctors appointment on weekend for blood test near my location after 12pm');
  // date (weekend→Sat), time (12pm) and refined specialty (blood test) all
  // mined from one message — only the optional place question remains.
  assert.ok(r2.text.includes('Which hospital or clinic?'), r2.text);
  const r3 = b.handle('skip');
  assert.ok(r3.text.includes('Booked ✅'), r3.text);
  assert.ok(r3.text.includes('Blood test'), r3.text);
  assert.ok(r3.text.includes('12:00 PM'), r3.text);
  localStorage._m.clear();
});

test('mid-flow restatement for another skill switches flows', () => {
  localStorage._m.clear();
  const b = new Brain();
  b.handle('find me a rental in austin');       // rent flow → asks budget
  const r = b.handle('actually book a hotel in paris for 2 nights');
  assert.ok(r.text.includes('hotel') || r.text.includes('Check-in') || r.text.includes('guests'), r.text);
  localStorage._m.clear();
});

test('short slot answers with incidental keywords do NOT switch flows', () => {
  localStorage._m.clear();
  const b = new Brain();
  b.handle('book a table at Nobu');             // reservation flow → asks day
  const r = b.handle('reserve for friday');     // "reserve" keyword, but it's a date answer
  assert.ok(r.text.includes('What time?'), r.text);
  localStorage._m.clear();
});
