import { useState } from 'react';
import { Avatar, Badge, Button, Icon } from './ui';
import { useStore } from './store';
import { defaultTournament } from './tournament';
import type { Member, MemberRole } from './tournamentApi';

const initials = (name: string) => name.split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase() || '?';
const roleWord: Record<MemberRole, string> = { coach: 'Coach', judge: 'Judge', student: 'Student' };

/** Where a signed-in user stands with the tournament for a given role. */
export function useAccess(role: MemberRole) {
  const { live, liveState, myMemberships, tournamentId } = useStore();
  if (!live) return { state: 'demo' as const, membership: null };
  if (liveState === 'loading' || liveState === 'idle') return { state: 'loading' as const, membership: null };
  const mine = myMemberships.filter(member => member.role === role);
  const membership = mine.find(member => member.tournamentId === tournamentId) ?? mine[0] ?? null;
  return { state: membership ? membership.status : 'none' as const, membership };
}

/** A director with no tournament yet starts one here. */
export function CreateTournamentCard() {
  const { createLiveTournament } = useStore();
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [host, setHost] = useState('');
  const [busy, setBusy] = useState(false);
  return <section className="panel access-card">
    <div className="panel-head"><div><h2>Create your tournament</h2><p>Coaches, judges, and students will ask to join it, and you approve each one.</p></div></div>
    <form className="access-form" onSubmit={async event => { event.preventDefault(); setBusy(true); await createLiveTournament({ ...defaultTournament, name: name.trim(), date: date.trim(), host: host.trim() }); setBusy(false); }}>
      <label><span>Tournament name</span><input value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Gothenburg Invitational" required/></label>
      <label><span>Date</span><input value={date} onChange={event => setDate(event.target.value)} placeholder="e.g. October 19, 2026"/></label>
      <label><span>Host school</span><input value={host} onChange={event => setHost(event.target.value)} placeholder="e.g. Gothenburg High School"/></label>
      <button className="button button-primary" type="submit" disabled={!name.trim() || busy}><Icon name="plus"/><span>{busy ? 'Creating…' : 'Create tournament'}</span></button>
    </form>
  </section>;
}

/** Coaches, judges, and students ask to join a tournament; the director approves them. Renders nothing once approved. */
export function JoinTournament({ role }: { role: MemberRole }) {
  const { tournaments, requestJoin, refresh } = useStore();
  const { state, membership } = useAccess(role);
  const [choice, setChoice] = useState('');
  const [school, setSchool] = useState('');
  const [busy, setBusy] = useState(false);
  if (state === 'demo' || state === 'approved') return null;
  if (state === 'loading') return <section className="access-banner"><span className="spinner"/><div><strong>Checking your tournament access…</strong></div></section>;
  const joined = membership ? tournaments.find(item => item.id === membership.tournamentId) : null;
  if (state === 'pending') return <section className="access-banner pending"><span className="access-icon"><Icon name="clock"/></span><div><strong>Waiting for the director to approve you</strong><small>You asked to join {joined?.name ?? 'the tournament'} as a {roleWord[role].toLowerCase()}{membership?.school ? ` for ${membership.school}` : ''}. You’ll get access as soon as the director approves the request.</small></div><Button variant="secondary" onClick={() => refresh()}>Check again</Button></section>;
  if (state === 'declined') return <section className="access-banner declined"><span className="access-icon"><Icon name="warning"/></span><div><strong>Your request was declined</strong><small>The director of {joined?.name ?? 'the tournament'} declined your request to join as a {roleWord[role].toLowerCase()}. Talk to the director if this is a mistake.</small></div></section>;
  const selected = choice || tournaments[0]?.id || '';
  const needsSchool = role !== 'judge';
  return <section className="panel access-card">
    <div className="panel-head"><div><h2>Join a tournament</h2><p>Ask the tournament director for access as a {roleWord[role].toLowerCase()}. You’ll be let in once they approve you.</p></div></div>
    {tournaments.length === 0 ? <p className="access-empty">No tournaments have been created yet. Check back once your tournament director has set one up.</p> : <form className="access-form" onSubmit={async event => { event.preventDefault(); setBusy(true); await requestJoin(selected, role, school.trim()); setBusy(false); }}>
      <label><span>Tournament</span><select value={selected} onChange={event => setChoice(event.target.value)}>{tournaments.map(item => <option key={item.id} value={item.id}>{item.name}{item.date ? ` · ${item.date}` : ''}</option>)}</select></label>
      <label><span>{needsSchool ? 'Your school' : 'School you’re affiliated with'} {!needsSchool && <small>Optional. You won’t judge your own school.</small>}</span><input value={school} onChange={event => setSchool(event.target.value)} placeholder="e.g. Lincoln High" required={needsSchool}/></label>
      <button className="button button-primary" type="submit" disabled={busy || !selected || (needsSchool && !school.trim())}><Icon name="send"/><span>{busy ? 'Sending…' : 'Ask to join'}</span></button>
    </form>}
  </section>;
}

/** The director's list of everyone who has asked to join, with pending requests first. */
export function PeopleBoard() {
  const { members, decideMember, refresh, tournament } = useStore();
  const [busy, setBusy] = useState('');
  const key = (member: Member) => `${member.userId}-${member.role}`;
  const decide = async (member: Member, status: 'approved' | 'declined') => { setBusy(key(member)); await decideMember(member, status); setBusy(''); };
  const pending = members.filter(member => member.status === 'pending');
  const rest = members.filter(member => member.status !== 'pending').sort((a, b) => a.role.localeCompare(b.role) || a.school.localeCompare(b.school));
  const row = (member: Member) => <li key={key(member)}>
    <Avatar initials={initials(member.name)} size="sm"/>
    <div><strong>{member.name || 'Unnamed account'}</strong><small>{roleWord[member.role]}{member.school ? ` · ${member.school}` : ''}</small></div>
    {member.status === 'pending' ? <span className="people-actions"><Button variant="secondary" disabled={busy === key(member)} onClick={() => decide(member, 'declined')}>Decline</Button><Button icon="check" disabled={busy === key(member)} onClick={() => decide(member, 'approved')}>Approve</Button></span>
      : <span className="people-actions"><Badge tone={member.status === 'approved' ? 'success' : 'danger'} icon={member.status === 'approved' ? 'check' : 'close'}>{member.status === 'approved' ? 'Approved' : 'Declined'}</Badge><button className="people-undo" onClick={() => decide(member, member.status === 'approved' ? 'declined' : 'approved')}>{member.status === 'approved' ? 'Remove access' : 'Approve instead'}</button></span>}
  </li>;
  return <div className="issue-board people-board">
    <section className="panel">
      <div className="panel-head"><div><h2>People</h2><p>Everyone who has asked to join {tournament.name}</p></div><span className="panel-head-actions"><Badge tone={pending.length ? 'warning' : 'success'} icon={pending.length ? 'clock' : 'check'}>{pending.length ? `${pending.length} waiting for you` : 'No requests waiting'}</Badge><Button variant="secondary" onClick={() => refresh()}>Refresh</Button></span></div>
      {members.length === 0 ? <p className="issue-empty">Nobody has asked to join yet. Coaches, judges, and students sign in, pick this tournament, and ask to join; their requests appear here.</p> : <>
        {pending.length > 0 && <><h3 className="people-heading">Waiting for approval</h3><ul className="people-list">{pending.map(row)}</ul></>}
        {rest.length > 0 && <><h3 className="people-heading">Decided</h3><ul className="people-list">{rest.map(row)}</ul></>}
      </>}
    </section>
  </div>;
}
