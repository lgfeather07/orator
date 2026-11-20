-- Orator: coach-entered judges and private judge sign-in links.
-- Run in the Supabase SQL Editor after schema.sql, ballots.sql, tournaments.sql, fixes.sql, calendar.sql
-- and public_results.sql. Safe to run again.
--
-- SUPABASE SETTING NEEDED: Authentication → Sign In / Providers → turn on "Allow anonymous sign-ins".
-- (Keep "Confirm email" as it is.) Without it a judge link shows "Guest judge sign-in is turned off".
--
-- How it works
-- • An approved coach enters their school's judges for a tournament (name, optional email and phone,
--   clean judge or the schools they know). A coach-entered judge is APPROVED AT ONCE: the coach was
--   approved by the director and answers for their own judges. The director can decline or remove any
--   of them, and they then drop out of the judge pool.
-- • Each judge gets a private sign-in link. The link holds a random 32-byte token; only its SHA-256
--   hash is stored, so nobody (not the coach, not the director) can read a link back. Making a new
--   link replaces the old one, which stops working at once.
-- • Opening the link signs the judge in as a Supabase anonymous user and calls claim_judge_link(),
--   which binds that user to the judge's seat: an approved judge row in tournament_members with the
--   coach-entered name and school. They then see only their own rooms and fill in those ballots
--   (sections.judge_id = auth.uid(), checked by check_ballot_room from tournaments.sql).
-- • Opening the same link on another device moves the seat there (a judge who switches phones keeps
--   going). The ballots already started or submitted move with the seat; the old device loses it.
--   Turning the link off (revoke) stops it working and signs whoever holds the seat out of it: their
--   unsubmitted drafts are discarded, submitted ballots are kept. A new link can then be made.
-- • A judge who prefers an account can still sign up and ask to join as before. If such an account
--   matches a coach-entered judge, the director can merge them (merge_judge_seat): the account takes
--   the seat and the duplicate disappears from the pool. Otherwise both are shown, flagged.
-- • Anonymous users can only claim a seat: they cannot create tournaments, ask to join, enter students,
--   set practice goals, enter judges, or start a ballot without holding a seat.

create schema if not exists private;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ── Tables ──────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.coach_judges (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  school text not null default '',
  name text not null check (char_length(btrim(name)) between 1 and 80),
  email text not null default '' check (char_length(email) <= 200),
  phone text not null default '' check (char_length(phone) <= 40),
  clean_judge boolean not null default false,
  known_schools text[] not null default '{}',
  status text not null default 'approved' check (status in ('approved', 'declined')),
  token_hash text unique,                       -- sha256 of the link token, hex. Never readable by users.
  link_created_at timestamptz,
  revoked_at timestamptz,
  claimed_by uuid references auth.users (id) on delete set null,
  claimed_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists coach_judges_by_school on public.coach_judges (tournament_id, lower(school));
-- One seat per account per tournament.
create unique index if not exists coach_judges_one_seat_each on public.coach_judges (tournament_id, claimed_by) where claimed_by is not null;

-- The judge row a seat's holder has, and the seat a room is assigned to (kept while nobody holds it).
alter table public.tournament_members add column if not exists coach_judge_id uuid references public.coach_judges (id) on delete cascade;
create unique index if not exists tournament_members_one_row_per_seat on public.tournament_members (coach_judge_id) where coach_judge_id is not null;
alter table public.sections add column if not exists coach_judge_id uuid references public.coach_judges (id) on delete set null;

-- ── Helpers ─────────────────────────────────────────────────────────────────────────────────────
create or replace function private.is_anonymous() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select u.is_anonymous from auth.users u where u.id = (select auth.uid())), false);
$$;

-- The tournament's director, or the coach approved for that school at that tournament.
create or replace function private.manages_judges(target uuid, target_school text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_director(target)
    or (not private.is_anonymous() and coalesce(lower(btrim(target_school)) = private.approved_coach_school(target), false));
$$;

create or replace function private.holds_judge_seat() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.coach_judges c where c.claimed_by = (select auth.uid()) and c.status = 'approved');
$$;

