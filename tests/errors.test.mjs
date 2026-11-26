// Unit tests for tournament-day error reports and the status board: run with `npm run test:errors`.
import assert from 'node:assert/strict';
import { createThrottle, describeError, describeRequest, requestTarget, scrub } from '../.test-out/errors/errorLog.js';
import { roundsInProgress, stillOut, summarize } from '../.test-out/errors/statusBoard.js';
let passed = 0; const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };

test('the same message is recorded at most once a minute', () => {
  let now = 0; const gate = createThrottle(() => now);
  assert.equal(gate('a'), true); assert.equal(gate('a'), false); assert.equal(gate('b'), true);
  now = 59_999; assert.equal(gate('a'), false); now = 60_000; assert.equal(gate('a'), true);
});
test('at most 30 reports per page load', () => {
  let now = 0; const gate = createThrottle(() => now);
  const sent = Array.from({ length: 50 }, (_, i) => gate(`m${i}`)).filter(Boolean).length;
  assert.equal(sent, 30); now = 10 ** 9; assert.equal(gate('m0'), false);
});
test('scrub removes quoted text, emails and long numbers', () => {
  assert.equal(scrub('Unexpected token "Maya Rodriguez" in JSON'), 'Unexpected token "…" in JSON');
  assert.equal(scrub('mail pat@example.org or 4025550142'), 'mail [email] or #');
  assert.equal(scrub("Cannot read properties of undefined (reading 'name')"), "Cannot read properties of undefined (reading 'name')");
  assert.equal(scrub("Value 'Ana Able' is wrong"), "Value '…' is wrong");
  assert.ok(scrub('x'.repeat(900)).length <= 300);
});
test('engine errors keep their message; other errors keep only their type', () => {
  const type = new TypeError('a.b is not a function'); type.stack = 'TypeError: a.b is not a function\n    at go (http://localhost:5173/src/store.tsx?t=1:212:9)';
  assert.equal(describeError(type), 'TypeError: a.b is not a function at store.tsx:212');
  assert.equal(describeError(new Error('Maya Rodriguez is already entered as novice.')).startsWith('Error (message not recorded)'), true);
  assert.equal(describeError('Maya'), 'Error (message not recorded)');
});
test('request targets come from the URL path only', () => {
  assert.equal(requestTarget('https://x.supabase.co/rest/v1/ballots?select=*&school=ilike.Cedar'), 'ballots');
  assert.equal(requestTarget('https://x.supabase.co/rest/v1/rpc/tab_sheet'), 'rpc tab_sheet');
  assert.equal(requestTarget('https://x.supabase.co/auth/v1/token?grant_type=password'), 'auth token');
});
test('failed requests are described without content, and some are skipped', () => {
  assert.equal(describeRequest('post', 'https://x.supabase.co/rest/v1/entries', 403, '42501'), 'POST entries failed (403, 42501)');
  assert.equal(describeRequest('GET', 'https://x.supabase.co/rest/v1/rpc/tab_sheet', 0), 'GET rpc tab_sheet: no response (offline or blocked)');
  assert.equal(describeRequest('POST', 'https://x.supabase.co/rest/v1/app_errors', 500), null, 'a failing report is never reported');
  assert.equal(describeRequest('POST', 'https://x.supabase.co/auth/v1/token', 400), null, 'a wrong password is not an app error');
  assert.equal(describeRequest('GET', 'https://x.supabase.co/rest/v1/ballots', 200), null);
  assert.equal(describeRequest('GET', 'https://x.supabase.co/rest/v1/ballots', 400, 'Maya Rodriguez'), 'GET ballots failed (400)', 'odd codes are dropped');
});

const room = (id, round, judgeId = 'j', entries = 3) => ({ id, round, room: `Room ${id}`, judgeId, entryIds: Array.from({ length: entries }, (_, i) => `${id}-${i}`) });
const rooms = [room('1', 1), room('2', 1), room('3', 2), room('4', 2, null), room('5', 3), room('6', 3, 'j', 0)];
test('the earliest round with a room out is in progress; later rounds once started', () => {
  const states = { 1: 'submitted', 2: 'draft' };
  assert.deepEqual(roundsInProgress(rooms, id => states[id] ?? 'none'), [1]);
  assert.deepEqual(roundsInProgress(rooms, id => ({ ...states, 3: 'draft' })[id] ?? 'none'), [1, 2]);
  assert.deepEqual(roundsInProgress(rooms, id => (['1', '2'].includes(id) ? 'submitted' : 'none')), [2]);
  assert.deepEqual(roundsInProgress(rooms, () => 'submitted'), [3], 'everything in: the last round');
  assert.deepEqual(roundsInProgress([], () => 'none'), []);
});
test('counts and the still-out order', () => {
  const states = { 3: 'draft' };
  const current = rooms.filter(r => r.round === 2);
  assert.deepEqual(summarize(current, id => states[id] ?? 'none'), { total: 2, submitted: 0, drafts: 1, notStarted: 1, noJudge: 1 });
  assert.deepEqual(stillOut(rooms, id => ({ 1: 'submitted', ...states })[id] ?? 'none').map(r => r.id), ['2', '4', '5', '3'], 'not started first, empty rooms left out');
});
console.log(`${passed} passed`);
