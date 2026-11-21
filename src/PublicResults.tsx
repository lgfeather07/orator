import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Badge, Icon, Logo } from './ui';
import { LegalFooter } from './legal';
import { authConfigured, useAuth } from './auth';
import { useStore } from './store';
import { ballotEvents } from './ballots';
import { parseContest, qualifierLabel, sameSchool } from './tournament';
import { loadPublished, newestFirst, sameName, seasonOf, whenOf, WITHHELD, type PublishedPlacing, type PublishedResults, type PublishedTeam, type PublishedTournament } from './publicResultsApi';
import { TeamCompare } from './TeamCompare';
import { compareHref } from './teamCompare';
import './publicResults.css';

/**
 * Public results pages, open to anyone without an account:
 *   #/results                      tournaments with published results
 *   #/results/<tournament id>      final placings and team points
 *   #/school/<school>              a school's season history
 *   #/student/<school>/<student>   a student's season
 *   #/compare/<school>/<rival>     two schools head to head (TeamCompare.tsx)
 */
export type PublicRoute =
  | { kind: 'list' }
  | { kind: 'tournament'; id: string }
  | { kind: 'school'; school: string }
  | { kind: 'student'; school: string; student: string }
  | { kind: 'compare'; school: string; rival?: string };

const part = (text: string) => encodeURIComponent(text.trim());
export const resultsHref = () => '#/results';
export const tournamentHref = (id: string) => `#/results/${part(id)}`;
export const schoolHref = (school: string) => `#/school/${part(school)}`;
export const studentHref = (school: string, student: string) => `#/student/${part(school)}/${part(student)}`;

