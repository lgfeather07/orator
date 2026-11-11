import { useMemo, useState } from 'react';
import { Avatar, Badge, Icon } from './ui';
import { ballotEvents, MARK_MAX, RATING_MIN } from './ballots';
import { growthMeets, teamGrowth } from './Growth';

export type PastBallot = {
  id: string; student: string; eventId: string; meet: string; meetOrder: number; date: string; round: number; judge: string;
  rank: number; of: number; rating: number; timeSeconds: number; marks: number[]; comments: string; reason: string;
};

const meetDates = ['Sep 12', 'Sep 26', 'Oct 3', 'Oct 10', 'Oct 17'];
const pastJudges = ['Maria Chen', 'David Ross', 'Alyssa Ford', 'Tom Becker', 'Rosa Nuñez', 'Kyle Pratt', 'Hannah Wolfe', 'Ben Sato', 'Lena Morris'];
const strengths = [
  'Your opening pulled the room in right away.', 'Clear structure; I always knew where you were in the speech.', 'Strong, well-chosen supporting material.',
  'Confident presence and steady eye contact.', 'Your vocal variety kept the piece alive.', 'You clearly understand this material and it shows.',
];
const nextSteps = [
  'Slow down through your transitions so each point lands.', 'Watch your time; trim one example.', 'Vary your pacing in the middle section.',
  'Let the big moments breathe with a pause.', 'Tighten the ending so it finishes with purpose.', 'Use gestures more deliberately; a few felt repeated.',
];
const reasons = [
  'Ranked on the strength of content and polish compared with the rest of the room.', 'A close round. Delivery separated the top three.',
  'Solid performance, but others in the room took more risks that paid off.', 'The most complete performance I heard this round.',
  'Good work; the top of this room was simply very strong.',
];

/** Small repeatable pseudo-random number in [0, 1) from a string, so the sample data is the same on every load. */
const seeded = (key: string) => { let hash = 2166136261; for (let i = 0; i < key.length; i++) { hash ^= key.charCodeAt(i); hash = Math.imul(hash, 16777619); } return ((hash >>> 0) % 10000) / 10000; };
const pick = <T,>(list: T[], key: string) => list[Math.floor(seeded(key) * list.length)];

/** Sample ballots from the last five tournaments: three rounds per event for every student on the team. */
export const pastBallots: PastBallot[] = teamGrowth.flatMap(student => Object.entries(student.events).flatMap(([eventId, marksByMeet]) => marksByMeet.flatMap((average, meetIndex) => [1, 2, 3].map(round => {
  const key = `${student.name}|${eventId}|${meetIndex}|${round}`;
  const rating = Math.max(RATING_MIN, Math.min(50, Math.round(average * 5 + (seeded(key) - 0.5) * 5)));
  // Five section marks that add up to the rating.
  const marks = [0, 1, 2, 3, 4].map(index => Math.min(MARK_MAX, Math.floor(rating / 5) + (index < rating % 5 ? 1 : 0)));
  const shift = Math.floor(seeded(key + 'm') * 5); const rotated = [...marks.slice(shift), ...marks.slice(0, shift)];
  const limit = ballotEvents.find(event => event.id === eventId)?.time.max ?? 600;
  return {
    id: key, student: student.name, eventId, meet: growthMeets[meetIndex], meetOrder: meetIndex, date: meetDates[meetIndex], round,
    judge: pick(pastJudges, key + 'j'), rank: Math.max(1, Math.min(6, Math.round(1 + (9.4 - average) * 1.5 + (seeded(key + 'r') - 0.5) * 1.6))), of: 6, rating,
    timeSeconds: Math.round(limit - 15 - seeded(key + 't') * 75), marks: rotated,
    comments: `${pick(strengths, key + 's')} ${pick(nextSteps, key + 'n')}`, reason: pick(reasons, key + 'd'),
  };
}))));

const eventName = (id: string) => ballotEvents.find(event => event.id === id)?.name ?? id;
const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n > 3 ? 0 : n]}`;
const clock = (total: number) => `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
const initials = (name: string) => name.split(' ').map(part => part[0]).join('').slice(0, 2);

/**
 * Ballots from finished tournaments. A student sees only their own; a coach sees every student on the team.
 * `student` fixes the view to one person and removes the student filter.
 */
