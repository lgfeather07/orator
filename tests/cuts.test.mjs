// Unit tests for the cut preview: run with `npm run test:cuts` (compiles src/results.ts into .test-out first).
import assert from 'node:assert/strict';
import { prelimStandings, cutAt, cutChoices, nextIn, cutFor, FINALISTS } from '../.test-out/results.js';
let passed = 0; const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };

/** rounds: list of rounds; each round a list of rooms; each room the entry ids in rank order. */
function field(rounds) {
  const ids = [...new Set(rounds.flat(2))];
  const entries = ids.map(id => ({ id, student: id.toUpperCase(), school: 'S' + id, eventId: 'info' }));
  const sections = [], results = [];
  rounds.forEach((rooms, r) => rooms.forEach((room, i) => {
    const id = `r${r + 1}-${i}`; sections.push({ id, round: r + 1, eventId: 'info', label: '', room: '', judgeId: null, entryIds: room });
    room.forEach((entryId, k) => results.push({ entryId, round: r + 1, sectionId: id, rank: k + 1, rating: 50 - k * 2 }));
  }));
  return { entries, sections, results };
}
const order = s => s.map(x => x.entryId).join(' ');

// 1. Ten speakers, one room, the same order every round: every cumulative rank differs.
const ten = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
const f1 = field([[ten], [ten], [ten]]);
test('cut at 6 with no tie', () => {
  const s = prelimStandings(f1.entries, f1.sections, f1.results);
  assert.equal(s.filter(x => x.advances).length, 6);
  assert.deepEqual(cutAt(s, 6), { cut: 6, advancing: 6, tiedAtCut: 0, everyone: false, decidedBy: 'Cumulative rank', overRoom: false });
  assert.equal(FINALISTS, 6);
});
test('smaller cut (4)', () => {
  const s = prelimStandings(f1.entries, f1.sections, f1.results, 4);
  assert.equal(order(s.filter(x => x.advances)), 'a b c d');
  assert.equal(cutAt(s, 4).advancing, 4);
});
test('larger cut (8)', () => {
  const s = prelimStandings(f1.entries, f1.sections, f1.results, 8);
  assert.equal(s.filter(x => x.advances).length, 8);
  assert.deepEqual(cutAt(s, 8), { cut: 8, advancing: 8, tiedAtCut: 0, everyone: false, decidedBy: 'Cumulative rank', overRoom: false });
});
test('next in: the next two below the cut, in order, and after one moves up', () => {
  const s = prelimStandings(f1.entries, f1.sections, f1.results);
  assert.equal(order(nextIn(s)), 'g h');
  // c withdrew, g moved up: the alternates are now h and i.
  assert.equal(order(nextIn(s, ['a', 'b', 'd', 'e', 'f', 'g'])), 'h i');
  assert.equal(order(nextIn(prelimStandings(f1.entries, f1.sections, f1.results, 8))), 'i j');
});
test('cut choices are 4 to 8, limited by field size', () => {
  assert.deepEqual(cutChoices(10), [4, 5, 6, 7, 8]);
  assert.deepEqual(cutChoices(6), [4, 5, 6]);
  assert.deepEqual(cutChoices(3), [4]);
  const five = field([[['a', 'b', 'c', 'd', 'e']]]);
  assert.deepEqual(cutAt(prelimStandings(five.entries, five.sections, five.results), 6), { cut: 6, advancing: 5, tiedAtCut: 0, everyone: true, decidedBy: '', overRoom: false });
});
test('cutFor: contest, then tournament default, then six', () => {
  assert.equal(cutFor({}, 'info'), 6);
  assert.equal(cutFor({ finalists: 7 }, 'info'), 7);
  assert.equal(cutFor({ finalists: 7, finalistsByContest: { info: 4 } }, 'info'), 4);
  assert.equal(cutFor({ finalists: 7, finalistsByContest: { info: 4 } }, 'info:novice'), 7);
});

