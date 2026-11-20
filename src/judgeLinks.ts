/**
 * Coach-entered judges and their private sign-in links (supabase/judges.sql).
 *
 * A coach enters their school's judges for a tournament. Each judge gets a link holding a random token;
 * the database keeps only its hash. Opening the link signs the judge in as a Supabase anonymous user and
 * binds them to their seat, so they see and fill in only their own rooms' ballots, with no account.
 * In the demo everything stays in the browser and a link is `#/judge-link/demo-<seat>-<n>`.
 */
import { useEffect, useState } from 'react';
import { supabase } from './auth';
import type { Judge } from './tournament';

export type CoachJudge = {
  id: string; tournamentId: string; school: string; name: string; email: string; phone: string;
  clean: boolean; knows: string[];
  /** Coach-entered judges are approved at once; the director can decline them. */
  status: 'approved' | 'declined';
  /** A link is out and working. */
  hasLink: boolean;
  /** The last link was turned off (and nobody has been sent a new one). */
  revoked: boolean;
  /** Someone has opened the link and holds the seat. */
  claimed: boolean;
  createdAt: string;
  /** Demo only: the current link's token, so a demo link can be opened in this browser. */
  demoToken?: string;
};

/** Prefix for the id of a coach-entered judge nobody has signed in as yet (signed-in mode). */
export const SEAT_PREFIX = 'cj:';
export const seatJudgeId = (seat: CoachJudge) => `${SEAT_PREFIX}${seat.id}`;
export const isSeatId = (id: string | null | undefined) => !!id && id.startsWith(SEAT_PREFIX);

/** A seat as a judge the scheduler can place. In the demo the seat id is the judge id. */
export const seatAsJudge = (seat: CoachJudge, live: boolean): Judge => ({ id: live ? seatJudgeId(seat) : seat.id, name: seat.name, school: seat.school, clean: seat.clean, knows: seat.clean ? [] : seat.knows });

