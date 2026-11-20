/**
 * Demo tournament model: coaches enter students, the director builds the schedule.
 * Everything here lives in the browser (see store.tsx); it is not yet saved to the database.
 */
export type TournamentStatus = 'registration' | 'scheduled' | 'running' | 'finished';
export type TournamentFormat = 'finals' | 'prelims';
/** True when places come from the preliminary rounds alone. */
export const prelimsOnly = (tournament: Tournament) => tournament.format === 'prelims';

export type Tournament = {
  name: string; date: string; host: string; rounds: number; sectionSize: number;
  /** The most events one student may enter. A student may enter each event once. */
  maxEntries: number;
  /** Judges in each final round: two at districts, three at state. */
  finalJudges?: number;
  /** How many speakers make each final, tournament-wide. Defaults to six, the NSAA number. */
  finalists?: number;
  /** The director's cut for one contest (key from `contestKey`), overriding `finalists`. */
  finalistsByContest?: Record<string, number>;
  /** Contests (key from `contestKey`) that hold semifinals before their final. A contest not listed has a final only. */
  semisByContest?: Record<string, SemiPlan>;
  /** Team points for 1st to 6th in a final. Defaults to the NSAA scale. */
  teamPoints?: number[];
  /** What the host charges, in dollars (cents allowed, e.g. 7.50 per entry). */
  fees?: Fees;
  /** The director opens and closes entries. Closed entries stop coaches adding or dropping; the director still can. Defaults to open. */
  entriesOpen?: boolean;
  /** The rooms the director has for this tournament, in the order to fill them. */
  rooms?: string[];
  /** 'optional' (default): judges give a score out of 50 and may also mark each section 1–10. 'required': every section must be marked. */
  sectionMarks?: 'optional' | 'required';
  /** Most entries one school may have before more go on the waitlist. Empty means no cap. */
  schoolEntryCap?: number | null;
  /** Most entries in one event (each division counted separately) before more go on the waitlist. Empty means no cap. */
  eventEntryCap?: number | null;
  /** Show judges the rating their section marks add up to. Off by default: many judges would rather not see it. */
  showRating?: boolean;
  /**
   * 'finals' (default): the top speakers after prelims go to a final (or semifinals) that decides places.
   * 'prelims': no final round. Places come straight from the preliminary rounds, as at many early-season meets.
   */
  format?: TournamentFormat;
  /** With no final round, how many places are announced in each event. Defaults to 6. */
  placesAwarded?: number;
  /** Whether novice finals earn team points. Usually not, so off by default. */
  noviceTeamPoints?: boolean;
  /** Public calendar listing (see Calendar.tsx). Listed by default for new tournaments. */
  listed?: boolean;
  /** City or venue shown on the calendar. */
  city?: string;
  /** The real date (YYYY-MM-DD) for sorting and filtering. `date` stays the text people read. */
  startDate?: string;
  /** Last day coaches can register (YYYY-MM-DD). */
  registrationDeadline?: string;
  /** A short note for coaches on the calendar. */
  notes?: string;
  /** A coach's request to register their school is approved at once. Judges and students still wait. */
  autoApproveCoaches?: boolean;
  eventIds: string[]; status: TournamentStatus;
};

/**
 * A semifinal round for one contest: the top `size` after prelims, split into two rooms, each heard by
 * `judges` judges; the top `advance` in each room make the final.
 */
export type SemiPlan = { size: number; judges: number; advance: number };

export type Fees = { entry: number; school: number; judge: number; entriesPerJudge: number };
/**
 * What Orator charges the host for one tournament, billed after it ends and set by how many admitted entries it had.
 * Card processing is included: schools pay only the host's fees. Each tier is below SpeechWire's 2026–27 price
 * at every entry count it covers. A director's first tournament on Orator is free.
 */
