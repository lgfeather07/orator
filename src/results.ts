/**
 * Breaks, final placement, and team points, following the NSAA Speech Manual
 * ("Determining Final Rounds", "Determining Placings", "Team Scoring").
 * Pure functions: the same code serves the demo's sample results and, later, real ballots.
 */
import type { Entry, Section, Tournament } from './tournament';

/** One speaker's result in one preliminary section. */
export type PrelimResult = { entryId: string; round: number; sectionId: string; rank: number; rating: number };
/** One finals judge's rank and rating for one finalist. */
export type FinalResult = { entryId: string; judge: number; rank: number; rating: number };

export const FINALISTS = 6;
/** A final is one room, and a room holds at most this many speakers. */
export const FINAL_ROOM_LIMIT = 8;
/** Cut points the director can choose between. */
export const CUT_CHOICES = [4, 5, 6, 7, 8];

/** How many finalists a contest takes: the director's choice for that contest, then for the tournament, then the NSAA six. */
export const cutFor = (tournament: Pick<Tournament, 'finalists' | 'finalistsByContest'>, contest: string) => tournament.finalistsByContest?.[contest] ?? tournament.finalists ?? FINALISTS;
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
  /** Which rule put this speaker ahead of the next one down ('Cumulative rank' when there was no tie, '' if still tied or last). */
  aheadOfNextBy?: string;
};

type Tiebreak = { label: string; score: (id: string) => number; better: 'low' | 'high' };

/**
 * Order a set of speakers by a list of rules. Each rule only splits speakers still tied after the
 * rules before it; `headToHead` is tried between the rules, and only for an exact two-way tie.
 * Returns groups in order; a group of more than one is an unbroken tie.
 */
function orderBy(ids: string[], rules: (Tiebreak | 'head-to-head')[], headToHead: (a: string, b: string) => string | null, decidedBy: Map<string, string>, between: string[] = []): string[][] {
  let groups: string[][] = [ids];
  // `between[i]` names the rule that split group i from group i + 1.
  between.length = 0;
  rules.forEach((rule, ruleIndex) => {
    const label = rule === 'head-to-head' ? 'Head-to-head' : rule.label;
    const nextBetween: string[] = [];
    groups = groups.flatMap((group, groupIndex) => {
      const parts = split(group, rule, ruleIndex);
      parts.slice(1).forEach(() => nextBetween.push(label));
      if (groupIndex < groups.length - 1) nextBetween.push(between[groupIndex]);
      return parts;
    });
    between.splice(0, between.length, ...nextBetween);
  });
  return groups;

  function split(group: string[], rule: Tiebreak | 'head-to-head', ruleIndex: number): string[][] {
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
  }
}

/**
 * Preliminary standings for one event and who advances to the final.
 * Tie-breaks, in order: opponents' average rank, head-to-head, reciprocals, rating points.
 */
export function prelimStandings(entries: Entry[], sections: Section[], results: PrelimResult[], finalists: number = FINALISTS): Standing[] {
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
  const between: string[] = [];
  const groups = orderBy(scored.map(entry => entry.id), [
    { label: 'Cumulative rank', score: cumulative, better: 'low' },
    { label: 'Opponents’ average rank', score: opponents, better: 'low' },
    'head-to-head',
    { label: 'Reciprocals', score: id => sum((mine.get(id) ?? []).map(result => reciprocal(result.rank))), better: 'high' },
    { label: 'Rating points', score: id => sum((mine.get(id) ?? []).map(result => result.rating)), better: 'high' },
  ], headToHead, decidedBy, between);

  const standings: Standing[] = [];
  let place = 1;
  groups.forEach((group, groupIndex) => {
    group.forEach((id, index) => {
      const entry = entries.find(item => item.id === id)!; const rows = mine.get(id) ?? [];
      standings.push({
        entryId: id, student: entry.student, school: entry.school, ranks: rows.map(result => result.rank), cumulativeRank: cumulative(id),
        opponentsAverageRank: opponents(id), reciprocals: sum(rows.map(result => reciprocal(result.rank))), ratingPoints: sum(rows.map(result => result.rating)),
        // An unbroken tie at the cut line advances together, as the manual allows the director to decide.
        place, advances: place <= finalists, decidedBy: group.length > 1 ? 'Still tied' : decidedBy.get(id) ?? '',
        aheadOfNextBy: index < group.length - 1 ? '' : between[groupIndex] ?? '',
      });
    });
    place += group.length;
  });
  return standings;
}

