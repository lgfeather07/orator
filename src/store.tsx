import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from './auth';
import * as api from './tournamentApi';
import { listTournamentResults } from './ballotApi';
import type { Member, MemberRole, MemberStatus, TournamentRow } from './tournamentApi';
import { prelimStandings, sampleFinals, samplePrelims, type FinalResult, type PrelimResult } from './results';

/** What one judge's submitted ballot says about one speaker in one room. */
export type RoomResult = { entryId: string; sectionId: string; rank: number; rating: number };
import { buildFinal, buildSchedule, contestOf, defaultTournament, divisionLabel, divisionOf, invoiceFor, isFinal, judgePool, noPayment, roundLabel, samplePreferences, seedEntries, type Division, type Entry, type Issue, type IssueKind, type Judge, type JudgePrefs, type Payment, type ScheduleChange, type Section, type UpdateKind, type Tournament } from './tournament';
import { ballotEvents } from './ballots';

export type Presence = 'present' | 'absent';

export const roundSpeakers = [
  { code: 'C1', name: 'Nora Patel', school: 'Ashgrove', title: '“Small acts, lasting change”' },
  { code: 'C2', name: 'Eli Thompson', school: 'Halden West', title: '“The attention economy”' },
  { code: 'C3', name: 'Sam Wilson', school: 'Brightwater High', title: '“Beyond the final bell”' },
  { code: 'C4', name: 'Maya Rodriguez', school: 'Wrenfield High', title: '“When the well runs dry”' },
  { code: 'C5', name: 'Iris Chen', school: 'Larkspur High', title: '“Designed to disappear”' },
  { code: 'C6', name: 'Leo Brooks', school: 'Kestrel Prep', title: '“The quiet infrastructure”' },
];

/** Judges with the room and event they have in Round 2, for the check-in board. */
export const tournamentJudges = [
  { id: 'jl', name: 'Judge Leather', room: 'Room 214', event: 'Informative', school: 'Community judge' },
  { id: 'mc', name: 'Maria Chen', room: 'Room 108', event: 'Extemp', school: 'Halden West' },
  { id: 'dr', name: 'David Ross', room: 'Room 301', event: 'Poetry', school: 'Brightwater High' },
  { id: 'af', name: 'Alyssa Ford', room: 'Room 122', event: 'Persuasive', school: 'Ashgrove' },
  { id: 'ej', name: 'Erin Johnson', room: 'Room 207', event: 'Humorous', school: 'Wrenfield High' },
  { id: 'tb', name: 'Tom Becker', room: 'Room 110', event: 'Serious', school: 'Community judge' },
  { id: 'rn', name: 'Rosa Nuñez', room: 'Room 215', event: 'Entertainment', school: 'Kestrel Prep' },
  { id: 'kp', name: 'Kyle Pratt', room: 'Room 303', event: 'Informative', school: 'Larkspur High' },
];

export type FocusNote = { id: number; text: string; urgent: boolean; sent: string; seen: boolean };
export type ChecklistItem = { id: number; label: string; done: boolean };
export type PracticeNote = { id: number; date: string; text: string };

