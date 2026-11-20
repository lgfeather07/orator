// Unit tests for semifinals: run with `npm run test:semis` (compiles src/results.ts into .test-out first).
import assert from 'node:assert/strict';
import { prelimStandings, finalPlacings, seedSemis, semifinalStandings, semifinalAdvancers, semifinalistPlacings, sampleSemis, semiSizeChoices, semisPossible, SEMI_DEFAULT, NSAA_TEAM_POINTS } from '../.test-out/results.js';
let passed = 0; const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };

/** `count` speakers in one prelim room, the same order every round, so prelim places are 1..count. `schools` overrides some schools. */
function prelims(count, schools = {}) {
  const ids = Array.from({ length: count }, (_, i) => `s${i + 1}`);
  const entries = ids.map(id => ({ id, student: id.toUpperCase(), school: schools[id] ?? `School ${id}`, eventId: 'info' }));
  const sections = [1, 2, 3].map(round => ({ id: `r${round}`, round, eventId: 'info', label: '', room: '', judgeId: null, entryIds: ids }));
  const results = sections.flatMap(section => ids.map((entryId, k) => ({ entryId, round: section.round, sectionId: section.id, rank: k + 1, rating: 50 - k })));
  return prelimStandings(entries, sections, results, 12);
}
const seeds = (standings, room) => room.map(id => standings.find(s => s.entryId === id).place);
/** Ballots for one room: each judge's order of entry ids, best first. */
const ballots = (...orders) => orders.flatMap((order, j) => order.map((entryId, k) => ({ entryId, judge: j + 1, rank: k + 1, rating: 50 - k * 2 })));

// ── Seeding ──
test('snake seeding: 1, 4, 5, 8, 9, 12 in room A; 2, 3, 6, 7, 10, 11 in room B', () => {
  const s = prelims(14);
  const [a, b] = seedSemis(s, 12);
  assert.deepEqual(seeds(s, a), [1, 4, 5, 8, 9, 12]);
  assert.deepEqual(seeds(s, b), [2, 3, 6, 7, 10, 11]);
});
test('ten semifinalists: five a room, rooms balanced on seed total', () => {
  const s = prelims(10);
  const [a, b] = seedSemis(s, 10);
  assert.equal(a.length, 5); assert.equal(b.length, 5);
  assert.deepEqual(seeds(s, a), [1, 4, 5, 8, 9]);
  const total = room => seeds(s, room).reduce((x, y) => x + y, 0);
  assert.ok(Math.abs(total(a) - total(b)) <= 1);
});
test('teammates are split by swapping speakers of the same seed tier; top seed stays put', () => {
  // Seeds 1 and 4 are teammates: the snake puts both in room A. Swapping the 3/4 tier fixes it.
  const s = prelims(12, { s1: 'Ashgrove', s4: 'Ashgrove' });
  const [a, b] = seedSemis(s, 12);
  assert.ok(a.includes('s1') && b.includes('s4'));
  assert.ok(a.includes('s3'));
  assert.equal(a.length, 6); assert.equal(b.length, 6);
  // Three teammates can't all be apart in two rooms, but no room gets all three.
  const t = prelims(12, { s1: 'Kestrel', s4: 'Kestrel', s5: 'Kestrel' });
  const rooms = seedSemis(t, 12);
  assert.ok(rooms.every(room => room.filter(id => ['s1', 's4', 's5'].includes(id)).length < 3));
  assert.ok(rooms[0].includes('s1'));
});
test('a tie at the semifinal line takes everyone tied', () => {
  const s = prelims(14).map(x => x.place === 13 ? { ...x, place: 12 } : x); // 12th and 13th tied
  const rooms = seedSemis(s, 12);
  assert.equal(rooms.flat().length, 13);
});
test('semifinal sizes: 10 to 16, never more than the field', () => {
  assert.equal(semisPossible(9), false); assert.equal(semisPossible(10), true);
  assert.deepEqual(semiSizeChoices(12), [10, 11, 12]);
  assert.deepEqual(semiSizeChoices(40), [10, 11, 12, 13, 14, 15, 16]);
  assert.deepEqual(SEMI_DEFAULT, { size: 12, judges: 1, advance: 3 });
});

