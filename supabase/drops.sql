-- Drop deadlines and drop fees. Run after judges.sql (and before paper_ballots.sql and alerts.sql). Safe to run again.
--
-- The director sets, in the tournament's settings (supabase/fixes.sql):
--   settings.dropDeadline    an ISO date and time ("2026-11-14T23:59:00.000Z"); none means drops are never charged
--   settings.dropEntryFee    dollars per entry dropped after the deadline (default 0)
--   settings.dropJudgeFee    dollars per coach-entered judge dropped after the deadline (default 0)
--   settings.freezeEntryFees true: an entry dropped after the deadline still owes its entry fee (settings.fees.entry, default 7)
--
-- When a coach deletes one of their entries (public.entries) or judges (public.coach_judges) after the deadline,
-- an AFTER DELETE trigger records a drop in public.entry_drops with the fees as they stand at that moment, so
-- changing the fees later never changes earlier drops. Nothing is recorded:
--   * before the deadline, or when there is no deadline;
--   * for a waitlisted entry (it was never charged), or a judge the director had declined;
--   * when the director removes it: the director's own removals are never charged (a director removes an entry
--     to correct a mistake or on a coach's behalf, which isn't the school dropping late);
--   * when nobody is signed in (the SQL Editor or the service role), or the whole tournament is being deleted.
-- A student dropped and re-added in the same event is still a drop; the director can waive it.
--
-- Access: the director reads every drop at their tournament and waives or restores one (with a reason); an
-- approved coach reads their own school's drops; nobody else reads them. Nobody inserts, deletes or edits
-- drops directly: only the triggers write them, and the director may change only waived and waive_reason.

create schema if not exists private;

create table if not exists public.entry_drops (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  school text not null default '',
  kind text not null check (kind in ('entry', 'judge')),
  name text not null default '',
  event_id text,                                   -- entries only
  division text check (division is null or division in ('varsity', 'novice')),
  dropped_at timestamptz not null default now(),
  dropped_by uuid references auth.users (id) on delete set null,
  dropped_by_name text not null default '',
  fee numeric(10, 2) not null default 0 check (fee >= 0),            -- the drop fee
  entry_fee numeric(10, 2) not null default 0 check (entry_fee >= 0), -- the frozen entry fee, 0 unless fees froze
  waived boolean not null default false,
  waive_reason text not null default '' check (char_length(waive_reason) <= 200),
  waived_at timestamptz,
  waived_by uuid references auth.users (id) on delete set null
);
create index if not exists entry_drops_by_school on public.entry_drops (tournament_id, lower(school));

-- ── Reading the settings safely: a malformed value counts as no deadline, or $0. ───────────────────
create or replace function private.drop_deadline(settings jsonb) returns timestamptz
language plpgsql stable set search_path = '' as $$
begin
  return nullif(btrim(settings->>'dropDeadline'), '')::timestamptz;
exception when others then return null;
end;
$$;

create or replace function private.drop_amount(value text, fallback numeric) returns numeric
language plpgsql immutable set search_path = '' as $$
begin
  return greatest(0, round(coalesce(nullif(btrim(value), '')::numeric, fallback), 2));
exception when others then return fallback;
end;
$$;

