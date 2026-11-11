/**
 * Demo tournament model: coaches enter students, the director builds the schedule.
 * Everything here lives in the browser (see store.tsx); it is not yet saved to the database.
 */
export type TournamentStatus = 'registration' | 'scheduled' | 'running' | 'finished';

export type Tournament = {
  name: string; date: string; host: string; rounds: number; sectionSize: number;
  /** The most events one student may enter. A student may enter each event once. */
  maxEntries: number;
  eventIds: string[]; status: TournamentStatus;
};

export type Entry = { id: string; student: string; school: string; eventId: string };

export type Judge = { id: string; name: string; school: string };

/** One room in one round: a judge hears these entries, in this speaking order. */
export type Section = { id: string; round: number; eventId: string; label: string; room: string; judgeId: string | null; judgeName?: string; entryIds: string[] };

export type IssueKind = 'no-judge' | 'disruption' | 'injury' | 'schedule' | 'ballot' | 'other';
export type Issue = {
  id: string; kind: IssueKind; where: string; detail: string; reporter: string; role: string;
  time: string; status: 'open' | 'resolved';
};

export const issueKinds: Record<IssueKind, { label: string; hint: string; urgent: boolean }> = {
  'no-judge': { label: 'No judge in the room', hint: 'A round can’t start because the judge hasn’t arrived.', urgent: true },
  injury: { label: 'Injury or medical concern', hint: 'Someone is hurt or unwell.', urgent: true },
  disruption: { label: 'Disruptive behavior', hint: 'Someone is being disruptive or disrespectful during a round.', urgent: false },
  schedule: { label: 'Wrong room or schedule', hint: 'A room, time, or pairing looks wrong.', urgent: false },
  ballot: { label: 'Ballot or scoring problem', hint: 'A ballot won’t save, or a score looks wrong.', urgent: false },
  other: { label: 'Something else', hint: 'Anything the tab room should know.', urgent: false },
};

export const rooms = ['Room 101', 'Room 104', 'Room 108', 'Room 110', 'Room 122', 'Room 207', 'Room 214', 'Room 215', 'Room 301', 'Room 303', 'Library', 'Band room', 'Auditorium', 'Room 118', 'Room 120', 'Room 305', 'Room 307', 'Room 309', 'Cafeteria'];

export const judgePool: Judge[] = [
  { id: 'jl', name: 'Judge Leather', school: '' },
  { id: 'mc', name: 'Maria Chen', school: 'Millard West' },
  { id: 'dr', name: 'David Ross', school: 'Norfolk High' },
  { id: 'af', name: 'Alyssa Ford', school: 'Lincoln East' },
  { id: 'ej', name: 'Erin Johnson', school: 'Lincoln High' },
  { id: 'tb', name: 'Tom Becker', school: '' },
  { id: 'rn', name: 'Rosa Nuñez', school: 'Creighton Prep' },
  { id: 'kp', name: 'Kyle Pratt', school: 'Gothenburg High' },
  { id: 'hw', name: 'Hannah Wolfe', school: 'Aurora' },
  { id: 'bs', name: 'Ben Sato', school: '' },
  { id: 'lm', name: 'Lena Morris', school: 'Minden' },
  { id: 'pg', name: 'Priya Gill', school: '' },
  { id: 'co', name: 'Carl Osei', school: '' },
  { id: 'nw', name: 'Nell Ward', school: 'Bellevue West' },
  { id: 'jh', name: 'Jon Hale', school: '' },
  { id: 'sv', name: 'Sara Vance', school: '' },
  { id: 'mo', name: 'Marcus Odom', school: '' },
  { id: 'ek', name: 'Ellen Kraft', school: '' },
  { id: 'dp', name: 'Dev Patil', school: '' },
  { id: 'rb', name: 'Ruth Baines', school: '' },
];

export const defaultTournament: Tournament = {
  name: 'Gothenburg Invitational', date: 'October 19, 2026', host: 'Gothenburg High School', rounds: 3, sectionSize: 6, maxEntries: 4,
  eventIds: ['info', 'persuasive', 'extemp', 'entertainment', 'poetry', 'serious', 'humorous'], status: 'registration',
};

