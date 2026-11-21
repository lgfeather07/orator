/**
 * Text and email alerts: settings, phone numbers, and the wording of each alert.
 *
 * Signed in, alerts are queued by Postgres (supabase/alerts.sql), which builds the real messages; the
 * builders here use the same wording so the demo can preview exactly what would be sent. Keep the two in step.
 * This file imports types only, so `npm run test:alerts` can run it in Node.
 */
import type { Entry, Section, Tournament } from './tournament';

export type AlertChannel = 'sms' | 'email';
export type AlertKind = 'rooms' | 'ballots' | 'schedule' | 'entries';
export type AlertRole = 'student' | 'judge' | 'coach';
export type AlertSettings = { phone: string; smsOptIn: boolean; emailOptIn: boolean; rooms: boolean; ballots: boolean; schedule: boolean; entries: boolean; smsConsentAt?: string | null };
export const defaultAlertSettings: AlertSettings = { phone: '', smsOptIn: false, emailOptIn: false, rooms: true, ballots: true, schedule: true, entries: true, smsConsentAt: null };

export const SITE_URL = 'https://orator-1rab.vercel.app';
/** What a person agrees to when they switch texts on. Saved with their settings. */
export const SMS_CONSENT = 'I agree to receive text alerts from Orator about tournaments I’m in: my rooms, ballots, and schedule changes. A few texts per tournament day. Message and data rates may apply. Reply STOP to opt out, HELP for help.';

/** Which alerts each kind of person can choose, and how they're described. */
export const alertKinds: { kind: AlertKind; label: string; detail: string; roles: AlertRole[] }[] = [
  { kind: 'rooms', label: 'My rooms for each round', detail: 'Your room, start time, and when you speak, before each round.', roles: ['student'] },
  { kind: 'ballots', label: 'I have a ballot or room assignment', detail: 'When you’re given a room to judge, or taken off one.', roles: ['judge'] },
  { kind: 'schedule', label: 'Schedule changes', detail: 'When the schedule is published.', roles: ['student', 'judge', 'coach'] },
  { kind: 'entries', label: 'Entries closed or opened', detail: 'When the director closes or reopens entries.', roles: ['coach'] },
];

/**
 * A US mobile number in any common format, as +1 and ten digits. Area codes and exchanges can't start with 0 or 1.
 * Returns an error message for anything else.
 */
export function normalizePhone(input: string): { phone: string; error: string } {
  const trimmed = input.trim();
  if (trimmed === '') return { phone: '', error: '' };
  if (/[^0-9+().\-\s]/.test(trimmed)) return { phone: '', error: 'Use digits only, like (402) 555-0123.' };
  let digits = trimmed.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return { phone: '', error: 'Enter a 10-digit US number, like (402) 555-0123.' };
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return { phone: '', error: 'That isn’t a valid US number. Check the area code.' };
  return { phone: `+1${digits}`, error: '' };
}
/** +14025550123 → (402) 555-0123 */
export const formatPhone = (phone: string) => { const d = phone.replace(/\D/g, '').slice(-10); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : phone; };
/** Only the last two digits, for lists other people might see. */
export const maskPhone = (phone: string) => { const d = phone.replace(/\D/g, ''); return d.length >= 2 ? `(•••) •••-••${d.slice(-2)}` : ''; };

// Short event names and round times, the same as supabase/alerts.sql (and roundTimes in tournament.ts).
const eventShort: Record<string, string> = { info: 'Informative', persuasive: 'Persuasive', extemp: 'Extemp', entertainment: 'Entertainment', oid: 'OID', poi: 'POI', poetry: 'Poetry', serious: 'Serious', humorous: 'Humorous', duet: 'Duet Acting', duo: 'Duo' };
const times = ['8:00 AM', '9:30 AM', '11:00 AM', '1:30 PM', '3:00 PM', '4:30 PM', '6:00 PM'];
export const alertTime = (round: number) => times[Math.min(Math.max(round, 1), times.length) - 1];
export const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`;

/** "Round 2 Informative", "Round 2 Novice Poetry", "Informative final". */
export function roomLabel(section: Pick<Section, 'round' | 'eventId' | 'division'>, prelimRounds: number) {
  const event = `${section.division === 'novice' ? 'Novice ' : ''}${eventShort[section.eventId] ?? section.eventId}`;
  return section.round > prelimRounds ? `${event} final` : `Round ${section.round} ${event}`;
}
export const studentRoomMessage = (section: Pick<Section, 'round' | 'eventId' | 'division' | 'room'>, prelimRounds: number, position: number, time = alertTime(section.round)) =>
  `Orator: ${roomLabel(section, prelimRounds)} - ${section.room} at ${time}. You speak ${ordinal(position)}.`;
export const judgeRoomMessage = (section: Pick<Section, 'round' | 'eventId' | 'division' | 'room'>, prelimRounds: number, site = SITE_URL, time = alertTime(section.round)) =>
  `Orator: You're judging ${roomLabel(section, prelimRounds)} in ${section.room} at ${time}. Open your ballot: ${site}`;
