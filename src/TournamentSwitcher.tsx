import { useEffect, useRef, useState } from 'react';
import { Badge, Icon } from './ui';
import { NEW_TOURNAMENT, useStore } from './store';
import { useAuth } from './auth';

const initials = (name: string) => name.split(/\s+/).map(word => word[0]).join('').slice(0, 2).toUpperCase() || 'T';
const roleLabel: Record<string, string> = { director: 'Director', coach: 'Coach', judge: 'Judge', student: 'Student' };
const statusLabel: Record<string, string> = { registration: 'Registration', scheduled: 'Schedule out', running: 'Underway', finished: 'Finished' };

/**
 * The tournament card at the top of the sidebar. Signed in, it opens a list of every tournament the user directs
 * or belongs to and switches between them; directors can also start another tournament from it.
 */
export function TournamentSwitcher() {
  const store = useStore();
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => { if (event instanceof KeyboardEvent ? event.key === 'Escape' : !box.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  const { tournament } = store;
  const card = <><span className="tiny-logo">{initials(tournament.name)}</span><span><strong>{tournament.name}</strong><small>{tournament.date || 'No date yet'}</small></span></>;
  // The demo has one tournament; there is nothing to switch to.
  if (!store.live) return <div className="tournament-chip">{card}</div>;
  const canCreate = profile?.roles.includes('director') ?? false;
  const choose = (id: string) => { setOpen(false); if (id !== store.tournamentId) store.selectTournament(id); };
  return <div className="tournament-switcher" ref={box}>
    <button className="tournament-chip" aria-haspopup="true" aria-expanded={open} aria-label={`Tournament: ${tournament.name}. Switch tournament`} onClick={() => setOpen(!open)}>{card}<Icon name="chevron" size={15}/></button>
    {open && <div className="tournament-menu">
      <p className="tournament-menu-head">Your tournaments</p>
      {store.myTournaments.length === 0 ? <p className="tournament-menu-empty">None yet. {canCreate ? 'Start one below, or ask to join one.' : 'Ask to join one from your workspace or the tournament calendar.'}</p>
        : <ul aria-label="Your tournaments">{store.myTournaments.map(item => <li key={item.id}>
          <button className={item.id === store.tournamentId ? 'active' : ''} aria-current={item.id === store.tournamentId ? 'true' : undefined} onClick={() => choose(item.id)}>
            <span className="tiny-logo">{initials(item.name)}</span>
            <span><strong>{item.name}</strong><small>{[item.date, statusLabel[item.status]].filter(Boolean).join(' · ')}</small><span className="tournament-roles">{item.roles.map(role => <Badge key={role} tone={role === 'director' ? 'info' : 'neutral'}>{roleLabel[role]}</Badge>)}{item.pending && <Badge tone="warning">Waiting for approval</Badge>}</span></span>
            {item.id === store.tournamentId && <Icon name="check" size={15}/>}
          </button>
        </li>)}</ul>}
      {canCreate && <button className="tournament-menu-new" onClick={() => choose(NEW_TOURNAMENT)}><Icon name="plus" size={15}/> Start a new tournament</button>}
      <a className="tournament-menu-link" href="#/calendar" onClick={() => setOpen(false)}><Icon name="search" size={15}/> Find a tournament to join</a>
    </div>}
  </div>;
}
