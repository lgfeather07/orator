-- Text and email alerts. Run after schema.sql, ballots.sql, tournaments.sql, fixes.sql, calendar.sql and
-- public_results.sql: SQL Editor → New query → paste → Run. Safe to run again.
--
-- Each person chooses, on their own Alerts page, whether Orator may text them (with their phone number and
-- consent) or email them (their account email), and which alerts they want. When the director publishes the
-- schedule, presses "Send room alerts" for a round, swaps a judge after publishing, or opens or closes entries,
-- Postgres writes one row per recipient and channel into `notifications`. The messages are built here, from
-- the schedule itself: the director never types a message and can't choose who receives it. Only approved
-- members of that tournament who opted in get a row. The send-notifications Edge Function
-- (supabase/functions/send-notifications) delivers the rows with Twilio and Resend and marks them sent or failed.
-- Everything also shows in Orator itself (the "Schedule updated" banner), so nothing depends on texts working.

-- Internal helpers live in their own schema. Signed-in users get no access to it at all, so they can't call
-- the helper that queues a message (tournaments.sql grants execute on everything in `private`, so not there).
create schema if not exists alerts_internal;
revoke all on schema alerts_internal from public, anon, authenticated;

-- ── Each person's settings. One row per account.
create table if not exists public.notification_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  phone text not null default '',                       -- +1 and ten digits, or '' for none
  sms_opt_in boolean not null default false,
  email_opt_in boolean not null default false,
  alert_rooms boolean not null default true,             -- students: my room before each round
  alert_ballots boolean not null default true,           -- judges: I have a ballot / room assignment
  alert_schedule boolean not null default true,          -- everyone: schedule published or changed
  alert_entries boolean not null default true,           -- coaches: entries opened or closed
  sms_consent_at timestamptz,                            -- when they agreed to texts
  sms_consent_text text not null default '',             -- the words they agreed to
  updated_at timestamptz not null default now(),
  constraint notification_phone_format check (phone = '' or phone ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  constraint notification_sms_needs_phone check (not sms_opt_in or phone <> '')
);

create or replace function public.stamp_notification_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.user_id := auth.uid(); end if;
  else
    new.user_id := old.user_id;
  end if;
  new.phone := btrim(new.phone);
  -- Consent is recorded when texts are switched on (or the number changes) and cleared when they're switched off.
  if new.sms_opt_in then
    if tg_op = 'INSERT' or not old.sms_opt_in or old.phone is distinct from new.phone or old.sms_consent_at is null then
      new.sms_consent_at := now();
    else
      new.sms_consent_at := old.sms_consent_at; new.sms_consent_text := old.sms_consent_text;
    end if;
    new.sms_consent_text := left(btrim(new.sms_consent_text), 500);
  else
    new.sms_consent_at := null; new.sms_consent_text := '';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists stamp_notification_settings on public.notification_settings;
create trigger stamp_notification_settings before insert or update on public.notification_settings
  for each row execute function public.stamp_notification_settings();
revoke all on function public.stamp_notification_settings() from public, anon, authenticated;

alter table public.notification_settings enable row level security;
revoke all on public.notification_settings from anon, authenticated;
grant select, insert, update, delete on public.notification_settings to authenticated;
drop policy if exists "People read their own alert settings" on public.notification_settings;
create policy "People read their own alert settings" on public.notification_settings for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "People create their own alert settings" on public.notification_settings;
create policy "People create their own alert settings" on public.notification_settings for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "People change their own alert settings" on public.notification_settings;
create policy "People change their own alert settings" on public.notification_settings for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "People remove their own alert settings" on public.notification_settings;
create policy "People remove their own alert settings" on public.notification_settings for delete to authenticated using (user_id = (select auth.uid()));

-- ── The outbox. Written only by the functions below; the Edge Function (service role) marks rows sent or failed.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.tournaments (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  channel text not null check (channel in ('sms', 'email')),
  kind text not null check (kind in ('rooms', 'ballots', 'schedule', 'entries')),
  message text not null check (char_length(message) between 1 and 320),
  dedupe_key text not null,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  error text not null default '',
  attempts int not null default 0,
  provider_id text not null default '',
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create unique index if not exists notifications_dedupe on public.notifications (dedupe_key);
create index if not exists notifications_waiting on public.notifications (status, created_at) where status in ('queued', 'sending');
create index if not exists notifications_by_tournament on public.notifications (tournament_id, created_at desc);
create index if not exists notifications_by_user on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
drop policy if exists "Recipients and the director read alerts" on public.notifications;
create policy "Recipients and the director read alerts" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) or (tournament_id is not null and private.is_director(tournament_id)));

