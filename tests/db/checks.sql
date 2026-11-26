-- Database permission checks, run in CI after supabase/all_in_one.sql (twice).
-- Each check raises an error when the rule it describes is broken, which fails the run.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000d1', 'director@ci', '{"full_name":"Dana Director","roles":["director"]}'),
  ('00000000-0000-4000-8000-0000000000c1', 'coach@ci', '{"full_name":"Casey Coach","roles":["coach"]}'),
  ('00000000-0000-4000-8000-0000000000c2', 'other@ci', '{"full_name":"Olive Other","roles":["coach"]}'),
  ('00000000-0000-4000-8000-0000000000a1', 'student@ci', '{"full_name":"Sam Speaker","roles":["student"]}');

create function pg_temp.as_user(who text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', case who
    when 'director' then '00000000-0000-4000-8000-0000000000d1' when 'coach' then '00000000-0000-4000-8000-0000000000c1'
    when 'other' then '00000000-0000-4000-8000-0000000000c2' when 'student' then '00000000-0000-4000-8000-0000000000a1' end, false) $$;
-- True when the statement is refused (an error, or no row changed for an update or delete).
create function pg_temp.refused(statement text) returns boolean language plpgsql as $$
declare changed int;
begin
  execute statement; get diagnostics changed = row_count; return changed = 0;
