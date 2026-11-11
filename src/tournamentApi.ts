import { supabase } from './auth';
import type { Entry, Judge, Section, Tournament, TournamentStatus } from './tournament';

export type MemberRole = 'coach' | 'student' | 'judge';
export type MemberStatus = 'pending' | 'approved' | 'declined';
export type Member = { tournamentId: string; userId: string; role: MemberRole; school: string; name: string; status: MemberStatus; entriesSent: boolean };
export type TournamentRow = Tournament & { id: string; directorId: string };

const fail = (message: string): never => {
  if (/could not find|schema cache|does not exist/i.test(message)) throw new Error('The database needs an update. Run supabase/tournaments.sql in the Supabase SQL Editor.');
  if (/row-level security/i.test(message)) throw new Error('You don’t have permission to do that. The director may need to approve you first.');
  if (/entries_one_per_event/i.test(message)) throw new Error('That student is already entered in that event.');
  throw new Error(message);
};
const db = () => supabase ?? fail('Accounts are not connected.');

type TournamentRecord = { id: string; director_id: string; name: string; date: string; host: string; rounds: number; section_size: number; max_entries: number; event_ids: string[]; status: TournamentStatus };
const toTournament = (row: TournamentRecord): TournamentRow => ({ id: row.id, directorId: row.director_id, name: row.name, date: row.date, host: row.host, rounds: row.rounds, sectionSize: row.section_size, maxEntries: row.max_entries, eventIds: row.event_ids ?? [], status: row.status });
const tournamentColumns = (patch: Partial<Tournament>) => {
  const out: Record<string, unknown> = {};
  if (patch.name !== undefined) out.name = patch.name;
  if (patch.date !== undefined) out.date = patch.date;
  if (patch.host !== undefined) out.host = patch.host;
  if (patch.rounds !== undefined) out.rounds = patch.rounds;
  if (patch.sectionSize !== undefined) out.section_size = patch.sectionSize;
  if (patch.maxEntries !== undefined) out.max_entries = patch.maxEntries;
  if (patch.eventIds !== undefined) out.event_ids = patch.eventIds;
  if (patch.status !== undefined) out.status = patch.status;
  return out;
};

export async function listTournaments(): Promise<TournamentRow[]> {
  const { data, error } = await db().from('tournaments').select('*').order('created_at', { ascending: false });
  if (error) fail(error.message);
  return (data ?? []).map(toTournament);
}

export async function createTournament(tournament: Tournament): Promise<TournamentRow> {
  const { data, error } = await db().from('tournaments').insert(tournamentColumns({ ...tournament, status: undefined })).select('*').single();
  if (error) fail(error.message);
  return toTournament(data as TournamentRecord);
}

export async function saveTournament(id: string, patch: Partial<Tournament>): Promise<void> {
  const { error } = await db().from('tournaments').update(tournamentColumns(patch)).eq('id', id);
  if (error) fail(error.message);
}

type MemberRecord = { tournament_id: string; user_id: string; role: MemberRole; school: string; display_name: string; status: MemberStatus; entries_sent: boolean };
const toMember = (row: MemberRecord): Member => ({ tournamentId: row.tournament_id, userId: row.user_id, role: row.role, school: row.school, name: row.display_name, status: row.status, entriesSent: row.entries_sent });

/** The signed-in user's own requests, across all tournaments. */
export async function listMyMemberships(userId: string): Promise<Member[]> {
  const { data, error } = await db().from('tournament_members').select('*').eq('user_id', userId);
  if (error) fail(error.message);
  return (data ?? []).map(toMember);
}

/** Everyone who has asked to join. Only the director gets more than their own rows back. */
export async function listMembers(tournamentId: string): Promise<Member[]> {
  const { data, error } = await db().from('tournament_members').select('*').eq('tournament_id', tournamentId);
  if (error) fail(error.message);
  return (data ?? []).map(toMember);
}

export async function requestToJoin(tournamentId: string, role: MemberRole, school: string): Promise<Member> {
  const { data, error } = await db().from('tournament_members').insert({ tournament_id: tournamentId, role, school }).select('*').single();
  if (error) fail(/duplicate key/i.test(error.message) ? 'You have already asked to join this tournament in that role.' : error.message);
  return toMember(data as MemberRecord);
}

export async function decideMember(member: Member, status: MemberStatus): Promise<void> {
  const { error } = await db().from('tournament_members').update({ status }).eq('tournament_id', member.tournamentId).eq('user_id', member.userId).eq('role', member.role);
  if (error) fail(error.message);
}

export async function markEntriesSent(tournamentId: string, userId: string): Promise<void> {
  const { error } = await db().from('tournament_members').update({ entries_sent: true }).eq('tournament_id', tournamentId).eq('user_id', userId).eq('role', 'coach');
  if (error) fail(error.message);
}

type EntryRecord = { id: string; school: string; student: string; event_id: string };
const toEntry = (row: EntryRecord): Entry => ({ id: row.id, school: row.school, student: row.student, eventId: row.event_id });

export async function listEntries(tournamentId: string): Promise<Entry[]> {
  const { data, error } = await db().from('entries').select('id, school, student, event_id').eq('tournament_id', tournamentId).order('created_at');
  if (error) fail(error.message);
  return (data ?? []).map(toEntry);
}

export async function insertEntry(tournamentId: string, student: string, school: string, eventId: string): Promise<Entry> {
  const { data, error } = await db().from('entries').insert({ tournament_id: tournamentId, student, school, event_id: eventId }).select('id, school, student, event_id').single();
  if (error) fail(error.message);
  return toEntry(data as EntryRecord);
}

export async function deleteEntry(id: string): Promise<void> {
  const { error } = await db().from('entries').delete().eq('id', id);
  if (error) fail(error.message);
}

type SectionRecord = { id: string; round: number; event_id: string; label: string; room: string; judge_id: string | null; judge_name: string; entry_ids: string[]; position: number };
const toSection = (row: SectionRecord): Section => ({ id: row.id, round: row.round, eventId: row.event_id, label: row.label, room: row.room, judgeId: row.judge_id, judgeName: row.judge_name, entryIds: row.entry_ids ?? [] });

export async function listSections(tournamentId: string): Promise<Section[]> {
  const { data, error } = await db().from('sections').select('*').eq('tournament_id', tournamentId).order('position');
  if (error) fail(error.message);
  return (data ?? []).map(toSection);
}

/** Replace the whole schedule with a freshly built one. */
export async function replaceSections(tournamentId: string, sections: Section[], judges: Judge[]): Promise<Section[]> {
  const cleared = await db().from('sections').delete().eq('tournament_id', tournamentId);
  if (cleared.error) fail(cleared.error.message);
  if (sections.length === 0) return [];
  const { data, error } = await db().from('sections').insert(sections.map((section, index) => ({
    tournament_id: tournamentId, round: section.round, event_id: section.eventId, label: section.label, room: section.room,
    judge_id: section.judgeId, judge_name: judges.find(judge => judge.id === section.judgeId)?.name ?? '', entry_ids: section.entryIds, position: index,
  }))).select('*');
  if (error) fail(error.message);
  return ((data ?? []) as SectionRecord[]).sort((a, b) => a.position - b.position).map(toSection);
}

export async function saveSectionJudge(sectionId: string, judge: Judge | null): Promise<void> {
  const { error } = await db().from('sections').update({ judge_id: judge?.id ?? null, judge_name: judge?.name ?? '' }).eq('id', sectionId);
  if (error) fail(error.message);
}
