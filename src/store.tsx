import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from './auth';
import * as api from './tournamentApi';
import { listTournamentResults } from './ballotApi';
import type { Member, MemberRole, MemberStatus, TournamentRow } from './tournamentApi';
import { cutFor, prelimStandings, sampleFinals, samplePrelims, type FinalResult, type PrelimResult } from './results';

/** What one judge's submitted ballot says about one speaker in one room. */
export type RoomResult = { entryId: string; sectionId: string; rank: number; rating: number };
import { buildFinal, buildSchedule, contestOf, defaultTournament, divisionLabel, divisionOf, invoiceFor, isFinal, judgePool, noPayment, roundLabel, samplePreferences, seedEntries, type Division, type Entry, type Issue, type IssueKind, type Judge, type JudgePrefs, type Payment, type PracticeGoal, type ScheduleChange, type Section, type UpdateKind, type Tournament } from './tournament';
import { ballotEvents } from './ballots';
import { buildSemis, finalRoundFor, semiPlanFor, semiProgress } from './semis';
import { sampleSemis } from './results';
import { stageOf, type SemiPlan } from './tournament';
import { enteredJudgeCount, listCoachJudges, seatAsJudge, type CoachJudge } from './judgeLinks';

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
  /** Move one scheduled room somewhere else (a room becomes unavailable). Logged for coaches and judges once published. */
  assignRoom: (sectionId: string, room: string) => void;
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
  /**
   * How many make the final: for one contest, or (contest null) the tournament-wide default.
   * `null` goes back to the default. Kept in the browser, like the other finals settings.
   */
  setCut: (contest: string | null, finalists: number | null) => void;
  /**
   * Move a "next in" speaker into a contest's final, optionally in place of a finalist who withdrew.
   * Only before any final ballot for that contest is in.
   */
  addNextIn: (contest: string, entryId: string, replacing: string | null) => void;
  /** Hold semifinals before a contest's final (a plan), or go straight to the final (null). Only before the semifinals are created. */
  setSemis: (contest: string, plan: SemiPlan | null) => void;
  /** Seed and create a contest's semifinal rooms, with judges chosen like finals judges. */
  createSemis: (contest: string) => void;
  /** Demo: a sample ballot for every semifinal judge who hasn't submitted. */
  fillSampleSemis: (contest: string) => void;
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
  /**
   * Judges coaches entered for their school (judgeLinks.ts): a coach sees their own school's, the director every school's.
   * Approved ones are in `judges`, and a school's count is what its invoice says it brings.
   */
  coachJudges: CoachJudge[]; setCoachJudges: (update: (list: CoachJudge[]) => CoachJudge[]) => void;
  createLiveTournament: (tournament: Tournament) => Promise<void>;
  requestJoin: (tournamentId: string, role: MemberRole, school: string) => Promise<void>;
  decideMember: (member: Member, status: MemberStatus) => Promise<void>;
  refresh: () => Promise<void>;
  speakerPresence: Record<string, Presence | undefined>; setSpeakerPresence: (code: string, p: Presence | undefined) => void;
  judgeCheckedIn: Record<string, boolean>; toggleJudge: (id: string) => void;
  focusNotes: FocusNote[]; sendFocusNote: (text: string, urgent: boolean) => void; markNoteSeen: (id: number) => void;
  /** Practice goals: what a coach asks each student to work on. Saved to the database when signed in. */
  practiceGoals: PracticeGoal[]; addGoal: (goal: { student: string; school: string; eventId: string; text: string }) => void;
  toggleGoal: (id: string) => void; removeGoal: (id: string) => void;
  practiceLog: PracticeNote[]; addPractice: (text: string) => void;
  reminders: { text: boolean; email: boolean }; setReminders: (r: { text: boolean; email: boolean }) => void;
};

const STORAGE_KEY = 'orator-demo-v7';
type Cuts = Pick<Tournament, 'finalists' | 'finalistsByContest'>;
const allEventIds = ballotEvents.map(event => event.id);
/** Judge Leather starts out preferring public-address events and avoiding group interpretation. */
const defaultLeatherPreferences: JudgePrefs = allEventIds.map(id => ({ id, level: ['info', 'persuasive', 'extemp'].includes(id) ? 'top' as const : ['oid', 'duet', 'duo'].includes(id) ? 'avoid' as const : 'willing' as const }))
  .sort((a, b) => ['top', 'willing', 'avoid'].indexOf(a.level) - ['top', 'willing', 'avoid'].indexOf(b.level));
