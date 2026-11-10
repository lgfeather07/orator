import { useState, type ReactNode } from 'react';
import { Avatar, Badge, Button, Icon, Progress } from './ui';
import { releaseLabels, roundSpeakers, tournamentJudges, useStore, type Release } from './store';

const steps = ['Details', 'Ballot criteria', 'Judges', 'Review'];
const releases = Object.keys(releaseLabels) as Release[];

function ReleasePicker({ title, help, value, onChange }: { title: string; help: string; value: Release; onChange: (r: Release) => void }) {
  return <fieldset className="release-picker">
    <legend><strong>{title}</strong><small>{help}</small></legend>
    {releases.map(option => <label key={option} className={value === option ? 'on' : ''}>
      <input type="radio" name={title} checked={value === option} onChange={() => onChange(option)}/>
      <span><strong>{releaseLabels[option].label}</strong><small>{releaseLabels[option].detail}</small></span>
    </label>)}
  </fieldset>;
}

/** Four-step tournament setup. Every step in the stepper is reachable. */
export function DirectorSetup({ criteria, judges }: { criteria: ReactNode; judges: ReactNode }) {
  const store = useStore();
  const [step, setStep] = useState(1);
  const [published, setPublished] = useState(false);
  return <div className="setup-main">
    <div className="stepper" role="tablist" aria-label="Tournament setup steps">{steps.map((label, index) => <span className="stepper-item" key={label}>
      {index > 0 && <i/>}
      <button role="tab" aria-selected={step === index} className={step === index ? 'active' : index < step ? 'done' : ''} onClick={() => setStep(index)}><span>{index < step ? <Icon name="check"/> : index + 1}</span><small>{label}</small></button>
    </span>)}</div>

    {step === 0 && <section className="panel setup-step">
      <div className="panel-head"><div><h2>Tournament details</h2><p>The basics every coach, judge, and student sees.</p></div><Badge tone="success" icon="check">Complete</Badge></div>
      <div className="details-grid">
        <label><span>Tournament name</span><input defaultValue="Gothenburg Invitational"/></label>
        <label><span>Date</span><input defaultValue="October 19, 2025"/></label>
        <label><span>Host school</span><input defaultValue="Gothenburg High School"/></label>
        <label><span>Tournament contact</span><input defaultValue="Dan Miller · 308-555-0142"/></label>
        <label><span>Preliminary rounds</span><select defaultValue="4"><option>3</option><option>4</option><option>5</option></select></label>
        <label><span>Events offered</span><input defaultValue="10 events"/></label>
      </div>
    </section>}

    {step === 1 && criteria}

    {step === 2 && <div className="setup-judges">{judges}</div>}

    {step === 3 && <section className="panel setup-step">
      <div className="panel-head"><div><h2>Review and publish</h2><p>Confirm the setup and decide what each role can see during the tournament.</p></div><Badge tone={published ? 'success' : 'info'} icon={published ? 'check' : 'info'}>{published ? 'Published' : 'Not published yet'}</Badge></div>
      <div className="review-list">{[
        ['Tournament details', 'Gothenburg Invitational · Oct 19 · 4 prelim rounds', true, 0],
        ['Ballot criteria', '4 of 10 events have criteria. OID and POI are missing.', false, 1],
        ['Judges', '42 judges invited · 2 school conflicts to resolve', false, 2],
      ].map(([title, detail, ok, target]) => <button key={title as string} onClick={() => setStep(target as number)}>
        <span className={ok ? 'ok' : 'warn'}><Icon name={ok ? 'check' : 'warning'}/></span><span><strong>{title}</strong><small>{detail}</small></span><Badge tone={ok ? 'success' : 'warning'}>{ok ? 'Ready' : 'Needs work'}</Badge><Icon name="arrow"/>
      </button>)}</div>

      <div className="visibility">
        <div className="visibility-head"><span className="eyebrow">WHO SEES WHAT, AND WHEN</span><h3>Student visibility during the tournament</h3><p>Coaches and the tab room always see ballots as they are submitted. These settings control when competitors do. Past tournaments are never hidden.</p></div>
        <div className="visibility-grid">
          <ReleasePicker title="Rankings" help="Each student’s rank in a round" value={store.rankRelease} onChange={store.setRankRelease}/>
          <ReleasePicker title="Judge comments" help="Written feedback and criteria scores" value={store.commentRelease} onChange={store.setCommentRelease}/>
        </div>
        <div className="visibility-note"><Icon name="info"/><span>Try it: change a setting here, then open the <strong>Student</strong> workspace to see what Maya sees.</span></div>
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
      {step < 3 ? <Button icon="arrow" onClick={() => setStep(step + 1)}>Continue to {steps[step + 1]}</Button> : <Button icon="check" disabled={published} onClick={() => setPublished(true)}>{published ? 'Tournament published' : 'Publish tournament'}</Button>}
    </div>
  </div>;
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
