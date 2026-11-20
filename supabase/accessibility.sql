-- Room-accessibility requests. A coach marks that a student needs an accessible room (step-free, ground floor or
-- elevator), with an optional short note; it applies to all that student's entries. The director marks which rooms are
-- accessible in the tournament's settings (settings.accessibleRooms, saved like the room list; see fixes.sql), and the
-- schedule gives those students' rooms the accessible rooms first.
--
-- Privacy. The request and its note are kept OUT of public.entries on purpose: once the schedule is published every
-- approved member (judges, other schools' coaches and students) can read the whole field's entries ("Who can see
-- entries" in tournaments.sql), so even a yes/no column there would tell them which student asked. Instead requests live
-- in their own table, readable only by the director, the coach of that student's school, and the student themselves.
-- Judges and other coaches see at most that a room is accessible (from the room list), never who asked or why.
--
-- Who can change a request: the coach of that school while entries are open; the director anytime. No access column is
-- added to public.entries, so its update guard keeps exactly the waitlist.sql rules (only the director changes
-- `waitlisted`; every other column locked); it is replaced below only to let account deletion clean up `created_by`.
--
-- Run after waitlist.sql (and tournaments.sql, fixes.sql). Safe to run again.

create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  school text not null,
  student text not null,
  note text not null default '',
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'access_requests_note_length') then
    alter table public.access_requests add constraint access_requests_note_length check (char_length(note) <= 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'access_requests_names') then
    alter table public.access_requests add constraint access_requests_names check (char_length(btrim(school)) between 1 and 120 and char_length(btrim(student)) between 1 and 120);
  end if;
end $$;
-- One request per student (name and school, any case) per tournament.
create unique index if not exists access_requests_one_per_student on public.access_requests (tournament_id, lower(btrim(school)), lower(btrim(student)));

-- True when the signed-in user is this student, approved at this tournament (matched like their ballots: school and roster name).
create or replace function private.is_access_student(target uuid, target_school text, target_student text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tournament_members m where m.tournament_id = target and m.user_id = (select auth.uid())
    and m.role = 'student' and m.status = 'approved' and lower(m.school) = lower(btrim(target_school)) and private.match_name(m) = lower(btrim(target_student)));
$$;
-- True when the signed-in user may change this school's requests now: the director anytime, the school's approved coach
-- while entries are open. Never a guest (anonymous judge-link) account.
create or replace function private.manages_access(target uuid, target_school text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not coalesce((select u.is_anonymous from auth.users u where u.id = (select auth.uid())), false)
    and (private.is_director(target)
      or (private.entries_open(target) and lower(btrim(target_school)) = private.approved_coach_school(target)));
$$;
revoke all on function private.is_access_student(uuid, text, text) from public, anon;
revoke all on function private.manages_access(uuid, text) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_access_student(uuid, text, text) to authenticated;
grant execute on function private.manages_access(uuid, text) to authenticated;

-- A request can't move to another tournament, school or student; who changed it last is stamped.
create or replace function public.guard_access_request() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.id := old.id; new.tournament_id := old.tournament_id; new.school := old.school; new.student := old.student;
  end if;
  new.note := btrim(coalesce(new.note, ''));
  new.updated_by := auth.uid(); new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists guard_access_request on public.access_requests;
create trigger guard_access_request before insert or update on public.access_requests for each row execute function public.guard_access_request();
revoke all on function public.guard_access_request() from public, anon, authenticated;

-- When a student's last entry is withdrawn, their request (and note) goes too.
create or replace function public.drop_orphan_access_request() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.access_requests r
  where r.tournament_id = old.tournament_id and lower(btrim(r.school)) = lower(btrim(old.school)) and lower(btrim(r.student)) = lower(btrim(old.student))
    and not exists (select 1 from public.entries e where e.tournament_id = old.tournament_id and lower(btrim(e.school)) = lower(btrim(old.school)) and lower(btrim(e.student)) = lower(btrim(old.student)));
  return old;
end;
$$;
drop trigger if exists drop_orphan_access_request on public.entries;
create trigger drop_orphan_access_request after delete on public.entries for each row execute function public.drop_orphan_access_request();
revoke all on function public.drop_orphan_access_request() from public, anon, authenticated;

alter table public.access_requests enable row level security;
revoke all on public.access_requests from anon, authenticated;
grant select, insert, update, delete on public.access_requests to authenticated;

drop policy if exists "Who can see accessibility requests" on public.access_requests;
create policy "Who can see accessibility requests" on public.access_requests for select to authenticated
  using (private.is_director(tournament_id)
    or lower(btrim(school)) = (select private.approved_coach_school(tournament_id))
    or private.is_access_student(tournament_id, school, student));
drop policy if exists "Coaches and the director add requests" on public.access_requests;
create policy "Coaches and the director add requests" on public.access_requests for insert to authenticated
  with check (private.manages_access(tournament_id, school));
drop policy if exists "Coaches and the director change requests" on public.access_requests;
create policy "Coaches and the director change requests" on public.access_requests for update to authenticated
  using (private.manages_access(tournament_id, school)) with check (private.manages_access(tournament_id, school));
drop policy if exists "Coaches and the director remove requests" on public.access_requests;
create policy "Coaches and the director remove requests" on public.access_requests for delete to authenticated
  using (private.manages_access(tournament_id, school));
-- (An earlier draft had a separate guest policy; guests are now refused in private.manages_access.)
drop policy if exists "Guests cannot add requests" on public.access_requests;

-- Add, change or remove one student's request. Runs with the caller's rights, so the policies above decide who may.
create or replace function public.set_access_request(target uuid, target_school text, target_student text, needed boolean, note text default '')
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not private.manages_access(target, target_school) then
    raise exception 'Only the director, or this school''s coach while entries are open, can change an accessibility request.' using errcode = 'insufficient_privilege';
  end if;
  if needed then
    insert into public.access_requests as r (tournament_id, school, student, note)
    values (target, btrim(target_school), btrim(target_student), btrim(coalesce(note, '')))
    on conflict (tournament_id, lower(btrim(school)), lower(btrim(student))) do update set note = excluded.note;
  else
    delete from public.access_requests r where r.tournament_id = target
      and lower(btrim(r.school)) = lower(btrim(target_school)) and lower(btrim(r.student)) = lower(btrim(target_student));
  end if;
end;
$$;
revoke all on function public.set_access_request(uuid, text, text, boolean, text) from public, anon;
grant execute on function public.set_access_request(uuid, text, text, boolean, text) to authenticated;

-- ── public.entries update guard, replacing waitlist.sql's version with every rule kept: only the director may update an
-- entry, and only `waitlisted` can change (every other column is put back). One addition: deleting an account runs the
-- `created_by ... on delete set null` foreign key as an UPDATE with nobody signed in; that system cleanup (auth.uid() is
-- null and the only change is created_by becoming null) is let through unchanged, so deleting a user who entered students works.
create or replace function public.guard_entry_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare unchanged public.entries;
begin
  if auth.uid() is null and old.created_by is not null and new.created_by is null then
    unchanged := new; unchanged.created_by := old.created_by;
    if unchanged is not distinct from old then return new; end if;
  end if;
  if not private.is_director(old.tournament_id) then raise exception 'Only the director can admit waitlisted entries.' using errcode = 'insufficient_privilege'; end if;
  new.id := old.id; new.tournament_id := old.tournament_id; new.school := old.school; new.student := old.student;
  new.event_id := old.event_id; new.division := old.division; new.created_by := old.created_by; new.created_at := old.created_at;
  return new;
end;
$$;
drop trigger if exists guard_entry_update on public.entries;
create trigger guard_entry_update before update on public.entries for each row execute function public.guard_entry_update();
revoke all on function public.guard_entry_update() from public, anon, authenticated;
