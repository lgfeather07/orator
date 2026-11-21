-- Orator public results: final placings and team points, published by the director.
-- Run in the Supabase dashboard after tournaments.sql: SQL Editor → New query → paste → Run.
-- Safe to run again.
--
-- "Results are public, but ballots and specific rankings are private."
-- Once a tournament has ended, its director publishes a snapshot of each contest's final
-- placings (place, student, school) and the team points standings. Anyone can read a published
-- snapshot, without an account. Nothing else is copied here: ballots, judges' comments,
-- preliminary ranks and ratings, cumulative ranks, each judge's ranks, rating points and
-- tie-break details stay in the private tables, which visitors without an account cannot read.
-- Publishing again replaces the snapshot; unpublishing removes it.

create schema if not exists private;

-- When the director last published results. Null means not published.
alter table public.tournaments add column if not exists results_published_at timestamptz;

create table if not exists public.published_results (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  -- An event in a division: 'info' for varsity, 'info:novice' for novice (see contestKey in src/tournament.ts).
  contest text not null,
  event_id text not null check (char_length(event_id) between 1 and 40),
  division text not null default 'varsity' check (division in ('varsity', 'novice')),
  place int not null check (place between 1 and 20),
  student text not null check (char_length(btrim(student)) between 1 and 120),
  school text not null check (char_length(btrim(school)) between 1 and 120),
  constraint published_results_contest check (contest = case when division = 'novice' then event_id || ':novice' else event_id end)
);
-- withheld: the student asked for their name to be kept off public results (supabase/privacy.sql).
alter table public.published_results add column if not exists withheld boolean not null default false;
-- One row per named student in each event. Withheld rows all read "Name withheld", so they are left out.
drop index if exists public.published_results_one_per_student;
create unique index if not exists published_results_one_per_named_student on public.published_results (tournament_id, contest, lower(school), lower(student)) where not withheld;
create index if not exists published_results_by_school on public.published_results (lower(school));

create table if not exists public.published_team_points (
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  school text not null check (char_length(btrim(school)) between 1 and 120),
  points int not null check (points between 0 and 100000),
  place int not null check (place between 1 and 500)
);
create unique index if not exists published_team_points_one_per_school on public.published_team_points (tournament_id, lower(school));
create index if not exists published_team_points_by_school on public.published_team_points (lower(school));

-- Whether a tournament's results are public right now: it has ended and the director has published.
-- It lives in the public schema (not private) because visitors without an account call it from the
-- read policies below, and tournaments.sql revokes everything in the private schema from them.
create or replace function public.results_are_public(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tournaments t where t.id = target and t.status = 'finished' and t.results_published_at is not null);
$$;
revoke all on function public.results_are_public(uuid) from public;
grant execute on function public.results_are_public(uuid) to anon, authenticated;

