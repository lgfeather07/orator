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

-- ── Error reports and the status board
select pg_temp.as_user('coach');
insert into app_errors (tournament_id, role, area, kind, message) values (:'tid', 'coach', 'Entries', 'request', 'POST entries failed (403, 42501)');
select pg_temp.check(pg_temp.refused(format($q$insert into app_errors (tournament_id, created_by, role, area, message) values (%L, '00000000-0000-4000-8000-0000000000c2', 'coach', 'Entries', 'Pretending to be Olive')$q$, :'tid')), 'nobody can record an error as someone else');
select pg_temp.check((select count(*) from app_errors) = 0, 'a coach cannot read error reports, even their own');
select pg_temp.check(pg_temp.refused('update app_errors set message = ''changed'''), 'error reports cannot be changed');
select pg_temp.check(pg_temp.refused('delete from app_errors'), 'error reports cannot be deleted');
insert into app_errors (tournament_id, role, area, message) values (:'tid', 'coach', 'Entries', repeat('x', 500));
select pg_temp.as_user('student');
select pg_temp.check((select count(*) from app_errors) = 0, 'a student cannot read error reports');
select pg_temp.as_user('other');
select pg_temp.check((select count(*) from app_errors) = 0, 'another coach cannot read error reports');
reset role;
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000e1', 'stranger@ci');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000e1', false);
select pg_temp.check(pg_temp.refused(format($q$insert into app_errors (tournament_id, message) values (%L, 'Not my tournament')$q$, :'tid')), 'someone outside a tournament cannot add errors to it');
insert into app_errors (message) values ('An error with no tournament');
select pg_temp.as_user('director');
select pg_temp.check((select count(*) from app_errors where tournament_id = :'tid') = 2, 'the director reads their tournament''s error reports');
select pg_temp.check((select max(char_length(message)) from app_errors) = 300, 'long error messages are cut to 300 characters');
select pg_temp.check((select count(*) from app_errors where tournament_id is null) = 0, 'the director does not see errors from outside their tournament');
select pg_temp.as_user('student');
insert into app_errors (tournament_id, role, area, message) select :'tid', 'student', 'Practice', 'Loop ' || n from generate_series(1, 40) n;
select pg_temp.as_user('director');
select pg_temp.check((select count(*) from app_errors where created_by = '00000000-0000-4000-8000-0000000000a1') = 30, 'one person can add at most 30 error reports in ten minutes');
insert into sections (tournament_id, round, event_id, label, room) values (:'tid', 1, 'info', 'Section A', 'Room 1'), (:'tid', 1, 'info', 'Section B', 'Room 2'), (:'tid', 1, 'poetry', 'Section A', 'Room 3');
reset role;
select pg_temp.as_user('other');
update sections set judge_id = '00000000-0000-4000-8000-0000000000c2' where tournament_id = :'tid';
insert into ballots (judge_id, tournament, round, room, event_id, tournament_id, section_id, status)
  select '00000000-0000-4000-8000-0000000000c2', 'CI Invitational', 1, s.room, s.event_id, s.tournament_id, s.id, 'draft'
  from sections s where s.tournament_id = :'tid' and s.room in ('Room 1', 'Room 2');
-- Mark Room 2's ballot submitted without speakers (skipping the submission checks, which aren't under test here).
set session_replication_role = replica; update ballots set status = 'submitted', submitted_at = now() where room = 'Room 2' and tournament_id = :'tid'; set session_replication_role = origin;
set role authenticated;
select pg_temp.as_user('director');
select pg_temp.check((select string_agg(s.room || ':' || p.status, ',' order by s.room) from ballot_progress(:'tid') p join sections s on s.id = p.section_id) = 'Room 1:draft,Room 2:submitted', 'the director sees which rooms have a draft or a submitted ballot');
select pg_temp.as_user('coach');
select pg_temp.check((select count(*) from ballot_progress(:'tid')) = 0, 'only the director sees ballot progress');

\echo All database checks passed.