-- ── Building messages. Plain ASCII punctuation keeps a text in one 160-character segment.
create or replace function alerts_internal.site_url() returns text
language sql stable set search_path = '' as $$
  -- Set your own with: alter database postgres set app.site_url = 'https://your-site.example';
  select coalesce(nullif(current_setting('app.site_url', true), ''), 'https://orator-1rab.vercel.app');
$$;

create or replace function alerts_internal.event_name(event_id text) returns text
language sql immutable set search_path = '' as $$
  select case event_id
    when 'info' then 'Informative' when 'persuasive' then 'Persuasive' when 'extemp' then 'Extemp'
    when 'entertainment' then 'Entertainment' when 'oid' then 'OID' when 'poi' then 'POI' when 'poetry' then 'Poetry'
    when 'serious' then 'Serious' when 'humorous' then 'Humorous' when 'duet' then 'Duet Acting' when 'duo' then 'Duo'
    else event_id end;
$$;

-- Same times as roundTimes in src/tournament.ts.
create or replace function alerts_internal.round_time(round int) returns text
language sql immutable set search_path = '' as $$
  select (array['8:00 AM', '9:30 AM', '11:00 AM', '1:30 PM', '3:00 PM', '4:30 PM', '6:00 PM'])[least(greatest(round, 1), 7)];
$$;

create or replace function alerts_internal.ordinal(n int) returns text
language sql immutable set search_path = '' as $$
  select n || case when n % 100 between 11 and 13 then 'th' when n % 10 = 1 then 'st' when n % 10 = 2 then 'nd' when n % 10 = 3 then 'rd' else 'th' end;
$$;

-- "Round 2 Informative", "Round 2 Novice Poetry", "Informative final".
create or replace function alerts_internal.room_label(s public.sections, prelim_rounds int) returns text
language sql immutable set search_path = '' as $$
  select case when s.round > prelim_rounds
    then (case when s.division = 'novice' then 'Novice ' else '' end) || alerts_internal.event_name(s.event_id) || ' final'
    else 'Round ' || s.round || ' ' || (case when s.division = 'novice' then 'Novice ' else '' end) || alerts_internal.event_name(s.event_id) end;
$$;

create or replace function alerts_internal.short_name(name text) returns text
language sql immutable set search_path = '' as $$
  select case when char_length(btrim(name)) > 60 then left(btrim(name), 57) || '...' else btrim(name) end;
$$;

-- Queue one message for one person, on each channel they opted into, if they are an approved member of the
-- tournament and want this kind of alert. The same message for the same reason is only ever queued once.
create or replace function alerts_internal.enqueue(target uuid, recipient uuid, alert text, body text, reason text, out queued int, out repeated int)
language plpgsql security definer set search_path = '' as $$
declare
  s public.notification_settings;
  channel text;
  added int;
  email text;
begin
  queued := 0; repeated := 0;
  if recipient is null or not exists (select 1 from public.tournament_members m where m.tournament_id = target and m.user_id = recipient and m.status = 'approved') then return; end if;
  select * into s from public.notification_settings ns where ns.user_id = recipient;
  if s.user_id is null then return; end if;
  if not (case alert when 'rooms' then s.alert_rooms when 'ballots' then s.alert_ballots when 'schedule' then s.alert_schedule when 'entries' then s.alert_entries else false end) then return; end if;
  select u.email into email from auth.users u where u.id = recipient;
  foreach channel in array array['sms', 'email'] loop
    continue when channel = 'sms' and not (s.sms_opt_in and s.phone <> '');
    continue when channel = 'email' and not (s.email_opt_in and coalesce(email, '') <> '');
    insert into public.notifications (tournament_id, user_id, channel, kind, message, dedupe_key)
    values (target, recipient, channel, alert, left(body, 320), concat_ws(':', target, recipient, channel, reason, md5(body)))
    on conflict (dedupe_key) do nothing;
    get diagnostics added = row_count;
    queued := queued + added; repeated := repeated + 1 - added;
  end loop;
end;
$$;

-- Where a claimed row goes right now: their phone or email, or null if they have since turned it off.
create or replace function alerts_internal.address_of(recipient uuid, channel text, alert text) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when not (case alert when 'rooms' then s.alert_rooms when 'ballots' then s.alert_ballots when 'schedule' then s.alert_schedule when 'entries' then s.alert_entries else false end) then null
    when channel = 'sms' and s.sms_opt_in and s.phone <> '' then s.phone
    when channel = 'email' and s.email_opt_in then nullif((select u.email from auth.users u where u.id = recipient), '')
  end
  from public.notification_settings s where s.user_id = recipient;