// ── Advancement ──
test('one judge: the top three in the room advance', () => {
  const s = prelims(12);
  const room = ['s1', 's4', 's5', 's8', 's9', 's12'];
  const st = semifinalStandings(s, room, ballots(['s5', 's1', 's12', 's4', 's9', 's8']), 3);
  assert.deepEqual(st.map(x => x.entryId), ['s5', 's1', 's12', 's4', 's9', 's8']);
  assert.deepEqual(st.filter(x => x.advances).map(x => x.entryId), ['s5', 's1', 's12']);
  assert.deepEqual(st.map(x => x.seed), [5, 1, 12, 4, 9, 8]);
});
test('three judges: cumulative rank, then reciprocals, then rating points, then prelim place', () => {
  const s = prelims(12);
  const room = ['a', 'b', 'c', 'd'].map((_, i) => `s${i + 1}`); // s1..s4
  // Cumulative: s1 = 1+4+1 = 6, s2 = 2+2+2 = 6, s3 = 3+1+3 = 7, s4 = 4+3+4 = 11.
  // s1 and s2 tie on 6: reciprocals 1 + .25 + 1 = 2.25 beat 1.5, so s1 is ahead.
  const st = semifinalStandings(s, room, ballots(['s1', 's2', 's3', 's4'], ['s3', 's2', 's4', 's1'], ['s1', 's2', 's3', 's4']), 2);
  assert.deepEqual(st.map(x => x.entryId), ['s1', 's2', 's3', 's4']);
  assert.equal(st[0].cumulativeRank, 6); assert.equal(st[1].cumulativeRank, 6);
  assert.equal(st[0].decidedBy, 'Reciprocals');
  assert.deepEqual(st.filter(x => x.advances).map(x => x.entryId), ['s1', 's2']);
});
test('tie on rank and reciprocals broken by rating points, then by prelim place', () => {
  const s = prelims(12);
  // Two judges: s7 is 1st then 2nd, s3 is 2nd then 1st: same cumulative and reciprocals.
  const rows = [
    { entryId: 's7', judge: 1, rank: 1, rating: 48 }, { entryId: 's3', judge: 1, rank: 2, rating: 45 },
    { entryId: 's7', judge: 2, rank: 2, rating: 46 }, { entryId: 's3', judge: 2, rank: 1, rating: 47 },
  ];
  const byRating = semifinalStandings(s, ['s3', 's7'], rows, 1);
  assert.deepEqual(byRating.map(x => x.entryId), ['s7', 's3']); // 94 rating points beat 92
  assert.equal(byRating[0].decidedBy, 'Rating points');
  const even = rows.map(r => ({ ...r, rating: 45 }));
  const byPrelim = semifinalStandings(s, ['s7', 's3'], even, 1);
  assert.deepEqual(byPrelim.map(x => x.entryId), ['s3', 's7']); // 3rd after prelims beats 7th
  assert.equal(byPrelim[0].decidedBy, 'Preliminary place');
});
test('an unbroken tie at the line advances together', () => {
  // Prelim places are tied too, so nothing can split them.
  const s = prelims(12).map(x => x.entryId === 's6' ? { ...x, place: 5 } : x);
  const rows = [
    { entryId: 's1', judge: 1, rank: 1, rating: 50 }, { entryId: 's5', judge: 1, rank: 2, rating: 45 }, { entryId: 's6', judge: 1, rank: 3, rating: 45 },
    { entryId: 's1', judge: 2, rank: 1, rating: 50 }, { entryId: 's6', judge: 2, rank: 2, rating: 45 }, { entryId: 's5', judge: 2, rank: 3, rating: 45 },
  ];
  const st = semifinalStandings(s, ['s1', 's5', 's6'], rows, 2);
  assert.deepEqual(st.map(x => x.place), [1, 2, 2]);
  assert.equal(st.filter(x => x.advances).length, 3);
  assert.equal(st[1].decidedBy, 'Still tied');
});
test('no ballots yet: nobody is ranked or advances', () => {
  const s = prelims(12);
  assert.deepEqual(semifinalStandings(s, ['s1', 's2'], [], 3), []);
});

// ── From semifinal to final placings ──
test('two rooms of six → six finalists; semifinalists place 7th to 12th by their semifinal', () => {
  const s = prelims(14);
  const [a, b] = seedSemis(s, 12);
  const roomA = semifinalStandings(s, a, ballots([...a]), 3); // seeds in order: 1, 4, 5 advance
  const roomB = semifinalStandings(s, b, ballots([...b].reverse()), 3); // upset: 11, 10, 7 advance
  const advancers = semifinalAdvancers([roomA, roomB]);
  assert.deepEqual(seeds(s, advancers), [1, 4, 5, 11, 10, 7]);
  // The final: placings as today, from the advancers' prelim records.
  const finalists = s.filter(x => advancers.includes(x.entryId));
  const finals = [1, 2].flatMap(judge => ['s11', 's1', 's5', 's4', 's10', 's7'].map((entryId, k) => ({ entryId, judge, rank: k + 1, rating: 50 - k })));
  const placings = finalPlacings(finalists, finals);
  assert.deepEqual(placings.map(p => p.entryId), ['s11', 's1', 's5', 's4', 's10', 's7']);
  assert.deepEqual(placings.map(p => p.teamPoints), NSAA_TEAM_POINTS);
  // Semifinalists: the two 4th places first, then the 5ths, then the 6ths. Each pair is level on rank,
  // reciprocals and rating points, so the better prelim place goes ahead.
  const semis = semifinalistPlacings([roomA, roomB]);
  assert.deepEqual(semis.map(p => p.place), [7, 8, 9, 10, 11, 12]);
  assert.deepEqual(seeds(s, semis.map(p => p.entryId)), [6, 8, 3, 9, 2, 12]);
  assert.ok(semis.every(p => p.decidedBy === 'Semifinalist' && p.teamPoints === 0));
});
test('semifinalists earn team points only where the scale reaches', () => {
  const s = prelims(12);
  const [a, b] = seedSemis(s, 12);
  const rooms = [semifinalStandings(s, a, ballots([...a]), 3), semifinalStandings(s, b, ballots([...b], [...b]), 3)];
  // Room B has two judges: its 4th place has cumulative 8, room A's 4th has 4, so room A's speaker is 7th alone.
  const semis = semifinalistPlacings(rooms, [20, 18, 16, 14, 12, 10, 8, 6]);
  assert.deepEqual(semis.map(p => p.place), [7, 8, 9, 10, 11, 12]);
  assert.deepEqual(semis.map(p => p.teamPoints), [8, 6, 0, 0, 0, 0]);
});
test('sample semifinal ballots rank every speaker once per judge', () => {
  const s = prelims(12);
  const [a] = seedSemis(s, 12);
  const rows = sampleSemis(s, a, 2, 'Room 309');
  assert.equal(rows.length, 12);
  [1, 2].forEach(judge => assert.deepEqual(rows.filter(r => r.judge === judge).map(r => r.rank).sort((x, y) => x - y), [1, 2, 3, 4, 5, 6]));
  assert.deepEqual(sampleSemis(s, a, 2, 'Room 309'), rows); // repeatable
});
console.log(`\n${passed} tests passed`);
