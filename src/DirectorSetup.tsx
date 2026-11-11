import { useState, type ReactNode } from 'react';
import { Avatar, Badge, Button, Icon, Progress } from './ui';
import { roundSpeakers, tournamentJudges, useStore } from './store';
import { ballotEvents } from './ballots';
import { entryLoad, loadLabel, roundTimes, sameSchool, type Section } from './tournament';

const steps = ['Details', 'Entries', 'Judges', 'Schedule', 'Review'];
const eventName = (id: string) => ballotEvents.find(event => event.id === id)?.name ?? id;
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** A judge may not hear a speaker from their own school. */
function useScheduleChecks() {
  const { sections, entries, judges: judgePool } = useStore();
  const conflict = (section: Section) => {
    const judge = judgePool.find(item => item.id === section.judgeId);
    return !!judge?.school && section.entryIds.some(id => { const entry = entries.find(item => item.id === id); return !!entry && sameSchool(entry.school, judge.school); });
  };
  const doubleBooked = (section: Section) => !!section.judgeId && sections.some(other => other.id !== section.id && other.round === section.round && other.judgeId === section.judgeId);
  const problems = sections.filter(section => !section.judgeId || conflict(section) || doubleBooked(section));
  return { conflict, doubleBooked, problems };
}

/** Five-step tournament setup: details, coach entries, judges, the schedule, then publish and run. */
export function DirectorSetup({ judges }: { judges: ReactNode }) {
  const store = useStore();
  const { tournament, updateTournament, entries, sections, submittedSchools, judges: judgePool } = store;
  const { conflict, doubleBooked, problems } = useScheduleChecks();
  const [step, setStep] = useState(0);
  const [round, setRound] = useState(1);
  const [search, setSearch] = useState('');

  const schools = [...new Set(entries.map(entry => entry.school))].sort();
  const waiting = schools.filter(school => !submittedSchools.some(name => sameSchool(name, school)));
  const offered = tournament.eventIds;
  const emptyEvents = offered.filter(id => !entries.some(entry => entry.eventId === id));
  const outsideEvents = entries.filter(entry => !offered.includes(entry.eventId));
  const shown = entries.filter(entry => `${entry.student} ${entry.school} ${eventName(entry.eventId)}`.toLowerCase().includes(search.toLowerCase()));
  const roundSections = sections.filter(section => section.round === round);
  // Count each student once, by how many events they are in.
  const loads = [...new Map(entries.map(entry => [`${entry.school}|${entry.student}`.toLowerCase(), entryLoad(entries, entry.student, entry.school)])).values()];
  const loadCount = (count: number) => loads.filter(load => count === 4 ? load >= 4 : load === count).length;
  const built = sections.length > 0;
  const editable = tournament.status === 'registration';
  const toggleEvent = (id: string) => updateTournament({ eventIds: offered.includes(id) ? offered.filter(item => item !== id) : ballotEvents.map(event => event.id).filter(item => item === id || offered.includes(item)) });

  return <div className="setup-main">
    <div className="stepper" role="tablist" aria-label="Tournament setup steps">{steps.map((label, index) => <span className="stepper-item" key={label}>
      {index > 0 && <i/>}
      <button role="tab" aria-selected={step === index} className={step === index ? 'active' : index < step ? 'done' : ''} onClick={() => setStep(index)}><span>{index < step ? <Icon name="check"/> : index + 1}</span><small>{label}</small></button>
    </span>)}</div>

    {step === 0 && <section className="panel setup-step">
      <div className="panel-head"><div><h2>Tournament details</h2><p>The basics every coach, judge, and student sees.</p></div>{store.live ? <Badge tone="success" icon="check">Saved to your account</Badge> : <Button variant="secondary" icon="archive" onClick={() => { store.resetDemo(); setStep(0); }}>Reset demo</Button>}</div>
      <div className="details-grid">
        <label><span>Tournament name</span><input value={tournament.name} onChange={event => updateTournament({ name: event.target.value })}/></label>
        <label><span>Date</span><input value={tournament.date} onChange={event => updateTournament({ date: event.target.value })}/></label>
        <label><span>Host school</span><input value={tournament.host} onChange={event => updateTournament({ host: event.target.value })}/></label>
        <label><span>Most events per student</span><select value={tournament.maxEntries} disabled={!editable} onChange={event => updateTournament({ maxEntries: Number(event.target.value) })}>{[1, 2, 3, 4].map(count => <option key={count} value={count}>{count === 1 ? '1 event' : `${count} events`}</option>)}</select></label>
        <label><span>Preliminary rounds</span><select value={tournament.rounds} disabled={!editable} onChange={event => updateTournament({ rounds: Number(event.target.value) })}>{[2, 3, 4, 5].map(count => <option key={count} value={count}>{count} rounds</option>)}</select></label>
      </div>
      <div className="events-offered">
        <div className="field-label"><span>Events offered</span><small>{offered.length} of {ballotEvents.length} · official NSAA ballot built in for each</small></div>
        <div className="event-checks">{ballotEvents.map(event => <label key={event.id} className={offered.includes(event.id) ? 'on' : ''}>
          <input type="checkbox" checked={offered.includes(event.id)} disabled={!editable} onChange={() => toggleEvent(event.id)}/>
          <span><strong>{event.name}</strong><small>{event.time.min ? `${clock(event.time.min)}–${clock(event.time.max)}` : `${clock(event.time.max)} max`}{event.time.classAMax ? ` · ${clock(event.time.classAMax)} Class A` : ''}</small></span>
        </label>)}</div>
        {!editable && <p className="setup-locked"><Icon name="lock" size={14}/> Rounds and events are locked once registration closes. Reopen registration on the Review step to change them.</p>}
      </div>
    </section>}

    {step === 1 && <section className="panel setup-step">
      <div className="panel-head"><div><h2>Entries from coaches</h2><p>{entries.length} {entries.length === 1 ? 'entry' : 'entries'} for {loads.length} {loads.length === 1 ? 'student' : 'students'} from {schools.length} {schools.length === 1 ? 'school' : 'schools'}. Coaches add these from their own workspace.</p></div><Badge tone={editable ? 'info' : 'success'} icon={editable ? 'clock' : 'lock'}>{editable ? 'Registration open' : 'Registration closed'}</Badge></div>
      <div className="school-grid">{schools.map(school => { const count = entries.filter(entry => entry.school === school).length; const done = !waiting.includes(school); return <div key={school} className={done ? '' : 'waiting'}>
        <strong>{school}</strong><span>{count} {count === 1 ? 'entry' : 'entries'}</span><Badge tone={done ? 'success' : 'warning'} icon={done ? 'check' : 'clock'}>{done ? 'Sent' : 'Still editing'}</Badge>
      </div>; })}</div>
      {waiting.length > 0 && <div className="setup-note warn"><Icon name="warning"/><span><strong>{waiting.join(', ')} {waiting.length === 1 ? 'hasn’t' : 'haven’t'} sent final entries.</strong> You can still build the schedule, but late changes will mean rebuilding it. {store.live ? '' : <>Try it: open the <strong>Coach</strong> workspace, add a student under Entries, and send them.</>}</span></div>}
      {outsideEvents.length > 0 && <div className="setup-note warn"><Icon name="warning"/><span><strong>{outsideEvents.length} {outsideEvents.length === 1 ? 'entry is' : 'entries are'} in an event you no longer offer</strong> and will be left off the schedule: {[...new Set(outsideEvents.map(entry => eventName(entry.eventId)))].join(', ')}.</span></div>}
      <div className="load-mix"><span className="eyebrow">Entered in</span>{[[1, 'One event'], [2, 'Double entered'], [3, 'Triple entered'], [4, 'Four events']].map(([count, label]) => <span key={label}><b>{loadCount(count as number)}</b>{label}</span>)}<small>Worked out from the entries. Multi-entered students choose which room to go to first.</small></div>
      <div className="entry-counts">{offered.map(id => { const count = entries.filter(entry => entry.eventId === id).length; return <span key={id} className={count ? '' : 'empty'}><b>{count}</b>{eventName(id)}<small>{count ? `${Math.ceil(count / tournament.sectionSize)} room${Math.ceil(count / tournament.sectionSize) > 1 ? 's' : ''}` : 'no entries'}</small></span>; })}</div>
      <div className="entry-browser">
        <label className="search-box"><Icon name="search"/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search student, school, or event"/></label>
        <div className="entry-browser-list">{shown.map(entry => <div key={entry.id}><strong>{entry.student}{entryLoad(entries, entry.student, entry.school) > 1 && <em className="load-tag" title={loadLabel(entryLoad(entries, entry.student, entry.school))}>{entryLoad(entries, entry.student, entry.school)}×</em>}</strong><span>{entry.school}</span><span>{eventName(entry.eventId)}</span></div>)}{shown.length === 0 && <p>No entries match “{search}”.</p>}</div>
      </div>
    </section>}

    {step === 2 && <div className="setup-judges"><div className="setup-note"><Icon name="info"/><span><strong>{judgePool.length} {judgePool.length === 1 ? 'judge is' : 'judges are'} available.</strong> {store.live ? 'Judges appear here once you approve them on the People tab. ' : ''}The schedule never gives a judge a room with a speaker from their own school.</span></div>{store.live ? <ul className="judge-roll">{judgePool.map(judge => <li key={judge.id}><Avatar initials={judge.name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase()} size="sm"/><strong>{judge.name}</strong><small>{judge.school || 'No school affiliation'}</small></li>)}{judgePool.length === 0 && <li className="empty">No approved judges yet. Rooms will be flagged “Needs a judge” until some are approved.</li>}</ul> : judges}</div>}

    {step === 3 && <section className="panel setup-step">
      <div className="panel-head"><div><h2>Schedule</h2><p>{built ? `${sections.length} rooms across ${tournament.rounds} rounds` : 'Sort every entry into rooms, rounds, and judges.'}</p></div>
        <span className="panel-head-actions"><label className="inline-select"><span>Most speakers per room</span><select value={tournament.sectionSize} disabled={!editable} onChange={event => updateTournament({ sectionSize: Number(event.target.value) })}>{[5, 6, 7, 8].map(size => <option key={size} value={size}>{size}</option>)}</select></label>
        <Button icon={built ? 'sparkle' : 'plus'} variant={built ? 'secondary' : 'primary'} disabled={entries.length === 0} onClick={() => { store.generateSchedule(); setRound(1); }}>{built ? 'Rebuild' : 'Build schedule'}</Button></span></div>
      {!built ? <div className="schedule-empty"><span className="upload-illustration"><Icon name="clock" size={30}/></span><h3>No schedule yet</h3><p>Orator splits each event into rooms of up to {tournament.sectionSize}, spreads teammates across rooms, mixes the rooms each round, and assigns judges with no school conflicts.</p><Button icon="plus" onClick={() => store.generateSchedule()}>Build schedule</Button></div> : <>
        <div className="schedule-tools"><div className="segmented">{Array.from({ length: tournament.rounds }, (_, index) => index + 1).map(number => <button key={number} className={round === number ? 'active' : ''} onClick={() => setRound(number)}>Round {number} · {roundTimes[number - 1]}</button>)}</div>
          <Badge tone={problems.length ? 'warning' : 'success'} icon={problems.length ? 'warning' : 'check'}>{problems.length ? `${problems.length} room${problems.length > 1 ? 's need' : ' needs'} attention` : 'Every room has a judge'}</Badge></div>
        <p className="schedule-hint"><Icon name="info" size={14}/> Students tagged double or triple entered are in more than one room this round. They choose which to go to first, so judges see the same tag and know to expect them late or let them leave early.</p>
        <div className="section-grid">{roundSections.map(section => {
          const flagged = !section.judgeId || conflict(section) || doubleBooked(section);
          return <article key={section.id} className={flagged ? 'flagged' : ''}>
            <header><div><span className="eyebrow">{section.room}</span><strong>{eventName(section.eventId)}</strong><small>{section.label} · {section.entryIds.length} speakers</small></div>
              <label><span>Judge</span><select aria-label={`Judge for ${eventName(section.eventId)} ${section.label}`} value={section.judgeId ?? ''} onChange={event => store.assignJudge(section.id, event.target.value || null)}><option value="">Needs a judge</option>{judgePool.map(judge => <option key={judge.id} value={judge.id}>{judge.name}{judge.school ? ` · ${judge.school}` : ''}</option>)}</select></label></header>
            {flagged && <p className="section-flag"><Icon name="warning" size={14}/> {!section.judgeId ? 'No judge is free for this room. Pick one or add judges.' : conflict(section) ? 'This judge is from the same school as a speaker here.' : 'This judge is already in another room this round.'}</p>}
            <ol>{section.entryIds.map(id => { const entry = entries.find(item => item.id === id); const load = entryLoad(entries, entry?.student ?? '', entry?.school ?? ''); return entry ? <li key={id}><span>{entry.student}</span><small>{entry.school}</small>{load > 1 && <em className="load-tag" title={loadLabel(load)}>{loadLabel(load)}</em>}</li> : null; })}</ol>
          </article>;
        })}</div>
      </>}
    </section>}

    {step === 4 && <section className="panel setup-step">
      <div className="panel-head"><div><h2>Review and run</h2><p>Confirm the setup, publish the schedule, and run the day.</p></div><Badge tone={tournament.status === 'registration' ? 'info' : 'success'} icon={tournament.status === 'registration' ? 'info' : 'check'}>{{ registration: 'Not published yet', scheduled: 'Schedule published', running: 'Tournament running', finished: 'Tournament finished' }[tournament.status]}</Badge></div>
      <div className="review-list">{([
        ['Tournament details', `${tournament.name} · ${tournament.date} · ${tournament.rounds} rounds · ${offered.length} events`, emptyEvents.length === 0, emptyEvents.length ? `${emptyEvents.length} offered event${emptyEvents.length > 1 ? 's have' : ' has'} no entries` : '', 0],
        ['Entries', `${entries.length} entries from ${schools.length} schools`, waiting.length === 0, waiting.length ? `${waiting.length} school${waiting.length > 1 ? 's are' : ' is'} still editing` : '', 1],
        ['Schedule', built ? `${sections.length} rooms across ${tournament.rounds} rounds` : 'Not built yet', built && problems.length === 0, !built ? 'Build the schedule first' : problems.length ? `${problems.length} room${problems.length > 1 ? 's need' : ' needs'} a judge` : '', 3],
      ] as [string, string, boolean, string, number][]).map(([title, detail, ok, note, target]) => <button key={title} onClick={() => setStep(target)}>
        <span className={ok ? 'ok' : 'warn'}><Icon name={ok ? 'check' : 'warning'}/></span><span><strong>{title}</strong><small>{detail}{note ? ` · ${note}` : ''}</small></span><Badge tone={ok ? 'success' : 'warning'}>{ok ? 'Ready' : 'Needs work'}</Badge><Icon name="arrow"/>
      </button>)}</div>

      <div className="run-steps">{([
        ['scheduled', 'Publish the schedule', 'Closes registration. Coaches, judges, and students see rooms and times.'],
        ['running', 'Start the tournament', 'Opens ballots for judges. Students see nothing about results.'],
        ['finished', 'End the tournament', 'Locks every ballot. Coaches can then release results to their students.'],
      ] as ['scheduled' | 'running' | 'finished', string, string][]).map(([target, title, detail], index) => {
        const order = ['registration', 'scheduled', 'running', 'finished']; const at = order.indexOf(tournament.status); const done = at >= index + 1; const next = at === index;
        return <div key={target} className={done ? 'done' : next ? 'next' : ''}><span>{done ? <Icon name="check" size={16}/> : index + 1}</span><div><strong>{title}</strong><small>{detail}</small></div>
          {done ? <Badge tone="success" icon="check">Done</Badge> : <Button disabled={!next || (target === 'scheduled' && !built)} onClick={() => updateTournament({ status: target })}>{title.split(' ')[0]}</Button>}</div>;
      })}
        {tournament.status !== 'registration' && <button className="run-undo" onClick={() => updateTournament({ status: 'registration' })}>Reopen registration and start over</button>}
      </div>

      <div className="visibility">
        <div className="visibility-head"><span className="eyebrow">WHO SEES WHAT, AND WHEN</span><h3>Students see results only when their coach releases them</h3><p>Rankings and judge comments are hidden from students for the whole tournament. Once you end the tournament, each coach decides when to release their own team’s results. Coaches and the tab room see ballots as they are submitted.</p></div>
        <div className="visibility-note"><Icon name="info"/><span>Try it: end the tournament here, open the <strong>Coach</strong> workspace and release results under Ballot review, then look at the <strong>Student</strong> workspace.</span></div>
      </div>

      <div className="visibility">
        <div className="visibility-head"><span className="eyebrow">ROUND REMINDERS</span><h3>Text and email reminders</h3><p>Send each competitor and judge their room and start time before every round, so nobody has to log in between rounds.</p></div>
        <div className="toggle-list">
          <label><input type="checkbox" checked={store.reminders.text} onChange={event => store.setReminders({ ...store.reminders, text: event.target.checked })}/><span><strong>Text message reminders</strong><small>15 minutes before each round, to people who opted in</small></span></label>
          <label><input type="checkbox" checked={store.reminders.email} onChange={event => store.setReminders({ ...store.reminders, email: event.target.checked })}/><span><strong>Email reminders</strong><small>Full schedule the night before, plus any room changes</small></span></label>
        </div>
      </div>
    </section>}

    <div className="setup-nav">
      <Button variant="secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</Button>
      <span>Step {step + 1} of {steps.length} · {steps[step]}</span>
      <Button icon="arrow" disabled={step === steps.length - 1} onClick={() => setStep(step + 1)}>{step === steps.length - 1 ? 'Last step' : `Continue to ${steps[step + 1]}`}</Button>
    </div>
  </div>;
}