$$;

-- An in-app note in the existing "Schedule updated" banner, once per wording.
create or replace function alerts_internal.post_update(target uuid, kind text, body text) returns void
language sql security definer set search_path = '' as $$
  insert into public.tournament_updates (tournament_id, kind, message)
  select target, kind, left(body, 300)
  where not exists (select 1 from public.tournament_updates u where u.tournament_id = target and u.message = left(body, 300) and u.created_at > now() - interval '12 hours');
$$;

revoke all on all functions in schema alerts_internal from public, anon, authenticated;

-- ── Round alerts. The director presses "Send room alerts for Round N" (rounds have no explicit start).
-- Each student gets their room, time and speaking position for each event; each judge gets their room and
-- a link to the ballot. Pressing again sends nothing new unless a room or speaking order has changed.
create or replace function public.queue_round_alerts(target uuid, round_number int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.tournaments;
  s public.sections;
  r record;
  q record;
  label text;
  total int := 0; again int := 0; students int := 0; judges int := 0; unmatched int := 0; rooms int := 0;
begin
  select * into t from public.tournaments where id = target;
  if t.id is null or t.director_id is distinct from auth.uid() then
    raise exception 'Only this tournament''s director can send alerts.' using errcode = 'insufficient_privilege';
  end if;
  if t.status not in ('scheduled', 'running') then
    raise exception 'Publish the schedule before sending room alerts.' using errcode = 'check_violation';
  end if;
  for s in select * from public.sections where tournament_id = target and round = round_number order by position loop
    rooms := rooms + 1;
    label := alerts_internal.room_label(s, t.rounds);
    -- Students, matched to their entries by roster name (or account name) and school, as everywhere else.
    for r in
      select e.id as entry_id, slot.pos, m.user_id
      from unnest(s.entry_ids) with ordinality as slot(entry_id, pos)
      join public.entries e on e.id = slot.entry_id and e.tournament_id = target
      left join public.tournament_members m on m.tournament_id = target and m.role = 'student' and m.status = 'approved'
        and lower(btrim(m.school)) = lower(btrim(e.school)) and private.match_name(m) = lower(btrim(e.student))
    loop
      if r.user_id is null then unmatched := unmatched + 1; continue; end if;
      students := students + 1;
      select * into q from alerts_internal.enqueue(target, r.user_id, 'rooms',
        format('Orator: %s - %s at %s. You speak %s.', label, s.room, alerts_internal.round_time(s.round), alerts_internal.ordinal(r.pos::int)),
        format('round:%s:%s:%s', round_number, s.id, r.entry_id));
      total := total + q.queued; again := again + q.repeated;
    end loop;
    if s.judge_id is not null then
      judges := judges + 1;
      select * into q from alerts_internal.enqueue(target, s.judge_id, 'ballots',
        format('Orator: You''re judging %s in %s at %s. Open your ballot: %s', label, s.room, alerts_internal.round_time(s.round), alerts_internal.site_url()),
        format('round:%s:%s:judge', round_number, s.id));
      total := total + q.queued; again := again + q.repeated;
    end if;
  end loop;
  if rooms = 0 then raise exception 'There are no rooms in round %.', round_number using errcode = 'check_violation'; end if;
  perform alerts_internal.post_update(target, 'schedule', format('%s rooms are posted. Check your room and speaking order in Orator.', case when round_number > t.rounds then 'Final round' else 'Round ' || round_number end));
  return jsonb_build_object('queued', total, 'alreadyQueued', again, 'students', students, 'judges', judges, 'unmatched', unmatched, 'rooms', rooms);
end;
$$;
revoke all on function public.queue_round_alerts(uuid, int) from public, anon;
grant execute on function public.queue_round_alerts(uuid, int) to authenticated;

-- ── Automatic alerts. These fire on the director's own changes (row-level security already limits who can
-- make them), so the director never chooses recipients or wording.

-- Publishing the schedule (everyone who wants schedule alerts), and entries opening or closing (coaches).
create or replace function public.alert_tournament_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m record;
  body text;
  fingerprint text;
