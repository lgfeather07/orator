import { useCallback, useEffect, useState } from 'react';
import { Badge, Icon } from './ui';
import { loadWithheld, sameName, setWithheld } from './publicResultsApi';

const message = (caught: unknown, fallback: string) => caught instanceof Error ? caught.message : fallback;

/**
 * Keep names off public results. A coach chooses for anyone on their team; a student chooses for themselves.
 * A withheld student's placings still show and still count for team points, as "Name withheld".
 */
export function ResultsPrivacy({ school, students, self = false }: { school: string; students: string[]; self?: boolean }) {
  const [hidden, setHidden] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');
  const load = useCallback(() => { loadWithheld(school).then(setHidden).catch(caught => { setHidden([]); setError(message(caught, 'Couldn’t load name privacy.')); }); }, [school]);
  useEffect(load, [load]);
  const isHidden = (student: string) => hidden?.some(name => sameName(name, student)) ?? false;
  const toggle = async (student: string) => {
    setError(''); setSaving(student);
    try { await setWithheld(school, student, !isHidden(student)); load(); } catch (caught) { setError(message(caught, 'Couldn’t save that.')); } finally { setSaving(''); }
  };
  const names = [...new Set(students.map(name => name.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (names.length === 0) return null;
  const count = names.filter(isHidden).length;
  return <section className="panel results-privacy" aria-labelledby="results-privacy-title">
    <div className="panel-head"><div><h2 id="results-privacy-title">{self ? 'My name on public results' : 'Names on public results'}</h2>
      <p>{self ? 'Final placings are public. You can show “Name withheld” instead of your name; your places still count for your team.' : 'Final placings are public. Withhold a student’s name and their places show as “Name withheld”; they still count for team points.'}</p></div>
      {hidden && !self && <Badge tone={count ? 'info' : 'neutral'}>{count ? `${count} withheld` : 'All shown'}</Badge>}</div>
    {error && <p className="sync-inline" role="alert"><Icon name="warning" size={14}/> {error}</p>}
    {hidden === null ? <p className="results-privacy-note">Loading…</p> : <ul>{names.map(student => {
      const off = isHidden(student);
      return <li key={student}>
        <label className="results-privacy-row">
          <input type="checkbox" checked={!off} disabled={saving === student} onChange={() => toggle(student)}/>
          <span><strong>{self ? 'Show my name' : student}</strong><small>{off ? 'Shown as “Name withheld”' : 'Name shown on public results'}</small></span>
        </label>
      </li>;
    })}</ul>}
    <p className="results-privacy-note">Withholding takes the name off results already published right away. Showing it again applies the next time each tournament publishes its results.</p>
  </section>;
}
