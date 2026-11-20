import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Icon, Progress } from './ui';
import { useStore } from './store';
import { useAuth } from './auth';
import { ballotEvents } from './ballots';
import { contestKey, divisionOf, sameSchool, stageOf, type Section } from './tournament';
import { prelimStandings, samplePrelims } from './results';
import type { Member } from './tournamentApi';
import { amTabStaff, listTabStaff, loadTabSheet, setTabStaff, type TabRow } from './tabSheetApi';
import { printNow } from './PrintCenter';
import './print.css';
import './tabsheet.css';

/**
 * Live tab sheets: each contest's speakers × preliminary rounds, with every round's rank and score as
 * ballots arrive, the cumulative rank, the current place, and the rooms still out.
 *
 * Who sees what: the director and tab-room staff see every school; any other approved coach sees only
 * their own school's speakers (with each one's place in the contest, never another school's ranks).
 * Signed in, the database enforces this (supabase/tabsheet.sql); the demo coach is Wrenfield High.
 */

/** How often a signed-in tab sheet looks for new ballots. */
export const TAB_POLL_MS = 25_000;
/** How long a newly arrived rank stays highlighted. */
const FRESH_MS = 6_000;
/** Rooms the demo's "Simulate next ballots" brings in at a time. */
const DEMO_BATCH = 3;
const DEMO_SCHOOL = 'Wrenfield High';

