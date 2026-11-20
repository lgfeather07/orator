import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, Icon, downloadText } from './ui';
import { useStore } from './store';
import { useAccess } from './Access';
import { ballotEvents } from './ballots';
import { defaultFees, divisionLabel, divisionOf, invoiceFor, loadLabel, sameSchool, type Entry, type Fees, type Invoice, type Payment, type Tournament } from './tournament';
import type { CoachJudge } from './judgeLinks';
import './print.css';
import './entryForm.css';

/**
 * Printable entry forms: one page per school with its students and events, waitlisted entries,
 * judges, fees and a coach's signature line. Built only from what the viewer can already see.
 */

const eventName = (id: string) => ballotEvents.find(event => event.id === id)?.name ?? id;
const money = (amount: number) => `${amount < 0 ? '−' : ''}$${Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'school';
/** The demo's coach (the persona a demo visitor signs in as). Signed-in mode uses the tournament's members. */
const demoCoaches: Record<string, string> = { 'wrenfield high': 'Erin Johnson' };

export type EntryFormStudent = { student: string; division: string; events: string[]; load: string };
export type EntryFormData = {
  school: string; coaches: string[];
  students: EntryFormStudent[];
  waitlisted: { student: string; event: string }[];
  judges: CoachJudge[]; judgesBringing: number;
  invoice: Invoice; fees: Fees; final: boolean;
  counts: { students: number; entries: number; events: number; multi: number; waitlisted: number };
};

/** Everything one school's entry form shows. Waitlisted entries are kept apart and aren't charged (as in `invoiceFor`). */
export function entryFormData(tournament: Tournament, entries: Entry[], school: string, payment: Payment, seats: CoachJudge[], coaches: string[]): EntryFormData {
  const order = (id: string) => { const at = tournament.eventIds.indexOf(id); return at < 0 ? 99 : at; };
  const mine = entries.filter(entry => sameSchool(entry.school, school)).sort((a, b) => order(a.eventId) - order(b.eventId));
  const admitted = mine.filter(entry => !entry.waitlisted);
  const names = [...new Map(admitted.map(entry => [entry.student.trim().toLowerCase(), entry.student.trim()])).values()].sort((a, b) => a.localeCompare(b));
  const students = names.map(name => {
    const theirs = admitted.filter(entry => entry.student.trim().toLowerCase() === name.toLowerCase());
    const divisions = [...new Set(theirs.map(entry => divisionLabel[divisionOf(entry)]))];
    return { student: name, division: divisions.join(', '), events: theirs.map(entry => `${eventName(entry.eventId)}${divisions.length > 1 ? ` (${divisionLabel[divisionOf(entry)]})` : ''}`), load: loadLabel(theirs.length) };
  });
  const waitlisted = mine.filter(entry => entry.waitlisted).sort((a, b) => a.student.localeCompare(b.student))
    .map(entry => ({ student: entry.student.trim(), event: `${eventName(entry.eventId)} · ${divisionLabel[divisionOf(entry)]}` }));
  const invoice = invoiceFor(tournament, entries, school, payment);
  return {
    school, coaches, students, waitlisted, invoice,
    judges: seats.filter(seat => sameSchool(seat.school, school)), judgesBringing: payment.judgesBringing,
    fees: tournament.fees ?? defaultFees, final: tournament.status === 'finished',
    counts: { students: students.length, entries: admitted.length, events: new Set(admitted.map(entry => entry.eventId)).size, multi: students.filter(row => row.load).length, waitlisted: waitlisted.length },
  };
}

/** Every entry as a CSV that the coach's "Upload a file" import also reads (student, event, division columns). */
export function entriesCsv(entries: Entry[], tournament: Tournament) {
  const cell = (value: string) => /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const order = (id: string) => { const at = tournament.eventIds.indexOf(id); return at < 0 ? 99 : at; };
  const rows = [...entries].sort((a, b) => a.school.localeCompare(b.school) || a.student.localeCompare(b.student) || order(a.eventId) - order(b.eventId));
  return ['school,student,event,division,status', ...rows.map(entry => [entry.school.trim(), entry.student.trim(), eventName(entry.eventId), divisionLabel[divisionOf(entry)], entry.waitlisted ? 'Waitlisted' : 'Entered'].map(cell).join(','))].join('\n') + '\n';
}

/** Coach names for a school: approved coach members the viewer can see, plus any the caller knows (the signed-in coach). */
function useCoachNames() {
  const { members, live } = useStore();
  return (school: string, known: string[] = []) => {
    const names = [...known, ...members.filter(member => member.role === 'coach' && member.status === 'approved' && sameSchool(member.school, school)).map(member => member.name), ...(!live && demoCoaches[school.trim().toLowerCase()] ? [demoCoaches[school.trim().toLowerCase()]] : [])];
    return [...new Set(names.map(name => name.trim()).filter(Boolean))];
  };
}

/** One school's printed entry form. */
export function EntryFormPage({ tournament, data }: { tournament: Tournament; data: EntryFormData }) {
  const { invoice, fees, counts } = data;
  const judgeNote = (seat: CoachJudge) => seat.status === 'declined' ? 'Declined by the director' : seat.clean ? 'Clean judge: knows no competitors' : seat.knows.length ? `Knows students at ${seat.knows.join(', ')}; kept out of those rooms` : `Kept out of ${data.school} rooms`;
  const approved = data.judges.filter(seat => seat.status === 'approved').length;
  return <article className="print-page entry-form" aria-label={`Entry form for ${data.school}`}>
    <header className="print-head"><strong>{tournament.name}</strong><span>Entry form</span></header>
    <dl className="ef-facts">
      <div><dt>School</dt><dd>{data.school}</dd></div>
      <div><dt>Tournament date</dt><dd>{tournament.date || '—'}</dd></div>
      <div><dt>Host</dt><dd>{tournament.host || '—'}</dd></div>
      <div><dt>{data.coaches.length > 1 ? 'Coaches' : 'Coach'}</dt><dd>{data.coaches.length ? data.coaches.join(', ') : <span className="ef-blank"/>}</dd></div>
    </dl>
    <p className="ef-counts"><b>{plural(counts.students, 'student')}</b> · <b>{plural(counts.entries, 'entry', 'entries')}</b> in {plural(counts.events, 'event')}{counts.multi ? <> · {counts.multi} in more than one event</> : null}{counts.waitlisted ? <> · <b>{counts.waitlisted} waitlisted</b></> : null}</p>

    <h3 className="ef-title">Entries</h3>
    {data.students.length === 0 ? <p className="print-meta">No entries yet.</p> : <table className="ef-table ef-main">
      <thead><tr><th scope="col" className="ef-num">#</th><th scope="col">Student</th><th scope="col">Division</th><th scope="col">Events</th><th scope="col">Entry</th></tr></thead>
      <tbody>{data.students.map((row, index) => <tr key={row.student}><td>{index + 1}</td><td><b>{row.student}</b></td><td>{row.division}</td><td>{row.events.join(', ')}</td><td>{row.load || 'Single'}</td></tr>)}</tbody>
    </table>}

    {data.waitlisted.length > 0 && <>
      <h3 className="ef-title">Waitlisted entries <span className="ef-tag">Not admitted</span></h3>
      <p className="print-meta">Over the tournament’s entry limit. Not scheduled or charged unless the director admits them.</p>
      <table className="ef-table ef-waitlist">
        <thead><tr><th scope="col">Student</th><th scope="col">Event · division</th><th scope="col">Status</th></tr></thead>
        <tbody>{data.waitlisted.map((row, index) => <tr key={`${row.student}-${row.event}-${index}`}><td><b>{row.student}</b></td><td>{row.event}</td><td>Waitlisted</td></tr>)}</tbody>
      </table>
    </>}

    <h3 className="ef-title">Judges</h3>
    {data.judges.length > 0 ? <table className="ef-table">
      <thead><tr><th scope="col">Judge</th><th scope="col">Notes</th></tr></thead>
      <tbody>{data.judges.map(seat => <tr key={seat.id}><td><b>{seat.name}</b></td><td>{judgeNote(seat)}</td></tr>)}</tbody>
    </table> : <p className="print-meta">{data.judgesBringing > 0 ? `Bringing ${plural(data.judgesBringing, 'judge')}. Names: ` : 'No judges entered yet. Names: '}<span className="ef-blank wide"/></p>}
    <p className="print-meta">{data.judges.length > 0 ? `${approved} entered · ` : ''}{invoice.judgesOwed} owed (one per {fees.entriesPerJudge} entries){invoice.judgesShort > 0 ? ` · ${invoice.judgesShort} short, charged as hired judges` : invoice.judgesOwed > 0 ? ' · covered' : ''}</p>

    <h3 className="ef-title">{data.final ? 'Invoice' : 'Fee estimate'}</h3>
    <table className="ef-table ef-fees">
      <tbody>
        <tr><td>{plural(invoice.entries, 'entry', 'entries')} × {money(fees.entry)}</td><td>{money(invoice.entryTotal)}</td></tr>
        {invoice.schoolFee > 0 && <tr><td>School fee</td><td>{money(invoice.schoolFee)}</td></tr>}
        <tr><td>Judges: {invoice.judgesOwed} owed, {invoice.judgesBringing} {data.final ? 'brought' : 'bringing'}{invoice.judgesShort > 0 ? `, ${invoice.judgesShort} short × ${money(fees.judge)}` : ''}</td><td>{invoice.judgesShort > 0 ? money(invoice.judgeTotal) : 'Covered'}</td></tr>
        <tr className="ef-total"><th scope="row">{data.final ? 'Total' : 'Estimated total'}</th><td>{money(invoice.total)}</td></tr>
        {data.final && invoice.paid > 0 && <tr><td>Paid</td><td>{money(-invoice.paid)}</td></tr>}
        {data.final && invoice.paid > 0 && <tr className="ef-total"><th scope="row">{invoice.balance < 0 ? 'Credit' : 'Balance due'}</th><td>{money(Math.abs(invoice.balance))}</td></tr>}
      </tbody>
    </table>
    <p className="print-meta">{data.final ? `Invoiced after the tournament. Fees go to ${tournament.host || 'the host school'}.` : 'An estimate: schools are invoiced after the tournament on their final entries and the judges they bring. Waitlisted entries aren’t charged.'}</p>

    <section className="ef-sign">
      <p><b>I confirm these entries are eligible under NSAA rules.</b></p>
      <div className="ef-sign-lines"><span>Coach signature <i className="ef-line"/></span><span>Date <i className="ef-line short"/></span></div>
    </section>
    <p className="ef-foot">Printed {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} from Orator · {data.school}</p>
  </article>;
}

/** The coach's entry form panel on Team entries: print it (only the form prints) or download the school's entries. */
export function CoachEntryForm({ school }: { school: string }) {
  const store = useStore();
  const { tournament, entries, coachJudges } = store;
  const { membership } = useAccess('coach');
  const coachNames = useCoachNames();
  const [shown, setShown] = useState(false);
  const [printing, setPrinting] = useState(false);
  // Print once the form is on the page.
  useEffect(() => { if (printing && shown) { setPrinting(false); window.print(); } }, [printing, shown]);
  const mine = entries.filter(entry => sameSchool(entry.school, school));
  const data = entryFormData(tournament, entries, school, store.paymentFor(school), coachJudges, coachNames(school, membership && sameSchool(membership.school, school) ? [membership.name] : []));
  return <section className="panel entry-form-panel" aria-labelledby="entry-form-title">
    <div className="panel-head"><div><h2 id="entry-form-title">Entry form</h2><p>Your students, events, judges and fees on one page, with a signature line. Print it or save it as a PDF for registration.</p></div>
      <span className="panel-head-actions entry-form-actions">
        <Button icon="file" disabled={mine.length === 0} onClick={() => { setShown(true); setPrinting(true); }}>Print entry form</Button>
        {shown && <Button variant="secondary" icon="close" onClick={() => setShown(false)}>Hide form</Button>}
        <Button variant="secondary" icon="download" disabled={mine.length === 0} onClick={() => downloadText(`orator-entries-${slug(school)}.csv`, entriesCsv(mine, tournament))}>Download entries (CSV)</Button>
      </span></div>
    {mine.length === 0 ? <p className="entry-form-note"><Icon name="info" size={14}/> Add entries first; the form fills in from them.</p>
      : shown ? <div className="entry-form-preview"><p className="entry-form-note"><Icon name="info" size={14}/> What you see below is exactly what prints. Choose “Save as PDF” in the print dialog for a file.</p>
        <div className="ef-screen"><EntryFormPage tournament={tournament} data={data}/></div>
        {/* The copy that prints sits at the top of the page, so the form starts on page one with no blank pages after it. */}
        {createPortal(<div className="print-doc print-only ef-print-root" aria-hidden="true"><EntryFormPage tournament={tournament} data={data}/></div>, document.body)}</div>
      : <p className="entry-form-note"><Icon name="info" size={14}/> {plural(data.counts.entries, 'entry', 'entries')}{data.counts.waitlisted ? ` and ${data.counts.waitlisted} waitlisted` : ''} · {data.final ? 'invoice' : 'fee estimate'} {money(data.invoice.total)}</p>}
  </section>;
}

/** The director's "Entry forms" in the Print tab: a school filter, the CSV download, and one page per school. */
export function useEntryFormPages(): { controls: ReactNode; pages: ReactNode; count: number } {
  const store = useStore();
  const { tournament, entries, coachJudges, members } = store;
  const coachNames = useCoachNames();
  const [chosen, setChosen] = useState('all');
  const schools = [...new Map([...entries.map(entry => entry.school), ...members.filter(member => member.role === 'coach' && member.status === 'approved').map(member => member.school)]
    .filter(school => school.trim()).map(school => [school.trim().toLowerCase(), school.trim()])).values()].sort((a, b) => a.localeCompare(b));
  const school = chosen !== 'all' && schools.some(name => sameSchool(name, chosen)) ? chosen : 'all';
  const shown = school === 'all' ? schools : schools.filter(name => sameSchool(name, school));
  const controls = <>
    <label className="inline-select"><span>School</span><select value={school} onChange={event => setChosen(event.target.value)}><option value="all">All schools</option>{schools.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
    <Button variant="secondary" icon="download" disabled={entries.length === 0} onClick={() => downloadText(`orator-entries-${slug(tournament.name)}.csv`, entriesCsv(entries, tournament))}>Download all entries (CSV)</Button>
  </>;
  const pages = shown.length === 0 ? <div className="print-page"><p className="print-meta">No school has entered yet.</p></div>
    : shown.map(name => <EntryFormPage key={name} tournament={tournament} data={entryFormData(tournament, entries, name, store.paymentFor(name), coachJudges, coachNames(name))}/>);
  return { controls, pages, count: shown.length };
}
