import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Badge, Button, Icon, downloadText, useDialog } from './ui';
import { useStore } from './store';
import { ORATOR_TOURNAMENT_FEE, defaultFees, invoiceFor, type Fees, type Invoice } from './tournament';

const money = (amount: number) => `${amount < 0 ? '−' : ''}$${Math.abs(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Test cards for the simulator. The card fields are filled from this choice and can't be typed into. */
const testCards = [
  { id: 'ok', label: 'Approved', number: '4242 4242 4242 4242', outcome: 'approved' as const, message: '' },
  { id: 'declined', label: 'Declined by the bank', number: '4000 0000 0000 0002', outcome: 'failed' as const, message: 'The card was declined. Try another card or pay by check.' },
  { id: 'funds', label: 'Insufficient funds', number: '4000 0000 0000 9995', outcome: 'failed' as const, message: 'The card has insufficient funds. Try another card or pay by check.' },
  { id: 'expired', label: 'Expired card', number: '4000 0000 0000 0069', outcome: 'failed' as const, message: 'This card has expired. Try another card.' },
];

function receiptText(tournament: string, school: string, invoice: Invoice, amount: number, reference: string) {
  return [`ORATOR — SIMULATED RECEIPT (no real payment was made)`, ``, `Tournament: ${tournament}`, `School: ${school}`, `Reference: ${reference}`, ``,
    `Entries (${invoice.entries}): ${money(invoice.entryTotal)}`, `School fee: ${money(invoice.schoolFee)}`, `Judges not supplied (${invoice.judgesShort}): ${money(invoice.judgeTotal)}`, `Total due: ${money(invoice.total)}`, ``, `Paid now: ${money(amount)}`].join('\n');
}

/** A stand-in for a card checkout. Nothing is charged and no card details can be entered. */
function PaymentSimulator({ school, amount: amountDue, invoice: currentInvoice, onClose }: { school: string; amount: number; invoice: Invoice; onClose: () => void }) {
  const { tournament, recordPayment } = useStore();
  // Keep what was owed when the window opened: once the payment lands, the live balance drops to zero.
  const [amount] = useState(amountDue);
  const [invoice] = useState(currentInvoice);
  const [cardId, setCardId] = useState('ok');
  const [stage, setStage] = useState<'form' | 'processing' | 'failed' | 'paid'>('form');
  const [reference, setReference] = useState('');
  const card = testCards.find(item => item.id === cardId)!;
  const dialog = useDialog<HTMLDivElement>(onClose, stage === 'processing');
  const pay = () => {
    setStage('processing');
    window.setTimeout(() => {
      if (card.outcome === 'failed') { setStage('failed'); return; }
      setReference(recordPayment(school, amount, 'card')); setStage('paid');
    }, 1300);
  };
  // Rendered at the top of the app so the panel it was opened from can't clip it.
  return createPortal(<div className="modal-backdrop" onClick={stage === 'processing' ? undefined : onClose}>
    <div ref={dialog} tabIndex={-1} className="modal pay-modal" role="dialog" aria-modal="true" aria-label="Payment simulator" onClick={event => event.stopPropagation()}>
      <header><div><span className="eyebrow">PAYMENT SIMULATOR</span><h2>{stage === 'paid' ? 'Payment received' : `Pay ${money(amount)}`}</h2></div>{stage !== 'processing' && <button className="icon-button" aria-label="Close" onClick={onClose}><Icon name="close"/></button>}</header>
      <p className="pay-warning"><Icon name="info" size={15}/><span><strong>This is a simulation.</strong> No money moves and no real card can be entered. It shows what paying for a tournament would look like.</span></p>
      {stage === 'paid' ? <div className="modal-sent"><span className="success-icon"><Icon name="check" size={24}/></span><h3>{money(amount)} paid for {school}</h3><p>Reference {reference}. Recorded in this simulation; no money was taken.</p>
        <div className="modal-actions center"><Button variant="secondary" icon="download" onClick={() => downloadText(`orator-receipt-${reference}.txt`, receiptText(tournament.name, school, invoice, amount, reference))}>Download receipt</Button><Button onClick={onClose}>Done</Button></div></div>
      : stage === 'processing' ? <div className="pay-processing"><span className="spinner"/><p>Contacting the bank…</p></div>
      : <>
        <label className="pay-field"><span>Test card to try</span><select value={cardId} onChange={event => { setCardId(event.target.value); setStage('form'); }}>{testCards.map(item => <option key={item.id} value={item.id}>{item.label} · ends {item.number.slice(-4)}</option>)}</select></label>
        <div className="pay-card" aria-label="Test card details, filled in for you">
          <label className="pay-field wide"><span>Card number</span><input value={card.number} readOnly tabIndex={-1}/></label>
          <label className="pay-field"><span>Expires</span><input value={card.id === 'expired' ? '01 / 24' : '12 / 30'} readOnly tabIndex={-1}/></label>
          <label className="pay-field"><span>Security code</span><input value="123" readOnly tabIndex={-1}/></label>
          <label className="pay-field wide"><span>Name on card</span><input value={`${school} Activities`} readOnly tabIndex={-1}/></label>
        </div>
        {stage === 'failed' && <p className="auth-error" role="alert"><Icon name="warning" size={15}/> {card.message}</p>}
        <div className="modal-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon="lock" onClick={pay}>{stage === 'failed' ? 'Try again' : `Pay ${money(amount)}`}</Button></div>
      </>}
    </div>
  </div>, document.querySelector('.app') ?? document.body);
}

/** A coach's fees for the tournament, worked out from their entries, with ways to settle them. */
export function TeamInvoice({ school }: { school: string }) {
  const store = useStore();
  const { tournament, entries } = store;
  const payment = store.paymentFor(school);
  const invoice = invoiceFor(tournament, entries, school, payment);
  const fees = tournament.fees ?? defaultFees;
  const [paying, setPaying] = useState(false);
  if (invoice.entries === 0) return null;
  // Schools are invoiced after the tournament, on their final entries and the judges they brought.
  const due = tournament.status === 'finished';
  const settled = due && invoice.balance <= 0;
  return <section className="panel team-invoice">
    <div className="panel-head"><div><h2>{due ? 'Invoice' : 'Estimated fees'}</h2><p>{tournament.name} · {due ? 'sent when the tournament ended' : 'invoiced after the tournament'}</p></div>
      {!due ? <Badge tone="neutral" icon="clock">Nothing to pay yet</Badge> : <Badge tone={settled ? 'success' : payment.checkPending ? 'warning' : 'info'} icon={settled ? 'check' : 'clock'}>{settled ? (invoice.balance < 0 ? `Paid · ${money(-invoice.balance)} credit` : 'Paid in full') : payment.checkPending ? 'Check to be collected' : payment.paid > 0 ? `${money(invoice.balance)} still due` : 'Payment due'}</Badge>}</div>
    <div className="invoice-body">
      <dl className="invoice-lines">
        <div><dt>{invoice.entries} {invoice.entries === 1 ? 'entry' : 'entries'} <small>× {money(fees.entry)}</small></dt><dd>{money(invoice.entryTotal)}</dd></div>
        <div><dt>School fee</dt><dd>{money(invoice.schoolFee)}</dd></div>
        <div><dt>Judges <small>you owe {invoice.judgesOwed}, one per {fees.entriesPerJudge} entries</small>
          <span className="judge-stepper"><button aria-label="Bring one fewer judge" disabled={due || payment.judgesBringing === 0} onClick={() => store.setJudgesBringing(school, payment.judgesBringing - 1)}>−</button><b>{payment.judgesBringing}</b><button aria-label="Bring one more judge" disabled={due} onClick={() => store.setJudgesBringing(school, payment.judgesBringing + 1)}>+</button><em>{due ? 'brought' : 'bringing'}</em></span>
        </dt><dd>{invoice.judgesShort ? money(invoice.judgeTotal) : 'Covered'}{invoice.judgesShort > 0 && <small>{invoice.judgesShort} hired × {money(fees.judge)}</small>}</dd></div>
        <div className="total"><dt>{due ? 'Total' : 'Estimated total'}</dt><dd>{money(invoice.total)}</dd></div>
        {payment.paid > 0 && <div><dt>Paid {payment.method === 'check' ? 'by check' : 'by card'} <small>{payment.paidAt} · {payment.reference}</small></dt><dd>{money(-payment.paid)}</dd></div>}
        {payment.paid > 0 && <div className="total"><dt>{invoice.balance < 0 ? 'Credit' : 'Balance due'}</dt><dd>{money(Math.abs(invoice.balance))}</dd></div>}
      </dl>
      <div className="invoice-actions">
        {!due ? <p><Icon name="info" size={16}/> You’ll be invoiced after the tournament, based on your final entries and the judges you bring. There’s nothing to pay now.</p>
        : settled ? <p><Icon name="check" size={16}/> {invoice.balance < 0 ? 'You’ve paid more than you owe. The host will refund the difference.' : 'Thank you. This tournament is paid in full.'}</p> : <>
          <Button icon="lock" onClick={() => setPaying(true)}>Pay {money(invoice.balance)} by card</Button>
          <Button variant="secondary" icon="file" disabled={payment.checkPending} onClick={() => store.promiseCheck(school)}>{payment.checkPending ? 'Check noted' : 'Pay by check'}</Button>
          <p>{payment.checkPending ? 'The director knows to expect your check.' : `Fees go to ${tournament.host || 'the host school'}. Card payments are simulated: no money moves.`}</p>
        </>}
      </div>
    </div>
    {paying && <PaymentSimulator school={school} amount={invoice.balance} invoice={invoice} onClose={() => setPaying(false)}/>}
  </section>;
}

/** The director's fee settings. */
export function FeeSettings({ editable }: { editable: boolean }) {
  const { tournament, updateTournament } = useStore();
  const fees = tournament.fees ?? defaultFees;
  const set = (key: keyof Fees, text: string) => updateTournament({ fees: { ...fees, [key]: Math.max(key === 'entriesPerJudge' ? 1 : 0, Number(text.replace(/\D/g, '')) || 0) } });
  return <div className="fee-settings">
    <div className="field-label"><span>Fees</span><small>Each school is invoiced from its entries</small></div>
    <div className="fee-grid">
      <label><span>Per entry</span><span className="money-input"><i>$</i><input inputMode="numeric" value={fees.entry} disabled={!editable} onChange={event => set('entry', event.target.value)}/></span></label>
      <label><span>Per school</span><span className="money-input"><i>$</i><input inputMode="numeric" value={fees.school} disabled={!editable} onChange={event => set('school', event.target.value)}/></span></label>
      <label><span>Per judge not supplied</span><span className="money-input"><i>$</i><input inputMode="numeric" value={fees.judge} disabled={!editable} onChange={event => set('judge', event.target.value)}/></span></label>
      <label><span>One judge owed per</span><span className="money-input"><input inputMode="numeric" value={fees.entriesPerJudge} disabled={!editable} onChange={event => set('entriesPerJudge', event.target.value)}/><i>entries</i></span></label>
    </div>
  </div>;
}

/** The director's view of what each school owes and has paid. */
export function PaymentsPanel() {
  const store = useStore();
  const { tournament, entries } = store;
  const [reminded, setReminded] = useState<string[]>([]);
  const schools = [...new Set(entries.map(entry => entry.school))].sort();
  const rows = schools.map(school => ({ school, payment: store.paymentFor(school), invoice: invoiceFor(tournament, entries, school, store.paymentFor(school)) }));
  const billed = rows.reduce((sum, row) => sum + row.invoice.total, 0);
  const collected = rows.reduce((sum, row) => sum + Math.min(row.invoice.paid, row.invoice.total), 0);
  const unpaid = rows.filter(row => row.invoice.balance > 0);
  const sent = tournament.status === 'finished';
  return <div className="payments-panel">
    <div className="payments-head"><div><span className="eyebrow">Fees and payments</span><h3>{sent ? `${money(collected)} of ${money(billed)} collected` : `${money(billed)} estimated across ${rows.length} schools`}</h3></div>
      {sent ? <Badge tone={unpaid.length ? 'warning' : 'success'} icon={unpaid.length ? 'clock' : 'check'}>{unpaid.length ? `${money(billed - collected)} outstanding from ${unpaid.length} ${unpaid.length === 1 ? 'school' : 'schools'}` : 'Every school has paid'}</Badge> : <Badge tone="neutral" icon="clock">Invoices go out when you end the tournament</Badge>}</div>
    {sent && <dl className="payout"><div><dt>Paid in by schools</dt><dd>{money(collected)}</dd></div><div><dt>Orator fee for this tournament <small>placeholder amount</small></dt><dd>{money(-ORATOR_TOURNAMENT_FEE)}</dd></div><div className="net"><dt>Transferred to {tournament.host || 'the host school'}</dt><dd>{money(Math.max(0, collected - ORATOR_TOURNAMENT_FEE))}</dd></div></dl>}
    <div className="payments-table" tabIndex={0} aria-label="Payments by school" role="region">
      <div className="payments-row payments-labels"><span>School</span><span>Entries</span><span>Judges</span><span>{sent ? 'Total' : 'Estimate'}</span><span>Status</span><span/></div>
      {rows.map(({ school, payment, invoice }) => <div className="payments-row" key={school}>
        <strong>{school}</strong><span>{invoice.entries}</span>
        <span>{invoice.judgesBringing} of {invoice.judgesOwed}{invoice.judgesShort > 0 && <small> · {invoice.judgesShort} to hire</small>}</span>
        <span>{money(invoice.total)}</span>
        <span>{!sent ? <Badge tone="neutral">Not invoiced yet</Badge> : invoice.balance <= 0 ? <Badge tone="success" icon="check">{invoice.balance < 0 ? `Paid · refund ${money(-invoice.balance)}` : `Paid by ${payment.method === 'check' ? 'check' : 'card'}`}</Badge> : payment.checkPending ? <Badge tone="warning" icon="file">Check expected</Badge> : payment.paid > 0 ? <Badge tone="warning" icon="clock">{money(invoice.balance)} still due</Badge> : <Badge tone="danger" icon="warning">Not paid</Badge>}</span>
        <span className="payments-action">{sent && invoice.balance > 0 && (payment.checkPending ? <button onClick={() => store.recordPayment(school, invoice.balance, 'check')}>Mark check received</button> : reminded.includes(school) ? <small>Marked as reminded</small> : <button onClick={() => setReminded(list => [...list, school])}>Send reminder</button>)}{sent && invoice.balance <= 0 && payment.reference && <small>{payment.reference}</small>}</span>
      </div>)}
    </div>
    <p className="payments-note"><Icon name="info" size={14}/> Payments here are simulated so you can see the flow. Schools are invoiced when the tournament ends. In the real product they pay digitally, Orator keeps its per-tournament fee, and the rest is transferred to the host school through a payment provider.</p>
  </div>;
}