type Store = {
  tournament: Tournament; updateTournament: (patch: Partial<Tournament>) => void;
  entries: Entry[]; addEntry: (student: string, school: string, eventId: string, division?: Division) => void; removeEntry: (id: string) => void;
  /** Coaches can add or drop entries only while the director has entries open (and the schedule isn't out yet). */
  entriesOpen: boolean;
  /** Changes the director made to the published schedule, newest first. */
  scheduleChanges: ScheduleChange[];
  /** The signed-in judge's own conflicts: clean (knows no competitors), or the other schools they know. */
  myJudgeProfile: { clean: boolean; knows: string[] }; saveJudgeProfile: (profile: { clean: boolean; knows: string[] }) => void;
  /** Schools whose coach has told the director their entries are final. */
  submittedSchools: string[]; submitSchool: (school: string) => void;
  sections: Section[]; generateSchedule: () => void; assignJudge: (sectionId: string, judgeId: string | null) => void;
  issues: Issue[]; reportIssue: (issue: { kind: IssueKind; where: string; detail: string; reporter: string; role: string }) => void; resolveIssue: (id: string) => void;
  /** Coaches release rankings and comments to their students, and only once the tournament is over. */
  resultsReleased: boolean; releaseResults: () => void;
  /** True when the preliminary results come from judges' submitted ballots rather than sample data. */
  resultsAreReal: boolean;
  /** Round results used to work out breaks, placings, and team points. */
  prelimResults: PrelimResult[]; finalResults: FinalResult[];
  /** Contests are an event in a division: `info` (varsity) or `info:novice`. */
  fillSamplePrelims: () => void; fillSampleFinals: (contest: string) => void; clearResults: () => void;
  /** Results from ballots judges have submitted for scheduled rooms. */
  roomResults: RoomResult[]; recordRoomResults: (sectionId: string, rows: Omit<RoomResult, 'sectionId'>[]) => void;
  /** Each judge's event preferences. They are only used to choose finals judges. */
  judgePreferences: Record<string, JudgePrefs>;
  /** The current judge's own preferences (Judge Leather in the demo). */
  myPreferences: JudgePrefs; savePreferences: (preferences: JudgePrefs) => void;
  /** Set up an event's final round: one ballot per final-round judge for the six finalists. */
  createFinal: (contest: string) => void;
  /** Set up every event's final at once, so each judge can be placed on the final they most want. */
  createAllFinals: () => void;
  /** Simulated fee payments, keyed by school name in lower case. No real money moves. */
  payments: Record<string, Payment>;
  paymentFor: (school: string) => Payment;
  setJudgesBringing: (school: string, count: number) => void;
  recordPayment: (school: string, amount: number, method: 'card' | 'check') => string;
  promiseCheck: (school: string) => void;
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

const STORAGE_KEY = 'orator-demo-v7';
const allEventIds = ballotEvents.map(event => event.id);
/** Judge Leather starts out preferring public-address events and avoiding group interpretation. */
const defaultLeatherPreferences: JudgePrefs = allEventIds.map(id => ({ id, level: ['info', 'persuasive', 'extemp'].includes(id) ? 'top' as const : ['oid', 'duet', 'duo'].includes(id) ? 'avoid' as const : 'willing' as const }))
  .sort((a, b) => ['top', 'willing', 'avoid'].indexOf(a.level) - ['top', 'willing', 'avoid'].indexOf(b.level));
const samplePoolPreferences: Record<string, JudgePrefs> = Object.fromEntries(judgePool.map(judge => [judge.id, samplePreferences(judge.id, allEventIds)]));
const seedSubmitted = ['Kestrel Prep', 'Halden West', 'Brightwater High', 'Ashgrove', 'Larkspur High', 'Thornbury', 'Fallow Creek'];
const seedIssues: Issue[] = [
  { id: 'i1', kind: 'schedule', where: 'Room 110', detail: 'The door sign says Poetry but the schedule lists Serious Prose here.', reporter: 'Tom Becker', role: 'judge', time: '8:42 AM', status: 'open' },
];
type Saved = { scheduleChanges?: ScheduleChange[]; myJudgeProfile?: { clean: boolean; knows: string[] }; myPreferences?: JudgePrefs; roomResults?: RoomResult[]; payments?: Record<string, Payment>; tournament: Tournament; entries: Entry[]; submittedSchools: string[]; sections: Section[]; issues: Issue[]; resultsReleased: boolean; prelimResults?: PrelimResult[]; finalResults?: FinalResult[] };
function loadSaved(): Saved | null {
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) as Saved : null; } catch { return null; }
}

/** Sample payment states so the director's list has a realistic mix on first open. */
/** Before the tournament: only how many judges each school says it will bring. Nobody has paid. */
function seedJudges(): Record<string, Payment> {
  const bringing: [string, number][] = [['Kestrel Prep', 2], ['Halden West', 3], ['Brightwater High', 1], ['Larkspur High', 2], ['Ashgrove', 2], ['Fallow Creek', 1]];
  return Object.fromEntries(bringing.map(([school, judgesBringing]) => [school.toLowerCase(), { ...noPayment, judgesBringing }]));
}