exception when others then return true;
end $$;
create function pg_temp.check(ok boolean, rule text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'FAILED: %', rule; end if; raise notice 'ok - %', rule; end $$;
-- The error a statement raises, as "sqlstate hint" ('' when it runs).
create function pg_temp.error_of(statement text) returns text language plpgsql as $$
declare state text; hint text;
begin
  execute statement; return '';
exception when others then get stacked diagnostics state = returned_sqlstate, hint = pg_exception_hint; return btrim(state || ' ' || hint);
end $$;
set client_min_messages = notice;

set role authenticated;

-- ── Setup: a tournament, two coaches, a student
select pg_temp.as_user('director');
insert into tournaments (name, event_ids) values ('CI Invitational', '{info,poetry}');
select id as tid from tournaments where name = 'CI Invitational' \gset
select pg_temp.as_user('coach'); insert into tournament_members (tournament_id, role, school) values (:'tid', 'coach', 'Cedar');
select pg_temp.as_user('other'); insert into tournament_members (tournament_id, role, school) values (:'tid', 'coach', 'Halden');
select pg_temp.as_user('student'); insert into tournament_members (tournament_id, role, school, display_name) values (:'tid', 'student', 'Cedar', 'Sam Speaker');
select pg_temp.as_user('director'); update tournament_members set status = 'approved' where tournament_id = :'tid';
select pg_temp.as_user('coach');
insert into entries (tournament_id, school, student, event_id) values (:'tid', 'Cedar', 'Sam Speaker', 'info'), (:'tid', 'Cedar', 'Sam Speaker', 'poetry'), (:'tid', 'Cedar', 'Ana Able', 'info');

-- ── Entries
select pg_temp.check(pg_temp.refused(format($q$insert into entries (tournament_id, school, student, event_id) values (%L, 'Halden', 'Sneaky', 'info')$q$, :'tid')), 'a coach cannot enter students for another school');
select pg_temp.as_user('student');
select pg_temp.check((select count(*) from entries) = 2, 'a student sees their own entries during registration');
select pg_temp.check(not exists (select 1 from entries where student = 'Ana Able'), 'a student does not see teammates'' entries during registration');
select pg_temp.as_user('other');
select pg_temp.check(not exists (select 1 from entries where school = 'Cedar'), 'another school''s coach does not see Cedar''s entries during registration');

-- ── Settings locks
select pg_temp.as_user('director');
update tournaments set settings = settings || '{"format":"prelims"}' where id = :'tid';
update tournaments set settings = settings || '{"format":"finals"}' where id = :'tid';
select pg_temp.check(true, 'the format can change during registration');
update tournaments set status = 'scheduled' where id = :'tid';
update tournaments set status = 'running' where id = :'tid';
select pg_temp.check(pg_temp.refused(format($q$update tournaments set settings = settings || '{"format":"prelims"}' where id = %L$q$, :'tid')), 'the format is locked once the tournament is running');
update tournaments set settings = settings || '{"roundTimes":["7:30 AM"]}' where id = :'tid';
select pg_temp.check(true, 'other settings still change while running');

-- ── Name privacy and public results
select pg_temp.as_user('coach'); insert into results_privacy (school, student) values ('Cedar', 'Ana Able');
select pg_temp.as_user('other');
select pg_temp.check(pg_temp.refused($q$insert into results_privacy (school, student) values ('Cedar', 'Sam Speaker')$q$), 'a coach cannot withhold another school''s student');
select pg_temp.as_user('director'); update tournaments set status = 'finished' where id = :'tid';
select publish_results(:'tid', '[{"contest":"info","event_id":"info","place":1,"student":"Ana Able","school":"Cedar","qualifier":"state"},{"contest":"info","event_id":"info","place":2,"student":"Sam Speaker","school":"Cedar"}]', '[{"school":"Cedar","points":38,"place":1}]');
select pg_temp.check(pg_temp.refused(format($q$select publish_results(%L, '[{"contest":"info","event_id":"info","place":1,"student":"X","school":"Y","qualifier":"champion"}]', '[]')$q$, :'tid')), 'only state or alternate are accepted as qualifiers');
set role anon;
select pg_temp.check((select student from published_results where place = 1) = 'Name withheld', 'a withheld name never reaches the public table');
select pg_temp.check((select qualifier from published_results where place = 1) = 'state', 'State qualifiers are published');
select pg_temp.check(pg_temp.refused('select * from results_privacy'), 'the public cannot read who withheld their name');
set role authenticated;
select pg_temp.as_user('other');
select pg_temp.check(pg_temp.refused(format($q$select publish_results(%L, '[]', '[]')$q$, :'tid')), 'only the director can publish results');

-- ── Coach plan
select pg_temp.as_user('coach');
insert into coach_plans (school, kind, ends_at) values ('Cedar', 'trial', now() + interval '1 year');
select pg_temp.check((select ends_at - starts_at from coach_plans where school = 'Cedar') = interval '30 days', 'a free trial always lasts 30 days');
select pg_temp.check(pg_temp.refused($q$insert into coach_plans (school, kind, ends_at) values ('Cedar', 'trial', now())$q$), 'one free trial per school');
select pg_temp.check(pg_temp.refused($q$insert into coach_plans (school, kind, ends_at) values ('Cedar', 'paid', '2099-01-01')$q$), 'a coach cannot give themselves a paid plan');
select pg_temp.check(pg_temp.refused($q$insert into coach_plans (school, kind, ends_at) values ('Halden', 'trial', now())$q$), 'a coach cannot start another school''s trial');
select pg_temp.as_user('student');
select pg_temp.check((select count(*) from coach_plans) = 1, 'a student sees their school''s plan');
select pg_temp.as_user('other');
select pg_temp.check((select count(*) from coach_plans) = 0, 'another school cannot see Cedar''s plan');


-- ── The coach plan, enforced by the database (plan_lock.sql)
-- Ballots are fixtures here (triggers off): one submitted ballot at CI Invitational, one at a second
-- tournament no Cedar member joined, and a draft. Cedar has the trial started above; Halden has no plan.
select pg_temp.as_user('director');
insert into tournaments (name, event_ids) values ('Second Invitational', '{info}');
select id as tid2 from tournaments where name = 'Second Invitational' \gset
select id as sam_info from entries where tournament_id = :'tid' and student = 'Sam Speaker' and event_id = 'info' \gset
select id as ana_info from entries where tournament_id = :'tid' and student = 'Ana Able' \gset
reset role;
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-4000-8000-0000000000e1', 'judge@ci', '{"full_name":"Jo Judge","roles":["judge"]}');
set session_replication_role = replica;
insert into ballots (id, judge_id, tournament, round, room, event_id, status, submitted_at, tournament_id) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000e1', 'CI Invitational', 1, '101', 'info', 'submitted', now() - interval '2 days', :'tid'),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000e1', 'Second Invitational', 1, '201', 'info', 'submitted', now() - interval '1 day', :'tid2'),
  ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000e1', 'CI Invitational', 2, '101', 'info', 'draft', null, :'tid');
