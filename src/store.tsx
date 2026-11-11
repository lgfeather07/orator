import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { buildSchedule, defaultTournament, judgePool, seedEntries, type Entry, type Issue, type IssueKind, type Section, type Tournament } from './tournament';

export type Presence = 'present' | 'absent';

export const roundSpeakers = [
  { code: 'C1', name: 'Nora Patel', school: 'Lincoln East', title: '“Small acts, lasting change”' },
  { code: 'C2', name: 'Eli Thompson', school: 'Millard West', title: '“The attention economy”' },
  { code: 'C3', name: 'Sam Wilson', school: 'Norfolk High', title: '“Beyond the final bell”' },
  { code: 'C4', name: 'Maya Rodriguez', school: 'Lincoln High', title: '“When the well runs dry”' },
  { code: 'C5', name: 'Iris Chen', school: 'Gothenburg High', title: '“Designed to disappear”' },
  { code: 'C6', name: 'Leo Brooks', school: 'Creighton Prep', title: '“The quiet infrastructure”' },
];

/** Judges with the room and event they have in Round 2, for the check-in board. */
export const tournamentJudges = [
  { id: 'jl', name: 'Judge Leather', room: 'Room 214', event: 'Informative', school: 'Community judge' },
  { id: 'mc', name: 'Maria Chen', room: 'Room 108', event: 'Extemp', school: 'Millard West' },
  { id: 'dr', name: 'David Ross', room: 'Room 301', event: 'Poetry', school: 'Norfolk High' },
  { id: 'af', name: 'Alyssa Ford', room: 'Room 122', event: 'Persuasive', school: 'Lincoln East' },
  { id: 'ej', name: 'Erin Johnson', room: 'Room 207', event: 'Humorous', school: 'Lincoln High' },
  { id: 'tb', name: 'Tom Becker', room: 'Room 110', event: 'Serious', school: 'Community judge' },
  { id: 'rn', name: 'Rosa Nuñez', room: 'Room 215', event: 'Entertainment', school: 'Creighton Prep' },
  { id: 'kp', name: 'Kyle Pratt', room: 'Room 303', event: 'Informative', school: 'Gothenburg High' },
];

export type FocusNote = { id: number; text: string; urgent: boolean; sent: string; seen: boolean };
export type ChecklistItem = { id: number; label: string; done: boolean };
export type PracticeNote = { id: number; date: string; text: string };

type Store = {
  tournament: Tournament; updateTournament: (patch: Partial<Tournament>) => void;
  entries: Entry[]; addEntry: (student: string, school: string, eventId: string) => void; removeEntry: (id: string) => void;
  /** Schools whose coach has told the director their entries are final. */
  submittedSchools: string[]; submitSchool: (school: string) => void;
  sections: Section[]; generateSchedule: () => void; assignJudge: (sectionId: string, judgeId: string | null) => void;
  issues: Issue[]; reportIssue: (issue: { kind: IssueKind; where: string; detail: string; reporter: string; role: string }) => void; resolveIssue: (id: string) => void;
  /** Coaches release rankings and comments to their students, and only once the tournament is over. */
  resultsReleased: boolean; releaseResults: () => void;
  resetDemo: () => void;
  speakerPresence: Record<string, Presence | undefined>; setSpeakerPresence: (code: string, p: Presence | undefined) => void;
  judgeCheckedIn: Record<string, boolean>; toggleJudge: (id: string) => void;
  focusNotes: FocusNote[]; sendFocusNote: (text: string, urgent: boolean) => void; markNoteSeen: (id: number) => void;
  checklist: ChecklistItem[]; toggleChecklist: (id: number) => void; addChecklist: (label: string) => void;
  practiceLog: PracticeNote[]; addPractice: (text: string) => void;
  reminders: { text: boolean; email: boolean }; setReminders: (r: { text: boolean; email: boolean }) => void;
};

const STORAGE_KEY = 'orator-demo-v1';
const seedSubmitted = ['Creighton Prep', 'Millard West', 'Norfolk High', 'Lincoln East', 'Gothenburg High', 'Aurora', 'Minden'];
const seedIssues: Issue[] = [
  { id: 'i1', kind: 'schedule', where: 'Room 110', detail: 'The door sign says Poetry but the schedule lists Serious Prose here.', reporter: 'Tom Becker', role: 'judge', time: '8:42 AM', status: 'open' },
];
type Saved = { tournament: Tournament; entries: Entry[]; submittedSchools: string[]; sections: Section[]; issues: Issue[]; resultsReleased: boolean };
function loadSaved(): Saved | null {
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) as Saved : null; } catch { return null; }
}

const StoreContext = createContext<Store | null>(null);

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside StoreProvider');
  return store;
}

