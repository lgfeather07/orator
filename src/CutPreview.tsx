import { useState } from 'react';
import './cuts.css';
import { Badge, Button, Icon } from './ui';
import { useStore } from './store';
import { contestOf, isFinal, stageOf } from './tournament';
import { CUT_CHOICES, FINALISTS, FINAL_ROOM_LIMIT, LARGE_FIELD, SEMI_DEFAULT, cutAt, cutChoices, cutFor, nextIn, semisPossible, type CutOption, type Standing } from './results';
import { SemiFormat } from './Semifinals';
import { semiPlanFor } from './semis';

/** How the last spot in the final was settled, in a few words. */
const lastSpotText = (option: CutOption) =>
  option.everyone ? 'Everyone advances'
  : option.decidedBy === 'Still tied' ? 'Tie at the line could not be broken'
  : option.decidedBy === 'Cumulative rank' || !option.decidedBy ? 'Last spot on cumulative rank'
  : `Last spot: tie broken by ${option.decidedBy.toLowerCase()}`;

const tieText = (option: CutOption) => option.tiedAtCut ? `${option.tiedAtCut}-way tie at the line, ${option.advancing - option.cut} extra` : '';

/**
 * Cut points for one contest's final, before it is created: how many speakers each cut would take,
 * whether it lands in a tie nobody can break, and which rule settled the last spot.
 */
export function CutPreview({ contest, name, standings }: { contest: string; name: string; standings: Standing[] }) {
  const { tournament, setCut } = useStore();
  const chosen = cutFor(tournament, contest);
  const own = tournament.finalistsByContest?.[contest] !== undefined;
  const field = standings.length;
  const options = cutChoices(field).map(cut => cutAt(standings, cut));
  const selected = Math.min(chosen, field);
  const current = cutAt(standings, chosen);
  const lastIn = standings[current.advancing - 1];
  const firstOut = standings[current.advancing];
  // With semifinals, the cut is the semifinal size (set in SemiFormat), so the final cut options don't apply.
  const semis = semiPlanFor(tournament, contest);

  return <section className="panel cut-preview" aria-labelledby={`cut-${contest}`}>
    <div className="panel-head"><div><h2 id={`cut-${contest}`}>{name}: where to cut</h2><p>{field} entries. NSAA takes the top {FINALISTS}; pick another cut if this tournament uses one.</p></div>
      {own && !semis && <span className="panel-head-actions"><Button variant="ghost" onClick={() => setCut(contest, null)}>Use the tournament default ({tournament.finalists ?? FINALISTS})</Button></span>}</div>
    <SemiFormat contest={contest} name={name} standings={standings}/>
    {semis ? null : field <= CUT_CHOICES[0] ? <p className="results-rule"><Icon name="info" size={14}/> With {field} {field === 1 ? 'entry' : 'entries'}, everyone advances to the final.</p> : <>
      <fieldset className="cut-options">
        <legend>How many make the {name} final</legend>
        {options.map(option => <label key={option.cut} className={`cut-option ${option.cut === selected ? 'chosen' : ''}`}>
          <input type="radio" name={`cut-${contest}`} checked={option.cut === selected} onChange={() => setCut(contest, option.cut)}/>
          <span className="cut-option-main"><strong>Top {option.cut}{option.cut === FINALISTS ? ' (NSAA)' : ''}</strong><small>{option.advancing} make the final</small></span>
          <span className="cut-option-detail">
            {option.tiedAtCut > 0 ? <Badge tone="warning" icon="warning">{tieText(option)}</Badge> : option.everyone ? null : <Badge tone="success" icon="check">Clean cut</Badge>}
            {option.overRoom && <Badge tone="danger" icon="warning">Over {FINAL_ROOM_LIMIT}: too many for one room</Badge>}
            <small>{lastSpotText(option)}</small>
          </span>
        </label>)}
      </fieldset>
      {current.overRoom && <p className="form-note warn cut-warn"><Icon name="warning" size={14}/> {current.advancing} speakers would make this final. A final room holds {FINAL_ROOM_LIMIT}; choose a smaller cut or plan a bigger room.</p>}
      {lastIn && firstOut && <p className="results-rule cut-bubble"><Icon name="info" size={14}/> <span>Last in: <strong>{lastIn.student}</strong> ({lastIn.cumulativeRank}, {lastIn.school}). First out: <strong>{firstOut.student}</strong> ({firstOut.cumulativeRank}, {firstOut.school}).</span></p>}
    </>}
  </section>;
}