create or replace function private.judge_token_hash(token text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(token, ''), 'UTF8')), 'hex');
$$;

revoke all on function private.is_anonymous() from public, anon;
revoke all on function private.manages_judges(uuid, text) from public, anon;
revoke all on function private.holds_judge_seat() from public, anon;
revoke all on function private.judge_token_hash(text) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_anonymous() to authenticated;
grant execute on function private.manages_judges(uuid, text) to authenticated;
grant execute on function private.holds_judge_seat() to authenticated;

-- ── Anonymous (guest judge) accounts ──────────────────────────────────────────────────────────
-- Whatever a guest sends at sign-in, their profile is a judge with no school: they can never
-- pose as a coach (coach roles read their school's ballots) or a director.
create or replace function public.limit_guest_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select u.is_anonymous from auth.users u where u.id = new.id), false) then
    new.roles := array['judge']; new.school := '';
  end if;
  return new;
end;
$$;
drop trigger if exists limit_guest_profile on public.profiles;
create trigger limit_guest_profile before insert on public.profiles for each row execute function public.limit_guest_profile();
revoke all on function public.limit_guest_profile() from public, anon, authenticated;

-- Restrictive policies: these apply on top of every other policy on the table.
drop policy if exists "Guests cannot create tournaments" on public.tournaments;
create policy "Guests cannot create tournaments" on public.tournaments as restrictive for insert to authenticated with check (not private.is_anonymous());
drop policy if exists "Guests join only through a judge link" on public.tournament_members;
create policy "Guests join only through a judge link" on public.tournament_members as restrictive for insert to authenticated with check (not private.is_anonymous());
drop policy if exists "Guests cannot enter students" on public.entries;
create policy "Guests cannot enter students" on public.entries as restrictive for insert to authenticated with check (not private.is_anonymous());
drop policy if exists "Guests cannot set goals" on public.practice_goals;
create policy "Guests cannot set goals" on public.practice_goals as restrictive for insert to authenticated with check (not private.is_anonymous());
drop policy if exists "Guests start ballots only with a seat" on public.ballots;
create policy "Guests start ballots only with a seat" on public.ballots as restrictive for insert to authenticated
  with check (not private.is_anonymous() or private.holds_judge_seat());

-- ── Coach-entered judges: who may do what ───────────────────────────────────────────────────
create or replace function public.guard_coach_judge() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(private.tournament_status(new.tournament_id), 'finished') = 'finished' then
      raise exception 'This tournament has ended.' using errcode = 'check_violation';
    end if;
    new.school := btrim(new.school);
    new.status := 'approved';             -- approved at once: the coach is approved; the director can decline
    new.token_hash := null; new.link_created_at := null; new.revoked_at := null; new.claimed_by := null; new.claimed_at := null;
    new.created_by := auth.uid(); new.created_at := now();
  else
    new.id := old.id; new.tournament_id := old.tournament_id; new.school := old.school;
    new.created_by := old.created_by; new.created_at := old.created_at;
    -- Only the director decides; a coach removes a judge by deleting them.
    if auth.uid() is not null and not private.is_director(old.tournament_id) then new.status := old.status; end if;
  end if;
  new.name := btrim(new.name); new.email := btrim(new.email); new.phone := btrim(new.phone);
  select coalesce(array_agg(distinct btrim(s)), '{}') into new.known_schools from unnest(new.known_schools) s where btrim(s) <> '';
  if new.clean_judge then new.known_schools := '{}'; end if;
  return new;
end;
$$;
drop trigger if exists guard_coach_judge on public.coach_judges;
create trigger guard_coach_judge before insert or update on public.coach_judges for each row execute function public.guard_coach_judge();

-- Keep the holder's judge row in step with the seat (name, school, conflicts, the director's decision).
create or replace function public.sync_coach_judge() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- A change that came from the judge row itself (the judge editing their conflicts) is already there.
  if pg_trigger_depth() > 1 then return null; end if;
  update public.tournament_members m set coach_judge_id = m.coach_judge_id where m.coach_judge_id = new.id and m.user_id = new.claimed_by;
  return null;
