/**
 * Growth from real ballots: for each student and event, their average rating (out of 50) and average rank
 * at each tournament, oldest first. Used by the signed-in coach and student growth pages.
 */

/** The fields of a submitted ballot entry that growth needs (a TeamBallotRow fits). */
export type GrowthBallot = { speaker: string; eventId: string; tournament: string; round: number; rank: number | null; rating: number | null; present: boolean | null; marks: number[]; submittedAt: string | null };

/** One tournament in one event. rating and rank are null when no ballot gave one (paper ballots may skip points). */
export type GrowthPoint = { tournament: string; label: string; when: string; rating: number | null; rank: number | null; ballots: number };
export type StudentGrowthStats = { student: string; events: Record<string, GrowthPoint[]> };

const norm = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();
const mean = (values: number[]) => values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : null;

/** A short name for a chart label: "Larkspur Invitational" → "Larkspur". */
export function shortLabel(name: string): string {
  const trimmed = name.replace(/\b(invitational|invite|tournament|speech|forensics|high school|high|meet|classic)\b/gi, '').replace(/\s+/g, ' ').trim() || name.trim();
  return trimmed.length > 14 ? `${trimmed.slice(0, 13).trimEnd()}…` : trimmed;
}

/**
 * Group ballots by student, event and tournament. A tournament is dated by its earliest submitted ballot.
 * Absent speakers and ballots without a rank or rating are left out of those averages. Keeps the last `limit` tournaments.
 */
export function buildGrowth(rows: GrowthBallot[], limit = 6): StudentGrowthStats[] {
  const students = new Map<string, { name: string; events: Map<string, Map<string, GrowthBallot[]>> }>();
  rows.forEach(row => {
    if (row.present === false || !row.speaker.trim() || !row.eventId) return;
    const student = students.get(norm(row.speaker)) ?? { name: row.speaker.trim(), events: new Map() };
    students.set(norm(row.speaker), student);
    const byTournament = student.events.get(row.eventId) ?? new Map<string, GrowthBallot[]>();
    student.events.set(row.eventId, byTournament);
    byTournament.set(row.tournament, [...(byTournament.get(row.tournament) ?? []), row]);
  });
  return [...students.values()].map(({ name, events }) => ({
    student: name,
    events: Object.fromEntries([...events.entries()].map(([eventId, byTournament]) => {
      const points = [...byTournament.entries()].map(([tournament, ballots]) => ({
        tournament, label: shortLabel(tournament), ballots: ballots.length,
        when: ballots.map(ballot => ballot.submittedAt ?? '').filter(Boolean).sort()[0] ?? '',
        rating: mean(ballots.flatMap(ballot => ballot.rating ? [ballot.rating] : [])),
        rank: mean(ballots.flatMap(ballot => ballot.rank ? [ballot.rank] : [])),
      })).sort((a, b) => a.when.localeCompare(b.when) || a.tournament.localeCompare(b.tournament));
      return [eventId, points.slice(-limit)];
    })),
  })).sort((a, b) => a.student.localeCompare(b.student));
}

/** Change from the first tournament to the latest, or null with fewer than two values. */
export function trend(values: (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length >= 2 ? Math.round((known[known.length - 1] - known[0]) * 10) / 10 : null;
}

/** Strongest event (best latest rating, else best latest rank) and most improved (largest rating gain). */
export function highlights(stats: StudentGrowthStats): { strongest: string | null; mostImproved: string | null } {
  const ids = Object.keys(stats.events);
  const latest = (id: string) => { const points = stats.events[id]; return points[points.length - 1]; };
  const score = (id: string) => latest(id).rating ?? (latest(id).rank ? 60 - latest(id).rank! * 5 : -1);
  const strongest = ids.length ? ids.reduce((a, b) => score(b) > score(a) ? b : a) : null;
  const gains = ids.map(id => ({ id, gain: trend(stats.events[id].map(point => point.rating)) })).filter(item => item.gain !== null && item.gain > 0);
  const mostImproved = gains.length ? gains.reduce((a, b) => b.gain! > a.gain! ? b : a).id : null;
  return { strongest, mostImproved };
}
