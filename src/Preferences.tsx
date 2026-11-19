import { useState } from 'react';
import { Badge, Icon } from './ui';
import { ballotEvents, eventCodes } from './ballots';
import { useStore } from './store';

export type Level = 'top' | 'willing' | 'avoid';
export type EventPreference = { id: string; name: string; code: string; level: Level };

const startingLevels: Record<string, Level> = { info: 'top', persuasive: 'top', extemp: 'top', oid: 'avoid', duet: 'avoid', duo: 'avoid' };

/** Every NSAA event, each sorted into how willing the judge is to judge it. */
export const allEventPreferences: EventPreference[] = ballotEvents.map(event => ({ id: event.id, name: event.name, code: eventCodes[event.id] ?? event.short.slice(0, 3).toUpperCase(), level: startingLevels[event.id] ?? 'willing' }));

/** The editable list for a judge's saved preferences: saved order first, then any events they haven't placed. */
export function toPreferenceList(saved: { id: string; level: Level }[]): EventPreference[] {
  const known = saved.flatMap(item => { const event = allEventPreferences.find(option => option.id === item.id); return event ? [{ ...event, level: item.level }] : []; });
  return [...known, ...allEventPreferences.filter(event => !known.some(item => item.id === event.id))];
}

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

/**
 * A judge says who they know. A clean judge knows none of the competitors and can judge anyone;
 * otherwise they tick the schools whose students they know, and are kept out of those rooms like their own school.
 */
export function JudgeConflicts({ ownSchool }: { ownSchool?: string }) {
  const store = useStore();
  const { clean, knows } = store.myJudgeProfile;
  const schools = [...new Set(store.entries.map(entry => entry.school))].filter(school => !ownSchool || school.toLowerCase() !== ownSchool.toLowerCase()).sort();
  const save = (next: { clean: boolean; knows: string[] }) => store.saveJudgeProfile(next);
  // Before the schedule is out a judge can't see the entry list, so they can type a school in.
  const [typed, setTyped] = useState('');
  return <section className="judge-conflicts" aria-labelledby="judge-conflicts-title">
    <div className="judge-conflicts-head"><div><h3 id="judge-conflicts-title">Who you know</h3><p>Used for every round, prelims and finals. You’re never given a room with a student from a school you know.</p></div>{clean ? <Badge tone="success" icon="check">Clean judge</Badge> : <Badge tone="neutral">{knows.length ? `Knows ${knows.length} ${knows.length === 1 ? 'school' : 'schools'}` : 'No schools marked'}</Badge>}</div>
    <label className="check-setting"><input type="checkbox" checked={clean} onChange={event => save({ clean: event.target.checked, knows: event.target.checked ? [] : knows })}/><span><strong>I’m a clean judge</strong><small>I don’t know any of the competitors at this tournament{ownSchool ? `, including at ${ownSchool}` : ''}. Clean judges can be placed in any room, prelims and finals.</small></span></label>
    {!clean && <fieldset className="known-schools"><legend>Schools whose students you know <small>a former team, your children’s school, students you coach privately</small></legend>
      <div>{[...new Set([...schools, ...knows])].sort().map(school => { const on = knows.some(item => item.toLowerCase() === school.toLowerCase()); return <label key={school} className={on ? 'on' : ''}><input type="checkbox" checked={on} onChange={() => save({ clean: false, knows: on ? knows.filter(item => item.toLowerCase() !== school.toLowerCase()) : [...knows, school] })}/>{school}</label>; })}</div>
      <form className="known-add" onSubmit={event => { event.preventDefault(); const name = typed.trim(); if (name && !knows.some(item => item.toLowerCase() === name.toLowerCase())) save({ clean: false, knows: [...knows, name] }); setTyped(''); }}>
        <input aria-label="Add a school you know" placeholder="Add a school by name" value={typed} onChange={event => setTyped(event.target.value)}/>
        <button type="submit" disabled={!typed.trim()}>Add</button>
      </form>
    </fieldset>}
  </section>;
}
