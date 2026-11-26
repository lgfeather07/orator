/**
 * The tab room's status board (StatusBoard.tsx): which rounds are under way, and which of their rooms
 * are still out. Pure functions, so tests/statusBoard.test.mjs can check them.
 */

/** A room's ballot: none started, a draft saved, or submitted. */
export type RoomState = 'none' | 'draft' | 'submitted';
type Room = { id: string; round: number; entryIds: string[] };

/**
 * The rounds to watch: the earliest round with a room still out, plus any later round that has started
 * (a ballot saved or submitted) and isn't finished. When every ballot is in, the last round.
 * Rooms with no speakers are ignored.
 */
export function roundsInProgress(rooms: Room[], stateOf: (id: string) => RoomState): number[] {
  const real = rooms.filter(room => room.entryIds.length > 0);
  const rounds = [...new Set(real.map(room => room.round))].sort((a, b) => a - b);
  const open = rounds.filter(round => real.some(room => room.round === round && stateOf(room.id) !== 'submitted'));
  if (open.length === 0) return rounds.length ? [rounds[rounds.length - 1]] : [];
  const started = (round: number) => real.some(room => room.round === round && stateOf(room.id) !== 'none');
  return open.filter((round, index) => index === 0 || started(round));
}

export type RoomSummary = { total: number; submitted: number; drafts: number; notStarted: number; noJudge: number };

/** Counts for the board's headline. `noJudge` counts rooms still out that have nobody assigned. */
export function summarize(rooms: (Room & { judgeId: string | null })[], stateOf: (id: string) => RoomState): RoomSummary {
  const real = rooms.filter(room => room.entryIds.length > 0);
  const states = real.map(room => stateOf(room.id));
  return {
    total: real.length,
    submitted: states.filter(state => state === 'submitted').length,
    drafts: states.filter(state => state === 'draft').length,
    notStarted: states.filter(state => state === 'none').length,
    noJudge: real.filter(room => !room.judgeId && stateOf(room.id) !== 'submitted').length,
  };
}

/** Rooms still out, the ones nobody has started first, then by round and room name. */
export function stillOut<T extends Room & { room: string }>(rooms: T[], stateOf: (id: string) => RoomState): T[] {
  const order: Record<RoomState, number> = { none: 0, draft: 1, submitted: 2 };
  return rooms.filter(room => room.entryIds.length > 0 && stateOf(room.id) !== 'submitted')
    .sort((a, b) => order[stateOf(a.id)] - order[stateOf(b.id)] || a.round - b.round || a.room.localeCompare(b.room, undefined, { numeric: true }));
}

/**
 * The demo has no judges saving drafts, so some rooms without a ballot show a sample draft:
 * every third room, so the board shows all three states. Always the same rooms for the same schedule.
 */
export function demoDraft(index: number): boolean { return index % 3 === 1; }
