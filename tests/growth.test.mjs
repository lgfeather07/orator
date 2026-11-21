// Unit tests for growth from real ballots: run with `npm run test:growth`.
import assert from 'node:assert/strict';
import { buildGrowth, highlights, shortLabel, trend } from '../.test-out/growth/growthStats.js';
let passed = 0; const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };
const b = (speaker, eventId, tournament, day, rank, rating, present = true) => ({ speaker, eventId, tournament, round: 1, rank, rating, present, marks: [], submittedAt: `2026-${day}T10:00:00Z` });

const rows = [
  b('Ana Able', 'info', 'Larkspur Invitational', '10-03', 2, 44), b('Ana Able', 'info', 'Larkspur Invitational', '10-03', 4, 40),
  b('ana able ', 'info', 'Thornbury Classic', '10-17', 1, 47), b('Ana Able', 'info', 'Ashgrove', '09-19', 5, 38),
  b('Ana Able', 'poetry', 'Thornbury Classic', '10-17', 3, null), b('Ana Able', 'poetry', 'Ashgrove', '09-19', 3, null),
  b('Ana Able', 'info', 'Ashgrove', '09-19', null, null, false),
  b('Ben Bold', 'extemp', 'Ashgrove', '09-19', 2, 45),
];
const stats = buildGrowth(rows);
test('one entry per student, names matched without case or spaces', () => assert.deepEqual(stats.map(s => s.student), ['Ana Able', 'Ben Bold']));
test('tournaments ordered by date, averages to one decimal', () => {
  const info = stats[0].events.info;
  assert.deepEqual(info.map(p => p.tournament), ['Ashgrove', 'Larkspur Invitational', 'Thornbury Classic']);
  assert.deepEqual(info.map(p => p.rating), [38, 42, 47]);
  assert.deepEqual(info.map(p => p.rank), [5, 3, 1]);
});
test('absent speakers are left out', () => assert.equal(stats[0].events.info[0].ballots, 1));
test('ballots without points keep the rank', () => assert.deepEqual(stats[0].events.poetry.map(p => [p.rating, p.rank]), [[null, 3], [null, 3]]));
test('trend needs two values and skips gaps', () => { assert.equal(trend([38, null, 47]), 9); assert.equal(trend([null, 40]), null); });
test('highlights: strongest and most improved', () => assert.deepEqual(highlights(stats[0]), { strongest: 'info', mostImproved: 'info' }));
test('no improvement means no most-improved event', () => assert.equal(highlights(stats[1]).mostImproved, null));
test('limit keeps the latest tournaments', () => assert.deepEqual(buildGrowth(rows, 2)[0].events.info.map(p => p.tournament), ['Larkspur Invitational', 'Thornbury Classic']));
test('short chart labels', () => { assert.equal(shortLabel('Larkspur Invitational'), 'Larkspur'); assert.equal(shortLabel('Brightwater High School Speech Tournament'), 'Brightwater'); assert.equal(shortLabel('Tournament'), 'Tournament'); });
console.log(`${passed} passed`);
