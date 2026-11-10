import { useState } from 'react';
import { Badge, Button, Icon, Progress } from './ui';
import { roundSpeakers, useStore, type Presence } from './store';
import { ballotEvents, RATING_BANDS, TIME_GRACE_SECONDS, type BallotEvent } from './ballots';

/** `marks` are Orator's optional 1–5 section marks; everything else is a field on the NSAA ballot. */
type SpeakerBallot = { marks: number[]; rating: number; minutes: string; seconds: string; comment: string; note: string; dq: string[] };

const MIN_COMMENT = 40;

const blank = (): SpeakerBallot => ({ marks: [0, 0, 0, 0, 0], rating: 0, minutes: '', seconds: '', comment: '', note: '', dq: [] });

const startingBallots: Record<string, SpeakerBallot> = {
  C1: { marks: [5, 4, 5, 4, 5], rating: 48, minutes: '9', seconds: '41', comment: 'Clear thesis and a memorable opening. Your sources were current and well attributed. Next step: vary your pace in the second point.', note: 'Green blazer. Poster about volunteering.', dq: [] },
  C2: { marks: [4, 4, 4, 3, 4], rating: 45, minutes: '10', seconds: '24', comment: 'Strong analysis of how apps hold attention. You ran a little over ten minutes, so consider trimming the third example.', note: 'Glasses. Phone-screen visual aid.', dq: [] },
  C3: { marks: [3, 4, 3, 3, 4], rating: 42, minutes: '8', seconds: '52', comment: 'Good structure and steady eye contact. Add more supporting material for the after-school claims.', note: 'Tall, navy suit. No visual aid.', dq: [] },
  C4: { ...blank(), marks: [4, 0, 0, 0, 0] },
  C5: blank(),
  C6: blank(),
};

