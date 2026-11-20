/**
 * Semifinal rooms: building them (seeding and judges) and reading their ballots.
 * The rules for ranking a semifinal room live with the other NSAA rules in results.ts.
 */
import { SEMI_DEFAULT, SEMI_ROOMS, seedSemis, semifinalStandings, type SemiResult, type SemiStanding, type Standing } from './results';
import { finalConflict, isFinal, parseContest, preferenceFor, roomsFor, stageOf, type Entry, type Judge, type JudgePrefs, type Section, type SemiPlan, type Tournament } from './tournament';

/** The director's semifinal plan for a contest, or null when the contest goes straight to a final. */
export const semiPlanFor = (tournament: Pick<Tournament, 'semisByContest'>, contest: string): SemiPlan | null => {
  const plan = tournament.semisByContest?.[contest];
  return plan ? { ...SEMI_DEFAULT, ...plan } : null;
};

/** Semifinals sit in the round after prelims; a contest with semifinals holds its final one round later. */
export const semiRound = (tournament: Tournament) => tournament.rounds + 1;
export const finalRoundFor = (tournament: Tournament, contest: string) => tournament.rounds + (semiPlanFor(tournament, contest) ? 2 : 1);

export const isSemi = (section: Section, tournament: Tournament) => stageOf(section, tournament) === 'semi';
const contestOfSection = (section: Section) => section.division === 'novice' ? `${section.eventId}:novice` : section.eventId;

/** One semifinal room: the same speakers heard by one or more judges, one section (ballot) per judge. */
export type SemiRoom = { room: string; letter: string; seats: Section[]; entryIds: string[] };

/** A contest's semifinal rooms, in room order (A, B). */
export function semiRoomsOf(sections: Section[], contest: string, tournament: Tournament): SemiRoom[] {
  const mine = sections.filter(section => isSemi(section, tournament) && contestOfSection(section) === contest);
  const byRoom = new Map<string, Section[]>();
  mine.forEach(section => byRoom.set(section.room, [...(byRoom.get(section.room) ?? []), section]));
  return [...byRoom.entries()].map(([room, seats]) => {
    const sorted = [...seats].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    const letter = /Semifinal ([A-Z])/i.exec(sorted[0].label)?.[1] ?? '';
    return { room, letter, seats: sorted, entryIds: sorted[0].entryIds };
  }).sort((a, b) => a.letter.localeCompare(b.letter) || a.room.localeCompare(b.room));
}

/** Ballot rows for one semifinal room, from whichever seats have a ballot in. */
export function semiResultsFor(room: SemiRoom, roomResults: { sectionId: string; entryId: string; rank: number; rating: number }[]): SemiResult[] {
  return room.seats.flatMap((seat, index) => roomResults.filter(result => result.sectionId === seat.id).map(result => ({ entryId: result.entryId, judge: index + 1, rank: result.rank, rating: result.rating })));
}

export type SemiProgress = {
  rooms: SemiRoom[];
  /** Standings in each room, from the ballots in so far. */
  standings: SemiStanding[][];
  ballotsIn: number; ballots: number;
  /** Every semifinal ballot is in. */
  complete: boolean;
  /** Who makes the final, once complete (empty until then). */
  advancers: string[];
};

/** Where a contest's semifinals stand: rooms, ballots in, standings, and who advanced. */
export function semiProgress(sections: Section[], contest: string, tournament: Tournament, prelim: Standing[], roomResults: { sectionId: string; entryId: string; rank: number; rating: number }[]): SemiProgress {
  const plan = semiPlanFor(tournament, contest) ?? SEMI_DEFAULT;
  const semiRooms = semiRoomsOf(sections, contest, tournament);
  const done = new Set(roomResults.map(result => result.sectionId));
  const ballots = semiRooms.reduce((total, room) => total + room.seats.length, 0);
  const ballotsIn = semiRooms.reduce((total, room) => total + room.seats.filter(seat => done.has(seat.id)).length, 0);
  const complete = ballots > 0 && ballotsIn === ballots;
  const standings = semiRooms.map(room => semifinalStandings(prelim, room.entryIds, semiResultsFor(room, roomResults), plan.advance));
  return { rooms: semiRooms, standings, ballotsIn, ballots, complete, advancers: complete ? standings.flatMap(room => room.filter(standing => standing.advances).map(standing => standing.entryId)) : [] };
}