-- The name, date and host of each tournament with published results, newest first. Visitors can't
-- read the tournaments table itself; this exposes only these columns, and only for published tournaments.
create or replace function public.published_tournaments()
returns table (id uuid, name text, date text, host text, published_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select t.id, t.name, t.date, t.host, t.results_published_at
  from public.tournaments t
  where t.status = 'finished' and t.results_published_at is not null
  order by t.results_published_at desc;
$$;
revoke all on function public.published_tournaments() from public;
grant execute on function public.published_tournaments() to anon, authenticated;

-- Results are withdrawn if the tournament is reopened (moved back from "finished"): the timestamp is
-- cleared before the change is saved, and the snapshot is removed after it. A new tournament never
-- starts out published.
create or replace function public.guard_published_results() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.results_published_at := null;
  elsif new.status <> 'finished' then
    new.results_published_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_published_results on public.tournaments;
create trigger guard_published_results before insert or update on public.tournaments
  for each row execute function public.guard_published_results();

create or replace function public.withdraw_published_results() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'finished' and new.status <> 'finished' then
    delete from public.published_results where tournament_id = new.id;
    delete from public.published_team_points where tournament_id = new.id;
  end if;
  return null;
end;
$$;
drop trigger if exists withdraw_published_results on public.tournaments;
create trigger withdraw_published_results after update of status on public.tournaments
  for each row execute function public.withdraw_published_results();

revoke all on function public.guard_published_results() from public, anon, authenticated;
revoke all on function public.withdraw_published_results() from public, anon, authenticated;

-- Access rules. Anyone (with or without an account) reads published snapshots. Only the tournament's
-- director writes them, and only once the tournament has ended. Nobody edits a row in place: a new
-- snapshot replaces the old one.
alter table public.published_results enable row level security;
alter table public.published_team_points enable row level security;
revoke all on public.published_results, public.published_team_points from anon, authenticated;
grant select on public.published_results, public.published_team_points to anon;
grant select, insert, delete on public.published_results, public.published_team_points to authenticated;

drop policy if exists "Anyone reads published results" on public.published_results;
create policy "Anyone reads published results" on public.published_results for select to anon, authenticated
  using (public.results_are_public(tournament_id));
drop policy if exists "Directors read their own snapshot" on public.published_results;
create policy "Directors read their own snapshot" on public.published_results for select to authenticated
  using (private.is_director(tournament_id));
drop policy if exists "Directors publish results" on public.published_results;
create policy "Directors publish results" on public.published_results for insert to authenticated
  with check (private.is_director(tournament_id) and private.tournament_status(tournament_id) = 'finished');
drop policy if exists "Directors unpublish results" on public.published_results;
create policy "Directors unpublish results" on public.published_results for delete to authenticated
  using (private.is_director(tournament_id) and private.tournament_status(tournament_id) = 'finished');

drop policy if exists "Anyone reads published team points" on public.published_team_points;
create policy "Anyone reads published team points" on public.published_team_points for select to anon, authenticated
  using (public.results_are_public(tournament_id));
drop policy if exists "Directors read their own team points" on public.published_team_points;
create policy "Directors read their own team points" on public.published_team_points for select to authenticated
  using (private.is_director(tournament_id));
drop policy if exists "Directors publish team points" on public.published_team_points;
create policy "Directors publish team points" on public.published_team_points for insert to authenticated
  with check (private.is_director(tournament_id) and private.tournament_status(tournament_id) = 'finished');
drop policy if exists "Directors unpublish team points" on public.published_team_points;
create policy "Directors unpublish team points" on public.published_team_points for delete to authenticated
  using (private.is_director(tournament_id) and private.tournament_status(tournament_id) = 'finished');

-- Publish (or publish again): replace the snapshot and stamp the time, all at once.
-- Runs with the caller's rights, so the access rules above still decide what is allowed.
-- placings: [{ "contest", "event_id", "division", "place", "student", "school" }]
-- teams:    [{ "school", "points", "place" }]
create or replace function public.publish_results(target uuid, placings jsonb, teams jsonb) returns timestamptz
language plpgsql security invoker set search_path = '' as $$
declare
  stamped timestamptz := now();
begin
  if not private.is_director(target) then
    raise exception 'Only this tournament''s director can publish its results.' using errcode = 'insufficient_privilege';
  end if;
  if private.tournament_status(target) is distinct from 'finished' then
    raise exception 'Results can be published once the tournament has ended.' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(placings) <> 'array' or jsonb_typeof(teams) <> 'array' then
    raise exception 'Placings and teams must be lists.' using errcode = 'invalid_parameter_value';
  end if;
  delete from public.published_results where tournament_id = target;
  delete from public.published_team_points where tournament_id = target;
  insert into public.published_results (tournament_id, contest, event_id, division, place, student, school)
    select target, x.contest, x.event_id, coalesce(x.division, 'varsity'), x.place, btrim(x.student), btrim(x.school)
    from jsonb_to_recordset(placings) as x (contest text, event_id text, division text, place int, student text, school text);
  insert into public.published_team_points (tournament_id, school, points, place)
    select target, btrim(x.school), x.points, x.place
    from jsonb_to_recordset(teams) as x (school text, points int, place int);
  update public.tournaments set results_published_at = stamped where id = target;
  return stamped;
end;
$$;

-- Unpublish: remove the snapshot. The tournament's private results are untouched.
create or replace function public.unpublish_results(target uuid) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if not private.is_director(target) then
    raise exception 'Only this tournament''s director can unpublish its results.' using errcode = 'insufficient_privilege';
  end if;
  delete from public.published_results where tournament_id = target;
  delete from public.published_team_points where tournament_id = target;
  update public.tournaments set results_published_at = null where id = target;
end;
$$;

revoke all on function public.publish_results(uuid, jsonb, jsonb) from public, anon;
revoke all on function public.unpublish_results(uuid) from public, anon;
grant execute on function public.publish_results(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.unpublish_results(uuid) to authenticated;
