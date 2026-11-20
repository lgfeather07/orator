import { useState } from 'react';
import { Badge, Button, Icon, downloadText } from './ui';
import { useStore } from './store';
import { ballotEvents, eventCodes } from './ballots';
import { useAccessDraft } from './Accessibility';
import { accessFromCell } from './accessibility';
import { divisionOf, entryLoad, loadLabel, sameSchool, type Division } from './tournament';

const eventName = (id: string) => ballotEvents.find(event => event.id === id)?.name ?? id;
const normal = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Match what a coach typed ("Extemp", "INF", "oral interp of drama") to an NSAA event id. */
function findEvent(text: string): string | null {
  const wanted = normal(text);
  if (!wanted) return null;
  const exact = ballotEvents.find(event => [event.id, event.name, event.short, eventCodes[event.id] ?? ''].some(label => normal(label) === wanted));
  if (exact) return exact.id;
  const starts = ballotEvents.filter(event => normal(event.name).startsWith(wanted) || wanted.startsWith(normal(event.name)));
  return starts.length === 1 ? starts[0].id : null;
}

/** Split one CSV line, honouring quoted cells. */
function cells(line: string): string[] {
  const out: string[] = []; let cell = ''; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) { if (char === '"' && line[i + 1] === '"') { cell += '"'; i++; } else if (char === '"') quoted = false; else cell += char; }
    else if (char === '"') quoted = true;
    else if (char === ',') { out.push(cell.trim()); cell = ''; }
    else cell += char;
  }
  out.push(cell.trim());
  return out;
}

type Row = { student: string; eventId: string | null; raw: string; problem: string; division: Division; access?: string };

/**
 * Read a roster file into one row per student-event pair and say what is wrong with each.
 * Accepts a "student" (or "name") column and an "event" (or "events") column; several events
 * may share a cell separated by ; / | or "and". Any other columns are ignored.
 */
function readCsv(text: string): { rows: Row[]; error: string } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(line => line.trim());
  if (lines.length === 0) return { rows: [], error: 'That file is empty.' };
  const header = cells(lines[0]).map(normal);
  let nameAt = header.findIndex(cell => ['student', 'studentname', 'name', 'fullname', 'competitor'].includes(cell));
  let eventAt = header.findIndex(cell => ['event', 'events', 'entry', 'entries'].includes(cell));
  const first = header.indexOf('firstname'), last = header.indexOf('lastname');
  const divisionAt = header.findIndex(cell => ['division', 'level', 'div'].includes(cell));
  // Optional: an "access" or "accessibility" column. Any value means the student needs an accessible room, and is the note.
  const accessAt = header.findIndex(cell => ["access", "accessibility"].includes(cell));
  const hasHeader = eventAt >= 0 && (nameAt >= 0 || (first >= 0 && last >= 0));
  if (!hasHeader) { if (cells(lines[0]).length < 2) return { rows: [], error: 'We couldn’t find a student column and an event column. Download the template to see the layout.' }; nameAt = 0; eventAt = 1; }
  const rows: Row[] = [];
  lines.slice(hasHeader ? 1 : 0).forEach(line => {
    const row = cells(line);
    const student = (nameAt >= 0 ? row[nameAt] : `${row[first] ?? ''} ${row[last] ?? ''}`)?.trim() ?? '';
    const events = (row[eventAt] ?? '').split(/[;|/]|\band\b/i).map(part => part.trim()).filter(Boolean);
    if (!student && events.length === 0) return;
    // "Novice", "N", or "nov" puts the student in the novice division; anything else is varsity.
    const access = accessAt >= 0 ? (row[accessAt] ?? '').trim() : '';
    const division: Division = divisionAt >= 0 && /^n(ov(ice)?)?$/i.test((row[divisionAt] ?? '').trim()) ? 'novice' : 'varsity';
    if (events.length === 0) rows.push({ student, eventId: null, raw: '', problem: 'No event given', division, access });
    events.forEach(raw => rows.push({ student, eventId: findEvent(raw), raw, problem: student ? '' : 'No student name', division, access }));
  });
  return { rows, error: rows.length ? '' : 'We found the columns but no students.' };
}

