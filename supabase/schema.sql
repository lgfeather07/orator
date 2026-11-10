-- Orator accounts. Run once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Creates a profile row for every new account and stops users from changing their own roles.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  school text not null default '',
  roles text[] not null default '{student}',
  created_at timestamptz not null default now(),
  constraint profiles_roles_valid check (roles <@ array['student', 'judge', 'coach', 'director'] and cardinality(roles) > 0)
);

alter table public.profiles enable row level security;

drop policy if exists "Read own profile" on public.profiles;
create policy "Read own profile" on public.profiles for select to authenticated using (auth.uid() = id);

drop policy if exists "Update own profile" on public.profiles;
create policy "Update own profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- Signed-in users may edit their name and school only. Roles are set at sign-up and changed by an admin.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, school) on public.profiles to authenticated;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  requested text[];
  allowed text[];
begin
  select coalesce(array_agg(value), '{}') into requested
    from jsonb_array_elements_text(coalesce(new.raw_user_meta_data -> 'roles', '[]'::jsonb)) as value;
  select coalesce(array_agg(role), '{}') into allowed
    from unnest(array['student', 'judge', 'coach', 'director']) as role where role = any (requested);
  if cardinality(allowed) = 0 then allowed := array['student']; end if;
  insert into public.profiles (id, full_name, school, roles)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), coalesce(new.raw_user_meta_data ->> 'school', ''), allowed)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
