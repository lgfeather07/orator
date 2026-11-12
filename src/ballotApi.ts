import { supabase } from './auth';

/** Which ballot this is. A judge has one per tournament, round, and room. */
export type BallotKey = { tournament: string; round: number; room: string };

export type EntryInput = {
  code: string; name: string; school: string;
  present: boolean | null; rank: number | null; rating: number | null; timeSeconds: number | null;
  timePenalty: boolean; marks: number[]; comments: string; reason: string; disqualifications: string[]; note: string;
};

export type SavedBallot = {
  id: string; eventId: string; classA: boolean; status: 'draft' | 'submitted';
  entries: EntryInput[];
};

const fail = (message: string): never => {
  // A column the app expects is missing: the project's database is behind the code.
  if (/could not find|schema cache|does not exist/i.test(message)) throw new Error('The database needs an update. Run supabase/ballots.sql again in the Supabase SQL Editor.');
  throw new Error(message);
};

/** The signed-in judge's saved ballot for this round, or null if they have not started one. */
export async function loadBallot(key: BallotKey): Promise<SavedBallot | null> {
  const db = supabase ?? fail('Accounts are not connected.');
  const { data: ballot, error } = await db.from('ballots').select('id, event_id, class_a, status')
    .eq('tournament', key.tournament).eq('round', key.round).eq('room', key.room).order('created_at').limit(1).maybeSingle();
  if (error) fail(error.message);
  if (!ballot) return null;
  const [entries, notes] = await Promise.all([
    db.from('ballot_entries').select('speaker_code, speaker_name, school, present, rank, rating, time_seconds, time_penalty, section_marks, comments, reason, disqualifications').eq('ballot_id', ballot.id),
    db.from('ballot_private_notes').select('speaker_code, note').eq('ballot_id', ballot.id),
  ]);
  if (entries.error) fail(entries.error.message);
  if (notes.error) fail(notes.error.message);
  const noteFor = new Map((notes.data ?? []).map(row => [row.speaker_code, row.note]));
  return {
    id: ballot.id, eventId: ballot.event_id, classA: ballot.class_a, status: ballot.status,
    entries: (entries.data ?? []).map(row => ({
      code: row.speaker_code, name: row.speaker_name, school: row.school, present: row.present, rank: row.rank, rating: row.rating,
      timeSeconds: row.time_seconds, timePenalty: row.time_penalty, marks: row.section_marks ?? [], comments: row.comments ?? '', reason: row.reason,
      disqualifications: row.disqualifications ?? [], note: noteFor.get(row.speaker_code) ?? '',
    })),
  };
}

/**
 * Save the ballot as a draft and, if `submit` is set, submit it. The database checks the ballot
 * again on submission and locks it afterwards. Returns the ballot's id.
 */
export async function saveBallot(key: BallotKey, id: string | null, eventId: string, classA: boolean, entries: EntryInput[], submit: boolean, link?: { tournamentId: string; sectionId: string }): Promise<string> {
  const db = supabase ?? fail('Accounts are not connected.');
  let ballotId = id;
  if (ballotId) {
    const { error } = await db.from('ballots').update({ event_id: eventId, class_a: classA }).eq('id', ballotId);
    if (error) fail(error.message);
  } else {
    const { data, error } = await db.from('ballots').insert({ ...key, event_id: eventId, class_a: classA, ...(link ? { tournament_id: link.tournamentId, section_id: link.sectionId } : {}) }).select('id').single();
    if (error) fail(/row-level security/i.test(error.message) ? 'Only accounts with the Judge role can save a ballot.' : error.message);
    ballotId = data!.id as string;
  }
  const saved = await db.from('ballot_entries').upsert(entries.map(entry => ({
    ballot_id: ballotId, speaker_code: entry.code, speaker_name: entry.name, school: entry.school, present: entry.present, rank: entry.rank,
    rating: entry.rating, time_seconds: entry.timeSeconds, time_penalty: entry.timePenalty, section_marks: entry.marks, comments: entry.comments, reason: entry.reason,
    disqualifications: entry.disqualifications,
  })), { onConflict: 'ballot_id,speaker_code' });
  if (saved.error) fail(saved.error.message);
  const notes = await db.from('ballot_private_notes').upsert(entries.map(entry => ({ ballot_id: ballotId, speaker_code: entry.code, note: entry.note })), { onConflict: 'ballot_id,speaker_code' });
  if (notes.error) fail(notes.error.message);
  if (submit) {
    const { data, error } = await db.from('ballots').update({ status: 'submitted' }).eq('id', ballotId).select('status');
    if (error) fail(error.message);
    if (!data || data.length === 0) fail('This ballot could not be submitted. It may already be locked.');
  }
  return ballotId!;
}

