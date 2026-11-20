import { useState } from 'react';
import { Badge, Button, Icon } from './ui';
import { useStore } from './store';
import { ballotEvents } from './ballots';
import { divisionOf, overCap, sameSchool } from './tournament';

const eventName = (id: string) => ballotEvents.find(event => event.id === id)?.name ?? id;

/** A whole number, or empty for "no cap". */
function CapInput({ label, value, onChange, disabled }: { label: string; value: number | null | undefined; onChange: (value: number | null) => void; disabled: boolean }) {
  const [text, setText] = useState(value == null ? '' : String(value));
  return <input aria-label={label} inputMode="numeric" placeholder="No limit" value={text} disabled={disabled}
    onChange={event => { const cleaned = event.target.value.replace(/\D/g, '').slice(0, 4); setText(cleaned); onChange(cleaned === '' ? null : Math.max(1, Number(cleaned))); }}/>;
}

/** The director's entry caps: per school and per event. Entries over a cap go on the waitlist. */
export function EntryLimits({ editable }: { editable: boolean }) {
  const { tournament, updateTournament } = useStore();
  return <div className="entry-limits">
    <div className="field-label"><span>Entry limits</span><small>Optional. Entries over a limit go on a waitlist you admit from.</small></div>
    <div className="fee-grid">
      <label><span>Most entries per school</span><CapInput label="Most entries per school" value={tournament.schoolEntryCap} disabled={!editable} onChange={value => updateTournament({ schoolEntryCap: value })}/></label>
      <label><span>Most entries per event <small>each division</small></span><CapInput label="Most entries per event" value={tournament.eventEntryCap} disabled={!editable} onChange={value => updateTournament({ eventEntryCap: value })}/></label>
    </div>
  </div>;
}

/**
 * Waitlisted entries, oldest first. The director admits them as spots open (a drop, or a raised limit).
 * Admitting goes past a full cap if the director chooses: they decide, the cap only sorts new entries.
 */
export function WaitlistPanel() {
  const { entries, tournament, setWaitlisted } = useStore();
  const waiting = entries.filter(entry => entry.waitlisted);
  if (waiting.length === 0) return null;
  const others = (id: string) => entries.filter(entry => entry.id !== id);
  const fits = (id: string) => { const entry = entries.find(item => item.id === id)!; return !overCap(tournament, others(id).filter(item => !item.waitlisted), entry.school, entry.eventId, divisionOf(entry)); };
  const open = waiting.filter(entry => fits(entry.id)).length;
  return <section className="waitlist-panel" aria-labelledby="waitlist-title">
    <div className="waitlist-head"><div><h3 id="waitlist-title">Waitlist</h3><p>{waiting.length} {waiting.length === 1 ? 'entry is' : 'entries are'} waiting, oldest first. Waitlisted entries aren’t scheduled or charged.</p></div><Badge tone={open ? 'success' : 'warning'} icon={open ? 'check' : 'clock'}>{open ? `${open} can be admitted now` : 'No open spots'}</Badge></div>
    <ol className="waitlist-list">{waiting.map(entry => { const ok = fits(entry.id); return <li key={entry.id}>
      <span><strong>{entry.student}</strong><small>{entry.school} · {divisionOf(entry) === 'novice' ? 'Novice ' : ''}{eventName(entry.eventId)}</small></span>
      {ok ? <Badge tone="success">Spot open</Badge> : <Badge tone="neutral">{tournament.schoolEntryCap != null && entries.filter(item => !item.waitlisted && sameSchool(item.school, entry.school)).length >= tournament.schoolEntryCap ? 'School is at its limit' : 'Event is full'}</Badge>}
      <Button variant={ok ? 'primary' : 'secondary'} icon="check" onClick={() => setWaitlisted(entry.id, false)}>Admit</Button>
    </li>; })}</ol>
    <p className="waitlist-note"><Icon name="info" size={14}/> Admitting an entry adds it to the next schedule build. If the schedule is already built, rebuild it on the Schedule step.</p>
  </section>;
}
