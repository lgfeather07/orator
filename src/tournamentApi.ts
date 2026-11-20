import { supabase } from './auth';
import type { Division, Entry, Fees, Issue, IssueKind, Judge, JudgePrefs, PracticeGoal, ScheduleChange, Section, Tournament, TournamentStatus, UpdateKind } from './tournament';

export type MemberRole = 'coach' | 'student' | 'judge';
export type MemberStatus = 'pending' | 'approved' | 'declined';
export type Member = { tournamentId: string; userId: string; role: MemberRole; school: string; name: string; status: MemberStatus; entriesSent: boolean; resultsReleased: boolean; preferences: JudgePrefs; clean: boolean; knows: string[]; checkedIn: boolean; rosterName: string; coachJudgeId?: string | null };
export type TournamentRow = Tournament & { id: string; directorId: string };

const fail = (message: string): never => {
  if (/could not find|schema cache|does not exist/i.test(message)) throw new Error('The database needs an update. Run supabase/tournaments.sql, then supabase/calendar.sql, in the Supabase SQL Editor.');
  if (/row-level security/i.test(message)) throw new Error('You don’t have permission to do that. The director may need to approve you first.');
  if (/entries_one_per_event/i.test(message)) throw new Error('That student is already entered in that event.');
  throw new Error(message);
};
const db = () => supabase ?? fail('Accounts are not connected.');

type TournamentRecord = { id: string; director_id: string; name: string; date: string; host: string; rounds: number; section_size: number; max_entries: number; event_ids: string[]; status: TournamentStatus; entries_open?: boolean; show_rating?: boolean; settings?: Record<string, unknown> } & CalendarRecord;
/**
 * Director settings that don't need their own column: fees, judges per final, the team-point scale, and so on.
 * They are saved together in the tournament's `settings` (see supabase/fixes.sql). Fees are also kept in their own column for the public calendar..
 */
const SETTING_KEYS = ['fees', 'finalJudges', 'teamPoints', 'noviceTeamPoints', 'finalists', 'finalistsByContest', 'rooms', 'semisByContest', 'format', 'placesAwarded', 'sectionMarks', 'schoolEntryCap', 'eventEntryCap'] as const;
type Settings = Pick<Tournament, (typeof SETTING_KEYS)[number]>;
const settingsOf = (tournament: Partial<Tournament>): Settings => Object.fromEntries(SETTING_KEYS.filter(key => tournament[key] !== undefined).map(key => [key, tournament[key]])) as Settings;
export const touchesSettings = (patch: Partial<Tournament>) => SETTING_KEYS.some(key => key in patch);
const toTournament = (row: TournamentRecord): TournamentRow => ({ ...settingsOf((row.settings ?? {}) as Partial<Tournament>), id: row.id, directorId: row.director_id, name: row.name, date: row.date, host: row.host, rounds: row.rounds, sectionSize: row.section_size, maxEntries: row.max_entries, eventIds: row.event_ids ?? [], status: row.status, entriesOpen: row.entries_open ?? true, showRating: row.show_rating ?? false, ...calendarFields(row) });
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
  if (patch.entriesOpen !== undefined) out.entries_open = patch.entriesOpen;
  if (patch.showRating !== undefined) out.show_rating = patch.showRating;
  Object.assign(out, calendarColumns(patch));
  return out;
};

