-- Orator: paper ballots entered by the tab room.
-- Run in the Supabase SQL Editor after schema.sql, ballots.sql, tournaments.sql, fixes.sql,
-- calendar.sql and public_results.sql. Safe to run again. Run it again whenever you re-run
-- ballots.sql or tournaments.sql, because it replaces three trigger functions those files define.
--
-- Many judges still fill in paper ballots. The director (tab staff signed in as the director)
-- types each one in. A paper ballot is stored in the same ballots / ballot_entries tables as an
-- e-ballot, already submitted and attributed to the room's judge, so it counts in breaks, finals
-- and placings exactly like an e-ballot, coaches read it like any other ballot for their school,
-- and students see it once the tournament has finished and their coach has released results.
-- Paper ballots have no comments, reasons or private notes: only ranks, points, times and penalties.
--
-- Writes go through public.enter_paper_ballot(), which checks that the caller directs the
-- tournament and checks the ballot the way the e-ballot does (ranks 1..n with no ties, points
-- 35–50, a higher rank never has fewer points unless the lower-ranked speaker had a time penalty).
-- Every entry, correction and e-ballot override is logged in public.paper_ballot_log.

create schema if not exists private;

-- ── Where a ballot came from ──
alter table public.ballots add column if not exists source text not null default 'judge';
alter table public.ballots add column if not exists entered_by uuid references auth.users (id) on delete set null;
alter table public.ballots add column if not exists entered_by_name text not null default '';
alter table public.ballots add column if not exists entered_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ballots_source_check') then
    alter table public.ballots add constraint ballots_source_check check (source in ('judge', 'paper'));
  end if;
end $$;
create index if not exists ballots_by_section on public.ballots (section_id);

-- ── Log of every paper entry, correction and override ──
create table if not exists public.paper_ballot_log (
  id bigint generated always as identity primary key,
  ballot_id uuid references public.ballots (id) on delete cascade,
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  section_id uuid references public.sections (id) on delete set null,
  action text not null check (action in ('entered', 'corrected', 'override', 'replaced-draft')),
  actor uuid references auth.users (id) on delete set null,
  actor_name text not null default '',
  note text not null default '',
  previous jsonb,                     -- ranks, points and times before the change (never comments or private notes)
  entries jsonb not null,             -- what was entered
  created_at timestamptz not null default now()
);
create index if not exists paper_ballot_log_by_tournament on public.paper_ballot_log (tournament_id, created_at desc);

alter table public.paper_ballot_log enable row level security;
revoke all on public.paper_ballot_log from anon, authenticated;
grant select on public.paper_ballot_log to authenticated;
drop policy if exists "Directors read their paper ballot log" on public.paper_ballot_log;
create policy "Directors read their paper ballot log" on public.paper_ballot_log for select to authenticated
  using (private.is_director(tournament_id));

-- ── A pass that lets enter_paper_ballot() write a submitted ballot for another person ──
-- The ballot triggers below step aside only while this transaction holds a pass. Only
-- enter_paper_ballot() (security definer) can write here: nobody else has any rights on the table.
create table if not exists private.paper_entry_pass (
  tx bigint primary key,
  created_at timestamptz not null default now()
);
alter table private.paper_entry_pass enable row level security;
revoke all on private.paper_entry_pass from public, anon, authenticated;

create or replace function private.paper_entry_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.paper_entry_pass p where p.tx = txid_current());
$$;
revoke all on function private.paper_entry_active() from public, anon;
grant execute on function private.paper_entry_active() to authenticated;

-- ── Ballot triggers, replaced with a paper-entry pass. Every earlier rule is kept as it was. ──

