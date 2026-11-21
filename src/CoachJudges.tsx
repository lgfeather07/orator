import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Avatar, Badge, Button, Icon, Logo } from './ui';
import { useStore } from './store';
import { supabase, useAuth } from './auth';
import { ballotEvents, eventCodes } from './ballots';
import { invoiceFor, isFinal, roundLabel, sameSchool, type Section, timeFor } from './tournament';
import { listMyBallotStatus } from './ballotApi';
import { JudgeBallot, type BallotRoom } from './JudgeBallot';
import type { Member } from './tournamentApi';
import * as links from './judgeLinks';
import type { CoachJudge, JudgeLinkRoute, SeatInput } from './judgeLinks';
import './judges.css';
import { JudgeDropWarning } from './Drops';

const initials = (name: string) => name.split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase() || '?';
const eventName = (id: string) => ballotEvents.find(event => event.id === id)?.name ?? id;
const message = (caught: unknown) => caught instanceof Error ? caught.message : 'Something went wrong. Try again.';
const emptyInput: SeatInput = { name: '', email: '', phone: '', clean: false, knows: [] };

/** Where a judge's link stands, in words. */
function linkState(seat: CoachJudge, made: boolean): { tone: 'success' | 'info' | 'warning' | 'neutral'; text: string } {
  if (seat.status === 'declined') return { tone: 'warning', text: 'Declined by the director' };
  if (seat.claimed) return { tone: 'success', text: 'Signed in with their link' };
  if (seat.hasLink) return { tone: 'info', text: made ? 'Link ready to send' : 'Link sent, not opened yet' };
  if (seat.revoked) return { tone: 'neutral', text: 'Link turned off' };
  return { tone: 'neutral', text: 'No link yet' };
}

/** Clean judge, or the other schools a judge knows. Same rules as a judge's own "Who you know". */
function ConflictFields({ value, onChange, schools, ownSchool, idPrefix }: { value: SeatInput; onChange: (next: SeatInput) => void; schools: string[]; ownSchool: string; idPrefix: string }) {
  const [typed, setTyped] = useState('');
  const options = [...new Set([...schools.filter(school => !sameSchool(school, ownSchool)), ...value.knows])].sort();
  const toggle = (school: string) => { const on = value.knows.some(item => sameSchool(item, school)); onChange({ ...value, knows: on ? value.knows.filter(item => !sameSchool(item, school)) : [...value.knows, school] }); };
  const add = () => { const name = typed.trim(); if (name && !sameSchool(name, ownSchool) && !value.knows.some(item => sameSchool(item, name))) onChange({ ...value, knows: [...value.knows, name] }); setTyped(''); };
  return <div className="cj-conflicts">
    <label className="check-setting"><input type="checkbox" checked={value.clean} onChange={event => onChange({ ...value, clean: event.target.checked, knows: event.target.checked ? [] : value.knows })}/><span><strong>Clean judge</strong><small>Knows none of the competitors, so can judge any room, even {ownSchool}’s.</small></span></label>
    {!value.clean && <fieldset className="known-schools"><legend>Other schools they know <small>never placed with those students, or with {ownSchool}</small></legend>
      {options.length > 0 && <div>{options.map(school => { const on = value.knows.some(item => sameSchool(item, school)); return <label key={school} className={on ? 'on' : ''}><input type="checkbox" checked={on} onChange={() => toggle(school)}/>{school}</label>; })}</div>}
      <div className="known-add cj-known-add">
        <input id={`${idPrefix}-known`} aria-label="Add a school they know" placeholder="Add a school by name" value={typed} onChange={event => setTyped(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(); } }}/>
        <button type="button" disabled={!typed.trim()} onClick={add}>Add</button>
      </div>
    </fieldset>}
  </div>;
}