end;
$$;
drop trigger if exists sync_coach_judge on public.coach_judges;
create trigger sync_coach_judge after update on public.coach_judges for each row execute function public.sync_coach_judge();

-- Removing a judge: their rooms go back to unassigned, and a guest holder's drafts are discarded.
-- (Their judge row goes with the seat: tournament_members.coach_judge_id cascades.)
create or replace function public.release_coach_judge() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.sections s set judge_id = null, judge_name = '', coach_judge_id = null where s.coach_judge_id = old.id;
  if old.claimed_by is not null then
    update public.sections s set judge_id = null, judge_name = '' where s.tournament_id = old.tournament_id and s.judge_id = old.claimed_by;
    if coalesce((select u.is_anonymous from auth.users u where u.id = old.claimed_by), false) then
      delete from public.ballots b where b.judge_id = old.claimed_by and b.tournament_id = old.tournament_id and b.status = 'draft';
    end if;
  end if;
  return old;
end;
$$;
drop trigger if exists release_coach_judge on public.coach_judges;
create trigger release_coach_judge before delete on public.coach_judges for each row execute function public.release_coach_judge();

revoke all on function public.guard_coach_judge() from public, anon, authenticated;
revoke all on function public.sync_coach_judge() from public, anon, authenticated;
revoke all on function public.release_coach_judge() from public, anon, authenticated;

alter table public.coach_judges enable row level security;
revoke all on public.coach_judges from anon, authenticated;
-- No token_hash and no claimed_by: a link can't be read back, and the holder's account stays private.
grant select (id, tournament_id, school, name, email, phone, clean_judge, known_schools, status, link_created_at, revoked_at, claimed_at, created_at) on public.coach_judges to authenticated;
grant insert (id, tournament_id, school, name, email, phone, clean_judge, known_schools) on public.coach_judges to authenticated;
grant update (name, email, phone, clean_judge, known_schools, status) on public.coach_judges to authenticated;
grant delete on public.coach_judges to authenticated;

drop policy if exists "Coach and director see entered judges" on public.coach_judges;
create policy "Coach and director see entered judges" on public.coach_judges for select to authenticated
  using (private.manages_judges(tournament_id, school));
drop policy if exists "Coaches enter their own school's judges" on public.coach_judges;
create policy "Coaches enter their own school's judges" on public.coach_judges for insert to authenticated
  with check (private.manages_judges(tournament_id, school));
drop policy if exists "Coach and director edit entered judges" on public.coach_judges;
create policy "Coach and director edit entered judges" on public.coach_judges for update to authenticated
  using (private.manages_judges(tournament_id, school)) with check (private.manages_judges(tournament_id, school));
drop policy if exists "Coach and director remove entered judges" on public.coach_judges;
create policy "Coach and director remove entered judges" on public.coach_judges for delete to authenticated
  using (private.manages_judges(tournament_id, school));

-- ── The holder's judge row ──────────────────────────────────────────────────────────────────────
-- Runs after stamp_member, guard_check_in and guard_roster_name (triggers fire in name order).
-- A row may point at a seat only if its user holds that seat; the row then mirrors the seat.
create or replace function public.zz_coach_judge_member() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  cj public.coach_judges;
begin
  if new.coach_judge_id is null then
    if tg_op = 'UPDATE' and old.coach_judge_id is not null
       and exists (select 1 from public.coach_judges c where c.id = old.coach_judge_id and c.claimed_by = old.user_id) then
      new.coach_judge_id := old.coach_judge_id;   -- only leaving the seat (see unbind_judge_seat) clears it
    else
      return new;
    end if;
  end if;
  select * into cj from public.coach_judges c where c.id = new.coach_judge_id;
  if cj.id is null or cj.claimed_by is distinct from new.user_id or cj.tournament_id <> new.tournament_id or new.role <> 'judge' then
    raise exception 'That judge seat belongs to someone else.' using errcode = 'insufficient_privilege';
  end if;
  new.display_name := cj.name;
  new.school := cj.school;
  new.status := case when cj.status = 'approved' then 'approved' else 'declined' end;
  if tg_op = 'UPDATE' and (new.clean_judge is distinct from old.clean_judge or new.known_schools is distinct from old.known_schools)
     and (new.clean_judge is distinct from cj.clean_judge or new.known_schools is distinct from cj.known_schools) then
    -- The judge corrected their own conflicts: the coach sees the change too.
    update public.coach_judges c set clean_judge = new.clean_judge, known_schools = new.known_schools where c.id = cj.id;
    if new.clean_judge then new.known_schools := '{}'; end if;
  else
    new.clean_judge := cj.clean_judge; new.known_schools := cj.known_schools;
  end if;
  return new;
