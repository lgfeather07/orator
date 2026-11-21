// Unit tests for NSAA district-to-State qualifying: run with `npm run test:qualifying`.
import assert from 'node:assert/strict';
import { qualifierFor, STATE_QUALIFYING_DEFAULT } from '../.test-out/qualifying/tournament.js';
let passed = 0; const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };
const rule = STATE_QUALIFYING_DEFAULT;
test('default: top three qualify, fourth is the alternate', () => assert.deepEqual([1, 2, 3, 4, 5].map(place => qualifierFor(rule, 'info', place)), ['state', 'state', 'state', 'alternate', null]));
test('not a district: nobody qualifies', () => assert.equal(qualifierFor(undefined, 'info', 1), null));
test('novice divisions never qualify', () => assert.equal(qualifierFor(rule, 'info:novice', 1), null));
test('no alternates', () => assert.equal(qualifierFor({ qualifiers: 2, alternates: 0 }, 'poetry', 3), null));
test('two alternates', () => assert.deepEqual([3, 4, 5, 6].map(place => qualifierFor({ qualifiers: 3, alternates: 2 }, 'poetry', place)), ['state', 'alternate', 'alternate', null]));
console.log(`${passed} passed`);