/** Name, email, phone and conflicts for one judge. Used to add a judge and to edit one. */
function JudgeForm({ initial, schools, ownSchool, submitLabel, busy, onSubmit, onCancel, idPrefix }: { initial: SeatInput; schools: string[]; ownSchool: string; submitLabel: string; busy: boolean; onSubmit: (input: SeatInput) => Promise<boolean>; onCancel?: () => void; idPrefix: string }) {
  const [value, setValue] = useState(initial);
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!value.name.trim()) return; if (await onSubmit(value) && !onCancel) setValue(emptyInput); };
  return <form className="cj-form" onSubmit={submit}>
    <div className="cj-fields">
      <label><span>Judge’s name</span><input value={value.name} onChange={event => setValue({ ...value, name: event.target.value })} placeholder="Full name" autoComplete="off" required maxLength={80}/></label>
      <label><span>Email <small>optional, to send the link</small></span><input type="email" value={value.email} onChange={event => setValue({ ...value, email: event.target.value })} placeholder="name@example.com" autoComplete="off" maxLength={200}/></label>
      <label><span>Mobile <small>optional, to text the link</small></span><input type="tel" value={value.phone} onChange={event => setValue({ ...value, phone: event.target.value })} placeholder="402-555-0100" autoComplete="off" maxLength={40}/></label>
    </div>
    <ConflictFields value={value} onChange={setValue} schools={schools} ownSchool={ownSchool} idPrefix={idPrefix}/>
    <div className="cj-form-actions">
      {onCancel && <Button variant="secondary" onClick={onCancel}>Cancel</Button>}
      <button className="button button-primary" type="submit" disabled={busy || !value.name.trim()}><Icon name={onCancel ? 'check' : 'plus'}/><span>{busy ? 'Saving…' : submitLabel}</span></button>
    </div>
  </form>;
}

/** Copy, email, and text one judge's link, or make a new one. */
function LinkTools({ seat, tournament, onNewLink, onRevoke, busy }: { seat: CoachJudge; tournament: string; onNewLink: () => void; onRevoke: () => void; busy: boolean }) {
  const { live } = useStore();
  const token = live ? links.linkMadeHere(seat.id) : seat.hasLink ? seat.demoToken ?? null : null;
  const url = token ? links.linkUrl(token) : '';
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 2500); } catch { window.prompt('Copy this link', url); } };
  if (seat.status === 'declined') return null;
  return <div className="cj-link">
    {token ? <>
      <label className="cj-link-url"><span className="cj-hidden">Sign-in link for {seat.name}</span><input readOnly value={url} onFocus={event => event.target.select()}/></label>
      <div className="cj-link-actions">
        <button type="button" className="button button-secondary" onClick={copy}><Icon name={copied ? 'check' : 'file'}/><span>{copied ? 'Copied' : 'Copy link'}</span></button>
        <a className="button button-secondary" href={links.mailtoLink(seat, tournament, url)}><Icon name="send"/><span>Email</span></a>
        <a className="button button-secondary" href={links.smsLink(seat, tournament, url)}><Icon name="comment"/><span>Text</span></a>
      </div>
    </> : seat.hasLink ? <p className="cj-link-note"><Icon name="lock" size={14}/><span>Links can’t be shown again once you leave this page. To send it again, make a new link; the one you sent earlier stops working{seat.claimed ? ', but the judge stays signed in' : ''}.</span></p> : null}
    <div className="cj-link-actions">
      {(!token || !live) && <Button variant={seat.hasLink ? 'ghost' : 'primary'} icon="send" disabled={busy} onClick={onNewLink}>{seat.hasLink ? 'Make a new link' : seat.revoked ? 'Make a new link' : 'Make sign-in link'}</Button>}
      {(seat.hasLink || seat.claimed) && <button type="button" className="people-undo" disabled={busy} onClick={onRevoke}>Turn off link</button>}
    </div>
  </div>;
}

/**
 * A coach's judges for the tournament. Each is approved at once and gets a private link to their own
 * rooms and ballots, with no account. The number entered is the number the invoice says the school brings.
 */
