/**
 * Compare teams: one school against another, from PUBLIC results only (published final placings and
 * team points). Ballots, comments and preliminary ranks are never read here.
 *
 * Team points per event are not published as such: they are worked out from each finalist's place and
 * the tournament's team point scale (published by supabase/team_compare.sql). When a tournament's scale
 * wasn't published, the NSAA scale is tried (varsity only, then with novice), and the result is checked
 * against the school's published team total.
 */
import { supabase } from './auth';
import { ballotEvents } from './ballots';
import { NSAA_TEAM_POINTS } from './results';
import { parseContest, sameSchool, type Division } from './tournament';
import { demoScoring, loadPublished, newestFirst, sameName, seasonOf, type PublishedPlacing, type PublishedResults, type PublishedScoring, type PublishedTeam, type PublishedTournament } from './publicResultsApi';

const part = (text: string) => encodeURIComponent(text.trim());
/** The public comparison page: `#/compare/<school>` or `#/compare/<school>/<rival>`. */
export const compareHref = (school: string, rival?: string) => `#/compare/${part(school)}${rival && rival.trim() ? `/${part(rival)}` : ''}`;

export type CompareData = PublishedResults & { scoring: PublishedScoring[] };

// ── Loading ──

async function liveScoring(): Promise<PublishedScoring[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('published_team_scoring').select('tournament_id, team_point_scale, novice_counts').limit(5000);
  // Before supabase/team_compare.sql is run there is no table: fall back to working the scale out.
  if (error) return [];
  return ((data ?? []) as { tournament_id: string; team_point_scale: number[] | null; novice_counts: boolean | null }[])
    .filter(row => Array.isArray(row.team_point_scale) && row.team_point_scale.length > 0)
    .map(row => ({ tournamentId: row.tournament_id, scale: row.team_point_scale!.map(Number), noviceCounts: row.novice_counts === true }));
}

/** Every published tournament and team total, plus the two schools' published placings. */
export async function loadComparison(school: string, rival: string, includeDemoTournament: boolean): Promise<CompareData> {
  const [all, mine, theirs, scoring] = await Promise.all([
    loadPublished({}, includeDemoTournament),
    school.trim() ? loadPublished({ school }, includeDemoTournament) : Promise.resolve(null),
    rival.trim() && !sameSchool(rival, school) ? loadPublished({ school: rival }, includeDemoTournament) : Promise.resolve(null),
    supabase ? liveScoring() : Promise.resolve(demoScoring(includeDemoTournament)),
  ]);
  const placings = [...(mine?.placings ?? []), ...(theirs?.placings ?? [])];
  // The demo returns every placing for the list query; keep only the two schools' rows either way.
  return { tournaments: all.tournaments, teams: all.teams, placings: placings.filter(row => sameSchool(row.school, school) || sameSchool(row.school, rival)), scoring };
}

// ── Names ──