function readRoute(): PublicRoute | null {
  const [head, ...rest] = window.location.hash.replace(/^#\/?/, '').split('/');
  let parts: string[];
  try { parts = rest.map(item => decodeURIComponent(item)).filter(item => item.trim() !== ''); } catch { return null; }
  if (head === 'results') return parts[0] ? { kind: 'tournament', id: parts[0] } : { kind: 'list' };
  if (head === 'school' && parts[0]) return { kind: 'school', school: parts[0] };
  if (head === 'student' && parts[0] && parts[1]) return { kind: 'student', school: parts[0], student: parts[1] };
  if (head === 'compare' && parts[0]) return { kind: 'compare', school: parts[0], rival: parts[1] };
  return null;
}

/** Like useLegalRoute: the public results pages live in the address, so they can be linked to and shared. */
export function usePublicRoute(): [PublicRoute | null, (route: PublicRoute | null) => void] {
  const [route, setRoute] = useState<PublicRoute | null>(readRoute);
  useEffect(() => {
    const sync = () => { const next = readRoute(); setRoute(next); if (next) window.scrollTo(0, 0); };
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  const go = (next: PublicRoute | null) => {
    if (!next) { history.replaceState(null, '', window.location.pathname + window.location.search); setRoute(null); window.scrollTo(0, 0); return; }
    window.location.hash = (next.kind === 'list' ? resultsHref() : next.kind === 'tournament' ? tournamentHref(next.id) : next.kind === 'school' ? schoolHref(next.school) : next.kind === 'compare' ? compareHref(next.school, next.rival) : studentHref(next.school, next.student)).slice(1);
  };
  return [route, go];
}

// ── Shared bits ──

/** "Informative" for varsity, "Novice Informative" for the novice division. */
const contestName = (contest: string) => { const { eventId, division } = parseContest(contest); const name = ballotEvents.find(event => event.id === eventId)?.name ?? eventId; return division === 'novice' ? `Novice ${name}` : name; };
/** Events in ballot order, varsity before novice. */
const contestOrder = (contest: string) => { const { eventId, division } = parseContest(contest); const index = ballotEvents.findIndex(event => event.id === eventId); return (index < 0 ? 99 : index) * 2 + (division === 'novice' ? 1 : 0); };
const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4) % 4]}`;
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const publishedOn = (iso: string) => { const when = new Date(iso); return Number.isNaN(when.getTime()) ? '' : when.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' }); };

function Place({ place }: { place: number }) {
  return <span className={`pr-place ${place === 1 ? 'first' : ''}`} aria-label={`${ordinal(place)} place`}>{place}</span>;
}

type Load = { state: 'loading' } | { state: 'failed'; message: string } | { state: 'ready'; data: PublishedResults };

/** Load published rows for a page, and again when the demo director publishes or unpublishes. */
function usePublished(filter: { tournamentId?: string; school?: string; student?: string }): Load {
  const store = useStore();
  // In the demo, the demo tournament's results are public only while it stays finished, as in the database.
  const includeDemo = !authConfigured && store.tournament.status === 'finished';
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [version, setVersion] = useState(0);
  const key = JSON.stringify(filter);
  useEffect(() => { const bump = () => setVersion(value => value + 1); window.addEventListener('orator-published', bump); return () => window.removeEventListener('orator-published', bump); }, []);
  useEffect(() => {
    let current = true;
    setLoad({ state: 'loading' });
    loadPublished(JSON.parse(key), includeDemo)
      .then(data => { if (current) setLoad({ state: 'ready', data }); })
      .catch(caught => { if (current) setLoad({ state: 'failed', message: caught instanceof Error ? caught.message : 'Results could not be loaded.' }); });
    return () => { current = false; };
  }, [key, includeDemo, version]);
  return load;
}

function Status({ load, children }: { load: Load; children: (data: PublishedResults) => ReactNode }) {
  if (load.state === 'loading') return <div className="pr-status" role="status"><span className="spinner"/><p>Loading results…</p></div>;
  if (load.state === 'failed') return <div className="pr-status" role="alert"><Icon name="warning"/><p>{load.message}</p></div>;
  return <>{children(load.data)}</>;
}

function Empty({ title, children }: { title: string; children: ReactNode }) {
  return <section className="panel pr-empty"><span className="upload-illustration"><Icon name="search" size={28}/></span><h2>{title}</h2><p>{children}</p><a className="button button-secondary" href={resultsHref()}><Icon name="arrow"/><span>All tournament results</span></a></section>;
}

const PrivacyNote = () => <p className="pr-note"><Icon name="lock" size={14}/><span>Only placings and team points are public. Ballots, judges’ comments, and round-by-round ranks stay private to each school.</span></p>;

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="pr-metric"><small>{label}</small><strong>{value}</strong>{note && <span>{note}</span>}</div>;
}

/** Season tabs, newest first. Only shown when there is more than one season. */
function SeasonPicker({ seasons, season, onChange }: { seasons: string[]; season: string; onChange: (season: string) => void }) {
  if (seasons.length < 2) return null;
  return <div className="pr-seasons" role="group" aria-label="Season">{seasons.map(item => <button key={item} type="button" aria-pressed={item === season} className={item === season ? 'active' : ''} onClick={() => onChange(item)}>{item}</button>)}</div>;
}

const seasonsOf = (tournaments: PublishedTournament[]) => [...new Set([...tournaments].sort(newestFirst).map(seasonOf))];

// ── #/results ──

function ResultsList() {
  const load = usePublished({});
  const [query, setQuery] = useState('');
  const [school, setSchool] = useState('');
  return <>
    <header className="pr-intro"><span className="eyebrow">Public results</span><h1>Tournament results</h1><p>Final placings and team points from finished speech tournaments, published by each tournament’s director.</p><PrivacyNote/></header>
    <Status load={load}>{data => {
      const needle = query.trim().toLowerCase();
      const champion = (id: string) => data.teams.filter(team => team.tournamentId === id && team.place === 1).map(team => team.school);
      const schools = [...new Set(data.teams.map(team => team.school.trim()))].sort((a, b) => a.localeCompare(b));
      const matches = (tournament: PublishedTournament) => !needle || [tournament.name, tournament.host, tournament.date, ...data.teams.filter(team => team.tournamentId === tournament.id).map(team => team.school)].some(text => text.toLowerCase().includes(needle));
      const shown = [...data.tournaments].sort(newestFirst).filter(matches);
      const seasons = [...new Set(shown.map(seasonOf))];
      return <div className="pr-columns">
        <div className="pr-main">
          <label className="search-box pr-search"><Icon name="search" size={16}/><span className="pr-visually-hidden">Search tournaments</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by tournament, host, or school"/></label>
          {data.tournaments.length === 0 ? <section className="panel pr-empty"><h2>No results published yet</h2><p>Results appear here once a tournament director publishes them after the tournament.</p></section>
          : shown.length === 0 ? <p className="pr-none" role="status">No tournaments match “{query.trim()}”.</p>
          : seasons.map(season => <section key={season} className="pr-season" aria-labelledby={`season-${season}`}>
            <h2 id={`season-${season}`} className="pr-season-title">{season} season</h2>
            <ul className="pr-cards">{shown.filter(tournament => seasonOf(tournament) === season).map(tournament => <li key={tournament.id}><a className="pr-card" href={tournamentHref(tournament.id)}>
              <span className="pr-card-main"><strong>{tournament.name}</strong><small>{[tournament.date, tournament.host && `Hosted by ${tournament.host}`].filter(Boolean).join(' · ')}</small>{champion(tournament.id).length > 0 && <span className="pr-card-champ"><Icon name="sparkle" size={13}/>Team champion: {champion(tournament.id).join(', ')}</span>}</span>
              <Icon name="arrow"/>
            </a></li>)}</ul>
          </section>)}
        </div>
        <aside className="pr-aside">
          <section className="panel pr-find">
            <div className="panel-head"><div><h2>Find a school</h2><p>Every published finalist and team finish, season by season.</p></div></div>
            <form onSubmit={event => { event.preventDefault(); if (school.trim()) window.location.hash = schoolHref(school).slice(1); }}>
              <label className="pr-field"><span>School name</span><input value={school} onChange={event => setSchool(event.target.value)} list="pr-school-names" autoComplete="off"/></label>
              <datalist id="pr-school-names">{schools.map(name => <option key={name} value={name}/>)}</datalist>
              <button className="button button-primary" type="submit" disabled={!school.trim()}><span>See school results</span></button>
            </form>
            {schools.length > 0 && <ul className="pr-school-links" aria-label="Schools with published team points">{schools.map(name => <li key={name}><a href={schoolHref(name)}>{name}</a></li>)}</ul>}
          </section>
        </aside>
      </div>;
    }}</Status>
  </>;
}

// ── #/results/<id> ──

function TournamentResults({ id }: { id: string }) {
  const load = usePublished({ tournamentId: id });
  return <Status load={load}>{data => {
    const tournament = data.tournaments.find(item => item.id === id);
    if (!tournament) return <Empty title="These results aren’t published">The director hasn’t published results for this tournament, or has taken them down. Results appear once a tournament has ended and its director publishes them.</Empty>;
    const contests = [...new Set(data.placings.map(row => row.contest))].sort((a, b) => contestOrder(a) - contestOrder(b));
    const teams = [...data.teams].sort((a, b) => a.place - b.place || a.school.localeCompare(b.school));
    return <>
      <header className="pr-intro"><span className="eyebrow">Tournament results</span><h1>{tournament.name}</h1>
        <p>{[tournament.date, tournament.host && `Hosted by ${tournament.host}`].filter(Boolean).join(' · ')}</p>
        <div className="pr-intro-meta"><Badge tone="success" icon="check">Final results</Badge>{publishedOn(tournament.publishedAt) && <span>Published {publishedOn(tournament.publishedAt)}</span>}<span>{plural(contests.length, 'event')} placed · {plural(data.placings.length, 'speaker')} placed</span></div>
        <PrivacyNote/>
      </header>
      <div className="pr-columns">
        <div className="pr-main pr-contests">
          {contests.length === 0 ? <p className="pr-none">No final placings were published for this tournament.</p> : contests.map(contest => {
            const rows = data.placings.filter(row => row.contest === contest).sort((a, b) => a.place - b.place || a.student.localeCompare(b.student));
            return <section key={contest} className="panel pr-contest" aria-labelledby={`contest-${contest}`}>
              <div className="pr-contest-head"><h2 id={`contest-${contest}`}>{contestName(contest)}</h2><small>{plural(rows.length, 'finalist')}</small></div>
              <ol className="pr-placings">{rows.map(row => <li key={`${row.school}|${row.student}|${row.place}`} className={row.place === 1 ? 'first' : ''}>
                <Place place={row.place}/>
                <span className="pr-who"><Who row={row}/><a className="pr-school" href={schoolHref(row.school)}>{row.school}</a></span>
                {row.place === 1 && <Badge tone="warning">Champion</Badge>}{row.qualifier && <Badge tone={row.qualifier === 'state' ? 'success' : 'info'}>{qualifierLabel[row.qualifier]}</Badge>}
              </li>)}</ol>
            </section>;
          })}
        </div>
        <aside className="pr-aside">
          <section className="panel">
            <div className="panel-head"><div><h2>Team points</h2><p>Sweepstakes, from final rounds only</p></div></div>
            {teams.length === 0 ? <p className="pr-none pr-pad">No team points were published.</p> : <ol className="team-points" aria-label="Team standings">{teams.map(team => <li key={team.school} className={team.place === 1 ? 'lead' : ''}><span aria-label={`${ordinal(team.place)} place`}>{team.place}</span><div><a href={schoolHref(team.school)}><strong>{team.school}</strong></a><small>{plural(data.placings.filter(row => sameSchool(row.school, team.school)).length, 'finalist')}</small></div><b>{team.points}<span className="pr-visually-hidden"> points</span></b></li>)}</ol>}
          </section>
        </aside>
      </div>
    </>;
  }}</Status>;
}

/** A finalist's name, linking to their record, or "Name withheld" (no link) when they asked for privacy. */
function Who({ row }: { row: PublishedPlacing }) {
  return row.withheld ? <span className="pr-withheld">{WITHHELD}</span> : <a href={studentHref(row.school, row.student)}>{row.student}</a>;
}

// ── #/school/<name> ──

type Finish = { tournament: PublishedTournament; placings: PublishedPlacing[]; team?: PublishedTeam };

function SchoolResults({ school }: { school: string }) {
  const load = usePublished({ school });
  const [chosen, setChosen] = useState('');
  return <Status load={load}>{data => {
    const name = data.placings[0]?.school ?? data.teams[0]?.school ?? school;
    const finishes: Finish[] = data.tournaments.map(tournament => ({ tournament, placings: data.placings.filter(row => row.tournamentId === tournament.id).sort((a, b) => a.place - b.place || contestOrder(a.contest) - contestOrder(b.contest)), team: data.teams.find(team => team.tournamentId === tournament.id) }))
      .filter(finish => finish.placings.length > 0 || finish.team).sort((a, b) => newestFirst(a.tournament, b.tournament));
    if (finishes.length === 0) return <><header className="pr-intro"><span className="eyebrow">School results</span><h1>{name}</h1></header><Empty title="No published results yet">No published tournament lists a finalist or team points for {name}. Check the spelling, or look through all tournament results.</Empty></>;
    const seasons = seasonsOf(finishes.map(finish => finish.tournament));
    const season = seasons.includes(chosen) ? chosen : seasons[0];
    const inSeason = finishes.filter(finish => seasonOf(finish.tournament) === season);
    const rows = inSeason.flatMap(finish => finish.placings);
    const teamPlaces = inSeason.flatMap(finish => finish.team ? [finish.team.place] : []);
    const students = [...new Map(rows.filter(row => !row.withheld).map(row => [row.student.toLowerCase(), row.student])).values()].map(student => {
      const mine = rows.filter(row => sameName(row.student, student));
      return { student, finals: mine.length, titles: mine.filter(row => row.place === 1).length, best: Math.min(...mine.map(row => row.place)) };
    }).sort((a, b) => b.titles - a.titles || b.finals - a.finals || a.student.localeCompare(b.student));
    return <>
      <header className="pr-intro"><span className="eyebrow">School results</span><h1>{name}</h1><p>Published finalists and team finishes{seasons.length > 1 ? ', season by season' : ''}. Tournaments where {name} had no finalist or team points aren’t listed.</p><SeasonPicker seasons={seasons} season={season} onChange={setChosen}/><p><a href={compareHref(name)}>Compare {name} with another team</a></p></header>
      <div className="pr-metrics" aria-label={`${season} season totals`}>
        <Metric label="Tournaments" value={String(inSeason.length)} note={`${season} season`}/>
        <Metric label="Finalists" value={String(rows.length)} note={plural(students.length, 'student')}/>
        <Metric label="Champions" value={String(rows.filter(row => row.place === 1).length)} note="1st-place finishes"/>
        <Metric label="Best team finish" value={teamPlaces.length ? ordinal(Math.min(...teamPlaces)) : '—'} note={teamPlaces.length ? `${plural(teamPlaces.filter(place => place === 1).length, 'team title')}` : 'No team points yet'}/>
      </div>
      <div className="pr-columns">
        <div className="pr-main">
          {inSeason.map(({ tournament, placings, team }) => <section key={tournament.id} className="panel pr-history" aria-labelledby={`t-${tournament.id}`}>
            <div className="pr-history-head"><div><h2 id={`t-${tournament.id}`}><a href={tournamentHref(tournament.id)}>{tournament.name}</a></h2><small>{[tournament.date, tournament.host && `Hosted by ${tournament.host}`].filter(Boolean).join(' · ')}</small></div>
              {team ? <Badge tone={team.place === 1 ? 'success' : 'info'}>{ordinal(team.place)} in team points · {team.points}</Badge> : <Badge>No team points</Badge>}</div>
            {placings.length === 0 ? <p className="pr-none pr-pad">No finalists published.</p> : <ol className="pr-placings">{placings.map(row => <li key={`${row.contest}|${row.student}|${row.place}`} className={row.place === 1 ? 'first' : ''}>
              <Place place={row.place}/>
              <span className="pr-who"><Who row={row}/><span className="pr-school">{contestName(row.contest)}</span></span>
              {row.place === 1 && <Badge tone="warning">Champion</Badge>}{row.qualifier && <Badge tone={row.qualifier === 'state' ? 'success' : 'info'}>{qualifierLabel[row.qualifier]}</Badge>}
            </li>)}</ol>}
          </section>)}
        </div>
        <aside className="pr-aside">
          <section className="panel">
            <div className="panel-head"><div><h2>Students</h2><p>Finals reached in {season}</p></div></div>
            {students.length === 0 ? <p className="pr-none pr-pad">No finalists this season.</p> : <ul className="pr-students">{students.map(item => <li key={item.student}><a href={studentHref(name, item.student)}>{item.student}</a><small>{plural(item.finals, 'final')}{item.titles ? ` · ${plural(item.titles, 'title')}` : ` · best ${ordinal(item.best)}`}</small></li>)}</ul>}
          </section>
        </aside>
      </div>
    </>;
  }}</Status>;
}

// ── #/student/<school>/<name> ──

function StudentResults({ school, student }: { school: string; student: string }) {
  const load = usePublished({ school, student });
  const [chosen, setChosen] = useState('');
  return <Status load={load}>{data => {
    const byId = new Map(data.tournaments.map(tournament => [tournament.id, tournament]));
    const all = data.placings.filter(row => byId.has(row.tournamentId)).sort((a, b) => newestFirst(byId.get(a.tournamentId)!, byId.get(b.tournamentId)!) || contestOrder(a.contest) - contestOrder(b.contest));
    const name = all[0]?.student ?? student; const schoolName = all[0]?.school ?? school;
    const head = <header className="pr-intro"><span className="eyebrow">Student results</span><h1>{name}</h1><p><a href={schoolHref(schoolName)}>{schoolName}</a></p></header>;
    if (all.length === 0) return <>{head}<Empty title="No published finals yet">No published tournament lists {name} of {schoolName} as a finalist. Only final-round placings are public.</Empty></>;
    const seasons = seasonsOf(all.map(row => byId.get(row.tournamentId)!));
    const season = seasons.includes(chosen) ? chosen : seasons[0];
    const rows = all.filter(row => seasonOf(byId.get(row.tournamentId)!) === season);
    const events = [...new Set(rows.map(row => row.contest))].sort((a, b) => contestOrder(a) - contestOrder(b));
    return <>
      <header className="pr-intro"><span className="eyebrow">Student results</span><h1>{name}</h1><p><a href={schoolHref(schoolName)}>{schoolName}</a> · final-round placings</p><SeasonPicker seasons={seasons} season={season} onChange={setChosen}/></header>
      <div className="pr-metrics" aria-label={`${season} season totals`}>
        <Metric label="Finals" value={String(rows.length)} note={`${season} season`}/>
        <Metric label="Championships" value={String(rows.filter(row => row.place === 1).length)} note="1st-place finishes"/>
        <Metric label="Best finish" value={ordinal(Math.min(...rows.map(row => row.place)))}/>
        <Metric label="Tournaments" value={String(new Set(rows.map(row => row.tournamentId)).size)} note={events.map(contestName).join(', ')}/>
      </div>
      <section className="panel pr-season-table" aria-label={`${name}’s ${season} finals`}>
        <div className="panel-head"><div><h2>{season} season</h2><p>Every published final, newest first</p></div></div>
        <ol className="pr-placings">{rows.map(row => { const tournament = byId.get(row.tournamentId)!; return <li key={`${row.tournamentId}|${row.contest}`} className={row.place === 1 ? 'first' : ''}>
          <Place place={row.place}/>
          <span className="pr-who"><a href={tournamentHref(tournament.id)}>{tournament.name}</a><span className="pr-school">{contestName(row.contest)} · {tournament.date}</span></span>
          {row.place === 1 && <Badge tone="warning">Champion</Badge>}{row.qualifier && <Badge tone={row.qualifier === 'state' ? 'success' : 'info'}>{qualifierLabel[row.qualifier]}</Badge>}
        </li>; })}</ol>
      </section>
      <PrivacyNote/>
    </>;
  }}</Status>;
}

// ── The page shell ──

const titleOf = (route: PublicRoute) => route.kind === 'list' ? 'Tournament results' : route.kind === 'tournament' ? 'Tournament results' : route.kind === 'school' ? `${route.school} results` : route.kind === 'compare' ? `${route.school}${route.rival ? ` vs ${route.rival}` : ''} · Compare teams` : `${route.student} · ${route.school}`;

export function PublicResultsView({ route, onClose, dark, setDark }: { route: PublicRoute; onClose: () => void; dark: boolean; setDark: (dark: boolean) => void }) {
  const { profile } = useAuth();
  useEffect(() => { const before = document.title; document.title = `${titleOf(route)} · Orator`; return () => { document.title = before; }; }, [route]);
  const page = useMemo(() => route.kind === 'list' ? <ResultsList/> : route.kind === 'tournament' ? <TournamentResults key={route.id} id={route.id}/> : route.kind === 'school' ? <SchoolResults key={route.school} school={route.school}/> : route.kind === 'compare' ? <TeamCompare key={route.school} page school={route.school} rival={route.rival}/> : <StudentResults key={`${route.school}|${route.student}`} school={route.school} student={route.student}/>, [route]);
  return <div className="pr-page">
    <header className="pr-top">
      <a href={resultsHref()} className="pr-brand" aria-label="Orator tournament results"><Logo/><span aria-hidden="true">Results</span></a>
      <nav className="pr-top-links" aria-label="Results">
        {route.kind !== 'list' && <a href={resultsHref()}>All results</a>}
        <a href="#" onClick={event => { event.preventDefault(); onClose(); }}>{profile ? 'Back to Orator' : authConfigured ? 'Sign in' : 'Open Orator'}</a>
        <button type="button" className="theme-button pr-theme" aria-label="Toggle light or dark theme" onClick={() => setDark(!dark)}><Icon name={dark ? 'sun' : 'moon'}/></button>
      </nav>
    </header>
    <main id="main" className="pr-body">{page}</main>
    <LegalFooter onOpen={page => { window.location.hash = `/${page}`; }}/>
  </div>;
}
