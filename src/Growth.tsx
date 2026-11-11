import { useState } from 'react';
import { Avatar, Badge, Button, Icon } from './ui';
import { ballotEvents } from './ballots';

/** The five most recent finished tournaments, oldest first. */
export const growthMeets = ['Lincoln East', 'Norfolk', 'Millard West', 'Aurora', 'Minden'];

/** Each student's three events, with their average section mark (out of 10) at each tournament. */
export const teamGrowth: { name: string; year: string; events: Record<string, number[]> }[] = [
  { name: 'Maya Rodriguez', year: 'Junior', events: { info: [7.2, 7.6, 8.1, 8.4, 8.9], persuasive: [6.4, 6.9, 6.8, 7.5, 7.9], poetry: [7.8, 7.6, 8.0, 7.9, 8.2] } },
  { name: 'Eli Thompson', year: 'Senior', events: { extemp: [7.9, 8.2, 8.0, 8.6, 9.1], info: [6.8, 7.1, 7.4, 7.3, 7.8], entertainment: [7.0, 6.6, 7.2, 7.7, 7.6] } },
  { name: 'Nora Patel', year: 'Sophomore', events: { persuasive: [6.1, 6.8, 7.4, 7.9, 8.5], serious: [7.3, 7.2, 7.6, 7.5, 7.9], extemp: [5.9, 6.3, 6.2, 6.9, 7.2] } },
  { name: 'Sam Wilson', year: 'Junior', events: { poetry: [8.0, 8.3, 8.2, 8.7, 8.8], humorous: [6.9, 7.4, 7.8, 7.6, 8.3], serious: [7.1, 6.8, 7.3, 7.7, 7.6] } },
  { name: 'Iris Chen', year: 'Freshman', events: { serious: [5.8, 6.4, 6.9, 7.3, 7.8], poetry: [6.5, 6.7, 7.2, 7.1, 7.6], entertainment: [6.0, 6.1, 6.6, 7.0, 7.4] } },
];

const eventName = (id: string) => ballotEvents.find(event => event.id === id)?.name ?? id;
const initials = (name: string) => name.split(' ').map(part => part[0]).join('').slice(0, 2);
const change = (values: number[]) => values[values.length - 1] - values[0];

/** Line chart whose meet names sit directly under their points, because both are placed from the same x. */
export function GrowthChart({ values, labels }: { values: number[]; labels: string[] }) {
  const width = 640, height = 250, left = 76, right = 52, top = 26, bottom = 46;
  const low = 4, high = 10;
  const x = (index: number) => left + (index * (width - left - right)) / (values.length - 1);
  const y = (value: number) => top + ((high - value) * (height - top - bottom)) / (high - low);
  const points = values.map((value, index) => [x(index), y(value)] as const);
  const line = points.map(([px, py], index) => `${index ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
  const floor = height - bottom;
  return <svg className="growth-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Average section mark by tournament: ${values.map((value, index) => `${labels[index]} ${value.toFixed(1)}`).join(', ')}`}>
    <defs><linearGradient id="growth-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--brand)" stopOpacity=".2"/><stop offset="100%" stopColor="var(--brand)" stopOpacity="0"/></linearGradient></defs>
    {[4, 6, 8, 10].map(tick => <g key={tick}><line className="growth-grid" x1={left - 22} x2={width - right + 22} y1={y(tick)} y2={y(tick)}/><text className="growth-tick" x={left - 30} y={y(tick) + 4} textAnchor="end">{tick}</text></g>)}
    <path d={`${line} L${points[points.length - 1][0].toFixed(1)} ${floor} L${points[0][0].toFixed(1)} ${floor} Z`} fill="url(#growth-area)"/>
    <path className="growth-line" d={line}/>
    {points.map(([px, py], index) => <g key={labels[index]}>
      <line className="growth-drop" x1={px} x2={px} y1={py} y2={floor}/>
      <circle className={`growth-dot ${index === points.length - 1 ? 'latest' : ''}`} cx={px} cy={py} r="6"/>
      <text className="growth-value" x={px} y={py - 13} textAnchor="middle">{values[index].toFixed(1)}</text>
      <text className="growth-meet" x={px} y={floor + 26} textAnchor="middle">{labels[index]}</text>
    </g>)}
  </svg>;
}

/** Coach view: pick a student, then one of their three events, to see how that event has grown. */
export function StudentGrowth({ onOpenStudent }: { onOpenStudent: (name: string) => void }) {
  const [studentName, setStudentName] = useState(teamGrowth[0].name);
  const student = teamGrowth.find(item => item.name === studentName) ?? teamGrowth[0];
  const eventIds = Object.keys(student.events);
  const [eventId, setEventId] = useState(eventIds[0]);
  const active = eventIds.includes(eventId) ? eventId : eventIds[0];
  const values = student.events[active];
  const delta = change(values);
  const best = eventIds.reduce((a, b) => student.events[b][4] > student.events[a][4] ? b : a);
  const mostImproved = eventIds.reduce((a, b) => change(student.events[b]) > change(student.events[a]) ? b : a);
  const first = student.name.split(' ')[0];
  return <div className="role-grid">
    <section className="panel growth-panel">
      <div className="panel-head"><div><h2>Student growth</h2><p>Average section mark out of 10, by event, over the last five tournaments</p></div>
        <select aria-label="Student" value={student.name} onChange={event => { const next = teamGrowth.find(item => item.name === event.target.value)!; setStudentName(next.name); setEventId(Object.keys(next.events)[0]); }}>{teamGrowth.map(item => <option key={item.name}>{item.name}</option>)}</select></div>
      <div className="student-summary"><Avatar initials={initials(student.name)}/><div><strong>{student.name}</strong><span>{student.year} · entered in {eventIds.length} events</span></div><Badge tone={delta >= 0 ? 'success' : 'warning'} icon="growth">{delta >= 0 ? '+' : ''}{delta.toFixed(1)} in {eventName(active)}</Badge></div>
      <div className="growth-events" role="tablist" aria-label={`${first}’s events`}>{eventIds.map(id => <button key={id} role="tab" aria-selected={active === id} className={active === id ? 'active' : ''} onClick={() => setEventId(id)}><strong>{eventName(id)}</strong><small>{student.events[id][4].toFixed(1)} now · {change(student.events[id]) >= 0 ? '+' : ''}{change(student.events[id]).toFixed(1)}</small></button>)}</div>
      <GrowthChart values={values} labels={growthMeets}/>
    </section>
    <aside className="panel focus-panel"><div className="panel-head"><div><h2>Coaching opportunity</h2><p>From {first}’s three events</p></div><Icon name="sparkle"/></div>
      <div className="focus-content"><span className="state-icon"><Icon name="growth"/></span>
        <blockquote>{first}’s {eventName(mostImproved)} is improving fastest, up {change(student.events[mostImproved]).toFixed(1)} since {growthMeets[0]}. {best === mostImproved ? 'It is also the strongest event right now.' : `${eventName(best)} is still the strongest event at ${student.events[best][4].toFixed(1)}.`}</blockquote>
        <div className="focus-tags"><Badge tone="success" icon="check">Strongest: {eventName(best)}</Badge><Badge tone="pink" icon="growth">Most improved: {eventName(mostImproved)}</Badge></div>
        <Button icon="plus" onClick={() => onOpenStudent(student.name)}>Create practice goal</Button></div></aside>
  </div>;
}
