import { supabase } from './auth';
import { setErrorSink } from './errorReporting';
import type { AppError } from './errorLog';
import type { RoomState } from './statusBoard';

const fail = (message: string): never => {
  // The table or function the app expects is missing: the project's database is behind the code.
  if (/could not find|schema cache|does not exist/i.test(message)) throw new Error('The database needs an update. Run supabase/errors.sql (then supabase/alerts.sql) in the Supabase SQL Editor.');
  throw new Error(message);
};
const db = () => supabase ?? fail('Accounts are not connected.');

// Signed-in reports go to public.app_errors. The database stamps who sent it and when, and drops a flood.
if (supabase) {
  const client = supabase;
  setErrorSink(async report => {
    await client.from('app_errors').insert({ tournament_id: report.tournamentId, role: report.role, area: report.area, kind: report.kind, message: report.message });
  });
}

/** The tournament's most recent error reports, newest first. Only its director gets any rows. */
export async function listErrors(tournamentId: string, limit = 25): Promise<AppError[]> {
  const { data, error } = await db().from('app_errors').select('id, tournament_id, role, area, kind, message, created_at')
    .eq('tournament_id', tournamentId).order('created_at', { ascending: false }).limit(limit);
  if (error) fail(error.message);
  return (data ?? []).map(row => ({ id: String(row.id), tournamentId: row.tournament_id as string, role: row.role as string, area: row.area as string, kind: row.kind === 'request' ? 'request' : 'page', message: row.message as string, at: row.created_at as string }));
}

/** Each scheduled room's ballot state, keyed by section id. Rooms missing from the result have no ballot started. */
export async function loadBallotProgress(tournamentId: string): Promise<Record<string, { state: RoomState; savedAt: string | null }>> {
  const { data, error } = await db().rpc('ballot_progress', { target: tournamentId });
  if (error) fail(error.message);
  return Object.fromEntries(((data ?? []) as { section_id: string; status: string; saved_at: string | null }[])
    .map(row => [row.section_id, { state: row.status === 'submitted' ? 'submitted' : 'draft', savedAt: row.saved_at }]));
}