export type TeamBallotRow = {
  key: string; speaker: string; school: string; rank: number | null; rating: number | null; timeSeconds: number | null; timePenalty: boolean;
  marks: number[]; comments: string; reason: string; disqualifications: string[]; present: boolean | null;
  judge: string; tournament: string; round: number; eventId: string; submittedAt: string | null;
};

/** Submitted ballot entries for speakers from the given school, newest first. */
export async function loadTeamBallots(school: string): Promise<TeamBallotRow[]> {
  const db = supabase ?? fail('Accounts are not connected.');
  const { data, error } = await db.from('ballot_entries')
    .select('ballot_id, speaker_code, speaker_name, school, present, rank, rating, time_seconds, time_penalty, section_marks, comments, reason, disqualifications, ballots!inner(judge_name, tournament, round, event_id, status, submitted_at)')
    .eq('ballots.status', 'submitted').ilike('school', school.replace(/[%_\\]/g, '\\$&'));
  if (error) fail(error.message);
  type Parent = { judge_name: string; tournament: string; round: number; event_id: string; submitted_at: string | null };
  return (data ?? []).map(row => {
    const parent = (Array.isArray(row.ballots) ? row.ballots[0] : row.ballots) as Parent;
    return {
      key: `${row.ballot_id}-${row.speaker_code}`, speaker: row.speaker_name, school: row.school, rank: row.rank, rating: row.rating,
      timeSeconds: row.time_seconds, timePenalty: row.time_penalty, marks: row.section_marks ?? [], comments: row.comments ?? '', reason: row.reason,
      disqualifications: row.disqualifications ?? [], present: row.present,
      judge: parent.judge_name, tournament: parent.tournament, round: parent.round, eventId: parent.event_id, submittedAt: parent.submitted_at,
    };
  }).sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''));
}

/** Status of each ballot the signed-in judge has started, keyed "round|room". */
export async function listMyBallotStatus(tournament: string): Promise<Record<string, 'draft' | 'submitted'>> {
  const db = supabase ?? fail('Accounts are not connected.');
  const { data, error } = await db.from('ballots').select('round, room, status').eq('tournament', tournament);
  if (error) fail(error.message);
  return Object.fromEntries((data ?? []).map(row => [`${row.round}|${row.room}`, row.status]));
}

/** Ranks and ratings from submitted ballots for a tournament's rooms. Only its director can read them all. */
export async function listTournamentResults(tournamentId: string): Promise<{ entryId: string; round: number; sectionId: string; rank: number; rating: number }[]> {
  const db = supabase ?? fail('Accounts are not connected.');
  const { data: ballots, error } = await db.from('ballots').select('id, round, section_id').eq('tournament_id', tournamentId).eq('status', 'submitted');
  if (error) fail(error.message);
  const rows = await Promise.all((ballots ?? []).filter(ballot => ballot.section_id).map(async ballot => {
    const { data, error: entryError } = await db.from('ballot_entries').select('speaker_code, rank, rating, present').eq('ballot_id', ballot.id);
    if (entryError) fail(entryError.message);
    return (data ?? []).filter(entry => entry.present && entry.rank && entry.rating).map(entry => ({ entryId: entry.speaker_code as string, round: ballot.round as number, sectionId: ballot.section_id as string, rank: entry.rank as number, rating: entry.rating as number }));
  }));
  return rows.flat();
}
