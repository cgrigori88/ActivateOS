-- 0059: org resolver for the RISK-1 cutover — solves the chicken-and-egg that
-- blocks running the app as the non-owner role.
--
-- Under app_rw, currentOrgId() cannot find the caller's org the old way: it
-- reads org_members by auth.uid(), but that read is itself RLS-gated and needs
-- app.org_id already set — which we can't set until we know the org. This
-- SECURITY DEFINER function runs as the owner, so it bypasses RLS and resolves
-- the org from a trusted uid (the authenticated Supabase user id, verified at
-- the web layer — NOT client-supplied). withTenant() then sets app.org_id from
-- it and every subsequent tenant query is scoped.
--
-- Falls back to the sole organization in Basic-Auth / demo mode (uid null),
-- matching currentOrgId()'s existing behavior exactly.
--
-- Additive and inert: nothing calls it until the app adopts withTenant() and
-- DATABASE_URL is pointed at app_rw (the gated cutover). Safe to ship now.

-- The sole-org fallback applies ONLY in Basic-Auth / demo mode (uid null). A
-- signed-in user (uid present) with no membership resolves to NULL — no tenant,
-- no data — matching currentOrgId() exactly. Falling back to the sole org for
-- an identified-but-unprivileged user would hand them that org's data.
create or replace function public.resolve_user_org(uid uuid) returns uuid
  language sql stable security definer set search_path to 'public'
  as $$
    select case
      when uid is null
        then (select id from organizations order by created_at asc limit 1)
      else (select org_id from org_members where user_id = uid order by created_at asc limit 1)
    end;
  $$;

-- app_rw may execute it (it runs as the owner regardless); PUBLIC keeps the
-- Data API / authenticated path working too.
grant execute on function public.resolve_user_org(uuid) to app_rw;
