import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Badge, Button, Icon } from './ui';
import { useStore } from './store';
import { useAuth } from './auth';
import { buildSchedule, isFinal } from './tournament';
import {
  SMS_CONSENT, alertKinds, defaultAlertSettings, demoPeople, entriesMessage, formatPhone, judgeRoomMessage, maskPhone, normalizePhone, roundAlerts, studentRoomMessage,
  type AlertKind, type AlertRole, type AlertSettings, type PlannedAlert,
} from './alerts';
import { listMyAlerts, listTournamentAlerts, loadAlertSummary, loadMyAlertSettings, queueRoundAlerts, saveMyAlertSettings, type AlertRow, type AlertSummary, type RoundAlertResult } from './alertsApi';
import './alerts.css';

const message = (caught: unknown) => caught instanceof Error ? caught.message : 'Something went wrong. Try again.';
const timeOf = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
const statusTone = { queued: 'info', sending: 'info', sent: 'success', failed: 'danger' } as const;
const statusLabel = { queued: 'Waiting to send', sending: 'Sending', sent: 'Sent', failed: 'Not sent' } as const;
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

// ── Demo settings stay in this browser, one set per workspace.
const demoKey = (role: AlertRole) => `orator-demo-alerts-${role}`;
const demoEmail: Record<AlertRole, string> = { student: 'maya.rodriguez@example.com', judge: 'judge.leather@example.com', coach: 'erin.johnson@example.com' };
function loadDemo(role: AlertRole): AlertSettings | null {
  try { const raw = localStorage.getItem(demoKey(role)); return raw ? { ...defaultAlertSettings, ...JSON.parse(raw) as AlertSettings } : null; } catch { return null; }
}
function saveDemo(role: AlertRole, settings: AlertSettings) { try { localStorage.setItem(demoKey(role), JSON.stringify(settings)); } catch { /* storage off */ } }

/** An example of what this person would get, so they know what they're signing up for. */
function exampleFor(role: AlertRole) {
  const section = { round: 2, eventId: 'info', division: 'varsity' as const, room: 'Room 104' };
  return role === 'student' ? studentRoomMessage(section, 3, 3) : role === 'judge' ? judgeRoomMessage({ ...section, eventId: 'poetry', room: 'Room 108' }, 3) : entriesMessage({ name: 'Larkspur Invitational' }, false);
}

/**
 * Text and email alerts for one person: their phone number and consent, email, and which alerts they want.
 * Signed in, it's saved to their account; in the demo, to this browser.
 */