export function CoachJudgesPanel({ school }: { school: string }) {
  const store = useStore();
  const { tournament, tournamentId, live, entries, coachJudges, setCoachJudges } = store;
  const mine = coachJudges.filter(seat => sameSchool(seat.school, school));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [, setVersion] = useState(0);
  const schools = [...new Set(entries.map(entry => entry.school))];
  const invoice = invoiceFor(tournament, entries, school, store.paymentFor(school));
  const finished = tournament.status === 'finished';
  const run = async (key: string, work: () => Promise<void>) => { setBusy(key); setError(''); try { await work(); return true; } catch (caught) { setError(message(caught)); return false; } finally { setBusy(''); } };
  const patch = (id: string, change: Partial<CoachJudge>) => setCoachJudges(list => list.map(seat => seat.id === id ? { ...seat, ...change } : seat));

  const add = (input: SeatInput) => run('add', async () => {
    if (live) { if (!tournamentId) throw new Error('Join a tournament first.'); const seat = await links.addCoachJudge(tournamentId, school, input); setCoachJudges(list => [...list, seat]); }
    else setCoachJudges(list => [...list, { id: `cj${Date.now().toString(36)}`, tournamentId: 'demo', school, name: input.name.trim(), email: input.email.trim(), phone: input.phone.trim(), clean: input.clean, knows: input.clean ? [] : input.knows, status: 'approved', hasLink: false, revoked: false, claimed: false, createdAt: new Date().toISOString() }]);
  });
  const save = (seat: CoachJudge, input: SeatInput) => run(seat.id, async () => {
    if (live) await links.updateCoachJudge(seat.id, input);
    patch(seat.id, { name: input.name.trim(), email: input.email.trim(), phone: input.phone.trim(), clean: input.clean, knows: input.clean ? [] : input.knows }); setEditing(null);
  });
  const newLink = (seat: CoachJudge) => run(seat.id, async () => {
    if (live) { links.rememberLink(seat.id, await links.createJudgeLink(seat.id)); setVersion(n => n + 1); }
    patch(seat.id, { hasLink: true, revoked: false, ...(live ? {} : { demoToken: links.demoToken(seat.id, Number(seat.demoToken?.split('-').pop() ?? 0) + 1) }) });
  });
  const revoke = (seat: CoachJudge) => run(seat.id, async () => {
    if (live) { await links.revokeJudgeLink(seat.id); links.forgetLink(seat.id); }
    patch(seat.id, { hasLink: false, revoked: true, claimed: false });
  });
  const remove = (seat: CoachJudge) => run(seat.id, async () => {
    if (live) { await links.removeCoachJudge(seat.id); links.forgetLink(seat.id); }
    setCoachJudges(list => list.filter(item => item.id !== seat.id)); setConfirmRemove(null);
    // After the drop deadline this is a drop (Drops.tsx): recorded in the demo, already recorded by the database when signed in.
    store.noteJudgeDrop(seat);
  });

  return <section className="panel coach-judges" aria-labelledby="coach-judges-title">
    <div className="panel-head"><div><h2 id="coach-judges-title">Your judges</h2><p>Enter the judges {school} is bringing. Each gets a private sign-in link to their own rooms and ballots. They don’t need an account.</p></div>
      <Badge tone={invoice.judgesOwed > 0 && mine.filter(seat => seat.status === 'approved').length < invoice.judgesOwed ? 'warning' : 'success'} icon="users">{mine.filter(seat => seat.status === 'approved').length} entered{invoice.judgesOwed > 0 ? ` · ${invoice.judgesOwed} owed` : ''}</Badge></div>
    {error && <p className="sync-inline cj-error" role="alert"><Icon name="warning" size={14}/> {error}</p>}
    {mine.length === 0 ? <p className="cj-empty">No judges entered yet. {invoice.judgesOwed > 0 ? `With ${invoice.entries} entries you owe ${invoice.judgesOwed}; each one you don’t bring is a hired-judge fee.` : 'Add the judges you’re bringing below.'}</p>
    : <ul className="cj-list">{mine.map(seat => {
      const state = linkState(seat, live ? !!links.linkMadeHere(seat.id) : !!seat.demoToken);
      return <li key={seat.id} className={seat.status === 'declined' ? 'declined' : ''}>
        <div className="cj-row">
          <Avatar initials={initials(seat.name)} size="sm"/>
          <div className="cj-who"><strong>{seat.name}{seat.clean && <Badge tone="success" icon="check">Clean</Badge>}</strong>
            <small>{[seat.email, seat.phone].filter(Boolean).join(' · ') || 'No email or phone'}{!seat.clean && seat.knows.length ? ` · knows ${seat.knows.join(', ')}` : ''}</small></div>
          <Badge tone={state.tone} icon={seat.claimed ? 'check' : seat.status === 'declined' ? 'warning' : undefined}>{state.text}</Badge>
          <span className="cj-row-actions">
            <button type="button" className="icon-button" aria-label={`Edit ${seat.name}`} onClick={() => setEditing(editing === seat.id ? null : seat.id)}><Icon name="edit" size={16}/></button>
            {confirmRemove === seat.id ? <><Button variant="danger" disabled={busy === seat.id} onClick={() => remove(seat)}>Remove</Button><Button variant="secondary" onClick={() => setConfirmRemove(null)}>Keep</Button></>
              : <button type="button" className="icon-button" aria-label={`Remove ${seat.name}`} onClick={() => setConfirmRemove(seat.id)}><Icon name="close" size={16}/></button>}
          </span>
        </div>
        {confirmRemove === seat.id && <p className="cj-confirm" role="alert">Remove {seat.name}? Their link stops working and any rooms they had go back to the director.{seat.status === 'approved' && <JudgeDropWarning/>}</p>}
        {editing === seat.id ? <JudgeForm idPrefix={`edit-${seat.id}`} initial={{ name: seat.name, email: seat.email, phone: seat.phone, clean: seat.clean, knows: seat.knows }} schools={schools} ownSchool={school} submitLabel="Save" busy={busy === seat.id} onSubmit={input => save(seat, input)} onCancel={() => setEditing(null)}/>
          : !finished && <LinkTools seat={seat} tournament={tournament.name} busy={busy === seat.id} onNewLink={() => newLink(seat)} onRevoke={() => revoke(seat)}/>}
      </li>;
    })}</ul>}
    {finished ? <p className="cj-empty">The tournament has ended.</p> : <details className="cj-add" open={mine.length === 0}>
      <summary><Icon name="plus" size={16}/> Add a judge</summary>
      <JudgeForm idPrefix="add" initial={emptyInput} schools={schools} ownSchool={school} submitLabel="Add judge" busy={busy === 'add'} onSubmit={add}/>
    </details>}
    <p className="cj-note"><Icon name="info" size={14}/><span>Send each judge their own link and ask them not to share it. Opening it on a new phone moves them there. “Turn off link” signs out whoever opened it. Judges who’d rather have an account can still sign up and ask to join.</span></p>
  </section>;
}