// ── Public calendar columns (supabase/calendar.sql). Rows from before that script have none of them.
type CalendarRecord = { listed?: boolean; city?: string; start_date?: string | null; registration_deadline?: string | null; notes?: string; auto_approve_coaches?: boolean; fees?: Fees | null };
const calendarFields = (row: CalendarRecord): Partial<Tournament> => ({
  listed: row.listed ?? false, city: row.city ?? '', startDate: row.start_date ?? undefined, registrationDeadline: row.registration_deadline ?? undefined,
  notes: row.notes ?? '', autoApproveCoaches: row.auto_approve_coaches ?? false, ...(row.fees ? { fees: row.fees } : {}),
});
const calendarColumns = (patch: Partial<Tournament>) => {
  const out: Record<string, unknown> = {};
  if (patch.listed !== undefined) out.listed = patch.listed;
  if (patch.city !== undefined) out.city = patch.city.slice(0, 80);
  if (patch.startDate !== undefined) out.start_date = patch.startDate || null;
  if (patch.registrationDeadline !== undefined) out.registration_deadline = patch.registrationDeadline || null;
  if (patch.notes !== undefined) out.notes = patch.notes.slice(0, 600);
  if (patch.autoApproveCoaches !== undefined) out.auto_approve_coaches = patch.autoApproveCoaches;
  if (patch.fees !== undefined) out.fees = patch.fees;
  return out;
};

/** A tournament as the public calendar shows it: listed ones only, safe columns only. */
export type PublicTournament = {
  id: string; name: string; date: string; startDate?: string; host: string; city: string; registrationDeadline?: string; notes: string;
  eventIds: string[]; maxEntries: number; rounds: number; status: TournamentStatus; entriesOpen: boolean; autoApproveCoaches: boolean;
  entryFee?: number; judgeFee?: number; schoolFee?: number; schoolsRegistered: number;
};
type PublicRecord = { id: string; name: string; date: string; start_date: string | null; host: string; city: string; registration_deadline: string | null; notes: string; event_ids: string[] | null; max_entries: number; rounds: number; status: TournamentStatus; entries_open: boolean; auto_approve_coaches: boolean; entry_fee: number | string | null; judge_fee: number | string | null; school_fee: number | string | null; schools_registered: number };
const amount = (value: number | string | null) => value === null || value === undefined || value === '' ? undefined : Number(value);
const toPublic = (row: PublicRecord): PublicTournament => ({
  id: row.id, name: row.name, date: row.date ?? '', startDate: row.start_date ?? undefined, host: row.host ?? '', city: row.city ?? '', registrationDeadline: row.registration_deadline ?? undefined, notes: row.notes ?? '',
  eventIds: row.event_ids ?? [], maxEntries: row.max_entries, rounds: row.rounds, status: row.status, entriesOpen: row.entries_open ?? true, autoApproveCoaches: row.auto_approve_coaches ?? false,
  entryFee: amount(row.entry_fee), judgeFee: amount(row.judge_fee), schoolFee: amount(row.school_fee), schoolsRegistered: row.schools_registered ?? 0,
});

/** Listed tournaments for the public calendar. Works without signing in. */
export async function listPublicTournaments(): Promise<PublicTournament[]> {
  const { data, error } = await db().rpc('list_public_tournaments');
  if (error) {
    if (/could not find|schema cache|does not exist/i.test(error.message)) throw new Error('The calendar isn’t set up yet. Run supabase/calendar.sql in the Supabase SQL Editor.');
    fail(error.message);
  }
  return ((data ?? []) as PublicRecord[]).map(toPublic);
}

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

/** Save a change. `whole` is the tournament after the change, so settings are saved as one complete set. */
export async function saveTournament(id: string, patch: Partial<Tournament>, whole?: Partial<Tournament>): Promise<void> {
  const columns = tournamentColumns(patch);
  if (touchesSettings(patch)) columns.settings = settingsOf(whole ?? patch);
  const { error } = await db().from('tournaments').update(columns).eq('id', id);
  if (error) fail(error.message);
}

type MemberRecord = { tournament_id: string; user_id: string; role: MemberRole; school: string; display_name: string; status: MemberStatus; entries_sent: boolean; results_released?: boolean; event_preferences?: JudgePrefs; clean_judge?: boolean; known_schools?: string[]; checked_in?: boolean; roster_name?: string; coach_judge_id?: string | null };
const toMember = (row: MemberRecord): Member => ({ tournamentId: row.tournament_id, userId: row.user_id, role: row.role, school: row.school, name: row.display_name, status: row.status, entriesSent: row.entries_sent, resultsReleased: row.results_released ?? false, preferences: Array.isArray(row.event_preferences) ? row.event_preferences : [] , clean: row.clean_judge ?? false, knows: row.known_schools ?? [], checkedIn: row.checked_in ?? false, rosterName: row.roster_name ?? '', coachJudgeId: row.coach_judge_id ?? null });

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