export const ORATOR_PRICING: { upTo: number; fee: number }[] = [
  { upTo: 25, fee: 40 }, { upTo: 60, fee: 55 }, { upTo: 100, fee: 100 }, { upTo: 150, fee: 160 }, { upTo: 200, fee: 225 },
  { upTo: 300, fee: 300 }, { upTo: 400, fee: 380 }, { upTo: 600, fee: 430 }, { upTo: Infinity, fee: 480 },
];
export const oratorFeeFor = (entries: number) => entries === 0 ? 0 : ORATOR_PRICING.find(tier => entries <= tier.upTo)!.fee;
export const pricingTierLabel = (entries: number) => { const index = Math.max(0, ORATOR_PRICING.findIndex(tier => entries <= tier.upTo)); const low = index === 0 ? 1 : ORATOR_PRICING[index - 1].upTo + 1; const high = ORATOR_PRICING[index].upTo; return high === Infinity ? `${low}+ entries` : `${low}–${high} entries`; };
/** Typical Nebraska fees: $7–8 an entry, set by each director, and $75 for each judge a school owes but doesn't bring. */
export const defaultFees: Fees = { entry: 7, school: 0, judge: 75, entriesPerJudge: 6 };
/** Dollars, with cents only when there are cents: $90, $7.50. */
export const money = (amount: number) => { const cents = Math.round(amount * 100); return cents % 100 === 0 ? `$${(cents / 100).toLocaleString()}` : `$${(cents / 100).toFixed(2)}`; };

/** How a school has settled up. `paid` is what has been received so far, in dollars. */
export type Payment = { judgesBringing: number; paid: number; method: 'card' | 'check' | null; checkPending: boolean; reference: string; paidAt: string };
export const noPayment: Payment = { judgesBringing: 0, paid: 0, method: null, checkPending: false, reference: '', paidAt: '' };

export type Invoice = { entries: number; entryTotal: number; schoolFee: number; judgesOwed: number; judgesBringing: number; judgesShort: number; judgeTotal: number; total: number; paid: number; balance: number };

/**
 * What a school owes: a fee per entry, a flat school fee, and a fee for each judge the school
 * should supply (one per `entriesPerJudge` entries) but isn't bringing.
 */
export function invoiceFor(tournament: Tournament, entries: Entry[], school: string, payment: Payment = noPayment): Invoice {
  const fees = tournament.fees ?? defaultFees;
  const count = entries.filter(entry => !entry.waitlisted && entry.school.trim().toLowerCase() === school.trim().toLowerCase()).length;
  const judgesOwed = count === 0 ? 0 : Math.ceil(count / Math.max(1, fees.entriesPerJudge));
  const judgesShort = Math.max(0, judgesOwed - payment.judgesBringing);
  const entryTotal = Math.round(count * fees.entry * 100) / 100, schoolFee = count === 0 ? 0 : fees.school, judgeTotal = judgesShort * fees.judge;
  const total = entryTotal + schoolFee + judgeTotal;
  return { entries: count, entryTotal, schoolFee, judgesOwed, judgesBringing: payment.judgesBringing, judgesShort, judgeTotal, total, paid: payment.paid, balance: total - payment.paid };
}

export type Division = 'varsity' | 'novice';
export const divisions: Division[] = ['varsity', 'novice'];
export const divisionLabel: Record<Division, string> = { varsity: 'Varsity', novice: 'Novice' };
/** Entries and sections saved before divisions existed are varsity. */
export const divisionOf = (item: { division?: Division }): Division => item.division ?? 'varsity';

/** `waitlisted`: over the tournament's entry caps, so not scheduled or charged until the director admits it. */
export type Entry = { id: string; student: string; school: string; eventId: string; division?: Division; waitlisted?: boolean };

/**
 * A judge. `clean` means they don't know any of the competitors, so they can judge anyone.
 * `knows` lists other schools whose students they know (a former team, their own kids' school), kept off like their own school.
 */
export type Judge = { id: string; name: string; school: string; clean?: boolean; knows?: string[] };
/** True if this judge shouldn't hear a speaker from this school. A clean judge knows nobody, so can judge any room. */
export const judgeConflict = (judge: Judge, school: string) => !judge.clean && ((judge.school !== '' && sameSchool(judge.school, school)) || (judge.knows ?? []).some(known => sameSchool(known, school)));

