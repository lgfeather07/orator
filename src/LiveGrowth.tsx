import { useEffect, useMemo, useState } from 'react';
import { Avatar, Badge, Button, Icon } from './ui';
import { ballotEvents } from './ballots';
import { loadSeasonBallots, PlanRequiredError } from './ballotApi';
import { PlanLocked } from './CoachPlan';
import { GrowthChart, type Scale } from './Growth';
import { weakestSection } from './Practice';
import { loadPublished, sameName } from './publicResultsApi';
import { buildGrowth, highlights, trend, type GrowthBallot, type GrowthPoint, type StudentGrowthStats } from './growthStats';

const eventName = (id: string) => ballotEvents.find(event => event.id === id)?.name ?? id;
const initials = (name: string) => name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 > 3 ? 0 : n % 10]}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Fit the rating axis to the student's real numbers, in steps of 5, never above 50. */
function ratingScale(values: number[]): Scale {
  const low = Math.max(0, Math.min(45, Math.floor((Math.min(...values) - 2) / 5) * 5));
  const ticks = Array.from({ length: Math.floor((50 - low) / 5) + 1 }, (_, index) => low + index * 5);
  return { low, high: 50, ticks };
}
function rankScale(values: number[]): Scale {
  const high = Math.max(6, Math.ceil(Math.max(...values)));
  return { low: 1, high, ticks: Array.from({ length: high }, (_, index) => index + 1), inverted: true, tickLabel: ordinal, height: 215 };
}

/** One measure (rating or rank) across tournaments: a chart once there are two, otherwise the single number. */
function Measure({ points, pick, kind }: { points: GrowthPoint[]; pick: (point: GrowthPoint) => number | null; kind: 'rating' | 'rank' }) {
  const known = points.filter(point => pick(point) !== null);
  const values = known.map(point => pick(point)!);
  const change = trend(values);
  const title = kind === 'rating' ? 'Average rating' : 'Average rank';
  const moved = change === null ? '' : change === 0 ? ' · no change' : kind === 'rating' ? ` · ${signed(change)} points` : ` · ${change < 0 ? `up ${Math.abs(change).toFixed(1)}` : `down ${change.toFixed(1)}`} places`;
  const note = `${kind === 'rating' ? 'out of 50' : '1st is best'}${moved}`;
  return <figure><figcaption><strong>{title}</strong><span>{note}</span></figcaption>
    {values.length >= 2 ? <GrowthChart title={kind === 'rating' ? 'Average rating out of 50' : 'Average rank'} values={values} labels={known.map(point => point.label)} scale={kind === 'rating' ? ratingScale(values) : rankScale(values)}/>
      : values.length === 1 ? <p className="growth-single"><strong>{kind === 'rating' ? values[0].toFixed(1) : ordinal(Math.round(values[0]))}</strong><span>{kind === 'rank' ? `average ${values[0].toFixed(1)} · ` : ''}at {known[0].tournament}. The chart starts after a second tournament.</span></p>
      : <p className="growth-single"><span>{kind === 'rating' ? 'No judge gave rating points in this event yet.' : 'No ranks in this event yet.'}</span></p>}
  </figure>;
}

function EventTabs({ stats, active, onChange, label }: { stats: StudentGrowthStats; active: string; onChange: (id: string) => void; label: string }) {
  return <div className="growth-events" role="tablist" aria-label={label}>{Object.keys(stats.events).map(id => {
    const points = stats.events[id]; const latest = points[points.length - 1];
    return <button key={id} role="tab" aria-selected={active === id} className={active === id ? 'active' : ''} onClick={() => onChange(id)}>
      <strong>{eventName(id)}</strong><small>{latest.rating !== null ? `${latest.rating.toFixed(1)}/50` : latest.rank !== null ? `avg rank ${latest.rank.toFixed(1)}` : '—'} · {plural(points.length, 'tournament')}</small></button>;
  })}</div>;
}

