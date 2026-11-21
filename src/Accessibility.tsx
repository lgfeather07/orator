/**
 * Room-accessibility requests in the app: the coach's fields and list, the director's rooms toggle, schedule warnings and
 * summary, the student's own note, and the printable list. The rules live in accessibility.ts.
 *
 * Privacy: a note is shown only to the student's coach, the director (and the director's printouts) and the student.
 * Judges and other coaches see at most "Accessible room" on a room, never who asked or why.
 */
import { useState, type ReactNode } from 'react';
import { Badge, Button, Icon } from './ui';
import { useStore } from './store';
import { ballotEvents } from './ballots';
import { ACCESS_NOTE_MAX, accessByRound, accessibleRoomsIn, misplaced, requestOf, requestsIn, roomsOf, sectionNeedsAccess, shortageText } from './accessibility';
import { isAccessibleRoom, isFinal, roundLabel, sameSchool, type Entry, type Section, timeFor } from './tournament';
import './accessibility.css';

const eventName = (id: string) => ballotEvents.find(event => event.id === id)?.name ?? id;

/** The checkbox and note, shared by the add forms and the list. */
function AccessInputs({ id, needed, note, onNeeded, onNote, disabled = false, compact = false }: { id: string; needed: boolean; note: string; onNeeded: (value: boolean) => void; onNote: (value: string) => void; disabled?: boolean; compact?: boolean }) {
  return <div className={`access-inputs${compact ? ' compact' : ''}`}>
    <label className="access-check"><input type="checkbox" checked={needed} disabled={disabled} onChange={event => onNeeded(event.target.checked)}/><span>Needs an accessible room <small>step-free, ground floor or elevator</small></span></label>
    {needed && <label className="access-note" htmlFor={`${id}-note`}><span>Note for the director <small>optional · only you, the director and the student see it</small></span>
      <input id={`${id}-note`} value={note} maxLength={ACCESS_NOTE_MAX} disabled={disabled} onChange={event => onNote(event.target.value)} placeholder="e.g. uses a wheelchair, needs a seat near the door"/></label>}
  </div>;
}

/**
 * For an add form: the access fields, and `apply(student)` to save them once the student is added.
 * A student who already has a request keeps it; the fields show that.
 */
export function useAccessDraft(school: string, student: string) {
  const { entries, setAccessNeed } = useStore();
  const [needed, setNeeded] = useState(false);
  const [note, setNote] = useState('');
  const existing = student.trim() ? requestOf(entries, school, student) : null;
  const fields = existing
    ? <p className="access-existing"><Icon name="check" size={14}/> {student.trim()} already has an accessible-room request{existing.note ? `: “${existing.note}”` : ''}. Change it under Accessibility requests.</p>
    : <AccessInputs id={`add-${school.replace(/\W+/g, '-')}`} needed={needed} note={note} onNeeded={setNeeded} onNote={setNote}/>;
  const apply = (name: string) => { if (needed && !existing && name.trim()) setAccessNeed(school, name.trim(), true, note); setNeeded(false); setNote(''); };
  return { fields, apply };
}

/** One student's row in the coach's (or director's) list. */
function StudentAccessRow({ school, student, events, editable, showSchool }: { school: string; student: string; events: string; editable: boolean; showSchool: boolean }) {
  const { entries, setAccessNeed } = useStore();
  const request = requestOf(entries, school, student);
  const [note, setNote] = useState(request?.note ?? '');
  const [saved, setSaved] = useState(false);
  const id = `access-${school}-${student}`.replace(/\W+/g, '-').toLowerCase();
  const changed = !!request && note.trim() !== request.note;
  return <li className={request ? 'on' : ''}>
    <div className="access-who"><strong>{student}</strong><small>{showSchool ? `${school} · ` : ''}{events}</small></div>
    <AccessInputs id={id} compact needed={!!request} note={note} disabled={!editable}
      onNeeded={value => { setAccessNeed(school, student, value, value ? note : ''); if (!value) setNote(''); setSaved(false); }}
      onNote={value => { setNote(value); setSaved(false); }}/>
    {request && editable && <div className="access-save">{changed ? <Button variant="secondary" icon="check" onClick={() => { setAccessNeed(school, student, true, note); setSaved(true); }}>Save note</Button> : saved ? <span role="status"><Icon name="check" size={14}/> Saved</span> : null}</div>}
  </li>;
}

/**
 * The coach's list of their students (or, for the director, every student with a request plus a search) with
 * "Needs an accessible room" and the note. It applies to all of a student's entries.
 */