/** Which part of the tournament a room belongs to. */
export type SectionStage = 'prelim' | 'semi' | 'final';
/**
 * One room in one round: a judge hears these entries, in this speaking order.
 * `stage` is only stored for semifinals; without it, rounds after the last preliminary round are finals.
 */
export type Section = { id: string; round: number; eventId: string; division?: Division; label: string; room: string; judgeId: string | null; judgeName?: string; entryIds: string[]; stage?: SectionStage };

/**
 * A contest is one event in one division (Novice Informative is separate from Varsity Informative):
 * each has its own rooms, breaks, and final. Varsity keeps the plain event id so older data still works.
 */
export const contestKey = (eventId: string, division: Division) => division === 'novice' ? `${eventId}:novice` : eventId;
export const contestOf = (item: { eventId: string; division?: Division }) => contestKey(item.eventId, divisionOf(item));
export const parseContest = (key: string): { eventId: string; division: Division } => { const [eventId, division] = key.split(':'); return { eventId, division: division === 'novice' ? 'novice' : 'varsity' }; };

/**
 * A note from the director: a change to the published schedule (everyone sees it) or entries opening
 * or closing (coaches see it).
 */
export type UpdateKind = 'schedule' | 'entries';
export type ScheduleChange = { id: string; time: string; text: string; kind?: UpdateKind };

/** Something a coach asks a student to work on. It belongs to the student, so it carries across the season. */
export type PracticeGoal = { id: string; school: string; student: string; eventId: string; text: string; done: boolean; created: string };

export type IssueKind = 'no-judge' | 'injury' | 'schedule' | 'ballot' | 'other';
export type Issue = {
  id: string; kind: IssueKind; where: string; detail: string; reporter: string; role: string;
  time: string; status: 'open' | 'resolved';
};

export const issueKinds: Record<IssueKind, { label: string; hint: string; urgent: boolean }> = {
  'no-judge': { label: 'No judge in the room', hint: 'A round can’t start because the judge hasn’t arrived.', urgent: true },
  injury: { label: 'Injury or medical concern', hint: 'Someone is hurt or unwell.', urgent: true },
  schedule: { label: 'Wrong room or schedule', hint: 'A room, time, or pairing looks wrong.', urgent: false },
  ballot: { label: 'Ballot or scoring problem', hint: 'A ballot won’t save, or a score looks wrong.', urgent: false },
  other: { label: 'Something else', hint: 'Anything the tab room should know.', urgent: false },
};

/** The director's rooms, or numbered placeholders until they add theirs. */
export const roomsFor = (tournament: Tournament): string[] => tournament.rooms?.length ? tournament.rooms : Array.from({ length: 30 }, (_, index) => `Room ${index + 1}`);
/** Rooms beyond the director's list are named so they stand out on the schedule. */
export const roomNeeded = (room: string) => room.startsWith('Room needed');
/** Sample rooms for the demo tournament. */
export const rooms = ['Room 101', 'Room 104', 'Room 108', 'Room 110', 'Room 122', 'Room 207', 'Room 214', 'Room 215', 'Room 301', 'Room 303', 'Library', 'Band room', 'Auditorium', 'Room 118', 'Room 120', 'Room 305', 'Room 307', 'Room 309', 'Cafeteria'];