/** Why a judge can't hear a semifinal room, or '' if they can. Same rules as a final, for that room's schools. */
export const semiConflict = (judge: Judge, contest: string, roomSchools: string[], sections: Section[], tournament: Tournament) => {
  const why = finalConflict(judge, contest, roomSchools, sections, tournament);
  return why === 'semi' ? '' : why;
};

const levelRank = { top: 0, willing: 1, avoid: 2 };

/**
 * Semifinal rooms for one contest: the top `plan.size` after prelims, snake-seeded into two rooms with
 * teammates spread, and `plan.judges` judges in each room (one section, so one ballot, per judge).
 *
 * Judges are chosen as for finals: by preference, clean judges first among equals, never a judge who heard
 * this event in prelims or who has a speaker from their own (or a known) school in that room, and never
 * a judge already on another semifinal or final in the same round. A seat nobody can fill is left open.
 */
export function buildSemis(tournament: Tournament, contest: string, prelim: Standing[], entries: Entry[], judges: Judge[], existing: Section[], preferences: Record<string, JudgePrefs> = {}, plan: SemiPlan = SEMI_DEFAULT): Section[] {
  const { eventId, division } = parseContest(contest);
  const round = semiRound(tournament);
  const seeded = seedSemis(prelim, plan.size, SEMI_ROOMS);
  if (seeded.every(room => room.length === 0)) return [];
  const sameRound = existing.filter(section => section.round === round && isFinal(section, tournament));
  const busy = new Set(sameRound.map(section => section.judgeId));
  const order = (judge: Judge) => { const prefs = preferences[judge.id]; const level = preferenceFor(prefs, eventId); const index = prefs?.findIndex(item => item.id === eventId) ?? -1; return levelRank[level] * 1000 + (judge.clean ? 0 : 100) + (index >= 0 ? index : 50); };
  const ranked = judges.map((judge, index) => ({ judge, score: order(judge), index })).sort((a, b) => a.score - b.score || a.index - b.index).map(item => item.judge);
  // Rooms come from the end of the list so they don't take the rooms finals are given, which start at the front.
  const takenRooms = new Set(sameRound.map(section => section.room));
  const rooms = roomsFor(tournament);
  const freeRooms = [...rooms].reverse().filter(room => !takenRooms.has(room));
  const schoolOf = (id: string) => entries.find(entry => entry.id === id)?.school ?? '';
  const chosen: (Judge | null)[][] = seeded.map(() => []);
  // Fill seat 1 in every room, then seat 2, so one room doesn't take all the best-matched judges.
  for (let seat = 0; seat < plan.judges; seat++) seeded.forEach((ids, roomIndex) => {
    const schools = ids.map(schoolOf);
    const judge = ranked.find(candidate => !busy.has(candidate.id) && semiConflict(candidate, contest, schools, existing, tournament) === '') ?? null;
    if (judge) busy.add(judge.id);
    chosen[roomIndex].push(judge);
  });
  const prefix = division === 'novice' ? 'Novice semifinal' : 'Semifinal';
  return seeded.flatMap((ids, roomIndex) => {
    const letter = String.fromCharCode(65 + roomIndex);
    const room = freeRooms[roomIndex % Math.max(freeRooms.length, 1)] ?? rooms[roomIndex];
    // Lowest seed speaks first, as in a final.
    return chosen[roomIndex].map((judge, seat) => ({
      id: `semi-${eventId}${division === 'novice' ? '-novice' : ''}-${letter.toLowerCase()}-${seat + 1}`, round, stage: 'semi' as const, eventId, division,
      label: `${prefix} ${letter} · Judge ${seat + 1}`, room, judgeId: judge?.id ?? null, judgeName: judge?.name ?? '', entryIds: [...ids].reverse(),
    }));
  });
}

/** "Finals", or "Semifinals and finals" when some contest holds semifinals in that round. For round pickers. */
export const elimRoundLabel = (round: number, tournament: Tournament, sections: Section[]) => {
  const here = sections.filter(section => section.round === round);
  const semis = here.some(section => isSemi(section, tournament)), finals = here.some(section => stageOf(section, tournament) === 'final');
  return semis && finals ? 'Semifinals and finals' : semis ? 'Semifinals' : round > tournament.rounds + 1 ? 'Finals (after semifinals)' : 'Finals';
};

/** "Semifinal", "Final round", or "Round 2" for a ballot's heading. */
export const ballotRoundLabel = (room: { final?: boolean; stage?: string } | undefined, round: number) => room?.stage === 'semi' ? 'Semifinal' : room?.final || room?.stage === 'final' ? 'Final round' : `Round ${round}`;
