import { useState } from 'react';
import { Badge, Button, Icon } from './ui';
import { useStore } from './store';
import { ballotEvents } from './ballots';
import { divisionOf, entryLoad, loadLabel, roundLabel, roundTimes, sameSchool, type Section } from './tournament';
import type { Placing } from './results';
import { useEntryFormPages } from './EntryForm';
import './print.css';

const eventName = (id: string) => ballotEvents.find(event => event.id === id)?.name ?? id;
const contestName = (section: Section) => `${divisionOf(section) === 'novice' ? 'Novice ' : ''}${eventName(section.eventId)}`;
const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4) % 4]}`;

/** Opens the browser's print dialog for whatever `.print-doc` is on the page. */
export const printNow = () => window.print();

type Doc = 'postings' | 'ballots' | 'judges' | 'signs' | 'entryforms';
const docs: { id: Doc; label: string; note: string }[] = [
  { id: 'postings', label: 'Postings', note: 'Who speaks where, in order, for one round. Tape them up or hand them out.' },
  { id: 'ballots', label: 'Paper ballots', note: 'One sheet per room with its speakers, times, scores and ranks, for judges without a phone.' },
  { id: 'judges', label: 'Judge assignments', note: 'Each school’s judges and their rooms, round by round. One page per school.' },
  { id: 'signs', label: 'Room signs', note: 'A big sign for each room door: event, section and time.' },
  { id: 'entryforms', label: 'Entry forms', note: 'Each school’s students, events, waitlist, judges and fees, with a coach signature line. One page per school; no schedule needed.' },
];

/**
 * The director's printing center: postings, pre-filled paper ballots, judge assignment sheets and room signs,
 * built from the schedule. The preview on screen is exactly what prints; everything else on the page is hidden.
 */
export function PrintCenter() {
  const { sections, entries, judges, tournament } = useStore();
  const rounds = [...new Set(sections.map(section => section.round))].sort((a, b) => a - b);
  // Entry forms don't need a schedule, so they're where the tab opens before one exists.
  const [doc, setDoc] = useState<Doc>(sections.length === 0 ? 'entryforms' : 'postings');
  const forms = useEntryFormPages();
  const [chosen, setChosen] = useState<number | 'all'>(rounds[0] ?? 1);
  const round = chosen === 'all' || rounds.includes(chosen) ? chosen : rounds[0] ?? 1;
  const inRound = (section: Section) => round === 'all' || section.round === round;
  const shown = sections.filter(inRound).sort((a, b) => a.round - b.round || tournament.eventIds.indexOf(a.eventId) - tournament.eventIds.indexOf(b.eventId) || (divisionOf(a) === divisionOf(b) ? 0 : divisionOf(a) === 'varsity' ? -1 : 1) || a.label.localeCompare(b.label));
  const entry = (id: string) => entries.find(item => item.id === id);
  const judgeName = (section: Section) => section.judgeName || judges.find(judge => judge.id === section.judgeId)?.name || 'Judge to be assigned';
  const when = (section: Section) => `${roundLabel(section, tournament)} · ${roundTimes[section.round - 1] ?? ''}`;
  const speakerRows = (section: Section) => section.entryIds.map((id, index) => ({ order: index + 1, item: entry(id) })).filter(row => row.item);

  const nothing = sections.length === 0 && doc !== 'entryforms' ? <section className="panel"><div className="schedule-empty"><span className="upload-illustration"><Icon name="file" size={30}/></span><h3>Nothing to print yet</h3><p>Postings, paper ballots, judge sheets and room signs are made from the schedule. Build it on the Setup tab first. Entry forms are ready now.</p></div></section> : null;

  const schools = [...new Set([...entries.map(item => item.school), ...judges.map(judge => judge.school).filter(Boolean)])].sort();
  const pages = doc === 'entryforms' ? forms.pages : doc === 'postings' ? <div className="print-page">
      <header className="print-head"><strong>{tournament.name}</strong><span>{round === 'all' ? 'All rounds' : `${shown[0] ? roundLabel(shown[0], tournament) : `Round ${round}`} · ${roundTimes[(round as number) - 1] ?? ''}`}</span></header>
      <div className="print-postings">{shown.map(section => <section key={section.id} className="print-posting">
        <h3>{contestName(section)} <small>{section.label.replace('Novice · ', '')}{round === 'all' ? ` · ${when(section)}` : ''}</small></h3>
        <p className="print-meta"><b>{section.room}</b> · Judge: {judgeName(section)}</p>
        <ol>{speakerRows(section).map(({ order, item }) => { const load = entryLoad(entries, item!.student, item!.school); return <li key={order}><span>{item!.student}</span><small>{item!.school}{load > 1 ? ` · ${loadLabel(load)}` : ''}</small></li>; })}</ol>
      </section>)}</div>
    </div>
    : doc === 'ballots' ? shown.map(section => <div key={section.id} className="print-page print-ballot">
      <header className="print-head"><strong>{tournament.name}</strong><span>Official ballot · {when(section)}</span></header>
      <div className="print-ballot-top"><div><small>Event</small><b>{contestName(section)}</b></div><div><small>Section</small><b>{section.label.replace('Novice · ', '')}</b></div><div><small>Room</small><b>{section.room}</b></div><div><small>Judge</small><b>{judgeName(section)}</b></div></div>
      <table><thead><tr><th>Order</th><th>Speaker</th><th>Title or thesis</th><th>Time</th><th>Score<br/><small>(of 50)</small></th><th>Rank</th></tr></thead>
        <tbody>{speakerRows(section).map(({ order, item }) => { const load = entryLoad(entries, item!.student, item!.school); return <tr key={order}><td>{order}</td><td><b>{item!.student}</b><br/><small>{item!.school}{load > 1 ? ` · ${loadLabel(load)}` : ''}</small></td><td className="print-blank"/><td className="print-blank"/><td className="print-blank"/><td className="print-blank"/></tr>; })}</tbody></table>
      <ul className="print-rules"><li>Rank every speaker who performed: 1 is best, no ties. Scores run from 35 to 50; a higher rank can’t have a lower score.</li><li>A speaker more than 30 seconds outside the time limit is ranked one place lower. Mark no-shows “NS”.</li><li>Write comments for each speaker on the back or on separate sheets, and return this ballot to the tab room.</li></ul>
      <p className="print-sign">Judge’s signature ______________________________ &nbsp; Time returned ________</p>
    </div>)
    : doc === 'judges' ? schools.filter(school => judges.some(judge => judge.school && sameSchool(judge.school, school))).map(school => { const theirs = judges.filter(judge => judge.school && sameSchool(judge.school, school)); return <div key={school} className="print-page">
      <header className="print-head"><strong>{tournament.name}</strong><span>Judge assignments · {school}</span></header>
      {theirs.map(judge => { const rooms = sections.filter(section => section.judgeId === judge.id).sort((a, b) => a.round - b.round); return <section key={judge.id} className="print-judge">
        <h3>{judge.name}</h3>
        {rooms.length === 0 ? <p className="print-meta">No rooms yet. Check in at the tab room.</p> : <table><tbody>{rooms.map(section => <tr key={section.id}><td>{when(section)}</td><td>{contestName(section)} · {section.label.replace('Novice · ', '')}</td><td><b>{section.room}</b></td><td>{section.entryIds.length} {section.entryIds.length === 1 ? 'speaker' : 'speakers'}</td></tr>)}</tbody></table>}
      </section>; })}
      <p className="print-meta">Judges without a school (community and hired judges) get their rooms from the tab room.</p>
    </div>; })
    : shown.map(section => <div key={section.id} className="print-page print-sign-page">
      <p className="print-sign-room">{section.room}</p>
      <p className="print-sign-event">{contestName(section)}</p>
      <p className="print-sign-when">{section.label.replace('Novice · ', '')} · {when(section)}</p>
      <p className="print-sign-judge">Judge: {judgeName(section)}</p>
      <p className="print-sign-foot">{tournament.name} · Please wait outside until the judge invites you in.</p>
    </div>);

  return <div className="print-center">
    <section className="panel print-controls">
      <div className="panel-head"><div><h2>Print</h2><p>{doc === 'entryforms' ? 'Made from the entries.' : 'Made from the current schedule.'} What you see below is exactly what prints.</p></div><Button icon="file" disabled={!!nothing} onClick={printNow}>Print</Button></div>
      <div className="print-options">
        <div className="segmented" role="tablist" aria-label="What to print">{docs.map(item => <button key={item.id} role="tab" aria-selected={doc === item.id} className={doc === item.id ? 'active' : ''} onClick={() => setDoc(item.id)}>{item.label}</button>)}</div>
        {doc === 'entryforms' && forms.controls}{doc !== 'judges' && doc !== 'entryforms' && rounds.length > 0 && <label className="inline-select"><span>Round</span><select value={String(round)} onChange={event => setChosen(event.target.value === 'all' ? 'all' : Number(event.target.value))}>{rounds.map(number => { const sample = sections.find(section => section.round === number)!; return <option key={number} value={number}>{roundLabel(sample, tournament)}{roundTimes[number - 1] ? ` · ${roundTimes[number - 1]}` : ''}</option>; })}<option value="all">All rounds</option></select></label>}
      </div>
      <p className="print-note"><Icon name="info" size={14}/> {docs.find(item => item.id === doc)!.note} {doc === 'entryforms' ? <Badge tone="neutral">{forms.count} {forms.count === 1 ? 'page' : 'pages'}</Badge> : doc !== 'postings' && doc !== 'judges' && !nothing ? <Badge tone="neutral">{shown.length} {shown.length === 1 ? 'page' : 'pages'}</Badge> : null}</p>
    </section>
    {nothing ?? <div className="print-doc" aria-label="Print preview">{pages}</div>}
  </div>;
}

/** The awards assembly script: each event's places read from last to first, then team sweepstakes. */
export function AwardsScript({ tournamentName, events, teams }: { tournamentName: string; events: { name: string; placings: Placing[] }[]; teams: { school: string; points: number }[] }) {
  const placed = events.filter(event => event.placings.length > 0);
  return <div className="print-doc print-only" aria-hidden="true">
    <div className="print-page">
      <header className="print-head"><strong>{tournamentName}</strong><span>Awards assembly script</span></header>
      {placed.map(event => <section key={event.name} className="print-award">
        <h3>{event.name}</h3>
        <ol reversed>{[...event.placings].sort((a, b) => b.place - a.place).map(placing => <li key={placing.entryId} value={placing.place}><b>{ordinal(placing.place)} place</b> — {placing.student}, {placing.school}</li>)}</ol>
      </section>)}
      {teams.length > 0 && <section className="print-award"><h3>Team sweepstakes</h3><ol>{teams.slice(0, 5).reverse().map(team => <li key={team.school} value={teams.indexOf(team) + 1}><b>{ordinal(teams.indexOf(team) + 1)} place</b> — {team.school}, {team.points} points</li>)}</ol></section>}
    </div>
  </div>;
}