export const judgePool: Judge[] = [
  { id: 'jl', name: 'Judge Leather', school: '', knows: ['Ashgrove'] },
  { id: 'mc', name: 'Maria Chen', school: 'Halden West' },
  { id: 'dr', name: 'David Ross', school: 'Brightwater High' },
  { id: 'af', name: 'Alyssa Ford', school: 'Ashgrove' },
  { id: 'ej', name: 'Erin Johnson', school: 'Wrenfield High' },
  { id: 'tb', name: 'Tom Becker', school: '' , clean: true },
  { id: 'rn', name: 'Rosa Nuñez', school: 'Kestrel Prep' },
  { id: 'kp', name: 'Kyle Pratt', school: 'Larkspur High' },
  { id: 'hw', name: 'Hannah Wolfe', school: 'Thornbury' },
  { id: 'bs', name: 'Ben Sato', school: '' , clean: true },
  { id: 'lm', name: 'Lena Morris', school: 'Fallow Creek' },
  { id: 'pg', name: 'Priya Gill', school: '' , clean: true },
  { id: 'co', name: 'Carl Osei', school: '' },
  { id: 'nw', name: 'Nell Ward', school: 'Marlowe West' },
  { id: 'jh', name: 'Jon Hale', school: '' },
  { id: 'sv', name: 'Sara Vance', school: '' },
  { id: 'mo', name: 'Marcus Odom', school: '' },
  { id: 'ek', name: 'Ellen Kraft', school: '' },
  { id: 'dp', name: 'Dev Patil', school: '' },
  { id: 'rb', name: 'Ruth Baines', school: '' },
  // With novice divisions there are more rooms and twice the finals, so the sample pool is bigger.
  { id: 'gt', name: 'Gina Torres', school: '', clean: true },
  { id: 'wf', name: 'Walt Fischer', school: 'Kestrel Prep' },
  { id: 'ah', name: 'Amara Hughes', school: '' },
  { id: 'ln', name: 'Luis Navarro', school: 'Ashgrove' },
  { id: 'cb', name: 'Claire Bishop', school: '' },
  { id: 'rd', name: 'Roy Dalton', school: '', knows: ['Thornbury'] },
  { id: 'ms', name: 'Mina Sato', school: 'Brightwater High' },
  { id: 'jw', name: 'Joel Weber', school: '' },
  { id: 'th', name: 'Tess Holm', school: '', clean: true },
  { id: 'oh', name: 'Omar Khan', school: 'Wrenfield High' },
];

export const defaultTournament: Tournament = {
  rooms,
  name: 'Larkspur Invitational', date: 'October 19, 2026', host: 'Larkspur High School', rounds: 3, sectionSize: 6, maxEntries: 4,
  eventIds: ['info', 'persuasive', 'extemp', 'entertainment', 'poetry', 'serious', 'humorous'], status: 'registration',
};

// A realistic field: most students are in one or two events, many in three, and one in four.
const seedTeams: Record<string, [string, string[]][]> = {
  'Wrenfield High': [['Maya Rodriguez', ['info', 'persuasive', 'poetry']], ['Eli Thompson', ['extemp', 'info']], ['Nora Patel', ['persuasive', 'serious', 'extemp']], ['Sam Wilson', ['poetry', 'humorous']], ['Iris Chen', ['serious']]],
  'Kestrel Prep': [['Leo Brooks', ['info', 'extemp']], ['Ava Kim', ['persuasive']], ['Noah Reyes', ['humorous', 'entertainment', 'poetry']], ['Zoe Hart', ['extemp']], ['Mila Stone', ['entertainment', 'humorous']]],
  'Halden West': [['Owen Burke', ['info', 'persuasive', 'extemp']], ['Ruby Lang', ['info']], ['Cole Avery', ['extemp', 'entertainment']], ['Tess Nolan', ['serious', 'poetry']], ['Jude Park', ['humorous']], ['Piper Dunn', ['poetry', 'serious', 'humorous', 'entertainment']]],
  'Brightwater High': [['Ivy Marsh', ['info', 'poetry']], ['Dean Rowe', ['persuasive', 'extemp', 'info']], ['Lila Voss', ['poetry']], ['Max Pruitt', ['entertainment']], ['Elle Tran', ['serious', 'persuasive']]],
  'Ashgrove': [['Finn Carter', ['info']], ['Hazel Byrd', ['extemp', 'persuasive']], ['Miles Okoye', ['persuasive', 'info', 'serious']], ['June Salas', ['humorous']], ['Theo Grant', ['entertainment', 'humorous']]],
  'Larkspur High': [['Cara Mills', ['info', 'serious']], ['Wyatt Sims', ['info']], ['Nina Flores', ['serious', 'poetry', 'persuasive']], ['Reid Adler', ['extemp']], ['Skye Ellis', ['poetry', 'entertainment']], ['Beau Lin', ['humorous', 'extemp', 'entertainment']]],
  Thornbury: [['Eden Cole', ['info']], ['Kai Benton', ['persuasive', 'serious']], ['Remy Shaw', ['extemp', 'humorous', 'info']], ['Luz Ortega', ['poetry']], ['Gus Whitman', ['entertainment']]],
  'Fallow Creek': [['Tara Quinn', ['info', 'persuasive']], ['Abel Frost', ['persuasive']], ['Dara Holt', ['serious', 'humorous', 'poetry']], ['Ezra Pike', ['humorous']], ['Wren Abbott', ['poetry', 'serious']]],
};
/** First-year competitors in the sample field. They compete in the novice division of their events. */
const seedNovices = ['Iris Chen', 'Zoe Hart', 'Ruby Lang', 'Jude Park', 'Lila Voss', 'Finn Carter', 'June Salas', 'Wyatt Sims', 'Luz Ortega', 'Eden Cole', 'Ezra Pike', 'Abel Frost', 'Ava Kim', 'Max Pruitt', 'Reid Adler', 'Gus Whitman'];
export const seedEntries: Entry[] = Object.entries(seedTeams).flatMap(([school, students]) => students.flatMap(([student, events]) => events.map(eventId => ({ student, school, eventId, division: (seedNovices.includes(student) ? 'novice' : 'varsity') as Division }))))
  .map((entry, index) => ({ id: `e${index + 1}`, ...entry }));

