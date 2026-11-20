/**
 * Room-accessibility requests. A coach marks that a student needs an accessible room (step-free, ground floor or
 * elevator), with an optional short note; the director marks which rooms are accessible (tournament.accessibleRooms).
 * The schedule builder then gives those students' rooms the accessible rooms first (tournament.ts: placeRooms, finalRoom).
 *
 * A request belongs to the student, not to one entry: it applies to every event they are in. The note is private to the
 * student's coach, the director and the student; signed in, that is enforced by supabase/accessibility.sql.
 */
import { isAccessibleRoom, isFinal, roomsFor, roundLabel, sameSchool, type Entry, type Section, type Tournament } from './tournament';

export type AccessRequest = { school: string; student: string; note: string };
/** The longest note a coach can write (the database checks the same). */
export const ACCESS_NOTE_MAX = 200;

const keyOf = (school: string, student: string) => `${school.trim().toLowerCase()}|${student.trim().toLowerCase()}`;
export const cleanNote = (note: string) => note.replace(/\s+/g, ' ').trim().slice(0, ACCESS_NOTE_MAX);

/** Entries with each student's request attached (`access`, `accessNote`). Entries without a request are returned unchanged. */
export function applyAccess(entries: Entry[], requests: AccessRequest[]): Entry[] {
  if (requests.length === 0) return entries;
  const byStudent = new Map(requests.map(request => [keyOf(request.school, request.student), request]));
  return entries.map(entry => { const request = byStudent.get(keyOf(entry.school, entry.student)); return request ? { ...entry, access: true, accessNote: request.note } : entry; });
}

/** The list with one student's request added, changed (`needed`) or removed. */
export function withRequest(list: AccessRequest[], school: string, student: string, needed: boolean, note: string): AccessRequest[] {
  const key = keyOf(school, student);
  const rest = list.filter(request => keyOf(request.school, request.student) !== key);
  return needed ? [...rest, { school: school.trim(), student: student.trim(), note: cleanNote(note) }] : rest;
}

/** One student's request, worked out from their entries, or null. */
export function requestOf(entries: Entry[], school: string, student: string): AccessRequest | null {
  const entry = entries.find(item => item.access && sameSchool(item.school, school) && item.student.trim().toLowerCase() === student.trim().toLowerCase());
  return entry ? { school: entry.school, student: entry.student, note: entry.accessNote ?? '' } : null;
}

/** Every student with a request, by school then name. */
export function requestsIn(entries: Entry[]): AccessRequest[] {
  const seen = new Map<string, AccessRequest>();
  entries.filter(entry => entry.access).forEach(entry => { const key = keyOf(entry.school, entry.student); if (!seen.has(key)) seen.set(key, { school: entry.school, student: entry.student, note: entry.accessNote ?? '' }); });
  return [...seen.values()].sort((a, b) => a.school.localeCompare(b.school) || a.student.localeCompare(b.student));
}

/** The rooms on the director's list that are marked accessible. */
export const accessibleRoomsIn = (tournament: Tournament) => roomsFor(tournament).filter(room => isAccessibleRoom(tournament, room));

/** True if a speaker in this room needs an accessible room. */
export const sectionNeedsAccess = (section: Section, entries: Entry[]) => section.entryIds.some(id => entries.some(entry => entry.id === id && entry.access));
/** A room that needs an accessible room but isn't in one. */
export const misplaced = (section: Section, entries: Entry[], tournament: Tournament) => sectionNeedsAccess(section, entries) && !isAccessibleRoom(tournament, section.room);

export type RoundAccess = { round: number; label: string; needed: number; have: number; misplaced: number };
/**
 * For each round: how many rooms need an accessible room, how many accessible rooms there are, and how many rooms that need
 * one aren't in one. A final is one room however many judges (ballots) it has.
 */
export function accessByRound(tournament: Tournament, sections: Section[], entries: Entry[]): RoundAccess[] {
  const have = accessibleRoomsIn(tournament).length;
  const rounds = [...new Set(sections.map(section => section.round))].sort((a, b) => a - b);
  return rounds.map(round => {
    const here = sections.filter(section => section.round === round && sectionNeedsAccess(section, entries));
    // Seats of one final (or semifinal room) share a room: count the room once.
    const rooms = new Map<string, Section>();
    here.forEach(section => rooms.set(isFinal(section, tournament) ? `${section.eventId}|${section.division ?? 'varsity'}|${section.room}` : section.id, section));
    const list = [...rooms.values()];
    return { round, label: list[0] ? roundLabel(list[0], tournament) : `Round ${round}`, needed: list.length, have, misplaced: list.filter(section => !isAccessibleRoom(tournament, section.room)).length };
  }).filter(item => item.needed > 0);
}

/** "2 rooms need accessible rooms in Round 1; you have 1." */
export const shortageText = (item: RoundAccess) => `${item.needed} ${item.needed === 1 ? 'room needs an accessible room' : 'rooms need accessible rooms'} in ${item.label}; you have ${item.have}.`;

/** One student's rooms, round by round (a final's judges share one room, so it is listed once). */
export function roomsOf(student: AccessRequest, entries: Entry[], sections: Section[]): Section[] {
  const ids = new Set(entries.filter(entry => sameSchool(entry.school, student.school) && entry.student.trim().toLowerCase() === student.student.trim().toLowerCase()).map(entry => entry.id));
  const mine = sections.filter(section => section.entryIds.some(id => ids.has(id))).sort((a, b) => a.round - b.round || a.eventId.localeCompare(b.eventId));
  return mine.filter((section, index) => mine.findIndex(other => other.round === section.round && other.eventId === section.eventId && (other.division ?? 'varsity') === (section.division ?? 'varsity') && other.room === section.room) === index);
}

/** Read a roster file's access cell: any non-empty value means the student needs an accessible room, and is the note. */
export function accessFromCell(value: string | undefined): { needed: boolean; note: string } {
  const text = (value ?? '').trim();
  return text ? { needed: true, note: cleanNote(text) } : { needed: false, note: '' };
}
