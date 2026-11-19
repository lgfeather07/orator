import { useCallback, useEffect, useState } from 'react';
import { Badge, Icon } from './ui';
import { useStore } from './store';
import * as api from './tournamentApi';

/**
 * A signed-in coach matches each student account to a name on their entries. Students see their events,
 * ballots and practice goals by that name, so a different spelling ("Maya R." vs "Maya Rodriguez") needs a link.
 */
export function StudentLinks({ school }: { school: string }) {
  const { tournamentId, entries } = useStore();
  const [accounts, setAccounts] = useState<{ userId: string; name: string; rosterName: string }[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { if (tournamentId) api.listSchoolStudents(tournamentId).then(setAccounts).catch(caught => { setAccounts([]); setError(caught instanceof Error ? caught.message : 'Couldn’t load student accounts.'); }); }, [tournamentId]);
  useEffect(load, [load]);
  const roster = [...new Set(entries.filter(entry => entry.school.trim().toLowerCase() === school.trim().toLowerCase()).map(entry => entry.student))].sort();
  const onRoster = (name: string) => roster.some(item => item.toLowerCase() === name.trim().toLowerCase());
  if (!accounts || accounts.length === 0) return error ? <p className="sync-inline" role="alert">{error}</p> : null;
  const unmatched = accounts.filter(account => !onRoster(account.rosterName || account.name)).length;
  const link = (userId: string, name: string) => { if (!tournamentId) return; setError(''); api.linkStudent(tournamentId, userId, name).then(load).catch(caught => setError(caught instanceof Error ? caught.message : 'Couldn’t link that student.')); };
  return <section className="panel student-links">
    <div className="panel-head"><div><h2>Student accounts</h2><p>Each student sees their events, released ballots, and practice goals under the name on your entries.</p></div><Badge tone={unmatched ? 'warning' : 'success'} icon={unmatched ? 'warning' : 'check'}>{unmatched ? `${unmatched} not matched` : 'All matched'}</Badge></div>
    {error && <p className="sync-inline" role="alert"><Icon name="warning" size={14}/> {error}</p>}
    <ul>{accounts.map(account => { const matched = onRoster(account.rosterName || account.name); return <li key={account.userId}>
      <span><strong>{account.name}</strong><small>{account.rosterName ? `Linked to ${account.rosterName}` : matched ? 'Matched by name' : 'No entry with this name'}</small></span>
      <select aria-label={`Roster name for ${account.name}`} value={account.rosterName || (matched ? roster.find(item => item.toLowerCase() === account.name.trim().toLowerCase()) ?? '' : '')} onChange={event => link(account.userId, event.target.value)}>
        <option value="">{matched && !account.rosterName ? 'Choose a name…' : 'Not linked'}</option>{roster.map(name => <option key={name} value={name}>{name}</option>)}
      </select>
      <Badge tone={matched ? 'success' : 'warning'} icon={matched ? 'check' : 'warning'}>{matched ? 'Matched' : 'Needs a link'}</Badge>
    </li>; })}</ul>
  </section>;
}
