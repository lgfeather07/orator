import { useState } from 'react';
import { Avatar, Badge, Button, Icon } from './ui';
import { ballotEvents } from './ballots';
import { loadLabel } from './tournament';
import { useStore } from './store';

/** The five most recent finished tournaments, oldest first. */
export const growthMeets = ['Lincoln East', 'Norfolk', 'Millard West', 'Aurora', 'Minden'];

/**
 * Each student's events, with their average section mark (out of 10) at each tournament.
 * The charts show the rating (the five marks added up, out of 50) and the average rank.
 */
export const teamGrowth: { name: string; year: string; events: Record<string, number[]>; latest: Record<string, number> }[] = [
  { name: 'Maya Rodriguez', year: 'Junior', events: { info: [7.2, 7.6, 8.1, 8.4, 8.9], persuasive: [6.4, 6.9, 6.8, 7.5, 7.9], poetry: [7.8, 7.6, 8.0, 7.9, 8.2] }, latest: { info: 9.2, persuasive: 8.0, poetry: 8.4 } },
  { name: 'Eli Thompson', year: 'Senior', events: { extemp: [7.9, 8.2, 8.0, 8.6, 9.1], info: [6.8, 7.1, 7.4, 7.3, 7.8] }, latest: { extemp: 9.0, info: 8.1 } },
  { name: 'Nora Patel', year: 'Sophomore', events: { persuasive: [6.1, 6.8, 7.4, 7.9, 8.5], serious: [7.3, 7.2, 7.6, 7.5, 7.9], extemp: [5.9, 6.3, 6.2, 6.9, 7.2] }, latest: { persuasive: 8.6, serious: 8.2, extemp: 7.5 } },
  { name: 'Sam Wilson', year: 'Junior', events: { poetry: [8.0, 8.3, 8.2, 8.7, 8.8], humorous: [6.9, 7.4, 7.8, 7.6, 8.3] }, latest: { poetry: 9.0, humorous: 8.2 } },
  { name: 'Iris Chen', year: 'Freshman', events: { serious: [5.8, 6.4, 6.9, 7.3, 7.8] }, latest: { serious: 8.1 } },
];

const eventName = (id: string) => ballotEvents.find(event => event.id === id)?.name ?? id;
const initials = (name: string) => name.split(' ').map(part => part[0]).join('').slice(0, 2);
const change = (values: number[]) => values[values.length - 1] - values[0];
/** Average rating out of 50: five section marks added together. */
const toRating = (mark: number) => Math.round(mark * 50) / 10;
/** Sample average rank for a meet. Stronger marks rank nearer 1st. */
const toRank = (mark: number) => Math.round(Math.min(6, Math.max(1, 1 + (9.4 - mark) * 1.5)) * 10) / 10;
const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;

type Scale = { low: number; high: number; ticks: number[]; inverted?: boolean; tickLabel?: (tick: number) => string; height?: number };
const ratingScale: Scale = { low: 33, high: 50, ticks: [35, 40, 45, 50] };
const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n > 3 ? 0 : n]}`;
const rankScale: Scale = { low: 1, high: 6, ticks: [1, 2, 3, 4, 5, 6], inverted: true, tickLabel: ordinal, height: 215 };

/** Line chart whose meet names sit directly under their points, because both are placed from the same x. */
export function GrowthChart({ values, labels, scale, title }: { values: number[]; labels: string[]; scale: Scale; title: string }) {
  const width = 640, height = scale.height ?? 250, left = 76, right = 52, top = 26, bottom = 46;
  const span = height - top - bottom;
  const x = (index: number) => left + (index * (width - left - right)) / (values.length - 1);
  const y = (value: number) => top + ((scale.inverted ? value - scale.low : scale.high - value) * span) / (scale.high - scale.low);
  const points = values.map((value, index) => [x(index), y(value)] as const);
  const line = points.map(([px, py], index) => `${index ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
  const floor = height - bottom;
  const gradient = `growth-area-${scale.inverted ? 'rank' : 'rating'}`;
  return <svg className="growth-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title} by tournament: ${values.map((value, index) => `${labels[index]} ${value.toFixed(1)}`).join(', ')}`}>
    <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--brand)" stopOpacity=".2"/><stop offset="100%" stopColor="var(--brand)" stopOpacity="0"/></linearGradient></defs>
    {scale.ticks.map(tick => <g key={tick}><line className="growth-grid" x1={left - 22} x2={width - right + 22} y1={y(tick)} y2={y(tick)}/><text className="growth-tick" x={left - 30} y={y(tick) + 4} textAnchor="end">{scale.tickLabel ? scale.tickLabel(tick) : tick}</text></g>)}
    <path d={`${line} L${points[points.length - 1][0].toFixed(1)} ${floor} L${points[0][0].toFixed(1)} ${floor} Z`} fill={`url(#${gradient})`}/>
    <path className="growth-line" d={line}/>
    {points.map(([px, py], index) => <g key={labels[index]}>
      <line className="growth-drop" x1={px} x2={px} y1={py} y2={floor}/>
      <circle className={`growth-dot ${index === points.length - 1 ? 'latest' : ''}`} cx={px} cy={py} r="6"/>
      <text className="growth-value" x={px} y={py - 13} textAnchor="middle">{values[index].toFixed(1)}</text>
      <text className="growth-meet" x={px} y={floor + 26} textAnchor="middle">{labels[index]}</text>
    </g>)}
  </svg>;
}

