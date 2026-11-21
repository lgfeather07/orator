import { useEffect, useState } from 'react';
import { Badge, Icon } from './ui';
import { useStore } from './store';
import { useAuth } from './auth';
import { ballotEvents, eventCodes } from './ballots';
import { roundLabel, stageOf, timeFor } from './tournament';
import { listMyBallotStatus } from './ballotApi';
import type { BallotRoom } from './JudgeBallot';

const eventName = (id: string) => ballotEvents.find(event => event.id === id)?.name ?? id;

/** The rooms the director has assigned to the signed-in judge, each opening its own ballot. */
export function MyRooms({ onOpen }: { onOpen: (room: BallotRoom) => void }) {
  const { sections, entries, tournament, tournamentId, refresh, live, roomResults } = useStore();
  const { profile } = useAuth();
  const [status, setStatus] = useState<Record<string, 'draft' | 'submitted'>>({});
  useEffect(() => { if (!live) return; let active = true; listMyBallotStatus(tournament.name).then(found => active && setStatus(found)).catch(() => undefined); return () => { active = false; }; }, [live, tournament.name, sections.length]);
  // In the demo the judge is Judge Leather from the sample pool.
  const judgeId = live ? profile?.id : 'jl';
  const mine = sections.filter(section => section.judgeId === judgeId).sort((a, b) => a.round - b.round);
  const stateOf = (section: (typeof mine)[number]) => live ? status[`${section.round}|${section.room}`] : roomResults.some(result => result.sectionId === section.id) ? 'submitted' as const : undefined;
  const open = (sectionId: string) => {
    const section = mine.find(item => item.id === sectionId); if (!section || (live && !tournamentId)) return;
    const speakers = section.entryIds.map(id => entries.find(entry => entry.id === id)).filter(entry => entry !== undefined).map(entry => ({ code: entry.id, name: entry.student, school: entry.school }));
    if (speakers.length === 0) return;
    onOpen({ key: { tournament: tournament.name, round: section.round, room: section.room }, tournamentId: tournamentId ?? 'demo', sectionId: section.id, eventId: section.eventId, time: timeFor(tournament, section.round) ?? '', speakers, final: stageOf(section, tournament) === 'final', stage: stageOf(section, tournament) });
  };
  return <section className="panel role-panel">
    <div className="panel-head"><div><h2>Your rooms</h2><p>{tournament.name} · assigned by the tournament director{live ? '' : ' · from the demo schedule'}</p></div><span className="panel-head-actions"><Badge tone={mine.length ? 'success' : 'neutral'} icon={mine.length ? 'check' : 'clock'}>{mine.length} {mine.length === 1 ? 'room' : 'rooms'}</Badge><button onClick={() => refresh()}>Refresh</button></span></div>
    {mine.length === 0 ? <p className="team-ballots-empty">{tournament.status === 'registration' ? 'The schedule hasn’t been published yet. Your rooms appear here as soon as the director publishes it.' : 'You haven’t been assigned a room. The director can add you to one on their Schedule step.'}</p> : <div className="assignment-desktop">{mine.map(section => {
      const state = stateOf(section);
      return <button key={section.id} className={state === 'submitted' ? '' : 'featured'} onClick={() => open(section.id)}>
        <span className="event-code">{eventCodes[section.eventId] ?? section.eventId.slice(0, 3).toUpperCase()}</span>
        <span><strong>{roundLabel(section, tournament)} · {eventName(section.eventId)}</strong><small>{timeFor(tournament, section.round)} · {section.room} · {section.entryIds.length} {section.entryIds.length === 1 ? 'speaker' : 'speakers'}</small></span>
        <Badge tone={state === 'submitted' ? 'success' : state === 'draft' ? 'warning' : 'info'} icon={state === 'submitted' ? 'lock' : undefined}>{state === 'submitted' ? 'Submitted' : state === 'draft' ? 'Draft saved' : 'Open ballot'}</Badge><Icon name="arrow"/>
      </button>;
    })}</div>}
  </section>;
}
