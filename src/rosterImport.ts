/**
 * Reading rosters that coaches bring from elsewhere: a CSV file, or rows pasted from Excel or Google Sheets
 * (which paste as tab-separated text). Event names are matched loosely, so exports from other tournament
 * software ("Informative Speaking (INF)", "Oral Interp of Drama", "Duo Interp") land on the right NSAA event.
 */
import { ballotEvents, eventCodes } from './ballots';
import type { Division } from './tournament';

const normal = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Other names and codes for each event, as other software and coaches write them. */
const ALIASES: Record<string, string[]> = {
  info: ['informative speaking', 'info', 'inf'],
  persuasive: ['persuasive speaking', 'persuasion', 'pers', 'per', 'oratory', 'original oratory', 'oo'],
  extemp: ['extemporaneous speaking', 'extemp speaking', 'extemp', 'ext', 'ex', 'es'],
  entertainment: ['entertainment speaking', 'ent'],
  oid: ['oral interpretation of drama', 'oral interp of drama', 'oral interp drama', 'drama', 'oid'],
  poi: ['program oral interpretation', 'program of oral interpretation', 'program oral interp', 'poi'],
  poetry: ['poetry interpretation', 'poetry interp', 'poe'],
  serious: ['serious prose', 'serious prose interpretation', 'serious interp', 'ser', 'sp'],
  humorous: ['humorous prose', 'humorous prose interpretation', 'humorous interpretation', 'humorous interp', 'hum', 'hp', 'hi'],
  duet: ['duet acting', 'duet', 'dut', 'da'],
  duo: ['duo interpretation', 'duo interp', 'duo'],
};

/** Match what a coach typed ("Extemp", "INF", "oral interp of drama", "Informative Speaking (INF)") to an event id. */
export function findEvent(text: string): string | null {
  const tries = [text, text.replace(/\(.*?\)/g, ' '), ...(text.match(/\(([^)]+)\)/g) ?? []).map(code => code.slice(1, -1))]
    .map(item => item.replace(/^(novice|nov|varsity|var|jv)\b/i, '').trim()).filter(Boolean);
  for (const attempt of tries) {
    const wanted = normal(attempt);
    if (!wanted) continue;
    const exact = ballotEvents.find(event => [event.id, event.name, event.short, eventCodes[event.id] ?? '', ...(ALIASES[event.id] ?? [])].some(label => normal(label) === wanted));
    if (exact) return exact.id;
  }
  const wanted = normal(tries[1] ?? text);
  if (wanted.length < 3) return null;
  const starts = ballotEvents.filter(event => normal(event.name).startsWith(wanted) || wanted.startsWith(normal(event.name)));
  return starts.length === 1 ? starts[0].id : null;
}

/** Split one line of a CSV file (honouring quotes) or of pasted, tab-separated spreadsheet rows. */
export function cells(line: string, separator: ',' | '\t' = ','): string[] {
  const out: string[] = []; let cell = ''; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) { if (char === '"' && line[i + 1] === '"') { cell += '"'; i++; } else if (char === '"') quoted = false; else cell += char; }
    else if (char === '"' && cell.trim() === '') quoted = true;
    else if (char === separator) { out.push(cell.trim()); cell = ''; }
    else cell += char;
  }
  out.push(cell.trim());
  return out;
}

/** The lines of a file or a paste, and how its cells are separated: tabs when pasted from a spreadsheet. */
export function splitRows(text: string): string[][] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(line => line.trim());
  const separator = lines.some(line => line.includes('\t')) ? '\t' : ',';
  return lines.map(line => cells(line, separator));
}

const header = (row: string[]) => row.map(normal);

export type RosterRow = { student: string; eventId: string | null; raw: string; problem: string; division: Division; access?: string };

/**
 * Read a roster into one row per student-event pair, and say what is wrong with each.
 * Takes a "student" (or "name", or "first name" and "last name") column and an "event" (or "events") column;
 * several events may share a cell, separated by ; , / | or "and". Optional "division" and "access" columns.
 * Without a header row, the first column is the student and the second the events.
 */
