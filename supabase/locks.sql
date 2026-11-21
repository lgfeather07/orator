-- Orator: settings that can't change once the tournament is underway. Safe to run again.
-- - The final-round format (finals, or places from the preliminary rounds) is fixed once the tournament
--   starts, or once any room after the preliminary rounds exists.
-- - A contest's semifinal plan is fixed once any room after its preliminary rounds exists.
-- The director can still change everything else (times, rooms, fees, places announced).

create or replace function private.lock_started_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  contest text;
  later_rooms boolean := exists (select 1 from public.sections s where s.tournament_id = new.id and s.round > old.rounds);
begin
  if (old.settings->>'format') is distinct from (new.settings->>'format')
     and coalesce(old.settings->>'format', 'finals') is distinct from coalesce(new.settings->>'format', 'finals')
     and (old.status in ('running', 'finished') or later_rooms) then
    raise exception 'The final-round format can''t change once the tournament has started.' using errcode = 'check_violation';
  end if;
  for contest in
    select key from jsonb_each(coalesce(old.settings->'semisByContest', '{}'::jsonb))
    union select key from jsonb_each(coalesce(new.settings->'semisByContest', '{}'::jsonb))
  loop
    if (old.settings->'semisByContest'->contest) is distinct from (new.settings->'semisByContest'->contest)
       and exists (select 1 from public.sections s where s.tournament_id = new.id and s.round > old.rounds
         and s.event_id = split_part(contest, ':', 1) and s.division = case when contest like '%:novice' then 'novice' else 'varsity' end) then
      raise exception 'Semifinals for this event can''t change once rooms after the preliminary rounds are made.' using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function private.lock_started_settings() from public, anon, authenticated;
drop trigger if exists lock_started_settings on public.tournaments;
create trigger lock_started_settings before update of settings on public.tournaments
  for each row execute function private.lock_started_settings();
