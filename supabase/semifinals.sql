-- Semifinals: an elimination round between the preliminary rounds and the final, for big fields.
-- Run after supabase/tournaments.sql. Safe to run again.
--
-- A semifinal room is a section with stage 'semi', held in the round after the last preliminary round.
-- Finals keep stage null (as before) and are told apart by their round: the round after prelims, or,
-- for a contest with semifinals, one round later. The director's semifinal plan for each contest is
-- saved in tournaments.settings (semisByContest), like the finals cut, so it needs no column.

alter table public.sections add column if not exists stage text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sections_stage_check') then
    alter table public.sections add constraint sections_stage_check check (stage is null or stage in ('prelim', 'semi', 'final'));
  end if;
end $$;

-- With five preliminary rounds, a semifinal is round 6 and its final round 7: allow up to 8.
alter table public.sections drop constraint if exists sections_round_check;
alter table public.sections add constraint sections_round_check check (round between 1 and 8);
