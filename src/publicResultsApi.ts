/**
 * Public results: final placings and team points a director has published, readable by anyone.
 * "Results are public, but ballots and specific rankings are private": only place, student and
 * school for each final, and each school's team points, are ever published. Ballots, comments,
 * preliminary ranks and ratings, judges' ranks and tie-breaks stay private.
 *
 * With accounts connected this reads the published snapshot in Supabase (supabase/public_results.sql).
 * In the demo it uses a fictional sample season, plus the demo tournament once its director publishes it.
 */
import { supabase } from './auth';
import { growthMeets } from './Growth';
import { NSAA_TEAM_POINTS, type Placing, type TeamScore } from './results';
import { contestKey, defaultTournament, divisions, parseContest, qualifierFor, sameSchool, seedEntries, type Division, type QualifierStatus, type StateQualifying } from './tournament';

export type PublishedTournament = { id: string; name: string; date: string; host: string; publishedAt: string };
/** withheld: the student's coach or the student asked for the name to be kept off public results; student reads WITHHELD. */
export type PublishedPlacing = { tournamentId: string; contest: string; eventId: string; division: Division; place: number; student: string; school: string; withheld?: boolean; qualifier?: QualifierStatus };
/** What a withheld placing shows instead of the student's name. */
export const WITHHELD = 'Name withheld';
const withQualifier = (qualifier: QualifierStatus | null | undefined) => qualifier ? { qualifier } : {};
export type PublishedTeam = { tournamentId: string; school: string; points: number; place: number };
export type PublishedResults = { tournaments: PublishedTournament[]; placings: PublishedPlacing[]; teams: PublishedTeam[] };

/** The team point scale a tournament used (1st to 6th), and whether novice finals counted. Stored by supabase/team_compare.sql. */
export type TeamScoring = { scale: number[]; noviceCounts: boolean };
export type PublishedScoring = TeamScoring & { tournamentId: string };

/** What a director publishes: one row per finalist, and one per school with team points (plus, optionally, the scale behind them). */
export type Snapshot = { placings: Omit<PublishedPlacing, 'tournamentId'>[]; teams: Omit<PublishedTeam, 'tournamentId'>[]; scoring?: TeamScoring };

const fail = (message: string): never => {
  if (/could not find|schema cache|does not exist/i.test(message)) throw new Error('The database needs an update. Run supabase/public_results.sql in the Supabase SQL Editor.');
  if (/row-level security|permission denied|insufficient/i.test(message)) throw new Error('Only this tournament’s director can publish its results, once the tournament has ended.');
  throw new Error(message);
};
const db = () => supabase ?? fail('Accounts are not connected.');

/** Same name, ignoring case and extra spaces. */
export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Build the public snapshot from the director's placings. Only place, student and school are kept.
 * Team places share a place when points are tied.
 */
export function buildSnapshot(contests: { contest: string; placings: Placing[] }[], teams: TeamScore[], scoring?: TeamScoring, district?: StateQualifying): Snapshot {
  const placings = contests.flatMap(({ contest, placings }) => placings.map(placing => {
    const { eventId, division } = parseContest(contest);
    return { contest: contestKey(eventId, division), eventId, division, place: placing.place, student: placing.student.trim(), school: placing.school.trim(), ...withQualifier(qualifierFor(district, contest, placing.place)) };
  }));
  const ranked = [...teams].filter(team => team.points > 0).sort((a, b) => b.points - a.points);
  const teamRows = ranked.map(team => ({ school: team.school.trim(), points: team.points, place: ranked.findIndex(other => other.points === team.points) + 1 }));
  return { placings, teams: teamRows, ...(scoring ? { scoring: { scale: [...scoring.scale], noviceCounts: scoring.noviceCounts } } : {}) };
}

// ── Season helpers ──

/** When a tournament happened: its date if it can be read, otherwise when it was published. */
export const whenOf = (tournament: PublishedTournament) => { const parsed = Date.parse(tournament.date); return Number.isNaN(parsed) ? Date.parse(tournament.publishedAt) || 0 : parsed; };
/** Speech seasons run with the school year: August to July. */
export const seasonOf = (tournament: PublishedTournament) => {
  const when = new Date(whenOf(tournament)); const year = when.getFullYear(); const start = when.getMonth() >= 7 ? year : year - 1;
  return `${start}–${String((start + 1) % 100).padStart(2, '0')}`;
};
export const newestFirst = (a: PublishedTournament, b: PublishedTournament) => whenOf(b) - whenOf(a) || b.publishedAt.localeCompare(a.publishedAt);

