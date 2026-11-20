/**
 * Recorded drops in the database (supabase/drops.sql). Rows are written only by the database: an AFTER DELETE
 * trigger on entries and coach_judges records a coach's drop once the drop deadline has passed. The director
 * reads every school's drops and waives or restores them; a coach reads only their own school's.
 */
import { supabase } from './auth';
import type { Division, DropKind, EntryDrop } from './tournament';

const fail = (message: string): never => {
  if (/could not find|schema cache|does not exist/i.test(message)) throw new Error('The database needs an update. Run supabase/drops.sql in the Supabase SQL Editor.');
  if (/row-level security|permission denied/i.test(message)) throw new Error('Only the tournament director can waive a drop fee.');
  throw new Error(message);
};
const db = () => supabase ?? fail('Accounts are not connected.');

const columns = 'id, school, kind, name, event_id, division, dropped_at, dropped_by_name, fee, entry_fee, waived, waive_reason';
type DropRecord = { id: string; school: string; kind: DropKind; name: string; event_id: string | null; division: Division | null; dropped_at: string; dropped_by_name: string | null; fee: number | string; entry_fee: number | string | null; waived: boolean; waive_reason: string | null };
const toDrop = (row: DropRecord): EntryDrop => ({
  id: row.id, school: row.school, kind: row.kind, name: row.name, eventId: row.event_id, division: row.division, droppedAt: row.dropped_at,
  droppedBy: row.dropped_by_name || 'Coach', fee: Number(row.fee) || 0, entryFee: Number(row.entry_fee ?? 0) || 0, waived: row.waived, waiveReason: row.waive_reason ?? '',
});

/** Drops the signed-in user may see: every school's for the director, their own school's for a coach. Empty before drops.sql is run. */
export async function listDrops(tournamentId: string): Promise<EntryDrop[]> {
  const { data, error } = await db().from('entry_drops').select(columns).eq('tournament_id', tournamentId).order('dropped_at');
  if (error) { if (/could not find|schema cache|does not exist/i.test(error.message)) return []; fail(error.message); }
  return ((data ?? []) as DropRecord[]).map(toDrop);
}

/** The director waives a drop fee (with a reason) or restores it. */
export async function setDropWaived(id: string, waived: boolean, reason: string): Promise<void> {
  const { data, error } = await db().from('entry_drops').update({ waived, waive_reason: waived ? reason.trim().slice(0, 200) : '' }).eq('id', id).select('id');
  if (error) fail(error.message);
  if (!data || data.length === 0) fail('Only the tournament director can waive a drop fee.');
}
