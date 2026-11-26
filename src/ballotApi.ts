import { supabase } from './auth';
import type { GrowthBallot } from './growthStats';

/** Which ballot this is. A judge has one per tournament, round, and room. */
export type BallotKey = { tournament: string; round: number; room: string };

export type EntryInput = {
  code: string; name: string; school: string;
  present: boolean | null; rank: number | null; rating: number | null; timeSeconds: number | null;
  timePenalty: boolean; marks: number[]; comments: string; reason: string; disqualifications: string[]; note: string;
  /** The speech's title or thesis, as the speaker gave it or the judge wrote it down. */
  title?: string;
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
    db.from('ballot_entries').select('speaker_code, speaker_name, school, present, rank, rating, time_seconds, time_penalty, section_marks, comments, reason, disqualifications, speech_title').eq('ballot_id', ballot.id),
    db.from('ballot_private_notes').select('speaker_code, note').eq('ballot_id', ballot.id),
  ]);
  if (entries.error) fail(entries.error.message);
  if (notes.error) fail(notes.error.message);
  const noteFor = new Map((notes.data ?? []).map(row => [row.speaker_code, row.note]));
  return {
    id: ballot.id, eventId: ballot.event_id, classA: ballot.class_a, status: ballot.status,
    entries: (entries.data ?? []).map(row => ({
      code: row.speaker_code, name: row.speaker_name, school: row.school, present: row.present, rank: row.rank, rating: row.rating,
      timeSeconds: row.time_seconds, timePenalty: row.time_penalty, marks: row.section_marks ?? [], comments: row.comments ?? '', reason: row.reason, title: row.speech_title ?? '',
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
    disqualifications: entry.disqualifications, speech_title: entry.title ?? '',
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

/**
 * Submitted ballot entries for speakers from the given school at one tournament, newest first. Free for the
 * tournament's approved coaches (the database returns only tournaments the coach is approved for).
 */
export async function loadTeamBallots(school: string, tournamentId: string): Promise<TeamBallotRow[]> {
  const db = supabase ?? fail('Accounts are not connected.');
  const { data, error } = await db.from('ballot_entries')
    .select('ballot_id, speaker_code, speaker_name, school, present, rank, rating, time_seconds, time_penalty, section_marks, comments, reason, disqualifications, ballots!inner(judge_name, tournament, tournament_id, round, event_id, status, submitted_at)')
    .eq('ballots.status', 'submitted').eq('ballots.tournament_id', tournamentId).ilike('school', school.replace(/[%_\\]/g, '\\$&'));
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

/** The database refused the season sweep because the school has no coach plan running. */
export class PlanRequiredError extends Error {
  constructor(message = 'Season-long ballots are part of the coach plan.') { super(message); this.name = 'PlanRequiredError'; }
}

/**
 * One school's submitted ballot entries from every tournament, with only what growth needs (supabase/plan_lock.sql).
 * Coach plan only: throws PlanRequiredError when the school has no plan running. Coaches get the whole team;
 * students get their own released entries.
 */
export async function loadSeasonBallots(school: string): Promise<GrowthBallot[]> {
  const db = supabase ?? fail('Accounts are not connected.');
  const { data, error } = await db.rpc('season_ballots', { school: school.trim() });
  if (error) {
    if (error.hint === 'coach_plan_required') throw new PlanRequiredError(error.message);
    if (/season_ballots|could not find|schema cache/i.test(error.message)) throw new Error('Season growth needs the latest database update (supabase/all_in_one.sql).');
    throw new Error(error.message);
  }
  type Row = { speaker: string; event_id: string; tournament: string; round: number; rank: number | null; rating: number | null; section_marks: number[] | null; present: boolean | null; submitted_at: string | null };
  return ((data ?? []) as Row[]).map(row => ({
    speaker: row.speaker, eventId: row.event_id, tournament: row.tournament, round: row.round, rank: row.rank, rating: row.rating,
    marks: row.section_marks ?? [], present: row.present, submittedAt: row.submitted_at,
  }));
}

/** Status of each ballot the signed-in judge has started, keyed "round|room". */
export async function listMyBallotStatus(tournament: string): Promise<Record<string, 'draft' | 'submitted'>> {
  const db = supabase ?? fail('Accounts are not connected.');
  const { data, error } = await db.from('ballots').select('round, room, status').eq('tournament', tournament);
  if (error) fail(error.message);
  return Object.fromEntries((data ?? []).map(row => [`${row.round}|${row.room}`, row.status]));
}

/** Ranks and ratings from submitted ballots for a tournament's rooms. Only its director can read them all. */
export async function listTournamentResults(tournamentId: string): Promise<{ entryId: string; sectionId: string; rank: number; rating: number }[]> {
  const db = supabase ?? fail('Accounts are not connected.');
  const { data: ballots, error } = await db.from('ballots').select('id, round, section_id').eq('tournament_id', tournamentId).eq('status', 'submitted');
  if (error) fail(error.message);
  const rows = await Promise.all((ballots ?? []).filter(ballot => ballot.section_id).map(async ballot => {
    const { data, error: entryError } = await db.from('ballot_entries').select('speaker_code, rank, rating, present').eq('ballot_id', ballot.id);
    if (entryError) fail(entryError.message);
    // Paper ballots entered by the tab room may have ranks without points; those count with 0 rating points.
    return (data ?? []).filter(entry => entry.present && entry.rank).map(entry => ({ entryId: entry.speaker_code as string, sectionId: ballot.section_id as string, rank: entry.rank as number, rating: (entry.rating ?? 0) as number }));
  }));
  return rows.flat();
}

/**
 * A student's own ballots from a tournament. The database only returns them once the tournament
 * has finished and the student's coach has released results; before that this is empty.
 */
export async function listMyReleasedBallots(tournamentId: string): Promise<TeamBallotRow[]> {
  const db = supabase ?? fail('Accounts are not connected.');
  const { data: ballots, error } = await db.from('ballots').select('id, judge_name, tournament, round, event_id, submitted_at').eq('tournament_id', tournamentId).eq('status', 'submitted');
  if (error) fail(error.message);
  const rows = await Promise.all((ballots ?? []).map(async ballot => {
    const { data, error: entryError } = await db.from('ballot_entries').select('speaker_code, speaker_name, school, present, rank, rating, time_seconds, time_penalty, section_marks, comments, reason, disqualifications').eq('ballot_id', ballot.id);
    if (entryError) fail(entryError.message);
    return (data ?? []).map(row => ({
      key: `${ballot.id}-${row.speaker_code}`, speaker: row.speaker_name as string, school: row.school as string, rank: row.rank as number | null, rating: row.rating as number | null,
      timeSeconds: row.time_seconds as number | null, timePenalty: row.time_penalty as boolean, marks: (row.section_marks ?? []) as number[], comments: (row.comments ?? '') as string, reason: row.reason as string,
      disqualifications: (row.disqualifications ?? []) as string[], present: row.present as boolean | null,
      judge: ballot.judge_name as string, tournament: ballot.tournament as string, round: ballot.round as number, eventId: ballot.event_id as string, submittedAt: ballot.submitted_at as string | null,
    }));
  }));
  return rows.flat().sort((a, b) => a.round - b.round);
}
