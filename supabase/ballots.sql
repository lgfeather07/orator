-- Orator ballots. Run once in the Supabase dashboard after schema.sql:
-- SQL Editor → New query → paste → Run. Safe to run again.
--
-- A judge owns one ballot per tournament, round, and room. They can edit it until they
-- submit it; after that it is locked. Coaches can read submitted ballot entries for
-- speakers from their own school. Private notes are readable by the judge alone.

create schema if not exists private;

create table if not exists public.ballots (
  id uuid primary key default gen_random_uuid(),
  judge_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  judge_name text not null default '',
  tournament text not null,
  round int not null check (round between 1 and 20),
  room text not null,
  event_id text not null,
  class_a boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (judge_id, tournament, round, room)
);

create table if not exists public.ballot_entries (
  ballot_id uuid not null references public.ballots (id) on delete cascade,
  speaker_code text not null,
  speaker_name text not null,
  school text not null default '',
  present boolean,                                  -- null until the judge checks the speaker in
  rank int check (rank between 1 and 10),           -- null for no-shows
  rating int check (rating between 35 and 50),
  time_seconds int check (time_seconds >= 0),
  time_penalty boolean not null default false,      -- lowered one rank for over/undertime
  section_marks int[] not null default '{}',        -- one 1–10 mark per criteria section
  reason text not null default '',
  disqualifications text[] not null default '{}',
  primary key (ballot_id, speaker_code),
  constraint ballot_entries_no_ties unique (ballot_id, rank) deferrable initially deferred
);

-- General comments, added after the first version of this script.
alter table public.ballot_entries add column if not exists comments text not null default '';

create table if not exists public.ballot_private_notes (
  ballot_id uuid not null references public.ballots (id) on delete cascade,
  speaker_code text not null,
  note text not null default '',
  primary key (ballot_id, speaker_code)
);

-- Helpers the row-level security policies call. They run with the table owner's rights so
-- the policies on one table can look at another without recursing into its policies.
create or replace function private.owns_ballot(target uuid, must_be_draft boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.ballots b where b.id = target and b.judge_id = (select auth.uid()) and (not must_be_draft or b.status = 'draft'));
$$;

create or replace function private.ballot_is_submitted(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.ballots b where b.id = target and b.status = 'submitted');
$$;

-- The signed-in user's school in lower case if they are a coach, otherwise null.
create or replace function private.my_coach_school() returns text
language sql stable security definer set search_path = '' as $$
  select lower(p.school) from public.profiles p where p.id = (select auth.uid()) and 'coach' = any (p.roles) and p.school <> '';
$$;

create or replace function private.ballot_has_school(target uuid, wanted text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.ballot_entries e where e.ballot_id = target and lower(e.school) = wanted);
$$;

revoke all on all functions in schema private from public, anon;
grant usage on schema private to authenticated;
grant execute on all functions in schema private to authenticated;

-- Stamp the judge on new ballots from their account, never from what the browser sends.
create or replace function public.stamp_ballot() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.judge_id := auth.uid();
    new.judge_name := coalesce((select p.full_name from public.profiles p where p.id = auth.uid()), '');
    new.status := 'draft';
    new.submitted_at := null;
  else
    new.judge_id := old.judge_id;
    new.judge_name := old.judge_name;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists stamp_ballot on public.ballots;
create trigger stamp_ballot before insert or update on public.ballots
  for each row execute function public.stamp_ballot();

-- Refuse to submit a ballot that breaks the NSAA rules the app also checks in the browser.
create or replace function public.check_ballot_submission() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  problem text;
begin
  if new.status = 'submitted' and old.status = 'draft' then
    select case
      when count(*) = 0 then 'The ballot has no speakers.'
      when bool_or(e.present is null) then 'Every speaker must be marked present or no-show.'
      when bool_or(e.present and e.time_seconds is null) then 'Every speaker needs a time.'
      when bool_or(e.present and char_length(btrim(e.comments)) + char_length(btrim(e.reason)) < 40) then 'Every speaker needs at least 40 characters of comments and reason for decision.'
      when bool_or(e.present and (cardinality(e.section_marks) <> 5 or exists (select 1 from unnest(e.section_marks) m where m is null or m < 1 or m > 10))) then 'Every speaker needs five section marks from 1 to 10.'
      -- The rating is the total of the section marks, and the NSAA scale starts at 35.
      when bool_or(e.present and e.rating is distinct from greatest(35, (select sum(m) from unnest(e.section_marks) m)::int)) then 'Each rating must equal the total of its section marks.'
      when bool_or(e.present and e.rank is null) then 'Every speaker who performed needs a rank.'
      when count(*) filter (where e.present) <> count(distinct e.rank) filter (where e.present) then 'There may be no ties in rank.'
      when coalesce(max(e.rank) filter (where e.present), 0) <> count(*) filter (where e.present) then 'Ranks must run from 1 with no gaps.'
    end into problem
    from public.ballot_entries e where e.ballot_id = new.id;
    if problem is null and exists (
      select 1 from public.ballot_entries a join public.ballot_entries b on b.ballot_id = a.ballot_id
      where a.ballot_id = new.id and a.present and b.present and a.rank < b.rank and a.rating < b.rating and not b.time_penalty  -- a time penalty lowers an entry one rank
    ) then problem := 'A speaker with a lower rating is ranked above one with a higher rating.'; end if;
    if problem is not null then raise exception '%', problem using errcode = 'check_violation'; end if;
    new.submitted_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists check_ballot_submission on public.ballots;