/** What other schools do once their invoice arrives, so the director's list shows a realistic mix in the demo. */
function seedSettlements(current: Record<string, Payment>, tournament: Tournament, entries: Entry[]): Record<string, Payment> {
  const next = { ...current };
  const settle = (school: string, how: 'card' | 'check' | 'promised', reference: string) => {
    const key = school.toLowerCase(); const payment = next[key] ?? noPayment;
    if (payment.paid > 0 || payment.checkPending) return;
    const total = invoiceFor(tournament, entries, school, payment).total;
    next[key] = how === 'promised' ? { ...payment, method: 'check', checkPending: true } : { ...payment, paid: total, method: how, reference, paidAt: new Date().toLocaleDateString([], { month: 'short', day: 'numeric' }) };
  };
  settle('Kestrel Prep', 'card', 'ORA-7K2M4Q'); settle('Halden West', 'card', 'ORA-9D1XTB'); settle('Brightwater High', 'check', 'ORA-3HV8RC'); settle('Larkspur High', 'card', 'ORA-5W6NPA'); settle('Ashgrove', 'promised', '');
  return next;
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
  const [payments, setPayments] = useState<Record<string, Payment>>(() => saved?.payments ?? seedJudges());
  const [roomResults, setRoomResults] = useState<RoomResult[]>(saved?.roomResults ?? []);
  const [myPreferences, setMyPreferences] = useState<JudgePrefs>(saved?.myPreferences ?? defaultLeatherPreferences);
  const [prelimResults, setPrelimResults] = useState<PrelimResult[]>(saved?.prelimResults ?? []);
  const [finalResults, setFinalResults] = useState<FinalResult[]>(saved?.finalResults ?? []);
  const [scheduleChanges, setScheduleChanges] = useState<ScheduleChange[]>(saved?.scheduleChanges ?? []);
  const [myJudgeProfile, setMyJudgeProfile] = useState(saved?.myJudgeProfile ?? { clean: false, knows: ['Ashgrove'] });
  // Keep the setup demo across page reloads.
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ tournament, entries, submittedSchools, sections, issues, resultsReleased, prelimResults, finalResults, payments, roomResults, myPreferences, scheduleChanges, myJudgeProfile })); } catch { /* private window or storage disabled */ }
  }, [tournament, entries, submittedSchools, sections, issues, resultsReleased, prelimResults, finalResults, payments, roomResults, myPreferences, scheduleChanges, myJudgeProfile]);
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
  const [liveResults, setLiveResults] = useState<RoomResult[]>([]);
  const [liveUpdates, setLiveUpdates] = useState<ScheduleChange[]>([]);
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
        // Only the director can read every submitted ballot; for everyone else this stays empty.
        setLiveResults(active.directorId === userId ? await listTournamentResults(active.id).catch(() => []) : []);
        setLiveUpdates(await api.listUpdates(active.id).catch(() => []));
      } else { setLiveEntries([]); setLiveSections([]); setMembers([]); setLiveResults([]); setLiveUpdates([]); }
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
  const liveJudges: Judge[] = members.filter(member => member.role === 'judge' && member.status === 'approved').map(member => ({ id: member.userId, name: member.name || 'Judge', school: member.school, clean: member.clean, knows: member.knows }));
  const myJudgeRow = myMemberships.find(member => member.tournamentId === tournamentId && member.role === 'judge');
  // A note for coaches and judges whenever the director moves something after the schedule is out.
  // Schedule notes only once the schedule is out; entries notes whenever the director opens or closes entries.
  const logChange = (text: string, status: Tournament['status'], kind: UpdateKind = 'schedule') => {
    if (!text || (kind === 'schedule' && status === 'registration')) return;
    const note: ScheduleChange = { id: `c${Date.now()}`, time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), text, kind };
    if (live && tournamentId) { setLiveUpdates(list => [note, ...list]); api.addUpdate(tournamentId, kind, text).catch(report); }
    else setScheduleChanges(list => [note, ...list].slice(0, 30));
  };
  const entriesNote = (open: boolean) => open ? 'The director reopened entries. You can add and drop students again.' : 'The director closed entries. Report an issue if something still needs to change.';
  const describeMove = (section: Section | undefined, judge: Judge | null, t: Tournament) => section ? `${roundLabel(section, t)} ${ballotEvents.find(event => event.id === section.eventId)?.name ?? section.eventId}${divisionOf(section) === 'novice' ? ` (${divisionLabel.novice})` : ''}, ${section.label.replace('Novice · ', '')}, ${section.room}: ${judge ? `now judged by ${judge.name}` : 'judge removed'}` : '';
  const patchLiveTournament = (patch: Partial<Tournament>) => setTournaments(list => list.map(item => item.id === tournamentId ? { ...item, ...patch } : item));

  // In the demo, Judge Leather's conflicts are whatever she has set on her own page.
  const demoJudges = judgePool.map(judge => judge.id === 'jl' ? { ...judge, ...myJudgeProfile, knows: myJudgeProfile.clean ? [] : myJudgeProfile.knows } : judge);

  const liveStore: Partial<Store> = !live ? {} : {
    tournament: liveTournament ?? { ...defaultTournament, name: 'No tournament yet', date: '', host: '' },
    updateTournament: patch => {
      if (!tournamentId) return;
      patchLiveTournament(patch);
      if (patch.entriesOpen !== undefined && liveTournament) logChange(entriesNote(patch.entriesOpen), liveTournament.status, 'entries');
      if (patch.status && patch.status !== 'finished') setResultsReleased(false);
      api.saveTournament(tournamentId, patch).catch(caught => { report(caught); refresh(); });
    },
    entries: liveEntries,
    scheduleChanges: liveUpdates,
    entriesOpen: (liveTournament?.entriesOpen ?? true) && (liveTournament?.status ?? 'registration') === 'registration',
    addEntry: (student, school, eventId, division) => { if (tournamentId) api.insertEntry(tournamentId, student, school, eventId, division ?? 'varsity').then(entry => setLiveEntries(list => [...list, entry])).catch(report); },
    removeEntry: id => { setLiveEntries(list => list.filter(entry => entry.id !== id)); api.deleteEntry(id).catch(caught => { report(caught); refresh(); }); },
    submittedSchools: members.filter(member => member.role === 'coach' && member.entriesSent).map(member => member.school),
    submitSchool: () => { if (tournamentId) api.markEntriesSent(tournamentId, userId).then(refresh).catch(report); },
    // For a signed-in coach, releasing is saved, and the database only allows it once the tournament has ended.
    resultsReleased: myMemberships.some(member => member.tournamentId === tournamentId && member.role === 'coach' && member.resultsReleased),
    releaseResults: () => { if (tournamentId) api.releaseResultsToStudents(tournamentId, userId).then(refresh).catch(report); },
    sections: liveSections,
    generateSchedule: () => {
      if (!tournamentId || !liveTournament) return;
      setPrelimResults([]); setFinalResults([]);
      api.replaceSections(tournamentId, buildSchedule(liveTournament, liveEntries, liveJudges), liveJudges).then(setLiveSections).catch(caught => { report(caught); refresh(); });
    },
    assignJudge: (sectionId, judgeId) => {
      const judge = liveJudges.find(item => item.id === judgeId) ?? null;
      if (liveTournament) logChange(describeMove(liveSections.find(item => item.id === sectionId), judge, liveTournament), liveTournament.status);
      setLiveSections(list => list.map(section => section.id === sectionId ? { ...section, judgeId: judge?.id ?? null, judgeName: judge?.name ?? '' } : section));
      api.saveSectionJudge(sectionId, judge).catch(caught => { report(caught); refresh(); });
    },
    resetDemo: () => undefined,
    roomResults: liveResults,
    recordRoomResults: () => { refresh(); },
    judgePreferences: Object.fromEntries(members.filter(member => member.role === 'judge').map(member => [member.userId, member.preferences])),
    myPreferences: myMemberships.find(member => member.tournamentId === tournamentId && member.role === 'judge')?.preferences.length ? myMemberships.find(member => member.tournamentId === tournamentId && member.role === 'judge')!.preferences : myPreferences,
    myJudgeProfile: myJudgeRow ? { clean: myJudgeRow.clean, knows: myJudgeRow.knows } : myJudgeProfile,
    saveJudgeProfile: profile => {
      setMyJudgeProfile(profile);
      // Show the change straight away; the database copy arrives with the next refresh.
      setMyMemberships(list => list.map(member => member === myJudgeRow ? { ...member, clean: profile.clean, knows: profile.clean ? [] : profile.knows } : member));
      if (tournamentId && myJudgeRow) api.saveJudgeConflicts(tournamentId, userId, profile).then(refresh).catch(report);
    },
    savePreferences: preferences => {
      setMyPreferences(preferences);
      if (tournamentId && myMemberships.some(member => member.tournamentId === tournamentId && member.role === 'judge')) api.saveJudgePreferences(tournamentId, userId, preferences).then(refresh).catch(report);
    },
  };

  const store: Store = {
    fillSamplePrelims: () => undefined, fillSampleFinals: () => undefined,
    tournament,
    updateTournament: patch => {
      // Ending the tournament sends every school its invoice; in the demo, other schools then pay.
      if (patch.status === 'finished') setPayments(all => seedSettlements(all, { ...tournament, ...patch }, entries));
      setTournament(current => ({ ...current, ...patch }));
      if (patch.entriesOpen !== undefined) logChange(entriesNote(patch.entriesOpen), tournament.status, 'entries');
      // Leaving "finished" withdraws the release: students must never see results mid-tournament.
      if (patch.status && patch.status !== 'finished') setResultsReleased(false);
    },
    entries,
    entriesOpen: (tournament.entriesOpen ?? true) && tournament.status === 'registration',
    addEntry: (student, school, eventId, division = 'varsity') => setEntries(current => [...current, { id: `e${Date.now()}`, student, school, eventId, division }]),
    scheduleChanges,
    myJudgeProfile, saveJudgeProfile: setMyJudgeProfile,
    removeEntry: id => { setEntries(current => current.filter(entry => entry.id !== id)); setSections(current => current.map(section => ({ ...section, entryIds: section.entryIds.filter(entryId => entryId !== id) }))); },
    submittedSchools, submitSchool: school => setSubmittedSchools(current => current.includes(school) ? current : [...current, school]),
    sections,
    generateSchedule: () => { setSections(buildSchedule(tournament, entries, demoJudges)); setPrelimResults([]); setFinalResults([]); setRoomResults([]); setScheduleChanges(list => list.filter(change => change.kind === 'entries')); },
    assignJudge: (sectionId, judgeId) => {
      logChange(describeMove(sections.find(item => item.id === sectionId), demoJudges.find(item => item.id === judgeId) ?? null, tournament), tournament.status);
      setSections(current => current.map(section => section.id === sectionId ? { ...section, judgeId } : section));
    },
    issues,
    reportIssue: issue => setIssues(current => [{ ...issue, id: `i${Date.now()}`, time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), status: 'open' }, ...current]),
    resolveIssue: id => setIssues(current => current.map(issue => issue.id === id ? { ...issue, status: 'resolved' } : issue)),
    resultsReleased, releaseResults: () => { if (tournament.status === 'finished') setResultsReleased(true); },
    resetDemo: () => { setTournament(defaultTournament); setEntries(seedEntries); setSubmittedSchools(seedSubmitted); setSections([]); setIssues(seedIssues); setResultsReleased(false); setPrelimResults([]); setFinalResults([]); setRoomResults([]); setPayments(seedJudges()); setScheduleChanges([]); setMyJudgeProfile({ clean: false, knows: ['Ashgrove'] }); },
    judgePreferences: { ...samplePoolPreferences, jl: myPreferences },
    myPreferences, savePreferences: setMyPreferences,
    roomResults,
    recordRoomResults: (sectionId, rows) => setRoomResults(all => [...all.filter(result => result.sectionId !== sectionId), ...rows.map(row => ({ ...row, sectionId }))]),
    createFinal: () => undefined, createAllFinals: () => undefined,
    payments,
    paymentFor: school => payments[school.trim().toLowerCase()] ?? noPayment,
    setJudgesBringing: (school, count) => setPayments(all => ({ ...all, [school.trim().toLowerCase()]: { ...(all[school.trim().toLowerCase()] ?? noPayment), judgesBringing: Math.max(0, count) } })),
    recordPayment: (school, amount, method) => {
      const reference = `ORA-${Date.now().toString(36).toUpperCase().slice(-6)}`;
      setPayments(all => { const key = school.trim().toLowerCase(); const current = all[key] ?? noPayment; return { ...all, [key]: { ...current, paid: current.paid + amount, method, checkPending: false, reference, paidAt: new Date().toLocaleDateString([], { month: 'short', day: 'numeric' }) } }; });
      return reference;
    },
    promiseCheck: school => setPayments(all => ({ ...all, [school.trim().toLowerCase()]: { ...(all[school.trim().toLowerCase()] ?? noPayment), method: 'check', checkPending: true } })),
    prelimResults, finalResults,
    clearResults: () => { setPrelimResults([]); setFinalResults([]); setRoomResults([]); setSections(all => all.filter(section => !isFinal(section, tournament))); },
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
    resultsAreReal: false,
    live, liveState, syncError, clearSyncError: () => setSyncError(''),
    tournamentId: live ? tournamentId : null, isDirector, tournaments, myMemberships, members,
    judges: live ? liveJudges : demoJudges,
    createLiveTournament: async tournament => { try { const created = await api.createTournament(tournament); setTournaments(list => [created, ...list]); await refresh(); } catch (caught) { report(caught); } },
    requestJoin: async (id, role, school) => { try { await api.requestToJoin(id, role, school); await refresh(); } catch (caught) { report(caught); } },
    decideMember: async (member, status) => { try { await api.decideMember(member, status); await refresh(); } catch (caught) { report(caught); } },
    refresh,
    ...liveStore,
  };
  // Sample results are worked out from whichever tournament is showing, so they sit after the live overrides.
  // ── Results: ballots judges submitted for a room override sample results for that room. ──
  const sectionOf = new Map(store.sections.map(section => [section.id, section]));
  const finalSections = store.sections.filter(section => isFinal(section, store.tournament));
  const prelimSections = store.sections.filter(section => !isFinal(section, store.tournament));
  const prelimFromRooms: PrelimResult[] = store.roomResults.filter(result => { const section = sectionOf.get(result.sectionId); return section && !isFinal(section, store.tournament); })
    .map(result => ({ entryId: result.entryId, round: sectionOf.get(result.sectionId)!.round, sectionId: result.sectionId, rank: result.rank, rating: result.rating }));
  const roomsWithBallots = new Set(prelimFromRooms.map(result => result.sectionId));
  const samplePrelimRows = prelimResults.filter(result => sectionOf.has(result.sectionId) && !roomsWithBallots.has(result.sectionId));
  const mergedPrelims = [...samplePrelimRows, ...prelimFromRooms];
  // A final-round judge is identified by their seat: the order of that event's final ballots.
  const finalFromRooms: FinalResult[] = store.roomResults.flatMap(result => {
    const section = sectionOf.get(result.sectionId); if (!section || !isFinal(section, store.tournament)) return [];
    const seat = finalSections.filter(item => contestOf(item) === contestOf(section)).findIndex(item => item.id === section.id) + 1;
    return [{ entryId: result.entryId, judge: seat, rank: result.rank, rating: result.rating }];
  });
  const contestsWithFinalRooms = new Set(finalSections.map(contestOf));
  const entryContest = new Map(store.entries.map(entry => [entry.id, contestOf(entry)]));
  store.prelimResults = mergedPrelims;
  store.finalResults = [...finalResults.filter(result => !contestsWithFinalRooms.has(entryContest.get(result.entryId) ?? '')), ...finalFromRooms];
  store.resultsAreReal = live && prelimFromRooms.length > 0;
  store.fillSamplePrelims = () => { setPrelimResults(samplePrelims(store.entries, prelimSections)); setFinalResults([]); };
  const finalistsOf = (contest: string) => prelimStandings(store.entries.filter(entry => contestOf(entry) === contest), prelimSections.filter(section => contestOf(section) === contest), mergedPrelims).filter(standing => standing.advances);
  store.fillSampleFinals = contest => {
    const ids = new Set(store.entries.filter(entry => contestOf(entry) === contest).map(entry => entry.id));
    setFinalResults(current => [...current.filter(result => !ids.has(result.entryId)), ...sampleFinals(finalistsOf(contest), store.tournament.finalJudges ?? 2)]);
  };
  const contestsWithEntries = [...new Set(store.entries.filter(entry => store.tournament.eventIds.includes(entry.eventId)).map(contestOf))];
  const awaitingFinal = (sectionsSoFar: Section[]) => contestsWithEntries.filter(key => !sectionsSoFar.some(section => isFinal(section, store.tournament) && contestOf(section) === key));
  const planFinal = (contest: string, sectionsSoFar: Section[]) => buildFinal(store.tournament, contest, finalistsOf(contest).map(standing => standing.entryId), store.entries, store.judges, sectionsSoFar, store.judgePreferences, awaitingFinal(sectionsSoFar));
  const addFinals = (built: Section[]) => {
    if (built.length === 0) return;
    if (live && tournamentId) api.addSections(tournamentId, built, store.sections.length).then(added => setLiveSections(all => [...all, ...added])).catch(report);
    else setSections(all => [...all, ...built]);
  };
  store.createFinal = contest => {
    if (finalSections.some(section => contestOf(section) === contest)) return;
    const built = planFinal(contest, store.sections);
    if (built.length && built[0].entryIds.length) addFinals(built);
  };
  store.createAllFinals = () => {
    let soFar = store.sections; const all: Section[] = [];
    awaitingFinal(store.sections).forEach(contest => { const built = planFinal(contest, soFar); if (built.length && built[0].entryIds.length) { all.push(...built); soFar = [...soFar, ...built]; } });
    addFinals(all);
  };
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}
