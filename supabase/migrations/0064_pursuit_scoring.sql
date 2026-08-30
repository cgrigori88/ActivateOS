-- 0064: Versioned, append-only Pursuit scoring (Workstream A). Authoritative score
-- history lives here; pursuits.current_* is a cache. §8 atomicity + §9 single-current
-- + §10 contribution lineage + §11 feature_observed_at (as-of / leakage prevention).

create table if not exists pursuit_score_snapshots (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  pursuit_id        uuid not null references pursuits(id) on delete cascade,
  score_version_id  uuid not null references score_versions(id),
  seq               int not null,               -- monotonic per pursuit (v1, v2, …)
  computed_at       timestamptz not null default now(),
  as_of             timestamptz not null default now(),  -- the time the features were eligible up to
  is_current        boolean not null default true,
  data_environment  text not null default 'PRODUCTION',
  unique (pursuit_id, seq)
);
-- Exactly one current snapshot per pursuit (§9 hard invariant, enforced by the DB).
create unique index if not exists pursuit_snapshot_one_current
  on pursuit_score_snapshots (pursuit_id) where is_current;
create index if not exists pursuit_snapshot_pursuit on pursuit_score_snapshots (pursuit_id, seq desc);

create table if not exists pursuit_score_dimensions (
  snapshot_id uuid not null references pursuit_score_snapshots(id) on delete cascade,
  dimension   text not null check (dimension in
    ('purchase_propensity','evidence_confidence','timing','solution_fit',
     'partner_activation','seller_activation','pursuit_priority')),
  value       numeric not null,
  band        text check (band in ('very_high','high','medium','low')),
  primary key (snapshot_id, dimension)
);

create table if not exists pursuit_score_contributions (
  id                  uuid primary key default gen_random_uuid(),
  snapshot_id         uuid not null references pursuit_score_snapshots(id) on delete cascade,
  dimension           text not null,
  feature_name        text not null,
  provenance_type     text,                    -- source class of the driving evidence/fact (§10)
  raw_value           numeric,
  normalized_value    numeric,
  weight              numeric,
  contribution        numeric not null,        -- signed points (e.g. +14, -7)
  evidence_reference  uuid,                    -- soft ref to evidence/fact/relationship/transaction signal
  reference_kind      text,                    -- 'evidence'|'fact'|'signal'|'relationship'|'transaction_signal'|'reference'
  feature_observed_at timestamptz,             -- as-of eligibility (§11). null only for timeless reference metadata.
  calculated_at       timestamptz not null default now()
);
create index if not exists pursuit_contrib_snapshot on pursuit_score_contributions (snapshot_id, dimension);

-- Deferred FK from pursuits → current snapshot (created here so both tables exist).
alter table pursuits
  drop constraint if exists pursuits_current_snapshot_fk;
alter table pursuits
  add constraint pursuits_current_snapshot_fk
  foreign key (current_score_snapshot_id) references pursuit_score_snapshots(id) on delete set null;

-- RLS. Snapshots carry org_id (direct policy). Dimensions/contributions scope through
-- their snapshot → pursuit → org (child pattern, 0061).
grant select, insert, update, delete on pursuit_score_snapshots, pursuit_score_dimensions, pursuit_score_contributions to app_rw;

alter table pursuit_score_snapshots enable row level security;
drop policy if exists pursuit_score_snapshots_rw on pursuit_score_snapshots;
create policy pursuit_score_snapshots_rw on pursuit_score_snapshots for all to app_rw
  using (is_org_member(org_id)) with check (is_org_member(org_id));

alter table pursuit_score_dimensions enable row level security;
drop policy if exists pursuit_score_dimensions_rw on pursuit_score_dimensions;
create policy pursuit_score_dimensions_rw on pursuit_score_dimensions for all to app_rw
  using (exists (select 1 from pursuit_score_snapshots s where s.id = snapshot_id and is_org_member(s.org_id)))
  with check (exists (select 1 from pursuit_score_snapshots s where s.id = snapshot_id and is_org_member(s.org_id)));

alter table pursuit_score_contributions enable row level security;
drop policy if exists pursuit_score_contributions_rw on pursuit_score_contributions;
create policy pursuit_score_contributions_rw on pursuit_score_contributions for all to app_rw
  using (exists (select 1 from pursuit_score_snapshots s where s.id = snapshot_id and is_org_member(s.org_id)))
  with check (exists (select 1 from pursuit_score_snapshots s where s.id = snapshot_id and is_org_member(s.org_id)));