/** What one cut point would do to a contest's final. */
export type CutOption = {
  cut: number;
  /** How many speakers make the final at this cut. */
  advancing: number;
  /** Speakers in an unbroken tie across the cut line (0 when the line is clean). They all advance. */
  tiedAtCut: number;
  /** True when the field is no bigger than the cut, so everyone advances. */
  everyone: boolean;
  /** The rule that put the last speaker in ahead of the first speaker out: 'Cumulative rank' when there was no tie, 'Still tied' when nothing could. */
  decidedBy: string;
  /** More speakers than one final room holds. */
  overRoom: boolean;
};

/** What a cut of `cut` finalists would do, given standings in order (from `prelimStandings`). */
export function cutAt(standings: Standing[], cut: number): CutOption {
  if (standings.length <= cut) return { cut, advancing: standings.length, tiedAtCut: 0, everyone: true, decidedBy: '', overRoom: standings.length > FINAL_ROOM_LIMIT };
  const advancing = standings.filter(standing => standing.place <= cut).length;
  const line = standings[cut - 1];
  const tiedAtCut = advancing > cut ? standings.filter(standing => standing.place === line.place).length : 0;
  return { cut, advancing, tiedAtCut, everyone: false, decidedBy: tiedAtCut ? 'Still tied' : line.aheadOfNextBy ?? '', overRoom: advancing > FINAL_ROOM_LIMIT };
}

/** The cut points worth showing for a field this size: 4 to 8, but none past the size of the field. */
export const cutChoices = (fieldSize: number) => CUT_CHOICES.filter(cut => cut <= Math.max(fieldSize, CUT_CHOICES[0]));

/**
 * "Next in": the speakers just below the cut, in order, who move up if a finalist withdraws before the
 * final begins. `inFinal` is who is already in the final (by default, everyone who advanced).
 */
export function nextIn(standings: Standing[], inFinal: string[] = standings.filter(standing => standing.advances).map(standing => standing.entryId), count = 2): Standing[] {
  const taken = new Set(inFinal);
  return standings.filter(standing => !standing.advances && !taken.has(standing.entryId)).slice(0, count);
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
  const size = Math.max(FINALISTS, ...finalists.map(finalist => finalist.place));
  return Array.from({ length: judges }, (_, judgeIndex) => {
    const order = finalists.map(finalist => ({ id: finalist.entryId, score: (size + 1 - finalist.place) / size * 0.6 + seeded(`${finalist.entryId}|final|${judgeIndex}`) * 0.4 })).sort((a, b) => b.score - a.score);
    return order.map((item, index) => ({ entryId: item.id, judge: judgeIndex + 1, rank: index + 1, rating: Math.max(35, 50 - index * 2) }));
  }).flat();
}

// ── Semifinals ──
// A big field can hold a semifinal round between prelims and the final: the top 10 to 16 after prelims
// split into two rooms, and the top few in each room make the final.