/** Demo state shared across the four role workspaces so a change made as one role shows up in the others. */
export function StoreProvider({ children }: { children: ReactNode }) {
  const saved = loadSaved();
  const [tournament, setTournament] = useState<Tournament>(saved?.tournament ?? defaultTournament);
  const [entries, setEntries] = useState<Entry[]>(saved?.entries ?? seedEntries);
  const [submittedSchools, setSubmittedSchools] = useState<string[]>(saved?.submittedSchools ?? seedSubmitted);
  const [sections, setSections] = useState<Section[]>(saved?.sections ?? []);
  const [issues, setIssues] = useState<Issue[]>(saved?.issues ?? seedIssues);
  const [resultsReleased, setResultsReleased] = useState<boolean>(saved?.resultsReleased ?? false);
  // Keep the setup demo across page reloads.
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ tournament, entries, submittedSchools, sections, issues, resultsReleased })); } catch { /* private window or storage disabled */ }
  }, [tournament, entries, submittedSchools, sections, issues, resultsReleased]);
  const [speakerPresence, setPresence] = useState<Record<string, Presence | undefined>>({ C1: 'present', C2: 'present', C3: 'present' });
  const [judgeCheckedIn, setJudgeCheckedIn] = useState<Record<string, boolean>>({ jl: true, mc: true, dr: true, af: false, ej: true, tb: true, rn: false, kp: true });
  const [focusNotes, setFocusNotes] = useState<FocusNote[]>([
    { id: 1, text: 'Slow down after your opening story. Give the thesis room to land before moving into evidence.', urgent: false, sent: 'Before Round 2', seen: false },
  ]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([
    { id: 1, label: 'Pause after the opening story', done: true },
    { id: 2, label: 'Name each main point before moving on', done: true },
    { id: 3, label: 'Cite the date and source for every statistic', done: false },
    { id: 4, label: 'Hold eye contact through the final sentence', done: false },
  ]);
  const [practiceLog, setPracticeLog] = useState<PracticeNote[]>([
    { id: 2, date: 'Oct 16 · Practice', text: 'Ran 10:12. Cut the second groundwater example to get back under time.' },
    { id: 1, date: 'Oct 14 · Practice', text: 'Transitions into point two are still rushed. Visual aid timing is much better.' },
  ]);
  const [reminders, setReminders] = useState({ text: true, email: false });

  const store: Store = {
    tournament,
    updateTournament: patch => {
      setTournament(current => ({ ...current, ...patch }));
      // Leaving "finished" withdraws the release: students must never see results mid-tournament.
      if (patch.status && patch.status !== 'finished') setResultsReleased(false);
    },
    entries,
    addEntry: (student, school, eventId) => setEntries(current => [...current, { id: `e${Date.now()}`, student, school, eventId }]),
    removeEntry: id => { setEntries(current => current.filter(entry => entry.id !== id)); setSections(current => current.map(section => ({ ...section, entryIds: section.entryIds.filter(entryId => entryId !== id) }))); },
    submittedSchools, submitSchool: school => setSubmittedSchools(current => current.includes(school) ? current : [...current, school]),
    sections,
    generateSchedule: () => setSections(buildSchedule(tournament, entries, judgePool)),
    assignJudge: (sectionId, judgeId) => setSections(current => current.map(section => section.id === sectionId ? { ...section, judgeId } : section)),
    issues,
    reportIssue: issue => setIssues(current => [{ ...issue, id: `i${Date.now()}`, time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), status: 'open' }, ...current]),
    resolveIssue: id => setIssues(current => current.map(issue => issue.id === id ? { ...issue, status: 'resolved' } : issue)),
    resultsReleased, releaseResults: () => { if (tournament.status === 'finished') setResultsReleased(true); },
    resetDemo: () => { setTournament(defaultTournament); setEntries(seedEntries); setSubmittedSchools(seedSubmitted); setSections([]); setIssues(seedIssues); setResultsReleased(false); },
    speakerPresence, setSpeakerPresence: (code, p) => setPresence(current => ({ ...current, [code]: p })),
    judgeCheckedIn, toggleJudge: id => setJudgeCheckedIn(current => ({ ...current, [id]: !current[id] })),
    focusNotes,
    sendFocusNote: (text, urgent) => setFocusNotes(current => [{ id: Date.now(), text, urgent, sent: 'Just now', seen: false }, ...current]),
    markNoteSeen: id => setFocusNotes(current => current.map(note => note.id === id ? { ...note, seen: true } : note)),
    checklist,
    toggleChecklist: id => setChecklist(current => current.map(item => item.id === id ? { ...item, done: !item.done } : item)),
    addChecklist: label => setChecklist(current => [...current, { id: Date.now(), label, done: false }]),
    practiceLog, addPractice: text => setPracticeLog(current => [{ id: Date.now(), date: 'Today · Practice', text }, ...current]),
    reminders, setReminders,
  };
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}
