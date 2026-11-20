import { useState } from 'react';
import { Avatar, Badge, Button, Icon } from './ui';
import { useStore } from './store';
import { ballotEvents } from './ballots';
import { divisionLabel, divisionOf, entryLoad, isFinal, loadLabel, roundTimes, sameSchool, stageOf, type Division, overCap } from './tournament';

const eventName = (id: string) => ballotEvents.find(event => event.id === id)?.name ?? id;
const initials = (name: string) => name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();

/** A coach enters their students into the tournament, then sees where each one speaks once the schedule is out. */
export function TeamEntries({ school, onBack }: { school: string; onBack?: () => void }) {
  const { tournament, entries, addEntry, removeEntry, submittedSchools, submitSchool, sections, judges: judgePool, entriesOpen } = useStore();
  const [division, setDivision] = useState<Division>('varsity');
  const [student, setStudent] = useState('');
  const [eventId, setEventId] = useState(tournament.eventIds[0] ?? 'info');
  const mine = entries.filter(entry => sameSchool(entry.school, school));
  const open = entriesOpen;
  const submitted = submittedSchools.some(name => sameSchool(name, school));
  const published = tournament.status !== 'registration' && sections.length > 0;
  const duplicate = mine.some(entry => entry.eventId === eventId && entry.student.trim().toLowerCase() === student.trim().toLowerCase());
  const already = entryLoad(entries, student, school);
  const atCap = student.trim() !== '' && already >= tournament.maxEntries;
  const add = () => { if (!student.trim() || duplicate || atCap) return; addEntry(student.trim(), school, eventId, known ? divisionOf(known) : division); setStudent(''); };
  // A student already on the list keeps the division they were entered in.
  const known = mine.find(entry => entry.student.trim().toLowerCase() === student.trim().toLowerCase());
  const students = new Set(mine.map(entry => entry.student.toLowerCase())).size;

  return <section className="panel action-workspace team-entries">
    <div className="panel-head"><div><h2>{school} entries</h2><p>{tournament.name} · {tournament.date}</p></div>
      <span className="panel-head-actions"><Badge tone={open ? 'info' : 'success'} icon={open ? 'clock' : 'check'}>{open ? 'Entries open' : published ? 'Schedule published' : 'Entries closed'}</Badge>{onBack && <Button variant="secondary" icon="arrow" onClick={onBack}>Back to overview</Button>}</span></div>

    {open ? <form className="entry-add" onSubmit={event => { event.preventDefault(); add(); }}>
      <label><span>Student</span><input value={student} onChange={event => setStudent(event.target.value)} placeholder="Full name"/></label>
      <label><span>Division</span><select value={known ? divisionOf(known) : division} disabled={!!known} onChange={event => setDivision(event.target.value as Division)}><option value="varsity">Varsity</option><option value="novice">Novice</option></select></label>
      <label><span>Event</span><select value={eventId} onChange={event => setEventId(event.target.value)}>{tournament.eventIds.map(id => <option key={id} value={id}>{eventName(id)}</option>)}</select></label>
      <button className="button button-primary" type="submit" disabled={!student.trim() || duplicate || atCap}><Icon name="plus"/><span>Add entry</span></button>
      {student.trim() && !duplicate && !atCap && overCap(tournament, entries, school, eventId, known ? divisionOf(known) : division) && <p className="entry-hint">Your school or this event is at the tournament’s entry limit, so this entry goes on the waitlist. The director admits waitlisted entries as spots open.</p>}
      {duplicate ? <p role="alert">{student.trim()} is already entered in {eventName(eventId)}. A student can enter each event once.</p> : atCap ? <p role="alert">{student.trim()} is already in {already} events, the most this tournament allows.</p> : already > 0 && <p className="entry-hint">{student.trim()} is in {already} {already === 1 ? 'event' : 'events'} so far. Adding this makes {already + 1} of {tournament.maxEntries} allowed.</p>}
    </form> : <div className="entry-closed"><Icon name="lock"/><span><strong>Entries are closed.</strong> {published ? 'The director has published the schedule below.' : 'The director has closed entries for now. They may reopen them.'} Report an issue if something needs to change.</span></div>}

    {mine.length === 0 ? <p className="entry-empty">No students entered yet. Add your first entry above.</p> : <div className="entry-rows">
      <div className="entry-row entry-row-head"><span/><span>Student</span><span>Event · division</span><span>{published ? 'Where they speak' : ''}</span><span/></div>
      {mine.map(entry => {
        // A final has one section per judge; show it once.
        const rounds = sections.filter(section => section.entryIds.includes(entry.id)).sort((a, b) => a.round - b.round).filter((section, index, list) => list.findIndex(other => other.round === section.round) === index);
        return <div className="entry-row" key={entry.id}>
          <Avatar initials={initials(entry.student)} size="sm"/>
          <strong>{entry.student}{entry.waitlisted && <Badge tone="warning" icon="clock">Waitlisted</Badge>}{loadLabel(entryLoad(entries, entry.student, school)) && <Badge tone="info">{loadLabel(entryLoad(entries, entry.student, school))}</Badge>}</strong>
          <span>{eventName(entry.eventId)}{divisionOf(entry) === 'novice' ? <em className="division-tag">{divisionLabel.novice}</em> : <small className="division-plain"> · {divisionLabel.varsity}</small>}</span>
          <span className="entry-rounds">{published ? rounds.map(section => <small key={section.id}><b>{isFinal(section, tournament) ? (stageOf(section, tournament) === 'semi' ? 'Semi' : 'Final') : `R${section.round}`}</b> {roundTimes[section.round - 1]} · {section.room} · speaks {section.entryIds.indexOf(entry.id) + 1} of {section.entryIds.length}{isFinal(section, tournament) ? '' : section.judgeId ? ` · ${section.judgeName || judgePool.find(judge => judge.id === section.judgeId)?.name || 'Judge assigned'}` : ''}</small>) : null}</span>
          {open ? <button className="icon-button" aria-label={`Remove ${entry.student} from ${eventName(entry.eventId)}`} onClick={() => removeEntry(entry.id)}><Icon name="close" size={16}/></button> : <span/>}
        </div>;
      })}
    </div>}

    <div className="entry-footer">
      <span><strong>{students}</strong> {students === 1 ? 'student' : 'students'} · <strong>{mine.length}</strong> {mine.length === 1 ? 'entry' : 'entries'} across <strong>{new Set(mine.map(entry => entry.eventId)).size}</strong> {new Set(mine.map(entry => entry.eventId)).size === 1 ? 'event' : 'events'}</span>
      {open && (submitted ? <Badge tone="success" icon="check">Sent to the director · you can still edit until entries close</Badge> : <Button icon="send" disabled={mine.length === 0} onClick={() => submitSchool(school)}>Send entries to the director</Button>)}
    </div>
  </section>;
}
