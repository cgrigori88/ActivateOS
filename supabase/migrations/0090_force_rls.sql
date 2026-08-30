-- 0090: Release Gate R1-G3 — FORCE ROW LEVEL SECURITY (defense in depth).
--
-- RLS already binds the app role (app_rw is a non-owner, so policies apply to it).
-- What it does NOT bind by default is the TABLE OWNER. `force row level security`
-- makes policies apply to the owner too — so if the app role were ever granted
-- ownership, or a policy were mis-scoped, the database still refuses a cross-tenant
-- read instead of silently allowing it.
--
-- Compatibility (per the approved D4 role model): the worker + webhooks + research
-- run on a dedicated OWNER pool that is intentionally cross-tenant. That pool MUST be
-- a BYPASSRLS/superuser role (in this deployment, the `postgres` owner) — for which
-- FORCE RLS is a no-op, so those system jobs keep working. FORCE RLS therefore adds a
-- floor for the app role's ownership hypothetical WITHOUT breaking the documented
-- owner-pool system paths. If the owner pool is ever repointed at a NON-BYPASSRLS
-- role, those jobs must first set an explicit per-org `app.org_id` (they are the
-- surfaces the R1-G3 negative tests cover).
--
-- Applied to every table that already has RLS enabled (the tenant-owned, cross-tenant,
-- child, and reference sets alike — forcing a read-only-shared or superuser-owned table
-- changes nothing). Idempotent; additive.

set check_function_bodies = off;

do $$
declare r record;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and c.relrowsecurity = true      -- RLS already enabled
       and c.relforcerowsecurity = false
  loop
    execute format('alter table public.%I force row level security', r.relname);
  end loop;
end $$;
