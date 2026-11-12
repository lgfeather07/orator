-- Orator tournaments, director approval, entries, and schedules.
-- Run once in the Supabase dashboard after schema.sql and ballots.sql:
-- SQL Editor → New query → paste → Run. Safe to run again.
--
-- A director creates a tournament. Coaches, judges, and students ask to join it and the
-- director approves or declines each request. Approved coaches enter their own school's
-- students while registration is open. The director builds and publishes the schedule;
-- approved members can then see it.

create schema if not exists private;

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  director_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  date text not null default '',
  host text not null default '',
  rounds int not null default 3 check (rounds between 1 and 6),
  section_size int not null default 6 check (section_size between 3 and 10),
  max_entries int not null default 4 check (max_entries between 1 and 4),
  event_ids text[] not null default '{}',
  status text not null default 'registration' check (status in ('registration', 'scheduled', 'running', 'finished')),
  created_at timestamptz not null default now()
);

create table if not exists public.tournament_members (
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role text not null check (role in ('coach', 'student', 'judge')),
  school text not null default '',
  display_name text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  entries_sent boolean not null default false,       -- a coach's "these entries are final"
  created_at timestamptz not null default now(),
  primary key (tournament_id, user_id, role)
);

create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  school text not null check (char_length(btrim(school)) > 0),
  student text not null check (char_length(btrim(student)) > 0),
  event_id text not null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
-- A student may enter each event once.
create unique index if not exists entries_one_per_event on public.entries (tournament_id, lower(school), lower(student), event_id);

create table if not exists public.sections (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  round int not null check (round between 1 and 6),
  event_id text not null,
  label text not null default '',
  room text not null default '',
  judge_id uuid references auth.users (id) on delete set null,
  judge_name text not null default '',
  entry_ids uuid[] not null default '{}',             -- speaking order
  position int not null default 0
);
create index if not exists sections_by_tournament on public.sections (tournament_id, round, position);

-- Helpers for the row-level security policies. They run with the table owner's rights so
-- one table's policy can check another table without recursing into its policies.
create or replace function private.is_director(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tournaments t where t.id = target and t.director_id = (select auth.uid()));
$$;

create or replace function private.tournament_status(target uuid) returns text
language sql stable security definer set search_path = '' as $$
  select t.status from public.tournaments t where t.id = target;
$$;

create or replace function private.is_approved_member(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tournament_members m where m.tournament_id = target and m.user_id = (select auth.uid()) and m.status = 'approved');
$$;

-- The school (lower case) the signed-in user is approved to coach at this tournament, or null.
create or replace function private.approved_coach_school(target uuid) returns text
language sql stable security definer set search_path = '' as $$
  select lower(m.school) from public.tournament_members m
  where m.tournament_id = target and m.user_id = (select auth.uid()) and m.role = 'coach' and m.status = 'approved' and m.school <> '';
$$;

revoke all on all functions in schema private from public, anon;
grant usage on schema private to authenticated;
grant execute on all functions in schema private to authenticated;

-- Tournaments: the director is always the signed-in account, and only accounts with the director role may create one.
create or replace function public.stamp_tournament() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.profiles p where p.id = auth.uid() and 'director' = any (p.roles)) then
      raise exception 'Only accounts with the Director role can create a tournament.' using errcode = 'insufficient_privilege';
    end if;
    new.director_id := auth.uid();
    new.status := 'registration';
  else
    new.director_id := old.director_id;
  end if;
  return new;
end;
$$;
drop trigger if exists stamp_tournament on public.tournaments;
create trigger stamp_tournament before insert or update on public.tournaments
  for each row execute function public.stamp_tournament();