create trigger check_ballot_submission before update on public.ballots
  for each row execute function public.check_ballot_submission();

revoke all on function public.stamp_ballot() from public, anon, authenticated;
revoke all on function public.check_ballot_submission() from public, anon, authenticated;

alter table public.ballots enable row level security;
alter table public.ballot_entries enable row level security;
alter table public.ballot_private_notes enable row level security;

revoke all on public.ballots, public.ballot_entries, public.ballot_private_notes from anon, authenticated;
grant select, insert, update, delete on public.ballots, public.ballot_entries, public.ballot_private_notes to authenticated;

-- Ballots: only accounts with the judge role can create one; a judge reads their own and
-- edits them while they are drafts.
drop policy if exists "Judges read own ballots" on public.ballots;
create policy "Judges read own ballots" on public.ballots for select to authenticated
  using (judge_id = (select auth.uid()));

drop policy if exists "Coaches read submitted ballots for their school" on public.ballots;
create policy "Coaches read submitted ballots for their school" on public.ballots for select to authenticated
  using (status = 'submitted' and private.ballot_has_school(id, (select private.my_coach_school())));

drop policy if exists "Judges create ballots" on public.ballots;
create policy "Judges create ballots" on public.ballots for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and 'judge' = any (p.roles)));

drop policy if exists "Judges edit own draft ballots" on public.ballots;
create policy "Judges edit own draft ballots" on public.ballots for update to authenticated
  using (judge_id = (select auth.uid()) and status = 'draft') with check (judge_id = (select auth.uid()));

drop policy if exists "Judges delete own draft ballots" on public.ballots;
create policy "Judges delete own draft ballots" on public.ballots for delete to authenticated
  using (judge_id = (select auth.uid()) and status = 'draft');

-- Entries: the judge reads their own and changes them while the ballot is a draft.
drop policy if exists "Judges read own entries" on public.ballot_entries;
create policy "Judges read own entries" on public.ballot_entries for select to authenticated
  using (private.owns_ballot(ballot_id, false));

drop policy if exists "Coaches read submitted entries for their school" on public.ballot_entries;
create policy "Coaches read submitted entries for their school" on public.ballot_entries for select to authenticated
  using (lower(school) = (select private.my_coach_school()) and private.ballot_is_submitted(ballot_id));

drop policy if exists "Judges add entries to draft ballots" on public.ballot_entries;
create policy "Judges add entries to draft ballots" on public.ballot_entries for insert to authenticated
  with check (private.owns_ballot(ballot_id, true));

drop policy if exists "Judges edit entries on draft ballots" on public.ballot_entries;
create policy "Judges edit entries on draft ballots" on public.ballot_entries for update to authenticated
  using (private.owns_ballot(ballot_id, true)) with check (private.owns_ballot(ballot_id, true));

drop policy if exists "Judges remove entries from draft ballots" on public.ballot_entries;
create policy "Judges remove entries from draft ballots" on public.ballot_entries for delete to authenticated
  using (private.owns_ballot(ballot_id, true));

-- Private notes: the judge only, always.
drop policy if exists "Judges read own notes" on public.ballot_private_notes;
create policy "Judges read own notes" on public.ballot_private_notes for select to authenticated
  using (private.owns_ballot(ballot_id, false));

drop policy if exists "Judges add own notes" on public.ballot_private_notes;
create policy "Judges add own notes" on public.ballot_private_notes for insert to authenticated
  with check (private.owns_ballot(ballot_id, false));

drop policy if exists "Judges edit own notes" on public.ballot_private_notes;
create policy "Judges edit own notes" on public.ballot_private_notes for update to authenticated
  using (private.owns_ballot(ballot_id, false)) with check (private.owns_ballot(ballot_id, false));

drop policy if exists "Judges remove own notes" on public.ballot_private_notes;
create policy "Judges remove own notes" on public.ballot_private_notes for delete to authenticated
  using (private.owns_ballot(ballot_id, false));
