import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Icon, Progress } from './ui';
import { roundSpeakers, useStore, type Presence } from './store';
import { entryLoadByName, loadLabel } from './tournament';
import { ballotEvents, MARK_MAX, RATING_BANDS, RATING_MIN, TIME_GRACE_SECONDS, type BallotEvent } from './ballots';
import { useAuth } from './auth';
import { loadBallot, saveBallot, type BallotKey, type EntryInput } from './ballotApi';

/** `marks` are Orator's required 1–10 section marks; everything else is a field on the NSAA ballot. */
type SpeakerBallot = { marks: number[]; minutes: string; seconds: string; general: string; comment: string; note: string; dq: string[] };

const MIN_COMMENT = 40;

const blank = (): SpeakerBallot => ({ marks: [0, 0, 0, 0, 0], minutes: '', seconds: '', general: '', comment: '', note: '', dq: [] });

const startingBallots: Record<string, SpeakerBallot> = {
  C1: { marks: [10, 9, 10, 8, 9], minutes: '9', seconds: '41', general: 'Memorable opening story. Sources were current and well attributed. Vary your pace in the second point.', comment: 'Clearest thesis in the round, with the strongest supporting material and the most polished delivery.', note: 'Green blazer. Poster about volunteering.', dq: [] },
  C2: { marks: [9, 8, 8, 7, 8], minutes: '10', seconds: '24', general: 'You ran a little over ten minutes, so consider trimming the third example.', comment: 'Strong analysis of how apps hold attention, but less polished in language than the top speaker.', note: 'Glasses. Phone-screen visual aid.', dq: [] },
  C3: { marks: [7, 8, 6, 7, 8], minutes: '8', seconds: '52', general: 'Steady eye contact throughout. Add more supporting material for the after-school claims.', comment: 'Good structure, but the content needed more evidence to compete with the top of the round.', note: 'Tall, navy suit. No visual aid.', dq: [] },
  C4: { ...blank(), marks: [9, 0, 0, 0, 0] },
  C5: blank(),
  C6: blank(),
};

