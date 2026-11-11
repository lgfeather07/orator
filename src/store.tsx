import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from './auth';
import * as api from './tournamentApi';
import type { Member, MemberRole, MemberStatus, TournamentRow } from './tournamentApi';
import { buildSchedule, defaultTournament, judgePool, seedEntries, type Entry, type Issue, type IssueKind, type Judge, type Section, type Tournament } from './tournament';

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
  /** Signed-in users work on a real tournament in the database; the demo keeps everything in the browser. */
  live: boolean;
  liveState: 'idle' | 'loading' | 'ready' | 'failed';
  syncError: string; clearSyncError: () => void;
  tournamentId: string | null; isDirector: boolean;
  tournaments: TournamentRow[]; myMemberships: Member[]; members: Member[];
  judges: Judge[];
  createLiveTournament: (tournament: Tournament) => Promise<void>;
  requestJoin: (tournamentId: string, role: MemberRole, school: string) => Promise<void>;
  decideMember: (member: Member, status: MemberStatus) => Promise<void>;
  refresh: () => Promise<void>;
  speakerPresence: Record<string, Presence | undefined>; setSpeakerPresence: (code: string, p: Presence | undefined) => void;
  judgeCheckedIn: Record<string, boolean>; toggleJudge: (id: string) => void;
  focusNotes: FocusNote[]; sendFocusNote: (text: string, urgent: boolean) => void; markNoteSeen: (id: number) => void;
  checklist: ChecklistItem[]; toggleChecklist: (id: number) => void; addChecklist: (label: string) => void;
  practiceLog: PracticeNote[]; addPractice: (text: string) => void;
  reminders: { text: boolean; email: boolean }; setReminders: (r: { text: boolean; email: boolean }) => void;
};

const STORAGE_KEY = 'orator-demo-v3';
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

  // ── Live mode: the signed-in user's real tournament ──
  const { profile } = useAuth();
  const live = profile !== null;
  const userId = profile?.id ?? '';
  const [liveState, setLiveState] = useState<Store['liveState']>('idle');
  const [syncError, setSyncError] = useState('');
  const [tournaments, setTournaments] = useState<TournamentRow[]>([]);
  const [myMemberships, setMyMemberships] = useState<Member[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [tournamentId, setTournamentId] = useState<string | null>(null);
  const [liveEntries, setLiveEntries] = useState<Entry[]>([]);
  const [liveSections, setLiveSections] = useState<Section[]>([]);
  const report = (caught: unknown) => setSyncError(caught instanceof Error ? caught.message : 'Something went wrong. Try again.');

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      const [all, mine] = await Promise.all([api.listTournaments(), api.listMyMemberships(userId)]);
      // Prefer the tournament this user directs, then one they are approved for, then one they have asked to join.
      const active = all.find(item => item.directorId === userId)
        ?? all.find(item => mine.some(member => member.tournamentId === item.id && member.status === 'approved'))
        ?? all.find(item => mine.some(member => member.tournamentId === item.id));
      setTournaments(all); setMyMemberships(mine); setTournamentId(active?.id ?? null);
      if (active) {
        const [entryRows, sectionRows, memberRows] = await Promise.all([api.listEntries(active.id), api.listSections(active.id), api.listMembers(active.id)]);
        setLiveEntries(entryRows); setLiveSections(sectionRows); setMembers(memberRows);
      } else { setLiveEntries([]); setLiveSections([]); setMembers([]); }
      setLiveState('ready');
    } catch (caught) { report(caught); setLiveState(state => state === 'ready' ? 'ready' : 'failed'); }
  }, [userId]);

  useEffect(() => {
    if (!userId) { setLiveState('idle'); setTournamentId(null); setTournaments([]); setMyMemberships([]); setMembers([]); setLiveEntries([]); setLiveSections([]); return; }
    setLiveState('loading'); refresh();
    // Other people change this data too, so look again whenever the user comes back to the tab.
    const onFocus = () => { refresh(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [userId, refresh]);

  const liveTournament = tournaments.find(item => item.id === tournamentId) ?? null;
  const isDirector = live && liveTournament !== null && liveTournament.directorId === userId;
  const liveJudges: Judge[] = members.filter(member => member.role === 'judge' && member.status === 'approved').map(member => ({ id: member.userId, name: member.name || 'Judge', school: member.school }));
  const patchLiveTournament = (patch: Partial<Tournament>) => setTournaments(list => list.map(item => item.id === tournamentId ? { ...item, ...patch } : item));

  const liveStore: Partial<Store> = !live ? {} : {
    tournament: liveTournament ?? { ...defaultTournament, name: 'No tournament yet', date: '', host: '' },
    updateTournament: patch => {
      if (!tournamentId) return;
      patchLiveTournament(patch);
      if (patch.status && patch.status !== 'finished') setResultsReleased(false);
      api.saveTournament(tournamentId, patch).catch(caught => { report(caught); refresh(); });
    },
    entries: liveEntries,
    addEntry: (student, school, eventId) => { if (tournamentId) api.insertEntry(tournamentId, student, school, eventId).then(entry => setLiveEntries(list => [...list, entry])).catch(report); },
    removeEntry: id => { setLiveEntries(list => list.filter(entry => entry.id !== id)); api.deleteEntry(id).catch(caught => { report(caught); refresh(); }); },
    submittedSchools: members.filter(member => member.role === 'coach' && member.entriesSent).map(member => member.school),
    submitSchool: () => { if (tournamentId) api.markEntriesSent(tournamentId, userId).then(refresh).catch(report); },
    sections: liveSections,
    generateSchedule: () => {
      if (!tournamentId || !liveTournament) return;
      api.replaceSections(tournamentId, buildSchedule(liveTournament, liveEntries, liveJudges), liveJudges).then(setLiveSections).catch(caught => { report(caught); refresh(); });
    },
    assignJudge: (sectionId, judgeId) => {
      const judge = liveJudges.find(item => item.id === judgeId) ?? null;
      setLiveSections(list => list.map(section => section.id === sectionId ? { ...section, judgeId: judge?.id ?? null, judgeName: judge?.name ?? '' } : section));
      api.saveSectionJudge(sectionId, judge).catch(caught => { report(caught); refresh(); });
    },
    resetDemo: () => undefined,
  };

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
    live, liveState, syncError, clearSyncError: () => setSyncError(''),
    tournamentId: live ? tournamentId : null, isDirector, tournaments, myMemberships, members,
    judges: live ? liveJudges : judgePool,
    createLiveTournament: async tournament => { try { const created = await api.createTournament(tournament); setTournaments(list => [created, ...list]); await refresh(); } catch (caught) { report(caught); } },
    requestJoin: async (id, role, school) => { try { await api.requestToJoin(id, role, school); await refresh(); } catch (caught) { report(caught); } },
    decideMember: async (member, status) => { try { await api.decideMember(member, status); await refresh(); } catch (caught) { report(caught); } },
    refresh,
    ...liveStore,
  };
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}
