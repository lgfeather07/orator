-- Orator: the coach plan, enforced by the database. Run after coach_plans.sql. Safe to run again.
--
-- Free, always: the tournament you are working in. A coach reads their own school's submitted ballots
-- from each tournament where they are an approved coach; a student reads their own released ballots;
-- a director reads their own tournament's ballots; public results stay public.
--
-- Coach plan only: one school's ballots across every tournament in one sweep, for season-long growth.
-- That comes only from public.season_ballots(school), which checks the caller belongs to the school
-- and that the school has a plan running (a coach_plans row whose ends_at is still ahead).

-- ── Per-tournament reads for coaches ──
-- Before, a coach read every submitted ballot for the school on their profile, from any tournament,
-- and the profile's school is something the account holder can change themselves. Now a coach reads
-- a ballot only from a tournament where they are an approved coach, and only their school's entries.

-- The school (lower case) the signed-in user is approved to coach at this submitted ballot's tournament, or null.
create or replace function private.coach_school_for_ballot(target uuid) returns text
language sql stable security definer set search_path = '' as $$
  select lower(btrim(m.school)) from public.ballots b
  join public.tournament_members m on m.tournament_id = b.tournament_id and m.user_id = (select auth.uid())
    and m.role = 'coach' and m.status = 'approved' and btrim(m.school) <> ''
  where b.id = target and b.status = 'submitted';
$$;
revoke all on function private.coach_school_for_ballot(uuid) from public, anon;
grant execute on function private.coach_school_for_ballot(uuid) to authenticated;

-- The old profile-school policies (ballots.sql drops them too, so running that file again can't bring them back).
drop policy if exists "Coaches read submitted ballots for their school" on public.ballots;
drop policy if exists "Coaches read submitted entries for their school" on public.ballot_entries;

drop policy if exists "Coaches read their school's ballots from tournaments they coach" on public.ballots;
create policy "Coaches read their school's ballots from tournaments they coach" on public.ballots for select to authenticated
  using (status = 'submitted' and tournament_id is not null and private.ballot_has_school(id, private.coach_school_for_ballot(id)));
drop policy if exists "Coaches read their school's entries from tournaments they coach" on public.ballot_entries;
create policy "Coaches read their school's entries from tournaments they coach" on public.ballot_entries for select to authenticated
  using (lower(btrim(school)) = private.coach_school_for_ballot(ballot_id));

-- ── The season sweep: coach plan only ──

-- True when the school has a plan (paid or trial) that hasn't ended.
create or replace function private.has_active_plan(target text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.coach_plans p where lower(btrim(p.school)) = lower(btrim(target)) and p.ends_at > now());
$$;
revoke all on function private.has_active_plan(text) from public, anon;
grant execute on function private.has_active_plan(text) to authenticated;

-- Every submitted ballot entry for one school, across every tournament, with only what growth needs.
-- Coaches of the school get all of its speakers; students get only their own entries, and only from
-- tournaments that have ended where their coach released results (the same rule as their ballots).
-- Errors: 42501 'not in school' when the caller isn't an approved coach or student of the school;
-- 42501 with hint 'coach_plan_required' when the school has no plan running.
drop function if exists public.season_ballots(text);
create function public.season_ballots(school text)
returns table (speaker text, event_id text, tournament text, round int, rank int, rating int, section_marks int[], present boolean, submitted_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  wanted text := lower(btrim(coalesce(season_ballots.school, '')));
  coach boolean;
begin
  if (select auth.uid()) is null or wanted = '' then
    raise exception 'Sign in as a coach or student of the school to see its season ballots.' using errcode = 'insufficient_privilege';
  end if;
  coach := private.coaches_school(wanted);
  if not coach and not private.in_school(wanted) then
    raise exception 'Only approved coaches and students of % can see its season ballots.', btrim(season_ballots.school)
      using errcode = 'insufficient_privilege';
  end if;
  if not private.has_active_plan(wanted) then
    raise exception 'Season-long ballots for % are part of the coach plan.', btrim(season_ballots.school)
      using errcode = 'insufficient_privilege', hint = 'coach_plan_required';
  end if;
  return query
    select e.speaker_name, b.event_id, coalesce(t.name, b.tournament), b.round, e.rank, e.rating, e.section_marks, e.present, b.submitted_at
    from public.ballot_entries e
    join public.ballots b on b.id = e.ballot_id
    join public.tournaments t on t.id = b.tournament_id
    where b.status = 'submitted' and lower(btrim(e.school)) = wanted
      and (coach or private.student_can_read(b.id, e.speaker_code))
    order by b.submitted_at desc nulls last, b.round, e.speaker_name;
end;
$$;
revoke all on function public.season_ballots(text) from public, anon;
grant execute on function public.season_ballots(text) to authenticated;
