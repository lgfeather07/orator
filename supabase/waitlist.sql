-- Entry caps and a waitlist. A director may cap entries per school and per event (each event and division
-- counted separately). An entry over a cap is still saved, but waitlisted: it isn't scheduled or charged
-- until the director admits it. Caps live in the tournament's settings (supabase/fixes.sql):
-- settings.schoolEntryCap and settings.eventEntryCap. Run after tournaments.sql and fixes.sql. Safe to run again.

alter table public.entries add column if not exists waitlisted boolean not null default false;

create or replace function public.waitlist_entry() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  t public.tournaments;
  school_cap int; event_cap int;
begin
  select * into t from public.tournaments where id = new.tournament_id;
  school_cap := nullif(t.settings->>'schoolEntryCap', '')::int;
  event_cap := nullif(t.settings->>'eventEntryCap', '')::int;
  -- The director's own late entries skip the waitlist.
  if private.is_director(new.tournament_id) then new.waitlisted := false; return new; end if;
  new.waitlisted := (school_cap is not null and (select count(*) from public.entries e where e.tournament_id = new.tournament_id and not e.waitlisted and lower(e.school) = lower(new.school)) >= school_cap)
    or (event_cap is not null and (select count(*) from public.entries e where e.tournament_id = new.tournament_id and not e.waitlisted and e.event_id = new.event_id and e.division = new.division) >= event_cap);
  return new;
end;
$$;
drop trigger if exists waitlist_entry on public.entries;
create trigger waitlist_entry before insert on public.entries for each row execute function public.waitlist_entry();
revoke all on function public.waitlist_entry() from public, anon, authenticated;

-- Only the director admits (or re-waitlists) an entry, and only that one field can change.
create or replace function public.guard_entry_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_director(old.tournament_id) then raise exception 'Only the director can admit waitlisted entries.' using errcode = 'insufficient_privilege'; end if;
  new.id := old.id; new.tournament_id := old.tournament_id; new.school := old.school; new.student := old.student;
  new.event_id := old.event_id; new.division := old.division; new.created_by := old.created_by; new.created_at := old.created_at;
  return new;
end;
$$;
drop trigger if exists guard_entry_update on public.entries;
create trigger guard_entry_update before update on public.entries for each row execute function public.guard_entry_update();
revoke all on function public.guard_entry_update() from public, anon, authenticated;

grant update (waitlisted) on public.entries to authenticated;
drop policy if exists "Directors admit waitlisted entries" on public.entries;
create policy "Directors admit waitlisted entries" on public.entries for update to authenticated
  using (private.is_director(tournament_id)) with check (private.is_director(tournament_id));
