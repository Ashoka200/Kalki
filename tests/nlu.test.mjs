// Run: node --test tests/nlu.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as nlu from '../js/nlu.js';

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
  assert.equal(nlu.detect('change the theme'), 'theme');
  assert.equal(nlu.detect('hello'), 'greet');
  assert.equal(nlu.detect('xyzzy'), null);
});

test('profile facts', () => {
  assert.deepEqual(nlu.detectProfileFact('my name is ashok'), { key: 'name', value: 'Ashok' });
  assert.deepEqual(nlu.detectProfileFact('I live in san jose'), { key: 'city', value: 'San Jose' });
  assert.deepEqual(nlu.detectProfileFact('my budget is $2,000'), { key: 'budget', value: 2000 });
});

test('money parsing', () => {
  assert.equal(nlu.parseMoney('$1,500'), 1500);
  assert.equal(nlu.parseMoney('1.5k'), 1500);
  assert.equal(nlu.parseMoney('nope'), null);
  assert.equal(nlu.extractMoney('2 bed in austin under $1800'), 1800);
  assert.equal(nlu.extractMoney('budget of 2k'), 2000);
  assert.equal(nlu.extractMoney('a flat with 2 bedrooms'), null); // bare numbers are not money
});

test('city / beds / party / zip extraction', () => {
  assert.equal(nlu.extractCity('find rentals in austin under $1500'), 'Austin');
  assert.equal(nlu.extractCity('apartments near new york, 2br'), 'New York');
  assert.equal(nlu.extractBeds('a 2br place'), 2);
  assert.equal(nlu.extractBeds('studio please'), 0);
  assert.equal(nlu.extractPartySize('table for 4 tonight'), 4);
  assert.equal(nlu.extractZip('plans for 94103 please'), '94103');
});

test('date parsing', () => {
  assert.equal(nlu.parseDate('today', BASE).getDate(), 20);
  assert.equal(nlu.parseDate('tomorrow', BASE).getDate(), 21);
  assert.equal(nlu.parseDate('friday', BASE).getDate(), 24); // next Friday from Mon
  assert.equal(nlu.parseDate('monday', BASE).getDate(), 27); // "monday" on a Monday = next week
  assert.equal(nlu.parseDate('2026-08-03', BASE).getMonth(), 7);
  assert.equal(nlu.parseDate('aug 3', BASE).getDate(), 3);
  assert.equal(nlu.parseDate('3rd aug', BASE).getMonth(), 7);
  assert.equal(nlu.parseDate('jan 5', BASE).getFullYear(), 2027); // past month rolls to next year
  assert.equal(nlu.parseDate('whenever', BASE), null);
});

test('time parsing', () => {
  assert.deepEqual(nlu.parseTime('5pm'), { h: 17, m: 0 });
  assert.deepEqual(nlu.parseTime('5:30 am'), { h: 5, m: 30 });
  assert.deepEqual(nlu.parseTime('17:45'), { h: 17, m: 45 });
  assert.deepEqual(nlu.parseTime('noon'), { h: 12, m: 0 });
  assert.deepEqual(nlu.parseTime('12am'), { h: 0, m: 0 });
  assert.equal(nlu.parseTime('sometime'), null);
});

test('travel + events + court extraction', () => {
  assert.equal(nlu.extractOrigin('flight from austin to new york on aug 3'), 'Austin');
  assert.equal(nlu.extractDest('flight from austin to new york on aug 3'), 'New York');
  assert.equal(nlu.extractNights('hotel in paris for 3 nights'), 3);
  assert.equal(nlu.extractPartySize('hotel for 3 nights'), null); // nights ≠ guests
  assert.equal(nlu.extractCity('events near me'), null); // "me" is not a city
  assert.equal(nlu.extractSport('book a badminton court tomorrow'), 'badminton');
  assert.equal(nlu.extractEventKind('any music festivals in town'), 'music');
});

test('specialty + skip/cancel', () => {
  assert.equal(nlu.extractSpecialty('need a dentist asap'), 'dentist');
  assert.equal(nlu.extractSpecialty('see a gp'), 'general practitioner');
  assert.ok(nlu.wantsSkip('skip'));
  assert.ok(nlu.wantsCancel('never mind'));
  assert.ok(!nlu.wantsCancel('cancel my subscription tips'));
});
