import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Icon } from './ui';
import { authConfigured } from './auth';
import { useStore } from './store';
import { sameSchool } from './tournament';
import { ALL, compareHref, compareTeams, contestName, loadComparison, ordinal, schoolsIn, suggestRivals, takeaway, type CompareData, type Comparison, type DivisionFilter, type Meet } from './teamCompare';
import './publicResults.css';
import './teamCompare.css';

/**
 * Compare teams: your school against a rival at the tournaments you both attended, from published
 * final placings and team points only. Used on the public page `#/compare/<school>/<rival>` and in the
 * coach and student workspaces.
 */

const resultsLink = (id: string) => `#/results/${encodeURIComponent(id.trim())}`;
const schoolLink = (school: string) => `#/school/${encodeURIComponent(school.trim())}`;
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const average = (total: number, count: number) => count ? (Math.round((total / count) * 10) / 10).toString() : '—';
const shortDate = (date: string) => { const parsed = Date.parse(date); return Number.isNaN(parsed) ? date : new Date(parsed).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
const placeText = (place: number | null) => place ? ordinal(place) : 'no team points';

type Load = { state: 'loading' } | { state: 'failed'; message: string } | { state: 'ready'; data: CompareData; key: string };

function useComparisonData(school: string, rival: string): Load {
  const store = useStore();
  // As on the other public pages: the demo tournament counts only while it stays finished and published.
  const includeDemo = !authConfigured && store.tournament.status === 'finished';
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [version, setVersion] = useState(0);
  useEffect(() => { const bump = () => setVersion(value => value + 1); window.addEventListener('orator-published', bump); return () => window.removeEventListener('orator-published', bump); }, []);
  useEffect(() => {
    let current = true;
    const key = `${school}|${rival}`;
    setLoad(previous => previous.state === 'ready' ? previous : { state: 'loading' });
    loadComparison(school, rival, includeDemo)
      .then(data => { if (current) setLoad({ state: 'ready', data, key }); })
      .catch(caught => { if (current) setLoad({ state: 'failed', message: caught instanceof Error ? caught.message : 'Results could not be loaded.' }); });
    return () => { current = false; };
  }, [school, rival, includeDemo, version]);
  return load;
}

/** The chart's width in CSS pixels, so its text stays a readable size from a phone to a desktop. */
function useWidth(initial = 640): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(initial);
  useLayoutEffect(() => {
    const node = ref.current; if (!node) return;
    const measure = () => { const next = Math.round(node.getBoundingClientRect().width); if (next > 0) setWidth(next); };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** A bar with a 4px rounded data end; square where it meets the baseline. `dir` 1 grows right, -1 grows left. */
function barPath(base: number, y: number, length: number, height: number, dir: 1 | -1) {
  if (length <= 0) return '';
  const r = Math.min(4, length, height / 2);
  const end = base + dir * length;
  const inner = end - dir * r;
  const sweep = dir === 1 ? 1 : 0;
  return `M${base} ${y} H${inner} A${r} ${r} 0 0 ${sweep} ${end} ${y + r} V${y + height - r} A${r} ${r} 0 0 ${sweep} ${inner} ${y + height} H${base} Z`;
}

const niceStep = (max: number) => { const raw = max / 4; const power = 10 ** Math.floor(Math.log10(Math.max(raw, 1))); const unit = raw / power; return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10) * power; };

function Legend({ you, them, youLabel }: { you: string; them: string; youLabel: string }) {
  return <ul className="tc-legend" aria-label="Legend"><li><span className="tc-swatch you" aria-hidden="true"/>{you}{youLabel && <small> ({youLabel})</small>}</li><li><span className="tc-swatch them" aria-hidden="true"/>{them}</li></ul>;
}

function ViewToggle({ table, onChange, what }: { table: boolean; onChange: (table: boolean) => void; what: string }) {
  return <button type="button" className="tc-toggle" aria-pressed={table} onClick={() => onChange(!table)}><Icon name={table ? 'growth' : 'file'} size={14}/><span>{table ? `Show ${what} as a chart` : `Show ${what} as a table`}</span></button>;
}

// ── Tournament by tournament: paired horizontal bars ──

function MeetsChart({ meets, school, rival }: { meets: Meet[]; school: string; rival: string }) {
  const [ref, width] = useWidth();
  const valueRoom = 112, rowHeight = 66, top = 22;
  const max = Math.max(1, ...meets.flatMap(meet => [meet.you.points, meet.them.points]));
  const step = niceStep(max); const axisMax = Math.ceil(max / step) * step;
  const span = Math.max(60, width - valueRoom);
  const x = (value: number) => (value / axisMax) * span;
  const height = top + meets.length * rowHeight;
  const ticks = Array.from({ length: Math.floor(axisMax / step) + 1 }, (_, index) => index * step);
  const label = `Team points at each shared tournament. ${meets.map(meet => `${meet.tournament.name}: ${school} ${meet.you.points} (${placeText(meet.you.place)}), ${rival} ${meet.them.points} (${placeText(meet.them.place)})`).join('. ')}.`;
  return <div ref={ref} className="tc-chart-wrap">
    <svg className="tc-chart" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {ticks.map(tick => <g key={tick}><line className="tc-grid" x1={x(tick) + 0.5} x2={x(tick) + 0.5} y1={top - 4} y2={height - 8}/><text className="tc-tick" x={x(tick)} y={11} textAnchor={tick === 0 ? 'start' : 'middle'}>{tick}</text></g>)}
      {meets.map((meet, index) => {
        const y = top + index * rowHeight;
        return <g key={meet.tournament.id}>
          <title>{`${meet.tournament.name} (${meet.tournament.date}): ${school} ${meet.you.points} points, ${placeText(meet.you.place)}; ${rival} ${meet.them.points} points, ${placeText(meet.them.place)}`}</title>
          <text className="tc-row-label" x={0} y={y + 16}>{meet.tournament.name}</text>
          <path className="tc-bar you" d={barPath(0, y + 23, x(meet.you.points), 14, 1)}/>
          <text className="tc-value" x={x(meet.you.points) + 6} y={y + 34}>{meet.you.points}<tspan className="tc-value-note"> · {meet.you.place ? ordinal(meet.you.place) : '—'}</tspan></text>
          <path className="tc-bar them" d={barPath(0, y + 41, x(meet.them.points), 14, 1)}/>
          <text className="tc-value" x={x(meet.them.points) + 6} y={y + 52}>{meet.them.points}<tspan className="tc-value-note"> · {meet.them.place ? ordinal(meet.them.place) : '—'}</tspan></text>
        </g>;
      })}
      <line className="tc-axis" x1={0.5} x2={0.5} y1={top - 4} y2={height - 8}/>
    </svg>
  </div>;
}

function MeetsTable({ meets, school, rival, student }: { meets: Meet[]; school: string; rival: string; student?: string }) {
  return <div className="tc-table-wrap"><table className="tc-table">
    <caption className="pr-visually-hidden">Team points and team place at each shared tournament</caption>
    <thead><tr><th scope="col">Tournament</th><th scope="col">{school}</th><th scope="col">{rival}</th><th scope="col">Ahead</th>{student && <th scope="col">Your points</th>}</tr></thead>
    <tbody>{meets.map(meet => <tr key={meet.tournament.id}>
      <th scope="row"><a href={resultsLink(meet.tournament.id)}>{meet.tournament.name}</a><small>{shortDate(meet.tournament.date)}</small></th>
      <td><strong>{meet.you.points}</strong><small>{placeText(meet.you.place)} · {plural(meet.you.finalists, 'finalist')}</small></td>
      <td><strong>{meet.them.points}</strong><small>{placeText(meet.them.place)} · {plural(meet.them.finalists, 'finalist')}</small></td>
      <td>{meet.leader === 'tie' ? 'Tied' : meet.leader === 'you' ? school : rival}</td>
      {student && <td><strong>{meet.you.student ?? 0}</strong><small>{plural(meet.you.studentFinals ?? 0, 'final')}</small></td>}
    </tr>)}</tbody>
  </table></div>;
}

// ── Where they score: a diverging bar per event ──

function EventsChart({ comparison }: { comparison: Comparison }) {
  const [ref, width] = useWidth();
  const { events, school, rival } = comparison;
  const rowHeight = 50, top = 26, valueRoom = 34;
  const center = Math.round(width / 2);
  const half = Math.max(30, center - valueRoom);
  const max = Math.max(1, ...events.flatMap(row => [row.you, row.them]));
  const x = (value: number) => (value / max) * half;
  const height = top + events.length * rowHeight + 4;
  const lead = (you: number, them: number) => you === them ? 'Even' : you > them ? `${school} +${you - them}` : `${rival} +${them - you}`;
  const label = `Team points by event, ${school} to the left and ${rival} to the right. ${events.map(row => `${contestName(row.contest)}: ${school} ${row.you}, ${rival} ${row.them}`).join('. ')}.`;
  return <div ref={ref} className="tc-chart-wrap">
    <svg className="tc-chart" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <text className="tc-side" x={center - 8} y={13} textAnchor="end">◂ {school}</text>
      <text className="tc-side" x={center + 8} y={13} textAnchor="start">{rival} ▸</text>
      {events.map((row, index) => {
        const y = top + index * rowHeight;
        return <g key={row.contest}>
          <title>{`${contestName(row.contest)}: ${school} ${row.you} points from ${plural(row.youFinals, 'final')}; ${rival} ${row.them} points from ${plural(row.themFinals, 'final')}`}</title>
          <line className="tc-row-rule" x1={0} x2={width} y1={y + 0.5} y2={y + 0.5}/>
          <text className="tc-row-label" x={0} y={y + 17}>{contestName(row.contest)}</text>
          <text className="tc-row-note" x={width} y={y + 17} textAnchor="end">{lead(row.you, row.them)}</text>
          <path className="tc-bar you" d={barPath(center - 1, y + 26, x(row.you), 16, -1)}/>
          <path className="tc-bar them" d={barPath(center + 1, y + 26, x(row.them), 16, 1)}/>
          <text className="tc-value" x={center - 1 - x(row.you) - 5} y={y + 38} textAnchor="end">{row.you}</text>
          <text className="tc-value" x={center + 1 + x(row.them) + 5} y={y + 38}>{row.them}</text>
        </g>;
      })}
      <line className="tc-axis" x1={center} x2={center} y1={top} y2={height - 2}/>
    </svg>
  </div>;
}

function EventsTable({ comparison, student }: { comparison: Comparison; student?: string }) {
  const { events, school, rival } = comparison;
  return <div className="tc-table-wrap"><table className="tc-table">
    <caption className="pr-visually-hidden">Team points by event</caption>
    <thead><tr><th scope="col">Event</th><th scope="col">{school}</th><th scope="col">{rival}</th><th scope="col">Difference</th>{student && <th scope="col">Your points</th>}</tr></thead>
    <tbody>{events.map(row => <tr key={row.contest}>
      <th scope="row">{contestName(row.contest)}</th>
      <td><strong>{row.you}</strong><small>{plural(row.youFinals, 'final')}</small></td>
      <td><strong>{row.them}</strong><small>{plural(row.themFinals, 'final')}</small></td>
      <td>{row.you === row.them ? 'Even' : row.you > row.them ? `${school} +${row.you - row.them}` : `${rival} +${row.them - row.you}`}</td>
      {student && <td><strong>{row.student ?? 0}</strong></td>}
    </tr>)}</tbody>
  </table></div>;
}

function ScaleNotes({ comparison }: { comparison: Comparison }) {
  if (comparison.notes.length === 0) return <p className="tc-note"><Icon name="info" size={14}/><span>Event points use each tournament’s team point scale (NSAA: 20, 18, 16, 14, 12, 10 for 1st to 6th in a final).</span></p>;
  return <ul className="tc-notes" aria-label="Team point scales">
    {comparison.notes.map(({ tournament, scale }) => <li key={tournament.id}><Icon name="info" size={14}/><span><strong>{tournament.name}</strong>{' '}
      {!scale.adds ? (scale.source === 'published' ? `published its scale (${scale.scale.join('-')}), but the event points don’t add up to the published team totals, so its event breakdown is approximate.` : 'didn’t publish its team point scale, and the NSAA scale doesn’t match its published team totals, so its event breakdown is approximate.')
        : [scale.scale.join() !== '20,18,16,14,12,10' && `used its own team point scale (${scale.scale.join('-')})`, scale.noviceCounts && 'counted novice finals toward team points'].filter(Boolean).join(' and ') + '.'}</span></li>)}
  </ul>;
}

// ── Student: your points ──

function YourPoints({ comparison, student }: { comparison: Comparison; student: string }) {
  const { meets, summary, school } = comparison;
  return <section className="panel tc-panel" aria-labelledby="tc-yours">
    <div className="panel-head"><div><h2 id="tc-yours">Your points</h2><p>Team points {student} earned for {school} from published finals</p></div></div>
    <div className="tc-body">
      <p className="tc-takeaway">{summary.studentTotal > 0 ? `You earned ${summary.studentTotal} of ${school}’s ${summary.youTotal} team points${summary.youTotal ? ` (${Math.round((summary.studentTotal / summary.youTotal) * 100)}%)` : ''} at ${plural(summary.shared, 'tournament')}.` : `No published final lists you at ${summary.shared === 1 ? 'this tournament' : 'these tournaments'} yet. Team points come from final-round placings.`}</p>
      <div className="tc-table-wrap"><table className="tc-table tc-yours">
        <caption className="pr-visually-hidden">Your team points at each tournament</caption>
        <thead><tr><th scope="col">Tournament</th><th scope="col">Your points</th><th scope="col">Share of team points</th></tr></thead>
        <tbody>{meets.map(meet => { const share = meet.you.points ? (meet.you.student ?? 0) / meet.you.points : 0; return <tr key={meet.tournament.id}>
          <th scope="row">{meet.tournament.name}<small>{shortDate(meet.tournament.date)}</small></th>
          <td><strong>{meet.you.student ?? 0}</strong><small>{plural(meet.you.studentFinals ?? 0, 'final')}</small></td>
          <td><span className="tc-share"><svg width="100%" height="10" aria-hidden="true"><rect className="tc-share-track" x="0" y="0" width="100%" height="10" rx="4"/>{share > 0 && <rect className="tc-bar you" x="0" y="0" width={`${Math.max(2, share * 100)}%`} height="10" rx="4"/>}</svg><small>{Math.round(share * 100)}% of {meet.you.points}</small></span></td>
        </tr>; })}</tbody>
      </table></div>
    </div>
  </section>;
}

// ── Pickers ──

function SchoolInput({ id, label, value, schools, onPick }: { id: string; label: string; value: string; schools: string[]; onPick: (school: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const commit = (text: string) => { const known = schools.find(name => sameSchool(name, text)); if (known && !sameSchool(known, value)) onPick(known); else if (!known && text.trim() && !sameSchool(text, value)) onPick(text.trim()); };
  return <label className="pr-field tc-field"><span>{label}</span>
    <input id={id} type="search" value={draft} list={`${id}-list`} autoComplete="off" onChange={event => { setDraft(event.target.value); const known = schools.find(name => sameSchool(name, event.target.value)); if (known && !sameSchool(known, value)) onPick(known); }} onBlur={() => commit(draft)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(draft); } }}/>
    <datalist id={`${id}-list`}>{schools.map(name => <option key={name} value={name}/>)}</datalist>
  </label>;
}

function Tile({ label, you, them, note, youName, themName }: { label: string; you: string; them: string; note?: string; youName: string; themName: string }) {
  return <div className="tc-tile"><small>{label}</small>
    <dl><div><dt><span className="tc-swatch you" aria-hidden="true"/>{youName}</dt><dd>{you}</dd></div><div><dt><span className="tc-swatch them" aria-hidden="true"/>{themName}</dt><dd>{them}</dd></div></dl>
    {note && <span>{note}</span>}</div>;
}

export type TeamCompareProps = {
  /** Your school (the coach's or student's), the default for "Your team". */
  school: string;
  /** The rival to start with; otherwise the school you meet most often. */
  rival?: string;
  /** A student's name, to add "Your points". */
  student?: string;
  /** On the public page the choices are kept in the address, and the page has its own heading. */
  page?: boolean;
};

export function TeamCompare({ school: initialSchool, rival: initialRival = '', student, page = false }: TeamCompareProps) {
  const [school, setSchool] = useState(initialSchool);
  const [rival, setRival] = useState(initialRival);
  const [season, setSeason] = useState('');
  const [tournamentId, setTournamentId] = useState(ALL);
  const [division, setDivision] = useState<DivisionFilter>(ALL);
  const [meetsTable, setMeetsTable] = useState(false);
  const [eventsTable, setEventsTable] = useState(false);
  useEffect(() => { setSchool(initialSchool); }, [initialSchool]);
  useEffect(() => { setRival(initialRival); }, [initialRival]);
  // The pickers rewrite the address without a hashchange, so the route above can lag behind: follow links here directly.
  useEffect(() => {
    if (!page) return;
    const follow = () => {
      const [head, first, second] = window.location.hash.replace(/^#\/?/, '').split('/');
      if (head !== 'compare' || !first) return;
      try { setSchool(decodeURIComponent(first)); setRival(second ? decodeURIComponent(second) : ''); setTournamentId(ALL); } catch { /* a malformed address: keep the current choice */ }
    };
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, [page]);
  const load = useComparisonData(school, rival);
  const data = load.state === 'ready' ? load.data : null;
  const suggestions = useMemo(() => data ? suggestRivals(data.teams, school) : [], [data, school]);
  const schools = useMemo(() => data ? schoolsIn(data) : [], [data]);
  // No rival chosen yet: start with the school you meet most often.
  useEffect(() => { if (!rival && suggestions.length) setRival(suggestions[0].school); }, [rival, suggestions]);
  // Keep the public page's address in step with the choices, without jumping to the top.
  useEffect(() => { if (page && school.trim()) history.replaceState(null, '', compareHref(school, rival)); }, [page, school, rival]);
  const ownSchool = !student && sameSchool(school, initialSchool) && !page;
  const youWord = student ? (sameSchool(school, initialSchool) ? 'your team' : '') : ownSchool ? 'your team' : '';
  // While the other school's placings load, the previous rows are kept for the pickers but not compared.
  const fresh = load.state === 'ready' && load.key === `${school}|${rival}` ? load.data : null;
  const full = useMemo(() => fresh && rival && !sameSchool(school, rival) ? compareTeams(fresh, school, rival, { season: season || undefined, tournamentId, division, student: student && sameSchool(school, initialSchool) ? student : undefined }) : null, [fresh, school, rival, season, tournamentId, division, student, initialSchool]);
  // Novice finals that earned nobody team points (novice didn't count) only clutter "All divisions"; the Novice view still lists them.
  const hasNovice = Boolean(full?.events.some(row => row.division === 'novice')) || division === 'novice';
  const comparison = useMemo(() => full && division === ALL ? { ...full, events: full.events.filter(row => row.division === 'varsity' || row.you + row.them > 0) } : full, [full, division]);
  const showStudent = Boolean(student && sameSchool(school, initialSchool));
  const speaking = (page || !youWord) ? school : 'you';

  const pick = (setter: (value: string) => void) => (value: string) => { setter(value); setTournamentId(ALL); };
  const heading = <>{page ? <header className="pr-intro"><span className="eyebrow">Compare teams</span><h1>{school}{rival ? <> <span className="tc-vs">vs</span> {rival}</> : ''}</h1><p>Head to head at the tournaments both schools attended, from published final placings and team points. <a href={schoolLink(school)}>{school} season results</a></p></header>
    : <div className="tc-intro"><div><h2>Compare teams</h2><p>Your team against another school, from published finals and team points</p></div>{rival && <a className="button button-secondary" href={compareHref(school, rival)}><Icon name="arrow" size={16}/><span>Open the public page</span></a>}</div>}</>;

  const controls = <section className="panel tc-controls" aria-label="Choose the teams to compare">
    <div className="tc-pickers">
      <SchoolInput id={`tc-you${page ? '-page' : ''}`} label="Your team" value={school} schools={schools} onPick={pick(setSchool)}/>
      <SchoolInput id={`tc-rival${page ? '-page' : ''}`} label="Compare with" value={rival} schools={schools.filter(name => !sameSchool(name, school))} onPick={pick(setRival)}/>
      {comparison && comparison.seasons.length > 0 && <label className="pr-field tc-field"><span>Season</span><select value={comparison.season} onChange={event => { setSeason(event.target.value); setTournamentId(ALL); }}>{comparison.seasons.map(item => <option key={item} value={item}>{item}</option>)}{comparison.seasons.length > 1 && <option value={ALL}>All seasons</option>}</select></label>}
      {comparison && comparison.sharedInSeason.length > 1 && <label className="pr-field tc-field"><span>Tournament</span><select value={tournamentId} onChange={event => setTournamentId(event.target.value)}><option value={ALL}>All {comparison.sharedInSeason.length} shared tournaments</option>{comparison.sharedInSeason.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    </div>
    {suggestions.length > 0 && <div className="tc-suggest"><span id={`tc-suggest-label${page ? '-page' : ''}`}>Schools {school} meets most often</span><ul aria-labelledby={`tc-suggest-label${page ? '-page' : ''}`}>{suggestions.map(item => <li key={item.school}><button type="button" aria-pressed={sameSchool(item.school, rival)} onClick={() => pick(setRival)(item.school)}><strong>{item.school}</strong><small>{plural(item.meets, 'meet')} · {item.placesApart.toFixed(1)} places apart</small></button></li>)}</ul></div>}
  </section>;

  let body: ReactNode;
  if (load.state === 'loading' || (load.state === 'ready' && !fresh && rival && !sameSchool(school, rival))) body = <div className="pr-status" role="status"><span className="spinner"/><p>Loading results…</p></div>;
  else if (load.state === 'failed') body = <div className="pr-status" role="alert"><Icon name="warning"/><p>{load.message}</p></div>;
  else if (!school.trim()) body = <p className="tc-empty">Choose your team to compare.</p>;
  else if (!rival || sameSchool(school, rival)) body = <p className="tc-empty">{suggestions.length ? 'Choose a school to compare with.' : `No published results list ${school} yet. Results appear here once tournament directors publish them.`}</p>;
  else if (!comparison || comparison.meets.length === 0) body = <p className="tc-empty">No published tournament lists both {school} and {rival}. Pick another school, or check the spelling.</p>;
  else {
    const { summary, meets } = comparison;
    const scope = tournamentId !== ALL ? meets[0].tournament.name : `${plural(summary.shared, 'shared tournament')}${comparison.season === ALL ? '' : ` · ${comparison.season}`}`;
    body = <>
      <div className="tc-tiles" aria-label={`Head to head: ${scope}`}>
        <Tile label="Finished ahead" youName={school} themName={rival} you={String(summary.youAhead)} them={String(summary.themAhead)} note={`on team points, of ${plural(summary.shared, 'tournament')}${summary.ties ? ` · ${plural(summary.ties, 'tie')}` : ''}`}/>
        <Tile label="Team points" youName={school} themName={rival} you={String(summary.youTotal)} them={String(summary.themTotal)} note={`average ${average(summary.youTotal, summary.shared)} vs ${average(summary.themTotal, summary.shared)} a tournament`}/>
        <Tile label="Finalists" youName={school} themName={rival} you={String(summary.youFinalists)} them={String(summary.themFinalists)} note="placings in published finals"/>
        <Tile label="Champions" youName={school} themName={rival} you={String(summary.youChampions)} them={String(summary.themChampions)} note="1st-place finishes"/>
      </div>
      {showStudent && <p className="tc-student-line"><Icon name="sparkle" size={14}/><span>You earned <strong>{summary.studentTotal}</strong> of {school}’s {summary.youTotal} team points here.</span></p>}

      <section className="panel tc-panel" aria-labelledby={`tc-meets${page ? '-page' : ''}`}>
        <div className="panel-head"><div><h2 id={`tc-meets${page ? '-page' : ''}`}>Tournament by tournament</h2><p>Team points and team place · {scope}</p></div><ViewToggle table={meetsTable} onChange={setMeetsTable} what="tournaments"/></div>
        <div className="tc-body">
          <Legend you={school} them={rival} youLabel={youWord}/>
          {meetsTable ? <MeetsTable meets={meets} school={school} rival={rival} student={showStudent ? student : undefined}/> : <MeetsChart meets={meets} school={school} rival={rival}/>}
        </div>
      </section>

      <section className="panel tc-panel" aria-labelledby={`tc-events${page ? '-page' : ''}`}>
        <div className="panel-head"><div><h2 id={`tc-events${page ? '-page' : ''}`}>Where they score</h2><p>Team points by event, from published final placings</p></div><ViewToggle table={eventsTable} onChange={setEventsTable} what="events"/></div>
        <div className="tc-body">
          <div className="pr-seasons tc-divisions" role="group" aria-label="Division">{(hasNovice ? [ALL, 'varsity', 'novice'] as DivisionFilter[] : [ALL] as DivisionFilter[]).map(item => <button key={item} type="button" aria-pressed={division === item} className={division === item ? 'active' : ''} onClick={() => setDivision(item)}>{item === ALL ? 'All divisions' : item === 'varsity' ? 'Varsity' : 'Novice'}</button>)}</div>
          <p className="tc-takeaway" aria-live="polite">{takeaway(comparison, speaking)}</p>
          {comparison.events.length === 0 ? <p className="tc-empty">No finalists from either school{division === ALL ? '' : ` in the ${division} division`}.</p>
            : <><Legend you={school} them={rival} youLabel={youWord}/>{eventsTable ? <EventsTable comparison={comparison} student={showStudent ? student : undefined}/> : <EventsChart comparison={comparison}/>}</>}
          {division !== 'varsity' && hasNovice && comparison.noviceCounted < meets.length && <p className="tc-note"><Icon name="info" size={14}/><span>Novice finals earned team points at {comparison.noviceCounted} of {plural(meets.length, 'tournament')}; elsewhere they don’t count toward team points, so they show 0 here.</span></p>}
          <ScaleNotes comparison={comparison}/>
        </div>
      </section>

      {showStudent && student && <YourPoints comparison={comparison} student={student}/>}
    </>;
  }

  return <div className={`tc${page ? ' tc-page' : ''}`}>
    {heading}
    {controls}
    {body}
    <p className="pr-note"><Icon name="lock" size={14}/><span>Built only from published final placings and team points. Ballots, judges’ comments, and preliminary rankings stay private.</span></p>
  </div>;
}
