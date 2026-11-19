import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Badge, Button, Icon, Logo } from './ui';
import { authConfigured, useAuth } from './auth';
import { useStore } from './store';
import { ballotEvents } from './ballots';
import { defaultFees, money, type Tournament } from './tournament';
import { listPublicTournaments, requestToJoin, type PublicTournament } from './tournamentApi';
import './calendar.css';

/**
 * The public tournament calendar, at #/calendar and #/calendar/<tournament id>. Anyone can open it
 * without an account. Signed in, it reads the listed tournaments from the database (only the safe
 * columns supabase/calendar.sql exposes); in the demo it shows fictional sample tournaments.
 */

// ── Route ──────────────────────────────────────────────────────────────────────────────────────
export type CalendarRoute = { id: string | null };
const readRoute = (): CalendarRoute | null => {
  const match = window.location.hash.match(/^#\/?calendar(?:\/([^/?#]+))?\/?$/);
  return match ? { id: match[1] ? decodeURIComponent(match[1]) : null } : null;
};

export function useCalendarRoute(): [CalendarRoute | null, (route: CalendarRoute | null) => void] {
  const [route, setRoute] = useState<CalendarRoute | null>(readRoute);
  useEffect(() => { const sync = () => { setRoute(readRoute()); }; window.addEventListener('hashchange', sync); return () => window.removeEventListener('hashchange', sync); }, []);
  const go = (next: CalendarRoute | null) => {
    if (next) window.location.hash = next.id ? `/calendar/${encodeURIComponent(next.id)}` : '/calendar';
    else history.replaceState(null, '', window.location.pathname + window.location.search);
    setRoute(next); window.scrollTo(0, 0);
  };
  return [route, go];
}

// ── A tournament chosen on the calendar, remembered while the visitor signs up or signs in ──────
// localStorage, not sessionStorage, so it survives opening the confirmation email in a new tab.
const REGISTER_KEY = 'orator-register-tournament';
type Pending = { id: string; name: string; at: number };
export function rememberRegistration(id: string, name: string) { try { localStorage.setItem(REGISTER_KEY, JSON.stringify({ id, name, at: Date.now() })); } catch { /* storage off */ } }
export function clearRegistration() { try { localStorage.removeItem(REGISTER_KEY); } catch { /* storage off */ } }
/** The tournament picked on the calendar in the last two days, or null. */
export function pendingRegistration(): Pending | null {
  try {
    const value = JSON.parse(localStorage.getItem(REGISTER_KEY) ?? 'null') as Pending | null;
    if (!value || typeof value.id !== 'string' || typeof value.at !== 'number' || Date.now() - value.at > 2 * 86400000) return null;
    return { id: value.id, name: typeof value.name === 'string' ? value.name : '', at: value.at };
  } catch { return null; }
}

/** Shown on the sign-in page when the visitor came from "Register your school". */
export function RegistrationNotice() {
  const pending = pendingRegistration();
  if (!pending) return null;
  return <p className="calendar-notice" role="status"><Icon name="info" size={15}/><span>Sign in or create a coach account to register for <strong>{pending.name || 'the tournament you chose'}</strong>. We’ll take you straight to it afterwards.</span></p>;
}

/** After signing in, a coach who chose a tournament on the calendar lands on the coach workspace, where it is preselected. */
export function useRegistrationLanding(signedIn: boolean, roles: string[], open: (page: 'coach') => void) {
  const coach = roles.includes('coach');
  useEffect(() => { if (signedIn && coach && pendingRegistration()) open('coach'); }, [signedIn, coach]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ── Dates ─────────────────────────────────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, '0');
export const todayIso = () => { const now = new Date(); return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`; };
const isoOf = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const fromIso = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const validIso = (iso?: string) => !!iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(fromIso(iso).getTime());
/** "November 21, 2026" or "Nov 21–22, 2026" → "2026-11-21". Older tournaments only have the text date. */
export function isoFromText(text: string): string | undefined {
  const match = text.match(/([A-Za-z]{3,})\.?\s+(\d{1,2})(?:\s*[–-]\s*\d{1,2})?,?\s+(\d{4})/);
  if (!match) return undefined;
  const date = new Date(`${match[1]} ${match[2]}, ${match[3]}`);
  return Number.isNaN(date.getTime()) ? undefined : isoOf(date);
}
export const longDate = (iso: string) => fromIso(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
const weekdayDate = (iso: string) => fromIso(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const monthKey = (iso: string) => iso.slice(0, 7);
const monthLabel = (key: string) => fromIso(`${key}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const calendarDay = (t: PublicTournament) => validIso(t.startDate) ? t.startDate! : isoFromText(t.date);

// ── Status ────────────────────────────────────────────────────────────────────────────────────
type Tone = 'neutral' | 'success' | 'danger' | 'warning' | 'info' | 'pink';
export function calendarStatus(t: PublicTournament, today = todayIso()): { label: string; tone: Tone; open: boolean } {
  const day = calendarDay(t);
  if (t.status === 'finished') return { label: 'Finished', tone: 'neutral', open: false };
  if (t.status === 'running') return { label: 'Underway', tone: 'info', open: false };
  if (t.status === 'scheduled') return { label: 'Schedule published', tone: 'info', open: false };
  if (day && day < today) return { label: 'Date passed', tone: 'neutral', open: false };
  if (!t.entriesOpen) return { label: 'Entries closed', tone: 'warning', open: false };
  if (t.registrationDeadline && t.registrationDeadline < today) return { label: 'Deadline passed', tone: 'warning', open: false };
  return { label: 'Entries open', tone: 'success', open: true };
}
const policy = (t: PublicTournament) => t.autoApproveCoaches ? { label: 'Open registration', tone: 'pink' as Tone, icon: 'users' as const } : { label: 'Approval required', tone: 'neutral' as Tone, icon: 'lock' as const };
const eventName = (id: string) => ballotEvents.find(event => event.id === id)?.name ?? id;
const eventShort = (id: string) => ballotEvents.find(event => event.id === id)?.short ?? id;
const feeSummary = (t: PublicTournament) => {
  const entry = t.entryFee ?? defaultFees.entry, judge = t.judgeFee ?? defaultFees.judge;
  return [`${money(entry)} per entry`, `${money(judge)} per judge not brought`, t.schoolFee ? `${money(t.schoolFee)} per school` : ''].filter(Boolean).join(' · ');
};
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

// ── Demo data: fictional schools only, with dates relative to today so the sample never goes stale ──
const saturdayIn = (weeks: number) => { const date = new Date(); date.setDate(date.getDate() + ((6 - date.getDay() + 7) % 7) + weeks * 7); return isoOf(date); };
const daysBefore = (iso: string, days: number) => { const date = fromIso(iso); date.setDate(date.getDate() - days); return isoOf(date); };
function sample(id: string, name: string, host: string, city: string, weeks: number, extra: Partial<PublicTournament>): PublicTournament {
  const startDate = saturdayIn(weeks);
  return { id, name, host, city, startDate, date: longDate(startDate), registrationDeadline: daysBefore(startDate, 4), notes: '', eventIds: ['info', 'persuasive', 'extemp', 'entertainment', 'poetry', 'serious', 'humorous'], maxEntries: 4, rounds: 3,
    status: weeks < 0 ? 'finished' : 'registration', entriesOpen: true, autoApproveCoaches: false, entryFee: 7, judgeFee: 75, schoolsRegistered: 0, ...extra };
}
function sampleTournaments(): PublicTournament[] {
  return [
    sample('sample-halden', 'Halden West Speech Classic', 'Halden West', 'Kearney', 1, { status: 'scheduled', entriesOpen: false, schoolsRegistered: 11, entryFee: 7.5, notes: 'The schedule is out. Coaches can see their rooms in Orator.' }),
    sample('sample-wrenfield', 'Wrenfield High Novice Classic', 'Wrenfield High', 'Lincoln', 2, { autoApproveCoaches: true, schoolsRegistered: 6, maxEntries: 3, notes: 'Novice and varsity divisions in every event. Concessions open all day; awards at about 4:30.' }),
    sample('sample-kestrel', 'Kestrel Prep Winter Invitational', 'Kestrel Prep', 'Omaha', 4, { schoolsRegistered: 9, entryFee: 8, eventIds: ['info', 'persuasive', 'extemp', 'entertainment', 'poetry', 'serious', 'humorous', 'oid', 'duet'], notes: 'Please bring one judge for every six entries. Parking in the north lot.' }),
    sample('sample-brightwater', 'Brightwater High Invitational', 'Brightwater High', 'Grand Island', 7, { autoApproveCoaches: true, schoolsRegistered: 2, rounds: 2 }),
    sample('sample-thornbury', 'Thornbury Twilight Tournament', 'Thornbury', 'Norfolk', 10, { entriesOpen: false, schoolsRegistered: 14, notes: 'The field is full. Ask the host about the waiting list.' }),
    sample('sample-ashgrove', 'Ashgrove Open', 'Ashgrove', 'Hastings', -2, { schoolsRegistered: 12, autoApproveCoaches: true }),
    sample('sample-fallow', 'Fallow Creek Fall Kickoff', 'Fallow Creek', 'Columbus', -6, { schoolsRegistered: 8 }),
  ];
}
/** The demo's own tournament, as the director has set it up in this browser. */
function demoTournament(t: Tournament, schools: number): PublicTournament {
  const fees = t.fees ?? defaultFees;
  return { id: 'demo', name: t.name, date: t.date, startDate: t.startDate, host: t.host, city: t.city ?? '', registrationDeadline: t.registrationDeadline, notes: t.notes ?? '', eventIds: t.eventIds, maxEntries: t.maxEntries, rounds: t.rounds,
    status: t.status, entriesOpen: t.entriesOpen ?? true, autoApproveCoaches: t.autoApproveCoaches ?? false, entryFee: fees.entry, judgeFee: fees.judge, schoolFee: fees.school, schoolsRegistered: schools };
}

function useCalendarData() {
  const store = useStore();
  const [rows, setRows] = useState<PublicTournament[] | null>(null);
  const [error, setError] = useState('');
  const demoSchools = new Set(store.entries.map(entry => entry.school.trim().toLowerCase())).size;
  useEffect(() => {
    if (!authConfigured) return;
    let active = true;
    listPublicTournaments().then(list => { if (active) setRows(list); }).catch(caught => { if (active) { setError(caught instanceof Error ? caught.message : 'We couldn’t load the calendar.'); setRows([]); } });
    return () => { active = false; };
  }, []);
  const demo = useMemo(() => authConfigured ? null : [...sampleTournaments(), ...((store.tournament.listed ?? true) && !store.live ? [demoTournament(store.tournament, demoSchools)] : [])], [store.tournament, store.live, demoSchools]);
  return { rows: demo ?? rows, error, loading: !demo && rows === null, demo: !authConfigured };
}

// ── Page ──────────────────────────────────────────────────────────────────────────────────────
export type CalendarExit = 'signin' | 'signup' | 'coach' | 'home';

export function CalendarView({ route, go, onExit, dark, setDark }: { route: CalendarRoute; go: (route: CalendarRoute | null) => void; onExit: (target: CalendarExit) => void; dark: boolean; setDark: (dark: boolean) => void }) {
  const { rows, error, loading, demo } = useCalendarData();
  const selected = route.id ? rows?.find(item => item.id === route.id) ?? null : null;
  useEffect(() => { document.title = selected ? `${selected.name} · Orator calendar` : 'Tournament calendar · Orator'; return () => { document.title = 'Orator'; }; }, [selected]);
  return <div className="legal-page calendar-page">
    <header className="calendar-head">
      <a href="#" className="legal-back" onClick={event => { event.preventDefault(); if (route.id) go({ id: null }); else onExit('home'); }}><Icon name="arrow" size={15}/> {route.id ? 'All tournaments' : 'Back to Orator'}</a>
      <Logo/>
      <button type="button" className="calendar-theme" aria-label={dark ? 'Use light mode' : 'Use dark mode'} aria-pressed={dark} onClick={() => setDark(!dark)}><Icon name={dark ? 'sun' : 'moon'} size={16}/></button>
    </header>
    <main id="main" className="calendar-main">
      {demo && <p className="calendar-notice" role="note"><Icon name="info" size={15}/><span><strong>Demo calendar.</strong> These tournaments and schools are fictional. With accounts connected, directors list real tournaments here.</span></p>}
      {loading ? <div className="calendar-loading"><span className="spinner"/><p>Loading the calendar…</p></div>
        : error ? <p className="calendar-error" role="alert"><Icon name="warning" size={15}/> {error}</p>
        : route.id ? (selected ? <CalendarDetail tournament={selected} demo={demo} onExit={onExit}/> : <section className="calendar-missing"><h1>Tournament not found</h1><p>This tournament isn’t on the public calendar. The director may have taken it off, or the link may be wrong.</p><Button icon="arrow" onClick={() => go({ id: null })}>See all tournaments</Button></section>)
        : <CalendarList rows={rows ?? []}/>}
    </main>
  </div>;
}

function CalendarList({ rows }: { rows: PublicTournament[] }) {
  const today = todayIso();
  const [search, setSearch] = useState('');
  const [month, setMonth] = useState('');
  const [city, setCity] = useState('');
  const months = [...new Set(rows.map(calendarDay).filter((day): day is string => !!day).map(monthKey))].sort();
  const cities = [...new Set(rows.map(item => item.city.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const matches = (item: PublicTournament) => {
    const day = calendarDay(item);
    return (!month || (day && monthKey(day) === month)) && (!city || item.city.trim() === city)
      && `${item.name} ${item.host} ${item.city}`.toLowerCase().includes(search.trim().toLowerCase());
  };
  const isPast = (item: PublicTournament) => { const day = calendarDay(item); return item.status === 'finished' || (!!day && day < today); };
  const byDay = (a: PublicTournament, b: PublicTournament) => (calendarDay(a) ?? '9999').localeCompare(calendarDay(b) ?? '9999') || a.name.localeCompare(b.name);
  const recentCutoff = (() => { const date = fromIso(today); date.setDate(date.getDate() - 180); return isoOf(date); })();
  const upcoming = rows.filter(item => !isPast(item) && matches(item)).sort(byDay);
  const past = rows.filter(item => isPast(item) && matches(item) && (calendarDay(item) ?? today) >= recentCutoff).sort((a, b) => byDay(b, a));
  const filtered = !!(search || month || city);
  return <>
    <section className="calendar-intro">
      <span className="eyebrow">Tournament calendar</span>
      <h1>Find a speech tournament</h1>
      <p>Upcoming high school speech tournaments run on Orator. Coaches can register their school straight from a tournament’s page.</p>
    </section>
    <form className="calendar-filters" role="search" aria-label="Filter tournaments" onSubmit={event => event.preventDefault()}>
      <label className="search-box"><Icon name="search"/><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by name, host, or city" aria-label="Search tournaments"/></label>
      <label><span>Month</span><select value={month} onChange={event => setMonth(event.target.value)}><option value="">Any month</option>{months.map(key => <option key={key} value={key}>{monthLabel(key)}</option>)}</select></label>
      <label><span>City</span><select value={city} onChange={event => setCity(event.target.value)}><option value="">Any city</option>{cities.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      {filtered && <button type="button" className="calendar-clear" onClick={() => { setSearch(''); setMonth(''); setCity(''); }}>Clear filters</button>}
    </form>
    <section className="calendar-section" aria-labelledby="calendar-upcoming">
      <h2 id="calendar-upcoming">Upcoming <small>{plural(upcoming.length, 'tournament')}</small></h2>
      {upcoming.length ? <ul className="calendar-list">{upcoming.map(item => <CalendarCard key={item.id} tournament={item} today={today}/>)}</ul>
        : <p className="calendar-empty">{filtered ? 'No upcoming tournaments match these filters.' : 'No upcoming tournaments are listed yet. Check back soon.'}</p>}
    </section>
    {(past.length > 0 || !filtered) && <section className="calendar-section" aria-labelledby="calendar-past">
      <h2 id="calendar-past">Recent tournaments <small>{plural(past.length, 'tournament')}</small></h2>
      {past.length ? <ul className="calendar-list past">{past.map(item => <CalendarCard key={item.id} tournament={item} today={today}/>)}</ul> : <p className="calendar-empty">No recent tournaments yet.</p>}
    </section>}
  </>;
}

function DateBlock({ day }: { day?: string }) {
  if (!day) return <span className="calendar-date tba" aria-hidden="true"><b>TBA</b></span>;
  const date = fromIso(day);
  return <span className="calendar-date" aria-hidden="true"><small>{date.toLocaleDateString('en-US', { month: 'short' })}</small><b>{date.getDate()}</b></span>;
}

function CalendarCard({ tournament: t, today }: { tournament: PublicTournament; today: string }) {
  const day = calendarDay(t);
  const status = calendarStatus(t, today);
  const rule = policy(t);
  return <li>
    <a className="calendar-card" href={`#/calendar/${encodeURIComponent(t.id)}`}>
      <DateBlock day={day}/>
      <span className="calendar-card-body">
        <strong>{t.name}</strong>
        <span className="calendar-card-meta">{[t.date || (day ? longDate(day) : 'Date to be announced'), t.host, t.city].filter(Boolean).join(' · ')}</span>
        <span className="calendar-badges"><Badge tone={status.tone}>{status.label}</Badge>{status.open && <Badge tone={rule.tone} icon={rule.icon}>{rule.label}</Badge>}</span>
        <span className="calendar-card-facts">
          {status.open && t.registrationDeadline && <span><Icon name="clock" size={14}/> Register by {longDate(t.registrationDeadline)}</span>}
          <span><Icon name="ballot" size={14}/> {t.eventIds.length ? t.eventIds.map(eventShort).join(', ') : 'Events to be announced'}</span>
          <span><Icon name="file" size={14}/> {feeSummary(t)}</span>
        </span>
      </span>
      <Icon name="arrow" size={16}/>
    </a>
  </li>;
}

function CalendarDetail({ tournament: t, demo, onExit }: { tournament: PublicTournament; demo: boolean; onExit: (target: CalendarExit) => void }) {
  const day = calendarDay(t);
  const status = calendarStatus(t);
  const rule = policy(t);
  const facts: [string, string][] = [
    ['Date', day ? weekdayDate(day) : t.date || 'To be announced'],
    ['Host', t.host || 'To be announced'],
    ['Location', t.city || 'To be announced'],
    ['Register by', t.registrationDeadline ? longDate(t.registrationDeadline) : 'No deadline set'],
    ['Events per student', `Up to ${plural(t.maxEntries, 'event')}`],
    ['Rounds', `${plural(t.rounds, 'preliminary round')}, then finals`],
    ['Schools registered', t.schoolsRegistered ? plural(t.schoolsRegistered, 'school') : 'None yet'],
  ];
  return <article className="calendar-detail">
    <header>
      <span className="eyebrow">Tournament calendar</span>
      <h1>{t.name}</h1>
      <p className="legal-intro">{[t.date || (day ? longDate(day) : ''), t.host && `hosted by ${t.host}`, t.city].filter(Boolean).join(' · ')}</p>
      <span className="calendar-badges"><Badge tone={status.tone}>{status.label}</Badge><Badge tone={rule.tone} icon={rule.icon}>{rule.label}</Badge></span>
    </header>
    <div className="calendar-detail-grid">
      <div className="calendar-detail-main">
        <dl className="calendar-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        {t.notes.trim() && <section className="calendar-block"><h2>From the host</h2><p className="calendar-notes">{t.notes}</p></section>}
        <section className="calendar-block"><h2>Events offered <small>{t.eventIds.length}</small></h2>
          {t.eventIds.length ? <ul className="calendar-events">{t.eventIds.map(id => <li key={id}>{eventName(id)}</li>)}</ul> : <p>The host hasn’t chosen events yet.</p>}
          <p className="calendar-small">Novice and varsity compete separately in each event. Every event uses the NSAA ballot.</p></section>
        <section className="calendar-block"><h2>Fees</h2><p>{feeSummary(t)}.</p><p className="calendar-small">Schools are invoiced after the tournament for their final entries, so dropped entries aren’t charged. Each school brings one judge for every few entries or pays the judge fee.</p></section>
      </div>
      <RegisterPanel tournament={t} open={status.open} demo={demo} onExit={onExit}/>
    </div>
  </article>;
}

function RegisterPanel({ tournament: t, open, demo, onExit }: { tournament: PublicTournament; open: boolean; demo: boolean; onExit: (target: CalendarExit) => void }) {
  const { profile } = useAuth();
  const store = useStore();
  const [school, setSchool] = useState(profile?.school ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [demoTried, setDemoTried] = useState(false);
  const mine = profile ? store.myMemberships.find(member => member.tournamentId === t.id && member.role === 'coach') : undefined;
  const how = t.autoApproveCoaches
    ? 'Open registration: a coach’s school is approved as soon as they register. Judges and students still need the director’s approval.'
    : 'Approval required: the director approves each school, judge, and student before they get access.';
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await requestToJoin(t.id, 'coach', school.trim()); clearRegistration(); await store.refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Something went wrong. Try again.'); }
    finally { setBusy(false); }
  };
  let body;
  if (!open) body = <p>{t.status === 'finished' ? 'This tournament has finished.' : t.status === 'registration' ? 'Registration is closed. Contact the host school if you still need to enter.' : 'Registration has closed and the schedule is out.'}</p>;
  else if (demo) body = demoTried
    ? <><p className="calendar-notice" role="status"><Icon name="info" size={15}/><span>This is the demo, so nothing was sent. With accounts connected, a signed-in coach registers here in one step, and anyone else is taken to sign up first.</span></p><Button icon="users" onClick={() => onExit('coach')}>Open the coach workspace</Button></>
    : <Button icon="send" onClick={() => setDemoTried(true)}>Register your school</Button>;
  else if (!profile) body = <>
    <p>Sign in or create a free coach account. We’ll bring you back to this tournament to finish.</p>
    <Button icon="send" onClick={() => { rememberRegistration(t.id, t.name); onExit('signup'); }}>Register your school</Button>
    <button type="button" className="calendar-link-button" onClick={() => { rememberRegistration(t.id, t.name); onExit('signin'); }}>I already have an account</button>
  </>;
  else if (mine) body = mine.status === 'approved'
    ? <><p className="calendar-result ok"><Icon name="check" size={16}/><span><strong>{mine.school} is registered.</strong> Add your students from the coach workspace.</span></p><Button icon="arrow" onClick={() => onExit('coach')}>Open the coach workspace</Button></>
    : mine.status === 'pending' ? <p className="calendar-result"><Icon name="clock" size={16}/><span><strong>Request sent for {mine.school}.</strong> The director will approve it; you’ll get access as soon as they do.</span></p>
    : <p className="calendar-result bad"><Icon name="warning" size={16}/><span><strong>The director declined this request.</strong> Contact them if this is a mistake.</span></p>;
  else if (!profile.roles.includes('coach')) body = <>
    <p>Registering a school needs a coach account. Judges and students ask to join from their own workspace, and the director approves them.</p>
    <Button icon="arrow" onClick={() => { rememberRegistration(t.id, t.name); onExit('home'); }}>Ask to join from my workspace</Button>
  </>;
  else body = <form className="calendar-register" onSubmit={submit}>
    <label><span>Your school</span><input value={school} onChange={event => setSchool(event.target.value)} placeholder="e.g. Wrenfield High" autoComplete="organization" required/></label>
    {error && <p className="auth-error" role="alert"><Icon name="warning" size={15}/> {error}</p>}
    <button className="button button-primary" type="submit" disabled={busy || !school.trim()}><Icon name="send"/><span>{busy ? 'Registering…' : 'Register your school'}</span></button>
  </form>;
  return <aside className="calendar-register-panel" aria-labelledby="register-heading">
    <h2 id="register-heading">Register your school</h2>
    <p className="calendar-small">{how}</p>
    {body}
  </aside>;
}

// ── Entry points inside the app ──────────────────────────────────────────────────────────────
/** A quiet link to the calendar, for the coach workspace. */
export function CalendarLink({ text = 'Find more tournaments on the calendar' }: { text?: string }) {
  return <a className="calendar-inline-link" href="#/calendar"><Icon name="clock" size={15}/><span>{text}</span><Icon name="arrow" size={14}/></a>;
}

/** The director's listing settings, on the Details step. */
export function ListingSettings({ editable }: { editable: boolean }) {
  const { tournament, updateTournament, live, tournamentId } = useStore();
  const listed = tournament.listed ?? true;
  const startDate = validIso(tournament.startDate) ? tournament.startDate! : isoFromText(tournament.date) ?? '';
  const fees = tournament.fees ?? defaultFees;
  const link = `#/calendar/${live && tournamentId ? tournamentId : 'demo'}`;
  return <div className="listing-settings">
    <div className="field-label"><span>Public calendar</span><small>{listed ? <a href={link}>See it on the calendar</a> : 'Not listed'}</small></div>
    <label className="check-setting"><input type="checkbox" checked={listed} onChange={event => updateTournament({ listed: event.target.checked })}/><span><strong>List on the public calendar</strong><small>Anyone can find the tournament’s name, date, host, location, events, fees, and deadline at #/calendar, without an account. Entries, names, and results are never shown there.</small></span></label>
    <div className="listing-grid">
      <label><span>Tournament date <small>for sorting</small></span><input type="date" value={startDate} onChange={event => updateTournament({ startDate: event.target.value || undefined, ...(event.target.value ? { date: longDate(event.target.value) } : {}) })}/></label>
      <label><span>City or venue</span><input value={tournament.city ?? ''} maxLength={80} onChange={event => updateTournament({ city: event.target.value })} placeholder="e.g. Lincoln"/></label>
      <label><span>Registration deadline</span><input type="date" value={tournament.registrationDeadline ?? ''} max={startDate || undefined} onChange={event => updateTournament({ registrationDeadline: event.target.value || undefined })}/></label>
      <label className="listing-notes"><span>Notes for coaches <small>optional</small></span><textarea value={tournament.notes ?? ''} maxLength={600} rows={2} onChange={event => updateTournament({ notes: event.target.value })} placeholder="e.g. Bring one judge per six entries. Parking in the north lot."/></label>
    </div>
    <label className="check-setting"><input type="checkbox" checked={tournament.autoApproveCoaches ?? false} disabled={!editable} onChange={event => updateTournament({ autoApproveCoaches: event.target.checked })}/><span><strong>Approve coaches automatically</strong><small>A coach who registers their school gets in straight away, so they can add entries without waiting for you. Judges and students still need your approval. If a second account registers a school that already has a coach, that request waits for you. Shown as “Open registration” on the calendar.</small></span></label>
    <p className="fee-orator"><Icon name="info" size={14}/><span>The calendar also shows the events offered ({tournament.eventIds.length}), up to {plural(tournament.maxEntries, 'event')} per student, and your fees: {money(fees.entry)} per entry, {money(fees.judge)} per judge not brought.</span></p>
  </div>;
}
