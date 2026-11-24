import { useState } from 'react';
import { Badge, Button, Icon } from './ui';
import { useStore } from './store';

const HIDE_KEY = 'orator-getting-started-hidden';
const readHidden = (): string[] => { try { return JSON.parse(localStorage.getItem(HIDE_KEY) ?? '[]') as string[]; } catch { return []; } };
const writeHidden = (ids: string[]) => { try { localStorage.setItem(HIDE_KEY, JSON.stringify(ids)); } catch { /* storage off */ } };

/**
 * A signed-in director's checklist for running their first tournament on Orator, with the invite link to send
 * coaches. Each step ticks itself off from what the tournament already holds. Hidden per tournament on request.
 */
export function GettingStarted({ onStep }: { onStep: (step: number) => void }) {
  const { live, tournament, tournamentId, entries, sections } = useStore();
  const [hidden, setHidden] = useState(readHidden);
  const [copied, setCopied] = useState<'' | 'yes' | 'select'>('');
  if (!live || !tournamentId || hidden.includes(tournamentId) || tournament.status === 'finished') return null;
  const link = `${window.location.origin}/#/calendar/${tournamentId}`;
  const schools = new Set(entries.map(entry => entry.school.trim().toLowerCase())).size;
  const steps: { title: string; detail: string; done: boolean; action?: { label: string; run: () => void } }[] = [
    { title: 'Set the basics', detail: 'Date, events, rounds, round times and fees. Defaults follow the NSAA manual and Nebraska norms.', done: !!tournament.date && tournament.eventIds.length > 0, action: { label: 'Details', run: () => onStep(0) } },
    { title: 'Invite coaches', detail: 'Send coaches the link below. They create a free account, register their school, and you approve them on the People tab.', done: schools > 0 },
    { title: 'Coaches add students and judges', detail: 'Each coach can paste their roster straight from a spreadsheet or another site’s export, and list the judges they’re bringing. Judges get a private sign-in link, no account needed.', done: entries.length > 0, action: { label: 'Entries', run: () => onStep(1) } },
    { title: 'Close entries and build the schedule', detail: 'Orator places speakers and judges, keeps judges away from their own schools, and flags any problems.', done: sections.length > 0, action: { label: 'Schedule', run: () => onStep(3) } },
    { title: 'Publish, run the day, end it', detail: 'Publishing sends everyone their rooms. Judges score on their phones, finals are worked out for you, and ending the tournament sends each school its invoice.', done: tournament.status === 'running', action: { label: 'Review', run: () => onStep(4) } },
  ];
  const left = steps.filter(step => !step.done).length;
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied('yes'); }
    catch { setCopied('select'); }
  };
  const hide = () => { const next = [...hidden, tournamentId]; writeHidden(next); setHidden(next); };
  return <section className="panel getting-started" aria-labelledby="getting-started-title">
    <div className="panel-head"><div><h2 id="getting-started-title">Getting started</h2><p>Running your first tournament on Orator, step by step. Coming from SpeechWire? Nothing needs to be re-typed: coaches paste their rosters.</p></div>
      <span className="panel-head-actions"><Badge tone={left ? 'info' : 'success'} icon={left ? undefined : 'check'}>{left ? `${steps.length - left} of ${steps.length} done` : 'All set'}</Badge><button type="button" className="gs-hide" onClick={hide}>Hide</button></span></div>
    <ol className="gs-steps">{steps.map((step, index) => <li key={step.title} className={step.done ? 'done' : ''}>
      <span className="gs-mark" aria-hidden="true">{step.done ? <Icon name="check" size={14}/> : index + 1}</span>
      <div><strong>{step.title}{step.done && <span className="sr-only"> (done)</span>}</strong><small>{step.detail}</small>
        {index === 1 && <div className="gs-link"><input id="invite-link" aria-label="Invite link for coaches" readOnly value={link} onFocus={event => event.target.select()}/><Button variant="secondary" icon="file" onClick={copy}>{copied === 'yes' ? 'Copied' : 'Copy link'}</Button></div>}
        {index === 1 && tournament.listed === false && <small className="gs-warn"><Icon name="warning" size={13}/> Your tournament isn’t on the public calendar, so this link won’t open for coaches yet. List it under Public calendar on the Details step, or have coaches sign up and pick it under Join a tournament.</small>}
        {index === 1 && copied === 'select' && <small role="status">Copying isn’t allowed here. Select the link above and copy it.</small>}
        {index === 1 && copied === 'yes' && <small role="status">Copied. Paste it into an email or text to your coaches.</small>}
      </div>
      {step.action && !step.done && <Button variant="secondary" icon="arrow" onClick={step.action.run}>{step.action.label}</Button>}
    </li>)}</ol>
  </section>;
}
