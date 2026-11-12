/**
 * Breaks, final placement, and team points, following the NSAA Speech Manual
 * ("Determining Final Rounds", "Determining Placings", "Team Scoring").
 * Pure functions: the same code serves the demo's sample results and, later, real ballots.
 */
import type { Entry, Section } from './tournament';

/** One speaker's result in one preliminary section. */
export type PrelimResult = { entryId: string; round: number; sectionId: string; rank: number; rating: number };
/** One finals judge's rank and rating for one finalist. */
export type FinalResult = { entryId: string; judge: number; rank: number; rating: number };

export const FINALISTS = 6;
/** NSAA sweepstakes: final round only. Tournaments may use their own scale. */
export const NSAA_TEAM_POINTS = [20, 18, 16, 14, 12, 10];

const reciprocal = (rank: number) => 1 / rank;
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

export type Standing = {
  entryId: string; student: string; school: string;
  ranks: number[]; cumulativeRank: number; opponentsAverageRank: number; reciprocals: number; ratingPoints: number;
  place: number; advances: boolean;
  /** Which rule separated this speaker from someone they were tied with, if any. */
  decidedBy: string;
};

type Tiebreak = { label: string; score: (id: string) => number; better: 'low' | 'high' };

/**
 * Order a set of speakers by a list of rules. Each rule only splits speakers still tied after the
 * rules before it; `headToHead` is tried between the rules, and only for an exact two-way tie.
 * Returns groups in order; a group of more than one is an unbroken tie.
 */
function orderBy(ids: string[], rules: (Tiebreak | 'head-to-head')[], headToHead: (a: string, b: string) => string | null, decidedBy: Map<string, string>): string[][] {
  let groups: string[][] = [ids];
  rules.forEach((rule, ruleIndex) => {
    groups = groups.flatMap(group => {
      if (group.length < 2) return [group];
      if (rule === 'head-to-head') {
        if (group.length !== 2) return [group];
        const winner = headToHead(group[0], group[1]);
        if (!winner) return [group];
        group.forEach(id => decidedBy.set(id, 'Head-to-head'));
        return [[winner], [group.find(id => id !== winner)!]];
      }
      const buckets = new Map<number, string[]>();
      group.forEach(id => { const key = Math.round(rule.score(id) * 10000) / 10000; buckets.set(key, [...(buckets.get(key) ?? []), id]); });
      if (buckets.size === 1) return [group];
      // The first rule is the main result, not a tie-break, so it isn't named as one.
      if (ruleIndex > 0) group.forEach(id => { if (!decidedBy.has(id)) decidedBy.set(id, rule.label); });
      return [...buckets.entries()].sort((a, b) => rule.better === 'low' ? a[0] - b[0] : b[0] - a[0]).map(([, members]) => members);
    });
  });
  return groups;
}

/**
 * Preliminary standings for one event and who advances to the final.
 * Tie-breaks, in order: opponents' average rank, head-to-head, reciprocals, rating points.
 */