/** A judge saves which events they would most like to judge in finals. */
export async function saveJudgePreferences(tournamentId: string, userId: string, preferences: JudgePrefs): Promise<void> {
  const { error } = await db().from('tournament_members').update({ event_preferences: preferences }).eq('tournament_id', tournamentId).eq('user_id', userId).eq('role', 'judge');
  if (error) fail(error.message);
}

/** A judge says they know none of the competitors, or names the other schools they know. */
export async function saveJudgeConflicts(tournamentId: string, userId: string, profile: { clean: boolean; knows: string[] }): Promise<void> {
  const { error } = await db().from('tournament_members').update({ clean_judge: profile.clean, known_schools: profile.clean ? [] : profile.knows }).eq('tournament_id', tournamentId).eq('user_id', userId).eq('role', 'judge');
  if (error) fail(error.message);
}

/** A coach releases this tournament's results to their students. The database refuses until the tournament has ended. */
export async function releaseResultsToStudents(tournamentId: string, userId: string): Promise<void> {
  const { data, error } = await db().from('tournament_members').update({ results_released: true }).eq('tournament_id', tournamentId).eq('user_id', userId).eq('role', 'coach').select('results_released');
  if (error) fail(error.message);
  if (!data || data.length === 0) fail('Only an approved coach can release results.');
}

export async function markEntriesSent(tournamentId: string, userId: string): Promise<void> {
  const { error } = await db().from('tournament_members').update({ entries_sent: true }).eq('tournament_id', tournamentId).eq('user_id', userId).eq('role', 'coach');
  if (error) fail(error.message);
}

type EntryRecord = { id: string; school: string; student: string; event_id: string; division?: Division; waitlisted?: boolean };
const toEntry = (row: EntryRecord): Entry => ({ id: row.id, school: row.school, student: row.student, eventId: row.event_id, division: row.division ?? 'varsity', waitlisted: row.waitlisted ?? false });
// All columns, so entries still load on a database that hasn't run waitlist.sql yet.
const entryColumns = '*';

export async function listEntries(tournamentId: string): Promise<Entry[]> {
  const { data, error } = await db().from('entries').select(entryColumns).eq('tournament_id', tournamentId).order('created_at');
  if (error) fail(error.message);
  return (data ?? []).map(toEntry);
}

export async function insertEntry(tournamentId: string, student: string, school: string, eventId: string, division: Division): Promise<Entry> {
  const { data, error } = await db().from('entries').insert({ tournament_id: tournamentId, student, school, event_id: eventId, division }).select(entryColumns).single();
  if (error) fail(error.message);
  return toEntry(data as EntryRecord);
}

export async function deleteEntry(id: string): Promise<void> {
  const { error } = await db().from('entries').delete().eq('id', id);
  if (error) fail(error.message);
}

type SectionRecord = { id: string; round: number; event_id: string; division?: Division; label: string; room: string; judge_id: string | null; judge_name: string; entry_ids: string[]; position: number; coach_judge_id?: string | null; stage?: Section['stage'] | null };
// A coach-entered judge nobody has signed in as yet is assigned by seat (supabase/judges.sql): `cj:<seat>`.
const toSection = (row: SectionRecord): Section => ({ id: row.id, round: row.round, eventId: row.event_id, division: row.division ?? 'varsity', label: row.label, room: row.room, judgeId: row.judge_id ?? (row.coach_judge_id ? `cj:${row.coach_judge_id}` : null), judgeName: row.judge_name, entryIds: row.entry_ids ?? [], ...(row.stage ? { stage: row.stage } : {}) });

