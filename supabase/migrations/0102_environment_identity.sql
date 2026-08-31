-- Environment identity — the guardrail that lives WITH the data.
--
-- The three-environment topology (public / app / demo) runs one codebase against
-- separate databases. The failure this table exists to prevent is the ordinary
-- one: a demo reseed pointed at the production connection string, because the
-- operator's shell still had it exported.
--
-- An environment variable cannot prevent that — it is exactly the thing that was
-- wrong. So the assertion is made against a row INSIDE the database being
-- written to. A reseed asks "what are you?" and the answer comes from the target
-- itself. Point it at production and production answers truthfully.
--
-- Deliberately unlike every other table here: NOT tenant-scoped. It describes
-- the database, not an org, so it has no org_id and no tenant policy. RLS is on
-- and readable by all app roles because it carries no commercial data — only a
-- label the tooling checks before it is allowed to destroy anything.

create table if not exists environment_identity (
  -- Enforces exactly one row: the primary key can only ever hold `true`.
  -- A database has one identity; a second row would mean the guard has to pick,
  -- and a guard that picks is a guard that can pick wrong.
  singleton      boolean primary key default true constraint environment_identity_singleton check (singleton),

  environment    text        not null check (environment in ('app', 'demo', 'local')),

  -- The load-bearing flag. TRUE means: every row in this database is synthetic
  -- and may be destroyed. It is separate from `environment` on purpose — being
  -- labelled 'demo' is a claim about intent, while this is a claim about the
  -- DATA. Destructive tooling checks this one.
  is_synthetic   boolean     not null,

  -- Free-text, for humans reading an operator surface ("TD SYNNEX walkthrough
  -- demo, ca-central-1"). Never parsed, never used for a decision.
  label          text        not null default '',

  established_at timestamptz not null default now(),

  -- 'app' must never be marked synthetic: that combination is precisely the
  -- misconfiguration that would authorise wiping production. Rejected by the
  -- database so no deploy, script or human can assert it.
  constraint environment_identity_app_is_never_synthetic
    check (not (environment = 'app' and is_synthetic))
);

alter table environment_identity enable row level security;
alter table environment_identity force row level security;

-- Readable by the application roles; writable by nobody through RLS. Establishing
-- or changing a database's identity is a deliberate operator act performed with
-- owner credentials (scripts/environment-identity.ts), not something the running
-- application can do to itself.
drop policy if exists environment_identity_read on environment_identity;
create policy environment_identity_read on environment_identity
  for select using (true);

comment on table environment_identity is
  'Single-row description of THIS database. Destructive tooling asserts is_synthetic before writing. Not tenant-scoped.';
comment on column environment_identity.is_synthetic is
  'TRUE = every row here is synthetic and may be destroyed. Checked by reseed/reset tooling.';

-- No row is inserted here. An unmarked database is an UNKNOWN database, and the
-- guard treats unknown as "refuse" — so forgetting to run the marker step fails
-- closed. Seeding a default row would invert that into fail-open.
