-- P7 Slice 12 — pinned Dynamic Surface DEFINITIONS.
--
--   > A pinned surface may persist a validated presentation/query definition. It may not persist
--   > governed results, derived identities, authority, disclosure decisions or execution state.
--
-- PURELY ADDITIVE. One new table, referenced by no existing object, so the currently serving
-- application is unaffected by its existence and the migration is safe in either order relative to a
-- deploy (§16F is still applied, and the serving commit is still proven first).
--
-- THE SCHEMA IS THE ENFORCEMENT. There is deliberately NO column for a subject id, a context
-- manifest or its digest, a derived identity, an execution digest, a surface result, query rows, a
-- metric value, a role, a principal, an authority or disclosure decision, action or approval state,
-- or a provider result. The forbidden content is UNREPRESENTABLE here rather than merely unwritten —
-- the same discipline that kept a URL out of Slice 4's request shape.
--
-- Also deliberately absent: revision/supersession columns, soft-delete state, sharing state, and any
-- generic metadata JSON escape hatch. Each would be a product decision this slice has not made, and
-- an escape hatch is how a closed schema stops being closed.

-- ── 1. The table ─────────────────────────────────────────────────────────────────────────────────
create table if not exists pinned_surface_definitions (
  id                        uuid primary key default gen_random_uuid(),
  -- The owning tenant. This is the RLS boundary, and the only boundary the DATABASE enforces.
  org_id                    uuid not null references organizations(id) on delete cascade,
  -- Creator attribution. This is the APPLICATION-layer visibility boundary, and it is deliberately
  -- NOT an RLS predicate: under the deployed runtime the application connects as `app_rw` with the
  -- `app.org_id` GUC set, so `auth.uid()` is not the acting identity on that path and a
  -- `created_by_user_id = auth.uid()` policy would reject every legitimate request. Creator privacy
  -- is therefore enforced in one narrow repository, and this comment exists so nobody later reads
  -- this column as a database-enforced guarantee.
  created_by_user_id        uuid not null,
  -- Mutable display metadata. Renaming never changes the definition bytes or its digest.
  name                      text not null check (length(btrim(name)) between 1 and 120),
  -- The closed persisted-definition schema version, so a stored row can always be interpreted.
  definition_schema_version integer not null check (definition_schema_version >= 1),
  -- The canonical PersistedSurfaceDefinition. Validated against the closed schema before insert and
  -- again after load — a stored definition is untrusted input on the way back out.
  definition                jsonb not null,
  -- Definition identity, domain-separated from execution identity. Stable across executions and
  -- across renames; it changes only when the definition changes.
  definition_digest         text not null check (definition_digest ~ '^[0-9a-f]{16}$'),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

comment on table pinned_surface_definitions is
  'P7 Slice 12 — persisted Dynamic Surface DEFINITIONS. Persist the question, never the answer or the authority.';
comment on column pinned_surface_definitions.created_by_user_id is
  'Application-layer visibility boundary. NOT an RLS predicate — see the migration header.';

-- One name per creator per org, so "save" is idempotent from the product's point of view and a
-- duplicate pin is a rename rather than a second row nobody can tell apart.
create unique index if not exists pinned_surface_definitions_owner_name
  on pinned_surface_definitions (org_id, created_by_user_id, lower(btrim(name)));

create index if not exists pinned_surface_definitions_owner
  on pinned_surface_definitions (org_id, created_by_user_id, created_at desc);

-- ── 2. Grants — minimum sufficient ───────────────────────────────────────────────────────────────
-- 0058's default privileges hand app_rw full DML on every new table. A pin is created, renamed and
-- hard-deleted by its owner, so all four are legitimate here — stated explicitly rather than
-- inherited silently, so the intent is readable.
grant select, insert, update, delete on pinned_surface_definitions to app_rw;

-- ── 3. RLS — ENABLE + FORCE, the certified org-membership pattern ────────────────────────────────
-- Organization isolation, and nothing more. Creator visibility is the repository's job (§1).
alter table pinned_surface_definitions enable row level security;
alter table pinned_surface_definitions force row level security;
drop policy if exists pinned_surface_definitions_rw on pinned_surface_definitions;
create policy pinned_surface_definitions_rw on pinned_surface_definitions for all to app_rw
  using (is_org_member(org_id)) with check (is_org_member(org_id));
