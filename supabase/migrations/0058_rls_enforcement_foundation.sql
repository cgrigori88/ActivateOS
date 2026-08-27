-- 0058: RLS enforcement FOUNDATION (RISK-1 / task #67), additive and inert.
--
-- What is true today, verified (not narrated):
--   * The app connects via a raw pg pool as the TABLE OWNER (postgres). The
--     owner bypasses RLS, so every existing policy is inert on the app path.
--   * The existing policies read auth.uid() (the Supabase Data API / PostgREST
--     JWT), which is NULL on the raw-pg path. So they only ever protected the
--     auto-REST Data API — which the app does not use.
--   * Tenant isolation on the live app path is enforced in the APPLICATION
--     layer: every query carries `where org_id = $n`, gated by requireWrite /
--     requireOwner / currentOrgId. That is the control that actually runs today
--     (hardened in the FLOW-1/FLOW-2 pass, commit 8e22218).
--
-- This migration builds — but does NOT activate — a real DB-layer belt so that
-- defense-in-depth exists the day the app is re-plumbed to run as a non-owner
-- role. It is proven in the local DB by a blind per-policy re-test as app_rw
-- (see audit/RISK-1-blind-retest.log): with app.org_id set, a session reads and
-- writes ONLY its own org's rows on every org-scoped table, both directions.
--
-- It changes NOTHING for the running app: no FORCE, no DATABASE_URL change, and
-- app_rw has NOLOGIN. The cutover (see the runbook at the foot of this file) is
-- a separate, gated change that also requires app-layer work — currentOrgId()
-- resolves the caller via auth.uid(), which is null off the JWT path, so the
-- org must instead be threaded from the authenticated web session into a
-- withTenant() wrapper. That plumbing is intentionally NOT in this migration.

-- 1a. GUC reader: the org the current server request is acting as.
create or replace function public.app_current_org() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.org_id', true), '')::uuid $$;

-- 1b. is_org_member honors EITHER the Supabase JWT (auth.uid) OR the app GUC.
--     Only trusted server code can SET app.org_id (end users have no direct DB
--     access; they pass through the app, which sets it from their authenticated
--     org), so the GUC path is not a user-forgeable bypass. SECURITY DEFINER so
--     the membership lookup itself isn't subject to app_rw's own policies.
create or replace function public.is_org_member(org uuid) returns boolean
  language sql stable security definer set search_path to 'public'
  as $$
    select exists (
      select 1 from org_members m where m.org_id = org and m.user_id = auth.uid()
    ) or org = public.app_current_org();
  $$;

-- 2. Non-owner application role. No LOGIN password here — the deploy sets it,
--    and DATABASE_URL is only pointed at it during the gated cutover.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_rw') then
    create role app_rw nologin noinherit;
  end if;
end $$;

grant usage on schema public to app_rw;
grant select, insert, update, delete on all tables in schema public to app_rw;
grant usage, select on all sequences in schema public to app_rw;
grant execute on all functions in schema public to app_rw;
alter default privileges in schema public grant select, insert, update, delete on tables to app_rw;
alter default privileges in schema public grant usage, select on sequences to app_rw;
alter default privileges in schema public grant execute on functions to app_rw;

-- 3. A uniform tenant-isolation policy for app_rw on EVERY org-scoped table
--    (every base table with an org_id column). Data-driven so no table is
--    silently left behind — the earlier hand-picked 14-table version left 38
--    org-scoped tables default-denying app_rw, which the blind re-test caught.
--
--    The belt's job is TENANT isolation, not role gating: USING and WITH CHECK
--    both test is_org_member(org_id), so app_rw touches only its own org's
--    rows. Role gating (viewer vs writer vs owner) stays in the app layer
--    (requireWrite / requireOwner) — pushing it into RLS under the GUC path
--    would be redundant and brittle. Existing `to authenticated` policies are
--    left untouched, preserving the Data API contract.
--
--    Idempotent: drops and recreates each <table>_rw policy.
do $$
declare t text;
begin
  for t in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema = c.table_schema and tb.table_name = c.table_name
     and tb.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'org_id'
    order by 1
  loop
    -- RLS must be on for the policy to take effect at cutover; owner still
    -- bypasses it today, so this stays inert for the running app.
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_rw on public.%I', t, t);
    execute format(
      'create policy %I_rw on public.%I for all to app_rw using (is_org_member(org_id)) with check (is_org_member(org_id))',
      t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- CUTOVER RUNBOOK (do NOT run as part of this migration).
--
-- Preconditions (app-layer, separate change):
--   1. Resolve the caller's org from the authenticated web session (Supabase
--      JWT / server session), NOT from a DB query on auth.uid().
--   2. Wrap every checked-out connection in withTenant(db, orgId): it must run
--      `SET LOCAL app.org_id = <orgId>` at the top of the request's txn so the
--      GUC is set before any tenant query. Fail closed if orgId is absent.
--   3. Re-run the blind per-policy re-test on a real-auth session.
--
-- Then, gated:
--   a. Point DATABASE_URL at app_rw (least privilege; RLS applies to it).
--   b. Optionally `alter table ... force row level security` per table so even
--      a future owner-connected path is subject to the belt.
--
-- Rollback: point DATABASE_URL back at the owner role. RLS becomes inert again
-- (owner bypass); the app-layer `where org_id` scoping remains the control.
-- No policy/role drop needed — this migration is safe to leave in place.
-- ---------------------------------------------------------------------------
