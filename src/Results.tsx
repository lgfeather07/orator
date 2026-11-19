import { useState } from 'react';
import { Badge, Button, Icon, downloadText } from './ui';
import { useStore } from './store';
import { ballotEvents } from './ballots';
import { contestKey, contestOf, divisions, entryLoad, finalConflict, isFinal, loadLabel, parseContest, preferenceFor } from './tournament';
import { FINALISTS, NSAA_TEAM_POINTS, finalPlacings, prelimStandings, sampleFinals, teamStandings, type Placing, type Standing } from './results';

/** "Informative" for varsity, "Novice Informative" for the novice division. */
const eventName = (key: string) => { const { eventId, division } = parseContest(key); const name = ballotEvents.find(event => event.id === eventId)?.name ?? eventId; return division === 'novice' ? `Novice ${name}` : name; };
const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4) % 4]}`;

/** Breaks, finals, and team points for the director, following the NSAA Speech Manual. */
export function ResultsBoard({ onOpenSetup }: { onOpenSetup?: () => void }) {
  const store = useStore();
  const { tournament, entries, prelimResults, finalResults } = store;
  const sections = store.sections.filter(section => !isFinal(section, tournament));
  const finalRooms = store.sections.filter(section => isFinal(section, tournament));
  // One tab per contest: an event in a division. Novice and varsity break and place separately.
  const events = tournament.eventIds.flatMap(id => divisions.map(division => contestKey(id, division))).filter(key => entries.some(entry => contestOf(entry) === key));
  const [chosen, setChosen] = useState('');
  const eventId = events.includes(chosen) ? chosen : events[0] ?? '';
  const judges = tournament.finalJudges ?? 2;
  const points = tournament.teamPoints ?? NSAA_TEAM_POINTS;

  const standingsFor = (id: string): Standing[] => prelimStandings(entries.filter(entry => contestOf(entry) === id), sections.filter(section => contestOf(section) === id), prelimResults);
  // With real final rooms, placings wait until every final-round judge has submitted.
  const ballotsIn = (id: string) => finalRooms.filter(room => contestOf(room) === id && store.roomResults.some(result => result.sectionId === room.id)).length;
  const finalReady = (id: string) => { const rooms = finalRooms.filter(room => contestOf(room) === id); return rooms.length === 0 || ballotsIn(id) === rooms.length; };
  const placingsFor = (id: string): Placing[] => finalReady(id) ? finalPlacings(standingsFor(id).filter(standing => standing.advances), finalResults, points) : [];
  const standings = eventId ? standingsFor(eventId) : [];
  const finalists = standings.filter(standing => standing.advances);
  const placings = eventId ? placingsFor(eventId) : [];
  const allPlacings = events.map(id => ({ eventName: eventName(id), placings: placingsFor(id) }));
  // Novice finals count toward team points only if the director says so.
  const countsForTeam = (id: string) => tournament.noviceTeamPoints || parseContest(id).division !== 'novice';
  const teams = teamStandings(allPlacings.filter((_, index) => countsForTeam(events[index])));
  const finalsDone = allPlacings.filter(item => item.placings.length > 0).length;
  const hasPrelims = prelimResults.length > 0;
  const cutTie = finalists.length > FINALISTS;
  const rooms = finalRooms.filter(room => contestOf(room) === eventId);
  const seats = rooms.length || judges;
  const finalistSchools = finalists.map(finalist => finalist.school);
  const conflictOf = (judgeId: string | null) => { const judge = store.judges.find(item => item.id === judgeId); return judge ? finalConflict(judge, eventId, finalistSchools, store.sections, tournament) : ''; };
  const conflictText = { '': '', school: 'from a finalist’s school', knows: 'knows a finalist’s school', prelim: 'judged this event in prelims' };
  const levelText = { top: 'Top choice', willing: 'Willing', avoid: 'Prefers to avoid' };

  // Where each contest is, so the director always knows the next thing to do.
  const prelimRoomsIn = (id: string) => { const rooms = sections.filter(section => contestOf(section) === id); return { done: rooms.filter(room => prelimResults.some(result => result.sectionId === room.id)).length, total: rooms.length }; };
  const stageOf = (id: string): 'prelims' | 'ready' | 'final' | 'done' => {
    const prelim = prelimRoomsIn(id);
    if (prelim.done < prelim.total) return 'prelims';
    if (placingsFor(id).length > 0) return 'done';
    return finalRooms.some(room => contestOf(room) === id) ? 'final' : 'ready';
  };
  const stages = events.map(id => ({ id, stage: stageOf(id) }));
  const count = (stage: string) => stages.filter(item => item.stage === stage).length;
  const roomsLeft = events.reduce((sum, id) => { const prelim = prelimRoomsIn(id); return sum + prelim.total - prelim.done; }, 0);
  const finalBallotsLeft = finalRooms.filter(room => !store.roomResults.some(result => result.sectionId === room.id)).length;
  const exportResults = () => {
    const quote = (text: string | number) => `"${String(text).replace(/"/g, '""')}"`;
    const lines = [['Event', 'Place', 'Speaker', 'School', 'Judges’ ranks', 'Team points'].map(quote).join(',')];
    events.forEach(id => placingsFor(id).forEach(placing => lines.push([eventName(id), placing.place, placing.student, placing.school, placing.judgeRanks.join(' '), placing.teamPoints].map(quote).join(','))));
    lines.push('', ['Team', 'Points'].map(quote).join(','), ...teamStandings(events.filter(countsForTeam).map(id => ({ eventName: eventName(id), placings: placingsFor(id) }))).map(team => [team.school, team.points].map(quote).join(',')));
    downloadText(`${tournament.name.replace(/\W+/g, '-').toLowerCase() || 'tournament'}-results.csv`, lines.join('\n'));
  };
  const flow = <section className="panel results-flow" aria-label="Results progress">
    <ol className="results-steps">
      <li className={roomsLeft === 0 && prelimResults.length > 0 ? 'done' : 'current'}><span>{roomsLeft === 0 && prelimResults.length > 0 ? <Icon name="check" size={14}/> : 1}</span><div><strong>Preliminary ballots</strong><small>{prelimResults.length === 0 ? 'None in yet' : roomsLeft === 0 ? 'Every room is in' : `${roomsLeft} ${roomsLeft === 1 ? 'room' : 'rooms'} still out`}</small></div></li>
      <li className={count('ready') + count('prelims') === 0 && events.length > 0 ? 'done' : count('ready') > 0 ? 'current' : ''}><span>{count('ready') + count('prelims') === 0 && events.length > 0 ? <Icon name="check" size={14}/> : 2}</span><div><strong>Create finals</strong><small>{count('ready') > 0 ? `${count('ready')} ready to create` : count('prelims') > 0 ? 'After prelims are in' : 'All created'}</small></div></li>
      <li className={count('done') === events.length && events.length > 0 ? 'done' : count('final') > 0 ? 'current' : ''}><span>{count('done') === events.length && events.length > 0 ? <Icon name="check" size={14}/> : 3}</span><div><strong>Final ballots</strong><small>{count('done')} of {events.length} finals placed{finalBallotsLeft > 0 ? ` · ${finalBallotsLeft} ballots out` : ''}</small></div></li>
      <li className={tournament.status === 'finished' ? 'done' : count('done') === events.length && events.length > 0 ? 'current' : ''}><span>{tournament.status === 'finished' ? <Icon name="check" size={14}/> : 4}</span><div><strong>End and announce</strong><small>{tournament.status === 'finished' ? 'Ballots locked, invoices sent' : 'Locks ballots, sends invoices'}</small></div></li>
    </ol>
    <div className="results-next">
      {prelimResults.length === 0 ? <p><strong>Next:</strong> results appear as judges submit preliminary ballots.</p>
      : count('ready') > 0 ? <><p><strong>Next:</strong> {count('ready')} {count('ready') === 1 ? 'final is' : 'finals are'} ready. Create them together so each judge lands on the final they most want.</p><Button icon="plus" onClick={store.createAllFinals}>Create {count('ready') === 1 ? 'the final' : `all ${count('ready')} finals`}</Button></>
      : count('prelims') > 0 ? <p><strong>Next:</strong> waiting on {roomsLeft} preliminary {roomsLeft === 1 ? 'room' : 'rooms'}. Check the Issues tab if a judge is missing.</p>
      : count('final') > 0 ? <p><strong>Next:</strong> waiting on {finalBallotsLeft} final {finalBallotsLeft === 1 ? 'ballot' : 'ballots'}. Placings fill in as each final’s judges submit.</p>
      : tournament.status !== 'finished' ? <><p><strong>Next:</strong> every final is placed. Announce awards, then end the tournament to lock ballots and send invoices.</p>{onOpenSetup && <Button variant="secondary" icon="arrow" onClick={onOpenSetup}>Go to End tournament</Button>}</>
      : <p><strong>Done.</strong> Results are final. Coaches can now release ballots to their students.</p>}
      {count('done') > 0 && <Button variant="secondary" icon="download" onClick={exportResults}>Download results</Button>}
    </div>
  </section>;

  if (sections.length === 0) return <div className="issue-board"><section className="panel"><div className="schedule-empty"><span className="upload-illustration"><Icon name="clock" size={30}/></span><h3>Build the schedule first</h3><p>Breaks and finals are worked out from the preliminary rounds. Build the schedule on the Setup tab, then come back here.</p></div></section></div>;

  return <div className="results-layout">
    <div className="results-main">
      {flow}
      <section className="panel">
        <div className="panel-head"><div><h2>Preliminary rounds</h2><p>{tournament.rounds} rounds, one judge per room. The lowest cumulative rank advances; the top {FINALISTS} go to the final.</p></div>
          <span className="panel-head-actions">{store.resultsAreReal ? <><Badge tone="success" icon="check">From {new Set(prelimResults.map(result => result.sectionId)).size} submitted {new Set(prelimResults.map(result => result.sectionId)).size === 1 ? 'ballot' : 'ballots'}</Badge><Button variant="secondary" onClick={() => store.refresh()}>Refresh</Button></> : <>{hasPrelims && <Button variant="secondary" onClick={store.clearResults}>Clear results</Button>}<Button icon="sparkle" variant={hasPrelims ? 'secondary' : 'primary'} onClick={store.fillSamplePrelims}>{hasPrelims ? 'New sample results' : 'Fill in sample results'}</Button></>}</span></div>
        {!hasPrelims ? <div className="schedule-empty"><h3>No results yet</h3><p>{store.live ? 'Results appear here as judges submit their ballots. You can also fill in sample results to see how breaks, finals, and team points work.' : 'In a real tournament these come from judges’ submitted ballots. Fill in sample results to see how breaks, finals, and team points work.'}</p></div> : <>
          <div className="results-events" role="tablist" aria-label="Events">{events.map(id => { const done = placingsFor(id).length > 0; return <button key={id} role="tab" aria-selected={eventId === id} className={eventId === id ? 'active' : ''} onClick={() => setChosen(id)}>{eventName(id)}{done && <Icon name="check" size={14}/>}</button>; })}</div>
          <div className="results-table" role="list" tabIndex={0} aria-label={`${eventName(eventId)} preliminary standings`}>
            <div className="results-row results-head" role="listitem"><span>Place</span><span>Speaker</span><span>Ranks</span><span>Total</span><span title="Average preliminary rank of everyone this speaker shared a room with">Opp. avg</span><span>Recip.</span><span>Rating pts</span><span/></div>
            {standings.map((standing, index) => <div key={standing.entryId} role="listitem" className={`results-row ${standing.advances ? 'in' : ''} ${index === finalists.length - 1 ? 'cut' : ''}`}>
              <span className="results-place">{standing.place}</span>
              <span className="results-name"><strong>{standing.student}{entryLoad(entries, standing.student, standing.school) > 1 && <em className="load-tag" title={loadLabel(entryLoad(entries, standing.student, standing.school))}>{entryLoad(entries, standing.student, standing.school)}×</em>}</strong><small>{standing.school}</small></span>
              <span className="results-num">{standing.ranks.join(' · ')}</span>
              <span className="results-num strong">{standing.cumulativeRank}</span>
              <span className="results-num">{standing.opponentsAverageRank.toFixed(2)}</span>
              <span className="results-num">{standing.reciprocals.toFixed(2)}</span>
              <span className="results-num">{standing.ratingPoints}</span>
              <span className="results-status">{standing.advances ? <Badge tone="success" icon="check">Finalist</Badge> : null}{standing.decidedBy && <small>{standing.decidedBy === 'Still tied' ? 'Still tied' : `Tie broken by ${standing.decidedBy.toLowerCase()}`}</small>}</span>
            </div>)}
          </div>
          <p className="results-rule"><Icon name="info" size={14}/> {standings.length <= FINALISTS ? `With ${standings.length} entries, everyone advances to the final.` : cutTie ? `${finalists.length} speakers advance because a tie at the cut line could not be broken.` : 'Ties are broken in order: opponents’ average rank, head-to-head, reciprocals, then rating points.'}</p>
        </>}
      </section>

      {hasPrelims && <section className="panel">
        <div className="panel-head"><div><h2>{eventName(eventId)} final</h2><p>{finalists.length} finalists, {seats} judges. Placed on lowest cumulative rank{seats >= 3 ? ', then judge’s preference' : ''}, then reciprocals and rating points.</p></div>
          {rooms.length === 0 && <span className="panel-head-actions"><Button icon="sparkle" variant="secondary" onClick={() => store.fillSampleFinals(eventId)}>{placings.length ? 'New sample final' : 'Fill in sample final'}</Button>{placings.length === 0 && <Button icon="plus" onClick={() => store.createFinal(eventId)}>Create final round</Button>}</span>}</div>
        {rooms.length > 0 && <div className="final-seats"><div className="final-seats-head"><strong>{rooms[0].room}</strong><Badge tone={ballotsIn(eventId) === rooms.length ? 'success' : 'warning'} icon={ballotsIn(eventId) === rooms.length ? 'check' : 'clock'}>{ballotsIn(eventId)} of {rooms.length} ballots in</Badge></div>
          {rooms.map((room, index) => { const done = store.roomResults.some(result => result.sectionId === room.id); return <div key={room.id} className="final-seat"><span>Judge {index + 1}</span><select aria-label={`Final judge ${index + 1}`} value={room.judgeId ?? ''} disabled={done} onChange={event => store.assignJudge(room.id, event.target.value || null)}><option value="">Needs a judge</option>{store.judges.map(judge => { const why = conflictOf(judge.id); const taken = finalRooms.some(other => other.id !== room.id && other.judgeId === judge.id); return <option key={judge.id} value={judge.id} disabled={why !== '' || taken}>{judge.name} · {why ? conflictText[why] : taken ? 'already on a final' : levelText[preferenceFor(store.judgePreferences[judge.id], eventId)].toLowerCase()}</option>; })}</select><span className="final-seat-status">{room.judgeId && !done && <Badge tone={preferenceFor(store.judgePreferences[room.judgeId], eventId) === 'top' ? 'success' : preferenceFor(store.judgePreferences[room.judgeId], eventId) === 'avoid' ? 'pink' : 'neutral'}>{levelText[preferenceFor(store.judgePreferences[room.judgeId], eventId)]}</Badge>}<Badge tone={done ? 'success' : room.judgeId ? 'neutral' : 'warning'} icon={done ? 'check' : undefined}>{done ? 'Ballot submitted' : room.judgeId ? 'Waiting for ballot' : 'Needs a judge'}</Badge>{!store.live && !done && <button onClick={() => store.recordRoomResults(room.id, sampleFinals(finalists, index + 1).filter(result => result.judge === index + 1).map(result => ({ entryId: result.entryId, rank: result.rank, rating: result.rating })))}>Fill sample ballot</button>}</span></div>; })}
          {!finalReady(eventId) && <p className="results-rule"><Icon name="info" size={14}/> Placings and team points appear once every final-round judge has submitted. Each judge opens this final from their own list of rooms. Finals judges are chosen by preference and never judge the final of an event they judged in prelims.</p>}</div>}
        {placings.length === 0 ? <ol className="finalist-list">{finalists.map(finalist => <li key={finalist.entryId}><strong>{finalist.student}</strong><small>{finalist.school} · {ordinal(finalist.place)} after prelims</small></li>)}</ol> : <div className="results-table" role="list" tabIndex={0} aria-label={`${eventName(eventId)} final placings`}>
          <div className="results-row results-head final" role="listitem"><span>Place</span><span>Speaker</span><span>Judges’ ranks</span><span>Total</span><span>Recip.</span><span>Rating pts</span><span>Team pts</span><span/></div>
          {placings.map(placing => <div key={placing.entryId} role="listitem" className={`results-row final ${placing.place === 1 ? 'champion' : ''}`}>
            <span className="results-place">{placing.place}</span>
            <span className="results-name"><strong>{placing.student}</strong><small>{placing.school}</small></span>
            <span className="results-num">{placing.judgeRanks.join(' · ')}</span>
            <span className="results-num strong">{placing.cumulativeRank}</span>
            <span className="results-num">{placing.reciprocals.toFixed(2)}</span>
            <span className="results-num">{placing.ratingPoints}</span>
            <span className="results-num strong">{placing.teamPoints}</span>
            <span className="results-status">{placing.decidedBy && <small>{placing.decidedBy.startsWith('Tied') ? placing.decidedBy : `Tie broken by ${placing.decidedBy.toLowerCase()}`}</small>}</span>
          </div>)}
        </div>}
      </section>}
    </div>

    <aside className="results-aside">
      <section className="panel">
        <div className="panel-head"><div><h2>Team points</h2><p>{finalsDone} of {events.length} finals in</p></div></div>
        {teams.length === 0 ? <p className="team-ballots-empty">Team points come from final rounds only. They appear here as each final is scored.</p> : <ol className="team-points">{teams.map((team, index) => <li key={team.school} className={index === 0 ? 'lead' : ''}><span>{index + 1}</span><div><strong>{team.school}</strong><small>{team.finalists} {team.finalists === 1 ? 'finalist' : 'finalists'}</small></div><b>{team.points}</b></li>)}</ol>}
      </section>
      <section className="panel results-settings">
        <div className="panel-head"><div><h2>Rules for this tournament</h2><p>Defaults follow the NSAA manual</p></div></div>
        <label><span>Judges in each final</span><select value={judges} onChange={event => store.updateTournament({ finalJudges: Number(event.target.value) })}><option value={2}>2 judges (districts)</option><option value={3}>3 judges (state)</option></select></label>
        <fieldset><legend>Team points for 1st to 6th</legend><div>{points.map((value, index) => <input key={index} aria-label={`Points for ${ordinal(index + 1)}`} inputMode="numeric" value={value} onChange={event => store.updateTournament({ teamPoints: points.map((old, i) => i === index ? Number(event.target.value.replace(/\D/g, '')) || 0 : old) })}/>)}</div>
          {points.join() !== NSAA_TEAM_POINTS.join() && <button type="button" onClick={() => store.updateTournament({ teamPoints: NSAA_TEAM_POINTS })}>Use the NSAA scale (20-18-16-14-12-10)</button>}</fieldset>
        {events.some(id => parseContest(id).division === 'novice') && <label className="check-setting"><input type="checkbox" checked={tournament.noviceTeamPoints ?? false} onChange={event => store.updateTournament({ noviceTeamPoints: event.target.checked })}/><span><strong>Novice finals earn team points</strong><small>Usually off. Turn on if this tournament counts novice placings toward the team award.</small></span></label>}
      </section>
    </aside>
  </div>;
}