export function readRoster(text: string): { rows: RosterRow[]; error: string } {
  const lines = splitRows(text);
  if (lines.length === 0) return { rows: [], error: 'That’s empty. Choose a file or paste rows from a spreadsheet.' };
  const head = header(lines[0]);
  let nameAt = head.findIndex(cell => ['student', 'studentname', 'name', 'fullname', 'competitor', 'speaker', 'entrant'].includes(cell));
  let eventAt = head.findIndex(cell => ['event', 'events', 'entry', 'entries', 'eventname'].includes(cell));
  const first = head.findIndex(cell => ['firstname', 'first'].includes(cell)), last = head.findIndex(cell => ['lastname', 'last'].includes(cell));
  const divisionAt = head.findIndex(cell => ['division', 'level', 'div'].includes(cell));
  const accessAt = head.findIndex(cell => ['access', 'accessibility'].includes(cell));
  const hasHeader = eventAt >= 0 && (nameAt >= 0 || (first >= 0 && last >= 0));
  if (!hasHeader) { if (lines[0].length < 2) return { rows: [], error: 'We couldn’t find a student column and an event column. Download the template to see the layout.' }; nameAt = 0; eventAt = 1; }
  const rows: RosterRow[] = [];
  lines.slice(hasHeader ? 1 : 0).forEach(row => {
    const student = (nameAt >= 0 ? row[nameAt] ?? '' : `${row[first] ?? ''} ${row[last] ?? ''}`).replace(/\s+/g, ' ').trim();
    const eventCell = row[eventAt] ?? '';
    const events = eventCell.split(/[;|/,]|\band\b/i).map(part => part.trim()).filter(Boolean);
    if (!student && events.length === 0) return;
    const divisionText = divisionAt >= 0 ? (row[divisionAt] ?? '').trim() : '';
    // "Novice", "N" or "nov" in a division column, or an event written "Novice Poetry" with no division given, puts the student in the novice division.
    const novice = /^n(ov(ice)?)?$/i.test(divisionText) || (!divisionText && /\bnov(ice)?\b/i.test(eventCell));
    const access = accessAt >= 0 ? (row[accessAt] ?? '').trim() : '';
    const division: Division = novice ? 'novice' : 'varsity';
    if (events.length === 0) rows.push({ student, eventId: null, raw: '', problem: 'No event given', division, access });
    events.forEach(raw => rows.push({ student, eventId: findEvent(raw), raw, problem: student ? '' : 'No student name', division, access }));
  });
  return { rows, error: rows.length ? '' : 'We found the columns but no students.' };
}

export type JudgeRow = { name: string; email: string; phone: string; problem: string };

/** Read judges a coach is bringing: a "name" column (or first and last), and optional "email" and "phone" columns. */
export function readJudges(text: string): { rows: JudgeRow[]; error: string } {
  const lines = splitRows(text);
  if (lines.length === 0) return { rows: [], error: 'That’s empty. Choose a file or paste rows from a spreadsheet.' };
  const head = header(lines[0]);
  let nameAt = head.findIndex(cell => ['name', 'judge', 'judgename', 'fullname'].includes(cell));
  const first = head.findIndex(cell => ['firstname', 'first'].includes(cell)), last = head.findIndex(cell => ['lastname', 'last'].includes(cell));
  let emailAt = head.findIndex(cell => ['email', 'emailaddress', 'judgeemail'].includes(cell));
  let phoneAt = head.findIndex(cell => ['phone', 'cell', 'mobile', 'phonenumber', 'cellphone', 'text'].includes(cell));
  const hasHeader = nameAt >= 0 || (first >= 0 && last >= 0);
  if (!hasHeader) {
    nameAt = 0;
    // Without a header, find the email and phone columns by what they hold.
    emailAt = lines[0].findIndex(cell => /@/.test(cell));
    phoneAt = lines[0].findIndex((cell, index) => index !== emailAt && index > 0 && /\d{3}.*\d{4}/.test(cell));
  }
  const rows = lines.slice(hasHeader ? 1 : 0).map(row => {
    const name = (nameAt >= 0 ? row[nameAt] ?? '' : `${row[first] ?? ''} ${row[last] ?? ''}`).replace(/\s+/g, ' ').trim();
    const email = emailAt >= 0 ? (row[emailAt] ?? '').trim() : '';
    const phone = phoneAt >= 0 ? (row[phoneAt] ?? '').trim() : '';
    const problem = !name ? 'No name' : email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? `“${email}” isn’t an email address` : '';
    return { name, email, phone, problem };
  }).filter(row => row.name || row.email || row.phone);
  return { rows, error: rows.length ? '' : 'We found no judges in that.' };
}
