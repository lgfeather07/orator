import { supabase } from './auth';
import { cleanNote, type AccessRequest } from './accessibility';

const fail = (message: string): never => {
  if (/could not find|schema cache|does not exist/i.test(message)) throw new Error('The database needs an update. Run supabase/accessibility.sql in the Supabase SQL Editor.');
  if (/row-level security|insufficient_privilege|permission/i.test(message)) throw new Error('You can’t change that accessibility request. Coaches change their own students’ while entries are open; the director can change any.');
  throw new Error(message);
};
const db = () => supabase ?? fail('Accounts are not connected.');

/**
 * The accessibility requests this account may read (supabase/accessibility.sql): the director sees every school's,
 * a coach their own school's, a student their own. Everyone else gets none. Empty before the script has been run.
 */
export async function listAccessRequests(tournamentId: string): Promise<AccessRequest[]> {
  const { data, error } = await db().from('access_requests').select('school, student, note').eq('tournament_id', tournamentId);
  if (error) { if (/could not find|schema cache|does not exist/i.test(error.message)) return []; fail(error.message); }
  return ((data ?? []) as AccessRequest[]).map(row => ({ school: row.school, student: row.student, note: row.note ?? '' }));
}

/** Add, change (`needed`) or remove one student's request. The database checks who may. */
export async function saveAccessRequest(tournamentId: string, school: string, student: string, needed: boolean, note: string): Promise<void> {
  const { error } = await db().rpc('set_access_request', { target: tournamentId, target_school: school, target_student: student, needed, note: cleanNote(note) });
  if (error) fail(error.message);
}