/** Semifinal rooms per contest. */
export const SEMI_ROOMS = 2;
/** How many speakers can make the semifinals. */
export const SEMI_SIZES = [10, 11, 12, 13, 14, 15, 16];
/** Judges in each semifinal room, and finalists from each room, the director can choose between. */
export const SEMI_JUDGE_CHOICES = [1, 2, 3];
export const SEMI_ADVANCE_CHOICES = [2, 3, 4];
/** Twelve semifinalists, one judge a room, the top three of each room to the final. */
export const SEMI_DEFAULT = { size: 12, judges: 1, advance: 3 };
/** A field bigger than this is worth a semifinal round. Only a suggestion: the director decides. */
export const LARGE_FIELD = 30;
/** Semifinals need at least this many entries to be worth holding. */
export const semisPossible = (fieldSize: number) => fieldSize >= SEMI_SIZES[0];
/** The semifinal sizes worth showing for a field this size. */
export const semiSizeChoices = (fieldSize: number) => SEMI_SIZES.filter(size => size <= fieldSize);

/**
 * Split the top `size` speakers into semifinal rooms by snake seeding (1 and 4 in room A, 2 and 3 in
 * room B, and so on), so the rooms are equally strong. An unbroken tie at the line takes everyone tied.
 * Teammates are then spread where possible by swapping speakers of the same seed tier between rooms,
 * starting from the lowest tier so the top seeds stay where the snake put them.
 * Returns each room's entry ids, best seed first.
 */
export function seedSemis(standings: Standing[], size: number, rooms = SEMI_ROOMS): string[][] {
  const seeds = standings.filter(standing => standing.place <= size);
  const school = new Map(seeds.map(seed => [seed.entryId, seed.school.trim().toLowerCase()]));
  const roomOf = seeds.map((_, index) => { const tier = Math.floor(index / rooms), position = index % rooms; return tier % 2 === 0 ? position : rooms - 1 - position; });
  const clashes = () => {
    let total = 0;
    for (let a = 0; a < seeds.length; a++) for (let b = a + 1; b < seeds.length; b++) if (roomOf[a] === roomOf[b] && school.get(seeds[a].entryId) === school.get(seeds[b].entryId)) total++;
    return total;
  };
  const tiers = Math.ceil(seeds.length / rooms);
  for (let pass = 0; pass < 4; pass++) {
    let improved = false;
    for (let tier = tiers - 1; tier >= 0; tier--) {
      const members = Array.from({ length: rooms }, (_, position) => tier * rooms + position).filter(index => index < seeds.length);
      for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
        const [a, b] = [members[i], members[j]]; const before = clashes();
        [roomOf[a], roomOf[b]] = [roomOf[b], roomOf[a]];
        if (clashes() < before) improved = true; else [roomOf[a], roomOf[b]] = [roomOf[b], roomOf[a]];
      }
    }
    if (!improved) break;
  }
  return Array.from({ length: rooms }, (_, room) => seeds.filter((_, index) => roomOf[index] === room).map(seed => seed.entryId));
}

/** One semifinal judge's rank and rating for one speaker. `judge` is the judge's seat in that room (1, 2, 3). */
export type SemiResult = { entryId: string; judge: number; rank: number; rating: number };
export type SemiStanding = {
  entryId: string; student: string; school: string;
  /** Place after prelims. */
  seed: number;
  judgeRanks: number[]; cumulativeRank: number; reciprocals: number; ratingPoints: number;
  /** Place within the semifinal room. */
  place: number; advances: boolean; decidedBy: string;
};

/**
 * Standings in one semifinal room and who makes the final: the top `advance`. Ordered by cumulative
 * rank across the room's judges, then reciprocals, then rating points, then the preliminary place.
 * An unbroken tie at the line advances together, as at the prelim cut.
 */