const secondsOf = (ballot: SpeakerBallot) => ballot.minutes === '' && ballot.seconds === '' ? null : (Number(ballot.minutes) || 0) * 60 + (Number(ballot.seconds) || 0);
const clock = (total: number) => `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
const markTotal = (ballot: SpeakerBallot) => ballot.marks.reduce((sum, mark) => sum + mark, 0);
/** The rating is the total of the five section marks; the NSAA scale stops at 35, so lower totals are recorded as 35. Zero until every section is marked. */
const ratingOf = (ballot: SpeakerBallot) => ballot.marks.every(Boolean) ? Math.max(RATING_MIN, markTotal(ballot)) : 0;
const feedbackLength = (ballot: SpeakerBallot) => ballot.general.trim().length + ballot.comment.trim().length;
const isScored = (ballot: SpeakerBallot) => ballot.marks.every(Boolean) && secondsOf(ballot) !== null && feedbackLength(ballot) >= MIN_COMMENT;
const THIS_ROUND: BallotKey = { tournament: 'Gothenburg Invitational', round: 2, room: 'Room 214' };
const emptyRound = () => Object.fromEntries(roundSpeakers.map(item => [item.code, blank()])) as Record<string, SpeakerBallot>;
const bandOf = (rating: number) => RATING_BANDS.find(band => band.values.includes(rating))?.label ?? '';
const maxFor = (event: BallotEvent, classA: boolean) => classA && event.time.classAMax ? event.time.classAMax : event.time.max;
const limitText = (event: BallotEvent, classA: boolean) => event.time.min ? `${clock(event.time.min)}–${clock(event.time.max)}` : `${clock(maxFor(event, classA))} maximum`;

/** How a recorded time compares with the event's limit, following the NSAA 30-second rule. */
function timeStatus(seconds: number | null, event: BallotEvent, classA: boolean) {
  if (seconds === null) return { kind: 'missing' as const, text: 'Required', penalty: false };
  const over = seconds - maxFor(event, classA);
  const under = event.time.min ? event.time.min - seconds : 0;
  if (over > TIME_GRACE_SECONDS) return { kind: 'penalty' as const, text: `Over by ${clock(over)} · lowered one rank`, penalty: true };
  if (under > TIME_GRACE_SECONDS) return { kind: 'penalty' as const, text: `Under by ${clock(under)} · lowered one rank`, penalty: true };
  if (over > 0) return { kind: 'grace' as const, text: `Over by ${clock(over)} · within the 30-second grace`, penalty: false };
  if (under > 0) return { kind: 'grace' as const, text: `Under by ${clock(under)} · within the 30-second grace`, penalty: false };
  return { kind: 'ok' as const, text: 'Within time', penalty: false };
}

/** Present / no-show control a judge uses when a speaker walks in. Shared with the director and coach views. */
export function SpeakerCheckIn({ code, compact = false, onChange }: { code: string; compact?: boolean; onChange?: () => void }) {
  const { speakerPresence, setSpeakerPresence } = useStore();
  const value = speakerPresence[code];
  const set = (next: Presence) => { onChange?.(); setSpeakerPresence(code, value === next ? undefined : next); };
  return <div className={`checkin-toggle ${compact ? 'compact' : ''}`} role="group" aria-label={`Check in ${code}`}>
    <button className={value === 'present' ? 'on present' : ''} aria-pressed={value === 'present'} onClick={() => set('present')}><Icon name="check" size={14}/> Present</button>
    <button className={value === 'absent' ? 'on absent' : ''} aria-pressed={value === 'absent'} onClick={() => set('absent')}><Icon name="close" size={14}/> No-show</button>
  </div>;
}

export function JudgeBallot() {
  const { speakerPresence, setSpeakerPresence, entries } = useStore();
  const { profile } = useAuth();
  const loadOf = (name: string) => loadLabel(entryLoadByName(entries, name));
  /** Signed-in judges save to the database; the demo keeps everything in the browser. */
  const remote = profile !== null;
  const [eventId, setEventId] = useState('info');
  const [classA, setClassA] = useState(false);
  const [ballotId, setBallotId] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>(remote ? 'loading' : 'ready');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [saveError, setSaveError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dirty = useRef(false);
  const [tab, setTab] = useState<'score' | 'rank'>('score');
  const [current, setCurrent] = useState(remote ? 'C1' : 'C4');
  const [open, setOpen] = useState(0);
  const [ballots, setBallots] = useState(remote ? emptyRound : startingBallots);
  const [order, setOrder] = useState(roundSpeakers.map(speaker => speaker.code));
  const [dragged, setDragged] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [experience, setExperience] = useState('');

  const event = ballotEvents.find(item => item.id === eventId) || ballotEvents[0];
  const speaker = roundSpeakers.find(item => item.code === current)!;
  const ballot = ballots[current];
  const update = (patch: Partial<SpeakerBallot>) => { dirty.current = true; setBallots(all => ({ ...all, [current]: { ...all[current], ...patch } })); };
  const absent = (code: string) => speakerPresence[code] === 'absent';

  const ranked = order.filter(code => !absent(code));
  const noShows = order.filter(absent);
  const unfinished = ranked.filter(code => !isScored(ballots[code]));
  const notCheckedIn = ranked.filter(code => !speakerPresence[code]);
  // A speaker may not be ranked above someone the judge gave a higher rating.
  const outOfOrder = new Set<string>();
  ranked.forEach((code, index) => {
    if (index > 0 && ratingOf(ballots[code]) > ratingOf(ballots[ranked[index - 1]])) { outOfOrder.add(code); outOfOrder.add(ranked[index - 1]); }
  });
  const canSubmit = unfinished.length === 0 && notCheckedIn.length === 0 && outOfOrder.size === 0;

  const move = (code: string, direction: -1 | 1) => {
    const index = ranked.indexOf(code); const target = index + direction;
    if (target < 0 || target >= ranked.length) return;
    const next = [...ranked]; [next[index], next[target]] = [next[target], next[index]];
    dirty.current = true; setOrder([...next, ...noShows]);
  };
  const dropOn = (target: string) => {
    if (!dragged || dragged === target) return;
    const next = ranked.filter(code => code !== dragged);
    next.splice(ranked.indexOf(target), 0, dragged);
    dirty.current = true; setOrder([...next, ...noShows]); setDragged(null);
  };
  const sortByRating = () => { dirty.current = true; setOrder([...[...ranked].sort((a, b) => ratingOf(ballots[b]) - ratingOf(ballots[a])), ...noShows]); };

  const time = timeStatus(secondsOf(ballot), event, classA);
  const commentProgress = Math.min(100, Math.round((feedbackLength(ballot) / MIN_COMMENT) * 100));
  const rating = ratingOf(ballot);
  const speakerIndex = roundSpeakers.findIndex(item => item.code === current);
  const goTo = (code: string) => { setCurrent(code); setOpen(0); };
  const flagsFor = (code: string) => { const data = ballots[code]; return { penalty: timeStatus(secondsOf(data), event, classA).penalty, dq: data.dq.length > 0 }; };

  const toEntries = (): EntryInput[] => roundSpeakers.map(item => {
    const data = ballots[item.code]; const presence = speakerPresence[item.code];
    const place = ranked.indexOf(item.code);
    return {
      code: item.code, name: item.name, school: item.school, present: presence ? presence === 'present' : null,
      rank: place >= 0 ? place + 1 : null, rating: ratingOf(data) || null, timeSeconds: secondsOf(data), timePenalty: flagsFor(item.code).penalty,
      marks: data.marks, comments: data.general, reason: data.comment, disqualifications: data.dq, note: data.note,
    };
  });

  // Load the judge's saved ballot for this round, if they have one.
  useEffect(() => {
    if (!remote) return;
    let active = true;
    loadBallot(THIS_ROUND).then(saved => {
      if (!active) return;
      if (saved) {
        setBallotId(saved.id); setEventId(saved.eventId); setClassA(saved.classA); setSubmitted(saved.status === 'submitted');
        const next = emptyRound();
        saved.entries.forEach(entry => {
          if (!next[entry.code]) return;
          next[entry.code] = {
            marks: [0, 1, 2, 3, 4].map(index => entry.marks[index] || 0),
            minutes: entry.timeSeconds === null ? '' : String(Math.floor(entry.timeSeconds / 60)), seconds: entry.timeSeconds === null ? '' : String(entry.timeSeconds % 60).padStart(2, '0'),
            general: entry.comments, comment: entry.reason, note: entry.note, dq: entry.disqualifications,
          };
          setSpeakerPresence(entry.code, entry.present === null ? undefined : entry.present ? 'present' : 'absent');
        });
        setBallots(next);
        const byRank = [...saved.entries].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).map(entry => entry.code).filter(code => next[code]);
        setOrder([...byRank, ...roundSpeakers.map(item => item.code).filter(code => !byRank.includes(code))]);
      } else {
        roundSpeakers.forEach(item => setSpeakerPresence(item.code, undefined));
      }
      setLoadState('ready');
    }).catch(() => active && setLoadState('failed'));
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote]);

  // Autosave the draft shortly after the judge stops typing.
  useEffect(() => {
    if (!remote || loadState !== 'ready' || submitted || submitting || !dirty.current) return;
    const timer = setTimeout(async () => {
      dirty.current = false; setSaveState('saving');
      try { setBallotId(await saveBallot(THIS_ROUND, ballotId, eventId, classA, toEntries(), false)); setSaveState('saved'); setSaveError(''); }
      catch (caught) { dirty.current = true; setSaveState('failed'); setSaveError(caught instanceof Error ? caught.message : 'Could not save.'); }
    }, 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ballots, order, eventId, classA, speakerPresence, loadState, submitted, submitting]);

  const submit = async () => {
    if (!remote) { setSubmitted(true); return; }
    setSubmitting(true); setSaveError('');
    try { setBallotId(await saveBallot(THIS_ROUND, ballotId, eventId, classA, toEntries(), true)); dirty.current = false; setSubmitted(true); }
    catch (caught) { setSaveState('failed'); setSaveError(caught instanceof Error ? caught.message : 'Could not submit the ballot.'); }
    finally { setSubmitting(false); }
  };
  const saveLine = !remote ? <span><Icon name="check" size={15}/> Autosaved just now</span>
    : saveState === 'failed' ? <span className="jb-save-failed" role="alert"><Icon name="warning" size={15}/> Not saved: {saveError}</span>
    : saveState === 'saving' ? <span className="jb-saving">Saving…</span>
    : <span><Icon name="check" size={15}/> {saveState === 'saved' ? 'Draft saved to your account' : 'Changes save automatically'}</span>;

  if (loadState === 'loading') return <div className="jb jb-loading"><span className="spinner"/><p>Loading your ballot…</p></div>;
  if (loadState === 'failed') return <div className="jb jb-loading"><span className="state-icon"><Icon name="warning"/></span><p>We couldn’t load your ballot. Check your connection and reopen it.</p></div>;

  if (submitted) return <div className="jb jb-done">
    <span className="success-icon"><Icon name="check" size={26}/></span>
    <h2>Round 2 ballot submitted</h2>
    <p>Ranks, ratings, times, comments, and your reasons for decision are filed with the tab room{remote ? ' and saved to your account. The ballot is now locked' : ''}. Your private notes stay with you.</p>
    <ol className="jb-final">{ranked.map((code, index) => { const flags = flagsFor(code); return <li key={code}><strong>{index + 1}</strong><span>{roundSpeakers.find(item => item.code === code)!.name}{flags.penalty && <em> · lowered one rank for time</em>}{flags.dq && <em> · disqualification reported</em>}</span><small>{ratingOf(ballots[code])} · {clock(secondsOf(ballots[code]) || 0)}</small></li>; })}</ol>
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
      <div><span className="jb-badges"><Badge tone="info">Round 2</Badge><Badge tone="success" icon="check">Official NSAA ballot</Badge></span><strong>Varsity {event.name}</strong><span>Room 214 · 9:30 AM · 6 speakers · {limitText(event, classA)}</span></div>
      <div className="jb-selects">{event.time.classAMax && <label><span>School class</span><select aria-label="School class" value={classA ? 'a' : 'other'} onChange={change => { dirty.current = true; setClassA(change.target.value === 'a'); }}><option value="other">Classes B–D · {clock(event.time.max)}</option><option value="a">Class A · {clock(event.time.classAMax)}</option></select></label>}
      <label><span>Event</span><select aria-label="Event" value={eventId} onChange={change => { dirty.current = true; setEventId(change.target.value); setOpen(0); }}>{ballotEvents.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
    </div>
    <div className="segmented jb-tabs"><button className={tab === 'score' ? 'active' : ''} onClick={() => setTab('score')}>1 · Score speakers</button><button className={tab === 'rank' ? 'active' : ''} onClick={() => setTab('rank')}>2 · Rank the round</button></div>

    {tab === 'score' ? <>
      <div className="jb-strip" role="tablist" aria-label="Speakers in this round">{roundSpeakers.map((item, index) => {
        const data = ballots[item.code];
        const state = absent(item.code) ? 'absent' : isScored(data) ? 'done' : data.general || data.comment || data.marks.some(Boolean) ? 'draft' : 'empty';
        return <button key={item.code} role="tab" aria-selected={current === item.code} className={`${current === item.code ? 'active' : ''} ${state}`} onClick={() => goTo(item.code)}>
          <small>{index + 1}{loadOf(item.name) ? ` · ${entryLoadByName(entries, item.name)}×` : ''}</small><strong>{item.code}</strong><span>{state === 'done' ? `Rated ${ratingOf(data)}` : state === 'absent' ? 'No-show' : state === 'draft' ? 'Draft' : 'Waiting'}</span>
        </button>;
      })}</div>

      <div className="jb-speaker">
        <div><span className="eyebrow">SPEAKER {speakerIndex + 1} OF 6 · {speaker.code}</span><h2>{speaker.name}</h2><p>{speaker.title} · {speaker.school}</p>{loadOf(speaker.name) && <p className="jb-load"><Badge tone="info" icon="users">{loadOf(speaker.name)}</Badge> In more than one room this round. They may arrive late or need to leave early.</p>}</div>
        <SpeakerCheckIn code={current} onChange={() => { dirty.current = true; }}/>
      </div>

      {absent(current) ? <div className="jb-absent"><Icon name="info"/><span><strong>{speaker.name} is marked as a no-show.</strong><small>They are left out of your ranking and the director is notified. Tap “No-show” again to undo.</small></span></div> : <div className="jb-grid">
        <section className="criteria-card jb-criteria">
          <div className="card-label"><span>Criteria for evaluation</span><small>{ballot.marks.filter(Boolean).length} of {event.criteria.length} sections marked · required</small></div>
          {event.criteria.map((item, index) => <div className={`criterion ${open === index ? 'open' : ''}`} key={item.name}>
            <button className="criterion-trigger" onClick={() => setOpen(open === index ? -1 : index)}>
              <span className="criterion-name"><span className={`status-dot ${ballot.marks[index] ? 'complete' : ''}`}/><span><strong>{item.name}</strong><small>{ballot.marks[index] ? `Marked ${ballot.marks[index]} of ${MARK_MAX}` : `${item.questions.length} question${item.questions.length > 1 ? 's' : ''} to consider`}</small></span></span>
              <Icon name="chevron"/>
            </button>
            {open === index && <div className="criterion-body"><ul className="jb-questions">{item.questions.map(question => <li key={question}>{question}</li>)}</ul>
              <div className="jb-mark"><span>Section mark</span><div className="rating rating-10" aria-label={`${item.name} mark from 1 to ${MARK_MAX}`}>{Array.from({ length: MARK_MAX }, (_, i) => i + 1).map(value =>
                <button key={value} className={value === ballot.marks[index] ? 'selected' : ''} aria-label={`Mark ${value}`} onClick={() => { update({ marks: ballot.marks.map((old, i) => i === index ? value : old) }); const next = ballot.marks.findIndex((old, i) => i > index && !old); if (next >= 0) setOpen(next); }}>{value}</button>)}</div></div>
            </div>}
          </div>)}
          <p className="jb-extra"><Icon name="info" size={14}/> Every section needs a mark from 1 to {MARK_MAX}. The five marks add up to the speaker’s rating out of 50.</p>
        </section>

        <div className="jb-side">
          <section className="jb-card">
            <div className="field-label"><span>Comments</span><small>Strengths and suggestions for {speaker.name.split(' ')[0]}</small></div>
            <textarea className="jb-general" value={ballot.general} onChange={change => update({ general: change.target.value })} placeholder="General comments on the performance. What worked? What should the speaker work on?"/>
          </section>

          <section className="jb-card">
            <div className="field-label"><span>Reason for decision</span><small>Why this rank and rating</small></div>
            <textarea value={ballot.comment} onChange={change => update({ comment: change.target.value })} placeholder="Explain this speaker’s rank compared with the others in the round."/>
            <div className={`jb-meter ${commentProgress >= 100 ? 'ready' : ''}`}><Progress value={commentProgress}/><span>{commentProgress >= 100 ? 'Feedback minimum reached' : `Write at least ${MIN_COMMENT} characters across comments and reason for decision (${feedbackLength(ballot)} so far)`}</span></div>
          </section>

          <section className="jb-card jb-private">
            <div className="field-label"><span><Icon name="lock" size={14}/> Private notes</span><small>Only you can see these</small></div>
            <textarea value={ballot.note} onChange={change => update({ note: change.target.value })} placeholder="Jot what helps you remember this speaker: outfit, topic, a standout moment."/>
            <p>Never shared with students, coaches, or the director. They follow you to the ranking step.</p>
          </section>
        </div>

        <div className="jb-foot">
          <section className="jb-card jb-rating-card" aria-label="Rating">
            <div className="field-label"><span>Rating</span><small>Calculated from the section marks</small></div>
            <div className="jb-rating-value"><strong>{rating || '—'}</strong><span>{rating ? bandOf(rating) : `${ballot.marks.filter(Boolean).length} of ${event.criteria.length} sections marked`}</span></div>
            <div className="jb-rating-scale" aria-hidden="true">{RATING_BANDS.map(band => <div key={band.label}><div>{band.values.map(value => <i key={value} className={rating === value ? 'on' : ''}>{value}</i>)}</div><small>{band.label}</small></div>)}</div>
            <p className="jb-rule">{rating ? `Section marks total ${markTotal(ballot)} of 50.${markTotal(ballot) < RATING_MIN ? ` The NSAA scale starts at ${RATING_MIN}, so the rating is recorded as ${RATING_MIN}.` : ''}` : 'The rating appears once all five sections are marked.'} Change a section mark to change the rating.</p>
          </section>

          <section className="jb-card jb-time-card">
            <div className={`jb-time ${time.kind}`}>
              <span className="jb-time-label">Time</span>
              <input inputMode="numeric" maxLength={2} value={ballot.minutes} onChange={change => update({ minutes: change.target.value.replace(/\D/g, '') })} placeholder="0" aria-label="Minutes"/>
              <b>:</b>
              <input inputMode="numeric" maxLength={2} value={ballot.seconds} onChange={change => update({ seconds: change.target.value.replace(/\D/g, '').replace(/^([6-9])(\d)$/, '5$2') })} placeholder="00" aria-label="Seconds"/>
              <Badge tone={time.kind === 'penalty' ? 'danger' : time.kind === 'grace' ? 'warning' : time.kind === 'ok' ? 'success' : 'neutral'} icon={time.kind === 'ok' ? 'check' : time.kind === 'missing' ? undefined : 'clock'}>{time.text}</Badge>
            </div>
            <p className="jb-rule">{limitText(event, classA)}. {event.time.note ?? (event.time.min ? '' : 'No minimum.')}{event.time.classAMax ? ` ${clock(event.time.max)} for Classes B–D, ${clock(event.time.classAMax)} for Class A.` : ''}</p>
            <label className="jb-lowered"><input type="checkbox" checked={time.penalty} readOnly disabled/><span>This entry is <strong>lowered one rank</strong> for {event.time.min ? 'undertime or overtime' : 'overtime'} exceeding 30 seconds</span></label>
          </section>

          <details className="jb-card jb-dq" open={ballot.dq.length > 0}>
            <summary><span>Disqualification</span>{ballot.dq.length > 0 ? <Badge tone="danger" icon="warning">{ballot.dq.length} reported</Badge> : <small>None reported</small>}</summary>
            {event.disqualifications.length === 0 ? <p>The NSAA ballot lists no specific disqualification grounds for {event.name}. Report a concern to the tab room from Help.</p> : <>
              <p>This entry is disqualified for:</p>
              {event.disqualifications.map(reason => <label key={reason}><input type="checkbox" checked={ballot.dq.includes(reason)} onChange={() => update({ dq: ballot.dq.includes(reason) ? ballot.dq.filter(item => item !== reason) : [...ballot.dq, reason] })}/><span>{reason}</span></label>)}
              <p>The tab room confirms every disqualification before results change.</p>
            </>}
          </details>
        </div>
      </div>}

      <div className="jb-nav">
        <Button variant="secondary" disabled={speakerIndex === 0} onClick={() => goTo(roundSpeakers[speakerIndex - 1].code)}>Previous</Button>
        {saveLine}
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
            <span><strong>{ratingOf(data) || '—'}</strong>{ratingOf(data) > 0 && <small> {bandOf(ratingOf(data))}</small>}</span>
            <span className="jb-arrows"><button aria-label={`Move ${item.name} up`} disabled={index === 0} onClick={() => move(code, -1)}>↑</button><button aria-label={`Move ${item.name} down`} disabled={index === ranked.length - 1} onClick={() => move(code, 1)}>↓</button></span>
          </div>;
        })}
        {noShows.map(code => <div key={code} className="jb-rank-row no-show"><span/><span className="jb-rank-number">–</span><span className="jb-rank-name"><strong>{roundSpeakers.find(entry => entry.code === code)!.name}</strong><small>{code} · No-show, not ranked</small></span><span>—</span><span>—</span><span/></div>)}
      </div>

      <div className="jb-checks">
        <div className={outOfOrder.size ? 'bad' : 'ok'}><Icon name={outOfOrder.size ? 'warning' : 'check'}/><span><strong>{outOfOrder.size ? 'Ranks don’t match ratings' : 'Ranks follow ratings'}</strong><small>{outOfOrder.size ? 'A speaker with a lower rating is ranked above one with a higher rating. Reorder the highlighted rows or adjust their section marks.' : 'No speaker is ranked above someone with a higher rating.'}</small></span></div>
        <div className={unfinished.length ? 'bad' : 'ok'}><Icon name={unfinished.length ? 'warning' : 'check'}/><span><strong>{unfinished.length ? `${unfinished.length} speaker${unfinished.length > 1 ? 's still need' : ' still needs'} scoring` : 'Every speaker is scored'}</strong><small>{unfinished.length ? `${unfinished.join(', ')} need all five section marks, a time, and written feedback.` : 'Section marks, times, and written feedback are complete.'}</small></span>{unfinished.length > 0 && <button onClick={() => { goTo(unfinished[0]); setTab('score'); }}>Finish {unfinished[0]}</button>}</div>
        <div className={notCheckedIn.length ? 'bad' : 'ok'}><Icon name={notCheckedIn.length ? 'warning' : 'check'}/><span><strong>{notCheckedIn.length ? `${notCheckedIn.length} speaker${notCheckedIn.length > 1 ? 's' : ''} not checked in` : 'Attendance recorded'}</strong><small>{notCheckedIn.length ? `Mark ${notCheckedIn.join(', ')} as present or no-show.` : 'Everyone is marked present or no-show.'}</small></span>{notCheckedIn.length > 0 && <button onClick={() => { goTo(notCheckedIn[0]); setTab('score'); }}>Check in {notCheckedIn[0]}</button>}</div>
      </div>
      <p className="jb-rule jb-rank-rule"><Icon name="info" size={14}/> Rank speakers on performance. Time penalties are recorded on the ballot and the tab room lowers those entries one rank.</p>

      <div className="jb-nav"><Button variant="secondary" onClick={() => setTab('score')}>Back to scoring</Button>{saveLine}<Button disabled={!canSubmit || submitting} onClick={submit}>{submitting ? 'Submitting…' : 'Submit ballot'}</Button></div>
    </>}
  </div>;
}
