import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Icon, Progress } from './ui';
import { roundSpeakers, useStore, type Presence } from './store';
import { entryLoadByName, loadLabel } from './tournament';
import { ballotEvents, MARK_MAX, RATING_BANDS, RATING_MIN, TIME_GRACE_SECONDS, type BallotEvent } from './ballots';
import { useAuth } from './auth';
import { loadBallot, saveBallot, type BallotKey, type EntryInput } from './ballotApi';
import { clearDraft, isConnectionProblem, localKey, outboxRefusal, queueSubmit, readDraft, readPending, useBallotOutbox, useOnline, writeDraft, type LocalDraft } from './offlineBallots';
import { ballotRoundLabel } from './semis';

/** `score` is the judge's points out of 50. `marks` are optional 1–10 section marks; when all five are given, they make the score. */
type SpeakerBallot = { marks: number[]; score?: string; minutes: string; seconds: string; general: string; comment: string; note: string; dq: string[]; title?: string };

const MIN_COMMENT = 40;

const blank = (): SpeakerBallot => ({ marks: [0, 0, 0, 0, 0], score: '', minutes: '', seconds: '', general: '', comment: '', note: '', dq: [] });

const startingBallots: Record<string, SpeakerBallot> = {
  C1: { marks: [0, 0, 0, 0, 0], score: '46', minutes: '9', seconds: '41', general: 'Memorable opening story. Sources were current and well attributed. Vary your pace in the second point.', comment: 'Clearest thesis in the round, with the strongest supporting material and the most polished delivery.', note: 'Green blazer. Poster about volunteering.', dq: [] },
  C2: { marks: [0, 0, 0, 0, 0], score: '40', minutes: '10', seconds: '24', general: 'You ran a little over ten minutes, so consider trimming the third example.', comment: 'Strong analysis of how apps hold attention, but less polished in language than the top speaker.', note: 'Glasses. Phone-screen visual aid.', dq: [] },
  C3: { marks: [0, 0, 0, 0, 0], score: '36', minutes: '8', seconds: '52', general: 'Steady eye contact throughout. Add more supporting material for the after-school claims.', comment: 'Good structure, but the content needed more evidence to compete with the top of the round.', note: 'Tall, navy suit. No visual aid.', dq: [] },
  C4: { ...blank(), score: '' },
  C5: blank(),
  C6: blank(),
};

