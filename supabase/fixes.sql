-- Director settings saved with the tournament: fees, judges per final, the team-point scale,
-- whether novice finals earn team points. Run after tournaments.sql. Safe to run again.
alter table public.tournaments add column if not exists settings jsonb not null default '{}'::jsonb;

-- ── Linking student accounts to the roster. A student's entries, ballots and practice goals are
-- matched by name and school. If the name on their account isn't spelled the way their coach entered
-- it, the coach links the account to the right roster name. Only the coach (or director) can set it.
alter table public.tournament_members add column if not exists roster_name text not null default '';

-- The name a student member is matched by: the roster name their coach linked, else their account name.
create or replace function private.match_name(member public.tournament_members) returns text
language sql immutable set search_path = '' as $$ select lower(btrim(coalesce(nullif(member.roster_name, ''), member.display_name))) $$;

create or replace function public.guard_roster_name() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.roster_name is distinct from old.roster_name
     and not (private.is_director(old.tournament_id) or (old.role = 'student' and private.coaches_school(old.school))) then
    new.roster_name := old.roster_name;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_roster_name on public.tournament_members;
create trigger guard_roster_name before update on public.tournament_members for each row execute function public.guard_roster_name();
revoke all on function public.guard_roster_name() from public, anon, authenticated;

-- A coach sees the student accounts approved at their own school for a tournament.
create or replace function public.school_students(target uuid)
returns table (user_id uuid, display_name text, roster_name text)
language sql stable security definer set search_path = '' as $$
  select m.user_id, m.display_name, m.roster_name from public.tournament_members m
  where m.tournament_id = target and m.role = 'student' and m.status = 'approved'
    and exists (select 1 from public.tournament_members c where c.tournament_id = target and c.user_id = (select auth.uid()) and c.role = 'coach' and c.status = 'approved' and lower(c.school) = lower(m.school))
  order by m.display_name;
$$;

-- A coach links one of their students to a roster name ('' to unlink). The name must be on that school's entries.
create or replace function public.link_student(target uuid, student uuid, name text) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.tournament_members;
begin
  select * into m from public.tournament_members where tournament_id = target and user_id = student and role = 'student';
  if m.user_id is null or not exists (select 1 from public.tournament_members c where c.tournament_id = target and c.user_id = auth.uid() and c.role = 'coach' and c.status = 'approved' and lower(c.school) = lower(m.school)) then
    raise exception 'Only the coach of this student''s school can link them.' using errcode = 'insufficient_privilege';
  end if;
  if btrim(name) <> '' and not exists (select 1 from public.entries e where e.tournament_id = target and lower(e.school) = lower(m.school) and lower(e.student) = lower(btrim(name))) then
    raise exception '% isn''t on your entries for this tournament.', btrim(name) using errcode = 'check_violation';
  end if;
  update public.tournament_members set roster_name = btrim(name) where tournament_id = target and user_id = student and role = 'student';
end;
$$;
revoke all on function public.school_students(uuid) from public, anon;
revoke all on function public.link_student(uuid, uuid, text) from public, anon;
grant execute on function public.school_students(uuid) to authenticated;
grant execute on function public.link_student(uuid, uuid, text) to authenticated;

-- Released ballots and practice goals now follow the linked roster name.
create or replace function private.student_can_read(target uuid, speaker text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.ballots b
    join public.tournaments t on t.id = b.tournament_id
    join public.tournament_members me on me.tournament_id = t.id and me.user_id = (select auth.uid()) and me.role = 'student' and me.status = 'approved'
    join public.entries e on e.tournament_id = t.id and e.id::text = speaker and lower(e.school) = lower(me.school) and lower(e.student) = private.match_name(me)
    where b.id = target and b.status = 'submitted' and t.status = 'finished'
      and exists (select 1 from public.tournament_members c where c.tournament_id = t.id and c.role = 'coach' and c.status = 'approved' and lower(c.school) = lower(me.school) and c.results_released)
  );
$$;
create or replace function private.is_student(target_school text, target_student text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tournament_members m where m.user_id = (select auth.uid()) and m.role = 'student' and m.status = 'approved'
    and lower(m.school) = lower(btrim(target_school)) and private.match_name(m) = lower(btrim(target_student)));
$$;
revoke all on function private.match_name(public.tournament_members) from public, anon;
grant execute on function private.match_name(public.tournament_members) to authenticated;

-- ── The speech's title or thesis on each ballot entry, as the speaker gave it or the judge wrote it down.
alter table public.ballot_entries add column if not exists speech_title text not null default '';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ballot_entries_speech_title_length') then
    alter table public.ballot_entries add constraint ballot_entries_speech_title_length check (char_length(speech_title) <= 200);
  end if;
end $$;