// ── Demo: a fictional sample season ──

const seeded = (key: string) => { let hash = 2166136261; for (let i = 0; i < key.length; i++) { hash ^= key.charCodeAt(i); hash = Math.imul(hash, 16777619); } return ((hash >>> 0) % 10000) / 10000; };
const demoSchoolHost: Record<string, string> = { Ashgrove: 'Ashgrove', Brightwater: 'Brightwater High', 'Halden West': 'Halden West', Thornbury: 'Thornbury', 'Fallow Creek': 'Fallow Creek' };
// The growth charts' five meets (this season), plus two from last season so school histories span seasons.
// Two meets show a tournament's own scoring rules: the Kestrel Prep Classic counts novice finals, and the
// Wrenfield Invitational uses its own team point scale.
type DemoMeet = { id: string; name: string; date: string; host: string; scoring?: TeamScoring };
const demoMeets: DemoMeet[] = [
  { id: 'demo-kestrel-2026', name: 'Kestrel Prep Classic', date: 'February 7, 2026', host: 'Kestrel Prep', scoring: { scale: NSAA_TEAM_POINTS, noviceCounts: true } },
  { id: 'demo-wrenfield-2026', name: 'Wrenfield Invitational', date: 'March 14, 2026', host: 'Wrenfield High', scoring: { scale: [25, 20, 16, 12, 8, 4], noviceCounts: false } },
  ...growthMeets.map((meet, index) => ({ id: `demo-${meet.toLowerCase().replace(/\W+/g, '-')}`, name: `${meet} Invitational`, date: `${['September 12', 'September 19', 'September 26', 'October 3', 'October 10'][index]}, 2026`, host: demoSchoolHost[meet] ?? meet })),
];

const scoringOf = (meet: DemoMeet): TeamScoring => meet.scoring ?? { scale: NSAA_TEAM_POINTS, noviceCounts: false };