begin
  if new.status = 'scheduled' and old.status = 'registration' then
    -- A republished schedule that is exactly the same isn't announced twice.
    select md5(coalesce(string_agg(concat_ws('|', s.round, s.event_id, s.room, s.judge_id, s.entry_ids::text), ',' order by s.position), '')) into fingerprint from public.sections s where s.tournament_id = new.id;
    body := format('Orator: The %s schedule is out. See your rooms and times: %s', alerts_internal.short_name(new.name), alerts_internal.site_url());
    for m in select distinct user_id from public.tournament_members where tournament_id = new.id and status = 'approved' loop
      perform alerts_internal.enqueue(new.id, m.user_id, 'schedule', body, 'published:' || fingerprint);
    end loop;
    perform alerts_internal.post_update(new.id, 'schedule', 'The schedule is published. Your rooms and times are in Orator.');
  end if;
  if new.entries_open is distinct from old.entries_open and new.status = 'registration' then
    body := case when new.entries_open
      then format('Orator: Entries for %s are open again. You can add and drop students until the director closes them.', alerts_internal.short_name(new.name))
      else format('Orator: Entries for %s are now closed. Report an issue in Orator if something still needs to change.', alerts_internal.short_name(new.name)) end;
    for m in select distinct user_id from public.tournament_members where tournament_id = new.id and status = 'approved' and role = 'coach' loop
      -- Pressing the button twice in the same minute only alerts once.
      perform alerts_internal.enqueue(new.id, m.user_id, 'entries', body, 'entries:' || to_char(date_trunc('minute', now()), 'YYYYMMDDHH24MI'));
    end loop;
  end if;
  return null;
end;
$$;
drop trigger if exists alert_tournament_change on public.tournaments;
create trigger alert_tournament_change after update of status, entries_open on public.tournaments
  for each row execute function public.alert_tournament_change();
revoke all on function public.alert_tournament_change() from public, anon, authenticated;

-- A judge swapped after the schedule is out: the new judge hears they have a ballot, the old judge that
-- they no longer do. Finals added later tell their judges too.
create or replace function public.alert_judge_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  t public.tournaments;
  label text;
  stamp text := to_char(date_trunc('minute', now()), 'YYYYMMDDHH24MI');
begin
  select * into t from public.tournaments where id = new.tournament_id;
  if t.status not in ('scheduled', 'running') then return null; end if;
  if tg_op = 'INSERT' and new.round <= t.rounds then return null; end if;
  if tg_op = 'UPDATE' and new.judge_id is not distinct from old.judge_id then return null; end if;
  label := alerts_internal.room_label(new, t.rounds);
  if new.judge_id is not null then
    perform alerts_internal.enqueue(t.id, new.judge_id, 'ballots',
      format('Orator: You''re %sjudging %s in %s at %s. Open your ballot: %s', case when tg_op = 'UPDATE' then 'now ' else '' end, label, new.room, alerts_internal.round_time(new.round), alerts_internal.site_url()),
      format('judge:%s:%s', new.id, stamp));
  end if;
  if tg_op = 'UPDATE' and old.judge_id is not null then
    perform alerts_internal.enqueue(t.id, old.judge_id, 'ballots',
      format('Orator: You''re no longer judging %s in %s. Your rooms are in Orator: %s', label, new.room, alerts_internal.site_url()),
      format('unjudge:%s:%s', new.id, stamp));
  end if;
  return null;
end;
$$;
drop trigger if exists alert_judge_change on public.sections;
create trigger alert_judge_change after insert or update of judge_id on public.sections
  for each row execute function public.alert_judge_change();
revoke all on function public.alert_judge_change() from public, anon, authenticated;