/** Live numbers beside the setup steps. */
export function SetupSummary() {
  const { tournament, entries, sections, issues } = useStore();
  const { problems } = useScheduleChecks();
  const schools = new Set(entries.map(entry => entry.school)).size;
  const openIssues = issues.filter(issue => issue.status === 'open').length;
  const stage = ['registration', 'scheduled', 'running', 'finished'].indexOf(tournament.status);
  return <aside className="setup-aside">
    <div className="summary-card">
      <span className="eyebrow">{tournament.date}</span><h3>{tournament.name}</h3>
      <div className="summary-stage">{['Registration', 'Published', 'Running', 'Finished'].map((label, index) => <span key={label} className={index < stage ? 'done' : index === stage ? 'now' : ''}>{label}</span>)}</div>
      <dl><div><dt>Entries</dt><dd>{entries.length}</dd></div><div><dt>Schools</dt><dd>{schools}</dd></div><div><dt>Events</dt><dd>{tournament.eventIds.length}</dd></div><div><dt>Rooms / round</dt><dd>{sections.length ? Math.round(sections.length / tournament.rounds) : '—'}</dd></div></dl>
    </div>
    {sections.length > 0 && problems.length > 0 && <div className="alert-card"><span><Icon name="warning"/></span><div><strong>{problems.length} room{problems.length > 1 ? 's need' : ' needs'} a judge</strong><p>Fix these on the Schedule step before you publish.</p></div></div>}
    <div className={`tip-card ${openIssues ? 'has-issues' : ''}`}><Icon name={openIssues ? 'warning' : 'check'}/><div><strong>{openIssues ? `${openIssues} open issue${openIssues > 1 ? 's' : ''}` : 'No open issues'}</strong><p>{openIssues ? 'See the Issues tab for what was reported and where.' : 'Reports from students, judges, and coaches show up on the Issues tab.'}</p></div></div>
  </aside>;
}