/** The director's list of every coach-entered judge, with which school entered them. */
export function DirectorCoachJudges({ compact = false }: { compact?: boolean }) {
  const { coachJudges, setCoachJudges, live, members, refresh } = useStore();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  if (coachJudges.length === 0 && compact) return null;
  const run = async (key: string, work: () => Promise<void>, reload = false) => { setBusy(key); setError(''); try { await work(); if (reload && live) await refresh(); } catch (caught) { setError(message(caught)); } finally { setBusy(''); } };
  const patch = (id: string, change: Partial<CoachJudge>) => setCoachJudges(list => list.map(seat => seat.id === id ? { ...seat, ...change } : seat));
  const accounts = members.filter(member => member.role === 'judge' && !member.coachJudgeId);
  const duplicateOf = (seat: CoachJudge): Member | undefined => seat.claimed ? undefined : accounts.find(member => member.name.trim().toLowerCase() === seat.name.trim().toLowerCase() && (!member.school || sameSchool(member.school, seat.school)));
  const decide = (seat: CoachJudge, status: 'approved' | 'declined') => run(seat.id, async () => { if (live) await links.decideCoachJudge(seat.id, status); patch(seat.id, { status }); }, true);
  const revoke = (seat: CoachJudge) => run(seat.id, async () => { if (live) await links.revokeJudgeLink(seat.id); patch(seat.id, { hasLink: false, revoked: true, claimed: false }); }, true);
  const merge = (seat: CoachJudge, member: Member) => run(seat.id, async () => { await links.mergeJudgeSeat(seat.id, member.userId); patch(seat.id, { claimed: true }); }, true);
  const schools = [...new Set(coachJudges.map(seat => seat.school))].sort();
  return <section className="panel coach-judges director-cj" aria-labelledby="director-cj-title">
    <div className="panel-head"><div><h2 id="director-cj-title">Judges entered by coaches</h2><p>Approved as soon as their coach enters them, and placed like any approved judge. Decline anyone who shouldn’t judge.</p></div>
      <Badge tone="info" icon="users">{coachJudges.filter(seat => seat.status === 'approved').length} approved · {coachJudges.filter(seat => seat.claimed).length} signed in</Badge></div>
    {error && <p className="sync-inline cj-error" role="alert"><Icon name="warning" size={14}/> {error}</p>}
    {coachJudges.length === 0 ? <p className="cj-empty">No coach has entered a judge yet. Coaches add their judges on their Team entries page.</p> : schools.map(school => <div key={school} className="cj-school">
      <h3 className="people-heading">Entered by {school}</h3>
      <ul className="people-list">{coachJudges.filter(seat => seat.school === school).map(seat => {
        const state = linkState(seat, false); const twin = live ? duplicateOf(seat) : undefined;
        return <li key={seat.id}>
          <Avatar initials={initials(seat.name)} size="sm"/>
          <div><strong>{seat.name}{seat.clean && <> <Badge tone="success" icon="check">Clean</Badge></>}</strong>
            <small>Judge · entered by {seat.school} · {state.text}{!seat.clean && seat.knows.length ? ` · knows ${seat.knows.join(', ')}` : ''}</small>
            {twin && <small className="cj-twin"><Icon name="info" size={13}/> {twin.name} also joined with their own account{twin.status === 'approved' ? '' : ' (not approved yet)'}. Merge them so they count once.</small>}
          </div>
          <span className="people-actions">
            {twin && <Button variant="secondary" disabled={busy === seat.id} onClick={() => merge(seat, twin)}>Merge</Button>}
            {seat.status === 'approved' ? <Badge tone="success" icon="check">Approved</Badge> : <Badge tone="danger" icon="close">Declined</Badge>}
            <button className="people-undo" disabled={busy === seat.id} onClick={() => decide(seat, seat.status === 'approved' ? 'declined' : 'approved')}>{seat.status === 'approved' ? 'Decline' : 'Approve instead'}</button>
            {(seat.hasLink || seat.claimed) && <button className="people-undo" disabled={busy === seat.id} onClick={() => revoke(seat)}>Turn off link</button>}
          </span>
        </li>;
      })}</ul>
    </div>)}
  </section>;
}