const sameSchool = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** How many judges a school has entered (and the director hasn't declined), or null if none were entered. */
export const enteredJudgeCount = (seats: CoachJudge[], school: string) => {
  const mine = seats.filter(seat => sameSchool(seat.school, school));
  return mine.length === 0 ? null : mine.filter(seat => seat.status === 'approved').length;
};

// ── Links ─────────────────────────────────────────────────────────────────────────────────────
export const linkUrl = (token: string) => `${window.location.origin}${window.location.pathname}#/judge-link/${encodeURIComponent(token)}`;
export const linkMessage = (seat: CoachJudge, tournament: string, url: string) =>
  `Hi ${seat.name.split(/\s+/)[0]}, you're judging for ${seat.school} at ${tournament}. Open this private link on your phone to see your rooms and fill in your ballots. No account needed, and please don't share it: ${url}`;
export const mailtoLink = (seat: CoachJudge, tournament: string, url: string) =>
  `mailto:${encodeURIComponent(seat.email)}?subject=${encodeURIComponent(`Your judge link for ${tournament}`)}&body=${encodeURIComponent(linkMessage(seat, tournament, url))}`;
/** `sms:` with a body works on iOS and Android when written as `?&body=`. */
export const smsLink = (seat: CoachJudge, tournament: string, url: string) => `sms:${seat.phone.replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(linkMessage(seat, tournament, url))}`;

/**
 * Links made in this browser tab, so a coach can copy, email, and text the same link without making
 * a new one each time. Kept in memory only: after a reload a coach makes a new link (the old one stops working).
 */
const madeLinks = new Map<string, string>();
export const rememberLink = (seatId: string, token: string) => { madeLinks.set(seatId, token); };
export const linkMadeHere = (seatId: string) => madeLinks.get(seatId) ?? null;
export const forgetLink = (seatId: string) => { madeLinks.delete(seatId); };

// ── Routes: #/judge-link/<token> opens a link; #/judging is a guest judge's page afterwards ──────
export type JudgeLinkRoute = { token: string | null };
const readRoute = (): JudgeLinkRoute | null => {
  const match = window.location.hash.match(/^#\/judge-link\/([^/?#]+)/);
  if (match) return { token: decodeURIComponent(match[1]) };
  return /^#\/judging\/?$/.test(window.location.hash) ? { token: null } : null;
};
export function useJudgeLinkRoute(): [JudgeLinkRoute | null, (route: JudgeLinkRoute | null) => void] {
  const [route, setRoute] = useState<JudgeLinkRoute | null>(readRoute);
  useEffect(() => { const sync = () => setRoute(readRoute()); window.addEventListener('hashchange', sync); return () => window.removeEventListener('hashchange', sync); }, []);
  const go = (next: JudgeLinkRoute | null) => {
    // replaceState: the token never stays in the history once it has been used.
    if (next) history.replaceState(null, '', `${window.location.pathname}${window.location.search}${next.token ? `#/judge-link/${encodeURIComponent(next.token)}` : '#/judging'}`);
    else history.replaceState(null, '', window.location.pathname + window.location.search);
    setRoute(next);
  };
  return [route, go];
}
export const demoToken = (seatId: string, n: number) => `demo-${seatId}-${n}`;

// ── Database ─────────────────────────────────────────────────────────────────────────────────
const fail = (message: string): never => {
  if (/could not find|schema cache|does not exist/i.test(message)) throw new Error('The database needs an update. Run supabase/judges.sql in the Supabase SQL Editor.');
  if (/row-level security/i.test(message)) throw new Error('You can only enter judges for your own school, once the director has approved you.');
  throw new Error(message);
};
const db = () => supabase ?? fail('Accounts are not connected.');
// No token_hash and no claimed_by: the database won't hand them out.
const columns = 'id, tournament_id, school, name, email, phone, clean_judge, known_schools, status, link_created_at, revoked_at, claimed_at, created_at';
type SeatRecord = { id: string; tournament_id: string; school: string; name: string; email: string; phone: string; clean_judge: boolean; known_schools: string[] | null; status: 'approved' | 'declined'; link_created_at: string | null; revoked_at: string | null; claimed_at: string | null; created_at: string };
const toSeat = (row: SeatRecord): CoachJudge => ({
  id: row.id, tournamentId: row.tournament_id, school: row.school, name: row.name, email: row.email ?? '', phone: row.phone ?? '', clean: row.clean_judge, knows: row.known_schools ?? [],
  status: row.status, hasLink: !!row.link_created_at && !row.revoked_at, revoked: !!row.revoked_at, claimed: !!row.claimed_at, createdAt: row.created_at,
});

export type SeatInput = { name: string; email: string; phone: string; clean: boolean; knows: string[] };
const inputColumns = (input: SeatInput) => ({ name: input.name.trim(), email: input.email.trim(), phone: input.phone.trim(), clean_judge: input.clean, known_schools: input.clean ? [] : input.knows });

/** The judges a coach entered (their school's only) or, for the director, every school's. Empty before judges.sql is run. */
export async function listCoachJudges(tournamentId: string): Promise<CoachJudge[]> {
  const { data, error } = await db().from('coach_judges').select(columns).eq('tournament_id', tournamentId).order('created_at');
  if (error) { if (/could not find|schema cache|does not exist/i.test(error.message)) return []; fail(error.message); }
  return ((data ?? []) as SeatRecord[]).map(toSeat);
}

export async function addCoachJudge(tournamentId: string, school: string, input: SeatInput): Promise<CoachJudge> {
  const { data, error } = await db().from('coach_judges').insert({ tournament_id: tournamentId, school, ...inputColumns(input) }).select(columns).single();
  if (error) fail(error.message);
  return toSeat(data as SeatRecord);
}

export async function updateCoachJudge(id: string, input: SeatInput): Promise<void> {
  const { error } = await db().from('coach_judges').update(inputColumns(input)).eq('id', id);
  if (error) fail(error.message);
}

export async function removeCoachJudge(id: string): Promise<void> {
  const { error } = await db().from('coach_judges').delete().eq('id', id);
  if (error) fail(error.message);
}

/** The director approves or declines a coach-entered judge. */
export async function decideCoachJudge(id: string, status: 'approved' | 'declined'): Promise<void> {
  const { error } = await db().from('coach_judges').update({ status }).eq('id', id);
  if (error) fail(error.message);
}

/** A new link. The token comes back once; any earlier link for this judge stops working. */
export async function createJudgeLink(id: string): Promise<string> {
  const { data, error } = await db().rpc('create_judge_link', { seat: id });
  if (error) fail(error.message);
  return data as string;
}

/** Turn a link off. Whoever opened it is signed out of the seat. */
export async function revokeJudgeLink(id: string): Promise<void> {
  const { error } = await db().rpc('revoke_judge_link', { seat: id });
  if (error) fail(error.message);
}

/** The director merges a coach-entered judge into the same person's own judge account. */
export async function mergeJudgeSeat(id: string, account: string): Promise<void> {
  const { error } = await db().rpc('merge_judge_seat', { seat: id, account });
  if (error) fail(error.message);
}

export type ClaimedSeat = { tournamentId: string; seatId: string; name: string; school: string; tournamentName: string };
/** Binds the signed-in user (normally a fresh anonymous one) to the link's judge seat. */
export async function claimJudgeLink(token: string): Promise<ClaimedSeat> {
  const { data, error } = await db().rpc('claim_judge_link', { token });
  if (error) {
    if (/could not find|schema cache|does not exist/i.test(error.message)) throw new Error('Judge links aren’t set up on this site yet. Ask the tournament director to run supabase/judges.sql.');
    throw new Error(error.message);
  }
  const row = (Array.isArray(data) ? data[0] : data) as { tournament_id: string; seat_id: string; judge_name: string; school: string; tournament_name: string } | undefined;
  if (!row) throw new Error('This judge link isn’t valid any more. Ask your coach for a new one.');
  return { tournamentId: row.tournament_id, seatId: row.seat_id, name: row.judge_name, school: row.school, tournamentName: row.tournament_name };
}

/** Signs in as a guest judge. Fails with a clear message if the project hasn't turned anonymous sign-ins on. */
export async function signInAsGuest(): Promise<void> {
  const { error } = await db().auth.signInAnonymously();
  if (error) {
    if (/anonymous/i.test(error.message)) throw new Error('Guest judge sign-in is turned off for this site. Ask the tournament director to turn on anonymous sign-ins in Supabase, or create an account instead.');
    throw new Error(error.message);
  }
}
