-- 0089: Release Gate R1-G2 — tenant-scoped feature enablement.
--
-- Before R1, every capability flag was a global process-env var: flipping one turned
-- a capability on for EVERY org in the deployment. A design-partner pilot needs a
-- single tenant enabled while all others stay dark. This adds a per-org feature store
-- and a change-audit. The enforcement rule (in code) is env-master AND per-org opt-in:
--   live_for(org, flag) == env_enabled(flag) && org_features.<flag>
-- so the env var remains the deployment kill-switch and the per-org row is the tenant
-- opt-in. FAIL-CLOSED: a missing org_features row (or an unresolved query) means every
-- flag is OFF for that org. Additive; every column defaults false, so nothing changes
-- for existing tenants until an authorized enablement writes a row.

set check_function_bodies = off;

create table if not exists org_features (
  org_id             uuid primary key references organizations(id) on delete cascade,
  pursuits           boolean not null default false,
  facts              boolean not null default false,
  routing            boolean not null default false,
  pursuit_experience boolean not null default false,
  federation         boolean not null default false,
  governed_action    boolean not null default false,
  outcome_learning   boolean not null default false,
  updated_at         timestamptz not null default now()
);
grant select, insert, update, delete on org_features to app_rw;
alter table org_features enable row level security;
drop policy if exists org_features_rw on org_features;
create policy org_features_rw on org_features for all to app_rw
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- Immutable audit of every flag change (who / when / why) — required for R1-G2.
create table if not exists org_feature_changes (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  flag         text not null,
  enabled      boolean not null,
  changed_by   uuid,
  reason       text,
  changed_at   timestamptz not null default now()
);
create index if not exists org_feature_changes_org on org_feature_changes (org_id, changed_at desc);
grant select, insert on org_feature_changes to app_rw;
alter table org_feature_changes enable row level security;
drop policy if exists org_feature_changes_rw on org_feature_changes;
create policy org_feature_changes_rw on org_feature_changes for all to app_rw
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