// ── A judge opening their link ────────────────────────────────────────────────────────────────

function GuestHeader({ dark, setDark, onSignOut }: { dark: boolean; setDark: (dark: boolean) => void; onSignOut?: () => void }) {
  return <header className="calendar-head guest-head">
    {onSignOut ? <button type="button" className="legal-back guest-signout" onClick={onSignOut}><Icon name="lock" size={15}/> Sign out</button> : <span/>}
    <Logo/>
    <button type="button" className="calendar-theme" aria-label={dark ? 'Use light mode' : 'Use dark mode'} aria-pressed={dark} onClick={() => setDark(!dark)}><Icon name={dark ? 'sun' : 'moon'} size={16}/></button>
  </header>;
}

function GuestMessage({ title, children, tone = 'info' }: { title: string; children: ReactNode; tone?: 'info' | 'error' | 'busy' }) {
  return <section className={`guest-card guest-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
    {tone === 'busy' ? <span className="spinner"/> : <span className="guest-icon"><Icon name={tone === 'error' ? 'warning' : 'info'}/></span>}
    <div><h1>{title}</h1>{children}</div>
  </section>;
}

/** A guest judge's rooms and ballots: only the rooms assigned to them. */
function GuestRooms({ judgeId, seat }: { judgeId: string; seat: { name: string; school: string } }) {
  const { sections, entries, tournament, tournamentId, live, roomResults, recordRoomResults, refresh } = useStore();
  const [status, setStatus] = useState<Record<string, 'draft' | 'submitted'>>({});
  const [open, setOpen] = useState<BallotRoom | null>(null);
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!live) return; let active = true; listMyBallotStatus(tournament.name).then(found => active && setStatus(found)).catch(() => undefined); return () => { active = false; }; }, [live, tournament.name, sections.length, open]);
  const mine = sections.filter(section => section.judgeId === judgeId).sort((a, b) => a.round - b.round);
  const stateOf = (section: Section) => live ? status[`${section.round}|${section.room}`] : roomResults.some(result => result.sectionId === section.id) ? 'submitted' as const : undefined;
  const openRoom = (section: Section) => {
    const speakers = section.entryIds.map(id => entries.find(entry => entry.id === id)).filter(entry => entry !== undefined).map(entry => ({ code: entry.id, name: entry.student, school: entry.school }));
    if (speakers.length === 0) return;
    setOpen({ key: { tournament: tournament.name, round: section.round, room: section.room }, tournamentId: tournamentId ?? 'demo', sectionId: section.id, eventId: section.eventId, time: timeFor(tournament, section.round) ?? '', speakers, final: isFinal(section, tournament) });
    window.setTimeout(() => top.current?.focus(), 0);
  };
  const published = tournament.status !== 'registration' && sections.length > 0;
  if (open) return <div className="guest-ballot" ref={top} tabIndex={-1}>
    <section className="embedded-ballot"><div className="embedded-ballot-head"><div><span className="eyebrow">{seat.name.toUpperCase()}</span><h2>{open.final ? 'Final round' : `Round ${open.key.round}`} · {open.key.room}</h2><p>{eventName(open.eventId)} · your ballot saves as you go</p></div><Button variant="secondary" icon="arrow" onClick={() => { setOpen(null); refresh(); }}>Back to your rooms</Button></div>
      <div className="mobile-stage"><div className="phone-frame"><JudgeBallot key={open.sectionId} room={open} onSubmitted={live ? undefined : rows => recordRoomResults(open.sectionId, rows)}/></div></div></section>
  </div>;
  return <section className="panel guest-rooms" aria-labelledby="guest-rooms-title">
    <div className="panel-head"><div><h2 id="guest-rooms-title">Your rooms</h2><p>{tournament.name}{tournament.date ? ` · ${tournament.date}` : ''}</p></div>
      <span className="panel-head-actions"><Badge tone={mine.length ? 'success' : 'neutral'} icon={mine.length ? 'check' : 'clock'}>{mine.length} {mine.length === 1 ? 'room' : 'rooms'}</Badge><button type="button" className="people-undo" onClick={() => refresh()}>Refresh</button></span></div>
    {mine.length === 0 ? <p className="cj-empty">{published ? 'You haven’t been given a room yet. The director may still add you; check back before each round.' : 'The schedule isn’t out yet. Your rooms appear here as soon as the director publishes it. Keep this page bookmarked.'}</p>
      : <div className="assignment-desktop guest-room-list">{mine.map(section => { const state = stateOf(section); return <button key={section.id} className={state === 'submitted' ? '' : 'featured'} onClick={() => openRoom(section)}>
        <span className="event-code">{eventCodes[section.eventId] ?? section.eventId.slice(0, 3).toUpperCase()}</span>
        <span><strong>{roundLabel(section, tournament)} · {eventName(section.eventId)}</strong><small>{timeFor(tournament, section.round)} · {section.room} · {section.entryIds.length} {section.entryIds.length === 1 ? 'speaker' : 'speakers'}</small></span>
        <Badge tone={state === 'submitted' ? 'success' : state === 'draft' ? 'warning' : 'info'} icon={state === 'submitted' ? 'lock' : undefined}>{state === 'submitted' ? 'Submitted' : state === 'draft' ? 'Draft saved' : 'Open ballot'}</Badge><Icon name="arrow"/>
      </button>; })}</div>}
  </section>;
}

/** Lets a guest judge keep their seat with an email and password, so they can sign in anywhere. */
function SaveAccount() {
  const [user, setUser] = useState<{ email: string; anonymous: boolean } | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'saved'>('idle');
  const [error, setError] = useState('');
  useEffect(() => { supabase?.auth.getUser().then(({ data }) => setUser(data.user ? { email: data.user.email ?? '', anonymous: data.user.is_anonymous ?? false } : null)); }, [state]);
  if (!supabase || !user || (!user.anonymous && state !== 'saved')) return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setState('busy');
    try {
      if (!user.email) { const { error: failed } = await supabase!.auth.updateUser({ email: email.trim() }, { emailRedirectTo: `${window.location.origin}${window.location.pathname}#/judging` }); if (failed) throw failed; setState('sent'); }
      else { if (password.length < 8) throw new Error('Use a password with at least 8 characters.'); const { error: failed } = await supabase!.auth.updateUser({ password }); if (failed) throw failed; setState('saved'); }
    } catch (caught) { setError(message(caught)); setState('idle'); }
  };
  return <details className="panel guest-save">
    <summary><Icon name="lock" size={16}/> <span><strong>Save my account</strong><small>Optional. Add an email{user.email ? ' and password' : ''} to sign in on any device, now or at your next tournament.</small></span></summary>
    {state === 'saved' ? <p className="cj-empty"><Icon name="check" size={14}/> Saved. Sign in with {user.email} and your password next time.</p>
    : state === 'sent' ? <p className="cj-empty">We sent a confirmation link to {email}. Open it, then come back here to choose a password.</p>
    : <form className="cj-form" onSubmit={submit}>
      <div className="cj-fields">{!user.email ? <label><span>Email</span><input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required/></label>
        : <label><span>New password <small>at least 8 characters, for {user.email}</small></span><input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" required minLength={8}/></label>}</div>
      {error && <p className="auth-error" role="alert"><Icon name="warning" size={15}/> {error}</p>}
      <div className="cj-form-actions"><button className="button button-primary" type="submit" disabled={state === 'busy'}><span>{state === 'busy' ? 'Saving…' : user.email ? 'Save password' : 'Send confirmation'}</span></button></div>
    </form>}
  </details>;
}