/**
 * Every contest's cut on one table, so the director can set them all before "Create all finals".
 * Contests whose final is already created show the size of that final instead.
 */
export function CutOverview({ events, eventName, standingsFor, onOpen }: { events: string[]; eventName: (id: string) => string; standingsFor: (id: string) => Standing[]; onOpen: (id: string) => void }) {
  const { tournament, sections, setCut, setSemis } = useStore();
  const [open, setOpen] = useState(false);
  const rows = events.map(id => {
    const standings = standingsFor(id); const cut = cutFor(tournament, id); const option = cutAt(standings, cut);
    const room = sections.find(section => stageOf(section, tournament) === 'final' && contestOf(section) === id);
    const rooms = sections.filter(section => !isFinal(section, tournament) && section.round === 1 && contestOf(section) === id).length;
    const semis = semiPlanFor(tournament, id);
    const semisCreated = sections.some(section => stageOf(section, tournament) === 'semi' && contestOf(section) === id);
    return { id, standings, cut, option, rooms, finalSize: room ? room.entryIds.length : null, semis, semisCreated };
  });
  const pending = rows.filter(row => row.finalSize === null);
  const ties = pending.filter(row => !row.semis && row.option.tiedAtCut > 0).length;
  const over = pending.filter(row => !row.semis && row.option.overRoom).length;
  const finalists = pending.reduce((total, row) => total + (row.semis ? row.semis.advance * 2 : row.option.advancing), 0);
  const semiCount = pending.filter(row => row.semis).length;
  const fallback = tournament.finalists ?? FINALISTS;
  if (pending.length === 0) return null;

  return <section className="panel cut-overview">
    <div className="panel-head"><div><h2>Finals cut points</h2><p>{`${pending.length} ${pending.length === 1 ? 'final' : 'finals'} to create · ${finalists} finalists${semiCount ? ` · ${semiCount} with semifinals` : ''}${ties ? ` · ${ties} ${ties === 1 ? 'tie' : 'ties'} at the cut` : ''}${over ? ` · ${over} over ${FINAL_ROOM_LIMIT}` : ''}`}</p></div>
      <span className="panel-head-actions"><button type="button" className="cut-toggle" aria-expanded={open} aria-controls="cut-overview-body" onClick={() => setOpen(value => !value)}>{open ? 'Hide' : 'Set cuts'}<Icon name="chevron" size={14}/></button></span></div>
    {open && <div id="cut-overview-body">
      <label className="cut-default"><span>Finalists in each final</span>
        <select value={fallback} onChange={event => setCut(null, Number(event.target.value) === FINALISTS ? null : Number(event.target.value))}>{CUT_CHOICES.map(cut => <option key={cut} value={cut}>Top {cut}{cut === FINALISTS ? ' (NSAA)' : ''}</option>)}</select>
        <small>Applies to every contest you haven’t set on its own.</small></label>
      <div className="cut-table-wrap" tabIndex={0} role="region" aria-label="Cut points by contest">
        <table className="cut-table">
          <thead><tr><th scope="col">Contest</th><th scope="col">Entries</th><th scope="col">Rooms</th><th scope="col">Finalists</th><th scope="col">Ties at cut</th><th scope="col">Rounds</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id} className={row.option.overRoom && row.finalSize === null && !row.semis ? 'over' : ''}>
            <th scope="row"><button type="button" onClick={() => onOpen(row.id)}>{eventName(row.id)}</button></th>
            <td>{row.standings.length}</td>
            <td>{row.rooms}</td>
            <td>{row.finalSize !== null ? <span className="cut-created"><Icon name="check" size={14}/> {row.finalSize} in final</span> : row.semis ? `Top ${row.semis.size} → semis → ${row.semis.advance * 2}` : row.standings.length <= CUT_CHOICES[0] ? `All ${row.standings.length}` : <select aria-label={`Finalists in ${eventName(row.id)}`} value={Math.min(row.cut, row.standings.length)} onChange={event => setCut(row.id, Number(event.target.value))}>
              {cutChoices(row.standings.length).map(cut => { const option = cutAt(row.standings, cut); return <option key={cut} value={cut}>Top {cut}{option.advancing !== cut ? ` → ${option.advancing}` : ''}</option>; })}
            </select>}</td>
            <td>{row.finalSize !== null || row.semis ? '—' : row.option.tiedAtCut ? <span className="cut-tie"><Icon name="warning" size={14}/> {row.option.tiedAtCut}-way, {row.option.advancing} advance</span> : row.option.everyone ? 'Everyone in' : 'None'}{row.finalSize === null && !row.semis && row.option.overRoom && <span className="cut-tie"> · over {FINAL_ROOM_LIMIT}</span>}</td>
            <td>{row.semisCreated || row.finalSize !== null ? (row.semis ? 'Semifinals, final' : 'Final') : semisPossible(row.standings.length) || row.semis ? <select aria-label={`Rounds after prelims in ${eventName(row.id)}`} value={row.semis ? 'semis' : 'final'} onChange={event => setSemis(row.id, event.target.value === 'semis' ? { ...SEMI_DEFAULT, size: Math.min(SEMI_DEFAULT.size, row.standings.length) } : null)}>
              <option value="final">Final only</option><option value="semis">Semifinals, then final{row.standings.length > LARGE_FIELD ? ' (suggested)' : ''}</option>
            </select> : 'Final'}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>}
  </section>;
}