-- Records a coach's drop if the tournament's deadline has passed. Returns quietly otherwise.
create or replace function private.record_drop(target uuid, drop_kind text, drop_school text, drop_name text, drop_event text, drop_division text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.tournaments;
  who uuid := auth.uid();
  deadline timestamptz;
  drop_fee numeric; frozen numeric := 0;
begin
  if who is null then return; end if;
  select * into t from public.tournaments where id = target;
  if not found then return; end if;                       -- the tournament itself is being deleted
  if t.director_id = who then return; end if;             -- the director's removals are never charged
  deadline := private.drop_deadline(t.settings);
  if deadline is null or now() <= deadline then return; end if;
  drop_fee := private.drop_amount(t.settings->>(case when drop_kind = 'entry' then 'dropEntryFee' else 'dropJudgeFee' end), 0);
  if drop_kind = 'entry' and coalesce(t.settings->'freezeEntryFees' = 'true'::jsonb, false) then
    frozen := private.drop_amount(t.settings->'fees'->>'entry', 7);
  end if;
  insert into public.entry_drops (tournament_id, school, kind, name, event_id, division, dropped_by, dropped_by_name, fee, entry_fee)
  values (target, drop_school, drop_kind, drop_name, drop_event, drop_division, who,
    coalesce((select nullif(btrim(p.full_name), '') from public.profiles p where p.id = who), 'Coach'), drop_fee, frozen);
end;
$$;

create or replace function public.record_entry_drop() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(old.waitlisted, false) then
    perform private.record_drop(old.tournament_id, 'entry', old.school, old.student, old.event_id, old.division);
  end if;
  return null;
end;
$$;
drop trigger if exists record_entry_drop on public.entries;
create trigger record_entry_drop after delete on public.entries for each row execute function public.record_entry_drop();

create or replace function public.record_judge_drop() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'approved' then
    perform private.record_drop(old.tournament_id, 'judge', old.school, old.name, null, null);
  end if;
  return null;
end;
$$;
drop trigger if exists record_judge_drop on public.coach_judges;
create trigger record_judge_drop after delete on public.coach_judges for each row execute function public.record_judge_drop();

-- The director may only waive or restore: every other column keeps its value, and who waived it and when is stamped.
create or replace function public.guard_entry_drop() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_director(old.tournament_id) then
    raise exception 'Only the tournament director can waive a drop fee.' using errcode = 'insufficient_privilege';
  end if;
  new.id := old.id; new.tournament_id := old.tournament_id; new.school := old.school; new.kind := old.kind; new.name := old.name;
  new.event_id := old.event_id; new.division := old.division; new.dropped_at := old.dropped_at; new.dropped_by := old.dropped_by;
  new.dropped_by_name := old.dropped_by_name; new.fee := old.fee; new.entry_fee := old.entry_fee;
  new.waive_reason := btrim(coalesce(new.waive_reason, ''));
  if new.waived then
    if new.waive_reason = '' then raise exception 'Give a reason for waiving this drop fee.' using errcode = 'check_violation'; end if;
    if not old.waived or new.waive_reason is distinct from old.waive_reason then new.waived_at := now(); new.waived_by := auth.uid(); else new.waived_at := old.waived_at; new.waived_by := old.waived_by; end if;
  else
    new.waive_reason := ''; new.waived_at := null; new.waived_by := null;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_entry_drop on public.entry_drops;
create trigger guard_entry_drop before update on public.entry_drops for each row execute function public.guard_entry_drop();

revoke all on function private.drop_deadline(jsonb) from public, anon, authenticated;
revoke all on function private.drop_amount(text, numeric) from public, anon, authenticated;
revoke all on function private.record_drop(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.record_entry_drop() from public, anon, authenticated;
revoke all on function public.record_judge_drop() from public, anon, authenticated;
revoke all on function public.guard_entry_drop() from public, anon, authenticated;

alter table public.entry_drops enable row level security;
revoke all on public.entry_drops from anon, authenticated;
grant select on public.entry_drops to authenticated;
grant update (waived, waive_reason) on public.entry_drops to authenticated;

drop policy if exists "Director and the school's coach read drops" on public.entry_drops;
create policy "Director and the school's coach read drops" on public.entry_drops for select to authenticated
  using (private.is_director(tournament_id) or lower(btrim(school)) = (select private.approved_coach_school(tournament_id)));
drop policy if exists "Director waives drops" on public.entry_drops;
create policy "Director waives drops" on public.entry_drops for update to authenticated
  using (private.is_director(tournament_id)) with check (private.is_director(tournament_id));
-- No insert or delete policy: only the triggers above (running as the table owner) write drops.
