-- 0074: Route decision core (Workstream C, §1-14). The durable, versioned, explainable
-- route-decision spine that sits between Pursuit Intelligence and execution. A route is a
-- PATH through organizations (§2), not a single partner_id. Snapshots are append-only and
-- reconstructable; the pursuits.recommended_*/selected_* columns remain current-state caches.
-- Recommendation is kept distinct from selection throughout (§1). Flat SQL — paste-safe.

create table if not exists pursuit_route_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  pursuit_id         uuid not null references pursuits(id) on delete cascade,
  seq                integer not null,
  is_current         boolean not null default true,
  as_of              timestamptz not null,
  calculated_at      timestamptz not null default now(),
  route_topology     text not null default 'PARTNER_LED' check (route_topology in
                       ('DIRECT','PARTNER_LED','DISTRIBUTOR_LED','JOINT','MULTI_PARTNER')),
  recommended_partner_id        uuid references partners(id) on delete set null,
  selected_partner_id           uuid references partners(id) on delete set null,
  recommended_distributor_id    uuid references partners(id) on delete set null,
  selected_distributor_id       uuid references partners(id) on delete set null,
  recommended_vendor_seller_id  uuid references sellers(id) on delete set null,
  selected_vendor_seller_id     uuid references sellers(id) on delete set null,
  recommended_partner_seller_id uuid references sellers(id) on delete set null,
  selected_partner_seller_id    uuid references sellers(id) on delete set null,
  route_score        numeric,              -- best candidate's total (0..100)
  route_confidence   numeric,              -- DISTINCT from score: data completeness driven (§9/§10)
  route_status       text not null default 'PROPOSED' check (route_status in
                       ('PROPOSED','REVIEW_REQUIRED','RECOMMENDED','SELECTED','DECLINED','REROUTE_REQUIRED','SUPERSEDED')),
  route_model_version text not null default 'route-v1-rules',
  partner_fit_version text,
  seller_fit_version  text,
  created_by_actor_type text, created_by_actor_id uuid,
  data_environment   text not null default 'PRODUCTION',
  is_simulated       boolean not null default false,
  created_at         timestamptz not null default now(),
  unique (pursuit_id, seq)
);
create unique index if not exists route_snapshots_one_current on pursuit_route_snapshots (pursuit_id) where is_current;
create index if not exists route_snapshots_pursuit on pursuit_route_snapshots (org_id, pursuit_id);

create table if not exists route_candidates (
  id                 uuid primary key default gen_random_uuid(),
  route_snapshot_id  uuid not null references pursuit_route_snapshots(id) on delete cascade,
  org_id             uuid not null references organizations(id) on delete cascade,
  partner_id         uuid references partners(id) on delete set null,
  distributor_id     uuid references partners(id) on delete set null,
  route_topology     text not null default 'PARTNER_LED',
  rank               integer not null,
  is_recommended     boolean not null default false,
  is_selected        boolean not null default false,
  total_score        numeric,              -- route score for this candidate
  partner_activation_score numeric,        -- how strong THIS partner is for THIS pursuit (§7, distinct from route score)
  suitability_score  numeric,              -- structural quality (§8)
  activation_readiness_score numeric,      -- can it execute NOW (§8)
  candidate_confidence numeric,
  disqualified       boolean not null default false,   -- true if a HARD disqualifier applied
  created_at         timestamptz not null default now()
);
create index if not exists route_candidates_snapshot on route_candidates (route_snapshot_id, rank);

-- Explainable dimension contributions per candidate (§6) — mirrors the pursuit score contract.
create table if not exists route_candidate_dimensions (
  id                 uuid primary key default gen_random_uuid(),
  candidate_id       uuid not null references route_candidates(id) on delete cascade,
  dimension          text not null,        -- account_relationship, product_capability, historical_performance, ...
  raw_value          numeric,
  normalized_value   numeric,
  weight             numeric,
  contribution       numeric,
  source             text,                 -- 'partner_fit'|'relationship'|'transaction'|'territory'|'outcome'
  feature_observed_at timestamptz,         -- as-of eligibility (§43)
  model_version      text
);
create index if not exists route_candidate_dimensions_candidate on route_candidate_dimensions (candidate_id);

