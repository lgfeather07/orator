// Unit tests for paper-ballot entry checks: run with `npm run test:paper` (compiles src/paperBallots.ts into .test-out first).
import assert from 'node:assert/strict';
import { blankRow, checkPaper, fromEntries, marksTotal, parseTime, timeHint, toEntries } from '../.test-out/paperBallots.js';
import { ballotEvents } from '../.test-out/ballots.js';
let passed = 0; const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };

const room = (lines) => lines.map(([name, rank, points = '', extra = {}]) => ({ ...blankRow(name.toLowerCase(), name), rank: String(rank), points: String(points), ...extra }));
const fields = (problems) => problems.map(problem => `${problem.code}:${problem.field}`).sort();
const plain = { doubleEntry: false, useMarks: false };

test('a clean ballot has no problems', () => {
  assert.deepEqual(checkPaper(room([['Ann', 1, 48], ['Ben', 2, 45], ['Cy', 3, 40]]), plain), []);
  assert.deepEqual(checkPaper(room([['Ann', 1], ['Ben', 2], ['Cy', 3]]), plain), [], 'points are optional');
});
test('duplicate ranks are flagged on both speakers', () => {
  assert.deepEqual(fields(checkPaper(room([['Ann', 1], ['Ben', 1], ['Cy', 3]]), plain)), ['ann:rank', 'ben:rank']);
});
test('ranks must be 1..present', () => {
  const rows = room([['Ann', 1], ['Ben', 2], ['Cy', '', '', { noShow: true }], ['Di', 3]]);
  assert.deepEqual(checkPaper(rows, plain), []);
  rows[3].rank = '4';
  assert.match(checkPaper(rows, plain)[0].message, /1–3/);
  rows[3].rank = '0';
  assert.equal(checkPaper(rows, plain)[0].field, 'rank');
});
test('missing rank is a required problem (shown on save only)', () => {
  const problems = checkPaper(room([['Ann', 1], ['Ben', '']]), plain);
  assert.equal(problems.length, 1); assert.equal(problems[0].required, true);
});
test('points must be 35-50', () => {
  assert.deepEqual(fields(checkPaper(room([['Ann', 1, 34], ['Ben', 2, 51]]), plain)), ['ann:points', 'ben:points']);
});
test('points for some but not all speakers', () => {
  const problems = checkPaper(room([['Ann', 1, 48], ['Ben', 2]]), plain);
  assert.deepEqual(fields(problems), ['ben:points']); assert.equal(problems[0].required, true);
});
test('a higher rank cannot have fewer points unless the lower speaker has a time penalty', () => {
  assert.deepEqual(fields(checkPaper(room([['Ann', 1, 44], ['Ben', 2, 46]]), plain)), ['ben:points']);
  assert.deepEqual(checkPaper(room([['Ann', 1, 44], ['Ben', 2, 46, { penalty: true }]]), plain), []);
  // Equal points are fine.
  assert.deepEqual(checkPaper(room([['Ann', 1, 44], ['Ben', 2, 44]]), plain), []);
});
test('double entry: confirm must match', () => {
  const rows = room([['Ann', 1, '', { confirm: '1' }], ['Ben', 2, '', { confirm: '3' }], ['Cy', 3]]);
  const problems = checkPaper(rows, { doubleEntry: true, useMarks: false });
  assert.deepEqual(fields(problems), ['ben:confirm', 'cy:confirm']);
  assert.equal(problems.find(p => p.code === 'cy').required, true);
  assert.equal(problems.find(p => p.code === 'ben').required, false);
});
test('section marks: five of 1-10, total at least 35, used for rank checks', () => {
  assert.equal(marksTotal(['9', '9', '10', '9', '10']), 47);
  assert.equal(marksTotal(['5', '5', '5', '5', '5']), 35);
  assert.equal(marksTotal(['9', '9', '9', '9', '']), null);
  const marks = { doubleEntry: false, useMarks: true };
  const rows = room([['Ann', 1, '', { marks: ['8', '8', '8', '8', '8'] }], ['Ben', 2, '', { marks: ['9', '9', '9', '9', '9'] }]]);
  assert.deepEqual(fields(checkPaper(rows, marks)), ['ben:marks']);
  rows[1].marks = ['9', '9', '9', '9', '11'];
  assert.match(checkPaper(rows, marks)[0].message, /1–10/);
  rows[1].marks = ['7', '7', '7', '7', ''];
  assert.equal(checkPaper(rows, marks)[0].required, true);
});
test('times: 9:41, 941, 9.41 and 10 are read; others are typos', () => {
  assert.equal(parseTime('9:41'), 581); assert.equal(parseTime('941'), 581); assert.equal(parseTime('9.41'), 581); assert.equal(parseTime('10'), 600); assert.equal(parseTime(''), null);
  assert.ok(Number.isNaN(parseTime('9:75'))); assert.ok(Number.isNaN(parseTime('abc')));
  assert.deepEqual(fields(checkPaper(room([['Ann', 1, '', { time: '9:75' }]]), plain)), ['ann:time']);
});
test('over-time hint only without the penalty ticked', () => {
  const info = ballotEvents.find(event => event.id === 'info');
  assert.match(timeHint({ ...blankRow('a', 'A'), time: '10:41' }, info), /Over 10:00 by 0:41/);
  assert.equal(timeHint({ ...blankRow('a', 'A'), time: '10:20' }, info), '');
  assert.equal(timeHint({ ...blankRow('a', 'A'), time: '10:41', penalty: true }, info), '');
});
test('entries round-trip', () => {
  const rows = room([['Ann', 2, 44, { time: '9:41' }], ['Ben', 1, 46, { penalty: true }], ['Cy', '', '', { noShow: true }]]);
  const saved = toEntries(rows, false);
  assert.deepEqual(saved[0], { code: 'ann', present: true, rank: 2, rating: 44, time_seconds: 581, time_penalty: false, marks: [] });
  assert.deepEqual(saved[2], { code: 'cy', present: false, rank: null, rating: null, time_seconds: null, time_penalty: false, marks: [] });
  const back = fromEntries(rows.map(row => ({ code: row.code, name: row.name })), saved);
  assert.equal(back.rows[0].time, '9:41'); assert.equal(back.rows[1].penalty, true); assert.equal(back.rows[2].noShow, true); assert.equal(back.useMarks, false);
});
console.log(`${passed} tests passed`);