const template = 'student,event,division\nMaya Rodriguez,Informative; Persuasive; Poetry,Varsity\nEli Thompson,Extemporaneous,Varsity\nIris Chen,Poetry; Humorous,Novice\n';

/** Add a team's entries by hand, one student with all their events at a time, or from a roster file. */
export function EntryImport({ school, onDone }: { school: string; onDone: () => void }) {
  const { tournament, entries, addEntry, entriesOpen, setAccessNeed } = useStore();
  const [division, setDivision] = useState<Division>('varsity');
  const [mode, setMode] = useState<'hand' | 'csv'>('hand');
  const [student, setStudent] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [added, setAdded] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [csvError, setCsvError] = useState('');
  const open = entriesOpen;
  const mine = entries.filter(entry => sameSchool(entry.school, school));
  const has = (name: string, eventId: string) => mine.some(entry => entry.eventId === eventId && entry.student.trim().toLowerCase() === name.trim().toLowerCase());
  const already = entryLoad(entries, student, school);
  const room = Math.max(0, tournament.maxEntries - already);
  const accessDraft = useAccessDraft(school, student);
  const toggle = (id: string) => setPicked(list => list.includes(id) ? list.filter(item => item !== id) : list.length < room ? [...list, id] : list);
  const addByHand = () => {
    const name = student.trim(); if (!name || picked.length === 0) return;
    const known = mine.find(entry => entry.student.trim().toLowerCase() === name.toLowerCase());
    picked.forEach(id => addEntry(name, school, id, known ? divisionOf(known) : division));
    accessDraft.apply(name);
    setAdded(list => [`${name}: ${picked.map(eventName).join(', ')}`, ...list]); setStudent(''); setPicked([]);
  };

  // Work out, row by row, what would happen if the file were added now.
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  const checked = (rows ?? []).map(row => {
    const key = row.student.trim().toLowerCase();
    let problem = row.problem;
    if (!problem && !row.eventId) problem = `“${row.raw}” isn’t an event we recognise`;
    if (!problem && !tournament.eventIds.includes(row.eventId!)) problem = `${eventName(row.eventId!)} isn’t offered at this tournament`;
    if (!problem && (has(row.student, row.eventId!) || seen.has(`${key}|${row.eventId}`))) problem = 'Already entered in this event';
    if (!problem) {
      const total = (counts.get(key) ?? entryLoad(entries, row.student, school)) + 1;
      if (total > tournament.maxEntries) problem = `Over the limit of ${tournament.maxEntries} events per student`;
      else { counts.set(key, total); seen.add(`${key}|${row.eventId}`); }
    }
    return { ...row, problem };
  });
  const good = checked.filter(row => !row.problem);
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    const result = readCsv(await file.text());
    setFileName(file.name); setCsvError(result.error); setRows(result.error ? null : result.rows);
  };
  const addFromFile = () => { good.forEach(row => addEntry(row.student.trim(), school, row.eventId!, row.division));
    // One request per student from the optional access column (the first non-empty value is the note).
    const asked = new Map<string, Row>(); good.forEach(row => { const key = row.student.trim().toLowerCase(); if (accessFromCell(row.access).needed && !asked.has(key)) asked.set(key, row); });
    asked.forEach(row => setAccessNeed(school, row.student.trim(), true, accessFromCell(row.access).note)); setAdded(list => [`${good.length} ${good.length === 1 ? 'entry' : 'entries'} from ${fileName}`, ...list]); setRows(null); setFileName(''); };

  return <section className="panel action-workspace entry-import">
    <div className="panel-head"><div><h2>Add students</h2><p>{school} · {tournament.name} · up to {tournament.maxEntries} events per student, one entry per event</p></div><Button variant="secondary" icon="arrow" onClick={onDone}>View team entries</Button></div>
    {!open ? <div className="entry-closed"><Icon name="lock"/><span><strong>Entries are closed.</strong> The director has closed entries for now. Report an issue if something needs to change.</span></div> : <>
      <div className="import-modes"><div className="segmented"><button className={mode === 'hand' ? 'active' : ''} onClick={() => setMode('hand')}>Enter by hand</button><button className={mode === 'csv' ? 'active' : ''} onClick={() => setMode('csv')}>Upload a file</button></div></div>

      {mode === 'hand' ? <form className="hand-entry" onSubmit={event => { event.preventDefault(); addByHand(); }}>
        <label className="hand-name"><span>Student</span><input value={student} onChange={event => { setStudent(event.target.value); setPicked([]); }} placeholder="Full name" autoComplete="off"/></label>
        <div className="hand-division" role="radiogroup" aria-label="Division"><span>Division</span>{(['varsity', 'novice'] as Division[]).map(value => { const known = mine.find(entry => entry.student.trim().toLowerCase() === student.trim().toLowerCase()); const current = known ? divisionOf(known) : division; return <label key={value} className={current === value ? 'on' : ''}><input type="radio" name="division" checked={current === value} disabled={!!known} onChange={() => setDivision(value)}/>{value === 'novice' ? 'Novice' : 'Varsity'}</label>; })}</div>
        <fieldset disabled={!student.trim()}>
          <legend>Events <small>{!student.trim() ? 'Type a name first' : room === 0 ? `Already in ${already} events, the most allowed` : `Pick up to ${room}${already ? ` more (already in ${already})` : ''}`}</small></legend>
          <div className="hand-events">{tournament.eventIds.map(id => { const taken = has(student, id); const on = picked.includes(id); return <label key={id} className={`${on ? 'on' : ''} ${taken ? 'taken' : ''}`}>
            <input type="checkbox" checked={on || taken} disabled={taken || (!on && picked.length >= room)} onChange={() => toggle(id)}/><span><strong>{eventName(id)}</strong><small>{taken ? 'Already entered' : eventCodes[id]}</small></span>
          </label>; })}</div>
        </fieldset>
        {accessDraft.fields}
        <div className="hand-actions"><span>{picked.length > 0 && student.trim() ? `${student.trim()} will be ${loadLabel(already + picked.length).toLowerCase() || 'in one event'}.` : 'Add one student at a time with every event they’re in.'}</span><button className="button button-primary" type="submit" disabled={!student.trim() || picked.length === 0}><Icon name="plus"/><span>Add {picked.length > 1 ? `${picked.length} entries` : 'student'}</span></button></div>
      </form> : <div className="csv-entry">
        {rows === null ? <>
          <label className="dropzone"><input type="file" accept=".csv,text/csv" onChange={event => { readFile(event.target.files?.[0]); event.target.value = ''; }}/><Icon name="file" size={25}/><strong>Choose a CSV file</strong><small>Columns for the student, their event or events, and (optional) division: Varsity or Novice, and access: any note means the student needs an accessible room</small></label>
          {csvError && <p className="csv-error" role="alert"><Icon name="warning" size={15}/> {csvError}</p>}
          <div className="import-actions"><Badge tone="info" icon="info">Nothing is added until you review it</Badge><Button variant="secondary" icon="download" onClick={() => downloadText('orator-entries-template.csv', template)}>Download a template</Button></div>
        </> : <>
          <div className="csv-summary"><strong>{fileName}</strong><span><Badge tone="success" icon="check">{good.length} ready to add</Badge>{checked.length - good.length > 0 && <Badge tone="warning" icon="warning">{checked.length - good.length} skipped</Badge>}</span></div>
          <div className="csv-rows">{checked.map((row, index) => <div key={index} className={row.problem ? 'skip' : ''}><strong>{row.student || '—'}</strong><span>{row.eventId ? `${row.division === 'novice' ? 'Novice ' : ''}${eventName(row.eventId)}` : row.raw || '—'}</span><small>{row.problem || `Will be added${accessFromCell(row.access).needed ? ' · needs an accessible room' : ''}`}</small></div>)}</div>
          <div className="hand-actions"><Button variant="secondary" onClick={() => { setRows(null); setFileName(''); }}>Choose a different file</Button><Button icon="plus" disabled={good.length === 0} onClick={addFromFile}>Add {good.length} {good.length === 1 ? 'entry' : 'entries'}</Button></div>
        </>}
      </div>}

      <p className="form-note pad">Only add students on your own team. By adding them, you confirm you’re allowed to share their names and events with this tournament. Orator uses them only to run tournaments.</p>
      {added.length > 0 && <ul className="import-added">{added.map((line, index) => <li key={index}><Icon name="check" size={15}/> Added {line}</li>)}</ul>}
    </>}
  </section>;
}