-- Structured explanation lines, every one id-referenced + disclosure-classified (§12/§33/§49).
create table if not exists route_candidate_reasons (
  id                 uuid primary key default gen_random_uuid(),
  candidate_id       uuid not null references route_candidates(id) on delete cascade,
  org_id             uuid not null references organizations(id) on delete cascade,
  reason_code        text not null,
  polarity           smallint not null default 1 check (polarity in (-1,1)),
  weight             numeric,
  detail             text,
  ref_type           text,                 -- 'fact'|'relationship'|'capability'|'transaction'|'seller'|'territory'|'warm_intro'|'outcome'
  ref_id             uuid,
  disclosure_class   text not null default 'INTERNAL' check (disclosure_class in
                       ('PUBLIC','INTERNAL','PARTNER_SHARED','TRANSACTION_CONFIDENTIAL','PII','RESTRICTED')),
  created_at         timestamptz not null default now()
);
create index if not exists route_candidate_reasons_candidate on route_candidate_reasons (candidate_id);

-- Disqualifiers with severity + provenance (§11/§12).
create table if not exists route_candidate_disqualifiers (
  id                 uuid primary key default gen_random_uuid(),
  candidate_id       uuid not null references route_candidates(id) on delete cascade,
  code               text not null,        -- NO_REQUIRED_CAPABILITY, OUTSIDE_TERRITORY, PARTNER_DECLINED, ...
  severity           text not null check (severity in ('HARD','SOFT')),
  ref_type           text, ref_id uuid, detail text
);
create index if not exists route_candidate_disqualifiers_candidate on route_candidate_disqualifiers (candidate_id);

-- Multi-party route topology graph with explicit ordering (§3/§40).
create table if not exists pursuit_route_participants (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  pursuit_id         uuid not null references pursuits(id) on delete cascade,
  route_snapshot_id  uuid references pursuit_route_snapshots(id) on delete cascade,
  organization_id    uuid,
  partner_id         uuid references partners(id) on delete set null,
  distributor_id     uuid references partners(id) on delete set null,
  participant_role   text not null check (participant_role in ('VENDOR','DISTRIBUTOR','RESELLER','PARTNER','CUSTOMER')),
  sequence           integer not null,
  status             text not null default 'PROPOSED',
  created_at         timestamptz not null default now()
);
create index if not exists route_participants_snapshot on pursuit_route_participants (route_snapshot_id, sequence);

-- RLS: org-scoped parents; children scoped via their snapshot/candidate parent.
grant select, insert, update, delete on pursuit_route_snapshots, route_candidates, route_candidate_dimensions, route_candidate_reasons, route_candidate_disqualifiers, pursuit_route_participants to app_rw;
alter table pursuit_route_snapshots enable row level security;
alter table route_candidates enable row level security;
alter table route_candidate_dimensions enable row level security;
alter table route_candidate_reasons enable row level security;
alter table route_candidate_disqualifiers enable row level security;
alter table pursuit_route_participants enable row level security;
drop policy if exists route_snapshots_rw on pursuit_route_snapshots;
create policy route_snapshots_rw on pursuit_route_snapshots for all to app_rw using (is_org_member(org_id)) with check (is_org_member(org_id));
drop policy if exists route_candidates_rw on route_candidates;
create policy route_candidates_rw on route_candidates for all to app_rw using (is_org_member(org_id)) with check (is_org_member(org_id));
drop policy if exists route_candidate_dimensions_rw on route_candidate_dimensions;
create policy route_candidate_dimensions_rw on route_candidate_dimensions for all to app_rw
  using (exists (select 1 from route_candidates c where c.id = candidate_id and is_org_member(c.org_id)))
  with check (exists (select 1 from route_candidates c where c.id = candidate_id and is_org_member(c.org_id)));
drop policy if exists route_candidate_reasons_rw on route_candidate_reasons;
create policy route_candidate_reasons_rw on route_candidate_reasons for all to app_rw using (is_org_member(org_id)) with check (is_org_member(org_id));
drop policy if exists route_candidate_disqualifiers_rw on route_candidate_disqualifiers;
create policy route_candidate_disqualifiers_rw on route_candidate_disqualifiers for all to app_rw
  using (exists (select 1 from route_candidates c where c.id = candidate_id and is_org_member(c.org_id)))
  with check (exists (select 1 from route_candidates c where c.id = candidate_id and is_org_member(c.org_id)));
drop policy if exists route_participants_rw on pursuit_route_participants;
create policy route_participants_rw on pursuit_route_participants for all to app_rw using (is_org_member(org_id)) with check (is_org_member(org_id));