function sampleMeet(meet: DemoMeet): PublishedResults {
  const placings: PublishedPlacing[] = defaultTournament.eventIds.flatMap(eventId => divisions.map(division => {
    const field = seedEntries.filter(entry => entry.eventId === eventId && (entry.division ?? 'varsity') === division);
    // Each speaker has a steady level, some luck on the day, and a team that is on form or not.
    const order = field.map(entry => ({ entry, score: seeded(`${entry.student}|${eventId}`) * 0.35 + seeded(`${entry.student}|${eventId}|${meet.id}`) * 0.3 + seeded(`${entry.school}|${meet.id}`) * 0.35 })).sort((a, b) => b.score - a.score).slice(0, 6);
    return order.map(({ entry }, index) => ({ tournamentId: meet.id, contest: contestKey(eventId, division), eventId, division, place: index + 1, student: entry.student, school: entry.school }));
  })).flat();
  const points = new Map<string, number>();
  const { scale, noviceCounts } = scoringOf(meet);
  placings.filter(placing => noviceCounts || placing.division === 'varsity').forEach(placing => points.set(placing.school, (points.get(placing.school) ?? 0) + (scale[placing.place - 1] ?? 0)));
  const ranked = [...points.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const teams = ranked.map(([school, total]) => ({ tournamentId: meet.id, school, points: total, place: ranked.findIndex(other => other[1] === total) + 1 }));
  return { tournaments: [{ id: meet.id, name: meet.name, date: meet.date, host: meet.host, publishedAt: new Date(Date.parse(meet.date) + 86400000).toISOString() }], placings, teams };
}

const sampleSeason: PublishedResults = demoMeets.map(sampleMeet).reduce((all, meet) => ({ tournaments: [...all.tournaments, ...meet.tournaments], placings: [...all.placings, ...meet.placings], teams: [...all.teams, ...meet.teams] }), { tournaments: [], placings: [], teams: [] } as PublishedResults);

/** The demo tournament's published snapshot lives in this browser only. */
const DEMO_KEY = 'orator-published-v1';
export const DEMO_TOURNAMENT_ID = 'demo-larkspur';
type DemoPublished = { tournament: PublishedTournament; snapshot: Snapshot };
export function loadDemoPublished(): DemoPublished | null {
  try { const raw = localStorage.getItem(DEMO_KEY); return raw ? JSON.parse(raw) as DemoPublished : null; } catch { return null; }
}
export function saveDemoPublished(value: DemoPublished | null) {
  try { if (value) localStorage.setItem(DEMO_KEY, JSON.stringify(value)); else localStorage.removeItem(DEMO_KEY); } catch { /* private window or storage disabled */ }
  window.dispatchEvent(new Event('orator-published'));
}

function demoResults(includeDemoTournament: boolean): PublishedResults {
  const mine = includeDemoTournament ? loadDemoPublished() : null;
  const hidden = loadDemoWithheld();
  const hide = (row: PublishedPlacing): PublishedPlacing => hidden.some(item => sameName(item.school, row.school) && sameName(item.student, row.student)) ? { ...row, student: WITHHELD, withheld: true } : row;
  if (!mine) return { ...sampleSeason, placings: sampleSeason.placings.map(hide) };
  return {
    tournaments: [...sampleSeason.tournaments, mine.tournament],
    placings: [...sampleSeason.placings, ...mine.snapshot.placings.map(row => ({ ...row, tournamentId: mine.tournament.id }))].map(hide),
    teams: [...sampleSeason.teams, ...mine.snapshot.teams.map(row => ({ ...row, tournamentId: mine.tournament.id }))],
  };
}

// ── Keeping a student's name off public results (supabase/privacy.sql) ──

/** In the demo, the list lives in this browser. */
const DEMO_WITHHELD_KEY = 'orator-withheld-v1';
type WithheldName = { school: string; student: string };
function loadDemoWithheld(): WithheldName[] {
  try { const raw = localStorage.getItem(DEMO_WITHHELD_KEY); return raw ? JSON.parse(raw) as WithheldName[] : []; } catch { return []; }
}

/** The students at this school whose names are kept off public results (that you can see: your team, or yourself). */
export async function loadWithheld(school: string): Promise<string[]> {
  if (!supabase) return loadDemoWithheld().filter(item => sameName(item.school, school)).map(item => item.student);
  const { data, error } = await db().from('results_privacy').select('student').ilike('school', exactly(school));
  if (error) fail(/results_privacy/.test(error.message) ? 'Name privacy needs the latest database update (supabase/all_in_one.sql).' : error.message);
  return ((data ?? []) as { student: string }[]).map(row => row.student);
}

/**
 * Keep a student's name off public results, or show it again. Withholding takes the name off results
 * already published; showing it again takes effect when each director next publishes.
 */
export async function setWithheld(school: string, student: string, withheld: boolean): Promise<void> {
  if (!supabase) {
    const rest = loadDemoWithheld().filter(item => !(sameName(item.school, school) && sameName(item.student, student)));
    try { localStorage.setItem(DEMO_WITHHELD_KEY, JSON.stringify(withheld ? [...rest, { school: school.trim(), student: student.trim() }] : rest)); } catch { /* storage off */ }
    window.dispatchEvent(new Event('orator-published'));
    return;
  }
  if (withheld) {
    const { error } = await db().from('results_privacy').insert({ school: school.trim(), student: student.trim() });
    if (error && !/duplicate|unique/i.test(error.message)) fail(error.message);
  } else {
    const { error } = await db().from('results_privacy').delete().ilike('school', exactly(school)).ilike('student', exactly(student));
    if (error) fail(error.message);
  }
}

/** The demo's published scoring rules: every sample meet, plus the demo tournament if it was published with them. */
export function demoScoring(includeDemoTournament: boolean): PublishedScoring[] {
  const mine = includeDemoTournament ? loadDemoPublished() : null;
  const sample = demoMeets.map(meet => ({ tournamentId: meet.id, ...scoringOf(meet) }));
  return mine?.snapshot.scoring ? [...sample, { tournamentId: mine.tournament.id, ...mine.snapshot.scoring }] : sample;
}

// ── Reading (anyone) ──

type TournamentRecord = { id: string; name: string; date: string; host: string; published_at: string };
type PlacingRecord = { tournament_id: string; contest: string; event_id: string; division: Division; place: number; student: string; school: string; withheld?: boolean; qualifier?: QualifierStatus | null };
type TeamRecord = { tournament_id: string; school: string; points: number; place: number };
const toPlacing = (row: PlacingRecord): PublishedPlacing => ({ tournamentId: row.tournament_id, contest: row.contest, eventId: row.event_id, division: row.division === 'novice' ? 'novice' : 'varsity', place: row.place, student: row.withheld ? WITHHELD : row.student, school: row.school, ...(row.withheld ? { withheld: true } : {}), ...withQualifier(row.qualifier) });
const toTeam = (row: TeamRecord): PublishedTeam => ({ tournamentId: row.tournament_id, school: row.school, points: row.points, place: row.place });
/** Match a name exactly but without caring about case: escape the wildcards ilike would otherwise read. */
const exactly = (text: string) => text.trim().replace(/[\\%_]/g, match => `\\${match}`);

async function liveTournaments(): Promise<PublishedTournament[]> {
  const { data, error } = await db().rpc('published_tournaments');
  if (error) fail(error.message);
  return ((data ?? []) as TournamentRecord[]).map(row => ({ id: row.id, name: row.name, date: row.date, host: row.host, publishedAt: row.published_at }));
}

/**
 * What a public page needs. `filter` narrows the rows to one tournament, one school, or one student.
 * In the demo, `includeDemoTournament` adds the demo's own tournament if its director published it.
 */
export async function loadPublished(filter: { tournamentId?: string; school?: string; student?: string }, includeDemoTournament = true): Promise<PublishedResults> {
  if (!supabase) {
    const all = demoResults(includeDemoTournament);
    const keep = <T extends { tournamentId: string; school: string }>(row: T & { student?: string }) => (!filter.tournamentId || row.tournamentId === filter.tournamentId) && (!filter.school || sameSchool(row.school, filter.school)) && (!filter.student || (row.student !== undefined && sameName(row.student, filter.student)));
    return { tournaments: all.tournaments, placings: all.placings.filter(keep), teams: filter.student ? [] : all.teams.filter(keep) };
  }
  const tournaments = await liveTournaments();
  if (!filter.tournamentId && !filter.school) {
    // The list page: team standings only (for each team champion and the list of schools), no placings.
    const { data, error } = await db().from('published_team_points').select('tournament_id, school, points, place').order('place').limit(5000);
    if (error) fail(error.message);
    return { tournaments, placings: [], teams: ((data ?? []) as TeamRecord[]).map(toTeam) };
  }
  const placingQuery = (privacy: boolean) => {
    let query = db().from('published_results').select(`tournament_id, contest, event_id, division, place, student, school${privacy ? ', withheld, qualifier' : ''}`);
    if (filter.tournamentId) query = query.eq('tournament_id', filter.tournamentId);
    if (filter.school) query = query.ilike('school', exactly(filter.school));
    if (filter.student) query = query.ilike('student', exactly(filter.student));
    if (filter.student && privacy) query = query.eq('withheld', false);
    return query.order('place');
  };
  // Databases from before name privacy have no withheld column; read them without it.
  const readPlacings = async () => { const first = await placingQuery(true); return first.error && /withheld|qualifier/.test(first.error.message) ? placingQuery(false) : first; };
  let teamQuery = db().from('published_team_points').select('tournament_id, school, points, place');
  if (filter.tournamentId) teamQuery = teamQuery.eq('tournament_id', filter.tournamentId);
  if (filter.school) teamQuery = teamQuery.ilike('school', exactly(filter.school));
  const [placings, teams] = await Promise.all([readPlacings(), filter.student ? Promise.resolve({ data: [], error: null }) : teamQuery.order('place')]);
  if (placings.error) fail(placings.error.message);
  if (teams.error) fail(teams.error.message);
  return { tournaments, placings: ((placings.data ?? []) as unknown as PlacingRecord[]).map(toPlacing), teams: ((teams.data ?? []) as TeamRecord[]).map(toTeam) };
}

// ── Publishing (the tournament's director) ──

/** When this tournament's results were last published, or null. */
export async function publishedAt(tournamentId: string): Promise<string | null> {
  const { data, error } = await db().from('tournaments').select('results_published_at').eq('id', tournamentId).maybeSingle();
  if (error) fail(error.message);
  return (data as { results_published_at: string | null } | null)?.results_published_at ?? null;
}

/** Replace the published snapshot. The database refuses unless you direct this tournament and it has ended. */
export async function publishResults(tournamentId: string, snapshot: Snapshot): Promise<string> {
  const { data, error } = await db().rpc('publish_results', {
    target: tournamentId,
    placings: snapshot.placings.map(row => ({ contest: row.contest, event_id: row.eventId, division: row.division, place: row.place, student: row.student, school: row.school, qualifier: row.qualifier ?? null })),
    teams: snapshot.teams,
  });
  if (error) fail(error.message);
  // The scale behind the team points (supabase/team_compare.sql). Older databases without it still publish.
  if (snapshot.scoring) {
    const saved = await db().rpc('publish_team_scoring', { target: tournamentId, scale: snapshot.scoring.scale, novice_counts: snapshot.scoring.noviceCounts });
    if (saved.error && !/could not find|schema cache|does not exist/i.test(saved.error.message)) fail(saved.error.message);
  }
  return data as string;
}

export async function unpublishResults(tournamentId: string): Promise<void> {
  const { error } = await db().rpc('unpublish_results', { target: tournamentId });
  if (error) fail(error.message);
}