export function PastBallots({ student, team = 'Lincoln High' }: { student?: string; team?: string }) {
  const [who, setWho] = useState('all');
  const [meet, setMeet] = useState('all');
  const [eventId, setEventId] = useState('all');
  const [open, setOpen] = useState<string | null>(null);
  // The scope is applied first and never widened by the filters below.
  const allowed = useMemo(() => student ? pastBallots.filter(ballot => ballot.student === student) : pastBallots, [student]);
  const students = [...new Set(allowed.map(ballot => ballot.student))];
  const events = [...new Set(allowed.filter(ballot => who === 'all' || ballot.student === who).map(ballot => ballot.eventId))];
  const shown = allowed.filter(ballot => (who === 'all' || ballot.student === who) && (meet === 'all' || ballot.meet === meet) && (eventId === 'all' || ballot.eventId === eventId));
  const meets = [...new Set(shown.map(ballot => ballot.meetOrder))].sort((a, b) => b - a);
  const average = (pick: (ballot: PastBallot) => number) => shown.length ? (shown.reduce((sum, ballot) => sum + pick(ballot), 0) / shown.length).toFixed(1) : '—';

  return <div className="role-dashboard past-ballots">
    <section className="panel">
      <div className="panel-head"><div><h2>{student ? 'My past ballots' : `${team} past ballots`}</h2><p>Every ballot from finished tournaments this season</p></div>
        <Badge tone="info" icon={student ? 'lock' : 'users'}>{student ? 'Only you and your coach can see these' : `All ${students.length} students on your team`}</Badge></div>
      <div className="past-filters">
        {!student && <label><span>Student</span><select value={who} onChange={event => { setWho(event.target.value); setEventId('all'); }}><option value="all">All students</option>{students.map(name => <option key={name}>{name}</option>)}</select></label>}
        <label><span>Tournament</span><select value={meet} onChange={event => setMeet(event.target.value)}><option value="all">All tournaments</option>{[...growthMeets].reverse().map(name => <option key={name}>{name}</option>)}</select></label>
        <label><span>Event</span><select value={events.includes(eventId) ? eventId : 'all'} onChange={event => setEventId(event.target.value)}><option value="all">All events</option>{events.map(id => <option key={id} value={id}>{eventName(id)}</option>)}</select></label>
        <dl><div><dt>Ballots</dt><dd>{shown.length}</dd></div><div><dt>Avg. rating</dt><dd>{average(ballot => ballot.rating)}<small>/50</small></dd></div><div><dt>Avg. rank</dt><dd>{average(ballot => ballot.rank)}</dd></div></dl>
      </div>
      {shown.length === 0 ? <p className="team-ballots-empty">No ballots match those filters.</p> : meets.map(order => {
        const rows = shown.filter(ballot => ballot.meetOrder === order).sort((a, b) => a.student.localeCompare(b.student) || a.eventId.localeCompare(b.eventId) || a.round - b.round);
        return <div key={order} className="past-meet">
          <h3><span>{growthMeets[order]}</span><small>{meetDates[order]} · {rows.length} ballots</small></h3>
          <div className="team-ballot-list">{rows.map(ballot => {
            const event = ballotEvents.find(item => item.id === ballot.eventId);
            return <article key={ballot.id} className={open === ballot.id ? 'open' : ''}>
              <button onClick={() => setOpen(open === ballot.id ? null : ballot.id)} aria-expanded={open === ballot.id}>
                <span className="past-who">{!student && <Avatar initials={initials(ballot.student)} size="sm"/>}<span><strong>{student ? eventName(ballot.eventId) : ballot.student}</strong><small>{student ? `Round ${ballot.round}` : `${eventName(ballot.eventId)} · Round ${ballot.round}`}</small></span></span>
                <span><small>Judge</small><strong>{ballot.judge}</strong></span>
                <Badge tone={ballot.rank === 1 ? 'success' : 'neutral'}>{ordinal(ballot.rank)} of {ballot.of} · {ballot.rating}</Badge>
                <Icon name="chevron"/>
              </button>
              {open === ballot.id && <div className="team-ballot-detail">
                <div className="team-ballot-flags"><Badge tone="neutral" icon="clock">{clock(ballot.timeSeconds)}</Badge><Badge tone="neutral">Rating {ballot.rating} of 50</Badge></div>
                <div className="team-ballot-text"><small>Comments</small><p>{ballot.comments}</p></div>
                <div className="team-ballot-text"><small>Reason for decision</small><p>{ballot.reason}</p></div>
                <dl>{(event?.criteria ?? []).map((item, index) => <div key={item.name}><dt>{item.name}</dt><dd>{ballot.marks[index]}<small>/{MARK_MAX}</small></dd></div>)}</dl>
              </div>}
            </article>;
          })}</div>
        </div>;
      })}
    </section>
    <p className="past-note"><Icon name="info" size={14}/> {student ? 'You see your own ballots only. The tournament you are competing in now is added here once your coach releases your results.' : 'Students see only their own ballots here. The current tournament appears for them once you release results.'}</p>
  </div>;
}