-- Membership requests always start pending, under the requester's own name, for a role their account has.
-- Afterwards only the director can change the decision; the member may only flag their entries as sent.
create or replace function public.stamp_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.profiles p where p.id = auth.uid() and new.role = any (p.roles)) then
      raise exception 'Your account does not have the % role.', new.role using errcode = 'insufficient_privilege';
    end if;
    new.user_id := auth.uid();
    new.status := 'pending';
    new.entries_sent := false;
    new.school := btrim(new.school);
    new.display_name := coalesce((select p.full_name from public.profiles p where p.id = auth.uid()), '');
  else
    new.tournament_id := old.tournament_id; new.user_id := old.user_id; new.role := old.role; new.display_name := old.display_name;
    if not private.is_director(old.tournament_id) then
      new.status := old.status; new.school := old.school;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists stamp_member on public.tournament_members;
create trigger stamp_member before insert or update on public.tournament_members
  for each row execute function public.stamp_member();

-- Entries: the event must be offered and the student must be under the tournament's cap.
create or replace function public.check_entry() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  t public.tournaments;
begin
  select * into t from public.tournaments where id = new.tournament_id;
  if t.id is null then raise exception 'That tournament does not exist.'; end if;
  new.student := btrim(new.student); new.school := btrim(new.school); new.created_by := auth.uid();
  if t.status <> 'registration' then raise exception 'Registration is closed for this tournament.' using errcode = 'check_violation'; end if;
  if not (new.event_id = any (t.event_ids)) then raise exception 'That event is not offered at this tournament.' using errcode = 'check_violation'; end if;
  if (select count(*) from public.entries e where e.tournament_id = new.tournament_id and lower(e.school) = lower(new.school) and lower(e.student) = lower(new.student)) >= t.max_entries then
    raise exception '% is already in % events, the most this tournament allows.', new.student, t.max_entries using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists check_entry on public.entries;
create trigger check_entry before insert on public.entries
  for each row execute function public.check_entry();

revoke all on function public.stamp_tournament() from public, anon, authenticated;
revoke all on function public.stamp_member() from public, anon, authenticated;
revoke all on function public.check_entry() from public, anon, authenticated;

alter table public.tournaments enable row level security;
alter table public.tournament_members enable row level security;
alter table public.entries enable row level security;
alter table public.sections enable row level security;

revoke all on public.tournaments, public.tournament_members, public.entries, public.sections from anon, authenticated;
grant select, insert, update, delete on public.tournaments, public.tournament_members, public.entries, public.sections to authenticated;

-- Tournaments: any signed-in user can see the list (so they can ask to join); only the director changes one.
drop policy if exists "Signed-in users see tournaments" on public.tournaments;
create policy "Signed-in users see tournaments" on public.tournaments for select to authenticated using (true);
drop policy if exists "Directors create tournaments" on public.tournaments;
create policy "Directors create tournaments" on public.tournaments for insert to authenticated with check (true);
drop policy if exists "Directors edit their tournaments" on public.tournaments;
create policy "Directors edit their tournaments" on public.tournaments for update to authenticated
  using (director_id = (select auth.uid())) with check (director_id = (select auth.uid()));
drop policy if exists "Directors delete their tournaments" on public.tournaments;
create policy "Directors delete their tournaments" on public.tournaments for delete to authenticated using (director_id = (select auth.uid()));

-- Members: people see their own requests; the director sees and decides all of them.
drop policy if exists "Members see their own requests" on public.tournament_members;
create policy "Members see their own requests" on public.tournament_members for select to authenticated
  using (user_id = (select auth.uid()) or private.is_director(tournament_id));
drop policy if exists "People ask to join" on public.tournament_members;
create policy "People ask to join" on public.tournament_members for insert to authenticated with check (true);
drop policy if exists "Directors decide requests" on public.tournament_members;
create policy "Directors decide requests" on public.tournament_members for update to authenticated
  using (user_id = (select auth.uid()) or private.is_director(tournament_id))
  with check (user_id = (select auth.uid()) or private.is_director(tournament_id));