const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4) % 4]}`;
const eventName = (eventId: string) => ballotEvents.find(event => event.id === eventId)?.name ?? eventId;
const contestName = (key: string) => { const [eventId, division] = key.split(':'); return `${division === 'novice' ? 'Novice ' : ''}${eventName(eventId)}`; };
const rowContest = (row: TabRow) => contestKey(row.eventId, row.division);
const cellKey = (row: Pick<TabRow, 'entryId' | 'round'>) => `${row.entryId}|${row.round}`;

/** Places and field sizes worked out from every row, with the same rules as the director's results (prelimStandings). */
export function withPlaces(rows: TabRow[]): TabRow[] {
  const places = new Map<string, { place: number; field: number }>();
  for (const contest of new Set(rows.map(rowContest))) {
    const mine = rows.filter(row => rowContest(row) === contest);
    const entries = [...new Map(mine.map(row => [row.entryId, { id: row.entryId, student: row.student, school: row.school, eventId: row.eventId, division: row.division }])).values()];
    const sections: Section[] = [...new Map(mine.map(row => [row.sectionId, { id: row.sectionId, round: row.round, eventId: row.eventId, division: row.division, label: row.label, room: row.room, judgeId: null,
      entryIds: mine.filter(other => other.sectionId === row.sectionId).sort((a, b) => a.order - b.order).map(other => other.entryId) }])).values()];
    const results = mine.filter(row => row.submitted && row.present && row.rank).map(row => ({ entryId: row.entryId, round: row.round, sectionId: row.sectionId, rank: row.rank!, rating: row.rating ?? 0 }));
    const standings = prelimStandings(entries, sections, results);
    standings.forEach(standing => places.set(standing.entryId, { place: standing.place, field: standings.length }));
  }
  return rows.map(row => ({ ...row, place: places.get(row.entryId)?.place ?? null, field: places.get(row.entryId)?.field ?? null }));
}

/** The demo's tab sheet, from the schedule and whatever results are in (sample results or simulated ballots). */
function useDemoRows(): TabRow[] {
  const { sections, entries, judges, prelimResults, tournament } = useStore();
  return useMemo(() => {
    const byRoom = new Map<string, typeof prelimResults>();
    prelimResults.forEach(result => byRoom.set(result.sectionId, [...(byRoom.get(result.sectionId) ?? []), result]));
    const rows: TabRow[] = sections.filter(section => stageOf(section, tournament) === 'prelim').flatMap(section => {
      const results = byRoom.get(section.id) ?? []; const submitted = results.length > 0;
      const judge = section.judgeName || judges.find(item => item.id === section.judgeId)?.name || '';
      return section.entryIds.flatMap((id, index) => {
        const entry = entries.find(item => item.id === id); if (!entry) return [];
        const result = results.find(item => item.entryId === id);
        return [{ entryId: id, student: entry.student, school: entry.school, eventId: section.eventId, division: divisionOf(section), round: section.round, sectionId: section.id, label: section.label.replace('Novice · ', ''),
          room: section.room, judge, order: index + 1, rank: result?.rank ?? null, rating: result ? result.rating : null, present: submitted ? !!result : null, submitted, place: null, field: null }];
      });
    });
    return withPlaces(rows);
  }, [sections, entries, judges, prelimResults, tournament]);
}

/** "Updated 12 s ago", ticking on its own so the grid doesn't re-render every second. */
function Ago({ at }: { at: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  if (at === null) return <span className="ts-ago">Not loaded yet</span>;
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  const text = seconds < 5 ? 'just now' : seconds < 60 ? `${seconds} s ago` : seconds < 3600 ? `${Math.floor(seconds / 60)} min ago` : new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return <span className="ts-ago"><Icon name="clock" size={14}/> Updated {text}</span>;
}

type Scope = { kind: 'all' } | { kind: 'school'; school: string };

/**
 * The tab sheet board. `audience` is who is looking: the director (every school), or a coach — their own
 * school (`school`), or every school if the director has made them tab-room staff.
 */
export function TabSheetBoard({ audience, school = '' }: { audience: 'director' | 'coach'; school?: string }) {
  const store = useStore();
  const { profile } = useAuth();
  const { live, tournamentId, tournament } = store;
  const demoRows = useDemoRows();
  const [liveRows, setLiveRows] = useState<TabRow[] | null>(null);
  const [staff, setStaff] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [updated, setUpdated] = useState<number | null>(live ? null : Date.now());
  const [contest, setContest] = useState('all');
  const [schoolFilter, setSchoolFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [announce, setAnnounce] = useState('');
  const inFlight = useRef(false);

  const coachSchool = live ? school : school || DEMO_SCHOOL;
  const scope: Scope = audience === 'director' || (live && staff) ? { kind: 'all' } : { kind: 'school', school: coachSchool };

  const load = useCallback(async () => {
    if (!live || !tournamentId || inFlight.current) return;
    inFlight.current = true; setLoading(true);
    try {
      const [rows, isStaff] = await Promise.all([loadTabSheet(tournamentId), audience === 'coach' && profile ? amTabStaff(tournamentId, profile.id) : Promise.resolve(false)]);
      setLiveRows(rows); setStaff(isStaff); setUpdated(Date.now()); setError('');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load the tab sheet.'); }
    finally { inFlight.current = false; setLoading(false); }
  }, [live, tournamentId, audience, profile]);

  // Signed in: load now, then poll while the page is visible, and look again on coming back to the tab.
  useEffect(() => {
    if (!live || !tournamentId) return;
    load();
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') load(); }, TAB_POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [live, tournamentId, load]);

  // Everything this viewer may see. In the demo the coach's rows are cut down here; signed in, the database already did it.
  const allRows = live ? liveRows ?? [] : demoRows;
  const rows = useMemo(() => scope.kind === 'school' ? allRows.filter(row => sameSchool(row.school, scope.school)) : allRows,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allRows, scope.kind, scope.kind === 'school' ? scope.school : '']);

  // Highlight ranks that weren't there last time.
  const seen = useRef<Map<string, number> | null>(null);
  const loaded = !live || liveRows !== null;
  useEffect(() => {
    if (!loaded) return; // the first load is the baseline, not news
    const now = new Map(rows.filter(row => row.submitted).map(row => [cellKey(row), row.rank ?? 0]));
    const before = seen.current; seen.current = now;
    if (!live && before) setUpdated(Date.now());
    if (!before) return;
    const arrived = [...now.keys()].filter(key => !before.has(key));
    if (arrived.length === 0) return;
    setFresh(new Set(arrived));
    const speakers = new Set(arrived.map(key => key.split('|')[0])).size;
    setAnnounce(`${arrived.length} new ${arrived.length === 1 ? 'rank' : 'ranks'} for ${speakers} ${speakers === 1 ? 'speaker' : 'speakers'}.`);
    const timer = setTimeout(() => setFresh(new Set()), FRESH_MS);
    return () => clearTimeout(timer);
  }, [rows, live, loaded]);

  const refresh = () => { if (live) load(); else setUpdated(Date.now()); };

  // Demo: ballots for the next few rooms still out "arrive", earliest round first.
  const prelimRooms = store.sections.filter(section => stageOf(section, tournament) === 'prelim');
  const roomsIn = new Set(store.prelimResults.map(result => result.sectionId));
  const demoOut = prelimRooms.filter(section => !roomsIn.has(section.id)).sort((a, b) => a.round - b.round);
  const simulate = () => {
    const round = demoOut[0]?.round; if (round === undefined) return;
    demoOut.filter(section => section.round === round).slice(0, DEMO_BATCH).forEach(section =>
      store.recordRoomResults(section.id, samplePrelims(store.entries, [section]).map(result => ({ entryId: result.entryId, rank: result.rank, rating: result.rating }))));
  };

  // Filters
  const contestOrder = (key: string) => { const [eventId, division] = key.split(':'); return tournament.eventIds.indexOf(eventId) * 2 + (division === 'novice' ? 1 : 0); };
  const contests = [...new Set(rows.map(rowContest))].sort((a, b) => contestOrder(a) - contestOrder(b) || a.localeCompare(b));
  const schools = [...new Set(rows.map(row => row.school))].sort((a, b) => a.localeCompare(b));
  const chosenContest = contest !== 'all' && contests.includes(contest) ? contest : 'all';
  const chosenSchool = scope.kind === 'all' && schoolFilter !== 'all' && schools.includes(schoolFilter) ? schoolFilter : 'all';
  const needle = query.trim().toLowerCase();
  const filtered = rows.filter(row => (chosenContest === 'all' || rowContest(row) === chosenContest) && (chosenSchool === 'all' || sameSchool(row.school, chosenSchool)));
  const shownRows = filtered.filter(row => !needle || row.student.toLowerCase().includes(needle));
  const shownContests = contests.filter(key => shownRows.some(row => rowContest(row) === key));

  const rooms = [...new Map(filtered.map(row => [row.sectionId, row])).values()];
  const out = rooms.filter(row => !row.submitted).sort((a, b) => a.round - b.round || contestOrder(rowContest(a)) - contestOrder(rowContest(b)) || a.label.localeCompare(b.label));
  const roundsOf = (key: string) => [...new Set(rows.filter(row => rowContest(row) === key).map(row => row.round))].sort((a, b) => a - b);

  type Line = { entryId: string; student: string; school: string; cells: Map<number, TabRow>; cum: number; score: number; place: number | null; field: number | null; ranked: number };
  const linesOf = (key: string): Line[] => {
    const mine = shownRows.filter(row => rowContest(row) === key);
    const lines = [...new Set(mine.map(row => row.entryId))].map(entryId => {
      const cells = new Map(mine.filter(row => row.entryId === entryId).map(row => [row.round, row]));
      const counted = [...cells.values()].filter(row => row.submitted && row.present && row.rank);
      const first = cells.values().next().value!;
      return { entryId, student: first.student, school: first.school, cells, cum: counted.reduce((sum, row) => sum + row.rank!, 0), score: counted.reduce((sum, row) => sum + (row.rating ?? 0), 0), place: first.place, field: first.field, ranked: counted.length };
    });
    return lines.sort((a, b) => (a.place ?? 9999) - (b.place ?? 9999) || a.student.localeCompare(b.student));
  };
  const tiedAt = (key: string, place: number | null) => place !== null && scope.kind === 'all' && new Set(rows.filter(row => rowContest(row) === key && row.place === place).map(row => row.entryId)).size > 1;

  const scheduleOut = live ? store.tournament.status !== 'registration' || audience === 'director' : prelimRooms.length > 0;
  const heading = scope.kind === 'all' ? 'Live tab sheet' : `${coachSchool || 'Your school'}: live tab sheet`;
  const note = audience === 'director' ? 'Every contest and school. Ranks and scores appear as soon as each room’s ballot is submitted.'
    : scope.kind === 'all' ? 'You’re tab-room staff: every school’s ranks, read-only. Only submitted ballots count.'
    : 'Your speakers’ ranks, scores and places as ballots come in. Other schools’ ranks stay private.';

  const cell = (line: Line, round: number, key: string) => {
    const row = line.cells.get(round);
    const isFresh = row ? fresh.has(cellKey(row)) : false;
    if (!row) return <td key={round} className="ts-cell ts-none"><span aria-hidden="true">–</span><span className="sr-only">Not scheduled</span></td>;
    if (!row.submitted) return <td key={round} className="ts-cell ts-out"><span className="ts-out-label">Out</span><small>{row.room}</small></td>;
    if (!row.present) return <td key={round} className={`ts-cell ts-ns${isFresh ? ' ts-fresh' : ''}`}><span className="ts-rank" aria-hidden="true">NS</span><span className="sr-only">No-show</span></td>;
    return <td key={round} className={`ts-cell${isFresh ? ' ts-fresh' : ''}${row.rank === 1 ? ' ts-first' : ''}`} data-contest={key}>
      <span className="ts-rank"><span className="sr-only">Rank </span>{row.rank}</span>
      <small className="ts-score"><span className="sr-only">Score </span>{row.rating ? row.rating : '—'}</small>
      {isFresh && <span className="sr-only"> (new)</span>}
    </td>;
  };

  const table = (key: string, forPrint = false) => {
    const rounds = roundsOf(key); const lines = linesOf(key);
    const keyRooms = rooms.filter(row => rowContest(row) === key);
    const caption = `${contestName(key)}${scope.kind === 'school' ? ` · ${coachSchool}` : chosenSchool !== 'all' ? ` · ${chosenSchool}` : ''}`;
    if (forPrint) return <table>
      <thead><tr><th>Speaker</th>{rounds.map(round => <th key={round}>R{round}</th>)}<th>Cum.</th><th>Score</th><th>Place</th></tr></thead>
      <tbody>{lines.map(line => <tr key={line.entryId}><td><b>{line.student}</b><br/><small>{line.school}</small></td>
        {rounds.map(round => { const row = line.cells.get(round); return <td key={round}>{!row ? '' : !row.submitted ? `Out · ${row.room}` : !row.present ? 'NS' : `${row.rank} (${row.rating || '—'})`}</td>; })}
        <td>{line.ranked ? line.cum : ''}</td><td>{line.ranked ? line.score : ''}</td><td>{line.place ? `${tiedAt(key, line.place) ? 'T-' : ''}${ordinal(line.place)} of ${line.field}` : ''}</td></tr>)}</tbody>
    </table>;
    return <section className="ts-contest" key={key} aria-labelledby={`ts-h-${key}`}>
      <header className="ts-contest-head"><h3 id={`ts-h-${key}`}>{contestName(key)}</h3><Badge tone={keyRooms.every(row => row.submitted) ? 'success' : 'warning'} icon={keyRooms.every(row => row.submitted) ? 'check' : 'clock'}>{keyRooms.filter(row => row.submitted).length} of {keyRooms.length} rooms in</Badge></header>
      <div className="ts-scroll" role="region" aria-label={`${caption} tab sheet`} tabIndex={0}>
        <table className="ts-table">
          <caption className="sr-only">{caption}: rank and score by round, cumulative rank, and current place</caption>
          <thead><tr><th scope="col" className="ts-speaker">Speaker</th>{rounds.map(round => <th scope="col" key={round}>R{round}</th>)}<th scope="col">Cum.</th><th scope="col">Score</th><th scope="col">Place</th></tr></thead>
          <tbody>{lines.map(line => <tr key={line.entryId}>
            <th scope="row" className="ts-speaker"><strong>{line.student}</strong>{scope.kind === 'all' && <small>{line.school}</small>}</th>
            {rounds.map(round => cell(line, round, key))}
            <td className="ts-total">{line.ranked ? line.cum : '–'}</td>
            <td className="ts-total">{line.ranked ? line.score : '–'}</td>
            <td className="ts-place">{line.place ? <><strong>{tiedAt(key, line.place) ? 'T-' : ''}{ordinal(line.place)}</strong><small>of {line.field}</small></> : <small>No rank yet</small>}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>;
  };

  const roomsDone = rooms.filter(row => row.submitted).length;
  const pct = rooms.length ? Math.round(roomsDone / rooms.length * 100) : 0;
  const printTitle = scope.kind === 'all' ? `Tab sheet${chosenSchool !== 'all' ? ` · ${chosenSchool}` : ''}` : `Tab sheet · ${coachSchool}`;
  const stamp = updated ? new Date(updated).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

  return <div className="ts-board">
    <section className="panel ts-panel">
      <div className="panel-head ts-head">
        <div><h2>{heading}</h2><p>{note}</p></div>
        <span className="ts-actions">
          <Ago at={updated}/>
          {live ? <Badge tone="info" icon="wifi">Refreshes every {TAB_POLL_MS / 1000} s</Badge> : <Badge tone="neutral">Demo</Badge>}
          <Button variant="secondary" icon="clock" onClick={refresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</Button>
          <Button variant="secondary" icon="file" onClick={printNow} disabled={shownContests.length === 0}>Print</Button>
          {!live && <Button icon="ballot" onClick={simulate} disabled={demoOut.length === 0}>Simulate next ballots</Button>}
        </span>
      </div>
      {error && <p className="ts-error" role="alert"><Icon name="warning" size={16}/> {error}</p>}
      {!live && prelimRooms.length > 0 && <p className="ts-demo-note"><Icon name="info" size={14}/> {demoOut.length === 0 ? 'Every preliminary room is in. Clear the results on the Results tab (or rebuild the schedule) to watch ballots arrive again.' : `Demo: “Simulate next ballots” brings in the next ${Math.min(DEMO_BATCH, demoOut.filter(section => section.round === demoOut[0].round).length)} rooms of ${demoOut[0].round === undefined ? 'the round' : `Round ${demoOut[0].round}`}, as if their judges just submitted.`}</p>}
      {rows.length > 0 && <>
        <div className="ts-progress"><span><strong>{roomsDone} of {rooms.length}</strong> {scope.kind === 'school' ? 'rooms with your speakers are in' : 'rooms in'}{chosenContest !== 'all' || chosenSchool !== 'all' ? ' (filtered)' : ''}</span><Progress value={pct} label="Rooms in"/></div>
        <div className="ts-filters">
          <label className="ts-filter"><span>Contest</span><select value={chosenContest} onChange={event => setContest(event.target.value)}><option value="all">All contests</option>{contests.map(key => <option key={key} value={key}>{contestName(key)}</option>)}</select></label>
          {scope.kind === 'all' && <label className="ts-filter"><span>School</span><select value={chosenSchool} onChange={event => setSchoolFilter(event.target.value)}><option value="all">All schools</option>{schools.map(name => <option key={name} value={name}>{name}</option>)}</select></label>}
          <label className="ts-filter ts-search"><span>Speaker</span><span className="search-box"><Icon name="search" size={16}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search a speaker" aria-label="Search a speaker" type="search"/></span></label>
        </div>
      </>}
      <p className="sr-only" aria-live="polite">{announce}</p>
    </section>

    {live && liveRows === null && !error ? <section className="access-banner"><span className="spinner"/><div><strong>Loading the tab sheet…</strong></div></section>
      : rows.length === 0 ? <section className="panel"><div className="schedule-empty"><span className="upload-illustration"><Icon name="ballot" size={30}/></span>
        <h3>{audience === 'director' ? 'No preliminary rooms yet' : scheduleOut ? 'No speakers to show yet' : 'Nothing here yet'}</h3>
        <p>{audience === 'director' ? 'Build the schedule on the Setup tab; each preliminary room appears here, with ranks as ballots come in.' : !scheduleOut ? 'The tab sheet opens once the director publishes the schedule.' : 'None of your speakers are in a preliminary room yet.'}</p></div></section>
      : <div className="ts-layout">
        <div className="ts-contests">{shownContests.length === 0 ? <section className="panel"><p className="ts-empty">No speaker matches “{query.trim()}”.</p></section> : shownContests.map(key => table(key))}</div>
        <aside className="panel ts-out-panel" aria-labelledby="ts-out-h">
          <div className="panel-head"><div><h2 id="ts-out-h">Rooms still out</h2><p>{out.length === 0 ? 'Every room is in.' : `${out.length} ${out.length === 1 ? 'ballot' : 'ballots'} not submitted yet`}</p></div><Badge tone={out.length ? 'warning' : 'success'} icon={out.length ? 'clock' : 'check'}>{out.length}</Badge></div>
          {out.length > 0 && <ul className="ts-out-list" tabIndex={0} aria-label="Rooms whose ballot is not in">{out.slice(0, 60).map(row => <li key={row.sectionId}>
            <span className="ts-out-round">R{row.round}</span>
            <span><strong>{contestName(rowContest(row))}{row.label ? ` · ${row.label}` : ''}</strong><small>{row.room} · {row.judge ? `Judge: ${row.judge}` : 'No judge assigned'}</small></span>
          </li>)}</ul>}
          {out.length > 60 && <p className="ts-empty">And {out.length - 60} more.</p>}
        </aside>
      </div>}

    {shownContests.length > 0 && <div className="print-doc print-only" aria-hidden="true">
      {shownContests.map(key => <div key={key} className="print-page ts-print">
        <header className="print-head"><strong>{tournament.name}</strong><span>{printTitle} · {contestName(key)}{stamp ? ` · as of ${stamp}` : ''}</span></header>
        {table(key, true)}
        <p className="print-meta">Rank (score) by round. “Out” means the room’s ballot wasn’t in yet; NS is a no-show. Only submitted ballots count.</p>
      </div>)}
    </div>}
  </div>;
}

/** The director's list of coaches marked as tab-room staff, for the People tab. Signed in only. */
export function useTabStaff() {
  const { live, tournamentId } = useStore();
  const [ids, setIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!live || !tournamentId) return;
    listTabStaff(tournamentId).then(setIds).catch(caught => setError(caught instanceof Error ? caught.message : 'Could not load tab-room staff.'));
  }, [live, tournamentId]);
  const toggle = async (member: Member, on: boolean) => {
    if (!tournamentId) return;
    setIds(list => on ? [...list, member.userId] : list.filter(id => id !== member.userId)); setError('');
    try { await setTabStaff(tournamentId, member.userId, on); }
    catch (caught) { setIds(list => on ? list.filter(id => id !== member.userId) : [...list, member.userId]); setError(caught instanceof Error ? caught.message : 'Could not change tab-room staff.'); }
  };
  return { ids, toggle, error };
}

/** A switch on an approved coach's row in the People tab: tab-room staff see every school's tab sheet. */
export function TabStaffToggle({ member, staff }: { member: Member; staff: ReturnType<typeof useTabStaff> }) {
  if (member.role !== 'coach' || member.status !== 'approved') return null;
  const on = staff.ids.includes(member.userId);
  return <label className="ts-staff-toggle" title="Tab-room staff see every school's live tab sheet, read-only.">
    <input type="checkbox" checked={on} onChange={event => staff.toggle(member, event.target.checked)}/>
    <span>Tab-room staff</span>
  </label>;
}

/** Shown under the People list when changing tab-room staff fails. */
export function TabStaffError({ staff }: { staff: ReturnType<typeof useTabStaff> }) {
  return staff.error ? <p className="ts-error" role="alert"><Icon name="warning" size={16}/> {staff.error}</p> : null;
}