end;
$$;
drop trigger if exists zz_coach_judge_member on public.tournament_members;
create trigger zz_coach_judge_member before insert or update on public.tournament_members for each row execute function public.zz_coach_judge_member();
revoke all on function public.zz_coach_judge_member() from public, anon, authenticated;

-- ── Rooms assigned to a seat ────────────────────────────────────────────────────────────────────
-- The app assigns an unclaimed coach-entered judge by coach_judge_id; the room's judge_id follows
-- whoever holds the seat, so check_ballot_room keeps working unchanged.
create or replace function public.zz_coach_judge_section() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  holder uuid;
begin
  if tg_op = 'INSERT' or new.coach_judge_id is distinct from old.coach_judge_id then
    if new.coach_judge_id is not null then
      select c.claimed_by into holder from public.coach_judges c where c.id = new.coach_judge_id and c.tournament_id = new.tournament_id and c.status = 'approved';
      if not found then raise exception 'That judge is not entered at this tournament.' using errcode = 'check_violation'; end if;
      new.judge_id := holder;
      return new;
    end if;
  elsif new.judge_id is not distinct from old.judge_id then
    return new;
  elsif new.judge_id is null and exists (select 1 from public.coach_judges c where c.id = old.coach_judge_id and c.claimed_by is null) then
    return new;   -- the seat's holder signed out: the room stays with the seat
  end if;
  new.coach_judge_id := (select c.id from public.coach_judges c where new.judge_id is not null and c.tournament_id = new.tournament_id and c.claimed_by = new.judge_id);
  return new;
end;
$$;
drop trigger if exists zz_coach_judge_section on public.sections;
create trigger zz_coach_judge_section before insert or update on public.sections for each row execute function public.zz_coach_judge_section();
revoke all on function public.zz_coach_judge_section() from public, anon, authenticated;