export function AlertSettingsPanel({ role }: { role: AlertRole }) {
  const { live } = useStore();
  const { profile } = useAuth();
  const id = useId();
  const [settings, setSettings] = useState<AlertSettings | null>(live ? null : loadDemo(role) ?? defaultAlertSettings);
  const [phoneText, setPhoneText] = useState(settings?.phone ? formatPhone(settings.phone) : '');
  const [phoneError, setPhoneError] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');
  const [recent, setRecent] = useState<AlertRow[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const userId = profile?.id ?? '';
  const email = live ? profile?.email ?? '' : demoEmail[role];

  useEffect(() => {
    if (!live || !userId) return;
    let active = true;
    loadMyAlertSettings(userId).then(found => { if (!active) return; const value = found ?? defaultAlertSettings; setSettings(value); setPhoneText(value.phone ? formatPhone(value.phone) : ''); })
      .catch(caught => { if (active) { setSettings(defaultAlertSettings); setError(message(caught)); setState('error'); } });
    listMyAlerts(userId).then(rows => active && setRecent(rows)).catch(() => active && setRecent([]));
    return () => { active = false; };
  }, [live, userId]);

  if (!settings) return <section className="panel al-panel"><p className="al-empty" role="status"><span className="spinner"/> Loading your alert settings…</p></section>;
  const change = (patch: Partial<AlertSettings>) => { setSettings({ ...settings, ...patch }); setDirty(true); setState('idle'); };
  const kinds = alertKinds.filter(item => item.roles.includes(role));
  const anyChannel = settings.smsOptIn || settings.emailOptIn;

  const save = async () => {
    const parsed = normalizePhone(phoneText);
    if (parsed.error) { setPhoneError(parsed.error); return; }
    if (settings.smsOptIn && !parsed.phone) { setPhoneError('Add your mobile number to get texts, or switch texts off.'); return; }
    setPhoneError('');
    const next = { ...settings, phone: parsed.phone };
    setSettings(next); setPhoneText(parsed.phone ? formatPhone(parsed.phone) : '');
    if (!live) { saveDemo(role, next); setState('saved'); setDirty(false); return; }
    setState('saving');
    try { await saveMyAlertSettings(userId, next, SMS_CONSENT); setState('saved'); setDirty(false); }
    catch (caught) { setError(message(caught)); setState('error'); }
  };

  return <section className="panel al-panel" aria-labelledby={`${id}-title`}>
    <div className="panel-head"><div><h2 id={`${id}-title`}>Text and email alerts</h2><p>{role === 'student' ? 'Your room and speaking order before each round, without opening Orator.' : role === 'judge' ? 'Your room and ballot link as soon as you’re assigned.' : 'Hear when the director closes or reopens entries, or publishes the schedule.'}</p></div>
      <Badge tone={anyChannel ? 'success' : 'neutral'} icon={anyChannel ? 'bell' : undefined}>{anyChannel ? [settings.smsOptIn && 'Texts on', settings.emailOptIn && 'Email on'].filter(Boolean).join(' · ') : 'Alerts off'}</Badge></div>
    <div className="al-body">
      <fieldset className="al-group">
        <legend>How to reach you</legend>
        <label className="al-check"><input type="checkbox" checked={settings.emailOptIn} disabled={!email} onChange={event => change({ emailOptIn: event.target.checked })}/>
          <span><strong>Email me</strong><small>{email ? <>At {email}, the email on your account.</> : 'Your account has no email address.'}</small></span></label>
        <div className={`al-sms ${settings.smsOptIn ? 'on' : ''}`}>
          <label className="al-phone" htmlFor={`${id}-phone`}><span>Mobile number</span>
            <input id={`${id}-phone`} type="tel" inputMode="tel" autoComplete="tel-national" placeholder="(402) 555-0123" value={phoneText} aria-invalid={phoneError ? true : undefined} aria-describedby={`${id}-phone-help`}
              onChange={event => { setPhoneText(event.target.value); setPhoneError(''); setDirty(true); setState('idle'); }}
              onBlur={() => { const parsed = normalizePhone(phoneText); if (parsed.error) setPhoneError(parsed.error); else if (parsed.phone) setPhoneText(formatPhone(parsed.phone)); }}/></label>
          <small id={`${id}-phone-help`} className={phoneError ? 'al-error' : ''}>{phoneError || 'US numbers only. We use it for these alerts and nothing else.'}</small>
          <label className="al-check al-consent"><input type="checkbox" checked={settings.smsOptIn} onChange={event => change({ smsOptIn: event.target.checked })}/>
            <span><strong>Text me</strong><small>{SMS_CONSENT}</small></span></label>
          {role === 'student' && <p className="al-minor"><Icon name="info" size={14}/><span>Under 13? Don’t enter a phone number. Use email, or check Orator on the day.</span></p>}
        </div>
      </fieldset>
      <fieldset className="al-group">
        <legend>What to send</legend>
        {kinds.map(item => <label className="al-check" key={item.kind}><input type="checkbox" checked={settings[item.kind]} onChange={event => change({ [item.kind]: event.target.checked } as Partial<Record<AlertKind, boolean>>)}/>
          <span><strong>{item.label}</strong><small>{item.detail}</small></span></label>)}
        <div className="al-example"><small>Example</small><p>{exampleFor(role)}</p></div>
      </fieldset>
    </div>
    <div className="al-foot">
      <p><Icon name="bell" size={14}/><span>{anyChannel ? 'Updates also show in Orator itself.' : 'Alerts are off. You’ll still see every update in Orator.'}{!live && ' Demo: saved in this browser, and nothing is sent.'}</span></p>
      <span className="al-save" role="status">{state === 'saved' ? <Badge tone="success" icon="check">Saved</Badge> : state === 'error' ? <span className="al-error">{error}</span> : null}</span>
      <Button icon="check" disabled={state === 'saving' || (!dirty && state !== 'error')} onClick={save}>{state === 'saving' ? 'Saving…' : 'Save alert settings'}</Button>
    </div>
    {live && recent && recent.length > 0 && <div className="al-recent"><h3>Recent alerts to you</h3><ul>{recent.map(row => <li key={row.id}><span><Icon name={row.channel === 'sms' ? 'comment' : 'send'} size={14}/>{row.channel === 'sms' ? 'Text' : 'Email'} · {timeOf(row.createdAt)}</span><p>{row.message}</p><Badge tone={statusTone[row.status]}>{statusLabel[row.status]}</Badge></li>)}</ul></div>}
  </section>;
}

/** Rounds that have rooms: each prelim round, then finals (stored as the round after the last prelim). */
function useRounds() {
  const { tournament, sections } = useStore();
  return useMemo(() => {
    const prelims = Array.from({ length: tournament.rounds }, (_, index) => index + 1);
    const finals = sections.some(section => isFinal(section, tournament)) ? [tournament.rounds + 1] : [];
    return [...prelims, ...finals].map(round => ({ round, label: round > tournament.rounds ? 'finals' : `Round ${round}`, rooms: sections.filter(section => section.round === round).length }));
  }, [tournament, sections]);
}

/**
 * "Send room alerts for Round N". Signed in, it queues the alerts in the database; in the demo it shows exactly
 * what would go out. Rounds have no start button, so the director sends them when the round is about to begin.
 */
function RoundButtons({ onSent, selected, compact = false }: { onSent: (round: number, result: RoundAlertResult | null) => void; selected?: number; compact?: boolean }) {
  const { live, tournament, tournamentId } = useStore();
  const rounds = useRounds();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const published = tournament.status === 'scheduled' || tournament.status === 'running';
  const send = async (round: number) => {
    setError('');
    if (!live) { onSent(round, null); return; }
    if (!tournamentId) return;
    setBusy(round);
    try { onSent(round, await queueRoundAlerts(tournamentId, round)); } catch (caught) { setError(message(caught)); } finally { setBusy(null); }
  };
  return <div className={`al-rounds ${compact ? 'compact' : ''}`}>
    <div className="al-round-buttons">{rounds.map(item => <Button key={item.round} variant={selected === item.round ? 'primary' : 'secondary'} icon="send" disabled={busy !== null || (live && (!published || item.rooms === 0))} onClick={() => send(item.round)}>
      {busy === item.round ? 'Queueing…' : `${live ? 'Send' : 'Preview'} room alerts for ${item.label}`}</Button>)}</div>
    {live && !published && <small className="al-hint">Publish the schedule first. Then send each round’s alerts just before it starts.</small>}
    {error && <p className="al-error" role="alert">{error}</p>}
  </div>;
}

/** The compact version for the director's "Review and run" step. */
export function RoundAlertsCard({ onOpenAlerts }: { onOpenAlerts?: () => void }) {
  const { live } = useStore();
  const [note, setNote] = useState('');
  return <div className="visibility al-card">
    <div className="visibility-head"><span className="eyebrow">TEXT AND EMAIL ALERTS</span><h3>Send each round’s rooms before it starts</h3><p>Students who opted in get their room, time, and speaking order; judges get their room and a ballot link. Publishing the schedule, swapping a judge, and opening or closing entries send alerts on their own. Everyone also sees updates in Orator.</p></div>
    <RoundButtons compact onSent={(round, result) => setNote(result ? `${result.queued ? `Queued ${plural(result.queued, 'alert')}` : 'Nothing new to send'}${result.alreadyQueued ? ` (${result.alreadyQueued} already sent earlier)` : ''}.` : `Demo: the Alerts tab shows what Round ${round} would send.`)}/>
    <p className="visibility-note" role="status">{note && <><Icon name="check" size={14}/> {note} </>}{onOpenAlerts ? <button className="al-link" onClick={onOpenAlerts}>{live ? 'See delivery on the Alerts tab' : 'Open the Alerts tab'}</button> : <span>{live ? 'Delivery and opt-ins are on the Alerts tab.' : 'The Alerts tab previews every message.'}</span>}</p>
  </div>;
}

/** The director's Alerts tab: send round alerts, see what's queued, sent and failed, and how many opted in. */
export function DirectorAlerts() {
  const { live } = useStore();
  return live ? <LiveDirectorAlerts/> : <DemoDirectorAlerts/>;
}

function AutomaticAlerts() {
  return <section className="panel al-auto"><div className="panel-head"><div><h2>Sent on their own</h2><p>Nobody types these. Orator writes each one from the schedule.</p></div></div>
    <ul>
      <li><Icon name="clock"/><span><strong>Publishing the schedule</strong><small>Everyone who wants schedule alerts. Also shown in Orator.</small></span></li>
      <li><Icon name="ballot"/><span><strong>Swapping a judge after publishing</strong><small>The new judge gets their room and ballot link; the old judge hears they’re off it. Also shown in Orator.</small></span></li>
      <li><Icon name="users"/><span><strong>Closing or reopening entries</strong><small>Coaches who want entries alerts. Also shown in Orator.</small></span></li>
    </ul>
  </section>;
}

function LiveDirectorAlerts() {
  const { tournament, tournamentId, refresh } = useStore();
  const [summary, setSummary] = useState<AlertSummary | null>(null);
  const [recent, setRecent] = useState<AlertRow[]>([]);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const load = useCallback(async () => {
    if (!tournamentId) return;
    try { const [counts, rows] = await Promise.all([loadAlertSummary(tournamentId), listTournamentAlerts(tournamentId)]); setSummary(counts); setRecent(rows); setError(''); }
    catch (caught) { setError(message(caught)); }
  }, [tournamentId]);
  useEffect(() => { load(); }, [load]);
  const waitingMinutes = summary?.oldestQueued ? (Date.now() - new Date(summary.oldestQueued).getTime()) / 60000 : 0;
  return <div className="al-director">
    <section className="panel al-send"><div className="panel-head"><div><h2>Room alerts</h2><p>Rounds have no start button. Send each round’s alerts just before it begins.</p></div><Button variant="secondary" icon="clock" onClick={load}>Refresh</Button></div>
      <RoundButtons onSent={(round, sent) => { if (sent) setResult(`${round > tournament.rounds ? 'Finals' : `Round ${round}`}: ${sent.queued ? `queued ${plural(sent.queued, 'alert')}` : 'nothing new to send'} for ${plural(sent.students, 'student')} and ${plural(sent.judges, 'judge')} in ${plural(sent.rooms, 'room')}.${sent.alreadyQueued ? ` ${plural(sent.alreadyQueued, 'alert')} ${sent.alreadyQueued === 1 ? 'was' : 'were'} already sent or queued and ${sent.alreadyQueued === 1 ? 'isn’t' : 'aren’t'} repeated.` : ''}${sent.unmatched ? ` ${plural(sent.unmatched, 'speaker')} ${sent.unmatched === 1 ? 'has' : 'have'} no Orator account, so ${sent.unmatched === 1 ? 'sees' : 'see'} it only on the schedule.` : ''}`); load(); refresh(); }}/>
      {result && <p className="al-result" role="status"><Icon name="check" size={15}/> {result}</p>}
      {error && <p className="al-error al-pad" role="alert">{error}</p>}
    </section>
    {summary && <>
      <div className="al-counts">
        {([['Waiting', summary.queued + summary.sending, 'info'], ['Sent', summary.sent, 'success'], ['Not sent', summary.failed, 'danger']] as const).map(([label, count, tone]) => <div key={label} className={`al-count ${tone}`}><small>{label}</small><strong>{count}</strong></div>)}
        <div className="al-count"><small>Opted in</small><strong>{summary.optedIn}</strong><span>of {plural(summary.members, 'member')} · {summary.textOptIns} by text, {summary.emailOptIns} by email</span></div>
      </div>
      <p className="al-optins">Opted in by role: {plural(summary.byRole.student, 'student')}, {plural(summary.byRole.judge, 'judge')}, {plural(summary.byRole.coach, 'coach', 'coaches')}. Phone numbers and emails stay private; you only see counts.</p>
      {summary.queued > 0 && waitingMinutes > 5 && <div className="al-warn" role="status"><Icon name="warning" size={16}/><span><strong>Alerts have been waiting since {timeOf(summary.oldestQueued)}.</strong><small>Delivery may not be set up yet: deploy the send-notifications function and schedule it (see the README). Everyone still sees updates in Orator.</small></span></div>}
      {summary.errors.length > 0 && <section className="panel al-errors"><div className="panel-head"><div><h2>Latest problems</h2><p>Why recent alerts weren’t sent</p></div></div><ul>{summary.errors.map((item, index) => <li key={index}><Badge tone="danger">{item.channel === 'sms' ? 'Text' : 'Email'}</Badge><span>{item.error}</span><small>{timeOf(item.at)}</small></li>)}</ul></section>}
    </>}
    <section className="panel al-list"><div className="panel-head"><div><h2>Latest alerts</h2><p>{recent.length ? 'The most recent messages for this tournament' : 'Nothing has been queued yet'}</p></div></div>
      {recent.length > 0 && <ul>{recent.map(row => <li key={row.id}><span className="al-chan">{row.channel === 'sms' ? 'Text' : 'Email'}</span><p>{row.message}</p><span className="al-when"><Badge tone={statusTone[row.status]}>{statusLabel[row.status]}</Badge><small>{timeOf(row.sentAt ?? row.createdAt)}</small></span></li>)}</ul>}
    </section>
    <AutomaticAlerts/>
  </div>;
}

function DemoDirectorAlerts() {
  const { tournament, sections, entries, judges } = useStore();
  const [round, setRound] = useState(Math.min(2, tournament.rounds));
  const [showAll, setShowAll] = useState(false);
  const draft = sections.length === 0;
  const schedule = useMemo(() => draft ? buildSchedule(tournament, entries, judges) : sections, [draft, tournament, entries, judges, sections]);
  const people = useMemo(() => demoPeople(entries, judges, { student: loadDemo('student') ?? undefined, judge: loadDemo('judge') ?? undefined, coach: loadDemo('coach') ?? undefined }), [entries, judges]);
  const { planned, unmatched } = roundAlerts(tournament, schedule, entries, people, round);
  const texts = planned.filter(item => item.channel === 'sms'), emails = planned.filter(item => item.channel === 'email');
  const inRound = new Set(schedule.filter(section => section.round === round).flatMap(section => [...section.entryIds.map(id => { const entry = entries.find(item => item.id === id); return entry ? `student:${entry.school}:${entry.student}` : ''; }), section.judgeId ?? '']));
  const reached = new Set(planned.map(item => item.person.id));
  const inAppOnly = [...inRound].filter(key => key && !reached.has(key)).length;
  const optedIn = people.filter(person => person.settings.smsOptIn || person.settings.emailOptIn).length;
  const shown = showAll ? planned : planned.slice(0, 12);
  const label = round > tournament.rounds ? 'finals' : `Round ${round}`;
  return <div className="al-director">
    <section className="panel al-send"><div className="panel-head"><div><h2>Room alerts</h2><p>Rounds have no start button. Send each round’s alerts just before it begins.</p></div><Badge tone="info" icon="eye">Demo preview</Badge></div>
      <RoundButtons selected={round} onSent={next => { setRound(next); setShowAll(false); }}/>
    </section>
    <div className="al-counts">
      <div className="al-count info"><small>Texts</small><strong>{texts.length}</strong></div>
      <div className="al-count info"><small>Emails</small><strong>{emails.length}</strong></div>
      <div className="al-count"><small>Orator only</small><strong>{inAppOnly + unmatched}</strong><span>not opted in</span></div>
      <div className="al-count"><small>Opted in</small><strong>{optedIn}</strong><span>of {plural(people.length, 'sample person', 'sample people')}</span></div>
    </div>
    <section className="panel al-list al-preview"><div className="panel-head"><div><h2>What {label} would send</h2><p>{draft ? 'From a draft schedule (build the schedule to use your own). ' : ''}Demo: nothing is sent. Signed in, these go out by text and email to people who opted in.</p></div></div>
      {planned.length === 0 ? <p className="al-empty">Nobody in {label} has opted in.</p> : <ul>{shown.map((item: PlannedAlert, index) => <li key={index}><span className="al-chan">{item.channel === 'sms' ? 'Text' : 'Email'}</span><span className="al-to"><strong>{item.person.name}</strong><small>{item.person.role === 'judge' ? 'Judge' : item.person.school} · {item.channel === 'sms' ? maskPhone(item.address) : item.address}</small></span><p>{item.message}</p></li>)}</ul>}
      {planned.length > shown.length && <div className="al-more"><Button variant="secondary" onClick={() => setShowAll(true)}>Show all {planned.length}</Button></div>}
    </section>
    <AutomaticAlerts/>
  </div>;
}
