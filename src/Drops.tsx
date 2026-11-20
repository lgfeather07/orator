/**
 * Drop deadlines and drop fees.
 *
 * The director sets a drop deadline (date and time), a fee per entry and per judge dropped after it, and
 * whether entry fees freeze at the deadline (a dropped entry still owes its entry fee). Before the deadline,
 * or with no deadline (the default), coaches add and drop freely and nothing is recorded. After it, each entry
 * or judge a coach removes is recorded as a drop with the fees in force at that moment, and the coach is warned
 * first. Waitlisted entries never cost anything. The director's own removals are never charged. A student
 * dropped and re-added in the same event still counts as a drop; the director can waive it, with a reason.
 *
 * Signed in, drops are recorded by the database (supabase/drops.sql); in the demo they are kept in the browser.
 */
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Badge, Button, Icon, useDialog } from './ui';
import { useStore } from './store';
import { ballotEvents } from './ballots';
import { defaultFees, dropCost, dropDeadlinePassed, money, sameSchool, type EntryDrop, type Tournament } from './tournament';
import './drops.css';

const eventName = (id: string | null) => ballotEvents.find(event => event.id === id)?.name ?? id ?? '';
/** Dollars with cents: $20.00. */
const dollars = (amount: number) => `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const validDate = (iso?: string) => { if (!iso) return null; const date = new Date(iso); return Number.isFinite(date.getTime()) ? date : null; };
/** "Nov 14" */
export const dropDayLabel = (iso?: string) => validDate(iso)?.toLocaleDateString([], { month: 'short', day: 'numeric' }) ?? '';
/** "Fri, Nov 14 at 11:59 PM" */
export const dropDeadlineLabel = (iso?: string) => { const date = validDate(iso); return date ? `${date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} at ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''; };
const whenLabel = (iso: string) => { const date = validDate(iso); return date ? `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''; };
/** An ISO time as the value of a datetime-local input, in the browser's time zone. */
const toLocalInput = (iso?: string) => { const date = validDate(iso); if (!date) return ''; const pad = (n: number) => String(n).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`; };

/** What a drop costs, in words: "$20" or "$27 (a $20 drop fee and the $7 entry fee)". */
export function dropCostText(tournament: Tournament, kind: 'entry' | 'judge') {
  // What it costs once the deadline has passed (the latest possible moment), whatever the time now.
  const cost = dropCost(tournament, kind, new Date(8.64e15));
  if (cost.total === 0) return 'nothing';
  return cost.entryFee > 0 ? `${money(cost.total)} (a ${money(cost.fee)} drop fee plus the ${money(cost.entryFee)} entry fee)` : money(cost.total);
}

