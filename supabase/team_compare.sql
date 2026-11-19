-- Orator: the team point scale behind published results, for Compare teams.
-- Run in the Supabase dashboard after public_results.sql: SQL Editor → New query → paste → Run.
-- Safe to run again.
--
-- published_team_points stores each school's total only. To show where a school earns its points
-- (team points by event), the app works them out from the published final placings and the scale the
-- tournament used: points for 1st to 6th (NSAA: 20-18-16-14-12-10) and whether novice finals counted.
-- The director's app sends that scale right after publish_results; it is public exactly when the
-- tournament's results are. Nothing private is added: no ballots, ranks, ratings or tie-breaks.

create table if not exists public.published_team_scoring (
  tournament_id uuid primary key references public.tournaments (id) on delete cascade,
  team_point_scale int[] not null default '{20,18,16,14,12,10}',
  novice_counts boolean not null default false,
  constraint published_team_scoring_scale check (
    cardinality(team_point_scale) between 1 and 20
    and array_position(team_point_scale, null) is null
    and 0 <= all (team_point_scale) and 1000 >= all (team_point_scale)
  )
);

-- Access rules: like the other published tables. Anyone reads it while the results are public; the
-- tournament's director writes it, once the tournament has ended.
alter table public.published_team_scoring enable row level security;
revoke all on public.published_team_scoring from anon, authenticated;
grant select on public.published_team_scoring to anon;
grant select, insert, delete on public.published_team_scoring to authenticated;

drop policy if exists "Anyone reads published team scoring" on public.published_team_scoring;
create policy "Anyone reads published team scoring" on public.published_team_scoring for select to anon, authenticated
  using (public.results_are_public(tournament_id));
drop policy if exists "Directors read their own team scoring" on public.published_team_scoring;
create policy "Directors read their own team scoring" on public.published_team_scoring for select to authenticated
  using (private.is_director(tournament_id));
drop policy if exists "Directors publish team scoring" on public.published_team_scoring;
create policy "Directors publish team scoring" on public.published_team_scoring for insert to authenticated
  with check (private.is_director(tournament_id) and private.tournament_status(tournament_id) = 'finished');
drop policy if exists "Directors unpublish team scoring" on public.published_team_scoring;
create policy "Directors unpublish team scoring" on public.published_team_scoring for delete to authenticated
  using (private.is_director(tournament_id) and private.tournament_status(tournament_id) = 'finished');

-- Save the scale with the published results. Called by the app straight after publish_results, so
-- the results must already be published. Runs with the caller's rights: the rules above still apply.
create or replace function public.publish_team_scoring(target uuid, scale int[], novice_counts boolean) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if not private.is_director(target) then
    raise exception 'Only this tournament''s director can publish its results.' using errcode = 'insufficient_privilege';
  end if;
  if private.tournament_status(target) is distinct from 'finished' then
    raise exception 'Results can be published once the tournament has ended.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.tournaments t where t.id = target and t.results_published_at is not null) then
    raise exception 'Publish the results first.' using errcode = 'check_violation';
  end if;
  delete from public.published_team_scoring where tournament_id = target;
  insert into public.published_team_scoring (tournament_id, team_point_scale, novice_counts)
    values (target, coalesce(scale, '{20,18,16,14,12,10}'), coalesce(novice_counts, false));
end;
$$;
revoke all on function public.publish_team_scoring(uuid, int[], boolean) from public, anon;
grant execute on function public.publish_team_scoring(uuid, int[], boolean) to authenticated;

-- Unpublishing or reopening the tournament (both clear results_published_at) removes the scale too,
-- so a later publish from an older app can't pick up a stale one.
create or replace function public.withdraw_team_scoring() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.results_published_at is not null and new.results_published_at is null then
    delete from public.published_team_scoring where tournament_id = new.id;
  end if;
  return null;
end;
$$;
revoke all on function public.withdraw_team_scoring() from public, anon, authenticated;
drop trigger if exists withdraw_team_scoring on public.tournaments;
create trigger withdraw_team_scoring after update of results_published_at, status on public.tournaments
  for each row execute function public.withdraw_team_scoring();