const secondsOf = (ballot: SpeakerBallot) => ballot.minutes === '' && ballot.seconds === '' ? null : (Number(ballot.minutes) || 0) * 60 + (Number(ballot.seconds) || 0);
const clock = (total: number) => `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
const isScored = (ballot: SpeakerBallot) => ballot.rating > 0 && secondsOf(ballot) !== null && ballot.comment.trim().length >= MIN_COMMENT;
const bandOf = (rating: number) => RATING_BANDS.find(band => band.values.includes(rating))?.label ?? '';
const limitText = (event: BallotEvent) => event.time.min ? `${clock(event.time.min)}–${clock(event.time.max)}` : `${clock(event.time.max)} maximum`;

/** How a recorded time compares with the event's limit, following the NSAA 30-second rule. */
function timeStatus(seconds: number | null, event: BallotEvent) {
  if (seconds === null) return { kind: 'missing' as const, text: 'Required', penalty: false };
  const over = seconds - event.time.max;
  const under = event.time.min ? event.time.min - seconds : 0;
  if (over > TIME_GRACE_SECONDS) return { kind: 'penalty' as const, text: `Over by ${clock(over)} · lowered one rank`, penalty: true };
  if (under > TIME_GRACE_SECONDS) return { kind: 'penalty' as const, text: `Under by ${clock(under)} · lowered one rank`, penalty: true };
  if (over > 0) return { kind: 'grace' as const, text: `Over by ${clock(over)} · within the 30-second grace`, penalty: false };
  if (under > 0) return { kind: 'grace' as const, text: `Under by ${clock(under)} · within the 30-second grace`, penalty: false };
  return { kind: 'ok' as const, text: 'Within time', penalty: false };
}

/** Present / no-show control a judge uses when a speaker walks in. Shared with the director and coach views. */
export function SpeakerCheckIn({ code, compact = false }: { code: string; compact?: boolean }) {
  const { speakerPresence, setSpeakerPresence } = useStore();
  const value = speakerPresence[code];
  const set = (next: Presence) => setSpeakerPresence(code, value === next ? undefined : next);
  return <div className={`checkin-toggle ${compact ? 'compact' : ''}`} role="group" aria-label={`Check in ${code}`}>
    <button className={value === 'present' ? 'on present' : ''} aria-pressed={value === 'present'} onClick={() => set('present')}><Icon name="check" size={14}/> Present</button>
    <button className={value === 'absent' ? 'on absent' : ''} aria-pressed={value === 'absent'} onClick={() => set('absent')}><Icon name="close" size={14}/> No-show</button>
  </div>;
}

export function JudgeBallot() {
  const { speakerPresence } = useStore();
  const [eventId, setEventId] = useState('info');
  const [tab, setTab] = useState<'score' | 'rank'>('score');
  const [current, setCurrent] = useState('C4');
  const [open, setOpen] = useState(0);
  const [ballots, setBallots] = useState(startingBallots);
  const [order, setOrder] = useState(roundSpeakers.map(speaker => speaker.code));
  const [dragged, setDragged] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [experience, setExperience] = useState('');

  const event = ballotEvents.find(item => item.id === eventId) || ballotEvents[0];
  const speaker = roundSpeakers.find(item => item.code === current)!;
  const ballot = ballots[current];
  const update = (patch: Partial<SpeakerBallot>) => setBallots(all => ({ ...all, [current]: { ...all[current], ...patch } }));
  const absent = (code: string) => speakerPresence[code] === 'absent';

  const ranked = order.filter(code => !absent(code));
  const noShows = order.filter(absent);
  const unfinished = ranked.filter(code => !isScored(ballots[code]));
  const notCheckedIn = ranked.filter(code => !speakerPresence[code]);
  // A speaker may not be ranked above someone the judge gave a higher rating.
  const outOfOrder = new Set<string>();
  ranked.forEach((code, index) => {
    if (index > 0 && ballots[code].rating > ballots[ranked[index - 1]].rating) { outOfOrder.add(code); outOfOrder.add(ranked[index - 1]); }
  });
  const canSubmit = unfinished.length === 0 && notCheckedIn.length === 0 && outOfOrder.size === 0;

  const move = (code: string, direction: -1 | 1) => {
    const index = ranked.indexOf(code); const target = index + direction;
    if (target < 0 || target >= ranked.length) return;
    const next = [...ranked]; [next[index], next[target]] = [next[target], next[index]];
    setOrder([...next, ...noShows]);
  };
  const dropOn = (target: string) => {
    if (!dragged || dragged === target) return;
    const next = ranked.filter(code => code !== dragged);
    next.splice(ranked.indexOf(target), 0, dragged);
    setOrder([...next, ...noShows]); setDragged(null);
  };
  const sortByRating = () => setOrder([...[...ranked].sort((a, b) => ballots[b].rating - ballots[a].rating), ...noShows]);

  const time = timeStatus(secondsOf(ballot), event);
  const commentProgress = Math.min(100, Math.round((ballot.comment.trim().length / MIN_COMMENT) * 100));
  const speakerIndex = roundSpeakers.findIndex(item => item.code === current);
  const goTo = (code: string) => { setCurrent(code); setOpen(0); };
  const flagsFor = (code: string) => { const data = ballots[code]; return { penalty: timeStatus(secondsOf(data), event).penalty, dq: data.dq.length > 0 }; };

  if (submitted) return <div className="jb jb-done">
    <span className="success-icon"><Icon name="check" size={26}/></span>
    <h2>Round 2 ballot submitted</h2>
    <p>Ranks, ratings, times, and your reasons for decision are filed with the tab room. Your private notes stay with you.</p>
    <ol className="jb-final">{ranked.map((code, index) => { const flags = flagsFor(code); return <li key={code}><strong>{index + 1}</strong><span>{roundSpeakers.find(item => item.code === code)!.name}{flags.penalty && <em> · lowered one rank for time</em>}{flags.dq && <em> · disqualification reported</em>}</span><small>{ballots[code].rating} · {clock(secondsOf(ballots[code]) || 0)}</small></li>; })}</ol>
    <section className="jb-card jb-experience">
      <div className="field-label"><span>How is this tournament running?</span><small>Optional · goes to the director</small></div>
      {feedbackSent ? <p className="jb-sent"><Icon name="check" size={15}/> Thanks. Your feedback was sent to the tournament director.</p> : <>
        <div className="jb-chips">{['Running on time', 'Rooms were easy to find', 'Schedule was tight', 'Instructions were unclear'].map(option => <button key={option} className={experience.includes(option) ? 'on' : ''} onClick={() => setExperience(text => text.includes(option) ? text.replace(`${option}. `, '') : `${text}${option}. `)}>{option}</button>)}</div>
        <textarea value={experience} onChange={change => setExperience(change.target.value)} placeholder="Anything the director should change for next time?"/>
        <Button variant="secondary" icon="send" disabled={!experience.trim()} onClick={() => setFeedbackSent(true)}>Send feedback</Button>
      </>}
    </section>
  </div>;

  return <div className="jb">
    <div className="jb-top">
      <div><span className="jb-badges"><Badge tone="info">Round 2</Badge><Badge tone="success" icon="check">Official NSAA ballot</Badge></span><strong>Varsity {event.name}</strong><span>Room 214 · 9:30 AM · 6 speakers · {limitText(event)}</span></div>
      <label><span>Event</span><select value={eventId} onChange={change => { setEventId(change.target.value); setOpen(0); }}>{ballotEvents.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    </div>
    <div className="segmented jb-tabs"><button className={tab === 'score' ? 'active' : ''} onClick={() => setTab('score')}>1 · Score speakers</button><button className={tab === 'rank' ? 'active' : ''} onClick={() => setTab('rank')}>2 · Rank the round</button></div>

    {tab === 'score' ? <>
      <div className="jb-strip" role="tablist" aria-label="Speakers in this round">{roundSpeakers.map((item, index) => {
        const data = ballots[item.code];
        const state = absent(item.code) ? 'absent' : isScored(data) ? 'done' : data.rating || data.comment || data.marks.some(Boolean) ? 'draft' : 'empty';
        return <button key={item.code} role="tab" aria-selected={current === item.code} className={`${current === item.code ? 'active' : ''} ${state}`} onClick={() => goTo(item.code)}>
          <small>{index + 1}</small><strong>{item.code}</strong><span>{state === 'done' ? `Rated ${data.rating}` : state === 'absent' ? 'No-show' : state === 'draft' ? 'Draft' : 'Waiting'}</span>
        </button>;
      })}</div>

      <div className="jb-speaker">
        <div><span className="eyebrow">SPEAKER {speakerIndex + 1} OF 6 · {speaker.code}</span><h2>{speaker.name}</h2><p>{speaker.title} · {speaker.school}</p></div>
        <SpeakerCheckIn code={current}/>
      </div>

      {absent(current) ? <div className="jb-absent"><Icon name="info"/><span><strong>{speaker.name} is marked as a no-show.</strong><small>They are left out of your ranking and the director is notified. Tap “No-show” again to undo.</small></span></div> : <div className="jb-grid">
        <section className="criteria-card jb-criteria">
          <div className="card-label"><span>Criteria for evaluation</span><small>Section marks are optional</small></div>
          {event.criteria.map((item, index) => <div className={`criterion ${open === index ? 'open' : ''}`} key={item.name}>
            <button className="criterion-trigger" onClick={() => setOpen(open === index ? -1 : index)}>
              <span className="criterion-name"><span className={`status-dot ${ballot.marks[index] ? 'complete' : ''}`}/><span><strong>{item.name}</strong><small>{ballot.marks[index] ? `Marked ${ballot.marks[index]} of 5` : `${item.questions.length} question${item.questions.length > 1 ? 's' : ''} to consider`}</small></span></span>
              <Icon name="chevron"/>
            </button>
            {open === index && <div className="criterion-body"><ul className="jb-questions">{item.questions.map(question => <li key={question}>{question}</li>)}</ul>
              <div className="jb-mark"><span>Section mark</span><div className="rating" aria-label={`${item.name} mark from 1 to 5`}>{[1, 2, 3, 4, 5].map(value =>
                <button key={value} className={value === ballot.marks[index] ? 'selected' : ''} aria-label={`Mark ${value}`} onClick={() => update({ marks: ballot.marks.map((old, i) => i === index ? (old === value ? 0 : value) : old) })}>{value}</button>)}</div></div>
            </div>}
          </div>)}
          <p className="jb-extra"><Icon name="info" size={14}/> Section marks are an Orator addition that powers student growth charts. They are not part of the NSAA ballot and never affect rank.</p>
        </section>

        <div className="jb-side">
          <section className="jb-card">
            <div className="field-label"><span>Rating</span><small>{ballot.rating ? `${ballot.rating} · ${bandOf(ballot.rating)}` : 'Required · quality of the speech'}</small></div>
            <div className="jb-rating">{RATING_BANDS.map(band => <div key={band.label}><small>{band.label}</small><div>{band.values.map(value => <button key={value} className={ballot.rating === value ? 'selected' : ''} aria-label={`Rating ${value}`} aria-pressed={ballot.rating === value} onClick={() => update({ rating: value })}>{value}</button>)}</div></div>)}</div>
          </section>

          <section className="jb-card">
            <div className="field-label"><span>Time</span><small>{limitText(event)}</small></div>
            <div className={`jb-time ${time.kind}`}>
              <label><input inputMode="numeric" maxLength={2} value={ballot.minutes} onChange={change => update({ minutes: change.target.value.replace(/\D/g, '') })} placeholder="0" aria-label="Minutes"/><span>min</span></label>
              <b>:</b>
              <label><input inputMode="numeric" maxLength={2} value={ballot.seconds} onChange={change => update({ seconds: change.target.value.replace(/\D/g, '').replace(/^([6-9])(\d)$/, '5$2') })} placeholder="00" aria-label="Seconds"/><span>sec</span></label>
              <Badge tone={time.kind === 'penalty' ? 'danger' : time.kind === 'grace' ? 'warning' : time.kind === 'ok' ? 'success' : 'neutral'} icon={time.kind === 'ok' ? 'check' : time.kind === 'missing' ? undefined : 'clock'}>{time.text}</Badge>
            </div>
            <p className="jb-rule">{event.time.min ? 'Under- or overtime' : 'Overtime'} exceeding 30 seconds lowers this entry one rank. {event.time.note ?? 'No minimum.'}</p>
          </section>

          <section className="jb-card">
            <div className="field-label"><span>Reason for decision</span><small>{ballot.comment.trim().length} / {MIN_COMMENT} minimum</small></div>
            <textarea value={ballot.comment} onChange={change => update({ comment: change.target.value })} placeholder="Explain your rank and rating. What did this speaker do well? What is one clear next step?"/>
            <div className={`jb-meter ${commentProgress >= 100 ? 'ready' : ''}`}><Progress value={commentProgress}/><span>{commentProgress >= 100 ? 'Feedback minimum reached' : 'Add specific feedback the speaker can act on'}</span></div>
          </section>

          <details className="jb-card jb-dq" open={ballot.dq.length > 0}>
            <summary><span>Disqualification</span>{ballot.dq.length > 0 ? <Badge tone="danger" icon="warning">{ballot.dq.length} reported</Badge> : <small>None reported</small>}</summary>
            {event.disqualifications.length === 0 ? <p>The NSAA ballot lists no specific disqualification grounds for {event.name}. Report a concern to the tab room from Help.</p> : <>
              <p>This entry is disqualified for:</p>
              {event.disqualifications.map(reason => <label key={reason}><input type="checkbox" checked={ballot.dq.includes(reason)} onChange={() => update({ dq: ballot.dq.includes(reason) ? ballot.dq.filter(item => item !== reason) : [...ballot.dq, reason] })}/><span>{reason}</span></label>)}
              <p>The tab room confirms every disqualification before results change.</p>
            </>}
          </details>

          <section className="jb-card jb-private">
            <div className="field-label"><span><Icon name="lock" size={14}/> Private notes</span><small>Only you can see these</small></div>
            <textarea value={ballot.note} onChange={change => update({ note: change.target.value })} placeholder="Jot what helps you remember this speaker: outfit, topic, a standout moment."/>
            <p>Never shared with students, coaches, or the director. They follow you to the ranking step.</p>
          </section>
        </div>
      </div>}

      <div className="jb-nav">
        <Button variant="secondary" disabled={speakerIndex === 0} onClick={() => goTo(roundSpeakers[speakerIndex - 1].code)}>Previous</Button>
        <span><Icon name="check" size={15}/> Autosaved just now</span>
        {speakerIndex < roundSpeakers.length - 1 ? <Button icon="arrow" onClick={() => goTo(roundSpeakers[speakerIndex + 1].code)}>Next speaker</Button> : <Button icon="arrow" onClick={() => setTab('rank')}>Rank the round</Button>}
      </div>
    </> : <>
      <div className="jb-rank-head"><div><h2>Rank the round</h2><p>Drag speakers into order, or use the arrows. There may be no ties in rank.</p></div><Button variant="secondary" icon="growth" onClick={sortByRating}>Sort by rating</Button></div>
      <div className="jb-rank-list">
        <div className="jb-rank-row jb-rank-labels"><span/><span>Rank</span><span>Speaker</span><span>Time</span><span>Rating</span><span/></div>
        {ranked.map((code, index) => {
          const item = roundSpeakers.find(entry => entry.code === code)!; const data = ballots[code]; const seconds = secondsOf(data); const flags = flagsFor(code);
          return <div key={code} className={`jb-rank-row ${outOfOrder.has(code) ? 'conflict' : ''} ${dragged === code ? 'dragging' : ''}`} draggable onDragStart={() => setDragged(code)} onDragEnd={() => setDragged(null)} onDragOver={drag => drag.preventDefault()} onDrop={() => dropOn(code)}>
            <span className="jb-grip"><Icon name="drag"/></span>
            <span className="jb-rank-number">{index + 1}</span>
            <span className="jb-rank-name"><strong>{item.name}{flags.penalty && <Badge tone="danger" icon="clock">Lowered one rank</Badge>}{flags.dq && <Badge tone="danger" icon="warning">DQ reported</Badge>}</strong><small>{code} · {item.school}{data.note ? ` · ${data.note}` : ''}</small></span>
            <span className={flags.penalty ? 'jb-over' : ''}>{seconds === null ? '—' : clock(seconds)}</span>
            <span><strong>{data.rating || '—'}</strong>{data.rating > 0 && <small> {bandOf(data.rating)}</small>}</span>
            <span className="jb-arrows"><button aria-label={`Move ${item.name} up`} disabled={index === 0} onClick={() => move(code, -1)}>↑</button><button aria-label={`Move ${item.name} down`} disabled={index === ranked.length - 1} onClick={() => move(code, 1)}>↓</button></span>
          </div>;
        })}
        {noShows.map(code => <div key={code} className="jb-rank-row no-show"><span/><span className="jb-rank-number">–</span><span className="jb-rank-name"><strong>{roundSpeakers.find(entry => entry.code === code)!.name}</strong><small>{code} · No-show, not ranked</small></span><span>—</span><span>—</span><span/></div>)}
      </div>

      <div className="jb-checks">
        <div className={outOfOrder.size ? 'bad' : 'ok'}><Icon name={outOfOrder.size ? 'warning' : 'check'}/><span><strong>{outOfOrder.size ? 'Ranks don’t match ratings' : 'Ranks follow ratings'}</strong><small>{outOfOrder.size ? 'A speaker with a lower rating is ranked above one with a higher rating. Reorder the highlighted rows or adjust their ratings.' : 'No speaker is ranked above someone with a higher rating.'}</small></span></div>
        <div className={unfinished.length ? 'bad' : 'ok'}><Icon name={unfinished.length ? 'warning' : 'check'}/><span><strong>{unfinished.length ? `${unfinished.length} speaker${unfinished.length > 1 ? 's' : ''} still need scoring` : 'Every speaker is scored'}</strong><small>{unfinished.length ? `${unfinished.join(', ')} need a rating, a time, and a reason for decision.` : 'Ratings, times, and reasons for decision are complete.'}</small></span>{unfinished.length > 0 && <button onClick={() => { goTo(unfinished[0]); setTab('score'); }}>Finish {unfinished[0]}</button>}</div>
        <div className={notCheckedIn.length ? 'bad' : 'ok'}><Icon name={notCheckedIn.length ? 'warning' : 'check'}/><span><strong>{notCheckedIn.length ? `${notCheckedIn.length} speaker${notCheckedIn.length > 1 ? 's' : ''} not checked in` : 'Attendance recorded'}</strong><small>{notCheckedIn.length ? `Mark ${notCheckedIn.join(', ')} as present or no-show.` : 'Everyone is marked present or no-show.'}</small></span>{notCheckedIn.length > 0 && <button onClick={() => { goTo(notCheckedIn[0]); setTab('score'); }}>Check in {notCheckedIn[0]}</button>}</div>
      </div>
      <p className="jb-rule jb-rank-rule"><Icon name="info" size={14}/> Rank speakers on performance. Time penalties are recorded on the ballot and the tab room lowers those entries one rank.</p>

      <div className="jb-nav"><Button variant="secondary" onClick={() => setTab('score')}>Back to scoring</Button><span><Icon name="check" size={15}/> Autosaved just now</span><Button disabled={!canSubmit} onClick={() => setSubmitted(true)}>Submit ballot</Button></div>
    </>}
  </div>;
}