export const sameSchool = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const sameStudent = (a: Entry, student: string, school: string) => sameSchool(a.school, school) && a.student.trim().toLowerCase() === student.trim().toLowerCase();

/** How many events a student is entered in. Worked out from the entries, so nobody has to mark it by hand. */
export const entryLoad = (entries: Entry[], student: string, school: string) => entries.filter(entry => sameStudent(entry, student, school)).length;
/** Same, when only the name is known (the judge's sample round). */
export const entryLoadByName = (entries: Entry[], student: string) => { const first = entries.find(entry => entry.student.toLowerCase() === student.toLowerCase()); return first ? entryLoad(entries, student, first.school) : 1; };
export const loadLabel = (count: number) => count === 2 ? 'Double entered' : count === 3 ? 'Triple entered' : count >= 4 ? `Entered in ${count} events` : '';

/**
 * Build every round. Each event is split into sections of at most `sectionSize`; speakers are dealt
 * out school by school so teammates are spread across rooms, and the deal shifts each round so
 * speakers meet different opponents. Judges are never given a room with a speaker from their own school.
 */
export function buildSchedule(tournament: Tournament, entries: Entry[], judges: Judge[]): Section[] {
  const sections: Section[] = [];
  const rooms = roomsFor(tournament);
  /** Which speakers each judge has already heard, so later rounds can give speakers different judges. */
  const heard = new Map<string, Set<string>>();
  for (let round = 1; round <= tournament.rounds; round++) {
    const busyJudges = new Set<string>();
    let roomIndex = 0;
    tournament.eventIds.flatMap(eventId => divisions.map(division => ({ eventId, division }))).forEach(({ eventId, division }, contestIndex) => {
      const eventIndex = Math.floor(contestIndex / 2) + contestIndex % 2;
      const field = entries.filter(entry => !entry.waitlisted && entry.eventId === eventId && divisionOf(entry) === division).sort((a, b) => a.school.localeCompare(b.school) || a.student.localeCompare(b.student));
      if (field.length === 0) return;
      const count = Math.ceil(field.length / tournament.sectionSize);
      const groups: Entry[][] = Array.from({ length: count }, () => []);
      field.forEach((entry, index) => groups[(index + (round - 1) * Math.floor(index / count)) % count].push(entry));
      groups.forEach((group, groupIndex) => {
        // Rotate the speaking order so nobody always goes first.
        const shift = (round - 1) % Math.max(group.length, 1);
        const ordered = [...group.slice(shift), ...group.slice(0, shift)];
        const start = (round * 3 + eventIndex * 5 + groupIndex) % Math.max(judges.length, 1);
        const candidates = [...judges.slice(start), ...judges.slice(0, start)];
        // Prefer a judge who hasn't already heard any of these speakers in an earlier round, so every speaker gets fresh ears.
        const free = (candidate: Judge) => !busyJudges.has(candidate.id) && !ordered.some(entry => judgeConflict(candidate, entry.school));
        const judge = candidates.find(candidate => free(candidate) && !ordered.some(entry => heard.get(candidate.id)?.has(entry.id))) ?? candidates.find(free);
        if (judge) ordered.forEach(entry => heard.set(judge.id, (heard.get(judge.id) ?? new Set<string>()).add(entry.id)));
        if (judge) busyJudges.add(judge.id);
        sections.push({
          id: `r${round}-${eventId}${division === 'novice' ? '-novice' : ''}-${groupIndex + 1}`, round, eventId, division,
          label: `${division === 'novice' ? 'Novice · ' : ''}Section ${String.fromCharCode(65 + groupIndex)}`,
          room: roomIndex < rooms.length ? rooms[roomIndex] : `Room needed ${roomIndex - rooms.length + 1}`, judgeId: judge?.id ?? null, entryIds: ordered.map(entry => entry.id),
        });
        roomIndex++;
      });
    });
  }
  return sections;
}