function Charts({ points }: { points: GrowthPoint[] }) {
  return <div className="growth-charts"><Measure points={points} pick={point => point.rating} kind="rating"/><Measure points={points} pick={point => point.rank} kind="rank"/></div>;
}

/**
 * The school's ballots from every tournament, from the database's season sweep (coach plan only). `locked` is set
 * when the database says the school has no plan running; `reload` asks again (after a trial starts).
 */
function useSeasonBallots(school: string) {
  const [rows, setRows] = useState<GrowthBallot[] | null>(null);
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { let active = true; setRows(null); setError(''); setLocked(false);
    loadSeasonBallots(school).then(data => active && setRows(data)).catch(caught => {
      if (!active) return; setRows([]);
      if (caught instanceof PlanRequiredError) setLocked(true); else setError(caught instanceof Error ? caught.message : 'Couldn’t load ballots.');
    });
    return () => { active = false; }; }, [school, attempt]);
  return { rows, error, locked, reload: () => setAttempt(value => value + 1) };
}

/** Final rounds each student reached, from published results. */
function useFinals(school: string) {
  const [finals, setFinals] = useState<{ student: string; place: number }[]>([]);
  useEffect(() => { let active = true; loadPublished({ school }).then(data => active && setFinals(data.placings.filter(row => !row.withheld).map(row => ({ student: row.student, place: row.place })))).catch(() => undefined); return () => { active = false; }; }, [school]);
  return finals;
}

const Loading = ({ title }: { title: string }) => <section className="panel growth-panel"><div className="panel-head"><div><h2>{title}</h2><p>Loading ballots…</p></div></div></section>;

/**
 * Signed-in coach: each student's real growth, from every submitted ballot for their school across tournaments
 * (the database's season sweep, coach plan only).
 * The coaching opportunity points at the section judges mark lowest and opens Practice for that student.
 */
export function LiveStudentGrowth({ school, onPractice }: { school: string; onPractice: (student: string) => void }) {
  const { rows, error, locked, reload } = useSeasonBallots(school);
  const finals = useFinals(school);
  const stats = useMemo(() => buildGrowth(rows ?? []), [rows]);
  const [chosen, setChosen] = useState('');
  const [eventId, setEventId] = useState('');
  if (!rows) return <Loading title="Student growth"/>;
  if (locked) return <PlanLocked school={school} role="coach" feature="Student growth" onStarted={reload}/>;
  if (stats.length === 0) return <section className="panel growth-panel growth-empty"><div className="panel-head"><div><h2>Student growth</h2><p>From your team’s real ballots</p></div></div>
    {error && <p className="sync-inline" role="alert"><Icon name="warning" size={14}/> {error}</p>}
    <p className="growth-note"><Icon name="growth" size={14}/> Growth appears once judges submit ballots for {school}. Each tournament adds a point to every student’s chart, event by event.</p></section>;
  const student = stats.find(item => sameName(item.student, chosen)) ?? stats[0];
  const ids = Object.keys(student.events);
  const active = ids.includes(eventId) ? eventId : ids[0];
  const points = student.events[active];
  const { strongest, mostImproved } = highlights(student);
  const insight = weakestSection((rows ?? []).filter(row => sameName(row.speaker, student.student)));
  const first = student.student.split(' ')[0];
  const myFinals = finals.filter(row => sameName(row.student, student.student));
  const gain = mostImproved ? trend(student.events[mostImproved].map(point => point.rating)) : null;
  return <div className="role-grid">
    <section className="panel growth-panel">
      <div className="panel-head"><div><h2>Student growth</h2><p>Average rating (out of 50) and average rank, by event, from every submitted ballot</p></div>
        <select aria-label="Student" value={student.student} onChange={event => { setChosen(event.target.value); setEventId(''); }}>{stats.map(item => <option key={item.student}>{item.student}</option>)}</select></div>
      <div className="student-summary"><Avatar initials={initials(student.student)}/><div><strong>{student.student}</strong><span>{plural(ids.length, 'event')} · {plural(new Set(Object.values(student.events).flat().map(point => point.tournament)).size, 'tournament')} · {myFinals.length ? `${plural(myFinals.length, 'final')} reached` : 'No published finals yet'}</span></div></div>
      <EventTabs stats={student} active={active} onChange={setEventId} label={`${first}’s events`}/>
      <Charts points={points}/>
    </section>
    <aside className="panel focus-panel"><div className="panel-head"><div><h2>Coaching opportunity</h2><p>From {first}’s ballots</p></div><Icon name="sparkle"/></div>
      <div className="focus-content"><span className="state-icon"><Icon name="growth"/></span>
        <blockquote>{insight ? `Judges mark ${first}’s ${insight.weakest.name.toLowerCase()} lowest in ${eventName(insight.weakest.eventId)} (${insight.weakest.average.toFixed(1)} of 10 across ${plural(insight.weakest.count, 'ballot')}). ${insight.strongest.name} in ${eventName(insight.strongest.eventId)} is the strongest.`
          : gain ? `${first}’s ${eventName(mostImproved!)} is up ${gain.toFixed(1)} rating points since the first tournament.` : `Once judges mark sections on ${first}’s ballots, this shows the one to work on first.`}</blockquote>
        <div className="focus-tags">{strongest && <Badge tone="success" icon="check">Strongest: {eventName(strongest)}</Badge>}{mostImproved && <Badge tone="pink" icon="growth">Most improved: {eventName(mostImproved)}</Badge>}</div>
        <Button icon="plus" onClick={() => onPractice(student.student)}>Create practice goal</Button></div></aside>
  </div>;
}