/**
 * `#/judge-link/<token>`: a judge opens the link their coach sent. In signed-in mode this signs them in
 * as a guest (Supabase anonymous sign-in), claims the seat, and moves to `#/judging`, their rooms page.
 * In the demo, a demo link opens that judge's rooms from the demo schedule.
 */
export function JudgeLinkView({ route, go, dark, setDark, onExit }: { route: JudgeLinkRoute; go: (route: JudgeLinkRoute | null) => void; dark: boolean; setDark: (dark: boolean) => void; onExit: () => void }) {
  const store = useStore();
  const { profile, signOut } = useAuth();
  const [phase, setPhase] = useState<'working' | 'confirm' | 'error' | 'ready'>(route.token ? 'working' : 'ready');
  const [error, setError] = useState('');
  const [claimed, setClaimed] = useState<links.ClaimedSeat | null>(null);
  const latest = useRef({ refresh: store.refresh, profile });
  latest.current = { refresh: store.refresh, profile };
  useEffect(() => { document.title = 'Your judge rooms · Orator'; return () => { document.title = 'Orator'; }; }, []);

  const claim = async (asGuest: boolean) => {
    if (!supabase || !route.token) return;
    setPhase('working'); setError('');
    try {
      const { data } = await supabase.auth.getSession();
      if (asGuest && data.session && !data.session.user.is_anonymous) await supabase.auth.signOut();
      if (!(await supabase.auth.getSession()).data.session) await links.signInAsGuest();
      const seat = await links.claimJudgeLink(route.token);
      setClaimed(seat);
      // Reload the profile (now named for the judge) and the tournament they belong to.
      await supabase.auth.refreshSession().catch(() => undefined);
      for (let i = 0; i < 30 && !latest.current.profile; i++) await new Promise(resolve => window.setTimeout(resolve, 100));
      await latest.current.refresh();
      setPhase('ready'); go({ token: null });
    } catch (caught) { setError(message(caught)); setPhase('error'); }
  };

  // Demo: the token names a seat in this browser's demo data.
  const demoSeat = !store.live && route.token ? store.coachJudges.find(seat => seat.demoToken === route.token) ?? null : null;
  const demoOk = !!demoSeat && demoSeat.hasLink && demoSeat.status === 'approved';
  useEffect(() => {
    if (!route.token) return;
    if (!supabase) { if (demoOk && !demoSeat!.claimed) store.setCoachJudges(list => list.map(seat => seat.id === demoSeat!.id ? { ...seat, claimed: true } : seat)); setPhase(demoOk ? 'ready' : 'error'); if (!demoOk) setError(demoSeat ? (demoSeat.status === 'declined' ? 'The tournament director has removed this judge.' : 'This judge link has been turned off. Ask your coach for a new one.') : 'This judge link isn’t valid. Ask your coach to send it again.'); return; }
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => { if (cancelled) return; if (data.session && !data.session.user.is_anonymous) setPhase('confirm'); else claim(false); });
    return () => { cancelled = true; };
    // Runs once per link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.token]);

  const leave = async () => { if (supabase) await signOut(); go(null); onExit(); };
  const guest = !supabase ? demoSeat : claimed ? { name: claimed.name, school: claimed.school } : profile ? { name: profile.name, school: store.myMemberships.find(member => member.role === 'judge' && member.tournamentId === store.tournamentId)?.school ?? '' } : null;
  const judgeId = !supabase ? demoSeat?.id ?? '' : profile?.id ?? '';
  const holdsSeat = !supabase ? demoOk : !!profile && store.myMemberships.some(member => member.role === 'judge' && member.tournamentId === store.tournamentId && member.status === 'approved');

  return <div className="legal-page calendar-page guest-page">
    <GuestHeader dark={dark} setDark={setDark} onSignOut={supabase && profile ? leave : undefined}/>
    <main id="main" className="calendar-main guest-main">
      {!supabase && <p className="calendar-notice" role="note"><Icon name="info" size={15}/><span><strong>Demo judge link.</strong> With accounts connected, this signs the judge in without an account and shows only their rooms.</span></p>}
      {phase === 'working' ? <GuestMessage tone="busy" title="Opening your judge link…"><p>Signing you in. This takes a moment.</p></GuestMessage>
      : phase === 'confirm' ? <GuestMessage title="You’re signed in already"><p>You’re signed in as {profile?.name || 'someone'}{profile?.email ? ` (${profile.email})` : ''}. Use this judge link with that account, or sign out and continue as a guest judge. A coach checking a link should sign out first.</p>
          <div className="guest-actions"><Button onClick={() => claim(false)}>Use my account</Button><Button variant="secondary" onClick={() => claim(true)}>Continue as a guest</Button></div></GuestMessage>
      : phase === 'error' ? <GuestMessage tone="error" title="This link didn’t work"><p>{error}</p><div className="guest-actions"><Button variant="secondary" onClick={() => { go(null); onExit(); }}>Go to Orator</Button></div></GuestMessage>
      : !guest || !holdsSeat ? <GuestMessage title="Open your judge link"><p>{profile ? 'This device isn’t signed in as a judge yet, or the director has removed you.' : 'You’re signed out on this device.'} Open the link your coach sent you to see your rooms.</p>
          <div className="guest-actions"><Button variant="secondary" onClick={() => { go(null); onExit(); }}>Go to Orator</Button>{profile && <Button variant="secondary" onClick={() => store.refresh()}>Check again</Button>}</div></GuestMessage>
      : <>
        <section className="guest-hello"><span className="eyebrow">Judging{guest.school ? ` for ${guest.school}` : ''}</span><h1>Hi, {guest.name.split(/\s+/)[0]}</h1><p>These are the rooms the tournament director gave you. Open one to check speakers in and fill in its ballot. Keep this page bookmarked; you can come back to it any time today.</p></section>
        <GuestRooms judgeId={judgeId} seat={guest}/>
        <SaveAccount/>
        {supabase && <p className="cj-note guest-foot"><Icon name="info" size={14}/><span>Judging on another device? Open the same link there; this device is then signed out of your rooms. <button type="button" className="people-undo" onClick={() => { go(null); onExit(); }}>Open the full judge page</button></span></p>}
      </>}
    </main>
  </div>;
}

export { useJudgeLinkRoute } from './judgeLinks';