export const roundTimes = ['8:00 AM', '9:30 AM', '11:00 AM', '1:30 PM', '3:00 PM', '4:30 PM'];

/**
 * True for any room after the preliminary rounds: a final, or a semifinal (an elimination round).
 * Finals are stored as the round after the last preliminary round; a contest with semifinals holds
 * them in that round and its final one round later. Use `stageOf` to tell a semifinal from a final.
 */
export const isFinal = (section: Section, tournament: Tournament) => section.round > tournament.rounds;
export const stageOf = (section: Section, tournament: Tournament): SectionStage => section.stage ?? (isFinal(section, tournament) ? 'final' : 'prelim');
export const roundLabel = (section: Section, tournament: Tournament) => { const stage = stageOf(section, tournament); return stage === 'semi' ? 'Semifinal' : stage === 'final' ? 'Final' : `Round ${section.round}`; };

/** How willing a judge is to judge an event. Preferences are only used to choose finals judges. */
export type PrefLevel = 'top' | 'willing' | 'avoid';
/** A judge's events in their order of preference. Events not listed count as "willing". */
export type JudgePrefs = { id: string; level: PrefLevel }[];
const levelRank: Record<PrefLevel, number> = { top: 0, willing: 1, avoid: 2 };
export const preferenceFor = (prefs: JudgePrefs | undefined, eventId: string): PrefLevel => prefs?.find(item => item.id === eventId)?.level ?? 'willing';

/**
 * Why a judge can't sit on an event's final, or '' if they can:
 * they share a school with a finalist, or they judged that event in a preliminary round.
 */
export function finalConflict(judge: Judge, contest: string, finalistSchools: string[], sections: Section[], tournament: Tournament): '' | 'school' | 'knows' | 'prelim' | 'semi' {
  if (!judge.clean && judge.school && finalistSchools.some(school => sameSchool(school, judge.school))) return 'school';
  if (finalistSchools.some(school => judgeConflict(judge, school))) return 'knows';
  // Either division: a judge who heard Novice Informative in prelims doesn't judge the Varsity Informative final either.
  const { eventId } = parseContest(contest);
  if (sections.some(section => !isFinal(section, tournament) && section.eventId === eventId && section.judgeId === judge.id)) return 'prelim';
  // A judge who heard this event's semifinal has already ranked the finalists; the final gets fresh judges.
  if (sections.some(section => stageOf(section, tournament) === 'semi' && section.eventId === eventId && section.judgeId === judge.id)) return 'semi';
  return '';
}

/**
 * One final for an event: the same finalists in the same room, scored separately by each final-round
 * judge. That is one section per judge, so each judge fills in their own ballot.
 *
 * Finals judges are chosen by their preferences: top choices first, "prefer to avoid" last. A judge
 * is never given the final of an event they judged in preliminary rounds, a finalist from their own
 * school, or two finals at once. A seat nobody can fill is left for the director to assign.
 * (With semifinals, some finals are a round later: a judge already on a final at the other time is a last resort.)
 */
