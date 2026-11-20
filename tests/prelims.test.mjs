// Unit tests for tournaments with no final round: run with `npm run test:prelims`.
import assert from 'node:assert/strict';
import { prelimPlacings, NSAA_TEAM_POINTS } from '../.test-out/results.js';
let passed = 0; const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };
const s = (id, place, decidedBy = '') => ({ entryId: id, student: id, school: 'S' + id, ranks: [1, 2, 1], cumulativeRank: 4, opponentsAverageRank: 3, reciprocals: 2.5, ratingPoints: 140, place, advances: place <= 6, decidedBy });

test('top six take places 1-6 and the NSAA points', () => {
  const placings = prelimPlacings([1, 2, 3, 4, 5, 6, 7, 8].map(n => s('e' + n, n)));
  assert.equal(placings.length, 6);
  assert.deepEqual(placings.map(p => p.teamPoints), NSAA_TEAM_POINTS);
});
test('speakers still tied share the place and split the points it covers', () => {
  const placings = prelimPlacings([s('a', 1), s('b', 2, 'Still tied'), s('c', 2, 'Still tied'), s('d', 4), s('e', 5), s('f', 6)]);
  assert.deepEqual(placings.map(p => [p.place, p.teamPoints]), [[1, 20], [2, 17], [2, 17], [4, 14], [5, 12], [6, 10]]);
  assert.equal(placings[1].decidedBy, 'Tied for 2');
});
test('a tie across the last announced place is announced together; points beyond the scale are 0', () => {
  const placings = prelimPlacings([s('a', 1), s('b', 2), s('c', 3), s('d', 4), s('e', 5), s('f', 6, 'Still tied'), s('g', 6, 'Still tied'), s('h', 8)]);
  assert.deepEqual(placings.map(p => p.entryId), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.deepEqual(placings.slice(5).map(p => p.teamPoints), [5, 5]);
});
test('fewer places announced, custom scale', () => {
  const placings = prelimPlacings([1, 2, 3, 4, 5].map(n => s('e' + n, n)), [10, 8, 6], 3);
  assert.deepEqual(placings.map(p => p.teamPoints), [10, 8, 6]);
});
test('a field smaller than the places announced places everyone', () => {
  assert.equal(prelimPlacings([s('a', 1), s('b', 2)]).length, 2);
});
console.log(`\n${passed} tests passed`);
