-- 0063: Pursuit domain model — the canonical commercial object (Workstream A).
-- Additive + inert: nothing legacy reads this until PURSUITS_ENABLED. companies and
-- products are GLOBAL reference tables (no org_id); a Pursuit is org-scoped via its
-- own org_id. Identity is the commercial THESIS (org × account × product/category ×
-- type × use_case), NOT the partner/seller/timing route (those are mutable).

create table if not exists pursuits (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references organizations(id) on delete cascade,
  account_id                uuid not null references companies(id) on delete cascade,
  product_id                uuid references products(id) on delete set null,
  product_category_id       uuid references taxonomy_nodes(id) on delete set null,

  -- Commercial thesis identity (§2): a normalized, controlled discriminator so two
  -- legitimately different theses on the same account/product/type can coexist.
  pursuit_type              text not null default 'UNCLASSIFIED'
    check (pursuit_type in ('NET_NEW','CROSS_SELL','UPSELL','RENEWAL_ATTACH','EXPANSION',
                            'COMPETITIVE_DISPLACEMENT','MIGRATION','WIN_BACK','CONSOLIDATION',
                            'MODERNIZATION','OTHER','UNCLASSIFIED')),
  pursuit_type_source       text check (pursuit_type_source in
                            ('LEGACY_MOTION_TYPE','LEGACY_OPPORTUNITY','PRODUCT_RELATION','RENEWAL_FLAG',
                             'TEXT_INFERENCE','HUMAN','AGENT','DEFAULT')),
  pursuit_type_confidence   text check (pursuit_type_confidence in ('HIGH','MEDIUM','LOW')),
  use_case                  text,          -- normalized controlled token (e.g. 'infra_ops','network_automation')
  business_problem          text,
  compelling_event          text,
  why_now                   jsonb,         -- structured Why-Now (Workstream B authors)
  timing_window             text check (timing_window in ('0-90d','3-6m','6-12m','12-24m','unknown')),

  status                    text not null default 'DETECTED'
    check (status in ('DETECTED','RESEARCHING','REVIEW_REQUIRED','QUALIFIED','ROUTED',
                      'MOTION_DESIGNED','READY_TO_ACTIVATE','ACTIVATING','ACTIVE','CUSTOMER_ENGAGED',
                      'OPPORTUNITY_CREATED','WON','LOST','DORMANT','DISQUALIFIED')),

  -- Cached current scores (projection of current_score_snapshot_id; NOT authoritative). §7
  current_priority_score            numeric check (current_priority_score between 0 and 100),
  current_purchase_propensity_score numeric,
  current_evidence_confidence_score numeric,
  current_timing_score              numeric,
  current_solution_fit_score        numeric,
  current_partner_activation_score  numeric,
  current_seller_activation_score   numeric,
  current_score_snapshot_id         uuid,  -- FK added in 0064

  -- Expected value with provenance (§32)
  expected_value_low        numeric,
  expected_value_high       numeric,
  expected_value_weighted   numeric,
  expected_value_currency   text not null default 'USD',
  expected_value_method     text check (expected_value_method in
                            ('CRM','HEURISTIC','SELLER_SUPPLIED','MODEL','TRANSACTION_ESTIMATE','UNKNOWN')),

  -- Recommendation vs decision (§19) — AI never silently becomes the human decision.
  recommended_partner_id        uuid references partners(id) on delete set null,
  selected_partner_id           uuid references partners(id) on delete set null,
  recommended_vendor_seller_id  uuid references sellers(id) on delete set null,
  selected_vendor_seller_id     uuid references sellers(id) on delete set null,
  recommended_partner_seller_id uuid references sellers(id) on delete set null,
  selected_partner_seller_id    uuid references sellers(id) on delete set null,
  recommended_motion_id         uuid references revenue_motions(id) on delete set null,
  approved_motion_id            uuid references revenue_motions(id) on delete set null,
  recommended_timing_window     text,
  accepted_timing_window        text,

  -- Identity / dedup / merge / split (§J, §4)
  dedup_key                 text not null,
  strategic_initiative      text,
  merged_into_pursuit_id    uuid references pursuits(id) on delete set null,
  split_from_pursuit_id     uuid references pursuits(id) on delete set null,

  -- Source lineage / creation provenance (§30-31). "Why does this Pursuit exist?"
  created_by_actor_type     text not null default 'system'
                            check (created_by_actor_type in ('system','agent','human','import','api')),
  created_by_actor_id       uuid,
  created_via               text not null default 'SYSTEM_DETECTED'
                            check (created_via in ('SYSTEM_DETECTED','USER_CREATED','MOTION_MIGRATION',
                             'OPPORTUNITY_MIGRATION','IMPORT','API','AGENT_PROPOSED','PARTNER_PROPOSED')),
  originating_signal_id     uuid,
  originating_fact_id       uuid,
  originating_evidence_id   uuid,
  originating_motion_id     uuid references revenue_motions(id) on delete set null,
  originating_import_id     uuid,
  originating_agent_run_id  uuid references agent_runs(id) on delete set null,

  -- Data lineage / synthetic isolation (§29) — extensible enum.
  data_environment          text not null default 'PRODUCTION'
                            check (data_environment in ('PRODUCTION','DEMO','TEST','SYNTHETIC','SIMULATION','BACKTEST')),
  data_lineage              text check (data_lineage in
                            ('VERIFIED_PUBLIC','AUTHORIZED_FIRST_PARTY','SIMULATED','SYNTHETIC')),
  is_simulated              boolean not null default false,

  first_detected_at         timestamptz not null default now(),
  last_material_change_at    timestamptz not null default now(),
  next_action_at            timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- Active-identity uniqueness. LIVE states (incl. DORMANT, §3) share the dedup slot;
-- terminal (WON/LOST/DISQUALIFIED) and merged pursuits do NOT block a new thesis.
create unique index if not exists pursuits_active_dedup
  on pursuits (org_id, dedup_key)
  where status not in ('WON','LOST','DISQUALIFIED') and merged_into_pursuit_id is null;

create index if not exists pursuits_org_status   on pursuits (org_id, status);
create index if not exists pursuits_org_account  on pursuits (org_id, account_id);
create index if not exists pursuits_org_priority  on pursuits (org_id, current_priority_score desc nulls last);
create index if not exists pursuits_next_action  on pursuits (org_id, next_action_at) where next_action_at is not null;
create index if not exists pursuits_env          on pursuits (data_environment) where data_environment <> 'PRODUCTION';
create index if not exists pursuits_merged        on pursuits (merged_into_pursuit_id) where merged_into_pursuit_id is not null;

-- RLS (explicit — post-dates 0058's data-driven loop). app_rw grant + tenant policy.
grant select, insert, update, delete on pursuits to app_rw;
alter table pursuits enable row level security;
drop policy if exists pursuits_rw on pursuits;
create policy pursuits_rw on pursuits for all to app_rw
  using (is_org_member(org_id)) with check (is_org_member(org_id));