/**
 * "Next in": the speakers just below the cut. Before any final ballot is in, the director can move
 * the next one up when a finalist withdraws or doesn't show.
 */
export function NextIn({ contest, standings, inFinal, mode }: { contest: string; standings: Standing[]; inFinal: string[]; mode: 'preview' | 'open' | 'locked' }) {
  const { addNextIn } = useStore();
  const [replacing, setReplacing] = useState('');
  const alternates = nextIn(standings, inFinal);
  const finalists = standings.filter(standing => inFinal.includes(standing.entryId));
  const withdrew = standings.filter(standing => standing.advances && !inFinal.includes(standing.entryId));
  const movedUp = standings.filter(standing => !standing.advances && inFinal.includes(standing.entryId));
  const full = !replacing && inFinal.length >= FINAL_ROOM_LIMIT;
  const target = finalists.some(finalist => finalist.entryId === replacing) ? replacing : '';
  if (alternates.length === 0 && movedUp.length === 0) return null;

  return <div className="next-in">
    <div className="next-in-head"><strong>Next in</strong><small>{mode === 'preview' ? 'If a finalist withdraws before the final, the next speaker moves up. Create the final to do it here.' : mode === 'locked' ? 'A final ballot is in, so the final can no longer change.' : 'If a finalist withdraws or doesn’t show before the final begins, move the next speaker up.'}</small></div>
    {(withdrew.length > 0 || movedUp.length > 0) && <p className="next-in-moved"><Icon name="check" size={14}/> {movedUp.map(item => item.student).join(', ')} moved up{withdrew.length ? `; ${withdrew.map(item => item.student).join(', ')} withdrew` : ''}.</p>}
    {alternates.length > 0 && <ol className="next-in-list">{alternates.map((alternate, index) => {
      const tied = alternates.some(other => other !== alternate && other.place === alternate.place);
      const canAdd = mode === 'open' && !full && (index === 0 || alternate.place === alternates[0].place);
      return <li key={alternate.entryId}>
        <span className="next-in-place" aria-label={`Place ${alternate.place}`}>{alternate.place}</span>
        <span className="next-in-name"><strong>{alternate.student}</strong><small>{alternate.school} · cumulative {alternate.cumulativeRank}{tied ? ' · tied: the director decides' : ''}</small></span>
        {canAdd && <Button variant={index === 0 ? 'primary' : 'secondary'} icon="plus" onClick={() => { addNextIn(contest, alternate.entryId, target || null); setReplacing(''); }}>{index === 0 ? 'Add next-in to the final' : `Add ${alternate.student} instead`}</Button>}
      </li>;
    })}</ol>}
    {mode === 'open' && alternates.length > 0 && <label className="next-in-replace"><span>Who withdrew?</span>
      <select value={target} onChange={event => setReplacing(event.target.value)}><option value="">No one: add a speaker to the final</option>{finalists.map(finalist => <option key={finalist.entryId} value={finalist.entryId}>{finalist.student} ({finalist.school})</option>)}</select>
      {full && <small>The final already has {FINAL_ROOM_LIMIT} speakers, the most one room holds. Choose who withdrew.</small>}</label>}
  </div>;
}
