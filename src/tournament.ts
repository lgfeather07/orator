/**
 * Demo tournament model: coaches enter students, the director builds the schedule.
 * Everything here lives in the browser (see store.tsx); it is not yet saved to the database.
 */
export type TournamentStatus = 'registration' | 'scheduled' | 'running' | 'finished';

export type Tournament = {
  name: string; date: string; host: string; rounds: number; sectionSize: number;
  eventIds: string[]; status: TournamentStatus;
};

export type Entry = { id: string; student: string; school: string; eventId: string };

export type Judge = { id: string; name: string; school: string };

/** One room in one round: a judge hears these entries, in this speaking order. */
export type Section = { id: string; round: number; eventId: string; label: string; room: string; judgeId: string | null; entryIds: string[] };

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

export const rooms = ['Room 101', 'Room 104', 'Room 108', 'Room 110', 'Room 122', 'Room 207', 'Room 214', 'Room 215', 'Room 301', 'Room 303', 'Library', 'Band room', 'Auditorium', 'Room 118'];

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
];

export const defaultTournament: Tournament = {
  name: 'Gothenburg Invitational', date: 'October 19, 2026', host: 'Gothenburg High School', rounds: 3, sectionSize: 6,
  eventIds: ['info', 'persuasive', 'extemp', 'entertainment', 'poetry', 'serious', 'humorous'], status: 'registration',
};

const seedRows: [string, string, string][] = [
  ['Maya Rodriguez', 'Lincoln High', 'info'], ['Eli Thompson', 'Lincoln High', 'extemp'], ['Nora Patel', 'Lincoln High', 'persuasive'], ['Sam Wilson', 'Lincoln High', 'poetry'], ['Iris Chen', 'Lincoln High', 'serious'],
  ['Leo Brooks', 'Creighton Prep', 'info'], ['Ava Kim', 'Creighton Prep', 'persuasive'], ['Noah Reyes', 'Creighton Prep', 'humorous'], ['Zoe Hart', 'Creighton Prep', 'extemp'], ['Mila Stone', 'Creighton Prep', 'entertainment'],
  ['Owen Burke', 'Millard West', 'info'], ['Ruby Lang', 'Millard West', 'info'], ['Cole Avery', 'Millard West', 'extemp'], ['Tess Nolan', 'Millard West', 'serious'], ['Jude Park', 'Millard West', 'humorous'], ['Piper Dunn', 'Millard West', 'poetry'],
  ['Ivy Marsh', 'Norfolk High', 'info'], ['Dean Rowe', 'Norfolk High', 'persuasive'], ['Lila Voss', 'Norfolk High', 'poetry'], ['Max Pruitt', 'Norfolk High', 'entertainment'], ['Elle Tran', 'Norfolk High', 'serious'],
  ['Finn Carter', 'Lincoln East', 'info'], ['Hazel Byrd', 'Lincoln East', 'extemp'], ['Miles Okoye', 'Lincoln East', 'persuasive'], ['June Salas', 'Lincoln East', 'humorous'], ['Theo Grant', 'Lincoln East', 'entertainment'],
  ['Cara Mills', 'Gothenburg High', 'info'], ['Wyatt Sims', 'Gothenburg High', 'info'], ['Nina Flores', 'Gothenburg High', 'serious'], ['Reid Adler', 'Gothenburg High', 'extemp'], ['Skye Ellis', 'Gothenburg High', 'poetry'], ['Beau Lin', 'Gothenburg High', 'humorous'],
  ['Eden Cole', 'Aurora', 'info'], ['Kai Benton', 'Aurora', 'persuasive'], ['Remy Shaw', 'Aurora', 'extemp'], ['Luz Ortega', 'Aurora', 'poetry'], ['Gus Whitman', 'Aurora', 'entertainment'],
  ['Tara Quinn', 'Minden', 'info'], ['Abel Frost', 'Minden', 'persuasive'], ['Dara Holt', 'Minden', 'serious'], ['Ezra Pike', 'Minden', 'humorous'], ['Wren Abbott', 'Minden', 'poetry'],
];
export const seedEntries: Entry[] = seedRows.map(([student, school, eventId], index) => ({ id: `e${index + 1}`, student, school, eventId }));

export const sameSchool = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

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