/**
 * Signed-in student: their own growth. The database only returns ballots their coach has released,
 * so tournaments appear here once results are released.
 */
export function LiveMyGrowth({ school, student }: { school: string; student: string }) {
  const { rows, error, locked } = useSeasonBallots(school);
  const mine = useMemo(() => buildGrowth((rows ?? []).filter(row => sameName(row.speaker, student)))[0], [rows, student]);
  const [eventId, setEventId] = useState('');
  if (!rows) return <Loading title="My growth"/>;
  if (locked) return <PlanLocked school={school} role="student" feature="My growth"/>;
  if (!mine) return <section className="panel growth-panel my-growth growth-empty"><div className="panel-head"><div><h2>My growth</h2><p>Your average rating and rank in each event</p></div></div>
    {error && <p className="sync-inline" role="alert"><Icon name="warning" size={14}/> {error}</p>}
    <p className="growth-note"><Icon name="lock" size={14}/> Your growth appears after a tournament, once your coach releases results. Each tournament adds a point, event by event.</p></section>;
  const ids = Object.keys(mine.events);
  const active = ids.includes(eventId) ? eventId : ids[0];
  const points = mine.events[active];
  const delta = trend(points.map(point => point.rating));
  const insight = weakestSection((rows ?? []).filter(row => sameName(row.speaker, student) && row.eventId === active));
  return <section className="panel growth-panel my-growth">
    <div className="panel-head"><div><h2>My growth</h2><p>Your average rating (out of 50) and average rank in each event</p></div>
      {delta !== null && <Badge tone={delta >= 0 ? 'success' : 'warning'} icon="growth">{signed(delta)} points in {eventName(active)}</Badge>}</div>
    <EventTabs stats={mine} active={active} onChange={setEventId} label="Your events"/>
    <Charts points={points}/>
    {insight && <p className="growth-note"><Icon name="sparkle" size={14}/> Focus: judges mark your {insight.weakest.name.toLowerCase()} lowest in {eventName(active)} ({insight.weakest.average.toFixed(1)} of 10). Your {insight.strongest.name.toLowerCase()} is your strongest.</p>}
    <p className="growth-note"><Icon name="check" size={14}/> From {plural(points.reduce((sum, point) => sum + point.ballots, 0), 'ballot')} your coach has released.</p>
  </section>;
}