/** The judge columns for a room. Only seat assignments send coach_judge_id, so projects without judges.sql keep working. */
const judgeColumns = (judgeId: string | null, wasSeat = false): Record<string, string | null> => judgeId?.startsWith('cj:') ? { judge_id: null, coach_judge_id: judgeId.slice(3) } : wasSeat ? { judge_id: judgeId, coach_judge_id: null } : { judge_id: judgeId };

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
    tournament_id: tournamentId, round: section.round, event_id: section.eventId, division: section.division ?? 'varsity', label: section.label, room: section.room,
    ...judgeColumns(section.judgeId), judge_name: judges.find(judge => judge.id === section.judgeId)?.name ?? '', entry_ids: section.entryIds, position: index,
  }))).select('*');
  if (error) fail(error.message);
  return ((data ?? []) as SectionRecord[]).sort((a, b) => a.position - b.position).map(toSection);
}

/** Add sections (used for semifinal and final rounds) without touching the rest of the schedule. */
export async function addSections(tournamentId: string, sections: Section[], startAt: number): Promise<Section[]> {
  const { data, error } = await db().from('sections').insert(sections.map((section, index) => ({
    tournament_id: tournamentId, round: section.round, event_id: section.eventId, division: section.division ?? 'varsity', label: section.label, room: section.room,
    ...judgeColumns(section.judgeId), judge_name: section.judgeName ?? '', entry_ids: section.entryIds, position: startAt + index,
    // Only semifinals store a stage (supabase/semifinals.sql), so finals still save on a database without that column.
    ...(section.stage ? { stage: section.stage } : {}),
  }))).select('*');
  if (error) fail(error.message);
  return ((data ?? []) as SectionRecord[]).sort((a, b) => a.position - b.position).map(toSection);
}

export async function saveSectionRoom(sectionId: string, room: string): Promise<void> {
  const { error } = await db().from('sections').update({ room }).eq('id', sectionId);
  if (error) fail(error.message);
}

/** `wasSeat`: the room was with a coach-entered judge (supabase/judges.sql), so the seat is cleared too. */
export async function saveSectionJudge(sectionId: string, judge: Judge | null, wasSeat = false): Promise<void> {
  const { error } = await db().from('sections').update({ ...judgeColumns(judge?.id ?? null, wasSeat), judge_name: judge?.name ?? '' }).eq('id', sectionId);
  if (error) fail(error.message);
}

type UpdateRecord = { id: string; kind: UpdateKind; message: string; created_at: string };
const toUpdate = (row: UpdateRecord): ScheduleChange => ({ id: row.id, kind: row.kind, text: row.message, time: new Date(row.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) });

/** The director's notes to everyone in the tournament, newest first. */
export async function listUpdates(tournamentId: string): Promise<ScheduleChange[]> {
  const { data, error } = await db().from('tournament_updates').select('id, kind, message, created_at').eq('tournament_id', tournamentId).order('created_at', { ascending: false }).limit(30);
  if (error) fail(error.message);
  return ((data ?? []) as UpdateRecord[]).map(toUpdate);
}

export async function addUpdate(tournamentId: string, kind: UpdateKind, message: string): Promise<void> {
  const { error } = await db().from('tournament_updates').insert({ tournament_id: tournamentId, kind, message: message.slice(0, 300) });
  if (error) fail(error.message);
}

type IssueRecord = { id: string; kind: IssueKind; location: string; detail: string; reporter_name: string; reporter_role: string; status: 'open' | 'resolved'; created_at: string };
const toIssue = (row: IssueRecord): Issue => ({ id: row.id, kind: row.kind, where: row.location, detail: row.detail, reporter: row.reporter_name || 'Someone', role: row.reporter_role, status: row.status, time: new Date(row.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) });

