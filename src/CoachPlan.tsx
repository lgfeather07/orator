import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Badge, Button, Icon } from './ui';
import { supabase } from './auth';
import { useStore } from './store';

/** What the coach plan costs a school for one season. */
export const COACH_PLAN_PRICE = 99;

export type Plan = { kind: 'trial' | 'paid'; endsAt: string } | null;
type Loaded = { plan: Plan; trialUsed: boolean; error: string };

const escape = (text: string) => text.trim().replace(/[\\%_]/g, match => `\\${match}`);

/** The school's current plan (supabase/coach_plans.sql), and whether its one free trial is used. */
async function loadPlan(school: string): Promise<Loaded> {
  if (!supabase) return { plan: null, trialUsed: false, error: '' };
  const { data, error } = await supabase.from('coach_plans').select('kind, ends_at').ilike('school', escape(school)).order('ends_at', { ascending: false });
  if (error) return { plan: null, trialUsed: false, error: /coach_plans/.test(error.message) ? 'The coach plan needs the latest database update (supabase/all_in_one.sql).' : error.message };
  const rows = (data ?? []) as { kind: 'trial' | 'paid'; ends_at: string }[];
  const now = Date.now();
  const current = rows.filter(row => Date.parse(row.ends_at) > now).sort((a, b) => (a.kind === 'paid' ? -1 : 1) - (b.kind === 'paid' ? -1 : 1))[0];
  return { plan: current ? { kind: current.kind, endsAt: current.ends_at } : null, trialUsed: rows.some(row => row.kind === 'trial'), error: '' };
}

async function startTrial(school: string): Promise<void> {
  if (!supabase) return;
  // The database sets a trial's dates itself: 30 days from now.
  const { error } = await supabase.from('coach_plans').insert({ school: school.trim(), kind: 'trial', ends_at: new Date().toISOString() });
  if (error) throw new Error(/coach_plans_one_trial|duplicate/.test(error.message) ? 'Your school has already used its free trial.' : error.message);
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
const daysLeft = (iso: string) => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86400000));

/** The plan for a school. The demo always has one, so every feature can be tried. */
export function usePlan(school: string) {
  const { live } = useStore();
  const [state, setState] = useState<Loaded & { loading: boolean }>({ plan: null, trialUsed: false, error: '', loading: live });
  const refresh = useCallback(() => { if (!live || !school) return; loadPlan(school).then(result => setState({ ...result, loading: false })); }, [live, school]);
  useEffect(refresh, [refresh]);
  if (!live) return { plan: { kind: 'paid' as const, endsAt: '' }, trialUsed: false, error: '', loading: false, refresh };
  return { ...state, refresh };
}

const FEATURES = [
  ['growth', 'Growth for every student', 'Average score and rank in each event, tournament by tournament, all season'],
  ['sparkle', 'What to practice next', 'The section judges mark lowest, turned into practice goals in one click'],
  ['users', 'Compare teams', 'Where your team scores against any other team, event by event'],
  ['archive', 'Students see their own growth', 'Each student’s My growth page, from the ballots you release'],
] as const;

/**
 * Shows the feature when the school has the coach plan (or its trial); otherwise what the plan includes and how
 * to start it. Each tournament's own ballots and results stay free either way.
 */
export function PlanGate({ school, role, feature, children }: { school: string; role: 'coach' | 'student'; feature: string; children: ReactNode }) {
  const { plan, trialUsed, error, loading, refresh } = usePlan(school);
  const { live } = useStore();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');
  if (!live) return <>{children}</>;
  if (loading) return <section className="panel plan-card"><p className="plan-note">Checking your school’s plan…</p></section>;
  if (plan) return <>
    {plan.kind === 'trial' && <p className="plan-trial" role="status"><Icon name="clock" size={14}/> <span>Free trial of the coach plan: {daysLeft(plan.endsAt)} {daysLeft(plan.endsAt) === 1 ? 'day' : 'days'} left (until {day(plan.endsAt)}).{role === 'coach' ? ` Keep it for $${COACH_PLAN_PRICE} for the season.` : ''}</span></p>}
    {children}
  </>;
  const start = async () => { setBusy(true); setFailed(''); try { await startTrial(school); refresh(); } catch (caught) { setFailed(caught instanceof Error ? caught.message : 'Couldn’t start the trial.'); } finally { setBusy(false); } };
  return <section className="panel plan-card" aria-labelledby="plan-title">
    <div className="panel-head"><div><span className="eyebrow">Coach plan · ${COACH_PLAN_PRICE} per school, per season</span><h2 id="plan-title">{feature} is part of the coach plan</h2>
      <p>{role === 'coach' ? `Everything for each tournament stays free: entries, judges, ballots and results. The plan adds season-long coaching tools for ${school}.` : `Your coach can add the plan for ${school}. Your ballots from each tournament stay free.`}</p></div>
      <Badge tone="info" icon="sparkle">{trialUsed ? 'Trial used' : '30-day free trial'}</Badge></div>
    <ul className="plan-features">{FEATURES.map(([icon, title, detail]) => <li key={title}><span className="plan-icon"><Icon name={icon} size={16}/></span><span><strong>{title}</strong><small>{detail}</small></span></li>)}</ul>
    {(error || failed) && <p className="sync-inline" role="alert"><Icon name="warning" size={14}/> {error || failed}</p>}
    {role === 'coach' ? <div className="plan-actions">
      {!trialUsed && <Button icon="sparkle" disabled={busy} onClick={start}>{busy ? 'Starting…' : 'Start the free 30-day trial'}</Button>}
      <p className="plan-note">{trialUsed ? 'Your free trial has ended. ' : 'No card needed for the trial. '}To buy the plan for ${COACH_PLAN_PRICE}, card checkout is coming soon. Until then your school can pay by check or purchase order: use the contact address at the bottom of this page.</p>
    </div> : <p className="plan-note">Ask your coach to start the free trial from their Student growth tab.</p>}
  </section>;
}
