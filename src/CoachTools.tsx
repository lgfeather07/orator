import { useState } from 'react';
import { Badge, Button, Icon } from './ui';
import { useStore } from './store';

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
  { tournament: 'Gothenburg Invitational', judge: 'Judge Leather', score: 4.6, outlier: false },
  { tournament: 'Millard West Classic', judge: 'Maria Chen', score: 4.5, outlier: false },
  { tournament: 'Millard West Classic', judge: 'Tom Becker', score: 2.4, outlier: true },
  { tournament: 'Norfolk Invitational', judge: 'David Ross', score: 4.4, outlier: false },
  { tournament: 'Lincoln East Open', judge: 'Alyssa Ford', score: 4.3, outlier: false },
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
      <div className="field-label"><span><Icon name="growth" size={14}/> Season scores</span><small>Average of ballot criteria</small></div>
      <div className="score-summary"><strong>{average(counted)}</strong><span>{excludeOutliers ? 'average without the outlier ballot' : 'average across all ballots'}</span></div>
      <label className="urgent-toggle"><input type="checkbox" checked={excludeOutliers} onChange={event => setExcludeOutliers(event.target.checked)}/> Leave outlier ballots out of the average</label>
      <ul className="score-list">{seasonBallots.map(row => <li key={row.tournament + row.judge} className={row.outlier && excludeOutliers ? 'excluded' : ''}><span><strong>{row.tournament}</strong><small>{row.judge}</small></span>{row.outlier && <Badge tone="warning" icon="warning">Outlier</Badge>}<b>{row.score.toFixed(1)}</b></li>)}</ul>
      <p className="record-foot"><Icon name="info" size={14}/> Outlier ballots are flagged, never deleted. {first} can still read every ballot and its comments.</p>
    </section>
  </div>;
}
