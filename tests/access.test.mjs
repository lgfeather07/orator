// Unit tests for accessible-room assignment: run with `npm run test:access`
// (compiles src/tournament.ts, src/results.ts and src/semis.ts into .test-out/access first).
import assert from 'node:assert/strict';
import { buildSchedule, buildFinal, placeRooms, finalRoom, isAccessibleRoom } from '../.test-out/access/tournament.js';
import { buildSemis } from '../.test-out/access/semis.js';
let passed = 0; const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };

const rooms = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10'];
const base = { name: 'T', date: '', host: '', rounds: 3, sectionSize: 6, maxEntries: 4, eventIds: ['info', 'persuasive', 'extemp'], status: 'registration', rooms };
const schools = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
// 21 speakers in each of three events: four rooms per event, twelve per round.
const entries = ['info', 'persuasive', 'extemp'].flatMap(eventId => Array.from({ length: 21 }, (_, i) => ({ id: `${eventId}-${i}`, student: `S${i}`, school: schools[i % 7], eventId, division: 'varsity' })));
const judges = Array.from({ length: 16 }, (_, i) => ({ id: `j${i}`, name: `J${i}`, school: '' }));
const flag = (list, student, school) => list.map(e => e.student === student && e.school === school ? { ...e, access: true, accessNote: 'wheelchair' } : e);

test('with no requests or accessible rooms the schedule is unchanged (rooms in order each round)', () => {
  const plain = buildSchedule({ ...base, rooms: rooms.concat(['R11', 'R12']) }, entries, judges);
  for (let round = 1; round <= 3; round++) assert.deepEqual(plain.filter(s => s.round === round).map(s => s.room), ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11', 'R12']);
  const marked = buildSchedule({ ...base, accessibleRooms: ['R9'] }, entries, judges);
  assert.deepEqual(marked.map(s => s.room), buildSchedule(base, entries, judges).map(s => s.room), 'marking rooms changes nothing without a request');
});
test('overflow rooms are still "Room needed N" in order', () => {
  const r1 = buildSchedule(base, entries, judges).filter(s => s.round === 1).map(s => s.room);
  assert.deepEqual(r1.slice(10), ['Room needed 1', 'Room needed 2']);
});
test('every room with a student who needs one is in an accessible room, every round', () => {
  const field = flag(entries, 'S3', 'D');
  const t = { ...base, rooms: rooms.concat(['R11', 'R12']), accessibleRooms: ['R7', 'R11', 'R12'] };
  const sections = buildSchedule(t, field, judges);
  const needy = sections.filter(s => s.entryIds.some(id => field.find(e => e.id === id).access));
  assert.equal(needy.length, 9, 'three events × three rounds');
  needy.forEach(s => assert.ok(isAccessibleRoom(t, s.room), `${s.id} in ${s.room}`));
  for (let round = 1; round <= 3; round++) { const used = sections.filter(s => s.round === round).map(s => s.room); assert.equal(new Set(used).size, used.length, 'no room used twice in a round'); }
});
test('two students needing rooms in the same round both get one', () => {
  const field = flag(flag(entries, 'S3', 'D'), 'S10', 'D');
  const t = { ...base, rooms: rooms.concat(['R11', 'R12']), accessibleRooms: ['R2', 'R5', 'R7', 'R8', 'R11', 'R12'] };
  const sections = buildSchedule(t, field, judges);
  sections.filter(s => s.entryIds.some(id => field.find(e => e.id === id).access)).forEach(s => assert.ok(isAccessibleRoom(t, s.room)));
});
test('not enough accessible rooms: still builds, the rest get ordinary rooms', () => {
  const field = flag(entries, 'S3', 'D');
  const t = { ...base, rooms: rooms.concat(['R11', 'R12']), accessibleRooms: ['R12'] };
  const sections = buildSchedule(t, field, judges);
  assert.equal(sections.length, 36);
  for (let round = 1; round <= 3; round++) {
    const needy = sections.filter(s => s.round === round && s.entryIds.some(id => field.find(e => e.id === id).access));
    assert.equal(needy.filter(s => s.room === 'R12').length, 1); assert.equal(needy.filter(s => s.room !== 'R12').length, 2);
  }
});
test('placeRooms gives accessible rooms to needy sections first, the rest in order', () => {
  const list = ['a', 'b', 'c', 'd'].map(id => ({ id, room: '' }));
  placeRooms(list, ['R1', 'R2', 'R3', 'R4'], ['R1', 'R4'], s => s.id === 'd');
  assert.equal(list.find(s => s.id === 'd').room, 'R1'); assert.deepEqual(list.filter(s => s.id !== 'd').map(s => s.room), ['R2', 'R3', 'R4']);
});
test('finalRoom: needy takes a free accessible room, others keep clear of them, nothing marked = usual', () => {
  const t = { accessibleRooms: ['R3', 'R5'] };
  assert.equal(finalRoom({}, rooms, 'R1', [], true), 'R1');
  assert.equal(finalRoom(t, rooms, 'R1', [], true), 'R3');
  assert.equal(finalRoom(t, rooms, 'R1', ['R3'], true), 'R5');
  assert.equal(finalRoom(t, rooms, 'R3', [], false), 'R4');
  assert.equal(finalRoom(t, rooms, 'R1', ['R3', 'R5'], true), 'R1', 'none free: an ordinary room');
});
test('buildFinal puts a final with a student who needs one in an accessible room', () => {
  const field = flag(entries, 'S3', 'D');
  const t = { ...base, accessibleRooms: ['R6'] };
  const finalists = ['info-0', 'info-1', 'info-2', 'info-4', 'info-5', 'info-6'];
  assert.equal(buildFinal(t, 'info', finalists, field, judges, [])[0].room, 'R1');
  const withMaya = buildFinal(t, 'info', [...finalists.slice(0, 5), 'info-3'], field, judges, []);
  assert.ok(withMaya.every(s => s.room === 'R6'));
  // A second final in the same round can't take R6 if it is in use, and a non-needy final avoids R6.
  const other = buildFinal(t, 'persuasive', ['persuasive-0', 'persuasive-1'], field, judges, withMaya);
  assert.notEqual(other[0].room, 'R6');
});
test('buildSemis puts the semifinal room holding the student in an accessible room', () => {
  const field = flag(entries, 'S3', 'D');
  const t = { ...base, accessibleRooms: ['R2'] };
  const prelim = Array.from({ length: 12 }, (_, i) => ({ entryId: `info-${i}`, student: `S${i}`, school: schools[i % 7], place: i + 1, advances: true, ranks: [], cumulativeRank: i, opponentsAverageRank: 0, reciprocals: 0, ratingPoints: 0, decidedBy: '' }));
  const semis = buildSemis(t, 'info', prelim, field, judges, [], {}, { size: 12, judges: 1, advance: 3 });
  const holding = semis.find(s => s.entryIds.includes('info-3'));
  assert.equal(holding.room, 'R2');
  assert.ok(semis.filter(s => s !== holding).every(s => s.room !== 'R2'));
});
console.log(`${passed} tests passed`);
