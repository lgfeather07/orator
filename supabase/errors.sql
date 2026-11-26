-- Orator: tournament-day error reports and the tab-room status board.
-- Run after every file up to coach_plans.sql, and before alerts.sql (see the order in README.md):
-- SQL Editor → New query → paste → Run. Safe to run again.
--
-- 1. public.app_errors: when a page breaks or a request to the database fails in the signed-in app, the
--    browser records one short row: which tournament, the person's role there, the page or area, a short
--    technical message, and when. Never a student's name, ballot text, comments or any other content.
--    Anyone signed in may add rows about themselves (a trigger caps the message length and drops rows past
--    30 per person in ten minutes, so one broken loop can't flood the table). Only the tournament's director
--    can read its rows. Nobody can change or delete them through the API.
-- 2. public.ballot_progress(tournament): for the director's status board, each scheduled room's ballot state
--    (none, draft, submitted) and when it was last saved. Only the state: ranks, comments and private notes
--    are not returned, and the ballots table's read rules are unchanged.

create schema if not exists private;

-- ── Error reports ──
create table if not exists public.app_errors (
  id bigint generated always as identity primary key,
  tournament_id uuid references public.tournaments (id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role text not null default '' check (role in ('', 'director', 'coach', 'judge', 'student')),
  area text not null default '' check (char_length(area) <= 60),
  kind text not null default 'page' check (kind in ('page', 'request')),
  message text not null check (char_length(message) between 1 and 300),
  created_at timestamptz not null default now()
);
create index if not exists app_errors_by_tournament on public.app_errors (tournament_id, created_at desc);
create index if not exists app_errors_by_person on public.app_errors (created_by, created_at desc);

-- True when the signed-in user directs or has asked to join (any status) the tournament.
create or replace function private.belongs_to(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_director(target)
    or exists (select 1 from public.tournament_members m where m.tournament_id = target and m.user_id = (select auth.uid()));
$$;
revoke all on function private.belongs_to(uuid) from public, anon;
grant execute on function private.belongs_to(uuid) to authenticated;

-- Stamp the time, trim long text, and quietly drop rows past the per-person limit (no error, so a
-- client that reports its own failures can't loop on this either).
create or replace function public.stamp_app_error() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.created_at := now();
  new.message := left(btrim(new.message), 300);
  new.area := left(btrim(new.area), 60);
  if (select count(*) from public.app_errors e where e.created_by = new.created_by and e.created_at > now() - interval '10 minutes') >= 30 then
    return null;
  end if;
  return new;
end;
$$;
drop trigger if exists stamp_app_error on public.app_errors;
create trigger stamp_app_error before insert on public.app_errors
  for each row execute function public.stamp_app_error();
revoke all on function public.stamp_app_error() from public, anon, authenticated;

alter table public.app_errors enable row level security;
revoke all on public.app_errors from anon;
revoke update, delete, truncate on public.app_errors from authenticated;
grant select, insert on public.app_errors to authenticated;

drop policy if exists "People report errors about themselves" on public.app_errors;
create policy "People report errors about themselves" on public.app_errors for insert to authenticated
  with check (created_by = (select auth.uid()) and (tournament_id is null or private.belongs_to(tournament_id)));
drop policy if exists "The director reads their tournament's errors" on public.app_errors;
create policy "The director reads their tournament's errors" on public.app_errors for select to authenticated
  using (tournament_id is not null and private.is_director(tournament_id));

-- ── Ballot progress for the status board ──
-- One row per scheduled room that has any ballot attached: 'submitted' if any ballot for the room is
-- submitted, else 'draft'. Rooms with no row have no ballot started. Empty for anyone but the director.
drop function if exists public.ballot_progress(uuid);
create function public.ballot_progress(target uuid)
returns table (section_id uuid, status text, saved_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select b.section_id,
    case when bool_or(b.status = 'submitted') then 'submitted' else 'draft' end,
    max(greatest(b.updated_at, coalesce(b.submitted_at, b.updated_at)))
  from public.ballots b
  join public.sections s on s.id = b.section_id and s.tournament_id = target
  where b.tournament_id = target and private.is_director(target)
  group by b.section_id;
$$;
revoke all on function public.ballot_progress(uuid) from public, anon;
grant execute on function public.ballot_progress(uuid) to authenticated;