export function prelimStandings(entries: Entry[], sections: Section[], results: PrelimResult[]): Standing[] {
  const mine = new Map(entries.map(entry => [entry.id, results.filter(result => result.entryId === entry.id).sort((a, b) => a.round - b.round)]));
  const scored = entries.filter(entry => (mine.get(entry.id) ?? []).length > 0);
  const cumulative = (id: string) => sum((mine.get(id) ?? []).map(result => result.rank));
  const averageRank = (id: string) => { const rows = mine.get(id) ?? []; return rows.length ? cumulative(id) / rows.length : 0; };
  // Opponents' average rank ("strength of schedule"): the average preliminary rank of everyone this
  // speaker shared a room with. A lower number means tougher rooms, so it wins the tie.
  const opponents = (id: string) => {
    const met = sections.filter(section => section.entryIds.includes(id) && (mine.get(id) ?? []).some(result => result.sectionId === section.id)).flatMap(section => section.entryIds.filter(other => other !== id && mine.has(other)));
    return met.length ? sum(met.map(averageRank)) / met.length : 0;
  };
  const headToHead = (a: string, b: string) => {
    const shared = (mine.get(a) ?? []).filter(result => (mine.get(b) ?? []).some(other => other.sectionId === result.sectionId));
    if (shared.length === 0) return null;
    const aWins = shared.filter(result => result.rank < (mine.get(b) ?? []).find(other => other.sectionId === result.sectionId)!.rank).length;
    // The same speaker must have ranked higher every time they met.
    return aWins === shared.length ? a : aWins === 0 ? b : null;
  };
  const decidedBy = new Map<string, string>();
  const groups = orderBy(scored.map(entry => entry.id), [
    { label: 'Cumulative rank', score: cumulative, better: 'low' },
    { label: 'Opponents’ average rank', score: opponents, better: 'low' },
    'head-to-head',
    { label: 'Reciprocals', score: id => sum((mine.get(id) ?? []).map(result => reciprocal(result.rank))), better: 'high' },
    { label: 'Rating points', score: id => sum((mine.get(id) ?? []).map(result => result.rating)), better: 'high' },
  ], headToHead, decidedBy);

  const standings: Standing[] = [];
  let place = 1;
  groups.forEach(group => {
    group.forEach(id => {
      const entry = entries.find(item => item.id === id)!; const rows = mine.get(id) ?? [];
      standings.push({
        entryId: id, student: entry.student, school: entry.school, ranks: rows.map(result => result.rank), cumulativeRank: cumulative(id),
        opponentsAverageRank: opponents(id), reciprocals: sum(rows.map(result => reciprocal(result.rank))), ratingPoints: sum(rows.map(result => result.rating)),
        // An unbroken tie at the cut line advances together, as the manual allows the director to decide.
        place, advances: place <= FINALISTS, decidedBy: group.length > 1 ? 'Still tied' : decidedBy.get(id) ?? '',
      });
    });
    place += group.length;
  });
  return standings;
}

export type Placing = { entryId: string; student: string; school: string; judgeRanks: number[]; cumulativeRank: number; reciprocals: number; ratingPoints: number; place: number; decidedBy: string; teamPoints: number };

/**
 * Final placement for one event. With three judges the first tie-break is judge's preference;
 * with two there is none. Then: reciprocals and rating points in the final, then the preliminary
 * record (cumulative rank, opponents' average rank, reciprocals, rating points).
 */
export function finalPlacings(finalists: Standing[], finals: FinalResult[], teamPoints: number[] = NSAA_TEAM_POINTS): Placing[] {
  const rows = new Map(finalists.map(finalist => [finalist.entryId, finals.filter(result => result.entryId === finalist.entryId).sort((a, b) => a.judge - b.judge)]));
  const judges = Math.max(0, ...finals.map(result => result.judge));
  const prelim = new Map(finalists.map(finalist => [finalist.entryId, finalist]));
  const cumulative = (id: string) => sum((rows.get(id) ?? []).map(result => result.rank));
  // Judge's preference: the speaker more of the final-round judges ranked higher.
  const preference = (a: string, b: string) => {
    if (judges < 3) return null;
    const aWins = (rows.get(a) ?? []).filter(result => result.rank < ((rows.get(b) ?? []).find(other => other.judge === result.judge)?.rank ?? Infinity)).length;
    const bWins = (rows.get(b) ?? []).filter(result => result.rank < ((rows.get(a) ?? []).find(other => other.judge === result.judge)?.rank ?? Infinity)).length;
    return aWins > bWins ? a : bWins > aWins ? b : null;
  };
  const decidedBy = new Map<string, string>();
  const groups = orderBy(finalists.filter(finalist => (rows.get(finalist.entryId) ?? []).length > 0).map(finalist => finalist.entryId), [
    { label: 'Cumulative rank', score: cumulative, better: 'low' },
    'head-to-head',
    { label: 'Reciprocals in the final', score: id => sum((rows.get(id) ?? []).map(result => reciprocal(result.rank))), better: 'high' },
    { label: 'Rating points in the final', score: id => sum((rows.get(id) ?? []).map(result => result.rating)), better: 'high' },
    { label: 'Preliminary cumulative rank', score: id => prelim.get(id)!.cumulativeRank, better: 'low' },
    { label: 'Preliminary opponents’ average rank', score: id => prelim.get(id)!.opponentsAverageRank, better: 'low' },
    { label: 'Preliminary reciprocals', score: id => prelim.get(id)!.reciprocals, better: 'high' },
    { label: 'Preliminary rating points', score: id => prelim.get(id)!.ratingPoints, better: 'high' },
  ], preference, decidedBy);
  const placings: Placing[] = [];
  let place = 1;
  groups.forEach(group => {
    group.forEach(id => {
      const finalist = prelim.get(id)!; const mine = rows.get(id) ?? [];
      placings.push({
        entryId: id, student: finalist.student, school: finalist.school, judgeRanks: mine.map(result => result.rank), cumulativeRank: cumulative(id),
        reciprocals: sum(mine.map(result => reciprocal(result.rank))), ratingPoints: sum(mine.map(result => result.rating)), place,
        decidedBy: group.length > 1 ? 'Tied: judges decide together' : decidedBy.get(id) === 'Head-to-head' ? 'Judge’s preference' : decidedBy.get(id) ?? '',
        teamPoints: teamPoints[place - 1] ?? 0,
      });
    });
    place += group.length;
  });
  return placings;
}

