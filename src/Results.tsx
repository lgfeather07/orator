import { useState } from 'react';
import { Badge, Button, Icon, downloadText } from './ui';
import { useStore } from './store';
import { ballotEvents } from './ballots';
import { contestKey, contestOf, divisions, entryLoad, finalConflict, isFinal, loadLabel, parseContest, preferenceFor, stageOf as sectionStage, prelimsOnly } from './tournament';
import { NSAA_TEAM_POINTS, cutFor, finalPlacings, prelimStandings, sampleFinals, semifinalistPlacings, teamStandings, type Placing, type Standing, FINALISTS, prelimPlacings } from './results';
import { CutOverview, CutPreview, NextIn } from './CutPreview';
import { SemifinalsPanel } from './Semifinals';
import { semiPlanFor, semiProgress } from './semis';
import { PublishResults } from './PublishResults';
import { AwardsScript, printNow } from './PrintCenter';

/** "Informative" for varsity, "Novice Informative" for the novice division. */
const eventName = (key: string) => { const { eventId, division } = parseContest(key); const name = ballotEvents.find(event => event.id === eventId)?.name ?? eventId; return division === 'novice' ? `Novice ${name}` : name; };
const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4) % 4]}`;

/** Breaks, finals, and team points for the director, following the NSAA Speech Manual. */
export function ResultsBoard({ onOpenSetup }: { onOpenSetup?: () => void }) {
  const store = useStore();
  const { tournament, entries, prelimResults, finalResults } = store;
  const sections = store.sections.filter(section => !isFinal(section, tournament));
  // Finals only; semifinal rooms are shown in their own panel (Semifinals.tsx).
  const finalRooms = store.sections.filter(section => sectionStage(section, tournament) === 'final');
  // One tab per contest: an event in a division. Novice and varsity break and place separately.
  const events = tournament.eventIds.flatMap(id => divisions.map(division => contestKey(id, division))).filter(key => entries.some(entry => contestOf(entry) === key));
  const [chosen, setChosen] = useState('');
  const eventId = events.includes(chosen) ? chosen : events[0] ?? '';
  const judges = tournament.finalJudges ?? 2;
  const points = tournament.teamPoints ?? NSAA_TEAM_POINTS;

  // With semifinals, the prelim cut is the semifinal size: those speakers "advance" from prelims.
  const semiPlan = (id: string) => semiPlanFor(tournament, id);
  const standingsFor = (id: string): Standing[] => prelimStandings(entries.filter(entry => contestOf(entry) === id), sections.filter(section => contestOf(section) === id), prelimResults, semiPlan(id)?.size ?? cutFor(tournament, id));
  const semisFor = (id: string) => semiProgress(store.sections, id, tournament, standingsFor(id), store.roomResults);
  // Once a final is created, its finalists are whoever is in the room: a next-in speaker may have moved up.
  // Before that, with semifinals, they are whoever advanced from the semifinal rooms (nobody until every semifinal ballot is in).
  const finalistsFor = (id: string): Standing[] => { const room = finalRooms.find(item => contestOf(item) === id); const semis = !room && semiPlan(id) ? semisFor(id) : null; return standingsFor(id).filter(standing => room ? room.entryIds.includes(standing.entryId) : semis ? semis.advancers.includes(standing.entryId) : standing.advances); };
  // With real final rooms, placings wait until every final-round judge has submitted.
  const ballotsIn = (id: string) => finalRooms.filter(room => contestOf(room) === id && store.roomResults.some(result => result.sectionId === room.id)).length;
  const finalReady = (id: string) => { const rooms = finalRooms.filter(room => contestOf(room) === id); return rooms.length === 0 || ballotsIn(id) === rooms.length; };
  // No final round: once every preliminary room of a contest is in, its standings are the placings.
  const noFinals = prelimsOnly(tournament);
  const awarded = tournament.placesAwarded ?? FINALISTS;
  const prelimComplete = (id: string) => { const rooms = sections.filter(section => contestOf(section) === id); return rooms.length > 0 && rooms.every(room => prelimResults.some(result => result.sectionId === room.id)); };
  const placingsFor = (id: string): Placing[] => noFinals ? (prelimComplete(id) ? prelimPlacings(standingsFor(id), points, awarded) : []) : finalReady(id) ? finalPlacings(finalistsFor(id), finalResults, points) : [];
  /** Semifinalists who didn't make the final, placed after the finalists once the final is placed. */
  const semifinalistsFor = (id: string): Placing[] => semiPlan(id) && placingsFor(id).length > 0 ? semifinalistPlacings(semisFor(id).standings, points) : [];
  /** Final placings, plus semifinalists only where the team-point scale reaches their place. */
  const scoringPlacingsFor = (id: string): Placing[] => [...placingsFor(id), ...semifinalistsFor(id).filter(placing => placing.teamPoints > 0)];
  const standings = eventId ? standingsFor(eventId) : [];
  const cut = eventId ? semiPlan(eventId)?.size ?? cutFor(tournament, eventId) : 0;
  const finalists = eventId ? finalistsFor(eventId) : [];
  const placings = eventId ? placingsFor(eventId) : [];
  const semifinalists = eventId ? semifinalistsFor(eventId) : [];
  const usesSemis = eventId ? semiPlan(eventId) !== null : false;
  const semiState = usesSemis ? semisFor(eventId) : null;
  const allPlacings = events.map(id => ({ eventName: eventName(id), placings: scoringPlacingsFor(id) }));
  // Novice finals count toward team points only if the director says so.
  const countsForTeam = (id: string) => tournament.noviceTeamPoints || parseContest(id).division !== 'novice';
  const teams = teamStandings(allPlacings.filter((_, index) => countsForTeam(events[index])));
  const finalsDone = allPlacings.filter(item => item.placings.length > 0).length;
  const hasPrelims = prelimResults.length > 0;
  const cutTie = standings.filter(standing => standing.advances).length > cut;
  const rooms = finalRooms.filter(room => contestOf(room) === eventId);
  const seats = rooms.length || judges;
  const finalistSchools = finalists.map(finalist => finalist.school);
  const conflictOf = (judgeId: string | null) => { const judge = store.judges.find(item => item.id === judgeId); return judge ? finalConflict(judge, eventId, finalistSchools, store.sections, tournament) : ''; };
  const conflictText = { '': '', school: 'from a finalist’s school', knows: 'knows a finalist’s school', prelim: 'judged this event in prelims', semi: 'judged this event’s semifinal' };
  const levelText = { top: 'Top choice', willing: 'Willing', avoid: 'Prefers to avoid' };

  // Where each contest is, so the director always knows the next thing to do.
  const prelimRoomsIn = (id: string) => { const rooms = sections.filter(section => contestOf(section) === id); return { done: rooms.filter(room => prelimResults.some(result => result.sectionId === room.id)).length, total: rooms.length }; };
  const stageOf = (id: string): 'prelims' | 'ready' | 'semis' | 'final' | 'done' => {
    const prelim = prelimRoomsIn(id);
    if (prelim.done < prelim.total) return 'prelims';
    if (placingsFor(id).length > 0) return 'done';
    if (finalRooms.some(room => contestOf(room) === id)) return 'final';
    if (semiPlan(id)) { const semis = semisFor(id); if (semis.rooms.length > 0 && !semis.complete) return 'semis'; }
    return 'ready';
  };
  const stages = events.map(id => ({ id, stage: stageOf(id) }));
  const count = (stage: string) => stages.filter(item => item.stage === stage).length;
  const roomsLeft = events.reduce((sum, id) => { const prelim = prelimRoomsIn(id); return sum + prelim.total - prelim.done; }, 0);
  const finalBallotsLeft = finalRooms.filter(room => !store.roomResults.some(result => result.sectionId === room.id)).length;
  // Semifinals: contests that hold them, and which "ready" contests need semifinals rather than a final next.
  const semiContests = events.filter(id => semiPlan(id));
  const readySemis = stages.filter(item => item.stage === 'ready' && semiPlan(item.id) && semisFor(item.id).rooms.length === 0).length;
  const readyFinals = count('ready') - readySemis;
  const semiBallotsLeft = semiContests.reduce((total, id) => { const semis = semisFor(id); return total + semis.ballots - semis.ballotsIn; }, 0);
  const semisDone = semiContests.filter(id => semisFor(id).complete).length;
  const createLabel = readySemis === 0 ? (count('ready') === 1 ? 'the final' : `all ${count('ready')} finals`) : readyFinals === 0 ? (readySemis === 1 ? 'the semifinals' : `semifinals for ${readySemis} contests`) : `${readyFinals} ${readyFinals === 1 ? 'final' : 'finals'} and ${readySemis} ${readySemis === 1 ? 'semifinal round' : 'semifinal rounds'}`;
  const exportResults = () => {
    const quote = (text: string | number) => `"${String(text).replace(/"/g, '""')}"`;
    const lines = [['Event', 'Place', 'Speaker', 'School', 'Judges’ ranks', 'Team points'].map(quote).join(',')];
    events.forEach(id => [...placingsFor(id), ...semifinalistsFor(id)].forEach(placing => lines.push([eventName(id), placing.decidedBy === 'Semifinalist' ? `${placing.place} (semifinalist)` : placing.place, placing.student, placing.school, placing.judgeRanks.join(' '), placing.teamPoints].map(quote).join(','))));
    lines.push('', ['Team', 'Points'].map(quote).join(','), ...teamStandings(events.filter(countsForTeam).map(id => ({ eventName: eventName(id), placings: scoringPlacingsFor(id) }))).map(team => [team.school, team.points].map(quote).join(',')));
    downloadText(`${tournament.name.replace(/\W+/g, '-').toLowerCase() || 'tournament'}-results.csv`, lines.join('\n'));
  };
  const placedCount = events.filter(id => placingsFor(id).length > 0).length;
  const flow = noFinals ? <section className="panel results-flow" aria-label="Results progress">
    <ol className="results-steps two">
      <li className={roomsLeft === 0 && prelimResults.length > 0 ? 'done' : 'current'}><span>{roomsLeft === 0 && prelimResults.length > 0 ? <Icon name="check" size={14}/> : 1}</span><div><strong>Preliminary ballots</strong><small>{prelimResults.length === 0 ? 'None in yet' : roomsLeft === 0 ? 'Every room is in' : `${roomsLeft} ${roomsLeft === 1 ? 'room' : 'rooms'} still out · ${placedCount} of ${events.length} events placed`}</small></div></li>
      <li className={tournament.status === 'finished' ? 'done' : roomsLeft === 0 && prelimResults.length > 0 ? 'current' : ''}><span>{tournament.status === 'finished' ? <Icon name="check" size={14}/> : 2}</span><div><strong>End and announce</strong><small>{tournament.status === 'finished' ? 'Ballots locked, invoices sent' : 'Locks ballots, sends invoices'}</small></div></li>
    </ol>
    <div className="results-next">
      {prelimResults.length === 0 ? <p><strong>No final round.</strong> Places come from the {tournament.rounds} preliminary rounds and appear as each event’s ballots are all in.</p>
      : roomsLeft > 0 ? <p><strong>Next:</strong> waiting on {roomsLeft} preliminary {roomsLeft === 1 ? 'room' : 'rooms'}. {placedCount > 0 ? `${placedCount} ${placedCount === 1 ? 'event is' : 'events are'} already placed.` : ''} Check the Issues tab if a judge is missing.</p>
      : tournament.status !== 'finished' ? <><p><strong>Next:</strong> every event is placed from the preliminary rounds. Announce awards, then end the tournament to lock ballots and send invoices.</p>{onOpenSetup && <Button variant="secondary" icon="arrow" onClick={onOpenSetup}>Go to End tournament</Button>}</>
      : <p><strong>Done.</strong> Results are final. Coaches can now release ballots to their students.</p>}
      {placedCount > 0 && <Button variant="secondary" icon="download" onClick={exportResults}>Download results</Button>}<Button variant="secondary" icon="file" onClick={printNow} disabled={teams.length === 0 && !events.some(id => placingsFor(id).length)}>Print awards script</Button>
    </div>
  </section> : <section className="panel results-flow" aria-label="Results progress">
    <ol className={`results-steps ${semiContests.length ? 'five' : ''}`}>
      <li className={roomsLeft === 0 && prelimResults.length > 0 ? 'done' : 'current'}><span>{roomsLeft === 0 && prelimResults.length > 0 ? <Icon name="check" size={14}/> : 1}</span><div><strong>Preliminary ballots</strong><small>{prelimResults.length === 0 ? 'None in yet' : roomsLeft === 0 ? 'Every room is in' : `${roomsLeft} ${roomsLeft === 1 ? 'room' : 'rooms'} still out`}</small></div></li>
      <li className={count('ready') + count('prelims') === 0 && events.length > 0 ? 'done' : count('ready') > 0 ? 'current' : ''}><span>{count('ready') + count('prelims') === 0 && events.length > 0 ? <Icon name="check" size={14}/> : 2}</span><div><strong>{semiContests.length ? 'Create semifinals and finals' : 'Create finals'}</strong><small>{count('ready') > 0 ? (readySemis ? `${readySemis} ${readySemis === 1 ? 'semifinal round' : 'semifinal rounds'}${readyFinals ? ` and ${readyFinals} ${readyFinals === 1 ? 'final' : 'finals'}` : ''} ready to create` : `${count('ready')} ready to create · ${events.filter(id => stageOf(id) === 'ready').reduce((total, id) => total + finalistsFor(id).length, 0)} finalists`) : count('prelims') > 0 ? 'After prelims are in' : count('semis') > 0 ? 'Finals follow the semifinals' : 'All created'}</small></div></li>
      {semiContests.length > 0 && <li className={semisDone === semiContests.length ? 'done' : count('semis') > 0 ? 'current' : ''}><span>{semisDone === semiContests.length ? <Icon name="check" size={14}/> : 3}</span><div><strong>Semifinal ballots</strong><small>{semisDone} of {semiContests.length} semifinals in{semiBallotsLeft > 0 && count('semis') > 0 ? ` · ${semiBallotsLeft} ballots out` : ''}</small></div></li>}
      <li className={count('done') === events.length && events.length > 0 ? 'done' : count('final') > 0 ? 'current' : ''}><span>{count('done') === events.length && events.length > 0 ? <Icon name="check" size={14}/> : semiContests.length ? 4 : 3}</span><div><strong>Final ballots</strong><small>{count('done')} of {events.length} finals placed{finalBallotsLeft > 0 ? ` · ${finalBallotsLeft} ballots out` : ''}</small></div></li>
      <li className={tournament.status === 'finished' ? 'done' : count('done') === events.length && events.length > 0 ? 'current' : ''}><span>{tournament.status === 'finished' ? <Icon name="check" size={14}/> : semiContests.length ? 5 : 4}</span><div><strong>End and announce</strong><small>{tournament.status === 'finished' ? 'Ballots locked, invoices sent' : 'Locks ballots, sends invoices'}</small></div></li>
    </ol>
    <div className="results-next">
      {prelimResults.length === 0 ? <p><strong>Next:</strong> results appear as judges submit preliminary ballots.</p>
      : count('ready') > 0 ? <><p><strong>Next:</strong> {readySemis === 0 ? <>{count('ready')} {count('ready') === 1 ? 'final is' : 'finals are'} ready. Create them together so each judge lands on the final they most want.</> : <>{readyFinals > 0 ? `${readyFinals} ${readyFinals === 1 ? 'final' : 'finals'} and ` : ''}{readySemis} {readySemis === 1 ? 'semifinal round is' : 'semifinal rounds are'} ready. Create them together so judges are shared fairly; nobody judges two rooms in the same round.</>}</p><Button icon="plus" onClick={store.createAllFinals}>Create {createLabel}</Button></>
      : count('prelims') > 0 ? <p><strong>Next:</strong> waiting on {roomsLeft} preliminary {roomsLeft === 1 ? 'room' : 'rooms'}. Check the Issues tab if a judge is missing.</p>
      : count('semis') > 0 ? <p><strong>Next:</strong> waiting on {semiBallotsLeft} semifinal {semiBallotsLeft === 1 ? 'ballot' : 'ballots'}. Each contest’s final can be created as soon as its semifinals are in.</p>
      : count('final') > 0 ? <p><strong>Next:</strong> waiting on {finalBallotsLeft} final {finalBallotsLeft === 1 ? 'ballot' : 'ballots'}. Placings fill in as each final’s judges submit.</p>
      : tournament.status !== 'finished' ? <><p><strong>Next:</strong> every final is placed. Announce awards, then end the tournament to lock ballots and send invoices.</p>{onOpenSetup && <Button variant="secondary" icon="arrow" onClick={onOpenSetup}>Go to End tournament</Button>}</>
      : <p><strong>Done.</strong> Results are final. Coaches can now release ballots to their students.</p>}
      {count('done') > 0 && <Button variant="secondary" icon="download" onClick={exportResults}>Download results</Button>}<Button variant="secondary" icon="file" onClick={printNow} disabled={teams.length === 0 && !events.some(id => placingsFor(id).length)}>Print awards script</Button>
    </div>
  </section>;

  if (sections.length === 0) return <div className="issue-board"><section className="panel"><div className="schedule-empty"><span className="upload-illustration"><Icon name="clock" size={30}/></span><h3>Build the schedule first</h3><p>Breaks and finals are worked out from the preliminary rounds. Build the schedule on the Setup tab, then come back here.</p></div></section></div>;

  return <div className="results-layout">
    <AwardsScript tournamentName={tournament.name} events={events.map(id => ({ name: eventName(id), placings: placingsFor(id) }))} teams={teams}/>
    <div className="results-main">
      {flow}
      <PublishResults contests={events.map(id => ({ contest: id, placings: placingsFor(id) }))} teams={teams}/>
      {hasPrelims && !noFinals && <CutOverview events={events} eventName={eventName} standingsFor={standingsFor} onOpen={setChosen}/>}
      <section className="panel">
        <div className="panel-head"><div><h2>{noFinals ? 'Placings' : 'Preliminary rounds'}</h2><p>{noFinals ? `${tournament.rounds} rounds, one judge per room, no final. Lowest cumulative rank wins; the top ${awarded} places are announced and earn team points.` : `${tournament.rounds} rounds, one judge per room. The lowest cumulative rank advances; the top ${cut} go to the ${usesSemis ? 'semifinals' : 'final'}.`}</p></div>
          <span className="panel-head-actions">{store.resultsAreReal ? <><Badge tone="success" icon="check">From {new Set(prelimResults.map(result => result.sectionId)).size} submitted {new Set(prelimResults.map(result => result.sectionId)).size === 1 ? 'ballot' : 'ballots'}</Badge><Button variant="secondary" onClick={() => store.refresh()}>Refresh</Button></> : <>{hasPrelims && <Button variant="secondary" onClick={store.clearResults}>Clear results</Button>}<Button icon="sparkle" variant={hasPrelims ? 'secondary' : 'primary'} onClick={store.fillSamplePrelims}>{hasPrelims ? 'New sample results' : 'Fill in sample results'}</Button></>}</span></div>
        {!hasPrelims ? <div className="schedule-empty"><h3>No results yet</h3><p>{store.live ? 'Results appear here as judges submit their ballots. You can also fill in sample results to see how breaks, finals, and team points work.' : 'In a real tournament these come from judges’ submitted ballots. Fill in sample results to see how breaks, finals, and team points work.'}</p></div> : <>
          <div className="results-events" role="tablist" aria-label="Events">{events.map(id => { const done = placingsFor(id).length > 0; return <button key={id} role="tab" aria-selected={eventId === id} className={eventId === id ? 'active' : ''} onClick={() => setChosen(id)}>{eventName(id)}{done && <Icon name="check" size={14}/>}</button>; })}</div>
          <div className="results-table" role="list" tabIndex={0} aria-label={`${eventName(eventId)} preliminary standings`}>
            <div className="results-row results-head" role="listitem"><span>Place</span><span>Speaker</span><span>Ranks</span><span>Total</span><span title="Average preliminary rank of everyone this speaker shared a room with">Opp. avg</span><span>Recip.</span><span>Rating pts</span><span/></div>
            {standings.map((standing, index) => <div key={standing.entryId} role="listitem" className={`results-row ${noFinals ? (standing.place <= awarded ? 'in' : '') : standing.advances ? 'in' : ''} ${noFinals ? (standing.place <= awarded && !(standings[index + 1]?.place <= awarded) ? 'cut' : '') : standing.advances && !standings[index + 1]?.advances ? 'cut' : ''} ${noFinals && standing.place === 1 && prelimComplete(eventId) ? 'champion' : ''}`}>
              <span className="results-place">{standing.place}</span>
              <span className="results-name"><strong>{standing.student}{entryLoad(entries, standing.student, standing.school) > 1 && <em className="load-tag" title={loadLabel(entryLoad(entries, standing.student, standing.school))}>{entryLoad(entries, standing.student, standing.school)}×</em>}</strong><small>{standing.school}</small></span>
              <span className="results-num">{standing.ranks.join(' · ')}</span>
              <span className="results-num strong">{standing.cumulativeRank}</span>
              <span className="results-num">{standing.opponentsAverageRank.toFixed(2)}</span>
              <span className="results-num">{standing.reciprocals.toFixed(2)}</span>
              <span className="results-num">{standing.ratingPoints}</span>
              <span className="results-status">{noFinals ? (standing.place <= awarded ? <Badge tone="success" icon={prelimComplete(eventId) ? 'check' : 'clock'}>{prelimComplete(eventId) ? `${ordinal(standing.place)} place${placings.find(placing => placing.entryId === standing.entryId)?.teamPoints ? ` · ${placings.find(placing => placing.entryId === standing.entryId)!.teamPoints} pts` : ''}` : `${ordinal(standing.place)} so far`}</Badge> : null) : standing.advances ? <Badge tone="success" icon="check">{usesSemis ? 'Semifinalist' : 'Finalist'}</Badge> : null}{standing.decidedBy && <small>{standing.decidedBy === 'Still tied' ? 'Still tied' : `Tie broken by ${standing.decidedBy.toLowerCase()}`}</small>}</span>
            </div>)}
          </div>
          <p className="results-rule"><Icon name="info" size={14}/> {standings.length <= cut ? `With ${standings.length} entries, everyone advances to the ${usesSemis ? 'semifinals' : 'final'}.` : cutTie ? `${standings.filter(standing => standing.advances).length} speakers advance because a tie at the cut line could not be broken.` : 'Ties are broken in order: opponents’ average rank, head-to-head, reciprocals, then rating points.'}</p>
        </>}
      </section>

      {hasPrelims && !noFinals && rooms.length === 0 && placings.length === 0 && eventId && !semiState?.rooms.length && <CutPreview contest={eventId} name={eventName(eventId)} standings={standings}/>}
      {hasPrelims && !noFinals && usesSemis && eventId && <SemifinalsPanel contest={eventId} name={eventName(eventId)} standings={standings}/>}
      {hasPrelims && !noFinals && <section className="panel">
        <div className="panel-head"><div><h2>{eventName(eventId)} final</h2><p>{usesSemis && finalists.length === 0 ? `Finalists are the top ${semiPlan(eventId)!.advance} in each semifinal room, once every semifinal ballot is in. ${seats} judges.` : `${finalists.length} finalists${usesSemis ? ' from the semifinals' : ''}, ${seats} judges.`} Placed on lowest cumulative rank{seats >= 3 ? ', then judge’s preference' : ''}, then reciprocals and rating points.</p></div>
          {rooms.length === 0 && finalists.length > 0 && <span className="panel-head-actions"><Button icon="sparkle" variant="secondary" onClick={() => store.fillSampleFinals(eventId)}>{placings.length ? 'New sample final' : 'Fill in sample final'}</Button>{placings.length === 0 && <Button icon="plus" onClick={() => store.createFinal(eventId)}>Create final round</Button>}</span>}</div>
        {rooms.length > 0 && <div className="final-seats"><div className="final-seats-head"><strong>{rooms[0].room}</strong><Badge tone={ballotsIn(eventId) === rooms.length ? 'success' : 'warning'} icon={ballotsIn(eventId) === rooms.length ? 'check' : 'clock'}>{ballotsIn(eventId)} of {rooms.length} ballots in</Badge></div>
          {rooms.map((room, index) => { const done = store.roomResults.some(result => result.sectionId === room.id); return <div key={room.id} className="final-seat"><span>Judge {index + 1}</span><select aria-label={`Final judge ${index + 1}`} value={room.judgeId ?? ''} disabled={done} onChange={event => store.assignJudge(room.id, event.target.value || null)}><option value="">Needs a judge</option>{store.judges.map(judge => { const why = conflictOf(judge.id); const takenBy = store.sections.find(other => other.id !== room.id && other.judgeId === judge.id && isFinal(other, tournament) && other.round === room.round); const taken = takenBy !== undefined; return <option key={judge.id} value={judge.id} disabled={why !== '' || taken}>{judge.name} · {why ? conflictText[why] : taken ? (sectionStage(takenBy, tournament) === 'semi' ? 'judging a semifinal then' : 'already on a final') : levelText[preferenceFor(store.judgePreferences[judge.id], eventId)].toLowerCase()}</option>; })}</select><span className="final-seat-status">{room.judgeId && !done && <Badge tone={preferenceFor(store.judgePreferences[room.judgeId], eventId) === 'top' ? 'success' : preferenceFor(store.judgePreferences[room.judgeId], eventId) === 'avoid' ? 'pink' : 'neutral'}>{levelText[preferenceFor(store.judgePreferences[room.judgeId], eventId)]}</Badge>}<Badge tone={done ? 'success' : room.judgeId ? 'neutral' : 'warning'} icon={done ? 'check' : undefined}>{done ? 'Ballot submitted' : room.judgeId ? 'Waiting for ballot' : 'Needs a judge'}</Badge>{!store.live && !done && <button onClick={() => store.recordRoomResults(room.id, sampleFinals(finalists, index + 1).filter(result => result.judge === index + 1).map(result => ({ entryId: result.entryId, rank: result.rank, rating: result.rating })))}>Fill sample ballot</button>}</span></div>; })}
          {!usesSemis && <NextIn contest={eventId} standings={standings} inFinal={rooms[0].entryIds} mode={ballotsIn(eventId) > 0 ? 'locked' : 'open'}/>}
          {!finalReady(eventId) && <p className="results-rule"><Icon name="info" size={14}/> Placings and team points appear once every final-round judge has submitted. Each judge opens this final from their own list of rooms. Finals judges are chosen by preference and never judge the final of an event they judged in prelims.</p>}</div>}
        {placings.length === 0 ? <><ol className="finalist-list">{finalists.map(finalist => <li key={finalist.entryId}><strong>{finalist.student}</strong><small>{finalist.school} · {ordinal(finalist.place)} after prelims</small></li>)}</ol>{usesSemis && finalists.length === 0 && <p className="results-rule"><Icon name="info" size={14}/> {semiState?.rooms.length ? 'The final can be created once every semifinal ballot is in.' : 'Create the semifinals first. The final follows them.'}</p>}{rooms.length === 0 && !usesSemis && <NextIn contest={eventId} standings={standings} inFinal={finalists.map(finalist => finalist.entryId)} mode="preview"/>}</> : <div className="results-table" role="list" tabIndex={0} aria-label={`${eventName(eventId)} final placings`}>
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
          {semifinalists.map(placing => <div key={placing.entryId} role="listitem" className="results-row final semifinalist">
            <span className="results-place">{placing.place}</span>
            <span className="results-name"><strong>{placing.student}</strong><small>{placing.school}</small></span>
            <span className="results-num">{placing.judgeRanks.join(' · ')}</span>
            <span className="results-num strong">{placing.cumulativeRank}</span>
            <span className="results-num">{placing.reciprocals.toFixed(2)}</span>
            <span className="results-num">{placing.ratingPoints}</span>
            <span className="results-num strong">{placing.teamPoints}</span>
            <span className="results-status"><Badge tone="neutral">Semifinalist</Badge><small>Ranks from the semifinal</small></span>
          </div>)}
        </div>}
      </section>}
    </div>

    <aside className="results-aside">
      <section className="panel">
        <div className="panel-head"><div><h2>Team points</h2><p>{finalsDone} of {events.length} {noFinals ? 'events placed' : 'finals in'}</p></div></div>
        {teams.length === 0 ? <p className="team-ballots-empty">{noFinals ? `Team points come from the top ${awarded} places in each event. They appear as each event’s preliminary ballots are all in.` : 'Team points come from final rounds only. They appear here as each final is scored.'}</p> : <ol className="team-points">{teams.map((team, index) => <li key={team.school} className={index === 0 ? 'lead' : ''}><span>{index + 1}</span><div><strong>{team.school}</strong><small>{team.finalists} {noFinals ? 'placed' : team.finalists === 1 ? 'finalist' : 'finalists'}</small></div><b>{team.points}</b></li>)}</ol>}
      </section>
      <section className="panel results-settings">
        <div className="panel-head"><div><h2>Rules for this tournament</h2><p>Defaults follow the NSAA manual</p></div></div>
        {!noFinals && <label><span>Judges in each final</span><select value={judges} onChange={event => store.updateTournament({ finalJudges: Number(event.target.value) })}><option value={2}>2 judges (districts)</option><option value={3}>3 judges (state)</option></select></label>}
        <fieldset><legend>Team points for 1st to 6th</legend><div>{points.map((value, index) => <input key={index} aria-label={`Points for ${ordinal(index + 1)}`} inputMode="numeric" value={value} onChange={event => store.updateTournament({ teamPoints: points.map((old, i) => i === index ? Number(event.target.value.replace(/\D/g, '')) || 0 : old) })}/>)}</div>
          {points.join() !== NSAA_TEAM_POINTS.join() && <button type="button" onClick={() => store.updateTournament({ teamPoints: NSAA_TEAM_POINTS })}>Use the NSAA scale (20-18-16-14-12-10)</button>}</fieldset>
        {events.some(id => parseContest(id).division === 'novice') && <label className="check-setting"><input type="checkbox" checked={tournament.noviceTeamPoints ?? false} onChange={event => store.updateTournament({ noviceTeamPoints: event.target.checked })}/><span><strong>Novice finals earn team points</strong><small>Usually off. Turn on if this tournament counts novice placings toward the team award.</small></span></label>}
      </section>
    </aside>
  </div>;
}
