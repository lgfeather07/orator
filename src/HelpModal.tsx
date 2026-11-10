import { useState } from 'react';
import { Badge, Button, Icon } from './ui';

export type HelpKind = 'guide' | 'support';

const guides: Record<string, [string, string][]> = {
  student: [
    ['Find your round', 'Today’s schedule lists each round with its room and your speaking order.'],
    ['Check in', 'Open the round details and tap “I’m ready”. Your judge confirms you when you arrive.'],
    ['Read your coach’s focus', 'Notes from your coach appear on the overview. Mark them reviewed so your coach knows you saw them.'],
    ['See results', 'Rankings and ballot comments unlock when the tournament director releases them.'],
  ],
  judge: [
    ['Open your ballot', 'Choose “Open e-ballot” for the round you are assigned to.'],
    ['Check in each speaker', 'Mark every speaker present or no-show as they arrive.'],
    ['Score and time', 'Rate each criterion from 1 to 5, record the speaking time, and write a comment.'],
    ['Rank and submit', 'Drag speakers into order on the ranking step. Orator blocks duplicate ranks and ranks that contradict points.'],
    ['Prefer paper?', 'Switch to “Paper” to scan or upload a handwritten ballot.'],
  ],
  coach: [
    ['Watch your team live', 'The overview shows who is competing, checked in, and waiting on ballots.'],
    ['Send a focus note', 'Open a student and send a note. You can see when they have read it.'],
    ['Log practice feedback', 'Practice notes and the focus checklist live on each student’s record all season.'],
    ['Judging too?', 'Use “Working as” in the sidebar to switch to your judge workspace.'],
  ],
  director: [
    ['Set up the tournament', 'Work through Details, Ballot criteria, Judges, and Review in Tournament setup.'],
    ['Decide who sees what', 'On the Review step, choose when students see rankings and comments.'],
    ['Run check-in', 'The Check-in tab shows which judges have arrived and lets you search by judge, room, or event.'],
    ['Monitor rounds', 'Mobile rounds shows ballot completion for every round.'],
  ],
};

export function HelpModal({ kind, persona, onClose }: { kind: HelpKind; persona: string; onClose: () => void }) {
  const [view, setView] = useState<HelpKind>(kind);
  const [topic, setTopic] = useState('Ballot or scoring problem');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal" role="dialog" aria-modal="true" aria-label={view === 'guide' ? 'Quick-start guide' : 'Contact tournament support'} onClick={event => event.stopPropagation()}>
      <header><div><span className="eyebrow">HELP · {persona.toUpperCase()}</span><h2>{view === 'guide' ? 'Quick-start guide' : 'Contact tournament support'}</h2></div><button className="icon-button" aria-label="Close help" onClick={onClose}><Icon name="close"/></button></header>
      <div className="segmented"><button className={view === 'guide' ? 'active' : ''} onClick={() => setView('guide')}>Quick-start guide</button><button className={view === 'support' ? 'active' : ''} onClick={() => setView('support')}>Report an issue</button></div>
      {view === 'guide' ? <ol className="guide-steps">{guides[persona].map(([title, text], index) => <li key={title}><span>{index + 1}</span><div><strong>{title}</strong><p>{text}</p></div></li>)}</ol>
      : sent ? <div className="modal-sent"><span className="success-icon"><Icon name="check" size={24}/></span><h3>Sent to the tournament desk</h3><p>Dan Miller and the tab room staff can see your report now. Someone will find you in person or reply here.</p><Button onClick={onClose}>Done</Button></div>
      : <div className="support-form">
        <Badge tone="success" icon="check">Tab room staffed until 6:00 PM today</Badge>
        <label><span>What do you need help with?</span><select value={topic} onChange={event => setTopic(event.target.value)}>{['Ballot or scoring problem', 'Wrong room or schedule', 'Student or judge is missing', 'I can’t find something in Orator', 'Something else'].map(option => <option key={option}>{option}</option>)}</select></label>
        <label><span>What happened?</span><textarea value={message} onChange={event => setMessage(event.target.value)} placeholder="Include the round and room if you can."/></label>
        <div className="modal-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon="send" disabled={!message.trim()} onClick={() => setSent(true)}>Send report</Button></div>
      </div>}
    </div>
  </div>;
}
