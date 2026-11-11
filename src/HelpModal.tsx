import { useState } from 'react';
import { Icon } from './ui';
import { ReportIssueForm } from './Issues';

export type HelpKind = 'guide' | 'support';

const guides: Record<string, [string, string][]> = {
  student: [
    ['Find your round', 'Today’s schedule lists each round with its room and your speaking order.'],
    ['Check in', 'Open the round details and tap “I’m ready”. Your judge confirms you when you arrive.'],
    ['Read your coach’s focus', 'Notes from your coach appear on the overview. Mark them reviewed so your coach knows you saw them.'],
    ['See results', 'Rankings and ballot comments unlock when your coach releases them after the tournament.'],
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
    ['Enter your team', 'Under Entries, add each student and event, then send them to the director.'],
    ['Send a focus note', 'Open a student and send a note. You can see when they have read it.'],
    ['Release results', 'After the tournament ends, release rankings and comments to your students from Ballot review.'],
    ['Log practice feedback', 'Practice notes and the focus checklist live on each student’s record all season.'],
    ['Judging too?', 'Use “Working as” in the sidebar to switch to your judge workspace.'],
  ],
  director: [
    ['Set up the tournament', 'Work through Details, Entries, Judges, Schedule, and Review in Tournament setup.'],
    ['Build the schedule', 'On the Schedule step, Orator sorts every entry into rooms and assigns judges with no school conflicts.'],
    ['Watch for issues', 'The Issues tab lists everything people report, with urgent ones first.'],
    ['Run check-in', 'The Check-in tab shows which judges have arrived and lets you search by judge, room, or event.'],
    ['Monitor rounds', 'Mobile rounds shows ballot completion for every round.'],
  ],
};

export function HelpModal({ kind, persona, reporter, onClose }: { kind: HelpKind; persona: string; reporter: string; onClose: () => void }) {
  const [view, setView] = useState<HelpKind>(kind);
  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal" role="dialog" aria-modal="true" aria-label={view === 'guide' ? 'Quick-start guide' : 'Report an issue'} onClick={event => event.stopPropagation()}>
      <header><div><span className="eyebrow">HELP · {persona.toUpperCase()}</span><h2>{view === 'guide' ? 'Quick-start guide' : 'Report an issue'}</h2></div><button className="icon-button" aria-label="Close help" onClick={onClose}><Icon name="close"/></button></header>
      <div className="segmented"><button className={view === 'guide' ? 'active' : ''} onClick={() => setView('guide')}>Quick-start guide</button><button className={view === 'support' ? 'active' : ''} onClick={() => setView('support')}>Report an issue</button></div>
      {view === 'guide' ? <ol className="guide-steps">{guides[persona].map(([title, text], index) => <li key={title}><span>{index + 1}</span><div><strong>{title}</strong><p>{text}</p></div></li>)}</ol>
      : <ReportIssueForm reporter={reporter} role={persona} onClose={onClose}/>}
    </div>
  </div>;
}
