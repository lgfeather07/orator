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

\echo All database checks passed.
