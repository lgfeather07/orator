import { supabase } from './auth';
import type { PaperEntry } from './paperBallots';

/** Where a room's submitted ballot came from. */
export type BallotSource = { ballotId: string; sectionId: string; source: 'judge' | 'paper'; judgeName: string; enteredBy: string; enteredAt: string | null; submittedAt: string | null };
export type PaperLogRow = { id: string; sectionId: string | null; action: 'entered' | 'corrected' | 'override' | 'replaced-draft'; actor: string; note: string; at: string; previous: Partial<PaperEntry>[] | null; entries: PaperEntry[] };

const fail = (message: string): never => {
  // The function or a column the app expects is missing: the project's database is behind the code.
  if (/could not find|schema cache|does not exist/i.test(message)) throw new Error('The database needs an update. Run supabase/paper_ballots.sql in the Supabase SQL Editor.');
  throw new Error(message);
};
const db = () => supabase ?? fail('Accounts are not connected.');

/** Every submitted ballot for the tournament's rooms, with where it came from. The director can read them all. */
export async function listBallotSources(tournamentId: string): Promise<BallotSource[]> {
  const withSource = await db().from('ballots').select('id, section_id, source, judge_name, entered_by_name, entered_at, submitted_at').eq('tournament_id', tournamentId).eq('status', 'submitted');
  // Before supabase/paper_ballots.sql has been run there is no source column: every ballot is an e-ballot.
  const { data, error } = withSource.error && /source|entered_|does not exist|schema cache/i.test(withSource.error.message)
    ? await db().from('ballots').select('id, section_id, judge_name, submitted_at').eq('tournament_id', tournamentId).eq('status', 'submitted')
    : withSource;
  if (error) fail(error.message);
  return ((data ?? []) as Record<string, unknown>[]).filter(row => row.section_id).map(row => ({
    ballotId: row.id as string, sectionId: row.section_id as string, source: row.source === 'paper' ? 'paper' : 'judge', judgeName: (row.judge_name as string) ?? '',
    enteredBy: (row.entered_by_name as string) ?? '', enteredAt: (row.entered_at as string | null) ?? null, submittedAt: (row.submitted_at as string | null) ?? null,
  }));
}

/** One submitted ballot's ranks, points and times, to correct a paper ballot or replace an e-ballot. */
export async function loadBallotLines(ballotId: string): Promise<PaperEntry[]> {
  const { data, error } = await db().from('ballot_entries').select('speaker_code, present, rank, rating, time_seconds, time_penalty, section_marks').eq('ballot_id', ballotId);
  if (error) fail(error.message);
  return (data ?? []).map(row => ({ code: row.speaker_code as string, present: row.present !== false, rank: row.rank as number | null, rating: row.rating as number | null, time_seconds: row.time_seconds as number | null, time_penalty: !!row.time_penalty, marks: (row.section_marks ?? []) as number[] }));
}

/** Paper entries, corrections and overrides for the tournament, newest first. Empty before paper_ballots.sql. */
export async function listPaperLog(tournamentId: string): Promise<PaperLogRow[]> {
  const { data, error } = await db().from('paper_ballot_log').select('id, section_id, action, actor_name, note, created_at, previous, entries').eq('tournament_id', tournamentId).order('created_at', { ascending: false });
  if (error) return [];
  return (data ?? []).map(row => ({ id: String(row.id), sectionId: row.section_id as string | null, action: row.action, actor: row.actor_name as string, note: row.note as string, at: row.created_at as string, previous: row.previous as Partial<PaperEntry>[] | null, entries: (row.entries ?? []) as PaperEntry[] }));
}

/**
 * Save a room's paper ballot as the director. The database checks the caller directs the tournament,
 * checks the ballot again, and logs it. `override` replaces an e-ballot the judge already submitted.
 */
export async function enterPaperBallot(sectionId: string, entries: PaperEntry[], override: boolean, note: string): Promise<string> {
  const { data, error } = await db().rpc('enter_paper_ballot', { target_section: sectionId, entries, override, note });
  if (error) fail(error.message);
  return data as string;
}