export function semifinalStandings(prelim: Standing[], roomIds: string[], results: SemiResult[], advance: number): SemiStanding[] {
  const rows = new Map(roomIds.map(id => [id, results.filter(result => result.entryId === id).sort((a, b) => a.judge - b.judge)]));
  const seedOf = new Map(prelim.map(standing => [standing.entryId, standing]));
  const cumulative = (id: string) => sum((rows.get(id) ?? []).map(result => result.rank));
  const decidedBy = new Map<string, string>();
  const groups = orderBy(roomIds.filter(id => (rows.get(id) ?? []).length > 0 && seedOf.has(id)), [
    { label: 'Cumulative rank', score: cumulative, better: 'low' },
    { label: 'Reciprocals', score: id => sum((rows.get(id) ?? []).map(result => reciprocal(result.rank))), better: 'high' },
    { label: 'Rating points', score: id => sum((rows.get(id) ?? []).map(result => result.rating)), better: 'high' },
    { label: 'Preliminary place', score: id => seedOf.get(id)!.place, better: 'low' },
  ], () => null, decidedBy);
  const standings: SemiStanding[] = [];
  let place = 1;
  groups.forEach(group => {
    group.forEach(id => {
      const seed = seedOf.get(id)!; const mine = rows.get(id) ?? [];
      standings.push({
        entryId: id, student: seed.student, school: seed.school, seed: seed.place, judgeRanks: mine.map(result => result.rank), cumulativeRank: cumulative(id),
        reciprocals: sum(mine.map(result => reciprocal(result.rank))), ratingPoints: sum(mine.map(result => result.rating)),
        place, advances: place <= advance, decidedBy: group.length > 1 ? 'Still tied' : decidedBy.get(id) ?? '',
      });
    });
    place += group.length;
  });
  return standings;
}

/** Everyone who made the final from the semifinal rooms, room by room. */
export const semifinalAdvancers = (rooms: SemiStanding[][]) => rooms.flatMap(room => room.filter(standing => standing.advances).map(standing => standing.entryId));

/**
 * Places for semifinalists who did not make the final. They place after every finalist (7th to 12th with six
 * finalists), ordered by their place in their room, then cumulative rank, reciprocals, rating points, and the
 * preliminary place. Team points only where the scale reaches that far (the NSAA scale stops at 6th).
 */
export function semifinalistPlacings(rooms: SemiStanding[][], teamPoints: number[] = NSAA_TEAM_POINTS): Placing[] {
  const finalists = semifinalAdvancers(rooms).length;
  const key = (standing: SemiStanding) => [standing.place, standing.cumulativeRank, -standing.reciprocals, -standing.ratingPoints, standing.seed].map(value => Math.round(value * 10000) / 10000);
  const out = rooms.flat().filter(standing => !standing.advances).sort((a, b) => { const ka = key(a), kb = key(b); for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]; return 0; });
  const placings: Placing[] = [];
  out.forEach((standing, index) => {
    const tiedWithPrevious = index > 0 && key(out[index - 1]).join() === key(standing).join();
    const place = tiedWithPrevious ? placings[index - 1].place : finalists + index + 1;
    placings.push({ entryId: standing.entryId, student: standing.student, school: standing.school, judgeRanks: standing.judgeRanks, cumulativeRank: standing.cumulativeRank, reciprocals: standing.reciprocals, ratingPoints: standing.ratingPoints, place, decidedBy: 'Semifinalist', teamPoints: teamPoints[place - 1] ?? 0 });
  });
  return placings;
}

/** Sample semifinal ballots for the demo: one room's judges rank its speakers, stronger seeds usually higher. */
export function sampleSemis(prelim: Standing[], roomIds: string[], judges: number, room: string): SemiResult[] {
  const seedOf = new Map(prelim.map(standing => [standing.entryId, standing.place]));
  const size = Math.max(SEMI_DEFAULT.size, ...roomIds.map(id => seedOf.get(id) ?? 0));
  return Array.from({ length: judges }, (_, judgeIndex) => {
    const order = roomIds.map(id => ({ id, score: (size + 1 - (seedOf.get(id) ?? size)) / size * 0.55 + seeded(`${id}|semi|${room}|${judgeIndex}`) * 0.45 })).sort((a, b) => b.score - a.score);
    return order.map((item, index) => ({ entryId: item.id, judge: judgeIndex + 1, rank: index + 1, rating: Math.max(35, 50 - index * 2) }));
  }).flat();
}