-- ── The director's Alerts summary: counts only, plus the latest errors. No phone numbers or emails.
create or replace function public.alert_summary(target uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
begin
  if not private.is_director(target) then
    raise exception 'Only this tournament''s director can see its alerts.' using errcode = 'insufficient_privilege';
  end if;
  select jsonb_build_object(
    'queued', count(*) filter (where status = 'queued'),
    'sending', count(*) filter (where status = 'sending'),
    'sent', count(*) filter (where status = 'sent'),
    'failed', count(*) filter (where status = 'failed'),
    'oldestQueued', min(created_at) filter (where status = 'queued'),
    'lastSent', max(sent_at)
  ) into result from public.notifications where tournament_id = target;
  select result || jsonb_build_object(
    'members', count(distinct m.user_id),
    'optedIn', count(distinct m.user_id) filter (where (s.sms_opt_in and s.phone <> '') or s.email_opt_in),
    'textOptIns', count(distinct m.user_id) filter (where s.sms_opt_in and s.phone <> ''),
    'emailOptIns', count(distinct m.user_id) filter (where s.email_opt_in),
    'byRole', jsonb_build_object(
      'student', count(distinct m.user_id) filter (where m.role = 'student' and (s.sms_opt_in or s.email_opt_in)),
      'judge', count(distinct m.user_id) filter (where m.role = 'judge' and (s.sms_opt_in or s.email_opt_in)),
      'coach', count(distinct m.user_id) filter (where m.role = 'coach' and (s.sms_opt_in or s.email_opt_in))))
  into result
  from public.tournament_members m left join public.notification_settings s on s.user_id = m.user_id
  where m.tournament_id = target and m.status = 'approved';
  select result || jsonb_build_object('errors', coalesce(jsonb_agg(jsonb_build_object('channel', e.channel, 'kind', e.kind, 'error', e.error, 'at', e.created_at) order by e.created_at desc), '[]'::jsonb))
  into result
  from (select n.channel, n.kind, n.error, n.created_at from public.notifications n where n.tournament_id = target and n.status = 'failed' order by n.created_at desc limit 5) e;
  return result;
end;
$$;
revoke all on function public.alert_summary(uuid) from public, anon;
grant execute on function public.alert_summary(uuid) to authenticated;

-- ── Delivery, for the send-notifications Edge Function only (it runs with the service role key).
-- Claiming moves rows from queued to sending with FOR UPDATE SKIP LOCKED, so two runs at once never take the
-- same row. A row stuck in sending for ten minutes (the function crashed) is tried again, at most three times.
create or replace function public.claim_notifications(batch int default 50, channels text[] default array['sms', 'email'])
returns table (id uuid, channel text, address text, message text, kind text, attempts int)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  r record;
  addr text;
begin
  update public.notifications n set status = 'failed', error = 'Gave up after 3 tries.'
  where n.status = 'sending' and n.claimed_at < now() - interval '10 minutes' and n.attempts >= 3;
  for r in
    with picked as (
      select n.id from public.notifications n
      where n.channel = any (channels) and (n.status = 'queued' or (n.status = 'sending' and n.claimed_at < now() - interval '10 minutes'))
      order by n.created_at
      limit greatest(1, least(coalesce(batch, 50), 500))
      for update skip locked
    )
    update public.notifications n set status = 'sending', claimed_at = now(), attempts = n.attempts + 1
    from picked where n.id = picked.id
    returning n.id, n.user_id, n.channel, n.message, n.kind, n.attempts
  loop
    addr := alerts_internal.address_of(r.user_id, r.channel, r.kind);
    if addr is null then
      update public.notifications n set status = 'failed', error = 'Not sent: the recipient turned this alert off.' where n.id = r.id;
    else
      id := r.id; channel := r.channel; address := addr; message := r.message; kind := r.kind; attempts := r.attempts;
      return next;
    end if;
  end loop;
end;
$$;

-- Record what happened to one claimed row. `retry` puts it back in the queue (a timeout or a 5xx from the provider).
create or replace function public.finish_notification(target uuid, ok boolean, failure text default '', provider text default '', retry boolean default false)
returns void
language sql security definer set search_path = '' as $$
  update public.notifications n set
    status = case when ok then 'sent' when retry and n.attempts < 3 then 'queued' else 'failed' end,
    error = case when ok then '' else left(coalesce(failure, ''), 500) end,
    provider_id = case when ok then left(coalesce(provider, ''), 120) else n.provider_id end,
    sent_at = case when ok then now() else n.sent_at end
  where n.id = target and n.status = 'sending';
$$;

revoke all on function public.claim_notifications(int, text[]) from public, anon, authenticated;
revoke all on function public.finish_notification(uuid, boolean, text, text, boolean) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema alerts_internal to service_role;
    grant execute on function public.claim_notifications(int, text[]) to service_role;
    grant execute on function public.finish_notification(uuid, boolean, text, text, boolean) to service_role;
    grant select, update on public.notifications to service_role;
  end if;
end $$;

-- ── Scheduling delivery every minute (optional). Needs the pg_cron and pg_net extensions (Database → Extensions)
-- and your project URL and service role key. Don't commit the key: paste it only into the SQL Editor, or keep
-- it in Vault as below.
--
-- select vault.create_secret('https://YOUR-PROJECT.supabase.co', 'orator_project_url');
-- select vault.create_secret('YOUR-SERVICE-ROLE-KEY', 'orator_service_key');
-- select cron.schedule('orator-send-notifications', '* * * * *', $cron$
--   select net.http_post(
--     url := (select decrypted_secret from vault.decrypted_secrets where name = 'orator_project_url') || '/functions/v1/send-notifications',
--     headers := jsonb_build_object('Content-Type', 'application/json',
--       'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'orator_service_key')),
--     body := '{}'::jsonb);
-- $cron$);
-- To stop it: select cron.unschedule('orator-send-notifications');
