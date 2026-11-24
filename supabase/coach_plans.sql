-- Orator: the coach plan. A school's plan unlocks season-long growth stats, team comparisons and students'
-- own growth pages for its coaches and students. Each tournament's own ballots stay free. Safe to run again.
--
-- A coach can start one 30-day free trial for their school. A paid plan is added by Orator once the school
-- pays (by card through Stripe later, or by check now), from the SQL Editor:
--   insert into public.coach_plans (school, kind, ends_at) values ('Wrenfield High', 'paid', '2027-08-01');

create table if not exists public.coach_plans (
  id uuid primary key default gen_random_uuid(),
  school text not null check (char_length(btrim(school)) between 1 and 120),
  kind text not null check (kind in ('trial', 'paid')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists coach_plans_by_school on public.coach_plans (lower(btrim(school)));
-- One free trial per school, ever.
create unique index if not exists coach_plans_one_trial on public.coach_plans (lower(btrim(school))) where kind = 'trial';

-- Anyone approved in a tournament for this school: its coaches and its students.
create or replace function private.in_school(target text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tournament_members m where m.user_id = (select auth.uid()) and m.status = 'approved'
    and m.role in ('coach', 'student') and lower(btrim(m.school)) = lower(btrim(target)));
$$;
revoke all on function private.in_school(text) from public, anon;
grant execute on function private.in_school(text) to authenticated;

alter table public.coach_plans enable row level security;
revoke all on public.coach_plans from anon, authenticated;
grant select, insert on public.coach_plans to authenticated;

drop policy if exists "The school's coaches and students see its plan" on public.coach_plans;
create policy "The school's coaches and students see its plan" on public.coach_plans for select to authenticated
  using (private.in_school(school));
-- Coaches may only start a trial. Paid plans come from Orator (the service role or the SQL Editor).
drop policy if exists "Coaches start their school's free trial" on public.coach_plans;
create policy "Coaches start their school's free trial" on public.coach_plans for insert to authenticated
  with check (kind = 'trial' and private.coaches_school(school) and created_by = (select auth.uid()));

-- A trial a coach starts always runs 30 days from now, whatever the request says.
create or replace function private.fix_trial_dates() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'trial' and (select auth.uid()) is not null then
    new.starts_at := now();
    new.ends_at := now() + interval '30 days';
  end if;
  return new;
end;
$$;
revoke all on function private.fix_trial_dates() from public, anon, authenticated;
drop trigger if exists fix_trial_dates on public.coach_plans;
create trigger fix_trial_dates before insert on public.coach_plans
  for each row execute function private.fix_trial_dates();
