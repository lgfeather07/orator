import { useEffect, useState } from 'react';
import { Badge, Icon } from './ui';
import { useStore } from './store';
import { useAuth } from './auth';
import { ballotEvents, eventCodes } from './ballots';
import { roundTimes } from './tournament';
import { listMyBallotStatus } from './ballotApi';
import type { BallotRoom } from './JudgeBallot';

const eventName = (id: string) => ballotEvents.find(event => event.id === id)?.name ?? id;

/** The rooms the director has assigned to the signed-in judge, each opening its own ballot. */
export function MyRooms({ onOpen }: { onOpen: (room: BallotRoom) => void }) {
  const { sections, entries, tournament, tournamentId, refresh } = useStore();
  const { profile } = useAuth();
  const [status, setStatus] = useState<Record<string, 'draft' | 'submitted'>>({});
  useEffect(() => { let active = true; listMyBallotStatus(tournament.name).then(found => active && setStatus(found)).catch(() => undefined); return () => { active = false; }; }, [tournament.name, sections.length]);
  const mine = sections.filter(section => section.judgeId === profile?.id).sort((a, b) => a.round - b.round);
  const open = (sectionId: string) => {
    const section = mine.find(item => item.id === sectionId); if (!section || !tournamentId) return;
    const speakers = section.entryIds.map(id => entries.find(entry => entry.id === id)).filter(entry => entry !== undefined).map(entry => ({ code: entry.id, name: entry.student, school: entry.school }));
    if (speakers.length === 0) return;
    onOpen({ key: { tournament: tournament.name, round: section.round, room: section.room }, tournamentId, sectionId: section.id, eventId: section.eventId, time: roundTimes[section.round - 1] ?? '', speakers });
  };
  return <section className="panel role-panel">
    <div className="panel-head"><div><h2>Your rooms</h2><p>{tournament.name} · assigned by the tournament director</p></div><span className="panel-head-actions"><Badge tone={mine.length ? 'success' : 'neutral'} icon={mine.length ? 'check' : 'clock'}>{mine.length} {mine.length === 1 ? 'room' : 'rooms'}</Badge><button onClick={() => refresh()}>Refresh</button></span></div>
    {mine.length === 0 ? <p className="team-ballots-empty">{tournament.status === 'registration' ? 'The schedule hasn’t been published yet. Your rooms appear here as soon as the director publishes it.' : 'You haven’t been assigned a room. The director can add you to one on their Schedule step.'}</p> : <div className="assignment-desktop">{mine.map(section => {
      const state = status[`${section.round}|${section.room}`];
      return <button key={section.id} className={state === 'submitted' ? '' : 'featured'} onClick={() => open(section.id)}>
        <span className="event-code">{eventCodes[section.eventId] ?? section.eventId.slice(0, 3).toUpperCase()}</span>
        <span><strong>Round {section.round} · {eventName(section.eventId)}</strong><small>{roundTimes[section.round - 1]} · {section.room} · {section.entryIds.length} {section.entryIds.length === 1 ? 'speaker' : 'speakers'}</small></span>
        <Badge tone={state === 'submitted' ? 'success' : state === 'draft' ? 'warning' : 'info'} icon={state === 'submitted' ? 'lock' : undefined}>{state === 'submitted' ? 'Submitted' : state === 'draft' ? 'Draft saved' : 'Open ballot'}</Badge><Icon name="arrow"/>
      </button>;
    })}</div>}
  </section>;
}
