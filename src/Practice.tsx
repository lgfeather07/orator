import { useEffect, useMemo, useState } from 'react';
import { Avatar, Badge, Button, Icon, Progress } from './ui';
import { useStore } from './store';
import { ballotEvents, MARK_MAX } from './ballots';
import { loadSeasonBallots, loadTeamBallots } from './ballotApi';
import { pastBallots } from './PastBallots';
import { sameSchool, type PracticeGoal } from './tournament';

const eventName = (id: string) => ballotEvents.find(event => event.id === id)?.name ?? '';
const initials = (name: string) => name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** One student's practice goals. A coach can add and remove them; both coach and student tick them off. */
export function GoalList({ student, school, canEdit, events }: { student: string; school: string; canEdit: boolean; events?: string[] }) {
  const { practiceGoals, addGoal, toggleGoal, removeGoal } = useStore();
  const [draft, setDraft] = useState('');
  const [eventId, setEventId] = useState('');
  const goals = practiceGoals.filter(goal => same(goal.student, student) && sameSchool(goal.school, school));
  const open = goals.filter(goal => !goal.done), done = goals.filter(goal => goal.done);
  const first = student.split(' ')[0];
  const row = (goal: PracticeGoal) => <li key={goal.id} className={goal.done ? 'done' : ''}>
    <label><input type="checkbox" checked={goal.done} onChange={() => toggleGoal(goal.id)}/><span><strong>{goal.text}</strong><small>{[eventName(goal.eventId), `set ${goal.created}`].filter(Boolean).join(' · ')}</small></span></label>
    {canEdit && <button className="icon-button" aria-label={`Remove goal: ${goal.text}`} onClick={() => removeGoal(goal.id)}><Icon name="close" size={15}/></button>}
  </li>;
  return <div className="goal-list">
    <div className="goal-progress"><span><strong>{done.length} of {goals.length}</strong> goals done</span><Progress value={goals.length ? Math.round((done.length / goals.length) * 100) : 0} label={`${first}’s practice goals done`}/></div>
    {canEdit && <form className="goal-add" onSubmit={event => { event.preventDefault(); if (!draft.trim()) return; addGoal({ student, school, eventId, text: draft.trim() }); setDraft(''); }}>
      <input aria-label={`New goal for ${first}`} value={draft} maxLength={300} onChange={event => setDraft(event.target.value)} placeholder={`e.g. “Pause after the opening story”`}/>
      <select aria-label="Event for this goal" value={eventId} onChange={event => setEventId(event.target.value)}><option value="">Any event</option>{(events?.length ? events : ballotEvents.map(event => event.id)).map(id => <option key={id} value={id}>{eventName(id)}</option>)}</select>
      <button className="button button-primary" type="submit" disabled={!draft.trim()}><Icon name="plus"/><span>Add goal</span></button>
    </form>}
    {goals.length === 0 ? <p className="goal-empty">{canEdit ? `No goals for ${first} yet. Add one above, or use a suggestion.` : 'Your coach hasn’t set any practice goals yet.'}</p> : <>
      {open.length > 0 && <ul className="goals">{open.map(row)}</ul>}
      {done.length > 0 && <><h4 className="goal-subhead">Done</h4><ul className="goals">{done.map(row)}</ul></>}
    </>}
  </div>;
}

export type MarkRow = { eventId: string; marks: number[] };
/** The section a student scores lowest in, across their ballots: a starting point for a practice goal. */
export function weakestSection(rows: MarkRow[]) {
  const totals = new Map<string, { eventId: string; name: string; sum: number; count: number }>();
  rows.forEach(row => { const criteria = ballotEvents.find(event => event.id === row.eventId)?.criteria ?? []; row.marks.forEach((mark, index) => { if (!mark || !criteria[index]) return; const key = `${row.eventId}|${index}`; const item = totals.get(key) ?? { eventId: row.eventId, name: criteria[index].name, sum: 0, count: 0 }; item.sum += mark; item.count++; totals.set(key, item); }); });
  const list = [...totals.values()].filter(item => item.count > 0).map(item => ({ ...item, average: item.sum / item.count }));
  if (list.length === 0) return null;
  const weakest = list.reduce((a, b) => b.average < a.average ? b : a), strongest = list.reduce((a, b) => b.average > a.average ? b : a);
  return { weakest, strongest, ballots: rows.length };
}