/** The two charts for one event: average rating, then average rank. */
function EventCharts({ marks, labels }: { marks: number[]; labels: string[] }) {
  const ratings = marks.map(toRating), ranks = marks.map(toRank);
  return <div className="growth-charts">
    <figure><figcaption><strong>Average rating</strong><span>out of 50 · {signed(change(ratings))} points</span></figcaption><GrowthChart title="Average rating out of 50" values={ratings} labels={labels} scale={ratingScale}/></figure>
    <figure><figcaption><strong>Average rank</strong><span>1st is best · {change(ranks) <= 0 ? `up ${Math.abs(change(ranks)).toFixed(1)} places` : `down ${change(ranks).toFixed(1)} places`}</span></figcaption><GrowthChart title="Average rank" values={ranks} labels={labels} scale={rankScale}/></figure>
  </div>;
}

/** Coach view: pick a student, then one of their three events, to see how that event has grown. */
export function StudentGrowth({ onOpenStudent }: { onOpenStudent: (name: string) => void }) {
  const [studentName, setStudentName] = useState(teamGrowth[0].name);
  const student = teamGrowth.find(item => item.name === studentName) ?? teamGrowth[0];
  const eventIds = Object.keys(student.events);
  const [eventId, setEventId] = useState(eventIds[0]);
  const active = eventIds.includes(eventId) ? eventId : eventIds[0];
  const values = student.events[active];
  const delta = change(values.map(toRating));
  const best = eventIds.reduce((a, b) => student.events[b][4] > student.events[a][4] ? b : a);
  const mostImproved = eventIds.reduce((a, b) => change(student.events[b]) > change(student.events[a]) ? b : a);
  const first = student.name.split(' ')[0];
  return <div className="role-grid">
    <section className="panel growth-panel">
      <div className="panel-head"><div><h2>Student growth</h2><p>Average rating (out of 50) and average rank, by event, over the last five tournaments</p></div>
        <select aria-label="Student" value={student.name} onChange={event => { const next = teamGrowth.find(item => item.name === event.target.value)!; setStudentName(next.name); setEventId(Object.keys(next.events)[0]); }}>{teamGrowth.map(item => <option key={item.name}>{item.name}</option>)}</select></div>
      <div className="student-summary"><Avatar initials={initials(student.name)}/><div><strong>{student.name}</strong><span>{student.year} · {eventIds.length === 1 ? 'one event' : `${loadLabel(eventIds.length).toLowerCase()} · ${eventIds.length} events`}</span></div><Badge tone={delta >= 0 ? 'success' : 'warning'} icon="growth">{signed(delta)} points in {eventName(active)}</Badge></div>
      <div className="growth-events" role="tablist" aria-label={`${first}’s events`}>{eventIds.map(id => <button key={id} role="tab" aria-selected={active === id} className={active === id ? 'active' : ''} onClick={() => setEventId(id)}><strong>{eventName(id)}</strong><small>{toRating(student.events[id][4]).toFixed(1)} now · {signed(change(student.events[id].map(toRating)))}</small></button>)}</div>
      <EventCharts marks={values} labels={growthMeets}/>
    </section>
    <aside className="panel focus-panel"><div className="panel-head"><div><h2>Coaching opportunity</h2><p>From {first}’s {eventIds.length === 1 ? 'event' : `${eventIds.length} events`}</p></div><Icon name="sparkle"/></div>
      <div className="focus-content"><span className="state-icon"><Icon name="growth"/></span>
        <blockquote>{first}’s {eventName(mostImproved)} is {eventIds.length === 1 ? 'up' : 'improving fastest, up'} {change(student.events[mostImproved].map(toRating)).toFixed(1)} rating points since {growthMeets[0]}. {eventIds.length === 1 ? '' : best === mostImproved ? 'It is also the strongest event right now.' : `${eventName(best)} is still the strongest event at ${toRating(student.events[best][4]).toFixed(1)}.`}</blockquote>
        <div className="focus-tags"><Badge tone="success" icon="check">Strongest: {eventName(best)}</Badge><Badge tone="pink" icon="growth">Most improved: {eventName(mostImproved)}</Badge></div>
        <Button icon="plus" onClick={() => onOpenStudent(student.name)}>Create practice goal</Button></div></aside>
  </div>;
}

/** A student's own growth, by event. The current tournament only appears once their coach has released results. */
export function MyGrowth({ name }: { name: string }) {
  const { resultsReleased, tournament } = useStore();
  const student = teamGrowth.find(item => item.name === name) ?? teamGrowth[0];
  const eventIds = Object.keys(student.events);
  const [eventId, setEventId] = useState(eventIds[0]);
  const values = resultsReleased ? [...student.events[eventId], student.latest[eventId]] : student.events[eventId];
  const labels = resultsReleased ? [...growthMeets, tournament.name.split(' ')[0]] : growthMeets;
  const delta = change(values.map(toRating));
  return <section className="panel growth-panel my-growth">
    <div className="panel-head"><div><h2>My growth</h2><p>Your average rating (out of 50) and average rank in each event</p></div><Badge tone={delta >= 0 ? 'success' : 'warning'} icon="growth">{signed(delta)} points in {eventName(eventId)}</Badge></div>
    <div className="growth-events" role="tablist" aria-label="Your events">{eventIds.map(id => <button key={id} role="tab" aria-selected={eventId === id} className={eventId === id ? 'active' : ''} onClick={() => setEventId(id)}><strong>{eventName(id)}</strong><small>{toRating(student.events[id][4]).toFixed(1)} last meet · {signed(change(student.events[id].map(toRating)))}</small></button>)}</div>
    <EventCharts marks={values} labels={labels}/>
    <p className="growth-note"><Icon name={resultsReleased ? 'check' : 'lock'} size={14}/> {resultsReleased ? `${tournament.name} is included because your coach released your results.` : `${tournament.name} will be added after the tournament, once your coach releases your results.`}</p>
  </section>;
}
