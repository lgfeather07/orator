import { useState } from 'react';
import { Avatar, Badge, Button, Icon } from './ui';
import { useStore } from './store';
import { ballotEvents } from './ballots';
import { entryLoad, judgePool, loadLabel, roundTimes, sameSchool } from './tournament';

const eventName = (id: string) => ballotEvents.find(event => event.id === id)?.name ?? id;
const initials = (name: string) => name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();

/** A coach enters their students into the tournament, then sees where each one speaks once the schedule is out. */
export function TeamEntries({ school, onBack }: { school: string; onBack?: () => void }) {
  const { tournament, entries, addEntry, removeEntry, submittedSchools, submitSchool, sections } = useStore();
  const [student, setStudent] = useState('');
  const [eventId, setEventId] = useState(tournament.eventIds[0] ?? 'info');
  const mine = entries.filter(entry => sameSchool(entry.school, school));
  const open = tournament.status === 'registration';
  const submitted = submittedSchools.some(name => sameSchool(name, school));
  const published = tournament.status !== 'registration' && sections.length > 0;
  const duplicate = mine.some(entry => entry.eventId === eventId && entry.student.trim().toLowerCase() === student.trim().toLowerCase());
  const already = entryLoad(entries, student, school);
  const atCap = student.trim() !== '' && already >= tournament.maxEntries;
  const add = () => { if (!student.trim() || duplicate || atCap) return; addEntry(student.trim(), school, eventId); setStudent(''); };
  const students = new Set(mine.map(entry => entry.student.toLowerCase())).size;

  return <section className="panel action-workspace team-entries">
    <div className="panel-head"><div><h2>{school} entries</h2><p>{tournament.name} · {tournament.date}</p></div>
      <span className="panel-head-actions"><Badge tone={open ? 'info' : 'success'} icon={open ? 'clock' : 'check'}>{open ? 'Registration open' : published ? 'Schedule published' : 'Registration closed'}</Badge>{onBack && <Button variant="secondary" icon="arrow" onClick={onBack}>Back to overview</Button>}</span></div>

    {open ? <form className="entry-add" onSubmit={event => { event.preventDefault(); add(); }}>
      <label><span>Student</span><input value={student} onChange={event => setStudent(event.target.value)} placeholder="Full name"/></label>
      <label><span>Event</span><select value={eventId} onChange={event => setEventId(event.target.value)}>{tournament.eventIds.map(id => <option key={id} value={id}>{eventName(id)}</option>)}</select></label>
      <button className="button button-primary" type="submit" disabled={!student.trim() || duplicate || atCap}><Icon name="plus"/><span>Add entry</span></button>
      {duplicate ? <p role="alert">{student.trim()} is already entered in {eventName(eventId)}. A student can enter each event once.</p> : atCap ? <p role="alert">{student.trim()} is already in {already} events, the most this tournament allows.</p> : already > 0 && <p className="entry-hint">{student.trim()} is in {already} {already === 1 ? 'event' : 'events'} so far. Adding this makes {already + 1} of {tournament.maxEntries} allowed.</p>}
    </form> : <div className="entry-closed"><Icon name="lock"/><span><strong>Entries are locked.</strong> The director has closed registration{published ? ' and published the schedule below' : ''}. Report an issue if something needs to change.</span></div>}

    {mine.length === 0 ? <p className="entry-empty">No students entered yet. Add your first entry above.</p> : <div className="entry-rows">
      <div className="entry-row entry-row-head"><span/><span>Student</span><span>Event</span><span>{published ? 'Where they speak' : ''}</span><span/></div>
      {mine.map(entry => {
        const rounds = sections.filter(section => section.entryIds.includes(entry.id)).sort((a, b) => a.round - b.round);
        return <div className="entry-row" key={entry.id}>
          <Avatar initials={initials(entry.student)} size="sm"/>
          <strong>{entry.student}{loadLabel(entryLoad(entries, entry.student, school)) && <Badge tone="info">{loadLabel(entryLoad(entries, entry.student, school))}</Badge>}</strong>
          <span>{eventName(entry.eventId)}</span>
          <span className="entry-rounds">{published ? rounds.map(section => <small key={section.id}><b>R{section.round}</b> {roundTimes[section.round - 1]} · {section.room} · speaks {section.entryIds.indexOf(entry.id) + 1} of {section.entryIds.length}{section.judgeId ? ` · ${judgePool.find(judge => judge.id === section.judgeId)?.name}` : ''}</small>) : null}</span>
          {open ? <button className="icon-button" aria-label={`Remove ${entry.student} from ${eventName(entry.eventId)}`} onClick={() => removeEntry(entry.id)}><Icon name="close" size={16}/></button> : <span/>}
        </div>;
      })}
    </div>}

    <div className="entry-footer">
      <span><strong>{students}</strong> {students === 1 ? 'student' : 'students'} · <strong>{mine.length}</strong> {mine.length === 1 ? 'entry' : 'entries'} across <strong>{new Set(mine.map(entry => entry.eventId)).size}</strong> {new Set(mine.map(entry => entry.eventId)).size === 1 ? 'event' : 'events'}</span>
      {open && (submitted ? <Badge tone="success" icon="check">Sent to the director · you can still edit until registration closes</Badge> : <Button icon="send" disabled={mine.length === 0} onClick={() => submitSchool(school)}>Send entries to the director</Button>)}
    </div>
  </section>;
}