/** Coach: pick a student, see where judges mark them lowest, and set practice goals. */
export function CoachPractice({ school, students, initial = '' }: { school: string; students: { name: string; events: string[] }[]; initial?: string }) {
  const store = useStore();
  const [chosen, setChosen] = useState(initial);
  const student = students.find(item => item.name === chosen) ?? students[0];
  // Real ballots for a signed-in coach: the whole season with the coach plan, otherwise this tournament's (free).
  // Sample ballots in the demo.
  const [teamRows, setTeamRows] = useState<{ speaker: string; eventId: string; marks: number[] }[] | null>(store.live ? null : pastBallots.map(ballot => ({ speaker: ballot.student, eventId: ballot.eventId, marks: ballot.marks })));
  const tournamentId = store.tournamentId;
  useEffect(() => {
    if (!store.live) return;
    let active = true;
    const thisTournament = () => tournamentId ? loadTeamBallots(school, tournamentId) : Promise.resolve([]);
    loadSeasonBallots(school).catch(thisTournament)
      .then(rows => active && setTeamRows(rows.map(row => ({ speaker: row.speaker, eventId: row.eventId, marks: row.marks }))))
      .catch(() => active && setTeamRows([]));
    return () => { active = false; };
  }, [store.live, school, tournamentId]);
  const insight = useMemo(() => student && teamRows ? weakestSection(teamRows.filter(row => same(row.speaker, student.name))) : null, [student, teamRows]);
  if (!student) return <section className="panel practice-empty"><span className="upload-illustration"><Icon name="users" size={28}/></span><h3>No students yet</h3><p>Add students under Entries. Each one gets their own practice goals here, and they see them on their own Practice tab.</p></section>;
  const first = student.name.split(' ')[0];
  const openCount = (name: string) => store.practiceGoals.filter(goal => same(goal.student, name) && sameSchool(goal.school, school) && !goal.done).length;
  const suggestion = insight ? `Raise ${insight.weakest.name.toLowerCase()} in ${eventName(insight.weakest.eventId)}` : '';
  return <div className="practice-layout">
    <nav className="panel practice-students" aria-label="Students">
      <div className="panel-head"><div><h2>Students</h2><p>{students.length} on {school}</p></div></div>
      <ul>{students.map(item => <li key={item.name}><button className={item.name === student.name ? 'active' : ''} aria-current={item.name === student.name} onClick={() => setChosen(item.name)}><Avatar initials={initials(item.name)} size="sm"/><span className="who"><strong>{item.name}</strong><small>{item.events.map(eventName).join(', ') || 'No events yet'}</small></span>{openCount(item.name) > 0 && <Badge tone="info">{openCount(item.name)}</Badge>}</button></li>)}</ul>
    </nav>
    <section className="panel practice-main">
      <div className="panel-head"><div><h2>{student.name}’s practice goals</h2><p>{first} sees these on their own Practice tab and can tick them off.</p></div></div>
      <GoalList student={student.name} school={school} canEdit events={student.events}/>
    </section>
    <aside className="panel focus-panel practice-insight"><div className="panel-head"><div><h2>Coaching opportunity</h2><p>From {first}’s ballots{insight ? ` · ${insight.ballots} so far` : ''}</p></div><Icon name="sparkle"/></div>
      <div className="focus-content">{teamRows === null ? <p>Loading {first}’s ballots…</p> : insight ? <>
        <span className="state-icon"><Icon name="growth"/></span>
        <blockquote>Judges mark {first} lowest on <strong>{insight.weakest.name}</strong> in {eventName(insight.weakest.eventId)}: {insight.weakest.average.toFixed(1)} of {MARK_MAX} on average. {insight.strongest.name} in {eventName(insight.strongest.eventId)} is strongest at {insight.strongest.average.toFixed(1)}.</blockquote>
        <Button icon="plus" onClick={() => store.addGoal({ student: student.name, school, eventId: insight.weakest.eventId, text: suggestion })}>Add “{suggestion}”</Button>
      </> : <p className="goal-empty">Suggestions appear here once {first} has submitted ballots. Until then, add goals from what you see in practice.</p>}</div>
    </aside>
  </div>;
}

/** Student: their own practice goals from their coach. */
export function StudentPractice({ student, school }: { student: string; school: string }) {
  const { practiceGoals } = useStore();
  const mine = practiceGoals.filter(goal => same(goal.student, student) && sameSchool(goal.school, school));
  return <section className="panel practice-main student-practice">
    <div className="panel-head"><div><h2>My practice goals</h2><p>Set by your coach at {school}. Tick one off when you’ve got it; your coach sees it too.</p></div><Badge tone={mine.length && mine.every(goal => goal.done) ? 'success' : 'info'} icon="sparkle">{mine.filter(goal => !goal.done).length} to work on</Badge></div>
    <GoalList student={student} school={school} canEdit={false}/>
  </section>;
}