// A realistic field: most students are in one or two events, many in three, and one in four.
const seedTeams: Record<string, [string, string[]][]> = {
  'Lincoln High': [['Maya Rodriguez', ['info', 'persuasive', 'poetry']], ['Eli Thompson', ['extemp', 'info']], ['Nora Patel', ['persuasive', 'serious', 'extemp']], ['Sam Wilson', ['poetry', 'humorous']], ['Iris Chen', ['serious']]],
  'Creighton Prep': [['Leo Brooks', ['info', 'extemp']], ['Ava Kim', ['persuasive']], ['Noah Reyes', ['humorous', 'entertainment', 'poetry']], ['Zoe Hart', ['extemp']], ['Mila Stone', ['entertainment', 'humorous']]],
  'Millard West': [['Owen Burke', ['info', 'persuasive', 'extemp']], ['Ruby Lang', ['info']], ['Cole Avery', ['extemp', 'entertainment']], ['Tess Nolan', ['serious', 'poetry']], ['Jude Park', ['humorous']], ['Piper Dunn', ['poetry', 'serious', 'humorous', 'entertainment']]],
  'Norfolk High': [['Ivy Marsh', ['info', 'poetry']], ['Dean Rowe', ['persuasive', 'extemp', 'info']], ['Lila Voss', ['poetry']], ['Max Pruitt', ['entertainment']], ['Elle Tran', ['serious', 'persuasive']]],
  'Lincoln East': [['Finn Carter', ['info']], ['Hazel Byrd', ['extemp', 'persuasive']], ['Miles Okoye', ['persuasive', 'info', 'serious']], ['June Salas', ['humorous']], ['Theo Grant', ['entertainment', 'humorous']]],
  'Gothenburg High': [['Cara Mills', ['info', 'serious']], ['Wyatt Sims', ['info']], ['Nina Flores', ['serious', 'poetry', 'persuasive']], ['Reid Adler', ['extemp']], ['Skye Ellis', ['poetry', 'entertainment']], ['Beau Lin', ['humorous', 'extemp', 'entertainment']]],
  Aurora: [['Eden Cole', ['info']], ['Kai Benton', ['persuasive', 'serious']], ['Remy Shaw', ['extemp', 'humorous', 'info']], ['Luz Ortega', ['poetry']], ['Gus Whitman', ['entertainment']]],
  Minden: [['Tara Quinn', ['info', 'persuasive']], ['Abel Frost', ['persuasive']], ['Dara Holt', ['serious', 'humorous', 'poetry']], ['Ezra Pike', ['humorous']], ['Wren Abbott', ['poetry', 'serious']]],
};
export const seedEntries: Entry[] = Object.entries(seedTeams).flatMap(([school, students]) => students.flatMap(([student, events]) => events.map(eventId => ({ student, school, eventId }))))
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
  for (let round = 1; round <= tournament.rounds; round++) {
    const busyJudges = new Set<string>();
    let roomIndex = 0;
    tournament.eventIds.forEach((eventId, eventIndex) => {
      const field = entries.filter(entry => entry.eventId === eventId).sort((a, b) => a.school.localeCompare(b.school) || a.student.localeCompare(b.student));
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
        const judge = candidates.find(candidate => !busyJudges.has(candidate.id) && !ordered.some(entry => candidate.school && sameSchool(entry.school, candidate.school)));
        if (judge) busyJudges.add(judge.id);
        sections.push({
          id: `r${round}-${eventId}-${groupIndex + 1}`, round, eventId, label: count > 1 ? `Section ${String.fromCharCode(65 + groupIndex)}` : 'Section A',
          room: rooms[roomIndex % rooms.length] + (roomIndex >= rooms.length ? ' (overflow)' : ''), judgeId: judge?.id ?? null, entryIds: ordered.map(entry => entry.id),
        });
        roomIndex++;
      });
    });
  }
  return sections;
}

export const roundTimes = ['8:00 AM', '9:30 AM', '11:00 AM', '1:30 PM', '3:00 PM'];