// 2. One round, rooms of 1, 4 and 5. The same rank in a bigger room means weaker opponents (a higher average rank).
//    Order: w1, y1, x1, y2, x2, y3 | x3 ... y3 and x3 both have cumulative 3.
const f2 = field([[['w1'], ['y1', 'y2', 'y3', 'y4'], ['x1', 'x2', 'x3', 'x4', 'x5']]]);
test('tie at the cut broken by opponents’ average rank', () => {
  const s = prelimStandings(f2.entries, f2.sections, f2.results);
  assert.equal(order(s), 'w1 y1 x1 y2 x2 y3 x3 y4 x4 x5');
  assert.equal(s[5].cumulativeRank, s[6].cumulativeRank);
  assert.ok(Math.abs(s[5].opponentsAverageRank - 7 / 3) < 1e-9 && Math.abs(s[6].opponentsAverageRank - 3) < 1e-9);
  assert.deepEqual(cutAt(s, 6), { cut: 6, advancing: 6, tiedAtCut: 0, everyone: false, decidedBy: 'Opponents’ average rank', overRoom: false });
  assert.equal(s[5].decidedBy, 'Opponents’ average rank');
  assert.equal(order(nextIn(s)), 'x3 y4');
  // At 7 the line falls between x3 (cumulative 3) and y4 (4): a clean cut.
  assert.equal(cutAt(s, 7).decidedBy, 'Cumulative rank');
});

// 3. Two identical rooms that never meet, plus w1 alone on top: every pair is tied on everything.
const f3 = field([[['w1'], ['x1', 'x2', 'x3', 'x4'], ['y1', 'y2', 'y3', 'y4']]]);
test('unbreakable tie at the cut expands the final', () => {
  const s = prelimStandings(f3.entries, f3.sections, f3.results);
  assert.deepEqual(s.map(x => x.place), [1, 2, 2, 4, 4, 6, 6, 8, 8]);
  assert.equal(s.filter(x => x.advances).length, 7);
  assert.deepEqual(cutAt(s, 6), { cut: 6, advancing: 7, tiedAtCut: 2, everyone: false, decidedBy: 'Still tied', overRoom: false });
  assert.equal(s[5].decidedBy, 'Still tied');
  // At 4 the line falls inside the x2/y2 tie: 5 advance; the next two in are themselves tied.
  const four = prelimStandings(f3.entries, f3.sections, f3.results, 4);
  assert.deepEqual(cutAt(four, 4), { cut: 4, advancing: 5, tiedAtCut: 2, everyone: false, decidedBy: 'Still tied', overRoom: false });
  const alternates = nextIn(four);
  assert.equal(alternates.length, 2); assert.equal(alternates[0].place, alternates[1].place);
  // At 8 the tie at 8th takes 9: more than one room holds.
  const eight = prelimStandings(f3.entries, f3.sections, f3.results, 8);
  assert.deepEqual(cutAt(eight, 8), { cut: 8, advancing: 9, tiedAtCut: 2, everyone: false, decidedBy: 'Still tied', overRoom: true });
});

// 4. Head-to-head settles an exact two-way tie left after opponents' average rank.
test('head-to-head is named when it settles the last spot', () => {
  // p and q meet once (p ahead) and otherwise face equally strong rooms, so only head-to-head can split them.
  const f = field([[['p', 'q'], ['e', 'g'], ['h', 'f']], [['a', 'b', 'q'], ['c', 'd', 'p']], [['q', 'e'], ['f', 'p']]]);
  const s = prelimStandings(f.entries, f.sections, f.results);
  const ip = s.findIndex(x => x.entryId === 'p'), iq = s.findIndex(x => x.entryId === 'q');
  assert.equal(s[ip].cumulativeRank, s[iq].cumulativeRank);
  assert.equal(iq, ip + 1);
  assert.equal(s[ip].aheadOfNextBy, 'Head-to-head');
  assert.equal(cutAt(s, ip + 1).decidedBy, 'Head-to-head');
});
console.log(`\n${passed} tests passed`);