/** Morning check-in board: which judges have arrived, searchable by judge, room, or event. */
export function CheckInBoard() {
  const { judgeCheckedIn, toggleJudge, speakerPresence } = useStore();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'missing'>('all');
  const arrived = tournamentJudges.filter(judge => judgeCheckedIn[judge.id]).length;
  const rows = tournamentJudges.filter(judge => `${judge.name} ${judge.room} ${judge.event} ${judge.school}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || !judgeCheckedIn[judge.id]));
  const present = roundSpeakers.filter(speaker => speakerPresence[speaker.code] === 'present').length;
  const noShow = roundSpeakers.filter(speaker => speakerPresence[speaker.code] === 'absent');
  return <div className="checkin-layout">
    <section className="panel">
      <div className="panel-head"><div><h2>Judge check-in</h2><p>Round 2 · starts 9:30 AM</p></div><Badge tone={arrived === tournamentJudges.length ? 'success' : 'warning'} icon={arrived === tournamentJudges.length ? 'check' : 'clock'}>{arrived} of {tournamentJudges.length} checked in</Badge></div>
      <div className="checkin-tools">
        <label className="search-box"><Icon name="search"/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search judge, room, or event"/></label>
        <div className="segmented"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All judges</button><button className={filter === 'missing' ? 'active' : ''} onClick={() => setFilter('missing')}>Not checked in</button></div>
      </div>
      <div className="checkin-list">{rows.map(judge => <div key={judge.id} className={judgeCheckedIn[judge.id] ? 'in' : ''}>
        <Avatar initials={judge.name.split(' ').map(part => part[0]).join('').slice(0, 2)} size="sm"/>
        <span><strong>{judge.name}</strong><small>{judge.school}</small></span>
        <span><strong>{judge.room}</strong><small>{judge.event}</small></span>
        <Badge tone={judgeCheckedIn[judge.id] ? 'success' : 'warning'} icon={judgeCheckedIn[judge.id] ? 'check' : 'clock'}>{judgeCheckedIn[judge.id] ? 'Checked in' : 'Not here yet'}</Badge>
        <button className="checkin-action" onClick={() => toggleJudge(judge.id)}>{judgeCheckedIn[judge.id] ? 'Undo' : 'Check in'}</button>
      </div>)}{rows.length === 0 && <p className="checkin-empty">No judges match “{query}”.</p>}</div>
    </section>
    <aside className="panel checkin-aside">
      <div className="panel-head"><div><h2>Room 214 · Informative</h2><p>Speakers checked in by Judge Leather</p></div></div>
      <div className="checkin-room"><strong>{present} of {roundSpeakers.length}</strong><span>speakers present</span><Progress value={Math.round((present / roundSpeakers.length) * 100)}/></div>
      {roundSpeakers.map(speaker => <div className="checkin-speaker" key={speaker.code}><span>{speaker.code}</span><strong>{speaker.name}</strong><Badge tone={speakerPresence[speaker.code] === 'present' ? 'success' : speakerPresence[speaker.code] === 'absent' ? 'danger' : 'neutral'}>{speakerPresence[speaker.code] === 'present' ? 'Present' : speakerPresence[speaker.code] === 'absent' ? 'No-show' : 'Waiting'}</Badge></div>)}
      {noShow.length > 0 && <div className="checkin-alert"><Icon name="warning"/><span>{noShow.map(speaker => speaker.name).join(', ')} marked no-show. Their coach has been notified.</span></div>}
    </aside>
  </div>;
}