export function buildFinal(tournament: Tournament, contest: string, finalistIds: string[], entries: Entry[], judges: Judge[], existing: Section[], preferences: Record<string, JudgePrefs> = {}, pendingContests: string[] = [], round = tournament.rounds + 1): Section[] {
  const { eventId, division } = parseContest(contest);
  const seats = tournament.finalJudges ?? 2;
  const schools = finalistIds.map(id => entries.find(entry => entry.id === id)?.school ?? '');
  const finalsAlready = existing.filter(section => stageOf(section, tournament) === 'final');
  // No judge sits in two rooms at once (a final, or a semifinal held in the same round).
  const busy = new Set(existing.filter(section => section.round === round && isFinal(section, tournament)).map(section => section.judgeId));
  const onAFinal = new Set(finalsAlready.map(section => section.judgeId));
  // A judge who still has a top-choice final to come (one they didn't judge in prelims) is held back for it
  // unless this event is also one of their top choices.
  const wantedElsewhere = (judge: Judge) => pendingContests.some(key => key !== contest && preferenceFor(preferences[judge.id], parseContest(key).eventId) === 'top' && !existing.some(section => !isFinal(section, tournament) && section.eventId === parseContest(key).eventId && section.judgeId === judge.id));
  const order = (judge: Judge) => { const prefs = preferences[judge.id]; const level = preferenceFor(prefs, eventId); const index = prefs?.findIndex(item => item.id === eventId) ?? -1; return levelRank[level] * 1000 + (level !== 'top' && wantedElsewhere(judge) ? 500 : 0) + (index >= 0 ? index : 50); };
  // Among equally keen judges, a clean judge (one who knows none of the competitors) goes first.
  const free = judges.filter(judge => !busy.has(judge.id) && finalConflict(judge, contest, schools, existing, tournament) === '')
    .map((judge, index) => ({ judge, score: order(judge) + (judge.clean ? 0 : 100) + (onAFinal.has(judge.id) ? 10000 : 0), index })).sort((a, b) => a.score - b.score || a.index - b.index).map(item => item.judge);
  const rooms = roomsFor(tournament);
  const room = rooms[(new Set(finalsAlready.map(section => section.room)).size) % rooms.length];
  return Array.from({ length: seats }, (_, seat) => ({
    id: `final-${eventId}${division === 'novice' ? '-novice' : ''}-${seat + 1}`, round, eventId, division, label: `${division === 'novice' ? 'Novice final' : 'Final'} · Judge ${seat + 1}`, room,
    judgeId: free[seat]?.id ?? null, judgeName: free[seat]?.name ?? '', entryIds: [...finalistIds].reverse(),
  }));
}

/** Sample finals preferences for the demo's judges, repeatable from the judge's id. */
export function samplePreferences(judgeId: string, eventIds: string[]): JudgePrefs {
  let hash = 2166136261; for (let i = 0; i < judgeId.length; i++) { hash ^= judgeId.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  const start = (hash >>> 0) % eventIds.length;
  const turned = [...eventIds.slice(start), ...eventIds.slice(0, start)];
  return turned.map((id, index) => ({ id, level: index < 3 ? 'top' as const : index >= turned.length - 2 ? 'avoid' as const : 'willing' as const }));
}

/** Whether a new entry would go on the waitlist: its school or its event is already at the tournament's cap. */
export function overCap(tournament: Tournament, entries: Entry[], school: string, eventId: string, division: Division) {
  const admitted = entries.filter(entry => !entry.waitlisted);
  const schoolFull = tournament.schoolEntryCap != null && admitted.filter(entry => sameSchool(entry.school, school)).length >= tournament.schoolEntryCap;
  const eventFull = tournament.eventEntryCap != null && admitted.filter(entry => entry.eventId === eventId && divisionOf(entry) === division).length >= tournament.eventEntryCap;
  return schoolFull || eventFull;
}
