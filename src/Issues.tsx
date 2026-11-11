import { useState } from 'react';
import { Badge, Button, Icon } from './ui';
import { useStore } from './store';
import { issueKinds, type IssueKind } from './tournament';

const kinds = Object.keys(issueKinds) as IssueKind[];

/** The form anyone at the tournament uses to tell the tab room something is wrong. */
export function ReportIssueForm({ reporter, role, onClose }: { reporter: string; role: string; onClose: () => void }) {
  const { reportIssue } = useStore();
  const [kind, setKind] = useState<IssueKind>('no-judge');
  const [where, setWhere] = useState('');
  const [detail, setDetail] = useState('');
  const [sent, setSent] = useState(false);
  if (sent) return <div className="modal-sent"><span className="success-icon"><Icon name="check" size={24}/></span><h3>Sent to the tournament director</h3><p>Your report is on the director’s issue board now. Stay where you are if you can, so tab room staff can find you.</p><Button onClick={onClose}>Done</Button></div>;
  return <form className="support-form" onSubmit={event => { event.preventDefault(); reportIssue({ kind, where: where.trim(), detail: detail.trim(), reporter, role }); setSent(true); }}>
    <fieldset className="issue-kinds"><legend>What’s happening?</legend>{kinds.map(option => <label key={option} className={kind === option ? 'on' : ''}>
      <input type="radio" name="issue-kind" checked={kind === option} onChange={() => setKind(option)}/>
      <span><strong>{issueKinds[option].label}{issueKinds[option].urgent && <Badge tone="danger">Urgent</Badge>}</strong><small>{issueKinds[option].hint}</small></span>
    </label>)}</fieldset>
    {kind === 'injury' && <p className="issue-emergency" role="alert"><Icon name="warning" size={16}/><span><strong>If this is an emergency, call 911 first.</strong> Then send this report so the director can get staff to you.</span></p>}
    <label><span>Where? <small>Room or area</small></span><input value={where} onChange={event => setWhere(event.target.value)} placeholder="e.g. Room 214" required/></label>
    <label><span>Details <small>Optional</small></span><textarea value={detail} onChange={event => setDetail(event.target.value)} placeholder="Anything that helps staff respond: the round, who is involved, what you need."/></label>
    <div className="modal-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><button className="button button-primary" type="submit" disabled={!where.trim()}><Icon name="send"/><span>Send to director</span></button></div>
  </form>;
}

export function ReportIssueModal({ reporter, role, onClose }: { reporter: string; role: string; onClose: () => void }) {
  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal" role="dialog" aria-modal="true" aria-label="Report a tournament issue" onClick={event => event.stopPropagation()}>
      <header><div><span className="eyebrow">TOURNAMENT ISSUE</span><h2>Report an issue</h2></div><button className="icon-button" aria-label="Close" onClick={onClose}><Icon name="close"/></button></header>
      <ReportIssueForm reporter={reporter} role={role} onClose={onClose}/>
    </div>
  </div>;
}

/** The director's live list of reported issues. Urgent ones sort to the top. */
export function IssueBoard() {
  const { issues, resolveIssue } = useStore();
  const [show, setShow] = useState<'open' | 'resolved'>('open');
  const open = issues.filter(issue => issue.status === 'open');
  const list = (show === 'open' ? open : issues.filter(issue => issue.status === 'resolved'))
    .slice().sort((a, b) => Number(issueKinds[b.kind].urgent) - Number(issueKinds[a.kind].urgent));
  const urgent = open.filter(issue => issueKinds[issue.kind].urgent).length;
  return <div className="issue-board">
    <section className="panel">
      <div className="panel-head"><div><h2>Tournament issues</h2><p>Reported by students, judges, coaches, and staff</p></div><Badge tone={urgent ? 'danger' : open.length ? 'warning' : 'success'} icon={open.length ? 'warning' : 'check'}>{open.length === 0 ? 'Nothing open' : `${open.length} open${urgent ? ` · ${urgent} urgent` : ''}`}</Badge></div>
      <div className="issue-tools"><div className="segmented"><button className={show === 'open' ? 'active' : ''} onClick={() => setShow('open')}>Open ({open.length})</button><button className={show === 'resolved' ? 'active' : ''} onClick={() => setShow('resolved')}>Resolved ({issues.length - open.length})</button></div></div>
      {list.length === 0 ? <p className="issue-empty">{show === 'open' ? 'No open issues. New reports appear here the moment they are sent.' : 'Nothing has been resolved yet.'}</p> : <ul className="issue-list">{list.map(issue => <li key={issue.id} className={issueKinds[issue.kind].urgent && issue.status === 'open' ? 'urgent' : ''}>
        <span className="issue-icon"><Icon name={issue.status === 'resolved' ? 'check' : 'warning'}/></span>
        <div><strong>{issueKinds[issue.kind].label}{issueKinds[issue.kind].urgent && issue.status === 'open' && <Badge tone="danger">Urgent</Badge>}</strong><p>{issue.detail || 'No details given.'}</p><small>{issue.where} · {issue.reporter} ({issue.role}) · {issue.time}</small></div>
        {issue.status === 'open' ? <Button variant="secondary" icon="check" onClick={() => resolveIssue(issue.id)}>Mark resolved</Button> : <Badge tone="success" icon="check">Resolved</Badge>}
      </li>)}</ul>}
    </section>
  </div>;
}