export const eventName = (eventId: string) => ballotEvents.find(event => event.id === eventId)?.name ?? eventId;
/** "Informative" for varsity, "Novice Informative" for novice. */
export const contestName = (contest: string) => { const { eventId, division } = parseContest(contest); return division === 'novice' ? `Novice ${eventName(eventId)}` : eventName(eventId); };
const contestOrder = (contest: string) => { const { eventId, division } = parseContest(contest); const index = ballotEvents.findIndex(event => event.id === eventId); return (division === 'novice' ? 100 : 0) + (index < 0 ? 99 : index); };
export const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4) % 4]}`;

/** Every school in the published results, A to Z. */
export function schoolsIn(data: PublishedResults): string[] {
  const names = new Map<string, string>();
  [...data.teams, ...data.placings].forEach(row => { const key = row.school.trim().toLowerCase(); if (key && !names.has(key)) names.set(key, row.school.trim()); });
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

// ── Rivals ──

export type RivalSuggestion = { school: string; meets: number; placesApart: number };

/** The schools `school` most often competes against, closest finishes first among equals. */
export function suggestRivals(teams: PublishedTeam[], school: string, limit = 4): RivalSuggestion[] {
  const mine = new Map(teams.filter(team => sameSchool(team.school, school)).map(team => [team.tournamentId, team.place]));
  const others = new Map<string, { school: string; places: number[] }>();
  teams.forEach(team => {
    if (sameSchool(team.school, school) || !mine.has(team.tournamentId)) return;
    const key = team.school.trim().toLowerCase();
    const entry = others.get(key) ?? { school: team.school.trim(), places: [] };
    entry.places.push(Math.abs(team.place - mine.get(team.tournamentId)!));
    others.set(key, entry);
  });
  return [...others.values()].map(entry => ({ school: entry.school, meets: entry.places.length, placesApart: entry.places.reduce((sum, value) => sum + value, 0) / entry.places.length }))
    .sort((a, b) => b.meets - a.meets || a.placesApart - b.placesApart || a.school.localeCompare(b.school)).slice(0, limit);
}

// ── Team point scale ──

export type ScaleInfo = {
  scale: number[]; noviceCounts: boolean;
  /** 'published' with the results; 'inferred' from the team totals; 'assumed' when nothing matched. */
  source: 'published' | 'inferred' | 'assumed';
  /** Not the NSAA 20-18-16-14-12-10, varsity only. */
  custom: boolean;
  /** The per-event points add up to each school's published team total. */
  adds: boolean;
};

const pointsFor = (placing: PublishedPlacing, scale: number[], noviceCounts: boolean) => noviceCounts || placing.division === 'varsity' ? scale[placing.place - 1] ?? 0 : 0;
const isNsaa = (scale: number[]) => scale.join() === NSAA_TEAM_POINTS.join();

/** The scale a tournament used, checked against the published totals of the schools whose placings we have. */
export function scaleFor(tournamentId: string, data: CompareData, schools: string[]): ScaleInfo {
  const placings = data.placings.filter(row => row.tournamentId === tournamentId);
  const adds = (scale: number[], noviceCounts: boolean) => schools.every(school => {
    const derived = placings.filter(row => sameSchool(row.school, school)).reduce((sum, row) => sum + pointsFor(row, scale, noviceCounts), 0);
    const published = data.teams.find(team => team.tournamentId === tournamentId && sameSchool(team.school, school))?.points ?? 0;
    return derived === published;
  });
  const stored = data.scoring.find(row => row.tournamentId === tournamentId);
  if (stored) return { scale: stored.scale, noviceCounts: stored.noviceCounts, source: 'published', custom: !isNsaa(stored.scale) || stored.noviceCounts, adds: adds(stored.scale, stored.noviceCounts) };
  for (const noviceCounts of [false, true]) if (adds(NSAA_TEAM_POINTS, noviceCounts)) return { scale: NSAA_TEAM_POINTS, noviceCounts, source: 'inferred', custom: noviceCounts, adds: true };
  return { scale: NSAA_TEAM_POINTS, noviceCounts: false, source: 'assumed', custom: true, adds: false };
}

// ── The comparison ──

export type DivisionFilter = 'all' | Division;
export type Side = { attended: boolean; points: number; place: number | null; finalists: number; champions: number; student?: number; studentFinals?: number };
export type Meet = { tournament: PublishedTournament; scale: ScaleInfo; you: Side; them: Side; leader: 'you' | 'them' | 'tie' };
export type EventRow = { contest: string; eventId: string; division: Division; you: number; them: number; youFinals: number; themFinals: number; student?: number };
export type Comparison = {
  school: string; rival: string;
  seasons: string[]; season: string;
  /** Tournaments both schools appear at, in the chosen season (before the tournament filter), oldest first. */
  sharedInSeason: PublishedTournament[];
  meets: Meet[];
  summary: { shared: number; youAhead: number; themAhead: number; ties: number; youTotal: number; themTotal: number; youFinalists: number; themFinalists: number; youChampions: number; themChampions: number; studentTotal: number };
  events: EventRow[];
  /** How many of the meets counted novice finals for team points. */
  noviceCounted: number;
  /** Meets whose scale wasn't the NSAA one, or whose per-event points don't add up. */
  notes: { tournament: PublishedTournament; scale: ScaleInfo }[];
};

export const ALL = 'all';
const oldestFirst = (a: PublishedTournament, b: PublishedTournament) => -newestFirst(a, b);

/**
 * Head to head at the tournaments both schools appear at. `season` is a season label or 'all';
 * `tournamentId` narrows to one tournament or is 'all'. `student` adds that student's own points.
 */
export function compareTeams(data: CompareData, school: string, rival: string, options: { season?: string; tournamentId?: string; division?: DivisionFilter; student?: string } = {}): Comparison {
  const at = (id: string, name: string) => ({
    team: data.teams.find(team => team.tournamentId === id && sameSchool(team.school, name)),
    placings: data.placings.filter(row => row.tournamentId === id && sameSchool(row.school, name)),
  });
  const attended = (id: string, name: string) => { const { team, placings } = at(id, name); return Boolean(team) || placings.length > 0; };
  const shared = data.tournaments.filter(tournament => attended(tournament.id, school) && attended(tournament.id, rival)).sort(oldestFirst);
  const seasons = [...new Set([...shared].sort(newestFirst).map(seasonOf))];
  const season = options.season === ALL ? ALL : options.season && seasons.includes(options.season) ? options.season : seasons[0] ?? ALL;
  const sharedInSeason = shared.filter(tournament => season === ALL || seasonOf(tournament) === season);
  const chosen = options.tournamentId && options.tournamentId !== ALL ? sharedInSeason.filter(tournament => tournament.id === options.tournamentId) : sharedInSeason;
  const meetsList = chosen.length ? chosen : sharedInSeason;
  const division = options.division ?? ALL;

  const side = (tournament: PublishedTournament, name: string, scale: ScaleInfo): Side => {
    const { team, placings } = at(tournament.id, name);
    const result: Side = { attended: true, points: team?.points ?? 0, place: team?.place ?? null, finalists: placings.length, champions: placings.filter(row => row.place === 1).length };
    if (options.student) {
      const own = placings.filter(row => sameName(row.student, options.student!));
      result.student = own.reduce((sum, row) => sum + pointsFor(row, scale.scale, scale.noviceCounts), 0);
      result.studentFinals = own.length;
    }
    return result;
  };
  const meets: Meet[] = meetsList.map(tournament => {
    const scale = scaleFor(tournament.id, data, [school, rival]);
    const you = side(tournament, school, scale); const them = side(tournament, rival, scale);
    return { tournament, scale, you, them, leader: you.points > them.points ? 'you' : them.points > you.points ? 'them' : 'tie' };
  });

  const events = new Map<string, EventRow>();
  meets.forEach(meet => data.placings.filter(row => row.tournamentId === meet.tournament.id && (division === ALL || row.division === division)).forEach(row => {
    const mineRow = sameSchool(row.school, school);
    if (!mineRow && !sameSchool(row.school, rival)) return;
    const { eventId, division: rowDivision } = parseContest(row.contest);
    const entry = events.get(row.contest) ?? { contest: row.contest, eventId, division: rowDivision, you: 0, them: 0, youFinals: 0, themFinals: 0, ...(options.student ? { student: 0 } : {}) };
    const points = pointsFor(row, meet.scale.scale, meet.scale.noviceCounts);
    if (mineRow) { entry.you += points; entry.youFinals += 1; if (options.student && sameName(row.student, options.student)) entry.student = (entry.student ?? 0) + points; }
    else { entry.them += points; entry.themFinals += 1; }
    events.set(row.contest, entry);
  }));

  const sum = (pick: (meet: Meet) => number) => meets.reduce((total, meet) => total + pick(meet), 0);
  return {
    school, rival, seasons, season, sharedInSeason, meets,
    summary: {
      shared: meets.length, youAhead: meets.filter(meet => meet.leader === 'you').length, themAhead: meets.filter(meet => meet.leader === 'them').length, ties: meets.filter(meet => meet.leader === 'tie').length,
      youTotal: sum(meet => meet.you.points), themTotal: sum(meet => meet.them.points),
      youFinalists: sum(meet => meet.you.finalists), themFinalists: sum(meet => meet.them.finalists),
      youChampions: sum(meet => meet.you.champions), themChampions: sum(meet => meet.them.champions),
      studentTotal: sum(meet => meet.you.student ?? 0),
    },
    events: [...events.values()].sort((a, b) => contestOrder(a.contest) - contestOrder(b.contest)),
    noviceCounted: meets.filter(meet => meet.scale.noviceCounts).length,
    notes: meets.filter(meet => meet.scale.custom || !meet.scale.adds).map(meet => ({ tournament: meet.tournament, scale: meet.scale })),
  };
}

const list = (items: string[]) => items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/** A plain-language line: where the rival out-scores you, and where you lead. Speaks to `you` ("you") or names the school. */
export function takeaway(comparison: Comparison, you = 'you'): string {
  const scored = comparison.events.filter(row => row.you + row.them > 0);
  if (scored.length === 0) return `Neither team earned team points from a final at ${comparison.meets.length === 1 ? 'this tournament' : 'these tournaments'}.`;
  const theirs = scored.filter(row => row.them > row.you).sort((a, b) => (b.them - b.you) - (a.them - a.you)).slice(0, 3);
  const mine = scored.filter(row => row.you > row.them).sort((a, b) => (b.you - b.them) - (a.you - a.them)).slice(0, 3);
  const margin = (rows: EventRow[], sign: 1 | -1) => rows.reduce((total, row) => total + sign * (row.them - row.you), 0);
  const subject = you === 'you' ? 'you' : you;
  const lead = you === 'you' ? 'you lead' : `${you} leads`;
  const parts: string[] = [];
  if (theirs.length) parts.push(`${comparison.rival} out-scores ${subject} by ${margin(theirs, 1)} points in ${list(theirs.map(row => contestName(row.contest)))}`);
  if (mine.length) parts.push(`${parts.length ? lead : lead.charAt(0).toUpperCase() + lead.slice(1)} by ${margin(mine, -1)} in ${list(mine.map(row => contestName(row.contest)))}`);
  if (!theirs.length && mine.length) return `${parts[0]}, and ${comparison.rival} doesn’t out-score ${subject} in any event.`;
  if (theirs.length && !mine.length) return `${parts[0]}, and ${subject === 'you' ? 'you don’t' : `${you} doesn’t`} lead in any event.`;
  return `${parts.join('; ')}.`;
}