export type TeamScore = { school: string; points: number; finalists: number; places: string[] };

/** Team (sweepstakes) points: the final round only, added up across events. */
export function teamStandings(placingsByEvent: { eventName: string; placings: Placing[] }[]): TeamScore[] {
  const teams = new Map<string, TeamScore>();
  placingsByEvent.forEach(({ eventName, placings }) => placings.forEach(placing => {
    const team = teams.get(placing.school) ?? { school: placing.school, points: 0, finalists: 0, places: [] };
    team.points += placing.teamPoints; team.finalists += 1; team.places.push(`${placing.student} · ${eventName} · ${placing.place}`);
    teams.set(placing.school, team);
  }));
  return [...teams.values()].sort((a, b) => b.points - a.points || b.finalists - a.finalists || a.school.localeCompare(b.school));
}

/** Small repeatable pseudo-random number in [0, 1) from a string. */
const seeded = (key: string) => { let hash = 2166136261; for (let i = 0; i < key.length; i++) { hash ^= key.charCodeAt(i); hash = Math.imul(hash, 16777619); } return ((hash >>> 0) % 10000) / 10000; };

/** Sample preliminary results for the demo: each speaker has a steady level plus some round-to-round luck. */
export function samplePrelims(entries: Entry[], sections: Section[]): PrelimResult[] {
  const level = (id: string) => { const entry = entries.find(item => item.id === id); return entry ? seeded(`${entry.student}|${entry.eventId}`) : 0; };
  return sections.flatMap(section => {
    const scored = section.entryIds.map(id => ({ id, score: level(id) * 0.7 + seeded(`${id}|${section.id}`) * 0.3 })).sort((a, b) => b.score - a.score);
    return scored.map((item, index) => ({ entryId: item.id, round: section.round, sectionId: section.id, rank: index + 1, rating: Math.max(35, Math.min(50, Math.round(49 - index * 2.2 - (1 - item.score) * 3))) }));
  });
}

/** Sample final-round results for the demo. */
export function sampleFinals(finalists: Standing[], judges: number): FinalResult[] {
  return Array.from({ length: judges }, (_, judgeIndex) => {
    const order = finalists.map(finalist => ({ id: finalist.entryId, score: (FINALISTS + 1 - finalist.place) / FINALISTS * 0.6 + seeded(`${finalist.entryId}|final|${judgeIndex}`) * 0.4 })).sort((a, b) => b.score - a.score);
    return order.map((item, index) => ({ entryId: item.id, judge: judgeIndex + 1, rank: index + 1, rating: Math.max(35, 50 - index * 2) }));
  }).flat();
}
