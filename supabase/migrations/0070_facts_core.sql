-- 0070: Facts core (Workstream B, §1/§6-10/§27). Two tables by design:
--
--   fact_candidates — pre-promotion extraction output (the LLM/deterministic candidate
--     boundary). NOT durable truth. A candidate is never consumed as a Fact.
--   facts           — durable commercial beliefs. History-oriented: nothing is hard-
--     deleted; supersession/expiry transition rows, never erase them.
--
-- A Fact is a normalized proposition: subject_scope · subject · predicate · typed object.
-- Identity is split (§8): fact_identity_key = the semantic SLOT (who+what property),
-- fact_value_key = the slot + normalized value. Competing values share the identity key
-- and compete/supersede; identical values dedupe on the value key.
--
-- Flat SQL (no DO/FOREACH) — paste-safe in the Supabase SQL editor.

-- ---------------------------------------------------------------------------
-- fact_candidates: extraction output awaiting the deterministic promotion gate.
-- ---------------------------------------------------------------------------
create table if not exists fact_candidates (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  company_id         uuid references companies(id) on delete cascade,
  subject_scope      text not null default 'COMPANY' check (subject_scope in
                       ('COMPANY','ACCOUNT','PRODUCT','TECHNOLOGY','PARTNER','SELLER','CONTACT','OPPORTUNITY','PURSUIT','RELATIONSHIP')),
  subject_ref        uuid,
  subject_label      text not null,
  predicate_key      text references fact_predicates(key),   -- NULL = unresolved predicate (cannot promote, §29)
  predicate_resolved boolean not null default false,
  object_type        text,
  object_value       jsonb not null default '{}',
  polarity           smallint not null default 1 check (polarity in (-1,1)),
  -- Computed identity keys (mirror facts.*), set at candidate creation so corroboration
  -- across sibling candidates for the same proposition is a simple equality lookup (§8).
  fact_identity_key  text,
  fact_value_key     text,
  -- Mandatory source span (§30/§31): a candidate with no supporting span cannot promote.
  source_evidence_id uuid references evidence(id) on delete cascade,
  source_signal_id   uuid references signals(id) on delete set null,
  source_span_start  integer,
  source_span_end    integer,
  quoted_excerpt     text,
  source_location    text,
  extraction_confidence numeric check (extraction_confidence between 0 and 1),
  extraction_reason  text,
  extracted_by       text not null default 'deterministic',  -- 'deterministic' | model id
  extracted_via      text not null default 'SIGNAL_MAP' check (extracted_via in
                       ('SIGNAL_MAP','EVIDENCE_LLM','IMPORT','HUMAN')),
  status             text not null default 'PENDING' check (status in
                       ('PENDING','REVIEW_REQUIRED','PROMOTED','REJECTED')),
  promoted_fact_id   uuid,                                   -- set on promotion (FK added in 0071)
  rejection_reason   text,
  data_environment   text not null default 'PRODUCTION',
  is_simulated       boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists fact_candidates_org_status on fact_candidates (org_id, status);
create index if not exists fact_candidates_company on fact_candidates (company_id);
create index if not exists fact_candidates_evidence on fact_candidates (source_evidence_id);
create index if not exists fact_candidates_value on fact_candidates (org_id, fact_value_key);

-- ---------------------------------------------------------------------------
-- facts: durable beliefs.
-- ---------------------------------------------------------------------------
create table if not exists facts (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,

  -- Subject (reusable across the Pursuit Context Graph, §9 — not company-only).
  subject_scope      text not null default 'COMPANY' check (subject_scope in
                       ('COMPANY','ACCOUNT','PRODUCT','TECHNOLOGY','PARTNER','SELLER','CONTACT','OPPORTUNITY','PURSUIT','RELATIONSHIP')),
  subject_ref        uuid,
  subject_label      text not null,
  company_id         uuid references companies(id) on delete cascade,   -- denormalized account context (nullable)

  predicate_key      text not null references fact_predicates(key),

  -- Typed value envelope (§10). object_value holds the canonical payload; the normalized
  -- columns below are promoted for typed indexing/queries.
  object_type        text not null check (object_type in
                       ('STRING','NUMBER','BOOLEAN','DATE','DATETIME','ENUM','ENTITY_REF','MONEY','PERCENTAGE','RANGE','JSON')),
  object_value       jsonb not null default '{}',
  date_value         timestamptz,
  number_value       numeric,
  text_value         text,
  boolean_value      boolean,
  entity_ref         uuid,
  money_amount       numeric,
  money_currency     text,
  polarity           smallint not null default 1 check (polarity in (-1,1)),

  -- Belief state (durable states only; CANDIDATE lives in fact_candidates).
  status             text not null default 'CURRENT' check (status in
                       ('CURRENT','DISPUTED','STALE','SUPERSEDED','EXPIRED','REJECTED')),
  confidence         numeric not null default 0 check (confidence between 0 and 1),
  confidence_model_version text,

  -- Provenance (§3/§5).
  provenance_class   text not null default 'THIRD_PARTY_UNVERIFIED' check (provenance_class in
                       ('FIRST_PARTY','SECOND_PARTY','THIRD_PARTY_VERIFIED','THIRD_PARTY_UNVERIFIED','INFERRED','CUSTOMER_DECLARED','HUMAN_ASSERTED')),
  origin_kind        text not null check (origin_kind in
                       ('EVIDENCE_PROMOTION','SIGNAL_PROMOTION','CONVERGENCE','HUMAN','IMPORT','AGENT_PROPOSED')),

  -- Temporal (§17) — distinct, not interchangeable.
  as_of              timestamptz not null,          -- belief anchor / as-of eligibility key
  valid_from         timestamptz,
  valid_until        timestamptz,
  occurred_at        timestamptz,
  observed_at        timestamptz not null,
  observed_first_at  timestamptz not null,          -- earliest supporting observation
  observed_last_at   timestamptz not null,          -- most recent supporting observation (freshness)
  ingested_at        timestamptz not null default now(),
  first_confirmed_at timestamptz,
  last_confirmed_at  timestamptz,

  -- Freshness (§16) — snapshot from the predicate at promotion, overridable.
  half_life_days     integer,
  freshness_policy   text not null default 'DECAYING',

  family             text,   -- convergence family (§9)

  -- Supersession (§7/§15) — separate from contradiction.
  superseded_by      uuid references facts(id) on delete set null,
  supersedes         uuid references facts(id) on delete set null,

  -- Identity (§8): slot vs value.
  fact_identity_key  text not null,   -- org|subject_scope|subject|predicate  (the SLOT)
  fact_value_key     text not null,   -- identity + normalized object          (the VALUE)

  -- Lineage (Workstream A contract).
  data_environment   text not null default 'PRODUCTION',
  data_lineage       jsonb,
  is_simulated       boolean not null default false,

  created_by_actor_type text, created_by_actor_id uuid, created_via text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  last_material_change_at timestamptz not null default now()
);

-- At most ONE believed value per semantic slot (§8).
create unique index if not exists facts_current_slot on facts (org_id, fact_identity_key)
  where status = 'CURRENT';
-- Dedup identical live values (idempotent promotion, §14).
create unique index if not exists facts_active_value on facts (org_id, fact_value_key)
  where status in ('CURRENT','DISPUTED','STALE') and superseded_by is null;

create index if not exists facts_company_status on facts (org_id, company_id, status);
create index if not exists facts_subject on facts (subject_scope, subject_ref);
create index if not exists facts_predicate on facts (predicate_key);
create index if not exists facts_review on facts (org_id) where status = 'DISPUTED';
create index if not exists facts_expiry on facts (valid_until) where status = 'CURRENT';
create index if not exists facts_superseded_by on facts (superseded_by);
create index if not exists facts_asof on facts (org_id, company_id, as_of desc);

-- ---------------------------------------------------------------------------
-- RLS: org-scoped, app_rw. (0058 pattern.)
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on fact_candidates to app_rw;
grant select, insert, update, delete on facts to app_rw;
alter table fact_candidates enable row level security;
alter table facts enable row level security;
drop policy if exists fact_candidates_rw on fact_candidates;
create policy fact_candidates_rw on fact_candidates for all to app_rw
  using (is_org_member(org_id)) with check (is_org_member(org_id));
drop policy if exists facts_rw on facts;
create policy facts_rw on facts for all to app_rw
  using (is_org_member(org_id)) with check (is_org_member(org_id));
