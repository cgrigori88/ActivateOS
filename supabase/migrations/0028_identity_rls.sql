-- 0028 Identity + RLS (hardening roadmap: multi-tenant slice 1)
--
-- Two things, one migration:
--
-- (a) CLOSE THE DATA API. RLS was never enabled, so every public table was
--     readable (and writable) through Supabase's auto-generated REST endpoint
--     by anyone holding the public anon key — verified live before this
--     migration. Enabling RLS with no anon/authenticated policies flips the
--     API to default-deny. The app itself is unaffected: it connects over
--     direct Postgres as the table owner, which RLS (non-FORCE) does not
--     constrain.
--
-- (b) IDENTITY FOUNDATION. org_members maps real users (auth.users) into
--     organizations with a role; is_org_member() is the predicate every
--     future tenant-scoping policy will build on.
--
-- RULE FOR EVERY FUTURE MIGRATION: any `create table` must be followed by
-- `alter table ... enable row level security`. The DO block below covers
-- everything that exists today.

create table if not exists org_members (
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'operator'
               check (role in ('owner','operator','viewer')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- The predicate future RLS policies key on. SECURITY DEFINER so policies can
-- call it without granting the caller direct org_members access; search_path
-- pinned per Supabase guidance.
create or replace function public.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from org_members m
    where m.org_id = org and m.user_id = auth.uid()
  );
$$;

-- Default-deny the Data API: RLS on for every existing public table.
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;

-- A signed-in user may read their own memberships (needed once the app reads
-- membership through user-scoped clients; harmless until then).
drop policy if exists org_members_select_own on org_members;
create policy org_members_select_own on org_members
  for select to authenticated
  using (user_id = auth.uid());