export function AccessRequestsPanel({ school, director = false }: { school?: string; director?: boolean }) {
  const { entries, entriesOpen } = useStore();
  const [query, setQuery] = useState('');
  const editable = director || entriesOpen;
  const pool = school ? entries.filter(entry => sameSchool(entry.school, school)) : entries;
  const students = [...new Map(pool.map(entry => [`${entry.school.toLowerCase()}|${entry.student.trim().toLowerCase()}`, entry])).values()]
    .map(entry => ({ school: entry.school, student: entry.student, events: pool.filter(item => sameSchool(item.school, entry.school) && item.student.trim().toLowerCase() === entry.student.trim().toLowerCase()).map(item => eventName(item.eventId)).join(', ') }))
    .sort((a, b) => a.school.localeCompare(b.school) || a.student.localeCompare(b.student));
  const requests = requestsIn(pool);
  // The director sees who asked; anyone else in the field turns up by searching.
  const shown = director ? students.filter(item => query.trim() ? `${item.student} ${item.school}`.toLowerCase().includes(query.trim().toLowerCase()) : requests.some(request => sameSchool(request.school, item.school) && request.student.toLowerCase() === item.student.toLowerCase())) : students;
  if (!director && students.length === 0) return null;
  return <section className="access-panel" aria-labelledby={`access-title-${director ? 'director' : 'coach'}`}>
    <div className="access-head">
      <div><h3 id={`access-title-${director ? 'director' : 'coach'}`}>Accessibility requests</h3>
        <p>{director ? 'Students whose coach asked for an accessible room. Their rooms get your accessible rooms first. You can change any request.' : 'Tick a student who needs an accessible room (step-free, ground floor or elevator). It applies to every event they’re in. Only you, the director and the student see the note.'}</p></div>
      <Badge tone={requests.length ? 'info' : 'neutral'} icon={requests.length ? 'check' : undefined}>{requests.length} {requests.length === 1 ? 'request' : 'requests'}</Badge>
    </div>
    {!editable && <p className="access-locked"><Icon name="lock" size={14}/> Entries are closed. Ask the director to change a request.</p>}
    {director && <label className="search-box access-search"><Icon name="search"/><input aria-label="Find a student to add a request" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a student to add or change a request"/></label>}
    {shown.length === 0 ? <p className="access-empty">{director ? (query.trim() ? `No students match “${query.trim()}”.` : 'No requests yet. Coaches add them with their entries.') : 'No students yet.'}</p>
      : <ul className="access-list">{shown.slice(0, 60).map(item => <StudentAccessRow key={`${item.school}|${item.student}`} {...item} editable={editable} showSchool={director}/>)}</ul>}
  </section>;
}

/** The director's toggle on each room in the Rooms editor. */
export function AccessibleRoomToggle({ room, editable }: { room: string; editable: boolean }) {
  const { tournament, updateTournament } = useStore();
  const on = isAccessibleRoom(tournament, room);
  if (!editable) return on ? <span className="room-access on">Accessible</span> : null;
  const list = tournament.accessibleRooms ?? [];
  return <label className={`room-access${on ? ' on' : ''}`}><input type="checkbox" checked={on} onChange={() => updateTournament({ accessibleRooms: on ? list.filter(item => item !== room) : [...list, room] })}/><span>Accessible<span className="sr-only"> ({room})</span></span></label>;
}

/** Under the rooms list: what "Accessible" means and how many there are against the busiest round's requests. */
export function AccessRoomsHint() {
  const { tournament, entries } = useStore();
  if (!(tournament.rooms ?? []).length) return null;
  const have = accessibleRoomsIn(tournament).length;
  const students = requestsIn(entries.filter(entry => !entry.waitlisted)).length;
  return <p className="rooms-access-hint"><Icon name="info" size={14}/> <span>Tick <b>Accessible</b> for rooms with step-free access (ground floor, elevator or ramp): {have} marked. {students ? `${students} ${students === 1 ? 'student has' : 'students have'} asked for an accessible room; their rooms get these first every round, finals too.` : 'Rooms with a student who asks for one get these first.'}</span></p>;
}

/** The Schedule step's summary: rounds short of accessible rooms, and rooms moved out of one. */
export function AccessScheduleSummary() {
  const { tournament, sections, entries } = useStore();
  const rounds = accessByRound(tournament, sections.filter(section => !isFinal(section, tournament)), entries);
  if (rounds.length === 0) return null;
  const short = rounds.filter(item => item.needed > item.have);
  const moved = rounds.filter(item => item.needed <= item.have && item.misplaced > 0);
  const ok = short.length === 0 && moved.length === 0;
  return <div className={`access-summary${ok ? ' ok' : ''}`} role={ok ? undefined : 'note'}>
    <Icon name={ok ? 'check' : 'warning'} size={16}/>
    <div><strong>{ok ? `Every room with an accessibility request is in an accessible room (${rounds.map(item => `${item.needed} in ${item.label}`).join(', ')}).` : 'Some rooms need an accessible room'}</strong>
      {!ok && <ul>{short.map(item => <li key={`s${item.round}`}>{shortageText(item)} Mark more rooms accessible above, then rebuild.</li>)}
        {moved.map(item => <li key={`m${item.round}`}>{item.misplaced} {item.misplaced === 1 ? 'room' : 'rooms'} in {item.label} with an accessibility request {item.misplaced === 1 ? 'isn’t' : 'aren’t'} in an accessible room. Move {item.misplaced === 1 ? 'it' : 'them'} or rebuild.</li>)}</ul>}</div>
  </div>;
}

/** On a section card: this room needs an accessible room, and whether it has one. */
export function AccessSectionFlag({ section }: { section: Section }) {
  const { tournament, entries } = useStore();
  const needs = sectionNeedsAccess(section, entries);
  return <div className="access-flag-slot" aria-live="polite">{needs && (misplaced(section, entries, tournament)
    ? <p className="section-flag access-flag"><Icon name="warning" size={14}/> Needs an accessible room. {section.room} isn’t marked accessible; pick one marked “(accessible)”.</p>
    : <p className="access-flag-ok"><Icon name="check" size={14}/> Accessible room requested · {section.room} is accessible</p>)}</div>;
}

/** The room picker's label for a room: "(accessible)" after accessible rooms. */
export const accessibleSuffix = (tournament: { accessibleRooms?: string[] }, room: string) => isAccessibleRoom(tournament, room) ? ' (accessible)' : '';

/** On the student's own page: their request and note, and whether each of their rooms is accessible. */
export function MyAccessRequest({ entries }: { entries: Entry[] }) {
  const { sections, tournament } = useStore();
  const mine = entries.find(entry => entry.access);
  if (!mine) return null;
  const published = tournament.status !== 'registration' && sections.length > 0;
  const rooms = published ? roomsOf({ school: mine.school, student: mine.student, note: '' }, entries, sections) : [];
  return <div className="my-access"><Badge tone="info" icon="check">Accessible room requested</Badge>
    <span>{mine.accessNote ? `Your coach’s note: “${mine.accessNote}”. ` : ''}Only you, your coach and the director see this.{published ? '' : ' Your rooms are chosen when the schedule is built.'}</span>
    {rooms.length > 0 && <small>{rooms.map(section => `${roundLabel(section, tournament)}: ${section.room}${isAccessibleRoom(tournament, section.room) ? ' (accessible)' : ' (not marked accessible: tell your coach)'}`).join(' · ')}</small>}
  </div>;
}

/** The "Accessibility requests" print: each student, school, note, and their rooms round by round. Director only. */
export function AccessRequestsPrint(): ReactNode {
  const { entries, sections, tournament } = useStore();
  const requests = requestsIn(entries.filter(entry => !entry.waitlisted));
  return <div className="print-page print-access">
    <header className="print-head"><strong>{tournament.name}</strong><span>Accessibility requests · confidential</span></header>
    <p className="print-meta">Students whose coach asked for an accessible room (step-free, ground floor or elevator). Keep this sheet in the tab room; notes are private to the student, their coach and the director.</p>
    {requests.length === 0 ? <p className="print-meta">No accessibility requests.</p> : requests.map(request => {
      const rooms = roomsOf(request, entries, sections);
      return <section key={`${request.school}|${request.student}`} className="print-judge">
        <h3>{request.student} <small>· {request.school}</small></h3>
        <p className="print-meta">Note: {request.note || '—'}</p>
        {rooms.length === 0 ? <p className="print-meta">Not scheduled yet.</p> : <table><thead><tr><th>Round</th><th>Event</th><th>Room</th><th>Accessible?</th></tr></thead>
          <tbody>{rooms.map(section => <tr key={section.id}><td>{roundLabel(section, tournament)}{timeFor(tournament, section.round) ? ` · ${timeFor(tournament, section.round)}` : ''}</td><td>{section.division === 'novice' ? 'Novice ' : ''}{eventName(section.eventId)}</td><td><b>{section.room}</b></td><td>{isAccessibleRoom(tournament, section.room) ? 'Yes' : <b>NO: move this room</b>}</td></tr>)}</tbody></table>}
      </section>;
    })}
  </div>;
}
