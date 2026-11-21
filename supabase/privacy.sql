-- Orator: keep a student's name off public results.
-- A coach (for anyone on their team) or the student themselves can ask that the student's name is withheld.
-- Their placings still count and still show, as "Name withheld", so places and team points stay right, but the
-- name is never written to the public tables. Safe to run again.

create table if not exists public.results_privacy (
  id uuid primary key default gen_random_uuid(),
  school text not null check (char_length(btrim(school)) between 1 and 120),
  student text not null check (char_length(btrim(student)) between 1 and 120),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists results_privacy_one_per_student on public.results_privacy (lower(btrim(school)), lower(btrim(student)));

alter table public.results_privacy enable row level security;
revoke all on public.results_privacy from anon, authenticated;
grant select, insert, delete on public.results_privacy to authenticated;

drop policy if exists "Coaches and the student see the request" on public.results_privacy;
create policy "Coaches and the student see the request" on public.results_privacy for select to authenticated
  using (private.coaches_school(school) or private.is_student(school, student));
drop policy if exists "Coaches and the student withhold the name" on public.results_privacy;
create policy "Coaches and the student withhold the name" on public.results_privacy for insert to authenticated
  with check ((private.coaches_school(school) or private.is_student(school, student)) and created_by = (select auth.uid()));
drop policy if exists "Coaches and the student show the name again" on public.results_privacy;
create policy "Coaches and the student show the name again" on public.results_privacy for delete to authenticated
  using (private.coaches_school(school) or private.is_student(school, student));

-- Published placings keep their place and school but not the name (published_results.withheld, in public_results.sql).

create or replace function private.name_withheld(target_school text, target_student text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.results_privacy p where lower(btrim(p.school)) = lower(btrim(target_school)) and lower(btrim(p.student)) = lower(btrim(target_student)));
$$;
revoke all on function private.name_withheld(text, text) from public, anon, authenticated;

-- Every placing written to the public table is checked against the list.
create or replace function private.withhold_published_name() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.withheld or private.name_withheld(new.school, new.student) then
    new.withheld := true;
    new.student := 'Name withheld';
  end if;
  return new;
end;
$$;
revoke all on function private.withhold_published_name() from public, anon, authenticated;
drop trigger if exists withhold_published_name on public.published_results;
create trigger withhold_published_name before insert or update on public.published_results
  for each row execute function private.withhold_published_name();

-- Asking after results are already public takes the name off them straight away. Showing the name again
-- takes effect the next time each director publishes.
create or replace function private.withhold_existing_results() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.published_results set withheld = true, student = 'Name withheld'
    where not withheld and lower(school) = lower(btrim(new.school)) and lower(student) = lower(btrim(new.student));
  return null;
end;
$$;
revoke all on function private.withhold_existing_results() from public, anon, authenticated;
drop trigger if exists withhold_existing_results on public.results_privacy;
create trigger withhold_existing_results after insert on public.results_privacy
  for each row execute function private.withhold_existing_results();