const samplePoolPreferences: Record<string, JudgePrefs> = Object.fromEntries(judgePool.map(judge => [judge.id, samplePreferences(judge.id, allEventIds)]));
const seedSubmitted = ['Kestrel Prep', 'Halden West', 'Brightwater High', 'Ashgrove', 'Larkspur High', 'Thornbury', 'Fallow Creek'];
const seedGoals: PracticeGoal[] = [
  ['Pause after the opening story', 'info', true], ['Name each main point before moving on', 'info', true], ['Cite the date and source for every statistic', 'info', false], ['Hold eye contact through the final sentence', 'persuasive', false],
].map(([text, eventId, done], index) => ({ id: `g${index + 1}`, school: 'Wrenfield High', student: 'Maya Rodriguez', eventId: eventId as string, text: text as string, done: done as boolean, created: 'Oct 14' }))
  .concat([
    { id: 'g5', school: 'Wrenfield High', student: 'Eli Thompson', eventId: 'extemp', text: 'Use the full seven minutes; finish no earlier than 6:30', done: false, created: 'Oct 15' },
    { id: 'g6', school: 'Wrenfield High', student: 'Sam Wilson', eventId: 'poetry', text: 'Let the big moments breathe with a pause', done: false, created: 'Oct 15' },
    { id: 'g7', school: 'Wrenfield High', student: 'Nora Patel', eventId: 'persuasive', text: 'Slow down through transitions so each point lands', done: true, created: 'Oct 10' },
  ]);
const seedIssues: Issue[] = [
  { id: 'i1', kind: 'schedule', where: 'Room 110', detail: 'The door sign says Poetry but the schedule lists Serious Prose here.', reporter: 'Tom Becker', role: 'judge', time: '8:42 AM', status: 'open' },
];
type Saved = { coachJudges?: CoachJudge[]; practiceGoals?: PracticeGoal[]; scheduleChanges?: ScheduleChange[]; myJudgeProfile?: { clean: boolean; knows: string[] }; myPreferences?: JudgePrefs; roomResults?: RoomResult[]; payments?: Record<string, Payment>; tournament: Tournament; entries: Entry[]; submittedSchools: string[]; sections: Section[]; issues: Issue[]; resultsReleased: boolean; prelimResults?: PrelimResult[]; finalResults?: FinalResult[] };
function loadSaved(): Saved | null {
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) as Saved : null; } catch { return null; }
}

/** Sample payment states so the director's list has a realistic mix on first open. */
/** Before the tournament: only how many judges each school says it will bring. Nobody has paid. */
function seedJudges(): Record<string, Payment> {
  const bringing: [string, number][] = [['Kestrel Prep', 2], ['Halden West', 3], ['Brightwater High', 1], ['Larkspur High', 2], ['Ashgrove', 2], ['Fallow Creek', 1]];
  return Object.fromEntries(bringing.map(([school, judgesBringing]) => [school.toLowerCase(), { ...noPayment, judgesBringing }]));
}

