import { createContext, useContext, useState, type ReactNode } from 'react';

/** When students may see something from the tournament they are competing in. */
export type Release = 'after-tournament' | 'after-round' | 'coach-release';

export const releaseLabels: Record<Release, { label: string; short: string; detail: string }> = {
  'after-tournament': { label: 'After the tournament ends', short: 'after awards', detail: 'Nothing is shown to students until awards are posted.' },
  'after-round': { label: 'After each round closes', short: 'after each round', detail: 'Students see it as soon as the director locks the round.' },
  'coach-release': { label: 'When their coach releases it', short: 'when your coach releases it', detail: 'Coaches see everything live and decide what to pass on.' },
};

export type Presence = 'present' | 'absent';

export const roundSpeakers = [
  { code: 'C1', name: 'Nora Patel', school: 'Lincoln East', title: '“Small acts, lasting change”' },
  { code: 'C2', name: 'Eli Thompson', school: 'Millard West', title: '“The attention economy”' },
  { code: 'C3', name: 'Sam Wilson', school: 'Norfolk High', title: '“Beyond the final bell”' },
  { code: 'C4', name: 'Maya Rodriguez', school: 'Lincoln High', title: '“When the well runs dry”' },
  { code: 'C5', name: 'Iris Chen', school: 'Gothenburg High', title: '“Designed to disappear”' },
  { code: 'C6', name: 'Leo Brooks', school: 'Creighton Prep', title: '“The quiet infrastructure”' },
];

export const tournamentJudges = [
  { id: 'jl', name: 'Judge Leather', room: 'Room 214', event: 'Informative', school: 'Community judge' },
  { id: 'mc', name: 'Maria Chen', room: 'Room 108', event: 'Extemp', school: 'Millard West' },
  { id: 'dr', name: 'David Ross', room: 'Room 301', event: 'Poetry', school: 'Norfolk High' },
  { id: 'af', name: 'Alyssa Ford', room: 'Room 122', event: 'Persuasive', school: 'Lincoln East' },
  { id: 'ej', name: 'Erin Johnson', room: 'Room 207', event: 'Duet Acting', school: 'Lincoln High' },
  { id: 'tb', name: 'Tom Becker', room: 'Room 110', event: 'Serious Prose', school: 'Community judge' },
  { id: 'rn', name: 'Rosa Nuñez', room: 'Room 215', event: 'Entertainment', school: 'Creighton Prep' },
  { id: 'kp', name: 'Kyle Pratt', room: 'Room 303', event: 'OID', school: 'Gothenburg High' },
];

export type FocusNote = { id: number; text: string; urgent: boolean; sent: string; seen: boolean };
export type ChecklistItem = { id: number; label: string; done: boolean };
export type PracticeNote = { id: number; date: string; text: string };

type Store = {
  rankRelease: Release; setRankRelease: (r: Release) => void;
  commentRelease: Release; setCommentRelease: (r: Release) => void;
  speakerPresence: Record<string, Presence | undefined>; setSpeakerPresence: (code: string, p: Presence | undefined) => void;
  judgeCheckedIn: Record<string, boolean>; toggleJudge: (id: string) => void;
  focusNotes: FocusNote[]; sendFocusNote: (text: string, urgent: boolean) => void; markNoteSeen: (id: number) => void;
  checklist: ChecklistItem[]; toggleChecklist: (id: number) => void; addChecklist: (label: string) => void;
  practiceLog: PracticeNote[]; addPractice: (text: string) => void;
  reminders: { text: boolean; email: boolean }; setReminders: (r: { text: boolean; email: boolean }) => void;
};

const StoreContext = createContext<Store | null>(null);

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside StoreProvider');
  return store;
}

/** Demo state shared across the four role workspaces so a change made as one role shows up in the others. */
export function StoreProvider({ children }: { children: ReactNode }) {
  const [rankRelease, setRankRelease] = useState<Release>('after-tournament');
  const [commentRelease, setCommentRelease] = useState<Release>('after-tournament');
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
    rankRelease, setRankRelease, commentRelease, setCommentRelease,
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
