import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Icon } from './ui';
import { useStore } from './store';
import { ballotEvents } from './ballots';
import { divisionLabel, divisionOf, roundLabel, type Section } from './tournament';
import { recordError, useRecentErrors } from './errorReporting';
import { listErrors, loadBallotProgress } from './errorsApi';
import { demoDraft, roundsInProgress, stillOut, summarize, type RoomState } from './statusBoard';
import type { AppError } from './errorLog';
import './status.css';

const REFRESH_MS = 60_000;
type Progress = Record<string, { state: RoomState; savedAt: string | null }>;

const eventName = (section: Section) => `${ballotEvents.find(event => event.id === section.eventId)?.name ?? section.eventId}${divisionOf(section) === 'novice' ? ` (${divisionLabel.novice})` : ''}`;
const clock = (iso: string | null | undefined) => {
  if (!iso) return '';
  const when = new Date(iso); if (Number.isNaN(when.getTime())) return '';
  const today = when.toDateString() === new Date().toDateString();
  return today ? when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : when.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

/**
 * The director's tab-room view during a running tournament: for the rounds under way, which rooms are
 * still out and whether their judge has started, and the most recent errors people hit in the app.
 * Signed in, ballot states and errors come from supabase/errors.sql and refresh every minute.
 */
export function StatusBoard() {
  const store = useStore();
  const { live, tournamentId, sections, tournament } = store;
  const localErrors = useRecentErrors();
  const [progress, setProgress] = useState<Progress>({});
  const [liveErrors, setLiveErrors] = useState<AppError[]>([]);
  const [problem, setProblem] = useState('');
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(() => new Date().toISOString());
  const samples = useRef(0);

  const load = useCallback(async () => {
    setUpdatedAt(new Date().toISOString());
    if (!live || !tournamentId) return;
    setLoading(true);
    try {
      const [rooms, errors] = await Promise.all([loadBallotProgress(tournamentId), listErrors(tournamentId)]);
      setProgress(rooms); setLiveErrors(errors); setProblem('');
    } catch (caught) { setProblem(caught instanceof Error ? caught.message : 'The status board could not load. Try again.'); }
    finally { setLoading(false); setUpdatedAt(new Date().toISOString()); }
  }, [live, tournamentId]);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  // The demo: a room is in once it has results (a judge's ballot or sample results); some others show a sample draft.
  const withResults = new Set([...store.roomResults.map(result => result.sectionId), ...store.prelimResults.map(result => result.sectionId)]);
  // Sample drafts only in the earliest round still out, as on a real day.
  const demoRound = Math.min(...sections.filter(section => section.entryIds.length && !withResults.has(section.id)).map(section => section.round));
  const demoIndex = new Map(sections.filter(section => section.round === demoRound).map((section, index) => [section.id, index]));
  const stateOf = (id: string): RoomState => live ? progress[id]?.state ?? 'none' : withResults.has(id) ? 'submitted' : demoIndex.has(id) && demoDraft(demoIndex.get(id)!) ? 'draft' : 'none';
  const savedAt = (id: string) => live ? progress[id]?.savedAt ?? null : null;

  const rounds = roundsInProgress(sections, stateOf);
  const current = sections.filter(section => rounds.includes(section.round));
  const counts = summarize(current, stateOf);
  const out = stillOut(current, stateOf);
  const roundNames = [...new Set(current.slice().sort((a, b) => a.round - b.round).map(section => roundLabel(section, tournament)))];
  const errors = live ? liveErrors : localErrors;
  const judgeName = (section: Section) => section.judgeName || store.judges.find(judge => judge.id === section.judgeId)?.name || '';
  const refresh = () => { if (live) store.refresh(); load(); };

  return <section className="panel status-board" aria-labelledby="status-board-title">
    <div className="panel-head">
      <div><h2 id="status-board-title">Tab room status</h2><p>{roundNames.length ? roundNames.join(' and ') : 'No rounds yet'} · updated {clock(updatedAt)}{live ? ' · refreshes every minute' : ''}</p></div>
      <span className="panel-head-actions"><Button variant="secondary" icon="clock" onClick={refresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</Button></span>
    </div>
    {problem && <p className="sb-problem" role="alert"><Icon name="warning" size={16}/><span>{problem}</span></p>}
    {current.length === 0 ? <p className="issue-empty">The status board fills in once the schedule is built. Then it shows every room still waiting for a ballot.</p> : <>
      <dl className="sb-counts">
        <div className={counts.submitted === counts.total ? 'done' : ''}><dt>Ballots in</dt><dd>{counts.submitted} <small>of {counts.total}</small></dd></div>
        <div className={counts.notStarted ? 'alert' : ''}><dt>Not started</dt><dd>{counts.notStarted}</dd></div>
        <div><dt>Draft saved</dt><dd>{counts.drafts}</dd></div>
        <div className={counts.noJudge ? 'alert' : ''}><dt>No judge</dt><dd>{counts.noJudge}</dd></div>
      </dl>
      <h3 className="sb-heading">Rooms still out</h3>
      {out.length === 0 ? <p className="sb-empty"><Icon name="check" size={16}/> Every ballot for {roundNames.join(' and ')} is in.</p> : <ul className="sb-rooms">{out.map(section => {
        const state = stateOf(section.id); const judge = judgeName(section);
        const checkedIn = section.judgeId ? store.judgeCheckedIn[section.judgeId] : undefined;
        return <li key={section.id} className={state === 'none' ? 'cold' : ''}>
          <div className="sb-room"><strong>{section.room || 'No room set'}</strong><small>{roundLabel(section, tournament)} · {eventName(section)} · {section.label.replace('Novice · ', '')}</small></div>
          <div className="sb-judge"><span>{judge || 'No judge assigned'}</span>{judge && checkedIn === false && <small>Not checked in</small>}</div>
          {state === 'draft' ? <Badge tone="info" icon="edit">Draft saved{savedAt(section.id) ? ` ${clock(savedAt(section.id))}` : ''}</Badge> : <Badge tone="warning" icon="warning">{judge ? 'Not started' : 'Needs a judge'}</Badge>}
        </li>;
      })}</ul>}
      {!live && <p className="sb-note">In the demo, rooms count as in once they have results, and the saved drafts are sample data.</p>}
    </>}
    <div className="sb-errors">
      <div className="sb-errors-head"><h3 className="sb-heading">App errors</h3>{errors.length > 0 && <Badge tone="danger">{errors.length >= 25 ? '25 most recent' : `${errors.length} recorded`}</Badge>}</div>
      <p className="sb-note">Pages that broke and requests that failed{live ? ' for anyone at this tournament' : ' in this browser'}. They never include names, ballots or comments.</p>
      {errors.length === 0 ? <p className="sb-empty"><Icon name="check" size={16}/> No errors recorded{live ? ' at this tournament' : ' in this session'}.</p> : <ul className="sb-error-list">{errors.map(error => <li key={error.id}>
        <code>{error.message}</code>
        <small>{clock(error.at)} · {error.role ? `${error.role[0].toUpperCase()}${error.role.slice(1)}` : 'Unknown role'}{error.area ? ` · ${error.area}` : ''} · {error.kind === 'request' ? 'Request failed' : 'Page error'}</small>
      </li>)}</ul>}
      {!live && <Button variant="ghost" icon="plus" onClick={() => { samples.current += 1; recordError('page', `Sample error from the demo (${samples.current})`); }}>Record a sample error</Button>}
    </div>
  </section>;
}
