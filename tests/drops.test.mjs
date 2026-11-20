// Unit tests for drop deadlines, drop fees, waivers and frozen entry fees: run with `npm run test:drops`.
import assert from 'node:assert/strict';
import { invoiceFor, dropFor, dropCost, dropDeadlinePassed, noPayment, defaultTournament } from '../.test-out/tournament.js';
let passed = 0; const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };

const fees = { entry: 7, school: 0, judge: 75, entriesPerJudge: 6 };
const base = { ...defaultTournament, fees, dropDeadline: '2026-11-14T23:59:00.000Z', dropEntryFee: 20, dropJudgeFee: 60 };
const before = new Date('2026-11-14T12:00:00Z'), after = new Date('2026-11-16T12:00:00Z');
const entries = n => Array.from({ length: n }, (_, i) => ({ id: 'e' + i, student: 'S' + i, school: 'Ashgrove', eventId: 'info' }));
const drop = (over = {}) => ({ id: 'd' + Math.random(), school: 'Ashgrove', kind: 'entry', name: 'X', eventId: 'info', division: 'varsity', droppedAt: after.toISOString(), droppedBy: 'Coach', fee: 20, entryFee: 0, waived: false, waiveReason: '', ...over });

test('invoiceFor without drops is unchanged (backward compatible)', () => {
  const old = invoiceFor(base, entries(7), 'Ashgrove', noPayment);
  assert.equal(old.total, 7 * 7 + 2 * 75);
  assert.deepEqual([old.entryDrops, old.entryDropTotal, old.judgeDrops, old.judgeDropTotal, old.frozenEntries, old.frozenTotal, old.waivedDrops], [0, 0, 0, 0, 0, 0, 0]);
  assert.equal(invoiceFor(base, entries(7), 'Ashgrove').total, old.total);
});
test('no deadline: nothing is ever recorded or charged', () => {
  const t = { ...base, dropDeadline: undefined };
  assert.equal(dropDeadlinePassed(t, after), false);
  assert.equal(dropFor(t, { kind: 'entry', school: 'Ashgrove', name: 'A', eventId: 'info' }, 'Coach', after), null);
  assert.equal(dropCost(t, 'entry', after).total, 0);
});
test('before the deadline nothing is recorded; after it the drop carries the fee', () => {
  assert.equal(dropFor(base, { kind: 'entry', school: 'Ashgrove', name: 'A', eventId: 'info' }, 'Coach', before), null);
  const d = dropFor(base, { kind: 'entry', school: 'Ashgrove', name: 'A', eventId: 'info', division: 'novice' }, 'Coach', after);
  assert.equal(d.fee, 20); assert.equal(d.entryFee, 0); assert.equal(d.division, 'novice'); assert.equal(d.waived, false);
  const j = dropFor(base, { kind: 'judge', school: 'Ashgrove', name: 'J' }, 'Coach', after);
  assert.equal(j.fee, 60); assert.equal(j.eventId, null); assert.equal(j.division, null);
});
test('waitlisted entries never cost a drop fee', () => {
  assert.equal(dropFor(base, { kind: 'entry', school: 'Ashgrove', name: 'A', eventId: 'info', waitlisted: true }, 'Coach', after), null);
  assert.equal(dropCost(base, 'entry', after, true).total, 0);
});
test('freeze: a dropped entry keeps its entry fee, judges do not', () => {
  const t = { ...base, freezeEntryFees: true, fees: { ...fees, entry: 7.5 } };
  assert.deepEqual(dropCost(t, 'entry', after), { fee: 20, entryFee: 7.5, total: 27.5 });
  assert.deepEqual(dropCost(t, 'judge', after), { fee: 60, entryFee: 0, total: 60 });
});
test('invoice adds drop lines, judge drops and frozen entry fees', () => {
  const drops = [drop(), drop({ fee: 20, entryFee: 7 }), drop({ kind: 'judge', eventId: null, division: null, fee: 60 }), drop({ school: 'Brightwater', fee: 99 })];
  const inv = invoiceFor(base, entries(5), 'ashgrove ', noPayment, drops);
  assert.equal(inv.entryDrops, 2); assert.equal(inv.entryDropTotal, 40);
  assert.equal(inv.judgeDrops, 1); assert.equal(inv.judgeDropTotal, 60);
  assert.equal(inv.frozenEntries, 1); assert.equal(inv.frozenTotal, 7);
  assert.equal(inv.total, 5 * 7 + 75 + 40 + 60 + 7);
});
test('waived drops are excluded but counted', () => {
  const drops = [drop(), drop({ waived: true, waiveReason: 'ill', entryFee: 7 }), drop({ kind: 'judge', fee: 60, waived: true })];
  const inv = invoiceFor(base, entries(1), 'Ashgrove', noPayment, drops);
  assert.equal(inv.entryDrops, 1); assert.equal(inv.judgeDrops, 0); assert.equal(inv.frozenTotal, 0);
  assert.equal(inv.waivedDrops, 2); assert.equal(inv.total, 7 + 75 + 20);
});
test('a school that dropped everything owes only its drops (no school fee); balance uses payments', () => {
  const t = { ...base, fees: { ...fees, school: 25 } };
  const inv = invoiceFor(t, [], 'Ashgrove', { ...noPayment, paid: 10 }, [drop({ fee: 20.5, entryFee: 7.25 })]);
  assert.equal(inv.entries, 0); assert.equal(inv.schoolFee, 0); assert.equal(inv.judgeTotal, 0);
  assert.equal(inv.total, 27.75); assert.equal(inv.balance, 17.75);
});
test('cents add up without float noise', () => {
  const drops = Array.from({ length: 3 }, () => drop({ fee: 0.1, entryFee: 0.2 }));
  const inv = invoiceFor(base, [], 'Ashgrove', noPayment, drops);
  assert.equal(inv.entryDropTotal, 0.3); assert.equal(inv.frozenTotal, 0.6); assert.equal(inv.total, 0.9);
});
test('a bad deadline counts as none', () => {
  assert.equal(dropDeadlinePassed({ ...base, dropDeadline: 'soon' }, after), false);
});
console.log(`${passed} drops tests passed`);
