import { supabase } from './auth';
import type { Division } from './tournament';

/**
 * One speaker in one preliminary round, as the tab sheet shows it (supabase/tabsheet.sql).
 * `submitted` is false while the room's ballot is still out; then rank, rating and present are null.
 * `place` / `field`: the speaker's current place in their contest among speakers with a rank so far.
 */
export type TabRow = {
  entryId: string; student: string; school: string; eventId: string; division: Division;
  round: number; sectionId: string; label: string; room: string; judge: string; order: number;
  rank: number | null; rating: number | null; present: boolean | null; submitted: boolean;
  place: number | null; field: number | null;
};

const fail = (message: string): never => {
  if (/could not find|schema cache|does not exist/i.test(message)) throw new Error('The database needs an update. Run supabase/tabsheet.sql (then supabase/alerts.sql) in the Supabase SQL Editor.');
  throw new Error(message);
};
const db = () => supabase ?? fail('Accounts are not connected.');

type TabRecord = {
  entry_id: string; student: string; school: string; event_id: string; division: string; round: number; section_id: string; section_label: string;
  room: string; judge_name: string; speak_order: number; rank: number | null; rating: number | null; present: boolean | null; submitted: boolean; place: number | null; field: number | null;
};

/**
 * The tab sheet for a tournament. The database decides what comes back: every school for the director
 * and tab-room staff, the caller's own school for any other approved coach, nothing for anyone else.
 */
export async function loadTabSheet(tournamentId: string): Promise<TabRow[]> {
  const { data, error } = await db().rpc('tab_sheet', { target: tournamentId });
  if (error) fail(error.message);
  return ((data ?? []) as TabRecord[]).map(row => ({
    entryId: row.entry_id, student: row.student, school: row.school, eventId: row.event_id, division: row.division === 'novice' ? 'novice' : 'varsity',
    round: row.round, sectionId: row.section_id, label: row.section_label ?? '', room: row.room, judge: row.judge_name ?? '', order: row.speak_order ?? 0,
    rank: row.rank, rating: row.rating, present: row.present, submitted: !!row.submitted, place: row.place ?? null, field: row.field ?? null,
  }));
}

/** Whether the signed-in coach is tab-room staff at this tournament. False until tabsheet.sql has been run. */
export async function amTabStaff(tournamentId: string, userId: string): Promise<boolean> {
  const { data, error } = await db().from('tournament_members').select('tab_staff').eq('tournament_id', tournamentId).eq('user_id', userId).eq('role', 'coach');
  if (error) return false;
  return ((data ?? []) as { tab_staff?: boolean }[]).some(row => row.tab_staff === true);
}

/** The director's list of coaches marked as tab-room staff (user ids). */
export async function listTabStaff(tournamentId: string): Promise<string[]> {
  const { data, error } = await db().from('tournament_members').select('user_id, role, tab_staff').eq('tournament_id', tournamentId).eq('role', 'coach').eq('tab_staff', true);
  if (error) fail(error.message);
  return ((data ?? []) as { user_id: string; tab_staff?: boolean }[]).filter(row => row.tab_staff).map(row => row.user_id);
}

/** The director marks an approved coach as tab-room staff, or takes it away. The database refuses anyone else. */
export async function setTabStaff(tournamentId: string, userId: string, on: boolean): Promise<void> {
  const { data, error } = await db().from('tournament_members').update({ tab_staff: on }).eq('tournament_id', tournamentId).eq('user_id', userId).eq('role', 'coach').select('tab_staff');
  if (error) fail(error.message);
  const rows = (data ?? []) as { tab_staff?: boolean }[];
  if (rows.length === 0 || rows[0].tab_staff !== on) fail('Only the director can change tab-room staff.');
}
