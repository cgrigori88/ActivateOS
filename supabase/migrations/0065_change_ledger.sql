-- 0065: Universal, append-only Change Ledger (Workstream A). A core product
-- primitive (§13), not just audit: powers What Changed?, Today, agent reasoning,
-- learning, state reconstruction. §14 separates ACTOR (who) from TRIGGER (cause);
-- §15 uses a 4-level materiality.

create table if not exists change_ledger (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  pursuit_id      uuid references pursuits(id) on delete cascade,   -- nullable: account/other-entity changes
  entity_type     text not null,        -- 'pursuit'|'account'|'fact'|'score'|'motion'|'partner_route'|'seller_route'|'team'|'opportunity'|'relationship'|'campaign'
  entity_id       uuid,
  change_type     text not null check (change_type in
    ('PURSUIT_CREATED','PURSUIT_MIGRATED','STATUS_CHANGED','SCORE_CHANGED','TIMING_CHANGED',
     'FACT_PROMOTED','FACT_SUPERSEDED','CONTRADICTION_DETECTED','PARTNER_ROUTE_CHANGED',
     'SELLER_ROUTE_CHANGED','TEAM_CHANGED','MOTION_CHANGED','ACTION_CREATED','ACTION_COMPLETED',
     'CUSTOMER_ENGAGED','OPPORTUNITY_LINKED','OUTCOME_RECORDED','PURSUIT_MERGED','PURSUIT_SPLIT',
     'OVERRIDE_RECORDED','EXPECTED_VALUE_CHANGED')),
  before_state    jsonb,
  after_state     jsonb,
  materiality     text not null default 'MEDIUM' check (materiality in ('LOW','MEDIUM','HIGH','CRITICAL')),
  reason          text,
  -- §14: actor (who/what performed) is DISTINCT from trigger (what caused it).
  actor_type      text check (actor_type in ('USER','AGENT','WORKER','SYSTEM','IMPORT','API')),
  actor_id        uuid,
  trigger_type    text check (trigger_type in
    ('EVIDENCE_VERIFIED','FACT_PROMOTED','INTERACTION_RECEIVED','SCHEDULED_REFRESH','USER_OVERRIDE',
     'CRM_SYNC','PARTNER_DECISION','MODEL_RECALCULATION','MIGRATION','MANUAL','CONTRADICTION')),
  trigger_id      uuid,
  model_version   text,
  agent_run_id    uuid references agent_runs(id) on delete set null,
  data_environment text not null default 'PRODUCTION',
  occurred_at     timestamptz not null default now(),   -- business time of the change
  recorded_at     timestamptz not null default now()    -- when PursuitOS wrote it
);
create index if not exists change_ledger_pursuit  on change_ledger (pursuit_id, occurred_at desc);
create index if not exists change_ledger_org_type on change_ledger (org_id, change_type, occurred_at desc);
create index if not exists change_ledger_material on change_ledger (org_id, materiality, occurred_at desc)
  where materiality in ('HIGH','CRITICAL');

grant select, insert, update, delete on change_ledger to app_rw;
alter table change_ledger enable row level security;
drop policy if exists change_ledger_rw on change_ledger;
create policy change_ledger_rw on change_ledger for all to app_rw
  using (is_org_member(org_id)) with check (is_org_member(org_id));
