-- Orator public tournament calendar and open coach registration.
-- Run in the Supabase SQL Editor after tournaments.sql. Safe to run again.
--
-- Directors choose whether their tournament is listed on the public calendar (#/calendar), which
-- anyone can read without an account. Only listed tournaments and only the columns below are public:
-- never entries, members, names, or emails. A director may also approve coaches automatically:
-- a coach's request to register their school is then approved at once, while judges and students
-- still wait for the director.

-- ── Listing details on each tournament
alter table public.tournaments add column if not exists listed boolean not null default false;
-- Tournaments created before the calendar existed stay off it until the director lists them; new ones are listed.
alter table public.tournaments alter column listed set default true;
alter table public.tournaments add column if not exists city text not null default '';
-- A real date for sorting and filtering. `date` stays as the text shown to people.
alter table public.tournaments add column if not exists start_date date;
alter table public.tournaments add column if not exists registration_deadline date;
alter table public.tournaments add column if not exists notes text not null default '';
alter table public.tournaments add column if not exists auto_approve_coaches boolean not null default false;
-- What the host charges ({ entry, school, judge, entriesPerJudge }, in dollars). Null means Orator's defaults.
alter table public.tournaments add column if not exists fees jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tournaments_city_length') then
    alter table public.tournaments add constraint tournaments_city_length check (char_length(city) <= 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tournaments_notes_length') then
    alter table public.tournaments add constraint tournaments_notes_length check (char_length(notes) <= 600);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tournaments_fees_object') then
    alter table public.tournaments add constraint tournaments_fees_object check (fees is null or jsonb_typeof(fees) = 'object');
  end if;
end $$;
create index if not exists tournaments_listed_by_date on public.tournaments (start_date) where listed;

-- ── The public calendar. Anyone (signed in or not) can call this; it returns listed tournaments only,
-- with safe columns only, plus how many schools have a coach approved (a count, never names).
create or replace function public.list_public_tournaments()
returns table (
  id uuid, name text, date text, start_date date, host text, city text, registration_deadline date, notes text,
  event_ids text[], max_entries int, rounds int, status text, entries_open boolean, auto_approve_coaches boolean,
  entry_fee numeric, judge_fee numeric, school_fee numeric, schools_registered int
)
language sql stable security definer set search_path = '' as $$
  select t.id, t.name, t.date, t.start_date, t.host, t.city, t.registration_deadline, t.notes,
    t.event_ids, t.max_entries, t.rounds, t.status, t.entries_open, t.auto_approve_coaches,
    case when jsonb_typeof(t.fees -> 'entry') = 'number' then (t.fees ->> 'entry')::numeric end,
    case when jsonb_typeof(t.fees -> 'judge') = 'number' then (t.fees ->> 'judge')::numeric end,
    case when jsonb_typeof(t.fees -> 'school') = 'number' then (t.fees ->> 'school')::numeric end,
    (select count(distinct lower(m.school))::int from public.tournament_members m
      where m.tournament_id = t.id and m.role = 'coach' and m.status = 'approved' and m.school <> '')
  from public.tournaments t
  where t.listed
  order by t.start_date nulls last, t.created_at desc;
$$;
revoke all on function public.list_public_tournaments() from public;
grant execute on function public.list_public_tournaments() to anon, authenticated;

-- ── Membership requests. Same rules as tournaments.sql, plus one: when the director has turned on
-- "Approve coaches automatically", a coach's request is approved straight away, as long as registration
-- is still open and no other account has ever asked to coach that school at this tournament (that request
-- waits for the director, so nobody can take over another school's entries). Judges and students always wait.
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
    if new.role = 'coach' and new.school <> ''
      and exists (select 1 from public.tournaments t where t.id = new.tournament_id and t.auto_approve_coaches and t.status = 'registration')
      and not exists (select 1 from public.tournament_members m where m.tournament_id = new.tournament_id and m.role = 'coach'
        and m.user_id <> new.user_id and lower(m.school) = lower(new.school)) then
      new.status := 'approved';
    end if;
  else
    new.tournament_id := old.tournament_id; new.user_id := old.user_id; new.role := old.role; new.display_name := old.display_name;
    if not private.is_director(old.tournament_id) then
      new.status := old.status; new.school := old.school;
    end if;
    -- A coach releases results to their students, and only once the tournament has ended.
    if new.results_released and not old.results_released then
      if old.role <> 'coach' or old.status <> 'approved' then
        raise exception 'Only an approved coach can release results.' using errcode = 'insufficient_privilege';
      end if;
      if private.tournament_status(old.tournament_id) <> 'finished' then
        raise exception 'Results can be released once the tournament has ended.' using errcode = 'check_violation';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.stamp_member() from public, anon, authenticated;