const shortName = (name: string) => name.trim().length > 60 ? `${name.trim().slice(0, 57)}...` : name.trim();
export const scheduleMessage = (tournament: Pick<Tournament, 'name'>, site = SITE_URL) => `Orator: The ${shortName(tournament.name)} schedule is out. See your rooms and times: ${site}`;
export const entriesMessage = (tournament: Pick<Tournament, 'name'>, open: boolean) => open
  ? `Orator: Entries for ${shortName(tournament.name)} are open again. You can add and drop students until the director closes them.`
  : `Orator: Entries for ${shortName(tournament.name)} are now closed. Report an issue in Orator if something still needs to change.`;

/**
 * How many SMS segments a message costs. Plain text fits 160 characters in one text (153 per part when split);
 * any character outside the GSM alphabet (curly quotes, emoji) drops that to 70 (67).
 */
export function smsSegments(text: string) {
  const gsm = /^[A-Za-z0-9 @£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/.test(text);
  const [single, part] = gsm ? [160, 153] : [70, 67];
  return text.length <= single ? 1 : Math.ceil(text.length / part);
}

/** Someone who might receive an alert. `rosterName` is the name their coach linked them to, if any. */
export type AlertPerson = { id: string; name: string; role: AlertRole; school: string; rosterName?: string; email: string; settings: AlertSettings };
export type PlannedAlert = { person: AlertPerson; channel: AlertChannel; address: string; kind: AlertKind; message: string };

const wants = (settings: AlertSettings, kind: AlertKind) => settings[kind];
/** Each channel one person would get one message on, following their settings. */
export function deliveries(person: AlertPerson, kind: AlertKind, message: string): PlannedAlert[] {
  if (!wants(person.settings, kind)) return [];
  const out: PlannedAlert[] = [];
  if (person.settings.smsOptIn && person.settings.phone) out.push({ person, channel: 'sms', address: person.settings.phone, kind, message });
  if (person.settings.emailOptIn && person.email) out.push({ person, channel: 'email', address: person.email, kind, message });
  return out;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Every alert "Send room alerts for Round N" would queue: each student's room and speaking position for each
 * event (matched by roster name or name, and school), and each judge's room. Mirrors queue_round_alerts.
 */
export function roundAlerts(tournament: Pick<Tournament, 'rounds' | 'roundTimes'>, sections: Section[], entries: Entry[], people: AlertPerson[], round: number, site = SITE_URL) {
  const planned: PlannedAlert[] = []; let unmatched = 0; let students = 0;
  // The director's start time for the round, else the default (kept in step with timeFor in tournament.ts).
  const startOf = (number: number) => tournament.roundTimes?.[number - 1]?.trim() || alertTime(number);
  for (const section of sections.filter(item => item.round === round)) {
    section.entryIds.forEach((entryId, index) => {
      const entry = entries.find(item => item.id === entryId); if (!entry) return;
      const person = people.find(item => item.role === 'student' && same(item.school, entry.school) && same(item.rosterName || item.name, entry.student));
      if (!person) { unmatched++; return; }
      students++;
      planned.push(...deliveries(person, 'rooms', studentRoomMessage(section, tournament.rounds, index + 1, startOf(section.round))));
    });
    const judge = people.find(item => item.role === 'judge' && item.id === section.judgeId);
    if (judge) planned.push(...deliveries(judge, 'ballots', judgeRoomMessage(section, tournament.rounds, site, startOf(section.round))));
  }
  return { planned, unmatched, students };
}

/** A small, repeatable hash so the demo's sample opt-ins stay the same on every visit. */
const hash = (text: string) => { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/**
 * The demo's sample people: every entered student and every judge, about six in ten of them opted in.
 * The demo's own student (Maya), judge (Judge Leather), and coach (Erin) use whatever the viewer set.
 */
export function demoPeople(entries: Entry[], judges: { id: string; name: string; school: string }[], own: Partial<Record<AlertRole, AlertSettings>> = {}): AlertPerson[] {
  const sample = (name: string): AlertSettings => {
    const h = hash(name); if (h % 10 >= 6) return { ...defaultAlertSettings };
    const sms = h % 3 !== 0;
    return { ...defaultAlertSettings, smsOptIn: sms, emailOptIn: !sms || h % 5 === 0, phone: sms ? `+1402555${String(100 + (h % 100)).padStart(4, '0')}` : '' };
  };
  const email = (name: string) => `${name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')}@example.com`;
  const students = [...new Map(entries.map(entry => [`${entry.school}|${entry.student}`.toLowerCase(), entry])).values()].map(entry => ({
    id: `student:${entry.school}:${entry.student}`, name: entry.student, role: 'student' as const, school: entry.school, email: email(entry.student),
    settings: entry.student === 'Maya Rodriguez' && entry.school === 'Wrenfield High' && own.student ? own.student : sample(entry.student),
  }));
  const judgePeople = judges.map(judge => ({ id: judge.id, name: judge.name, role: 'judge' as const, school: judge.school, email: email(judge.name), settings: judge.id === 'jl' && own.judge ? own.judge : sample(judge.name) }));
  const coach: AlertPerson = { id: 'coach:ej', name: 'Erin Johnson', role: 'coach', school: 'Wrenfield High', email: 'erin.johnson@example.com', settings: own.coach ?? sample('Erin Johnson') };
  return [...students, ...judgePeople, coach];
}