const secondsOf = (ballot: SpeakerBallot) => ballot.minutes === '' && ballot.seconds === '' ? null : (Number(ballot.minutes) || 0) * 60 + (Number(ballot.seconds) || 0);
const clock = (total: number) => `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
const markTotal = (ballot: SpeakerBallot) => ballot.marks.reduce((sum, mark) => sum + mark, 0);
const fullyMarked = (ballot: SpeakerBallot) => ballot.marks.every(Boolean);
/** The judge's points out of 50: the five section marks' total when every section is marked, otherwise the score they typed. 0 if neither. */
const pointsOf = (ballot: SpeakerBallot) => { if (fullyMarked(ballot)) return markTotal(ballot); const typed = Number(ballot.score); return Number.isInteger(typed) && typed >= 1 && typed <= 50 ? typed : 0; };
/** The rating recorded on the ballot: the points, except the NSAA scale stops at 35, so lower scores are recorded as 35. */
const ratingOf = (ballot: SpeakerBallot) => pointsOf(ballot) ? Math.max(RATING_MIN, pointsOf(ballot)) : 0;
const feedbackLength = (ballot: SpeakerBallot) => ballot.general.trim().length + ballot.comment.trim().length;
const isScored = (ballot: SpeakerBallot) => pointsOf(ballot) > 0 && secondsOf(ballot) !== null && feedbackLength(ballot) >= MIN_COMMENT;
const THIS_ROUND: BallotKey = { tournament: 'Larkspur Invitational', round: 2, room: 'Room 214' };
type Speaker = { code: string; name: string; school: string; title?: string };
const emptyRound = (list: Speaker[]) => Object.fromEntries(list.map(item => [item.code, blank()])) as Record<string, SpeakerBallot>;

/** A real room from the director's schedule. Without one, the ballot shows the sample round. */
export type BallotRoom = { key: BallotKey; tournamentId: string; sectionId: string; eventId: string; time: string; speakers: Speaker[]; final?: boolean; stage?: 'prelim' | 'semi' | 'final' };
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

export function JudgeBallot({ room, onSubmitted }: { room?: BallotRoom; onSubmitted?: (rows: { entryId: string; rank: number; rating: number }[]) => void }) {
  const speakers: Speaker[] = room?.speakers ?? roundSpeakers;
  const ballotKey = room?.key ?? THIS_ROUND;
  const link = room ? { tournamentId: room.tournamentId, sectionId: room.sectionId } : undefined;
  const { speakerPresence, setSpeakerPresence, entries, tournament } = useStore();
  // On a phone the ballot opens below the workspace header: bring it into view so the judge sees it open.
  const sectionId = room?.sectionId;
  useEffect(() => {
    const ballot = document.querySelector('.jb');
    if (!ballot) return;
    const top = ballot.getBoundingClientRect().top;
    if (top >= 0 && top < window.innerHeight * 0.4) return;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: Math.max(0, top + window.scrollY - 72), behavior: smooth ? 'smooth' : 'auto' });
  }, [sectionId]);
  // Most judges would rather not see a rating: it is still worked out from the marks for tiebreaks, just not shown.
  const showRating = tournament.showRating ?? false;
  // Section marks are optional unless the director requires them. A judge's choice is remembered on this device.
  const marksRequired = tournament.sectionMarks === 'required';
  const [markingChoice, setMarkingChoice] = useState(() => { try { return localStorage.getItem('orator-mark-sections') === 'on'; } catch { return false; } });
  const marking = marksRequired || markingChoice;
  const setMarking = (on: boolean) => {
    setMarkingChoice(on); try { localStorage.setItem('orator-mark-sections', on ? 'on' : 'off'); } catch { /* storage off */ }
    // Turning marks off keeps each speaker's score: a fully marked total becomes their typed score, and the hidden marks are cleared.
    if (!on) { dirty.current = true; setBallots(all => Object.fromEntries(Object.entries(all).map(([code, ballot]) => [code, { ...ballot, score: fullyMarked(ballot) ? String(markTotal(ballot)) : ballot.score, marks: ballot.marks.map(() => 0) }]))); }
  };
  const { profile } = useAuth();
  const loadOf = (name: string) => loadLabel(entryLoadByName(entries, name));
  const firstName = (code: string) => speakers.find(item => item.code === code)!.name.split(' ')[0];
  const firstNames = (codes: string[]) => codes.map(firstName).join(', ');
  /** Signed-in judges save to the database; the demo keeps everything in the browser. */
  const remote = profile !== null;
  const [eventId, setEventId] = useState(room?.eventId ?? 'info');
  const [classA, setClassA] = useState(false);
  const [ballotId, setBallotId] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>(remote ? 'loading' : 'ready');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed' | 'offline'>('idle');
  // Offline: a copy on this device, a submission waiting to send, and a tick that retries the save.
  const draftId = remote && profile ? localKey(profile.id, ballotKey) : null;
  const [queued, setQueued] = useState(() => draftId ? readPending(draftId) !== null : false);
  const [retry, setRetry] = useState(0);
  const online = useOnline();
  const [saveError, setSaveError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dirty = useRef(false);
  const [tab, setTab] = useState<'score' | 'rank'>('score');
  const [current, setCurrent] = useState(remote || room ? speakers[0].code : 'C4');
  const [open, setOpen] = useState(0);
  const [ballots, setBallots] = useState(() => remote || room ? emptyRound(speakers) : startingBallots);
  const [order, setOrder] = useState(speakers.map(speaker => speaker.code));
  const [dragged, setDragged] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [experience, setExperience] = useState('');

  const event = ballotEvents.find(item => item.id === eventId) || ballotEvents[0];
  const speaker = speakers.find(item => item.code === current)!;
  const ballot = ballots[current];
  const update = (patch: Partial<SpeakerBallot>) => { dirty.current = true; setBallots(all => ({ ...all, [current]: { ...all[current], ...patch } })); };
  const absent = (code: string) => speakerPresence[code] === 'absent';

  const ranked = order.filter(code => !absent(code));
  const noShows = order.filter(absent);
  // Section marks are all or none (all five when the director requires them).
  const partlyMarked = (ballot: SpeakerBallot) => (marksRequired || ballot.marks.some(Boolean)) && !fullyMarked(ballot);
  const unfinished = ranked.filter(code => !isScored(ballots[code]) || partlyMarked(ballots[code]));
  const notCheckedIn = ranked.filter(code => !speakerPresence[code]);
  const timePenalty = (code: string) => timeStatus(secondsOf(ballots[code]), event, classA).penalty;
  // A speaker may not be ranked above someone the judge gave a higher rating, unless that
  // higher-rated speaker has a time penalty: being lowered for time is allowed, not an error.
  const outOfOrder = new Set<string>();
  ranked.forEach((code, index) => {
    if (timePenalty(code)) return;
    // Compare with everyone ranked above, not just the neighbour, so a penalized speaker in between can't hide a mismatch.
    ranked.slice(0, index).forEach(above => { if (ratingOf(ballots[code]) > ratingOf(ballots[above])) { outOfOrder.add(code); outOfOrder.add(above); } });
  });
  /** True when the judge has already placed a penalized speaker below someone with a lower rating. */
  const loweredByJudge = (code: string) => { const index = ranked.indexOf(code); return timePenalty(code) && index > 0 && ratingOf(ballots[code]) > ratingOf(ballots[ranked[index - 1]]); };
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
  const scoreWord = 'scores';
  const lower = 'a lower score', higher = 'a higher score';
  const speakerIndex = speakers.findIndex(item => item.code === current);
  const goTo = (code: string) => { setCurrent(code); setOpen(0); };
  const flagsFor = (code: string) => { const data = ballots[code]; return { penalty: timeStatus(secondsOf(data), event, classA).penalty, dq: data.dq.length > 0 }; };

  // The judge ranks on performance. Anyone with a time penalty is then placed one rank lower
  // automatically, unless the judge has already put them below a lower-rated speaker.
  const finalRanked = [...ranked];
  for (let index = finalRanked.length - 2; index >= 0; index--) {
    const code = finalRanked[index];
    if (timePenalty(code) && !loweredByJudge(code)) [finalRanked[index], finalRanked[index + 1]] = [finalRanked[index + 1], finalRanked[index]];
  }
  const lowered = (code: string) => timePenalty(code) && (loweredByJudge(code) || finalRanked.indexOf(code) > ranked.indexOf(code));

  // The speaker's own title, unless the judge wrote one down (when the speaker didn't announce one).
  const titleOf = (code: string) => (ballots[code]?.title ?? '').trim() || speakers.find(item => item.code === code)?.title || '';
  const toEntries = (): EntryInput[] => speakers.map(item => {
    const data = ballots[item.code]; const presence = speakerPresence[item.code];
    const place = finalRanked.indexOf(item.code);
    return {
      code: item.code, name: item.name, school: item.school, present: presence ? presence === 'present' : null,
      rank: place >= 0 ? place + 1 : null, rating: ratingOf(data) || null, timeSeconds: secondsOf(data), timePenalty: flagsFor(item.code).penalty,
      marks: data.marks, comments: data.general, reason: data.comment, disqualifications: data.dq, note: data.note, title: titleOf(item.code),
    };
  });

  // Load the judge's saved ballot for this round, if they have one.
  useEffect(() => {
    if (!remote) return;
    let active = true;
    const local = draftId ? readDraft<SpeakerBallot>(draftId) : null;
    const restore = (draft: LocalDraft<SpeakerBallot>) => {
      setBallotId(draft.ballotId); setEventId(draft.eventId); setClassA(draft.classA);
      setBallots({ ...emptyRound(speakers), ...Object.fromEntries(Object.entries(draft.ballots).filter(([code]) => speakers.some(item => item.code === code))) });
      setOrder([...draft.order.filter(code => speakers.some(item => item.code === code)), ...speakers.map(item => item.code).filter(code => !draft.order.includes(code))]);
      speakers.forEach(item => setSpeakerPresence(item.code, draft.presence[item.code]));
    };
    loadBallot(ballotKey).then(saved => {
      if (!active) return;
      // Changes made on this device that never reached the server win over the server's older copy.
      if (local?.unsynced && saved?.status !== 'submitted') { restore(local); if (saved) setBallotId(saved.id); dirty.current = true; setLoadState('ready'); return; }
      if (saved) {
        setBallotId(saved.id); setEventId(saved.eventId); setClassA(saved.classA); setSubmitted(saved.status === 'submitted');
        const next = emptyRound(speakers);
        saved.entries.forEach(entry => {
          if (!next[entry.code]) return;
          next[entry.code] = {
            marks: [0, 1, 2, 3, 4].map(index => entry.marks[index] || 0),
            minutes: entry.timeSeconds === null ? '' : String(Math.floor(entry.timeSeconds / 60)), seconds: entry.timeSeconds === null ? '' : String(entry.timeSeconds % 60).padStart(2, '0'),
            general: entry.comments, comment: entry.reason, note: entry.note, dq: entry.disqualifications, title: entry.title ?? '',
            score: entry.marks.some(Boolean) || entry.rating === null ? '' : String(entry.rating),
          };
          setSpeakerPresence(entry.code, entry.present === null ? undefined : entry.present ? 'present' : 'absent');
        });
        setBallots(next);
        const byRank = [...saved.entries].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).map(entry => entry.code).filter(code => next[code]);
        const penalized = new Set(saved.entries.filter(entry => entry.timePenalty).map(entry => entry.code));
        for (let index = 1; index < byRank.length; index++) {
          // Only a tie needs undoing; a penalized speaker below a lower-rated one is recognised as already lowered.
          if (penalized.has(byRank[index]) && ratingOf(next[byRank[index]]) === ratingOf(next[byRank[index - 1]])) [byRank[index - 1], byRank[index]] = [byRank[index], byRank[index - 1]];
        }
        setOrder([...byRank, ...speakers.map(item => item.code).filter(code => !byRank.includes(code))]);
      } else {
        speakers.forEach(item => setSpeakerPresence(item.code, undefined));
      }
      setLoadState('ready');
    }).catch(() => {
      if (!active) return;
      // No connection: carry on from this device's copy if there is one.
      if (local) { restore(local); dirty.current = local.unsynced; setSaveState('offline'); setLoadState('ready'); }
      else setLoadState('failed');
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote]);

  // Autosave the draft shortly after the judge stops typing.
  useEffect(() => {
    if (!remote || loadState !== 'ready' || submitted || submitting || !dirty.current) return;
    const timer = setTimeout(async () => {
      dirty.current = false; setSaveState('saving');
      try { const id = await saveBallot(ballotKey, ballotId, eventId, classA, toEntries(), false, link); setBallotId(id); setSaveState('saved'); setSaveError(''); keepLocal(id, false); }
      catch (caught) { dirty.current = true; if (isConnectionProblem(caught)) { setSaveState('offline'); setSaveError(''); } else { setSaveState('failed'); setSaveError(caught instanceof Error ? caught.message : 'Could not save.'); } }
    }, 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ballots, order, eventId, classA, speakerPresence, loadState, submitted, submitting, retry]);

  // Every change is also kept on this device, so a dropped connection or a reload loses nothing.
  const keepLocal = (id: string | null, unsynced: boolean) => {
    if (!draftId) return;
    const presence = Object.fromEntries(speakers.map(item => [item.code, speakerPresence[item.code]]));
    writeDraft<SpeakerBallot>(draftId, { ballots, order, eventId, classA, ballotId: id, presence, unsynced, at: Date.now() });
  };
  useEffect(() => {
    if (!draftId || loadState !== 'ready' || submitted) return;
    keepLocal(ballotId, dirty.current || saveState === 'offline' || saveState === 'failed');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ballots, order, eventId, classA, speakerPresence, loadState]);

  // While offline, try the save again when the connection returns, and every 15 seconds.
  useEffect(() => {
    if (saveState !== 'offline' || queued) return;
    const again = () => setRetry(count => count + 1);
    window.addEventListener('online', again);
    const timer = window.setInterval(again, 15000);
    return () => { window.removeEventListener('online', again); window.clearInterval(timer); };
  }, [saveState, queued]);

  // A ballot submitted offline goes out by itself; this screen hears when it has.
  useBallotOutbox(remote, () => { if (draftId && queued && !readPending(draftId)) { setQueued(false); setSubmitted(true); dirty.current = false; } });
  // A queued ballot the server refused comes back here as a draft to fix.
  useEffect(() => {
    if (!queued || !draftId) return;
    const check = () => { if (!readPending(draftId) && outboxRefusal()) { setQueued(false); dirty.current = true; setSaveState('failed'); setSaveError(outboxRefusal()); } };
    const timer = window.setInterval(check, 3000);
    return () => window.clearInterval(timer);
  }, [queued, draftId]);

  const submit = async () => {
    const announce = () => onSubmitted?.(toEntries().filter(entry => entry.present && entry.rank && entry.rating).map(entry => ({ entryId: entry.code, rank: entry.rank!, rating: entry.rating! })));
    if (!remote) { setSubmitted(true); announce(); return; }
    setSubmitting(true); setSaveError('');
    try { setBallotId(await saveBallot(ballotKey, ballotId, eventId, classA, toEntries(), true, link)); dirty.current = false; setSubmitted(true); if (draftId) clearDraft(draftId); announce(); }
    catch (caught) {
      if (draftId && isConnectionProblem(caught)) {
        // Offline: keep the finished ballot on this device and send it the moment the connection is back.
        keepLocal(ballotId, true);
        queueSubmit(draftId, { key: ballotKey, ballotId, eventId, classA, entries: toEntries(), link, at: Date.now() });
        dirty.current = false; setQueued(true); setSaveState('offline'); setSaveError('');
      } else { setSaveState('failed'); setSaveError(caught instanceof Error ? caught.message : 'Could not submit the ballot.'); }
    }
    finally { setSubmitting(false); }
  };
  const saveLine = !remote ? <span><Icon name="check" size={15}/> Autosaved just now</span>
    : queued ? <span className="jb-save-offline" role="status"><Icon name="clock" size={15}/> Submitted on this laptop. It sends automatically when the internet is back.</span>
    : saveState === 'offline' || !online ? <span className="jb-save-offline" role="status"><Icon name="clock" size={15}/> No internet. Saved on this laptop; it syncs when the connection is back.</span>
    : saveState === 'failed' ? <span className="jb-save-failed" role="alert"><Icon name="warning" size={15}/> Not saved: {saveError}</span>
    : saveState === 'saving' ? <span className="jb-saving">Saving…</span>
    : <span><Icon name="check" size={15}/> {saveState === 'saved' ? 'Draft saved to your account' : 'Changes save automatically'}</span>;

  if (loadState === 'loading') return <div className="jb jb-loading"><span className="spinner"/><p>Loading your ballot…</p></div>;
  if (loadState === 'failed') return <div className="jb jb-loading"><span className="state-icon"><Icon name="warning"/></span><p>We couldn’t load your ballot. Check your connection and reopen it.</p></div>;

  if (submitted) return <div className="jb jb-done">
    <span className="success-icon"><Icon name="check" size={26}/></span>
    <h2>{ballotRoundLabel(room, ballotKey.round)} ballot submitted</h2>
    <p>Ranks, scores, times, comments, and your reasons for decision are filed with the tab room{remote ? ' and saved to your account. The ballot is now locked' : ''}. Your private notes stay with you.</p>
    <ol className="jb-final">{finalRanked.map((code, index) => { const flags = flagsFor(code); return <li key={code}><strong>{index + 1}</strong><span>{speakers.find(item => item.code === code)!.name}{flags.penalty && <em> · lowered one rank for time</em>}{flags.dq && <em> · disqualification reported</em>}</span><small>{showRating ? `${ratingOf(ballots[code])} · ` : ""}{clock(secondsOf(ballots[code]) || 0)}</small></li>; })}</ol>
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
    {remote && (queued || saveState === 'offline' || !online) && <div className="jb-offline-banner"><Icon name="clock" size={18}/><span><strong>{queued ? 'Your ballot is submitted on this laptop.' : 'No internet right now. Keep judging.'}</strong> {queued ? 'It sends to the tab room by itself as soon as the connection is back. You can open your next room.' : 'Everything you enter is saved on this laptop and syncs when the connection returns. If the laptop itself fails, finish on a paper ballot and give it to the tab room.'}</span></div>}
    <div className="jb-top">
      <div><span className="jb-badges"><Badge tone="info">{ballotRoundLabel(room, ballotKey.round)}</Badge><Badge tone="success" icon="check">NSAA ballot format</Badge></span><strong>{room ? event.name : `Varsity ${event.name}`}</strong><span>{ballotKey.room} · {room?.time ?? '9:30 AM'} · {speakers.length} {speakers.length === 1 ? 'speaker' : 'speakers'} · {limitText(event, classA)}</span></div>
      <div className="jb-selects">{event.time.classAMax && <label><span>School class</span><select aria-label="School class" value={classA ? 'a' : 'other'} onChange={change => { dirty.current = true; setClassA(change.target.value === 'a'); }}><option value="other">Classes B–D · {clock(event.time.max)}</option><option value="a">Class A · {clock(event.time.classAMax)}</option></select></label>}
      {!room && <label><span>Event</span><select aria-label="Event" value={eventId} onChange={change => { dirty.current = true; setEventId(change.target.value); setOpen(0); }}>{ballotEvents.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</div>
    </div>
    <div className="segmented jb-tabs"><button className={tab === 'score' ? 'active' : ''} onClick={() => setTab('score')}>1 · Score speakers</button><button className={tab === 'rank' ? 'active' : ''} onClick={() => setTab('rank')}>2 · Rank the round</button></div>

    {tab === 'score' ? <>
      <div className="jb-strip" role="tablist" aria-label="Speakers in this round">{speakers.map((item, index) => {
        const data = ballots[item.code];
        const state = absent(item.code) ? 'absent' : isScored(data) ? 'done' : data.general || data.comment || data.score || data.marks.some(Boolean) ? 'draft' : 'empty';
        return <button key={item.code} role="tab" aria-selected={current === item.code} className={`${current === item.code ? 'active' : ''} ${state}`} onClick={() => goTo(item.code)}>
          <small>{index + 1}{loadOf(item.name) ? ` · ${entryLoadByName(entries, item.name)}×` : ''}</small><strong>{item.name}</strong><span>{state === 'done' ? `${pointsOf(data)} of 50` : state === 'absent' ? 'No-show' : state === 'draft' ? 'Draft' : 'Waiting'}</span>
        </button>;
      })}</div>

      <div className="jb-speaker">
        <div><span className="eyebrow">SPEAKER {speakerIndex + 1} OF {speakers.length}{room ? '' : ` · ${speaker.code}`}</span><h2>{speaker.name}</h2><p>{speaker.school}</p>
          <label className="jb-title"><span>Title or thesis</span><input value={ballot.title ?? speaker.title ?? ''} onChange={change => update({ title: change.target.value })} placeholder={speaker.title ? '' : 'Write it down if the speaker didn’t announce one'} maxLength={200}/></label>{loadOf(speaker.name) && <p className="jb-load"><Badge tone="info" icon="users">{loadOf(speaker.name)}</Badge> In more than one room this round. They may arrive late or need to leave early.</p>}</div>
        <SpeakerCheckIn code={current} onChange={() => { dirty.current = true; }}/>
      </div>

      {absent(current) ? <div className="jb-absent"><Icon name="info"/><span><strong>{speaker.name} is marked as a no-show.</strong><small>They are left out of your ranking. Tap “No-show” again to undo.</small></span></div> : <div className="jb-grid">
        <section className="criteria-card jb-criteria">
          <div className="card-label"><span>Criteria for evaluation</span><small>{marking ? `${ballot.marks.filter(Boolean).length} of ${event.criteria.length} sections marked${marksRequired ? ' · required' : ' · optional'}` : 'What to listen for'}</small></div>
          {!marksRequired && <label className="jb-mark-toggle"><input type="checkbox" checked={marking} onChange={change => setMarking(change.target.checked)}/><span><strong>Mark each section 1–10</strong><small>Optional. When all five are marked, they add up to the score.</small></span></label>}
          {event.criteria.map((item, index) => <div className={`criterion ${open === index ? 'open' : ''}`} key={item.name}>
            <button className="criterion-trigger" onClick={() => setOpen(open === index ? -1 : index)}>
              <span className="criterion-name"><span className={`status-dot ${marking && ballot.marks[index] ? 'complete' : ''}`}/><span><strong>{item.name}</strong><small>{marking && ballot.marks[index] ? `Marked ${ballot.marks[index]} of ${MARK_MAX}` : `${item.questions.length} question${item.questions.length > 1 ? 's' : ''} to consider`}</small></span></span>
              <Icon name="chevron"/>
            </button>
            {open === index && <div className="criterion-body"><ul className="jb-questions">{item.questions.map(question => <li key={question}>{question}</li>)}</ul>
              {marking && <div className="jb-mark"><span>Section mark</span><div className="rating rating-10" aria-label={`${item.name} mark from 1 to ${MARK_MAX}`}>{Array.from({ length: MARK_MAX }, (_, i) => i + 1).map(value =>
                <button key={value} className={value === ballot.marks[index] ? 'selected' : ''} aria-label={`Mark ${value}`} onClick={() => { update({ marks: ballot.marks.map((old, i) => i === index ? value : old) }); const next = ballot.marks.findIndex((old, i) => i > index && !old); if (next >= 0) setOpen(next); }}>{value}</button>)}</div></div>}
            </div>}
          </div>)}
          <p className="jb-extra"><Icon name="info" size={14}/> {marking ? (marksRequired ? `This tournament asks for a mark from 1 to ${MARK_MAX} in every section. The five marks add up to the score.` : `Mark all five sections and they add up to the score below, or leave them blank and type the score yourself.`) : 'Use these as a guide, then give a score out of 50 below.'}</p>
        </section>

        <div className="jb-side">
          <section className="jb-card">
            <div className="field-label"><span>Comments</span><small>Strengths and suggestions for {speaker.name.split(' ')[0]}</small></div>
            <textarea className="jb-general" value={ballot.general} onChange={change => update({ general: change.target.value })} placeholder="General comments on the performance. What worked? What should the speaker work on?"/>
          </section>

          <section className="jb-card">
            <div className="field-label"><span>Reason for decision</span><small>Why this rank and score</small></div>
            <textarea value={ballot.comment} onChange={change => update({ comment: change.target.value })} placeholder="Explain this speaker’s rank compared with the others in the round."/>
            <div className={`jb-meter ${commentProgress >= 100 ? 'ready' : ''}`}><Progress value={commentProgress} label="Feedback written"/><span>{commentProgress >= 100 ? 'Feedback minimum reached' : `Write at least ${MIN_COMMENT} characters across comments and reason for decision (${feedbackLength(ballot)} so far)`}</span></div>
          </section>

          <section className="jb-card jb-private">
            <div className="field-label"><span><Icon name="lock" size={14}/> Private notes</span><small>Only you can see these</small></div>
            <textarea value={ballot.note} onChange={change => update({ note: change.target.value })} placeholder="Jot what helps you remember this speaker: outfit, topic, a standout moment."/>
            <p>Never shared with students, coaches, or the director. They follow you to the ranking step.</p>
          </section>
        </div>

        <div className="jb-foot">
          <section className="jb-card jb-rating-card jb-score-card" aria-label="Score">
            <div className="field-label"><label htmlFor={`score-${current}`}>Score out of 50</label><small>Required</small></div>
            <div className="jb-score-row">
              <input id={`score-${current}`} className="jb-score-input" inputMode="numeric" value={fullyMarked(ballot) ? String(markTotal(ballot)) : ballot.score ?? ''} disabled={fullyMarked(ballot)} placeholder="—" maxLength={2}
                aria-describedby={`score-help-${current}`} onChange={change => update({ score: change.target.value.replace(/\D/g, '').slice(0, 2) })}/>
              <span className="jb-score-of">/ 50</span>
              {showRating && rating > 0 && <span className="jb-score-band">{bandOf(rating)}</span>}
            </div>
            {showRating && <div className="jb-rating-scale" aria-hidden="true">{RATING_BANDS.map(band => <div key={band.label}><div>{band.values.map(value => <i key={value} className={rating === value ? 'on' : ''}>{value}</i>)}</div><small>{band.label}</small></div>)}</div>}
            <p className="jb-rule" id={`score-help-${current}`}>{fullyMarked(ballot) ? `Totalled from your five section marks${marksRequired ? '' : '. Clear a section mark to type a score instead'}.` : ballot.score && !pointsOf(ballot) ? 'Enter a whole number from 1 to 50.' : pointsOf(ballot) && pointsOf(ballot) < RATING_MIN ? `The NSAA scale starts at ${RATING_MIN}, so this is recorded as ${RATING_MIN}.` : 'Most scores fall between 35 and 50.'}</p>
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
        <Button variant="secondary" disabled={speakerIndex === 0} onClick={() => goTo(speakers[speakerIndex - 1].code)}>Previous</Button>
        {saveLine}
        {speakerIndex < speakers.length - 1 ? <Button icon="arrow" onClick={() => goTo(speakers[speakerIndex + 1].code)}>Next speaker</Button> : <Button icon="arrow" onClick={() => setTab('rank')}>Rank the round</Button>}
      </div>
    </> : <>
      <div className="jb-rank-head"><div><h2>Rank the round</h2><p>Drag speakers into order, or use the arrows. There may be no ties in rank. Time penalties are applied for you.</p></div><Button variant="secondary" icon="growth" onClick={sortByRating}>Sort by score</Button></div>
      <div className="jb-rank-list">
        <div className="jb-rank-row jb-rank-labels"><span/><span>Rank</span><span>Speaker</span><span>Time</span><span>Score</span><span/></div>
        {finalRanked.map((code, index) => {
          const item = speakers.find(entry => entry.code === code)!; const data = ballots[code]; const seconds = secondsOf(data); const flags = flagsFor(code);
          return <div key={code} className={`jb-rank-row ${outOfOrder.has(code) ? 'conflict' : ''} ${dragged === code ? 'dragging' : ''}`} draggable onDragStart={() => setDragged(code)} onDragEnd={() => setDragged(null)} onDragOver={drag => drag.preventDefault()} onDrop={() => dropOn(code)}>
            <span className="jb-grip"><Icon name="drag"/></span>
            <span className="jb-rank-number">{index + 1}</span>
            <span className="jb-rank-name"><strong>{item.name}{flags.penalty && <Badge tone="danger" icon="clock">{lowered(code) ? 'Lowered one rank for time' : 'Time penalty · already last'}</Badge>}{flags.dq && <Badge tone="danger" icon="warning">DQ reported</Badge>}</strong><small>{code} · {item.school}{data.note ? ` · ${data.note}` : ''}</small>{titleOf(code) && <em className="jb-rank-title">“{titleOf(code).replace(/^[“"]|[”"]$/g, '')}”</em>}</span>
            <span className={flags.penalty ? 'jb-over' : ''}>{seconds === null ? '—' : clock(seconds)}</span>
            <span>{pointsOf(data) ? <><strong>{pointsOf(data)}</strong><small> / 50{showRating ? ` · ${bandOf(ratingOf(data))}` : ''}</small></> : <small>No score yet</small>}</span>
            <span className="jb-arrows"><button aria-label={`Move ${item.name} up`} disabled={ranked.indexOf(code) === 0} onClick={() => move(code, -1)}>↑</button><button aria-label={`Move ${item.name} down`} disabled={ranked.indexOf(code) === ranked.length - 1} onClick={() => move(code, 1)}>↓</button></span>
          </div>;
        })}
        {noShows.map(code => <div key={code} className="jb-rank-row no-show"><span/><span className="jb-rank-number">–</span><span className="jb-rank-name"><strong>{speakers.find(entry => entry.code === code)!.name}</strong><small>{code} · No-show, not ranked</small></span><span>—</span><span>—</span><span/></div>)}
      </div>

      <div className="jb-checks">
        <div className={outOfOrder.size ? 'bad' : 'ok'}><Icon name={outOfOrder.size ? 'warning' : 'check'}/><span><strong>{outOfOrder.size ? `Ranks don’t match ${scoreWord}` : `Ranks follow ${scoreWord}`}</strong><small>{outOfOrder.size ? `A speaker with ${lower} is ranked above one with ${higher}. Reorder the highlighted rows or change their scores.` : finalRanked.some(lowered) ? `Time penalties are applied for you; no speaker is otherwise ranked above someone with ${higher}.` : `No speaker is ranked above someone with ${higher}.`}</small></span></div>
        <div className={unfinished.length ? 'bad' : 'ok'}><Icon name={unfinished.length ? 'warning' : 'check'}/><span><strong>{unfinished.length ? `${unfinished.length} speaker${unfinished.length > 1 ? 's still need' : ' still needs'} scoring` : 'Every speaker is scored'}</strong><small>{unfinished.length ? `${firstNames(unfinished)} ${unfinished.length > 1 ? 'need' : 'needs'} a score out of 50 (and all five section marks if any are marked), a time, and written feedback.` : 'Scores, times, and written feedback are complete.'}</small></span>{unfinished.length > 0 && <button onClick={() => { goTo(unfinished[0]); setTab('score'); }}>Finish {firstName(unfinished[0])}</button>}</div>
        <div className={notCheckedIn.length ? 'bad' : 'ok'}><Icon name={notCheckedIn.length ? 'warning' : 'check'}/><span><strong>{notCheckedIn.length ? `${notCheckedIn.length} speaker${notCheckedIn.length > 1 ? 's' : ''} not checked in` : 'Attendance recorded'}</strong><small>{notCheckedIn.length ? `Mark ${firstNames(notCheckedIn)} as present or no-show.` : 'Everyone is marked present or no-show.'}</small></span>{notCheckedIn.length > 0 && <button onClick={() => { goTo(notCheckedIn[0]); setTab('score'); }}>Check in {firstName(notCheckedIn[0])}</button>}</div>
      </div>
      <p className="jb-rule jb-rank-rule"><Icon name="info" size={14}/> Rank speakers on performance. Anyone more than 30 seconds outside the time limit is placed one rank lower automatically, so they can finish below a speaker with {lower}.</p>

      <div className="jb-nav"><Button variant="secondary" onClick={() => setTab('score')}>Back to scoring</Button>{saveLine}<Button disabled={!canSubmit || submitting || queued} onClick={submit}>{submitting ? 'Submitting…' : queued ? 'Waiting for internet' : 'Submit ballot'}</Button></div>
    </>}
  </div>;
}