-- From ballots.sql, plus: a judge can't mark their own ballot as paper or as entered by someone else.
create or replace function public.stamp_ballot() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.paper_entry_active() then
    new.updated_at := now();
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.judge_id := auth.uid();
    new.judge_name := coalesce((select p.full_name from public.profiles p where p.id = auth.uid()), '');
    new.status := 'draft';
    new.submitted_at := null;
    new.source := 'judge';
    new.entered_by := null;
    new.entered_by_name := '';
    new.entered_at := null;
  else
    new.judge_id := old.judge_id;
    new.judge_name := old.judge_name;
    new.created_at := old.created_at;
    new.source := old.source;
    new.entered_by := old.entered_by;
    new.entered_by_name := old.entered_by_name;
    new.entered_at := old.entered_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- From ballots.sql, with two changes: the pass (enter_paper_ballot() checks paper ballots itself), and section marks
-- are optional: a judge may give just a score out of 50.
create or replace function public.check_ballot_submission() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  problem text;
begin
  if private.paper_entry_active() then return new; end if;
  if new.status = 'submitted' and old.status = 'draft' then
    select case
      when count(*) = 0 then 'The ballot has no speakers.'
      when bool_or(e.present is null) then 'Every speaker must be marked present or no-show.'
      when bool_or(e.present and e.time_seconds is null) then 'Every speaker needs a time.'
      when bool_or(e.present and char_length(btrim(e.comments)) + char_length(btrim(e.reason)) < 40) then 'Every speaker needs at least 40 characters of comments and reason for decision.'
      -- Every speaker who performed needs a score out of 50 (the NSAA scale starts at 35; lower scores are recorded as 35).
      when bool_or(e.present and (e.rating is null or e.rating < 35 or e.rating > 50)) then 'Every speaker needs a score from 35 to 50.'
      -- Section marks are optional. If a judge marks sections, they mark all five (1 to 10) and the score is their total.
      when bool_or(e.present and coalesce((select bool_or(m is not null and m <> 0) from unnest(e.section_marks) m), false)
        and (cardinality(e.section_marks) <> 5 or exists (select 1 from unnest(e.section_marks) m where m is null or m < 1 or m > 10))) then 'Mark all five sections from 1 to 10, or none.'
      when bool_or(e.present and coalesce((select bool_or(m is not null and m <> 0) from unnest(e.section_marks) m), false)
        and e.rating is distinct from greatest(35, (select sum(m) from unnest(e.section_marks) m)::int)) then 'When sections are marked, the score must equal their total.'
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

-- From tournaments.sql, plus: once the tab room has entered a paper ballot for a room, a judge
-- can't add a second ballot for it (it would count twice).
create or replace function public.check_ballot_room() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.paper_entry_active() then return new; end if;
  if new.section_id is not null and not exists (select 1 from public.sections s where s.id = new.section_id and s.tournament_id = new.tournament_id and s.judge_id = auth.uid()) then
    raise exception 'You are not the judge assigned to that room.' using errcode = 'insufficient_privilege';
  end if;
  if new.section_id is not null and exists (select 1 from public.ballots b where b.section_id = new.section_id and b.source = 'paper' and b.status = 'submitted') then
    raise exception 'The tab room already entered the paper ballot for this room.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_ballot on public.ballots;
create trigger stamp_ballot before insert or update on public.ballots
  for each row execute function public.stamp_ballot();
drop trigger if exists check_ballot_submission on public.ballots;
create trigger check_ballot_submission before update on public.ballots
  for each row execute function public.check_ballot_submission();
drop trigger if exists check_ballot_room on public.ballots;
create trigger check_ballot_room before insert on public.ballots
  for each row execute function public.check_ballot_room();
revoke all on function public.stamp_ballot() from public, anon, authenticated;
revoke all on function public.check_ballot_submission() from public, anon, authenticated;
revoke all on function public.check_ballot_room() from public, anon, authenticated;