insert into ballot_entries (ballot_id, speaker_code, speaker_name, school, present, rank, rating, section_marks) values
  ('00000000-0000-4000-8000-0000000000b1', :'sam_info', 'Sam Speaker', 'Cedar', true, 1, 45, '{9,9,9,9,9}'),
  ('00000000-0000-4000-8000-0000000000b1', :'ana_info', 'Ana Able', 'Cedar', true, 2, 40, '{8,8,8,8,8}'),
  ('00000000-0000-4000-8000-0000000000b1', 'h1', 'Hal Halden', 'Halden', true, 3, 38, '{8,8,8,7,7}'),
  ('00000000-0000-4000-8000-0000000000b2', 'x1', 'Sam Speaker', 'Cedar', true, 2, 42, '{9,9,8,8,8}'),
  ('00000000-0000-4000-8000-0000000000b2', 'h2', 'Hal Halden', 'Halden', true, 1, 47, '{10,10,9,9,9}'),
  ('00000000-0000-4000-8000-0000000000b3', 'x2', 'Sam Speaker', 'Cedar', null, null, null, '{}');
set session_replication_role = origin;
set role authenticated;

-- Free: each tournament's own ballots.
select pg_temp.as_user('coach');
select pg_temp.check((select count(*) from ballot_entries) = 2, 'a coach reads their school''s entries from the tournament they coach (free)');
select pg_temp.check((select count(*) from ballots) = 1, 'a coach reads that tournament''s submitted ballot, not drafts');
select pg_temp.check(not exists (select 1 from ballots where tournament_id = :'tid2'), 'a coach cannot read their school''s ballots from a tournament they don''t coach');
select pg_temp.as_user('other');
update profiles set school = 'Cedar' where id = '00000000-0000-4000-8000-0000000000c2';
select pg_temp.check(not exists (select 1 from ballot_entries where school = 'Cedar'), 'changing the profile school doesn''t open another school''s ballots');
select pg_temp.check((select count(*) from ballot_entries) = 1, 'Halden''s coach reads only Halden''s entry at the tournament they coach');
select pg_temp.as_user('director');
select pg_temp.check((select count(*) from ballot_entries e join ballots b on b.id = e.ballot_id where b.tournament_id = :'tid') = 3, 'the director reads every entry on their tournament''s submitted ballots');
select pg_temp.check(not exists (select 1 from ballots where status = 'draft'), 'the director does not read a judge''s draft');

-- Plan only: the season sweep.
select pg_temp.as_user('other');
select pg_temp.check(pg_temp.error_of($q$select * from season_ballots('Halden')$q$) = '42501 coach_plan_required', 'a coach without a plan gets the coach-plan error from season_ballots');
select pg_temp.check(pg_temp.error_of($q$select * from season_ballots('Cedar')$q$) = '42501', 'another school''s coach cannot read Cedar''s season ballots, plan or not');
select pg_temp.as_user('coach');
select pg_temp.check((select count(*) from season_ballots('Cedar')) = 3, 'with an active trial a coach gets every tournament''s submitted Cedar entries');
select pg_temp.check((select count(*) from season_ballots('cedar ') where tournament = 'Second Invitational') = 1, 'the season includes tournaments the coach didn''t join, matched case-insensitively');
select pg_temp.check(not exists (select 1 from season_ballots('Cedar') where speaker = 'Hal Halden' or rank is null), 'the season holds no other school''s entries and no drafts');
reset role; update coach_plans set ends_at = now() - interval '1 day' where school = 'Cedar'; set role authenticated;
select pg_temp.check(pg_temp.error_of($q$select * from season_ballots('Cedar')$q$) = '42501 coach_plan_required', 'an expired plan blocks season_ballots');
select pg_temp.check((select count(*) from ballot_entries) = 2, 'an expired plan leaves the free per-tournament reads');
reset role; update coach_plans set ends_at = now() + interval '30 days' where school = 'Cedar'; set role authenticated;
select pg_temp.as_user('student');
select pg_temp.check((select count(*) from season_ballots('Cedar')) = 0, 'a student sees no season ballots before their coach releases results');
select pg_temp.as_user('coach'); update tournament_members set results_released = true where tournament_id = :'tid' and role = 'coach';
select pg_temp.as_user('student');
select pg_temp.check((select count(*) from season_ballots('Cedar')) = 1 and not exists (select 1 from season_ballots('Cedar') where speaker <> 'Sam Speaker'), 'a student gets only their own released rows from season_ballots');
select pg_temp.check((select count(*) from ballot_entries) = 1, 'a student still reads their own released entry directly (free)');
select pg_temp.check(pg_temp.error_of($q$select * from season_ballots('Halden')$q$) = '42501', 'a student cannot read another school''s season ballots');
set role anon;
select pg_temp.check(pg_temp.refused($q$select * from season_ballots('Cedar')$q$), 'the public cannot call season_ballots');
set role authenticated;

\echo All database checks passed.
