// Unit tests for reading pasted or uploaded rosters and judge lists: run with `npm run test:import`.
import assert from 'node:assert/strict';
import { findEvent, readRoster, readJudges, splitRows } from '../.test-out/import/rosterImport.js';
let passed = 0; const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };

test('event names and codes from other sites', () => {
  const cases = { 'Informative Speaking (INF)': 'info', 'INF': 'info', 'Extemp': 'extemp', 'ES': 'extemp', 'Oral Interp of Drama': 'oid', 'Duo Interp': 'duo', 'Duet Acting': 'duet',
    'Serious Prose': 'serious', 'Humorous Prose': 'humorous', 'HI': 'humorous', 'Poetry Interp': 'poetry', 'Entertainment Speaking (ENT)': 'entertainment', 'Persuasive': 'persuasive', 'Novice Poetry': 'poetry', 'Program Oral Interpretation': 'poi' };
  for (const [text, id] of Object.entries(cases)) assert.equal(findEvent(text), id, text);
  assert.equal(findEvent('Lincoln-Douglas'), null);
});
test('pasted spreadsheet rows (tabs) with a header', () => {
  const { rows, error } = readRoster('Student\tEvents\tDivision\nMaya Rodriguez\tInformative, Poetry\tVarsity\nIris Chen\tHumorous Prose\tNovice\n');
  assert.equal(error, '');
  assert.deepEqual(rows.map(r => [r.student, r.eventId, r.division]), [['Maya Rodriguez', 'info', 'varsity'], ['Maya Rodriguez', 'poetry', 'varsity'], ['Iris Chen', 'humorous', 'novice']]);
});
test('CSV with first and last name columns and quoted events', () => {
  const { rows } = readRoster('First Name,Last Name,Event\nEli,Thompson,"Extemp; Informative"\n');
  assert.deepEqual(rows.map(r => [r.student, r.eventId]), [['Eli Thompson', 'extemp'], ['Eli Thompson', 'info']]);
});
test('novice written into the event when there is no division column', () => {
  const { rows } = readRoster('name\tevent\nSam Wilson\tNovice Poetry\n');
  assert.deepEqual(rows.map(r => [r.eventId, r.division]), [['poetry', 'novice']]);
});
test('no header: first column student, second events', () => {
  const { rows } = readRoster('Nora Patel\tPersuasive\n');
  assert.deepEqual(rows.map(r => [r.student, r.eventId]), [['Nora Patel', 'persuasive']]);
});
test('unknown events and missing names are flagged, not dropped', () => {
  const { rows } = readRoster('student,event\nAna Able,Debate\n,Poetry\n');
  assert.equal(rows[0].eventId, null); assert.equal(rows[1].problem, 'No student name');
});
test('empty paste explains itself', () => assert.match(readRoster('  \n ').error, /empty/));
test('judges with a header', () => {
  const { rows } = readJudges('Name\tEmail\tPhone\nPat Rivera\tpat@example.org\t402-555-0134\nLee Ortiz\t\t\n');
  assert.deepEqual(rows.map(r => [r.name, r.email, r.phone, r.problem]), [['Pat Rivera', 'pat@example.org', '402-555-0134', ''], ['Lee Ortiz', '', '', '']]);
});
test('judges without a header find email and phone by what they hold', () => {
  const { rows } = readJudges('Pat Rivera\t402-555-0134\tpat@example.org\n');
  assert.deepEqual([rows[0].email, rows[0].phone], ['pat@example.org', '402-555-0134']);
});
test('a bad email is flagged', () => assert.match(readJudges('name,email\nPat,not-an-email\n').rows[0].problem, /isn’t an email/));
test('tabs win over commas when pasted', () => assert.deepEqual(splitRows('a, b\tc\n'), [['a, b', 'c']]));
test('a blank division cell still reads novice from the event', () => assert.equal(readRoster('student\tevent\tdivision\nNew Novice\tNovice Poetry\t\n').rows[0].division, 'novice'));
console.log(`${passed} passed`);
