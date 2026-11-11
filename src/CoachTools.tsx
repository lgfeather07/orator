import { useEffect, useState } from 'react';
import { Badge, Button, Icon } from './ui';
import { useStore } from './store';
import { useAuth } from './auth';
import { loadTeamBallots, type TeamBallotRow } from './ballotApi';
import { ballotEvents, MARK_MAX } from './ballots';

/** Practice focus checklist. Coach and student both tick items off; the coach can add to it. */
export function PracticeChecklist({ canAdd = false }: { canAdd?: boolean }) {
  const { checklist, toggleChecklist, addChecklist } = useStore();
  const [draft, setDraft] = useState('');
  const done = checklist.filter(item => item.done).length;
  return <div className="practice-checklist">
    <div className="field-label"><span>Practice focus checklist</span><small>{done} of {checklist.length} done</small></div>
    {checklist.map(item => <label key={item.id} className={item.done ? 'done' : ''}><input type="checkbox" checked={item.done} onChange={() => toggleChecklist(item.id)}/><span>{item.label}</span></label>)}
    {canAdd && <form onSubmit={event => { event.preventDefault(); if (draft.trim()) { addChecklist(draft.trim()); setDraft(''); } }}><input value={draft} onChange={event => setDraft(event.target.value)} placeholder="Add a focus item" aria-label="New checklist item"/><Button variant="secondary" icon="plus" disabled={!draft.trim()}>Add</Button></form>}
  </div>;
}

/** Student-facing opt-in for round reminders by text or email. */
export function ReminderSettings() {
  const { reminders, setReminders } = useStore();
  return <div className="reminder-card">
    <span className="reminder-icon"><Icon name="bell"/></span>
    <div><strong>Round reminders</strong><small>Get your room and start time 15 minutes before each round, without opening Orator.</small></div>
    <label><input type="checkbox" checked={reminders.text} onChange={event => setReminders({ ...reminders, text: event.target.checked })}/> Text me</label>
    <label><input type="checkbox" checked={reminders.email} onChange={event => setReminders({ ...reminders, email: event.target.checked })}/> Email me</label>
  </div>;
}

const seasonBallots = [
  { tournament: 'Gothenburg Invitational', judge: 'Judge Leather', score: 9.2, outlier: false },
  { tournament: 'Millard West Classic', judge: 'Maria Chen', score: 9.0, outlier: false },
  { tournament: 'Millard West Classic', judge: 'Tom Becker', score: 4.8, outlier: true },
  { tournament: 'Norfolk Invitational', judge: 'David Ross', score: 8.8, outlier: false },
  { tournament: 'Lincoln East Open', judge: 'Alyssa Ford', score: 8.6, outlier: false },
];
const average = (rows: typeof seasonBallots) => (rows.reduce((sum, row) => sum + row.score, 0) / rows.length).toFixed(1);

/** Coaching tools on a student's record: focus notes, practice log, checklist, and score context. */
export function StudentRecordExtras({ student }: { student: string }) {
  const { focusNotes, sendFocusNote, practiceLog, addPractice } = useStore();
  const [note, setNote] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [practice, setPractice] = useState('');
  const [excludeOutliers, setExcludeOutliers] = useState(false);
  const first = student.split(' ')[0];
  const counted = excludeOutliers ? seasonBallots.filter(row => !row.outlier) : seasonBallots;
  return <div className="record-extras">
    <section className="record-card">
      <div className="field-label"><span><Icon name="send" size={14}/> Send {first} a focus note</span><small>Shows on their overview</small></div>
      <textarea value={note} onChange={event => setNote(event.target.value)} placeholder={`e.g. “You ran 10:24 in Round 1. Cut the third example before Round 2.”`}/>
      <div className="record-row"><label className="urgent-toggle"><input type="checkbox" checked={urgent} onChange={event => setUrgent(event.target.checked)}/> Mark urgent and send a text alert</label><Button icon="send" disabled={!note.trim()} onClick={() => { sendFocusNote(note.trim(), urgent); setNote(''); setUrgent(false); }}>Send note</Button></div>
      <ul className="sent-notes">{focusNotes.map(item => <li key={item.id}><p>{item.text}</p><span>{item.urgent && <Badge tone="danger" icon="bell">Urgent</Badge>}<Badge tone={item.seen ? 'success' : 'neutral'} icon={item.seen ? 'eye' : 'clock'}>{item.seen ? `Seen by ${first}` : 'Not seen yet'}</Badge><small>{item.sent}</small></span></li>)}</ul>
    </section>

    <section className="record-card">
      <div className="field-label"><span><Icon name="edit" size={14}/> Practice feedback</span><small>Kept all season</small></div>
      <textarea value={practice} onChange={event => setPractice(event.target.value)} placeholder="What did you work on in practice today?"/>
      <div className="record-row"><span/><Button variant="secondary" icon="plus" disabled={!practice.trim()} onClick={() => { addPractice(practice.trim()); setPractice(''); }}>Save to practice log</Button></div>
      <ul className="practice-log">{practiceLog.map(item => <li key={item.id}><small>{item.date}</small><p>{item.text}</p></li>)}</ul>
    </section>

    <section className="record-card"><PracticeChecklist canAdd/></section>

    <section className="record-card">
      <div className="field-label"><span><Icon name="growth" size={14}/> Season scores</span><small>Average section mark out of 10</small></div>
      <div className="score-summary"><strong>{average(counted)}</strong><span>{excludeOutliers ? 'average without the outlier ballot' : 'average across all ballots'}</span></div>
      <label className="urgent-toggle"><input type="checkbox" checked={excludeOutliers} onChange={event => setExcludeOutliers(event.target.checked)}/> Leave outlier ballots out of the average</label>
      <ul className="score-list">{seasonBallots.map(row => <li key={row.tournament + row.judge} className={row.outlier && excludeOutliers ? 'excluded' : ''}><span><strong>{row.tournament}</strong><small>{row.judge}</small></span>{row.outlier && <Badge tone="warning" icon="warning">Outlier</Badge>}<b>{row.score.toFixed(1)}</b></li>)}</ul>
      <p className="record-foot"><Icon name="info" size={14}/> Outlier ballots are flagged, never deleted. {first} can still read every ballot and its comments.</p>
    </section>
  </div>;
}