drop policy if exists "Withdraw or remove a request" on public.tournament_members;
create policy "Withdraw or remove a request" on public.tournament_members for delete to authenticated
  using ((user_id = (select auth.uid()) and status = 'pending') or private.is_director(tournament_id));

-- Entries: the director sees all; an approved coach sees and edits their own school's while registration
-- is open; every approved member sees the field once the schedule is published.
drop policy if exists "Who can see entries" on public.entries;
create policy "Who can see entries" on public.entries for select to authenticated
  using (private.is_director(tournament_id)
    or lower(school) = (select private.approved_coach_school(tournament_id))
    or (private.is_approved_member(tournament_id) and private.tournament_status(tournament_id) <> 'registration'));
drop policy if exists "Coaches enter their own school" on public.entries;
create policy "Coaches enter their own school" on public.entries for insert to authenticated
  with check (private.is_director(tournament_id) or lower(btrim(school)) = (select private.approved_coach_school(tournament_id)));
drop policy if exists "Coaches withdraw their own entries" on public.entries;
create policy "Coaches withdraw their own entries" on public.entries for delete to authenticated
  using (private.tournament_status(tournament_id) = 'registration'
    and (private.is_director(tournament_id) or lower(school) = (select private.approved_coach_school(tournament_id))));

-- Schedule: the director builds it; approved members see it once it is published.
drop policy if exists "Who can see the schedule" on public.sections;
create policy "Who can see the schedule" on public.sections for select to authenticated
  using (private.is_director(tournament_id)
    or (private.is_approved_member(tournament_id) and private.tournament_status(tournament_id) <> 'registration'));
drop policy if exists "Directors build the schedule" on public.sections;
create policy "Directors build the schedule" on public.sections for insert to authenticated with check (private.is_director(tournament_id));
drop policy if exists "Directors change the schedule" on public.sections;
create policy "Directors change the schedule" on public.sections for update to authenticated
  using (private.is_director(tournament_id)) with check (private.is_director(tournament_id));
drop policy if exists "Directors clear the schedule" on public.sections;
create policy "Directors clear the schedule" on public.sections for delete to authenticated using (private.is_director(tournament_id));

-- Ballots filled in for a scheduled room carry the tournament and room they belong to, so the
-- director can work out breaks and finals from them. (The ballots table comes from ballots.sql.)
alter table public.ballots add column if not exists tournament_id uuid references public.tournaments (id) on delete set null;
alter table public.ballots add column if not exists section_id uuid references public.sections (id) on delete set null;

create or replace function private.directs_ballot(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.ballots b join public.tournaments t on t.id = b.tournament_id where b.id = target and t.director_id = (select auth.uid()));
$$;
revoke all on function private.directs_ballot(uuid) from public, anon;
grant execute on function private.directs_ballot(uuid) to authenticated;

-- A judge may only attach a ballot to a room they were assigned in a tournament they were approved for.
create or replace function public.check_ballot_room() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.section_id is not null and not exists (select 1 from public.sections s where s.id = new.section_id and s.tournament_id = new.tournament_id and s.judge_id = auth.uid()) then
    raise exception 'You are not the judge assigned to that room.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
drop trigger if exists check_ballot_room on public.ballots;
create trigger check_ballot_room before insert on public.ballots
  for each row execute function public.check_ballot_room();
revoke all on function public.check_ballot_room() from public, anon, authenticated;

-- Directors read submitted ballots for their own tournament. Private notes stay with the judge.
drop policy if exists "Directors read ballots for their tournament" on public.ballots;
create policy "Directors read ballots for their tournament" on public.ballots for select to authenticated
  using (status = 'submitted' and tournament_id is not null and private.is_director(tournament_id));
drop policy if exists "Directors read entries for their tournament" on public.ballot_entries;
create policy "Directors read entries for their tournament" on public.ballot_entries for select to authenticated
  using (private.ballot_is_submitted(ballot_id) and private.directs_ballot(ballot_id));
