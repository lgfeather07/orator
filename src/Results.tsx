import { useState } from 'react';
import { Badge, Button, Icon } from './ui';
import { useStore } from './store';
import { ballotEvents } from './ballots';
import { entryLoad, loadLabel } from './tournament';
import { FINALISTS, NSAA_TEAM_POINTS, finalPlacings, prelimStandings, teamStandings, type Placing, type Standing } from './results';

const eventName = (id: string) => ballotEvents.find(event => event.id === id)?.name ?? id;
const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4) % 4]}`;

/** Breaks, finals, and team points for the director, following the NSAA Speech Manual. */
export function ResultsBoard() {
  const store = useStore();
  const { tournament, entries, sections, prelimResults, finalResults } = store;
  const events = tournament.eventIds.filter(id => entries.some(entry => entry.eventId === id));
  const [chosen, setChosen] = useState('');
  const eventId = events.includes(chosen) ? chosen : events[0] ?? '';
  const judges = tournament.finalJudges ?? 2;
  const points = tournament.teamPoints ?? NSAA_TEAM_POINTS;

  const standingsFor = (id: string): Standing[] => prelimStandings(entries.filter(entry => entry.eventId === id), sections.filter(section => section.eventId === id), prelimResults);
  const placingsFor = (id: string): Placing[] => finalPlacings(standingsFor(id).filter(standing => standing.advances), finalResults, points);
  const standings = eventId ? standingsFor(eventId) : [];
  const finalists = standings.filter(standing => standing.advances);
  const placings = eventId ? placingsFor(eventId) : [];
  const allPlacings = events.map(id => ({ eventName: eventName(id), placings: placingsFor(id) }));
  const teams = teamStandings(allPlacings);
  const finalsDone = allPlacings.filter(item => item.placings.length > 0).length;
  const hasPrelims = prelimResults.length > 0;
  const cutTie = finalists.length > FINALISTS;

  if (sections.length === 0) return <div className="issue-board"><section className="panel"><div className="schedule-empty"><span className="upload-illustration"><Icon name="clock" size={30}/></span><h3>Build the schedule first</h3><p>Breaks and finals are worked out from the preliminary rounds. Build the schedule on the Setup tab, then come back here.</p></div></section></div>;

  return <div className="results-layout">
    <div className="results-main">
      <section className="panel">
        <div className="panel-head"><div><h2>Preliminary rounds</h2><p>{tournament.rounds} rounds, one judge per room. The lowest cumulative rank advances; the top {FINALISTS} go to the final.</p></div>
          <span className="panel-head-actions">{store.resultsAreReal ? <><Badge tone="success" icon="check">From {new Set(prelimResults.map(result => result.sectionId)).size} submitted {new Set(prelimResults.map(result => result.sectionId)).size === 1 ? 'ballot' : 'ballots'}</Badge><Button variant="secondary" onClick={() => store.refresh()}>Refresh</Button></> : <>{hasPrelims && <Button variant="secondary" onClick={store.clearResults}>Clear results</Button>}<Button icon="sparkle" variant={hasPrelims ? 'secondary' : 'primary'} onClick={store.fillSamplePrelims}>{hasPrelims ? 'New sample results' : 'Fill in sample results'}</Button></>}</span></div>
        {!hasPrelims ? <div className="schedule-empty"><h3>No results yet</h3><p>{store.live ? 'Results appear here as judges submit their ballots. You can also fill in sample results to see how breaks, finals, and team points work.' : 'In a real tournament these come from judges’ submitted ballots. Fill in sample results to see how breaks, finals, and team points work.'}</p></div> : <>
          <div className="results-events" role="tablist" aria-label="Events">{events.map(id => { const done = placingsFor(id).length > 0; return <button key={id} role="tab" aria-selected={eventId === id} className={eventId === id ? 'active' : ''} onClick={() => setChosen(id)}>{eventName(id)}{done && <Icon name="check" size={14}/>}</button>; })}</div>
          <div className="results-table" role="table" aria-label={`${eventName(eventId)} preliminary standings`}>
            <div className="results-row results-head" role="row"><span>Place</span><span>Speaker</span><span>Ranks</span><span>Total</span><span title="Average preliminary rank of everyone this speaker shared a room with">Opp. avg</span><span>Recip.</span><span>Rating pts</span><span/></div>
            {standings.map((standing, index) => <div key={standing.entryId} role="row" className={`results-row ${standing.advances ? 'in' : ''} ${index === finalists.length - 1 ? 'cut' : ''}`}>
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
        <div className="panel-head"><div><h2>{eventName(eventId)} final</h2><p>{finalists.length} finalists, {judges} judges. Placed on lowest cumulative rank{judges >= 3 ? ', then judge’s preference' : ''}, then reciprocals and rating points.</p></div>
          <Button icon="sparkle" variant={placings.length ? 'secondary' : 'primary'} onClick={() => store.fillSampleFinals(eventId)}>{placings.length ? 'New sample final' : 'Fill in sample final'}</Button></div>
        {placings.length === 0 ? <ol className="finalist-list">{finalists.map(finalist => <li key={finalist.entryId}><strong>{finalist.student}</strong><small>{finalist.school} · {ordinal(finalist.place)} after prelims</small></li>)}</ol> : <div className="results-table" role="table" aria-label={`${eventName(eventId)} final placings`}>
          <div className="results-row results-head final" role="row"><span>Place</span><span>Speaker</span><span>Judges’ ranks</span><span>Total</span><span>Recip.</span><span>Rating pts</span><span>Team pts</span><span/></div>
          {placings.map(placing => <div key={placing.entryId} role="row" className={`results-row final ${placing.place === 1 ? 'champion' : ''}`}>
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
      </section>
    </aside>
  </div>;
}
