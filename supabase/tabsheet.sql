-- Orator: live tab sheets.
-- Run in the Supabase SQL Editor after every file up to paper_ballots.sql, and before alerts.sql
-- (see the order in README.md). Safe to run again. Re-run it whenever you re-run tournaments.sql.
--
-- A tab sheet shows each preliminary round's rank and score for every speaker as ballots arrive,
-- their cumulative rank and current place, and which rooms are still out.
--
-- Who sees what (all enforced here, in public.tab_sheet):
--   * the director: every school;
--   * tab-room staff (approved coaches the director marks with tournament_members.tab_staff): every school, read-only;
--   * every other approved coach: their own school's speakers only (with each speaker's place in the contest);
--   * students, judges, everyone else: nothing.
-- Only submitted ballots count. Comments, reasons and private notes are never returned, and the
-- ballots / ballot_entries tables are not opened any wider: everything goes through tab_sheet().

create schema if not exists private;

-- ── Tab-room staff: only the director can set it, and only on an approved coach ──
alter table public.tournament_members add column if not exists tab_staff boolean not null default false;

create or replace function public.guard_tab_staff() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.tab_staff := false;               -- nobody asks to join as tab staff
    return new;
  end if;
  if not private.is_director(old.tournament_id) then
    new.tab_staff := old.tab_staff;       -- a coach can't make themselves (or anyone) tab staff
    return new;
  end if;
  if new.tab_staff and not old.tab_staff and (old.role <> 'coach' or new.status <> 'approved') then
    raise exception 'Only an approved coach can be tab-room staff.' using errcode = 'check_violation';
  end if;
  -- Removing a coach's access also ends their tab-room access.
  if old.role <> 'coach' or new.status <> 'approved' then new.tab_staff := false; end if;
  return new;
end;
$$;
drop trigger if exists guard_tab_staff on public.tournament_members;
create trigger guard_tab_staff before insert or update on public.tournament_members
  for each row execute function public.guard_tab_staff();
revoke all on function public.guard_tab_staff() from public, anon, authenticated;

-- ── The tab sheet: one row per (entry, preliminary round) ──
-- place / field: the speaker's current place in their contest among speakers with at least one rank,
-- worked out from every school's submitted ballots with the NSAA order the app uses (results.ts
-- prelimStandings): cumulative rank, opponents' average rank, head-to-head (an exact two-way tie),
-- reciprocals, rating points. A coach gets their own speakers' places, never anyone else's ranks.
drop function if exists public.tab_sheet(uuid);
create function public.tab_sheet(target uuid)
returns table (
  entry_id uuid, student text, school text, event_id text, division text,
  round int, section_id uuid, section_label text, room text, judge_name text, speak_order int,
  rank int, rating int, present boolean, submitted boolean, place int, field int
)
language sql stable security definer set search_path = '' as $$
  with viewer as (
    select private.is_director(target) as director,
      exists (select 1 from public.tournament_members m
              where m.tournament_id = target and m.user_id = (select auth.uid())
                and m.role = 'coach' and m.status = 'approved' and m.tab_staff) as staff,
      private.approved_coach_school(target) as school,
      coalesce(private.tournament_status(target), 'registration') as status
  ),
  seats as (
    select s.id as section_id, s.round, s.event_id, s.division, s.label, s.room,
      coalesce(nullif(s.judge_name, ''), (select p.full_name from public.profiles p where p.id = s.judge_id), '') as judge_name,
      u.entry_id, u.ord::int as speak_order, e.student, e.school
    from public.sections s
    join public.tournaments t on t.id = s.tournament_id
    cross join lateral unnest(s.entry_ids) with ordinality as u(entry_id, ord)
    join public.entries e on e.id = u.entry_id and e.tournament_id = s.tournament_id
    where s.tournament_id = target and s.round <= t.rounds and coalesce(s.stage, 'prelim') = 'prelim'
  ),
  -- The ballot that counts for each room: submitted only (a paper ballot the tab room entered wins).
  counted as (
    select distinct on (b.section_id) b.id, b.section_id
    from public.ballots b
    where b.tournament_id = target and b.status = 'submitted' and b.section_id in (select seats.section_id from seats)
    order by b.section_id, (b.source = 'paper') desc, b.submitted_at desc nulls last
  ),
  lines as (
    select seats.*, c.id is not null as submitted, be.present,
      case when be.present then be.rank end as rank,
      case when be.present then be.rating end as rating
    from seats
    left join counted c on c.section_id = seats.section_id
    left join public.ballot_entries be on be.ballot_id = c.id and be.speaker_code = seats.entry_id::text
  ),
  res as (
    select l.entry_id, l.section_id, l.event_id, l.division, l.rank, coalesce(l.rating, 0) as rating
    from lines l where l.submitted and l.present and l.rank is not null
  ),
  stats as (
    select r.entry_id, r.event_id, r.division, sum(r.rank)::int as cum, count(*)::int as n,
      round(sum(1.0 / r.rank), 4) as recip, sum(r.rating)::int as pts
    from res r group by r.entry_id, r.event_id, r.division
  ),
  -- Opponents' average rank: the average of the average ranks of everyone this speaker shared a ranked room with.
  opp as (
    select r.entry_id, round(avg(coalesce(st.cum::numeric / nullif(st.n, 0), 0)), 4) as opp
    from res r
    join seats o on o.section_id = r.section_id and o.entry_id <> r.entry_id
    left join stats st on st.entry_id = o.entry_id
    group by r.entry_id
  ),
  keyed as (
    select st.*, coalesce(op.opp, 0) as opp,
      count(*) over (partition by st.event_id, st.division, st.cum, coalesce(op.opp, 0)) as tied
    from stats st left join opp op on op.entry_id = st.entry_id
  ),
  -- Head-to-head, only for an exact two-way tie: the one ranked lower every time they met goes behind.
  h2h as (
    select a.entry_id, case when bool_and(ra.rank > rb.rank) then 1 else 0 end as behind
    from keyed a
    join keyed b on b.event_id = a.event_id and b.division = a.division and b.cum = a.cum and b.opp = a.opp and b.entry_id <> a.entry_id
    join res ra on ra.entry_id = a.entry_id
    join res rb on rb.entry_id = b.entry_id and rb.section_id = ra.section_id
    where a.tied = 2
    group by a.entry_id
  ),
  placed as (
    select k.entry_id,
      rank() over (partition by k.event_id, k.division order by k.cum, k.opp, coalesce(h.behind, 0), k.recip desc, k.pts desc)::int as place,
      count(*) over (partition by k.event_id, k.division)::int as field
    from keyed k left join h2h h on h.entry_id = k.entry_id
  )
  select l.entry_id, l.student, l.school, l.event_id, l.division, l.round, l.section_id, l.label, l.room, l.judge_name, l.speak_order,
    l.rank, l.rating, l.present, l.submitted, p.place, p.field
  from lines l
  cross join viewer v
  left join placed p on p.entry_id = l.entry_id
  where v.director
     or (v.status <> 'registration' and (v.staff or lower(l.school) = v.school))
  order by l.event_id, l.division, l.round, l.section_id, l.speak_order;
$$;
revoke all on function public.tab_sheet(uuid) from public, anon;
grant execute on function public.tab_sheet(uuid) to authenticated;
