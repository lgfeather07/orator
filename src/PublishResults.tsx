import { useEffect, useState } from 'react';
import { Badge, Button, Icon } from './ui';
import { useStore } from './store';
import type { Placing, TeamScore } from './results';
import { DEMO_TOURNAMENT_ID, buildSnapshot, loadDemoPublished, publishResults, publishedAt, saveDemoPublished, unpublishResults } from './publicResultsApi';
import { tournamentHref } from './PublicResults';

const when = (iso: string) => { const date = new Date(iso); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };

/**
 * The director publishes final placings and team points once the tournament has ended.
 * Only place, student and school go public; ballots and rankings stay private.
 */
export function PublishResults({ contests, teams }: { contests: { contest: string; placings: Placing[] }[]; teams: TeamScore[] }) {
  const store = useStore();
  const { tournament, live, tournamentId, isDirector } = store;
  const finished = tournament.status === 'finished';
  const id = live ? tournamentId : DEMO_TOURNAMENT_ID;
  const [published, setPublished] = useState<string | null>(() => live ? null : loadDemoPublished()?.tournament.publishedAt ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!live) {
      // As in the database: reopening the demo tournament takes its results down.
      if (!finished && loadDemoPublished()) saveDemoPublished(null);
      setPublished(finished ? loadDemoPublished()?.tournament.publishedAt ?? null : null);
      return;
    }
    if (!tournamentId || !isDirector) return;
    let current = true;
    publishedAt(tournamentId).then(value => { if (current) setPublished(value); }).catch(() => undefined);
    return () => { current = false; };
  }, [live, tournamentId, isDirector, finished]);

  if (!finished || (live && !isDirector) || !id) return null;

  const placed = contests.filter(item => item.placings.length > 0);
  const snapshot = buildSnapshot(placed, teams);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Something went wrong. Try again.'); } finally { setBusy(false); }
  };
  const publish = () => run(async () => {
    if (live) { setPublished(await publishResults(id, snapshot)); return; }
    const stamp = new Date().toISOString();
    saveDemoPublished({ tournament: { id, name: tournament.name, date: tournament.date, host: tournament.host, publishedAt: stamp }, snapshot });
    setPublished(stamp);
  });
  const unpublish = () => run(async () => {
    if (live) await unpublishResults(id); else saveDemoPublished(null);
    setPublished(null);
  });

  return <section className="panel publish-results" aria-labelledby="publish-results-title">
    <div className="panel-head"><div><h2 id="publish-results-title">Public results</h2><p>Final placings and team points, open to anyone without an account</p></div>
      {published ? <Badge tone="success" icon="check">Published {when(published)}</Badge> : <Badge icon="lock">Not published</Badge>}</div>
    <div className="publish-results-body">
      <p>{published ? 'Anyone can see this tournament’s final placings, finalists, and team points. Publish again after a correction to replace them.' : 'Results are final. Publish them so families, schools, and the press can see final placings, finalists, and team points.'} Ballots, judges’ comments, preliminary ranks, ratings, and tie-breaks stay private.</p>
      <p className="publish-results-count"><Icon name="info" size={14}/><span>{placed.length} of {contests.length} {contests.length === 1 ? 'final' : 'finals'} placed · {snapshot.placings.length} {snapshot.placings.length === 1 ? 'finalist' : 'finalists'} · {snapshot.teams.length} {snapshot.teams.length === 1 ? 'school' : 'schools'} with team points{placed.length < contests.length ? '. Finals without placings are left out.' : ''}</span></p>
      {live && !store.resultsAreReal && <p className="publish-results-warn"><Icon name="warning" size={14}/><span>These placings come from sample results, not judges’ ballots.</span></p>}
      {error && <p className="publish-results-warn" role="alert"><Icon name="warning" size={14}/><span>{error}</span></p>}
      <div className="publish-results-actions">
        <Button icon={published ? 'upload' : 'send'} onClick={publish} disabled={busy || placed.length === 0}>{busy ? 'One moment…' : published ? 'Publish again' : 'Publish results'}</Button>
        {published && <Button variant="secondary" onClick={unpublish} disabled={busy}>Unpublish</Button>}
        {published && <a className="button button-ghost" href={tournamentHref(id)}><Icon name="eye"/><span>View public page</span></a>}
      </div>
    </div>
  </section>;
}
