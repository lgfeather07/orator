import { useState } from 'react';
import { Badge, Icon } from './ui';
import { useStore } from './store';
import { contestOf, isFinal, roomNeeded, type Tournament } from './tournament';

/** How many rooms the busiest round needs: every event and division split into rooms of `sectionSize`. */
export function roomsNeeded(tournament: Tournament, entries: { eventId: string; division?: 'varsity' | 'novice' }[]) {
  const counts = new Map<string, number>();
  entries.filter(entry => !(entry as { waitlisted?: boolean }).waitlisted && tournament.eventIds.includes(entry.eventId)).forEach(entry => { const key = contestOf(entry); counts.set(key, (counts.get(key) ?? 0) + 1); });
  return [...counts.values()].reduce((sum, count) => sum + Math.ceil(count / tournament.sectionSize), 0);
}

/**
 * The director lists the rooms they actually have. The schedule fills them in this order every round;
 * finals use them too. Paste a list (one per line or comma-separated) or add one at a time.
 */
export function RoomsEditor({ editable }: { editable: boolean }) {
  const { tournament, updateTournament, entries, sections } = useStore();
  const list = tournament.rooms ?? [];
  const [draft, setDraft] = useState('');
  const needed = roomsNeeded(tournament, entries);
  const short = Math.max(0, needed - list.length);
  const unassigned = sections.filter(section => !isFinal(section, tournament) && roomNeeded(section.room)).length;
  const save = (next: string[]) => updateTournament({ rooms: [...new Set(next.map(room => room.trim()).filter(Boolean))] });
  const add = () => { const names = draft.split(/[\n,;]+/).map(name => name.trim()).filter(Boolean); if (names.length) save([...list, ...names]); setDraft(''); };
  const move = (index: number, by: number) => { const next = [...list]; const [room] = next.splice(index, 1); next.splice(Math.max(0, Math.min(next.length, index + by)), 0, room); save(next); };
  return <section className="rooms-editor" aria-labelledby="rooms-title">
    <div className="rooms-head">
      <div><h3 id="rooms-title">Rooms</h3><p>The rooms you have for this tournament. Each round fills them in this order; finals use them too.</p></div>
      <Badge tone={list.length === 0 || short ? 'warning' : 'success'} icon={list.length === 0 || short ? 'warning' : 'check'}>{list.length === 0 ? 'No rooms yet' : short ? `${list.length} of ${needed} needed` : `${list.length} rooms · ${needed} needed per round`}</Badge>
    </div>
    {editable && <form className="rooms-add" onSubmit={event => { event.preventDefault(); add(); }}>
      <textarea aria-label="Add rooms" rows={2} value={draft} onChange={event => setDraft(event.target.value)} placeholder={'e.g. Room 101, Room 104, Library\nPaste a list: one per line or separated by commas'}/>
      <button className="button button-primary" type="submit" disabled={!draft.trim()}><Icon name="plus"/><span>Add rooms</span></button>
    </form>}
    {list.length === 0 ? <p className="rooms-empty">Until you add rooms, the schedule uses numbered placeholders (Room 1, Room 2…).</p> : <ol className="rooms-list">{list.map((room, index) => <li key={room}>
      <span className="rooms-order">{index + 1}</span><strong>{room}</strong>
      {editable && <span className="rooms-actions"><button type="button" aria-label={`Move ${room} earlier`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" aria-label={`Move ${room} later`} disabled={index === list.length - 1} onClick={() => move(index, 1)}>↓</button><button type="button" aria-label={`Remove ${room}`} onClick={() => save(list.filter(item => item !== room))}><Icon name="close" size={14}/></button></span>}
    </li>)}</ol>}
    {short > 0 && <p className="rooms-warning" role="note"><Icon name="warning" size={14}/> The busiest round needs {needed} rooms. Add {short} more{sections.length ? ', then rebuild the schedule' : ''}, or raise the most speakers per room. Rooms beyond your list show as “Room needed”.</p>}
    {unassigned > 0 && short === 0 && <p className="rooms-warning" role="note"><Icon name="warning" size={14}/> {unassigned} scheduled {unassigned === 1 ? 'room still says' : 'rooms still say'} “Room needed”. Rebuild the schedule to use your new rooms.</p>}
  </section>;
}