/** A dollar amount the director can type cents into ("20.50"). */
function AmountInput({ value, onChange, disabled, label }: { value: number; onChange: (value: number) => void; disabled: boolean; label: string }) {
  const [text, setText] = useState(Number.isInteger(value) ? String(value) : value.toFixed(2));
  return <input inputMode="decimal" aria-label={label} value={text} disabled={disabled}
    onChange={event => { const cleaned = event.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1').replace(/(\.\d{2}).+/, '$1'); setText(cleaned); onChange(Number(cleaned) || 0); }}
    onBlur={() => setText(Number.isInteger(value) ? String(value) : value.toFixed(2))}/>;
}

/** The director's drop settings, shown under Fees on the Details step. */
export function DropSettings({ editable }: { editable: boolean }) {
  const { tournament, updateTournament } = useStore();
  const deadline = tournament.dropDeadline;
  const passed = dropDeadlinePassed(tournament);
  const entryFee = (tournament.fees ?? defaultFees).entry;
  return <div className="drop-settings">
    <div className="field-label"><span>Drops</span><small>Optional. With no deadline, coaches drop for free until entries close.</small></div>
    <div className="drop-grid">
      <label className="drop-deadline"><span>Drop deadline <small>date and time</small></span>
        <span className="drop-deadline-input">
          <input type="datetime-local" aria-label="Drop deadline" value={toLocalInput(deadline)} disabled={!editable} onChange={event => { const value = event.target.value; const date = value ? new Date(value) : null; updateTournament({ dropDeadline: date && Number.isFinite(date.getTime()) ? date.toISOString() : undefined }); }}/>
          {deadline && <button type="button" className="people-undo" disabled={!editable} onClick={() => updateTournament({ dropDeadline: undefined })}>Clear</button>}
        </span>
      </label>
      <label><span>Per entry dropped after it</span><span className="money-input"><i>$</i><AmountInput label="Fee per entry dropped after the deadline" value={tournament.dropEntryFee ?? 0} disabled={!editable} onChange={value => updateTournament({ dropEntryFee: Math.max(0, value) })}/></span></label>
      <label><span>Per judge dropped after it</span><span className="money-input"><i>$</i><AmountInput label="Fee per judge dropped after the deadline" value={tournament.dropJudgeFee ?? 0} disabled={!editable} onChange={value => updateTournament({ dropJudgeFee: Math.max(0, value) })}/></span></label>
    </div>
    <label className="check-setting drop-freeze"><input type="checkbox" checked={tournament.freezeEntryFees ?? false} disabled={!editable} onChange={event => updateTournament({ freezeEntryFees: event.target.checked })}/>
      <span><strong>Entry fees freeze at the drop deadline</strong><small>An entry dropped after the deadline still owes its {money(entryFee)} entry fee, on top of any drop fee. Off: dropping an entry takes its entry fee off the invoice.</small></span></label>
    <p className="fee-orator drop-explain"><Icon name="info" size={14}/><span>{deadline
      ? <>{passed ? 'The deadline passed' : 'Coaches add and drop for free until'} <strong>{dropDeadlineLabel(deadline)}</strong>. After it, each entry a coach drops costs <strong>{dropCostText(tournament, 'entry')}</strong> and each judge <strong>{dropCostText(tournament, 'judge')}</strong>. </>
      : <>Typical schedules charge $20 per entry and $60 per judge dropped after a deadline a few days before the tournament. </>}
      Coaches are warned before a drop costs anything. Each drop is kept with the fee in force when it happened, so changing fees later doesn’t change earlier drops; you can waive any of them. Waitlisted entries and your own removals never cost a drop fee. A student dropped and re-added in the same event still counts as a drop.</span></p>
  </div>;
}

/** Asks a coach to confirm a drop that costs money. Rendered at the top of the app so a table can't clip it. */
function DropDialog({ title, children, confirmLabel, onConfirm, onClose }: { title: string; children: ReactNode; confirmLabel: string; onConfirm: () => void; onClose: () => void }) {
  const dialog = useDialog<HTMLDivElement>(onClose);
  return createPortal(<div className="modal-backdrop" onClick={onClose}>
    <div ref={dialog} tabIndex={-1} className="modal drop-modal" role="alertdialog" aria-modal="true" aria-labelledby="drop-dialog-title" aria-describedby="drop-dialog-body" onClick={event => event.stopPropagation()}>
      <header><div><span className="eyebrow">After the drop deadline</span><h2 id="drop-dialog-title">{title}</h2></div><button className="icon-button" aria-label="Close" onClick={onClose}><Icon name="close"/></button></header>
      <div id="drop-dialog-body" className="drop-modal-body">{children}</div>
      <div className="modal-actions"><Button variant="secondary" onClick={onClose}>Keep</Button><Button variant="danger" onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</Button></div>
    </div>
  </div>, document.querySelector('.app') ?? document.body);
}

/**
 * The remove button on a coach's entry. Before the drop deadline (or for a waitlisted entry) it removes at once,
 * as before. After it, the coach confirms first and is told what the drop costs.
 */
export function DropEntryButton({ entry, onRemove, label }: { entry: { id: string; student: string; eventId: string; waitlisted?: boolean }; onRemove: () => void; label: string }) {
  const { tournament } = useStore();
  const [asking, setAsking] = useState(false);
  const late = !entry.waitlisted && dropDeadlinePassed(tournament);
  const cost = dropCost(tournament, 'entry', new Date(), entry.waitlisted);
  return <>
    <button className="icon-button" aria-label={label} onClick={() => late ? setAsking(true) : onRemove()}><Icon name="close" size={16}/></button>
    {asking && <DropDialog title={`Drop ${entry.student} from ${eventName(entry.eventId)}?`} confirmLabel={cost.total > 0 ? `Drop for ${money(cost.total)}` : 'Drop entry'} onConfirm={onRemove} onClose={() => setAsking(false)}>
      <p className="drop-warning"><Icon name="warning" size={16}/><strong>{cost.total > 0 ? `Dropping after ${dropDayLabel(tournament.dropDeadline)} costs ${dropCostText(tournament, 'entry')}.` : `The drop deadline (${dropDayLabel(tournament.dropDeadline)}) has passed. This drop costs nothing, but the director will see it.`}</strong></p>
      <p>The drop goes on your invoice{cost.total > 0 ? ' and the director can waive it' : ''}. Adding {entry.student} back to {eventName(entry.eventId)} later still counts as a drop.</p>
    </DropDialog>}
  </>;
}

/** The warning a coach sees when confirming they want to remove one of their judges. Empty before the deadline. */
export function JudgeDropWarning() {
  const { tournament } = useStore();
  if (!dropDeadlinePassed(tournament)) return null;
  const cost = dropCost(tournament, 'judge');
  return <span className="drop-judge-warning"> {cost.total > 0 ? `Dropping a judge after ${dropDayLabel(tournament.dropDeadline)} costs ${money(cost.total)}, and you may also owe a hired-judge fee.` : `The drop deadline (${dropDayLabel(tournament.dropDeadline)}) has passed; the director will see this drop.`}</span>;
}

function DropLine({ drop, children }: { drop: EntryDrop; children?: ReactNode }) {
  const charge = drop.fee + drop.entryFee;
  return <li className={drop.waived ? 'waived' : ''}>
    <span className="drop-what"><strong>{drop.name}</strong>
      <small>{drop.kind === 'judge' ? 'Judge' : `${drop.division === 'novice' ? 'Novice ' : ''}${eventName(drop.eventId)}`} · {drop.school} · dropped {whenLabel(drop.droppedAt)} by {drop.droppedBy}</small>
      {drop.waived && <small className="drop-reason">Waived{drop.waiveReason ? `: ${drop.waiveReason}` : ''}</small>}</span>
    <span className="drop-fee">{drop.waived ? <><s>{dollars(charge)}</s><Badge tone="success" icon="check">Waived</Badge></> : <><b>{dollars(charge)}</b>{drop.entryFee > 0 && <small>incl. {dollars(drop.entryFee)} entry fee</small>}</>}</span>
    {children}
  </li>;
}

/** A coach's drop deadline and their school's recorded drops. Nothing shows until the director sets a deadline. */
export function CoachDrops({ school }: { school: string }) {
  const { tournament, drops } = useStore();
  const mine = drops.filter(drop => sameSchool(drop.school, school));
  if (!tournament.dropDeadline && mine.length === 0) return null;
  const passed = dropDeadlinePassed(tournament);
  const owed = mine.filter(drop => !drop.waived).reduce((sum, drop) => sum + drop.fee + drop.entryFee, 0);
  return <section className="panel drops-panel" aria-labelledby="coach-drops-title">
    <div className="panel-head"><div><h2 id="coach-drops-title">Drop deadline</h2><p>{tournament.dropDeadline ? dropDeadlineLabel(tournament.dropDeadline) : 'No deadline set'}</p></div>
      <Badge tone={passed ? 'warning' : 'info'} icon="clock">{passed ? 'Deadline passed' : 'Drops are free for now'}</Badge></div>
    <p className="drops-intro">{tournament.dropDeadline ? (passed
      ? <>The drop deadline has passed. Each entry you drop now costs <strong>{dropCostText(tournament, 'entry')}</strong> and each judge <strong>{dropCostText(tournament, 'judge')}</strong>. Waitlisted entries are still free to drop.</>
      : <>Until then you can add and drop students and judges for free. After it, each entry you drop costs <strong>{dropCostText(tournament, 'entry')}</strong> and each judge <strong>{dropCostText(tournament, 'judge')}</strong>.</>) : 'The director removed the drop deadline. Drops already recorded stay on your invoice unless the director waives them.'}</p>
    {mine.length > 0 && <>
      <ul className="drops-list">{mine.map(drop => <DropLine key={drop.id} drop={drop}/>)}</ul>
      <p className="drops-total"><span>{mine.length} {mine.length === 1 ? 'drop' : 'drops'} on your invoice</span><b>{dollars(owed)}</b></p>
    </>}
  </section>;
}

/** The director's list of every recorded drop, to waive (with a reason) or restore. Shown with fees and payments. */
export function DirectorDrops() {
  const { drops, waiveDrop, tournament } = useStore();
  const [waiving, setWaiving] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  if (drops.length === 0) return tournament.dropDeadline ? <p className="payments-note drops-none"><Icon name="clock" size={14}/> Drop deadline: {dropDeadlineLabel(tournament.dropDeadline)}. No drops recorded{dropDeadlinePassed(tournament) ? ' since it passed' : ' yet'}.</p> : null;
  const charged = drops.filter(drop => !drop.waived).reduce((sum, drop) => sum + drop.fee + drop.entryFee, 0);
  const waived = drops.filter(drop => drop.waived).reduce((sum, drop) => sum + drop.fee + drop.entryFee, 0);
  const sorted = [...drops].sort((a, b) => a.school.localeCompare(b.school) || a.droppedAt.localeCompare(b.droppedAt));
  return <section className="drops-director" aria-labelledby="director-drops-title">
    <div className="drops-director-head"><div><h3 id="director-drops-title">Drops after the deadline</h3><p>{tournament.dropDeadline ? `Deadline ${dropDeadlineLabel(tournament.dropDeadline)}. ` : ''}Each drop is on that school’s invoice. Waive one to take it off.</p></div>
      <span className="drops-sums"><Badge tone="warning">{dollars(charged)} charged</Badge>{waived > 0 && <Badge tone="success">{dollars(waived)} waived</Badge>}</span></div>
    <ul className="drops-list">{sorted.map(drop => <DropLine key={drop.id} drop={drop}>
      <span className="drop-actions">{drop.waived
        ? <button type="button" className="people-undo" onClick={() => waiveDrop(drop.id, false, '')}>Restore fee</button>
        : waiving === drop.id ? <form className="drop-waive" onSubmit={event => { event.preventDefault(); if (!reason.trim()) return; waiveDrop(drop.id, true, reason); setWaiving(null); setReason(''); }}>
          <label><span className="cj-hidden">Reason for waiving {drop.name}’s drop fee</span><input value={reason} onChange={event => setReason(event.target.value)} placeholder="Reason, e.g. illness" maxLength={200} required autoFocus/></label>
          <Button variant="secondary" onClick={() => { setWaiving(null); setReason(''); }}>Cancel</Button>
          <button className="button button-primary" type="submit" disabled={!reason.trim()}><span>Waive fee</span></button>
        </form>
        : <button type="button" className="people-undo" onClick={() => { setWaiving(drop.id); setReason(''); }}>Waive…</button>}</span>
    </DropLine>)}</ul>
  </section>;
}