/** The demo coach's school has entered one judge, who has already opened their link. Erin Johnson is also in the sample pool. */
const seedCoachJudges: CoachJudge[] = [{ id: 'ej', tournamentId: 'demo', school: 'Wrenfield High', name: 'Erin Johnson', email: 'erin.johnson@example.com', phone: '402-555-0142', clean: false, knows: [], status: 'approved', hasLink: true, revoked: false, claimed: true, createdAt: '2026-10-01', demoToken: 'demo-ej-1' }];
const seedCoachJudgeIds = seedCoachJudges.map(seat => seat.id);

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
  const [practiceGoals, setPracticeGoals] = useState<PracticeGoal[]>(saved?.practiceGoals ?? seedGoals);
  const [scheduleChanges, setScheduleChanges] = useState<ScheduleChange[]>(saved?.scheduleChanges ?? []);
  const [myJudgeProfile, setMyJudgeProfile] = useState(saved?.myJudgeProfile ?? { clean: false, knows: ['Ashgrove'] });
  const [demoCoachJudges, setDemoCoachJudges] = useState<CoachJudge[]>(saved?.coachJudges ?? seedCoachJudges);
  // Keep the setup demo across page reloads.
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ tournament, entries, submittedSchools, sections, issues, resultsReleased, prelimResults, finalResults, payments, roomResults, myPreferences, scheduleChanges, myJudgeProfile, practiceGoals, coachJudges: demoCoachJudges })); } catch { /* private window or storage disabled */ }
  }, [tournament, entries, submittedSchools, sections, issues, resultsReleased, prelimResults, finalResults, payments, roomResults, myPreferences, scheduleChanges, myJudgeProfile, practiceGoals, demoCoachJudges]);
  // A judge link opened in another tab changes the saved demo; pick that up.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) { const next = loadSaved(); if (next?.coachJudges) setDemoCoachJudges(next.coachJudges); } };
    window.addEventListener('storage', onStorage); return () => window.removeEventListener('storage', onStorage);
  }, []);
  const [speakerPresence, setPresence] = useState<Record<string, Presence | undefined>>({ C1: 'present', C2: 'present', C3: 'present' });
  const [judgeCheckedIn, setJudgeCheckedIn] = useState<Record<string, boolean>>({ jl: true, mc: true, dr: true, af: false, ej: true, tb: true, rn: false, kp: true });
  const [focusNotes, setFocusNotes] = useState<FocusNote[]>([
    { id: 1, text: 'Slow down after your opening story. Give the thesis room to land before moving into evidence.', urgent: false, sent: 'Before Round 2', seen: false },
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
  const [liveIssues, setLiveIssues] = useState<Issue[]>([]);
  const [liveGoals, setLiveGoals] = useState<PracticeGoal[]>([]);
  const [liveCoachJudges, setLiveCoachJudges] = useState<CoachJudge[]>([]);
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
      // Practice goals follow the student across tournaments, so they load whatever tournament is showing.
      setLiveGoals(await api.listGoals().catch(() => []));
      if (active) {
        const [entryRows, sectionRows, memberRows] = await Promise.all([api.listEntries(active.id), api.listSections(active.id), api.listMembers(active.id)]);
        setLiveEntries(entryRows); setLiveSections(sectionRows); setMembers(memberRows);
        // Only the director can read every submitted ballot; for everyone else this stays empty.
        setLiveResults(active.directorId === userId ? await listTournamentResults(active.id).catch(() => []) : []);
        setLiveUpdates(await api.listUpdates(active.id).catch(() => []));
        setLiveIssues(await api.listIssues(active.id).catch(() => []));
        setLiveCoachJudges(await listCoachJudges(active.id).catch(() => []));
      } else { setLiveEntries([]); setLiveSections([]); setMembers([]); setLiveResults([]); setLiveUpdates([]); setLiveIssues([]); setLiveCoachJudges([]); }
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
  // Coach-entered judges nobody has signed in as yet are placed by seat; once claimed they are ordinary approved judge rows.
  const liveJudges: Judge[] = [...members.filter(member => member.role === 'judge' && member.status === 'approved').map(member => ({ id: member.userId, name: member.name || 'Judge', school: member.school, clean: member.clean, knows: member.knows })),
    ...liveCoachJudges.filter(seat => seat.status === 'approved' && !seat.claimed).map(seat => seatAsJudge(seat, true))];
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
  const describeRoomMove = (section: Section, room: string, t: Tournament) => `${roundLabel(section, t)} ${ballotEvents.find(event => event.id === section.eventId)?.name ?? section.eventId}${divisionOf(section) === 'novice' ? ` (${divisionLabel.novice})` : ''}, ${section.label.replace('Novice · ', '')}: moved from ${section.room} to ${room}`;
  const describeMove = (section: Section | undefined, judge: Judge | null, t: Tournament) => section ? `${roundLabel(section, t)} ${ballotEvents.find(event => event.id === section.eventId)?.name ?? section.eventId}${divisionOf(section) === 'novice' ? ` (${divisionLabel.novice})` : ''}, ${section.label.replace('Novice · ', '')}, ${section.room}: ${judge ? `now judged by ${judge.name}` : 'judge removed'}` : '';
  const patchLiveTournament = (patch: Partial<Tournament>) => setTournaments(list => list.map(item => item.id === tournamentId ? { ...item, ...patch } : item));

  // In the demo, Judge Leather's conflicts are whatever she has set on her own page.
  const demoJudges = [...judgePool.filter(judge => !seedCoachJudgeIds.includes(judge.id)).map(judge => judge.id === 'jl' ? { ...judge, ...myJudgeProfile, knows: myJudgeProfile.clean ? [] : myJudgeProfile.knows } : judge),
    ...demoCoachJudges.filter(seat => seat.status === 'approved').map(seat => seatAsJudge(seat, false))];
  const coachJudges = live ? liveCoachJudges : demoCoachJudges;
  // The judges a school brings are the ones its coach entered; schools that entered none keep the number they gave.
  const withEnteredJudges = (school: string, payment: Payment): Payment => { const count = enteredJudgeCount(coachJudges, school); return count === null ? (live ? { ...payment, judgesBringing: 0 } : payment) : { ...payment, judgesBringing: count }; };

  const liveStore: Partial<Store> = !live ? {} : {
    tournament: { ...(liveTournament ?? { ...defaultTournament, name: 'No tournament yet', date: '', host: '' }) },
    updateTournament: patch => {
      if (!tournamentId) return;
      patchLiveTournament(patch);
      if (patch.entriesOpen !== undefined && liveTournament) logChange(entriesNote(patch.entriesOpen), liveTournament.status, 'entries');
      if (patch.status && patch.status !== 'finished') setResultsReleased(false);
      api.saveTournament(tournamentId, patch, liveTournament ? { ...liveTournament, ...patch } : patch).catch(caught => { report(caught); refresh(); });
    },
    entries: liveEntries,
    scheduleChanges: liveUpdates,
    issues: liveIssues,
    reportIssue: issue => {
      if (!tournamentId) { setSyncError('Join a tournament first, then report the issue. In an emergency, call 911.'); return; }
      api.reportIssue(tournamentId, issue).then(saved => setLiveIssues(list => [saved, ...list])).catch(report);
    },
    resolveIssue: id => { setLiveIssues(list => list.map(issue => issue.id === id ? { ...issue, status: 'resolved' } : issue)); api.resolveIssue(id).catch(caught => { report(caught); refresh(); }); },
    judgeCheckedIn: Object.fromEntries(members.filter(member => member.role === 'judge').map(member => [member.userId, member.checkedIn])),
    toggleJudge: id => {
      const member = members.find(item => item.role === 'judge' && item.userId === id); if (!member || !tournamentId) return;
      setMembers(list => list.map(item => item === member ? { ...item, checkedIn: !item.checkedIn } : item));
      api.setJudgeCheckedIn(tournamentId, id, !member.checkedIn).catch(caught => { report(caught); refresh(); });
    },
    practiceGoals: liveGoals,
    addGoal: goal => { api.addGoal(goal).then(saved => setLiveGoals(list => [saved, ...list])).catch(report); },
    toggleGoal: id => { const goal = liveGoals.find(item => item.id === id); if (!goal) return; setLiveGoals(list => list.map(item => item.id === id ? { ...item, done: !item.done } : item)); api.setGoalDone(id, !goal.done).catch(caught => { report(caught); refresh(); }); },
    removeGoal: id => { setLiveGoals(list => list.filter(item => item.id !== id)); api.removeGoal(id).catch(caught => { report(caught); refresh(); }); },
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
      api.saveSectionJudge(sectionId, judge, liveSections.find(item => item.id === sectionId)?.judgeId?.startsWith('cj:') ?? false).catch(caught => { report(caught); refresh(); });
    },
    assignRoom: (sectionId, room) => {
      const section = liveSections.find(item => item.id === sectionId); if (!section || section.room === room) return;
      if (liveTournament) logChange(describeRoomMove(section, room, liveTournament), liveTournament.status);
      setLiveSections(list => list.map(item => item.id === sectionId ? { ...item, room } : item));
      api.saveSectionRoom(sectionId, room).catch(caught => { report(caught); refresh(); });
    },
    resetDemo: () => undefined,
    roomResults: liveResults,
    recordRoomResults: () => { refresh(); },
    judgePreferences: Object.fromEntries(members.filter(member => member.role === 'judge').map(member => [member.userId, member.preferences])),
    myPreferences: myMemberships.find(member => member.tournamentId === tournamentId && member.role === 'judge')?.preferences.length ? myMemberships.find(member => member.tournamentId === tournamentId && member.role === 'judge')!.preferences : myPreferences,
    myJudgeProfile: myJudgeRow ? { clean: myJudgeRow.clean, knows: myJudgeRow.knows } : { clean: false, knows: [] },
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
    assignRoom: (sectionId, room) => {
      const section = sections.find(item => item.id === sectionId); if (!section || section.room === room) return;
      logChange(describeRoomMove(section, room, tournament), tournament.status);
      setSections(current => current.map(item => item.id === sectionId ? { ...item, room } : item));
    },
    issues,
    reportIssue: issue => setIssues(current => [{ ...issue, id: `i${Date.now()}`, time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), status: 'open' }, ...current]),
    resolveIssue: id => setIssues(current => current.map(issue => issue.id === id ? { ...issue, status: 'resolved' } : issue)),
    resultsReleased, releaseResults: () => { if (tournament.status === 'finished') setResultsReleased(true); },
    resetDemo: () => { setTournament(defaultTournament); setEntries(seedEntries); setSubmittedSchools(seedSubmitted); setSections([]); setIssues(seedIssues); setResultsReleased(false); setPrelimResults([]); setFinalResults([]); setRoomResults([]); setPayments(seedJudges()); setScheduleChanges([]); setPracticeGoals(seedGoals); setMyJudgeProfile({ clean: false, knows: ['Ashgrove'] }); setDemoCoachJudges(seedCoachJudges); },
    judgePreferences: { ...samplePoolPreferences, jl: myPreferences },
    myPreferences, savePreferences: setMyPreferences,
    roomResults,
    recordRoomResults: (sectionId, rows) => setRoomResults(all => [...all.filter(result => result.sectionId !== sectionId), ...rows.map(row => ({ ...row, sectionId }))]),
    createFinal: () => undefined, createAllFinals: () => undefined, setCut: () => undefined, addNextIn: () => undefined,
    setSemis: () => undefined, createSemis: () => undefined, fillSampleSemis: () => undefined,
    payments,
    paymentFor: school => withEnteredJudges(school, payments[school.trim().toLowerCase()] ?? noPayment),
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
    practiceGoals,
    addGoal: goal => setPracticeGoals(current => [{ ...goal, id: `g${Date.now()}`, done: false, created: new Date().toLocaleDateString([], { month: 'short', day: 'numeric' }) }, ...current]),
    toggleGoal: id => setPracticeGoals(current => current.map(goal => goal.id === id ? { ...goal, done: !goal.done } : goal)),
    removeGoal: id => setPracticeGoals(current => current.filter(goal => goal.id !== id)),
    practiceLog, addPractice: text => setPracticeLog(current => [{ id: Date.now(), date: 'Today · Practice', text }, ...current]),
    reminders, setReminders,
    resultsAreReal: false,
    live, liveState, syncError, clearSyncError: () => setSyncError(''),
    tournamentId: live ? tournamentId : null, isDirector, tournaments, myMemberships, members,
    judges: live ? liveJudges : demoJudges,
    coachJudges, setCoachJudges: update => (live ? setLiveCoachJudges : setDemoCoachJudges)(update),
    createLiveTournament: async tournament => { try { const created = await api.createTournament(tournament); setTournaments(list => [created, ...list]); await refresh(); } catch (caught) { report(caught); } },
    requestJoin: async (id, role, school) => { try { await api.requestToJoin(id, role, school); await refresh(); } catch (caught) { report(caught); } },
    decideMember: async (member, status) => { try { await api.decideMember(member, status); await refresh(); } catch (caught) { report(caught); } },
    refresh,
    ...liveStore,
  };
  // Sample results are worked out from whichever tournament is showing, so they sit after the live overrides.
  // ── Results: ballots judges submitted for a room override sample results for that room. ──
  const sectionOf = new Map(store.sections.map(section => [section.id, section]));
  // Finals only: semifinals are elimination rounds too (after prelims) but are not finals.
  const finalSections = store.sections.filter(section => stageOf(section, store.tournament) === 'final');
  const prelimSections = store.sections.filter(section => !isFinal(section, store.tournament));
  const prelimFromRooms: PrelimResult[] = store.roomResults.filter(result => { const section = sectionOf.get(result.sectionId); return section && !isFinal(section, store.tournament); })
    .map(result => ({ entryId: result.entryId, round: sectionOf.get(result.sectionId)!.round, sectionId: result.sectionId, rank: result.rank, rating: result.rating }));
  const roomsWithBallots = new Set(prelimFromRooms.map(result => result.sectionId));
  const samplePrelimRows = prelimResults.filter(result => sectionOf.has(result.sectionId) && !roomsWithBallots.has(result.sectionId));
  const mergedPrelims = [...samplePrelimRows, ...prelimFromRooms];
  // A final-round judge is identified by their seat: the order of that event's final ballots.
  const finalFromRooms: FinalResult[] = store.roomResults.flatMap(result => {
    const section = sectionOf.get(result.sectionId); if (!section || stageOf(section, store.tournament) !== 'final') return [];
    const seat = finalSections.filter(item => contestOf(item) === contestOf(section)).findIndex(item => item.id === section.id) + 1;
    return [{ entryId: result.entryId, judge: seat, rank: result.rank, rating: result.rating }];
  });
  const contestsWithFinalRooms = new Set(finalSections.map(contestOf));
  const entryContest = new Map(store.entries.map(entry => [entry.id, contestOf(entry)]));
  store.prelimResults = mergedPrelims;
  store.finalResults = [...finalResults.filter(result => !contestsWithFinalRooms.has(entryContest.get(result.entryId) ?? '')), ...finalFromRooms];
  store.resultsAreReal = live && prelimFromRooms.length > 0;
  store.fillSamplePrelims = () => { setPrelimResults(samplePrelims(store.entries, prelimSections)); setFinalResults([]); };
  const standingsOf = (contest: string) => prelimStandings(store.entries.filter(entry => contestOf(entry) === contest), prelimSections.filter(section => contestOf(section) === contest), mergedPrelims, cutFor(store.tournament, contest));
  // Once a final exists, its finalists are whoever is in its room (a next-in speaker may have moved up).
  // With semifinals, the finalists are whoever advanced from the semifinal rooms, once every semifinal ballot is in.
  const semisOf = (contest: string) => semiProgress(store.sections, contest, store.tournament, standingsOf(contest), store.roomResults);
  const finalistsOf = (contest: string) => {
    const room = finalSections.find(section => contestOf(section) === contest);
    const semis = !room && semiPlanFor(store.tournament, contest) ? semisOf(contest) : null;
    return standingsOf(contest).filter(standing => room ? room.entryIds.includes(standing.entryId) : semis ? semis.advancers.includes(standing.entryId) : standing.advances);
  };
  store.fillSampleFinals = contest => {
    const ids = new Set(store.entries.filter(entry => contestOf(entry) === contest).map(entry => entry.id));
    setFinalResults(current => [...current.filter(result => !ids.has(result.entryId)), ...sampleFinals(finalistsOf(contest), store.tournament.finalJudges ?? 2)]);
  };
  const contestsWithEntries = [...new Set(store.entries.filter(entry => store.tournament.eventIds.includes(entry.eventId)).map(contestOf))];
  const awaitingFinal = (sectionsSoFar: Section[]) => contestsWithEntries.filter(key => !sectionsSoFar.some(section => stageOf(section, store.tournament) === 'final' && contestOf(section) === key));
  const planFinal = (contest: string, sectionsSoFar: Section[]) => buildFinal(store.tournament, contest, finalistsOf(contest).map(standing => standing.entryId), store.entries, store.judges, sectionsSoFar, store.judgePreferences, awaitingFinal(sectionsSoFar), finalRoundFor(store.tournament, contest));
  const hasSemis = (contest: string, sectionsSoFar: Section[]) => sectionsSoFar.some(section => stageOf(section, store.tournament) === 'semi' && contestOf(section) === contest);
  const planSemis = (contest: string, sectionsSoFar: Section[]) => { const plan = semiPlanFor(store.tournament, contest); return plan ? buildSemis(store.tournament, contest, standingsOf(contest), store.entries, store.judges, sectionsSoFar, store.judgePreferences, plan) : []; };
  const addFinals = (built: Section[]) => {
    if (built.length === 0) return;
    if (live && tournamentId) api.addSections(tournamentId, built, store.sections.length).then(added => setLiveSections(all => [...all, ...added])).catch(report);
    else setSections(all => [...all, ...built]);
  };
  store.createFinal = contest => {
    if (store.tournament.format === 'prelims') return; // No final round at this tournament.
    if (finalSections.some(section => contestOf(section) === contest)) return;
    const built = planFinal(contest, store.sections);
    if (built.length && built[0].entryIds.length) addFinals(built);
  };
  // A contest is ready for its next round only once every one of its preliminary rooms has results.
  const prelimsDone = (contest: string) => { const own = prelimSections.filter(section => contestOf(section) === contest); return own.length > 0 && own.every(section => mergedPrelims.some(result => result.sectionId === section.id)); };
  store.createAllFinals = () => {
    if (store.tournament.format === 'prelims') return; // No final round at this tournament.
    let soFar = store.sections; const all: Section[] = [];
    const ready = (sectionsSoFar: Section[]) => awaitingFinal(sectionsSoFar).filter(prelimsDone);
    // Semifinals first: they run in the same round as finals of contests without semifinals, and need fewer judges.
    ready(store.sections).filter(contest => semiPlanFor(store.tournament, contest) && !hasSemis(contest, soFar)).forEach(contest => { const built = planSemis(contest, soFar); if (built.length) { all.push(...built); soFar = [...soFar, ...built]; } });
    ready(store.sections).forEach(contest => { if (semiPlanFor(store.tournament, contest) && !hasSemis(contest, store.sections)) return; const built = planFinal(contest, soFar); if (built.length && built[0].entryIds.length) { all.push(...built); soFar = [...soFar, ...built]; } });
    addFinals(all);
  };
  store.createSemis = contest => {
    if (store.tournament.format === 'prelims') return; // No final round at this tournament.
    if (hasSemis(contest, store.sections) || finalSections.some(section => contestOf(section) === contest) || !prelimsDone(contest)) return;
    addFinals(planSemis(contest, store.sections));
  };
  store.setSemis = (contest, plan) => {
    if (hasSemis(contest, store.sections)) return;
    const apply = (current: Pick<Tournament, 'semisByContest'>): Pick<Tournament, 'semisByContest'> => {
      const byContest = { ...current.semisByContest };
      if (plan === null) delete byContest[contest]; else byContest[contest] = plan;
      return { semisByContest: byContest };
    };
    // Saved with the tournament's other settings, like the cut.
    if (live) { if (tournamentId) store.updateTournament(apply(store.tournament)); }
    else setTournament(current => ({ ...current, ...apply(current) }));
  };
  store.fillSampleSemis = contest => {
    const progress = semisOf(contest); const prelim = standingsOf(contest);
    const done = new Set(store.roomResults.map(result => result.sectionId));
    const rows: RoomResult[] = progress.rooms.flatMap(room => sampleSemis(prelim, room.entryIds, room.seats.length, room.room).flatMap(result => {
      const seat = room.seats[result.judge - 1];
      return seat && !done.has(seat.id) ? [{ entryId: result.entryId, sectionId: seat.id, rank: result.rank, rating: result.rating }] : [];
    }));
    // Demo only: in a live tournament semifinal results come from judges' ballots.
    if (!live) setRoomResults(all => [...all, ...rows]);
  };
  store.setCut = (contest, finalists) => {
    const apply = (current: Cuts): Cuts => {
      if (contest === null) return { ...current, finalists: finalists ?? undefined };
      const byContest = { ...current.finalistsByContest };
      if (finalists === null) delete byContest[contest]; else byContest[contest] = finalists;
      return { ...current, finalistsByContest: byContest };
    };
    // Saved with the tournament's other settings (supabase/fixes.sql).
    if (live) { if (tournamentId) store.updateTournament(apply(store.tournament)); }
    else setTournament(current => ({ ...current, ...apply(current) }));
  };
  store.addNextIn = (contest, entryId, replacing) => {
    const rooms = finalSections.filter(section => contestOf(section) === contest);
    if (rooms.length === 0 || rooms.some(room => store.roomResults.some(result => result.sectionId === room.id)) || rooms[0].entryIds.includes(entryId)) return;
    // The next-in speaker takes the withdrawn finalist's speaking slot, or speaks first if added.
    const order = rooms[0].entryIds;
    const next = replacing && order.includes(replacing) ? order.map(id => id === replacing ? entryId : id) : [entryId, ...order];
    const name = (id: string | null) => store.entries.find(entry => entry.id === id)?.student ?? '';
    const event = ballotEvents.find(item => item.id === rooms[0].eventId)?.name ?? rooms[0].eventId;
    logChange(`${event}${divisionOf(rooms[0]) === 'novice' ? ` (${divisionLabel.novice})` : ''} final, ${rooms[0].room}: ${name(entryId)} moves up as next in${replacing ? `, replacing ${name(replacing)}` : ''}`, store.tournament.status);
    const ids = new Set(rooms.map(room => room.id));
    const update = (all: Section[]) => all.map(section => ids.has(section.id) ? { ...section, entryIds: next } : section);
    if (live) { setLiveSections(update); Promise.all(rooms.map(room => api.saveSectionEntries(room.id, next))).catch(caught => { report(caught); refresh(); }); }
    else setSections(update);
  };
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}