/** Issues reported at a tournament: all of them for the director, your own for everyone else. */
export async function listIssues(tournamentId: string): Promise<Issue[]> {
  const { data, error } = await db().from('issues').select('*').eq('tournament_id', tournamentId).order('created_at', { ascending: false });
  if (error) fail(error.message);
  return ((data ?? []) as IssueRecord[]).map(toIssue);
}

export async function reportIssue(tournamentId: string, issue: { kind: IssueKind; where: string; detail: string; role: string }): Promise<Issue> {
  const { data, error } = await db().from('issues').insert({ tournament_id: tournamentId, kind: issue.kind, location: issue.where, detail: issue.detail, reporter_role: issue.role }).select('*').single();
  if (error) fail(error.message);
  return toIssue(data as IssueRecord);
}

export async function resolveIssue(id: string): Promise<void> {
  const { error } = await db().from('issues').update({ status: 'resolved' }).eq('id', id);
  if (error) fail(error.message);
}

/** The director marks a judge as arrived (or not). */
export async function setJudgeCheckedIn(tournamentId: string, userId: string, checkedIn: boolean): Promise<void> {
  const { error } = await db().from('tournament_members').update({ checked_in: checkedIn }).eq('tournament_id', tournamentId).eq('user_id', userId).eq('role', 'judge');
  if (error) fail(error.message);
}

type GoalRecord = { id: string; school: string; student: string; event_id: string; goal: string; done: boolean; created_at: string };
const toGoal = (row: GoalRecord): PracticeGoal => ({ id: row.id, school: row.school, student: row.student, eventId: row.event_id, text: row.goal, done: row.done, created: new Date(row.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) });

/** Practice goals the signed-in user can see: their team's (coach) or their own (student). */
export async function listGoals(): Promise<PracticeGoal[]> {
  const { data, error } = await db().from('practice_goals').select('*').order('created_at', { ascending: false });
  if (error) fail(error.message);
  return ((data ?? []) as GoalRecord[]).map(toGoal);
}

export async function addGoal(goal: { school: string; student: string; eventId: string; text: string }): Promise<PracticeGoal> {
  const { data, error } = await db().from('practice_goals').insert({ school: goal.school, student: goal.student, event_id: goal.eventId, goal: goal.text }).select('*').single();
  if (error) fail(error.message);
  return toGoal(data as GoalRecord);
}

export async function setGoalDone(id: string, done: boolean): Promise<void> {
  const { error } = await db().from('practice_goals').update({ done }).eq('id', id);
  if (error) fail(error.message);
}

export async function removeGoal(id: string): Promise<void> {
  const { error } = await db().from('practice_goals').delete().eq('id', id);
  if (error) fail(error.message);
}

/** Student accounts approved at the signed-in coach's school, with the roster name each is linked to. */
export async function listSchoolStudents(tournamentId: string): Promise<{ userId: string; name: string; rosterName: string }[]> {
  const { data, error } = await db().rpc('school_students', { target: tournamentId });
  if (error) fail(error.message);
  return ((data ?? []) as { user_id: string; display_name: string; roster_name: string }[]).map(row => ({ userId: row.user_id, name: row.display_name, rosterName: row.roster_name }));
}

/** A coach links a student account to the name on their entries ('' to unlink). */
export async function linkStudent(tournamentId: string, userId: string, rosterName: string): Promise<void> {
  const { error } = await db().rpc('link_student', { target: tournamentId, student: userId, name: rosterName });
  if (error) fail(error.message);
}

/** Change who speaks in a room, e.g. moving a "next in" speaker into a final. Order is the speaking order. */
export async function saveSectionEntries(sectionId: string, entryIds: string[]): Promise<void> {
  const { error } = await db().from('sections').update({ entry_ids: entryIds }).eq('id', sectionId);
  if (error) fail(error.message);
}

/** The director admits a waitlisted entry (or moves one back to the waitlist). */
export async function setEntryWaitlisted(id: string, waitlisted: boolean): Promise<void> {
  const { error } = await db().from('entries').update({ waitlisted }).eq('id', id);
  if (error) fail(error.message);
}