-- ── Entering (or correcting) one room's paper ballot ──
-- entries: one object per speaker in the room:
--   {"code": "<entry id>", "present": true, "rank": 1, "rating": 47 | null, "time_seconds": 581 | null,
--    "time_penalty": false, "marks": [9, 9, 10, 9, 10] | []}
-- override: needed to replace a ballot the judge already submitted electronically.
-- Returns the ballot's id.
create or replace function public.enter_paper_ballot(target_section uuid, entries jsonb, override boolean default false, note text default '')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s public.sections;
  t public.tournaments;
  me uuid := auth.uid();
  me_name text;
  judge uuid;
  judge_label text;
  existing public.ballots;
  problem text;
  present_count int;
  ballot uuid;
  action text := 'entered';
  prior jsonb;
  clean jsonb;
begin
  if me is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  select * into s from public.sections where id = target_section;
  if s.id is null then raise exception 'That room is no longer on the schedule.' using errcode = 'no_data_found'; end if;
  select * into t from public.tournaments where id = s.tournament_id;
  if t.director_id is distinct from me then
    raise exception 'Only the tournament director can enter paper ballots.' using errcode = 'insufficient_privilege';
  end if;
  if t.status = 'finished' then
    raise exception 'The tournament has ended, so its ballots are locked.' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(entries) is distinct from 'array' then raise exception 'The ballot has no speakers.' using errcode = 'check_violation'; end if;

  -- One row per speaker, in a shape the checks can read.
  create temporary table if not exists pg_temp.paper_rows (code text, present boolean, rank int, rating int, time_seconds int, time_penalty boolean, marks int[]) on commit drop;
  truncate pg_temp.paper_rows;
  insert into pg_temp.paper_rows
  select x ->> 'code', (x ->> 'present')::boolean, (x ->> 'rank')::int, (x ->> 'rating')::int, (x ->> 'time_seconds')::int,
         coalesce((x ->> 'time_penalty')::boolean, false),
         coalesce((select array_agg(m::int) from jsonb_array_elements_text(case when jsonb_typeof(x -> 'marks') = 'array' then x -> 'marks' else '[]'::jsonb end) m), '{}')
  from jsonb_array_elements(entries) x;

  select count(*) filter (where r.present) into present_count from pg_temp.paper_rows r;
  select case
    when count(*) = 0 then 'The ballot has no speakers.'
    when bool_or(r.code is null or not (r.code = any (s.entry_ids::text[]))) then 'A speaker on this ballot isn''t in this room.'
    when count(distinct r.code) <> count(*) then 'A speaker appears twice on this ballot.'
    when count(*) <> cardinality(s.entry_ids) then 'Every speaker in the room needs a line: a rank, or no-show.'
    when bool_or(r.present is null) then 'Every speaker must be marked present or no-show.'
    when bool_or(not r.present and (r.rank is not null or r.rating is not null)) then 'A no-show can''t have a rank or points.'
    when bool_or(r.present and r.rank is null) then 'Every speaker who performed needs a rank.'
    when bool_or(r.present and (r.rank < 1 or r.rank > present_count)) then format('Ranks must run from 1 to %s.', present_count)
    when count(distinct r.rank) filter (where r.present) <> present_count then 'There may be no ties in rank.'
    when bool_or(r.rating is not null and (r.rating < 35 or r.rating > 50)) then 'Points must be from 35 to 50.'
    when bool_or(cardinality(r.marks) > 0 and (cardinality(r.marks) <> 5 or exists (select 1 from unnest(r.marks) m where m is null or m < 1 or m > 10))) then 'Section marks need five marks from 1 to 10.'
    when bool_or(cardinality(r.marks) > 0 and r.rating is distinct from greatest(35, (select sum(m) from unnest(r.marks) m)::int)) then 'Points must equal the total of the section marks.'
    when bool_or(r.time_seconds is not null and (r.time_seconds < 0 or r.time_seconds > 3600)) then 'A time must be between 0:00 and 60:00.'
  end into problem from pg_temp.paper_rows r;
  if problem is null and exists (
    select 1 from pg_temp.paper_rows a join pg_temp.paper_rows b on a.present and b.present
    where a.rank < b.rank and a.rating < b.rating and not b.time_penalty  -- a time penalty lowers an entry one rank
  ) then problem := 'A speaker with fewer points is ranked above one with more points. Check the ballot, or mark the time penalty.'; end if;
  if problem is not null then raise exception '%', problem using errcode = 'check_violation'; end if;

  select jsonb_agg(jsonb_build_object('code', r.code, 'present', r.present, 'rank', r.rank, 'rating', r.rating, 'time_seconds', r.time_seconds, 'time_penalty', r.time_penalty, 'marks', to_jsonb(r.marks)) order by array_position(s.entry_ids::text[], r.code))
    into clean from pg_temp.paper_rows r;

  me_name := coalesce((select nullif(p.full_name, '') from public.profiles p where p.id = me), 'Director');
  judge := coalesce(s.judge_id, me);
  judge_label := coalesce(nullif(s.judge_name, ''), (select nullif(p.full_name, '') from public.profiles p where p.id = s.judge_id), '');

  -- The ballot already on file for this room: by room, or the judge's own ballot for the same round and room.
  select * into existing from public.ballots b
  where b.section_id = s.id or (b.judge_id = judge and b.tournament = t.name and b.round = s.round and b.room = s.room)
  order by (b.status = 'submitted') desc, (b.source = 'paper') desc, b.created_at
  limit 1;
  if existing.id is not null then
    if existing.source = 'paper' then action := 'corrected';
    elsif existing.status = 'submitted' then
      if not coalesce(override, false) then
        raise exception 'The judge already submitted an e-ballot for this room. Choose to override it if the paper ballot is the one that counts.' using errcode = 'check_violation';
      end if;
      action := 'override';
    else action := 'replaced-draft';
    end if;
    select jsonb_agg(jsonb_build_object('code', e.speaker_code, 'present', e.present, 'rank', e.rank, 'rating', e.rating, 'time_seconds', e.time_seconds, 'time_penalty', e.time_penalty) order by e.rank nulls last)
      into prior from public.ballot_entries e where e.ballot_id = existing.id;
  end if;

  insert into private.paper_entry_pass (tx) values (txid_current()) on conflict (tx) do nothing;

  if existing.id is not null then
    ballot := existing.id;
    update public.ballots set
      tournament_id = s.tournament_id, section_id = s.id, event_id = s.event_id, status = 'submitted',
      submitted_at = case when existing.status = 'submitted' then existing.submitted_at else now() end,
      source = 'paper', entered_by = me, entered_by_name = me_name, entered_at = now()
    where id = ballot;
    delete from public.ballot_entries where ballot_id = ballot;
  else
    insert into public.ballots (judge_id, judge_name, tournament, round, room, event_id, class_a, status, submitted_at, tournament_id, section_id, source, entered_by, entered_by_name, entered_at)
    values (judge, judge_label, t.name, s.round, s.room, s.event_id, false, 'submitted', now(), s.tournament_id, s.id, 'paper', me, me_name, now())
    returning id into ballot;
  end if;

  insert into public.ballot_entries (ballot_id, speaker_code, speaker_name, school, present, rank, rating, time_seconds, time_penalty, section_marks, comments, reason, disqualifications)
  select ballot, r.code, coalesce(e.student, r.code), coalesce(e.school, ''), r.present, r.rank, r.rating, r.time_seconds, r.time_penalty, r.marks, '', '', '{}'
  from pg_temp.paper_rows r left join public.entries e on e.id::text = r.code and e.tournament_id = s.tournament_id;

  insert into public.paper_ballot_log (ballot_id, tournament_id, section_id, action, actor, actor_name, note, previous, entries)
  values (ballot, s.tournament_id, s.id, action, me, me_name, left(coalesce(note, ''), 500), prior, clean);

  delete from private.paper_entry_pass where tx = txid_current();
  return ballot;
end;
$$;
revoke all on function public.enter_paper_ballot(uuid, jsonb, boolean, text) from public, anon;
grant execute on function public.enter_paper_ballot(uuid, jsonb, boolean, text) to authenticated;
