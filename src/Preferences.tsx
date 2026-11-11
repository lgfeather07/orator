import { useState } from 'react';
import { Badge, Icon } from './ui';
import { ballotEvents } from './ballots';

export type Level = 'top' | 'willing' | 'avoid';
export type EventPreference = { id: string; name: string; code: string; level: Level };

const codes: Record<string, string> = { info: 'INFO', persuasive: 'PERS', extemp: 'EXT', entertainment: 'ENT', oid: 'OID', poi: 'POI', poetry: 'POE', serious: 'SER', humorous: 'HUM', duet: 'DUET', duo: 'DUO' };
const startingLevels: Record<string, Level> = { info: 'top', persuasive: 'top', extemp: 'top', oid: 'avoid', duet: 'avoid', duo: 'avoid' };

/** Every NSAA event, each sorted into how willing the judge is to judge it. */
export const allEventPreferences: EventPreference[] = ballotEvents.map(event => ({ id: event.id, name: event.name, code: codes[event.id] ?? event.short.slice(0, 4).toUpperCase(), level: startingLevels[event.id] ?? 'willing' }));

const levels: { id: Level; label: string; note: string; tone: 'success' | 'neutral' | 'pink' }[] = [
  { id: 'top', label: 'Top choices', note: 'Highly experienced', tone: 'success' },
  { id: 'willing', label: 'Willing to judge', note: 'Comfortable', tone: 'neutral' },
  { id: 'avoid', label: 'Prefer to avoid', note: 'Low confidence', tone: 'pink' },
];

/** Three lists of events. Drag an event to another list or use its menu; order inside a list is the judge's ranking. */
export function EventPreferences({ events, onChange, columns = false }: { events: EventPreference[]; onChange: (next: EventPreference[]) => void; columns?: boolean }) {
  const [dragged, setDragged] = useState<string | null>(null);
  const setLevel = (id: string, level: Level) => onChange(events.map(event => event.id === id ? { ...event, level } : event));
  const dropOn = (level: Level, beforeId?: string) => {
    if (!dragged || dragged === beforeId) return;
    const moving = events.find(event => event.id === dragged); if (!moving) return;
    const rest = events.filter(event => event.id !== dragged);
    const at = beforeId ? rest.findIndex(event => event.id === beforeId) : rest.length;
    rest.splice(at, 0, { ...moving, level });
    onChange(rest); setDragged(null);
  };
  return <div className={columns ? 'embedded-pref-grid' : 'pref-groups'}>{levels.map(level => {
    const list = events.filter(event => event.level === level.id);
    return <div className={`pref-group ${level.id}`} key={level.id} onDragOver={event => event.preventDefault()} onDrop={() => dropOn(level.id)}>
      <div className="pref-label"><span>{level.label}</span><Badge tone={level.tone}>{list.length}</Badge></div>
      {list.map(event => <div className={`event-row ${dragged === event.id ? 'dragging' : ''}`} key={event.id} draggable onDragStart={() => setDragged(event.id)} onDragEnd={() => setDragged(null)} onDragOver={drag => drag.preventDefault()} onDrop={drop => { drop.stopPropagation(); dropOn(level.id, event.id); }}>
        <Icon name="drag"/><span className="event-code">{event.code}</span><span><strong>{event.name}</strong><small>{level.note}</small></span>
        <select aria-label={`Preference for ${event.name}`} value={event.level} onChange={change => setLevel(event.id, change.target.value as Level)}>{levels.map(option => <option key={option.id} value={option.id}>{option.id === 'top' ? 'Top choice' : option.id === 'willing' ? 'Willing' : 'Avoid'}</option>)}</select>
      </div>)}
      {list.length === 0 && <p className="pref-empty">Drag an event here, or choose “{level.id === 'top' ? 'Top choice' : level.id === 'willing' ? 'Willing' : 'Avoid'}” from its menu.</p>}
    </div>;
  })}</div>;
}