const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4) % 4]}`;
const clock = (total: number) => `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;

/** Real ballots judges have submitted for speakers from the signed-in coach's school. */
export function TeamBallots() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<TeamBallotRow[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const school = profile?.school ?? '';
  useEffect(() => {
    if (!profile || !school) return;
    let active = true;
    loadTeamBallots(school).then(data => active && setRows(data)).catch(caught => active && setError(caught instanceof Error ? caught.message : 'Could not load ballots.'));
    return () => { active = false; };
  }, [profile, school]);
  if (!profile) return null;
  return <section className="panel team-ballots">
    <div className="panel-head"><div><h2>Submitted ballots · {school || 'your school'}</h2><p>Live from judges. A ballot appears here as soon as it is submitted.</p></div>{rows && <Badge tone={rows.length ? 'success' : 'neutral'}>{rows.length} ballot{rows.length === 1 ? '' : 's'}</Badge>}</div>
    {!school ? <p className="team-ballots-empty">Your account has no school yet, so Orator can’t match ballots to your team. Add your school to see them here.</p>
    : error ? <p className="team-ballots-empty" role="alert">We couldn’t load ballots: {error}</p>
    : rows === null ? <p className="team-ballots-empty">Loading ballots…</p>
    : rows.length === 0 ? <p className="team-ballots-empty">No submitted ballots for {school} yet. They appear when a judge submits a round that includes one of your speakers.</p>
    : <div className="team-ballot-list">{rows.map(row => {
      const event = ballotEvents.find(item => item.id === row.eventId);
      return <article key={row.key} className={open === row.key ? 'open' : ''}>
        <button onClick={() => setOpen(open === row.key ? null : row.key)} aria-expanded={open === row.key}>
          <span><strong>{row.speaker}</strong><small>{event?.name ?? row.eventId} · {row.tournament} · Round {row.round}</small></span>
          <span><small>Judge</small><strong>{row.judge || 'Judge'}</strong></span>
          {row.present === false ? <Badge tone="danger">No-show</Badge> : <Badge tone={row.rank === 1 ? 'success' : 'neutral'}>{row.rank ? ordinal(row.rank) : '—'} · {row.rating ?? '—'}</Badge>}
          <Icon name="chevron"/>
        </button>
        {open === row.key && row.present !== false && <div className="team-ballot-detail">
          <div className="team-ballot-flags">{row.timeSeconds !== null && <Badge tone={row.timePenalty ? 'danger' : 'neutral'} icon="clock">{clock(row.timeSeconds)}{row.timePenalty ? ' · lowered one rank' : ''}</Badge>}{row.disqualifications.map(reason => <Badge key={reason} tone="danger" icon="warning">DQ reported: {reason}</Badge>)}</div>
          {row.comments && <div className="team-ballot-text"><small>Comments</small><p>{row.comments}</p></div>}
          {row.reason && <div className="team-ballot-text"><small>Reason for decision</small><p>{row.reason}</p></div>}
          <dl>{(event?.criteria ?? []).map((item, index) => <div key={item.name}><dt>{item.name}</dt><dd>{row.marks[index] ?? '—'}<small>/{MARK_MAX}</small></dd></div>)}</dl>
        </div>}
      </article>;
    })}</div>}
  </section>;
}

/** Coaches decide when their students see rankings and comments, and only once the tournament has ended. */
export function ReleaseResults() {
  const { tournament, resultsReleased, releaseResults } = useStore();
  const finished = tournament.status === 'finished';
  return <div className={`release-card ${resultsReleased ? 'released' : ''}`}>
    <span className="release-icon"><Icon name={resultsReleased ? 'eye' : 'lock'}/></span>
    <div><strong>{resultsReleased ? 'Results are released to your students' : 'Your students can’t see rankings or comments yet'}</strong>
      <small>{resultsReleased ? 'Each student now sees their own rankings and judge comments from this tournament.' : finished ? 'The tournament has ended. Release results when you are ready to talk them through with your team.' : 'Results stay hidden for the whole tournament. You can release them once the director ends it.'}</small></div>
    {resultsReleased ? <Badge tone="success" icon="check">Released</Badge> : <Button icon="eye" disabled={!finished} onClick={releaseResults}>Release to students</Button>}
  </div>;
}