-- ── Binding a seat to an account ────────────────────────────────────────────────────────────────
-- The previous holder leaves: a guest's judge row is removed (an account's is kept, unlinked), and
-- their rooms stay with the seat. With `discard_drafts`, a guest holder's unsubmitted drafts go too.
create or replace function private.unbind_judge_seat(seat uuid, discard_drafts boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  cj public.coach_judges;
  guest boolean;
begin
  select * into cj from public.coach_judges c where c.id = seat for update;
  if cj.id is null then return; end if;
  -- Defence in depth (private functions aren't reachable through the API): a manager, or a claim in progress.
  if not (private.manages_judges(cj.tournament_id, cj.school) or current_setting('orator.claiming', true) = seat::text) then
    raise exception 'Not allowed.' using errcode = 'insufficient_privilege';
  end if;
  if cj.claimed_by is null then return; end if;
  guest := coalesce((select u.is_anonymous from auth.users u where u.id = cj.claimed_by), false);
  update public.coach_judges c set claimed_by = null, claimed_at = null where c.id = seat;
  update public.sections s set judge_id = null where s.coach_judge_id = seat;
  if guest then
    delete from public.tournament_members m where m.coach_judge_id = seat;
    if discard_drafts then delete from public.ballots b where b.judge_id = cj.claimed_by and b.tournament_id = cj.tournament_id and b.status = 'draft'; end if;
  else
    update public.tournament_members m set coach_judge_id = null where m.coach_judge_id = seat;
  end if;
end;
$$;

-- `holder` takes the seat. With `move_ballots` (only when holder is the caller, i.e. a claim), the
-- previous holder's ballots for this tournament are copied to the holder and removed from the old account.
create or replace function private.bind_judge_seat(seat uuid, holder uuid, move_ballots boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  cj public.coach_judges;
  previous uuid;
  b public.ballots;
  copy uuid;
begin
  select * into cj from public.coach_judges c where c.id = seat for update;
  if cj.id is null or not (private.is_director(cj.tournament_id) or (holder = auth.uid() and current_setting('orator.claiming', true) = seat::text)) then
    raise exception 'Not allowed.' using errcode = 'insufficient_privilege';
  end if;
  previous := cj.claimed_by;
  if previous is not distinct from holder then return; end if;
  if previous is not null then
    perform private.unbind_judge_seat(seat, false);
  end if;
  update public.coach_judges c set claimed_by = holder, claimed_at = now() where c.id = seat;
  if exists (select 1 from public.tournament_members m where m.tournament_id = cj.tournament_id and m.user_id = holder and m.role = 'judge') then
    update public.tournament_members m set coach_judge_id = seat where m.tournament_id = cj.tournament_id and m.user_id = holder and m.role = 'judge';
  else
    -- stamp_member makes the row the caller's own; only a claim gets here (holder = caller).
    insert into public.tournament_members (tournament_id, role, school, coach_judge_id) values (cj.tournament_id, 'judge', cj.school, seat);
  end if;
  -- Rooms follow the seat (zz_coach_judge_section links them back to it).
  update public.sections s set judge_id = holder where s.coach_judge_id = seat;
  if previous is not null then
    update public.sections s set judge_id = holder, coach_judge_id = seat where s.tournament_id = cj.tournament_id and s.judge_id = previous;
  end if;
  if move_ballots and previous is not null and holder = auth.uid() then
    for b in select * from public.ballots x where x.judge_id = previous and x.tournament_id = cj.tournament_id order by x.created_at loop
      begin
        copy := null;
        -- stamp_ballot stamps the caller as the judge.
        insert into public.ballots (tournament, round, room, event_id, class_a, tournament_id, section_id)
          values (b.tournament, b.round, b.room, b.event_id, b.class_a, b.tournament_id, b.section_id)
          on conflict do nothing returning id into copy;
        if copy is not null then
          insert into public.ballot_entries (ballot_id, speaker_code, speaker_name, school, present, rank, rating, time_seconds, time_penalty, section_marks, reason, disqualifications, comments)
            select copy, e.speaker_code, e.speaker_name, e.school, e.present, e.rank, e.rating, e.time_seconds, e.time_penalty, e.section_marks, e.reason, e.disqualifications, e.comments
            from public.ballot_entries e where e.ballot_id = b.id;
          insert into public.ballot_private_notes (ballot_id, speaker_code, note) select copy, n.speaker_code, n.note from public.ballot_private_notes n where n.ballot_id = b.id;
          if b.status = 'submitted' then update public.ballots x set status = 'submitted' where x.id = copy; end if;
          delete from public.ballots x where x.id = b.id;
        end if;
      exception when others then
        null;   -- a ballot that can't move (e.g. its room was reassigned) stays where it was
      end;
    end loop;
  end if;
end;
$$;
revoke all on function private.unbind_judge_seat(uuid, boolean) from public, anon, authenticated;
revoke all on function private.bind_judge_seat(uuid, uuid, boolean) from public, anon, authenticated;

-- ── The functions the app calls ─────────────────────────────────────────────────────────────────
-- A coach (or the director) makes a new sign-in link for one judge. The token is returned once and
-- only its hash is kept; any earlier link for this judge stops working. The current holder keeps the seat.
create or replace function public.create_judge_link(seat uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  cj public.coach_judges;
  token text;
begin
  select * into cj from public.coach_judges c where c.id = seat;
  if cj.id is null or not private.manages_judges(cj.tournament_id, cj.school) then
    raise exception 'Only this judge''s coach or the tournament director can make their link.' using errcode = 'insufficient_privilege';
  end if;
  if cj.status <> 'approved' then raise exception 'The director has declined this judge.' using errcode = 'check_violation'; end if;
  token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  update public.coach_judges c set token_hash = private.judge_token_hash(token), link_created_at = now(), revoked_at = null where c.id = seat;
  return token;
end;
$$;

-- Turn a link off: it stops working, and whoever holds the seat is signed out of it.
create or replace function public.revoke_judge_link(seat uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  cj public.coach_judges;
begin
  select * into cj from public.coach_judges c where c.id = seat;
  if cj.id is null or not private.manages_judges(cj.tournament_id, cj.school) then
    raise exception 'Only this judge''s coach or the tournament director can turn off their link.' using errcode = 'insufficient_privilege';
  end if;
  update public.coach_judges c set token_hash = null, revoked_at = now() where c.id = seat;
  perform private.unbind_judge_seat(seat, true);
end;
$$;

-- A judge opens their link. Any signed-in user may call this (in the app: a fresh anonymous user).
-- Returns the seat they now hold. Calling it again from the same account changes nothing.
create or replace function public.claim_judge_link(token text)
returns table (tournament_id uuid, seat_id uuid, judge_name text, school text, tournament_name text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  cj public.coach_judges;
begin
  if me is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if token is null or char_length(token) < 32 or char_length(token) > 200 then
    raise exception 'This judge link isn''t valid. Ask your coach to send it again.' using errcode = 'check_violation';
  end if;
  select * into cj from public.coach_judges c where c.token_hash = private.judge_token_hash(token) and c.revoked_at is null for update;
  if cj.id is null then
    raise exception 'This judge link isn''t valid any more. It may have been replaced or turned off. Ask your coach for a new one.' using errcode = 'check_violation';
  end if;
  if cj.status <> 'approved' then
    raise exception 'The tournament director has removed this judge. Talk to the director if that''s a mistake.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.coach_judges c where c.tournament_id = cj.tournament_id and c.claimed_by = me and c.id <> cj.id) then
    raise exception 'This device is already signed in as another judge at this tournament. Sign out first, then open the link again.' using errcode = 'check_violation';
  end if;
  if cj.claimed_by is distinct from me then
    -- A guest becomes this judge; an account keeps its own name and gains the judge role.
    update public.profiles p set
      roles = case when private.is_anonymous() then array['judge'] when 'judge' = any (p.roles) then p.roles else p.roles || array['judge'] end,
      full_name = case when private.is_anonymous() or btrim(p.full_name) = '' then cj.name else p.full_name end
    where p.id = me;
    if not found then
      insert into public.profiles (id, full_name, school, roles) values (me, cj.name, '', array['judge']);
    end if;
    perform set_config('orator.claiming', cj.id::text, true);
    perform private.bind_judge_seat(cj.id, me, true);
    perform set_config('orator.claiming', '', true);
  end if;
  return query select cj.tournament_id, cj.id, cj.name, cj.school, t.name from public.tournaments t where t.id = cj.tournament_id;
end;
$$;

-- The director merges a coach-entered judge with a judge who joined with their own account
-- (same person): the account takes the seat. Ballots a guest device already started stay with it.
create or replace function public.merge_judge_seat(seat uuid, account uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  cj public.coach_judges;
begin
  select * into cj from public.coach_judges c where c.id = seat;
  if cj.id is null or not private.is_director(cj.tournament_id) then
    raise exception 'Only the tournament director can merge judges.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.tournament_members m where m.tournament_id = cj.tournament_id and m.user_id = account and m.role = 'judge' and m.coach_judge_id is null) then
    raise exception 'That account hasn''t joined this tournament as a judge.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.coach_judges c where c.tournament_id = cj.tournament_id and c.claimed_by = account) then
    raise exception 'That account already holds a judge seat.' using errcode = 'check_violation';
  end if;
  perform private.bind_judge_seat(seat, account, false);
end;
$$;

revoke all on function public.create_judge_link(uuid) from public, anon;
revoke all on function public.revoke_judge_link(uuid) from public, anon;
revoke all on function public.claim_judge_link(text) from public, anon;
revoke all on function public.merge_judge_seat(uuid, uuid) from public, anon;
grant execute on function public.create_judge_link(uuid) to authenticated;
grant execute on function public.revoke_judge_link(uuid) to authenticated;
grant execute on function public.claim_judge_link(text) to authenticated;
grant execute on function public.merge_judge_seat(uuid, uuid) to authenticated;
