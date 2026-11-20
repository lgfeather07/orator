import './semis.css';
import { Badge, Button, Icon } from './ui';
import { useStore } from './store';
import { isFinal, preferenceFor, stageOf } from './tournament';
import { FINAL_ROOM_LIMIT, LARGE_FIELD, SEMI_ADVANCE_CHOICES, SEMI_DEFAULT, SEMI_JUDGE_CHOICES, SEMI_ROOMS, sampleSemis, seedSemis, semiSizeChoices, semisPossible, type Standing } from './results';
import { semiConflict, semiPlanFor, semiProgress, semiRoomsOf } from './semis';

const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4) % 4]}`;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * Final only, or semifinals then a final, for one contest. Shown in the cut preview while nothing after
 * prelims has been created. Semifinals are suggested for a large field but never chosen for the director.
 */
export function SemiFormat({ contest, name, standings }: { contest: string; name: string; standings: Standing[] }) {
  const { tournament, setSemis, sections } = useStore();
  const field = standings.length;
  const plan = semiPlanFor(tournament, contest);
  const created = semiRoomsOf(sections, contest, tournament).length > 0;
  if (!semisPossible(field) && !plan) return null;
  const suggested = field > LARGE_FIELD;
  const choose = (patch: Partial<typeof SEMI_DEFAULT>) => setSemis(contest, { ...(plan ?? SEMI_DEFAULT), size: Math.min((plan ?? SEMI_DEFAULT).size, Math.max(field, 10)), ...patch });
  const seeds = plan ? standings.filter(standing => standing.place <= plan.size) : [];
  const lastIn = seeds[seeds.length - 1]; const firstOut = plan ? standings[seeds.length] : undefined;
  return <div className="semi-format">
    <fieldset className="cut-options">
      <legend>Rounds after prelims</legend>
      <label className={`cut-option ${!plan ? 'chosen' : ''}`}>
        <input type="radio" name={`format-${contest}`} checked={!plan} disabled={created} onChange={() => setSemis(contest, null)}/>
        <span className="cut-option-main"><strong>Final only</strong><small>The top speakers go straight to the final</small></span>
        <span className="cut-option-detail"><small>Usual for most fields</small></span>
      </label>
      <label className={`cut-option ${plan ? 'chosen' : ''}`}>
        <input type="radio" name={`format-${contest}`} checked={!!plan} disabled={created} onChange={() => choose({})}/>
        <span className="cut-option-main"><strong>Semifinals, then final</strong><small>{SEMI_ROOMS} semifinal rooms; the top of each room make the final</small></span>
        <span className="cut-option-detail">{suggested && <Badge tone="info" icon="info">Suggested: {field} entries</Badge>}<small>For a large field</small></span>
      </label>
    </fieldset>
    {plan && <div className="semi-settings">
      <label><span>Semifinalists</span><select value={plan.size} disabled={created} onChange={event => choose({ size: Number(event.target.value) })}>{semiSizeChoices(field).map(size => <option key={size} value={size}>Top {size}{size === SEMI_DEFAULT.size ? ' (usual)' : ''}</option>)}</select></label>
      <label><span>Judges in each semifinal</span><select value={plan.judges} disabled={created} onChange={event => choose({ judges: Number(event.target.value) })}>{SEMI_JUDGE_CHOICES.map(count => <option key={count} value={count}>{plural(count, 'judge')}</option>)}</select></label>
      <label><span>Finalists from each room</span><select value={plan.advance} disabled={created} onChange={event => choose({ advance: Number(event.target.value) })}>{SEMI_ADVANCE_CHOICES.filter(count => count * SEMI_ROOMS <= FINAL_ROOM_LIMIT).map(count => <option key={count} value={count}>Top {count} ({count * SEMI_ROOMS} in the final)</option>)}</select></label>
      <p className="results-rule"><Icon name="info" size={14}/> <span>{seeds.length} make the {name} semifinals{seeds.length > plan.size ? ' (a tie at the line could not be broken)' : ''}, seeded into two rooms by prelim place. The top {plan.advance} in each room make the final; the rest place {ordinal(plan.advance * SEMI_ROOMS + 1)} and below as semifinalists.{lastIn && firstOut ? <> Last in: <strong>{lastIn.student}</strong> ({lastIn.cumulativeRank}). First out: <strong>{firstOut.student}</strong> ({firstOut.cumulativeRank}).</> : null}</span></p>
    </div>}
    {created && <p className="results-rule"><Icon name="lock" size={14}/> The semifinals are created, so this can no longer change.</p>}
  </div>;
}

/** The semifinal round for one contest: seeding, rooms and judges, ballots in, and who made the final. */
export function SemifinalsPanel({ contest, name, standings }: { contest: string; name: string; standings: Standing[] }) {
  const store = useStore();
  const { tournament } = store;
  const plan = semiPlanFor(tournament, contest);
  if (!plan) return null;
  const progress = semiProgress(store.sections, contest, tournament, standings, store.roomResults);
  const created = progress.rooms.length > 0;
  const finalMade = store.sections.some(section => stageOf(section, tournament) === 'final' && (section.division === 'novice' ? `${section.eventId}:novice` : section.eventId) === contest);
  const nameOf = new Map(standings.map(standing => [standing.entryId, standing]));
  const seeded = created ? [] : seedSemis(standings, plan.size);
  const prelimRooms = store.sections.filter(section => !isFinal(section, tournament) && (section.division === 'novice' ? `${section.eventId}:novice` : section.eventId) === contest);
  const prelimsIn = prelimRooms.length > 0 && prelimRooms.every(section => store.prelimResults.some(result => result.sectionId === section.id));
  const done = (sectionId: string) => store.roomResults.some(result => result.sectionId === sectionId);
  const levelText = { top: 'Top choice', willing: 'Willing', avoid: 'Prefers to avoid' };
  const conflictText = { '': '', school: 'from a semifinalist’s school', knows: 'knows a semifinalist’s school', prelim: 'judged this event in prelims' };
  const advancers = progress.advancers.map(id => nameOf.get(id)?.student ?? '').filter(Boolean);

  return <section className="panel semis-panel" aria-labelledby={`semis-${contest}`}>
    <div className="panel-head"><div><h2 id={`semis-${contest}`}>{name} semifinals</h2><p>Top {plan.size} after prelims in {SEMI_ROOMS} rooms, {plural(plan.judges, 'judge')} each. The top {plan.advance} in each room make the final.</p></div>
      <span className="panel-head-actions">
        {!created && <Button icon="plus" disabled={!prelimsIn} onClick={() => store.createSemis(contest)}>Create semifinals</Button>}
        {created && !store.live && !progress.complete && <Button icon="sparkle" variant="secondary" onClick={() => store.fillSampleSemis(contest)}>Fill in sample semifinals</Button>}
        {created && <Badge tone={progress.complete ? 'success' : 'warning'} icon={progress.complete ? 'check' : 'clock'}>{progress.ballotsIn} of {progress.ballots} ballots in</Badge>}
      </span></div>
    {!created ? <>
      <div className="semi-rooms">{seeded.map((ids, index) => <div key={index} className="semi-room">
        <div className="semi-room-head"><strong>Semifinal {String.fromCharCode(65 + index)}</strong><small>{plural(ids.length, 'speaker')}</small></div>
        <ol className="semi-list">{ids.map(id => { const standing = nameOf.get(id)!; return <li key={id}><span className="semi-seed" aria-label={`Seed ${standing.place}`}>{standing.place}</span><span className="semi-name"><strong>{standing.student}</strong><small>{standing.school}</small></span></li>; })}</ol>
      </div>)}</div>
      {!prelimsIn && <p className="results-rule"><Icon name="clock" size={14}/> The semifinals can be created once every preliminary room in this contest has results. Seeds may change until then.</p>}
      <p className="results-rule"><Icon name="info" size={14}/> Seeded by prelim place in a snake (1 and 4 in room A, 2 and 3 in room B, and so on) so the rooms are equally strong; teammates are split between rooms where a swap of equal seeds allows. Judges are chosen like finals judges: by preference, never from a semifinalist’s school, and never someone who judged this event in prelims.</p>
    </> : <div className="semi-rooms">{progress.rooms.map((room, roomIndex) => {
      const standingsHere = progress.standings[roomIndex];
      const schools = room.entryIds.map(id => nameOf.get(id)?.school ?? '');
      const roomDone = room.seats.every(seat => done(seat.id));
      return <div key={room.room} className="semi-room">
        <div className="semi-room-head"><strong>Semifinal {room.letter} · {room.room}</strong><Badge tone={roomDone ? 'success' : 'warning'} icon={roomDone ? 'check' : 'clock'}>{room.seats.filter(seat => done(seat.id)).length} of {room.seats.length} in</Badge></div>
        {room.seats.map((seat, seatIndex) => {
          const submitted = done(seat.id);
          const label = `Semifinal ${room.letter} judge ${seatIndex + 1}`;
          return <div key={seat.id} className="final-seat semi-seat"><span>Judge {seatIndex + 1}</span>
            <select aria-label={label} value={seat.judgeId ?? ''} disabled={submitted} onChange={event => store.assignJudge(seat.id, event.target.value || null)}><option value="">Needs a judge</option>{store.judges.map(judge => {
              const why = semiConflict(judge, contest, schools, store.sections, tournament);
              const taken = store.sections.some(other => other.id !== seat.id && other.judgeId === judge.id && other.round === seat.round && isFinal(other, tournament));
              return <option key={judge.id} value={judge.id} disabled={why !== '' || taken}>{judge.name} · {why ? conflictText[why] : taken ? 'already in this round' : levelText[preferenceFor(store.judgePreferences[judge.id], seat.eventId)].toLowerCase()}</option>;
            })}</select>
            <span className="final-seat-status"><Badge tone={submitted ? 'success' : seat.judgeId ? 'neutral' : 'warning'} icon={submitted ? 'check' : undefined}>{submitted ? 'Ballot submitted' : seat.judgeId ? 'Waiting for ballot' : 'Needs a judge'}</Badge>
              {!store.live && !submitted && <button type="button" aria-label={`Fill sample ballot for ${label}`} onClick={() => store.recordRoomResults(seat.id, sampleSemis(standings, room.entryIds, room.seats.length, room.room).filter(result => result.judge === seatIndex + 1).map(result => ({ entryId: result.entryId, rank: result.rank, rating: result.rating })))}>Fill sample ballot</button>}</span>
          </div>;
        })}
        {standingsHere.length === 0 ? <ol className="semi-list">{[...room.entryIds].reverse().map(id => { const standing = nameOf.get(id); return standing ? <li key={id}><span className="semi-seed" aria-label={`Seed ${standing.place}`}>{standing.place}</span><span className="semi-name"><strong>{standing.student}</strong><small>{standing.school}</small></span></li> : null; })}</ol>
        : <ol className="semi-list ranked">{standingsHere.map(standing => <li key={standing.entryId} className={roomDone && standing.advances ? 'in' : ''}>
          <span className="semi-seed" aria-label={`Place ${standing.place} in the room`}>{standing.place}</span>
          <span className="semi-name"><strong>{standing.student}</strong><small>{standing.school} · seed {standing.seed} · ranks {standing.judgeRanks.join(' · ')}{standing.decidedBy ? ` · ${standing.decidedBy === 'Still tied' ? 'still tied' : `tie broken by ${standing.decidedBy.toLowerCase()}`}` : ''}</small></span>
          {roomDone ? standing.advances ? <Badge tone="success" icon="check">To the final</Badge> : <Badge tone="neutral">Semifinalist</Badge> : null}
        </li>)}</ol>}
      </div>;
    })}</div>}
    {created && <p className="results-rule semi-next"><Icon name={progress.complete ? 'check' : 'info'} size={14}/> <span>{progress.complete ? <><strong>{plural(advancers.length, 'speaker')} advance{advancers.length === 1 ? 's' : ''}:</strong> {advancers.join(', ')}. {finalMade ? 'The final is created below.' : 'Create the final below.'}</> : 'The final and placings wait until every semifinal ballot is in. Each judge opens their semifinal from their own list of rooms. Rooms rank on cumulative rank, then reciprocals, then rating points.'}</span></p>}
  </section>;
}
