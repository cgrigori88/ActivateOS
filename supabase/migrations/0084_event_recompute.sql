-- 0084: Workstream E3-E — event-driven recompute engine.
--
-- The reactive half of the loop the mapping found missing: a material event
-- deterministically enqueues the recomputations it invalidates, which run at the
-- event's as-of (R12) and produce new append-only snapshots (R13 — history is
-- never rewritten). Adds the E change types + an EVENT_TRIGGERED trigger, and the
-- recompute-intent queue carrying the triggering event's occurred_at as the as-of
-- stamp. Additive; recompute stays opt-in (the worker drain, dark until enabled).

set check_function_bodies = off;

-- Widen change_ledger.change_type to the full superset (0065+0073+0079 + E).
alter table change_ledger drop constraint if exists change_ledger_change_type_check;
alter table change_ledger add constraint change_ledger_change_type_check check (change_type in (
  -- 0065
  'PURSUIT_CREATED','PURSUIT_MIGRATED','STATUS_CHANGED','SCORE_CHANGED','TIMING_CHANGED',
  'FACT_PROMOTED','FACT_SUPERSEDED','CONTRADICTION_DETECTED','PARTNER_ROUTE_CHANGED','SELLER_ROUTE_CHANGED',
  'TEAM_CHANGED','MOTION_CHANGED','ACTION_CREATED','ACTION_COMPLETED','CUSTOMER_ENGAGED','OPPORTUNITY_LINKED',
  'OUTCOME_RECORDED','PURSUIT_MERGED','PURSUIT_SPLIT','OVERRIDE_RECORDED','EXPECTED_VALUE_CHANGED',
  -- 0073
  'FACT_CANDIDATE_CREATED','FACT_CONFIDENCE_CHANGED','FACT_DISPUTED','FACT_STALE','FACT_EXPIRED','FACT_REJECTED',
  'FACT_LINKED_TO_PURSUIT','CONVERGENCE_CHANGED','WHY_NOW_CHANGED',
  -- 0079
  'ROUTE_RECOMMENDATION_CHANGED','PARTNER_SELECTED','PARTNER_OVERRIDE','SELLER_RECOMMENDATION_CHANGED',
  'SELLER_ASSIGNED','PARTNER_DECLINED','ROUTE_OUTCOME_RECORDED','TEAM_MEMBER_INVITED','TEAM_MEMBER_ACCEPTED',
  'TEAM_MEMBER_DECLINED','ENTITY_RESOLUTION_REVIEW','TRANSACTION_SIGNAL_INGESTED',
  -- E3 additions
  'FACT_ACCEPTED','ROUTE_SELECTED','PARTICIPANT_INVITED','PARTICIPANT_JOINED','PARTICIPANT_LEFT',
  'PARTICIPANT_DECLINED','PARTICIPANT_REVOKED','ACCESS_GRANTED','ACCESS_REVOKED','TEAM_MEMBER_ASSIGNED',
  'INTRO_REQUESTED','INTRO_ACCEPTED','OUTREACH_SENT','REPLY_RECEIVED','MEETING_BOOKED','OPPORTUNITY_CREATED',
  'STAGE_CHANGED','PURSUIT_WON','PURSUIT_LOST','PURSUIT_DORMANT','READINESS_CHANGED','ACTION_INVOKED',
  'ACTION_EXECUTED','CONTRIBUTION_ADDED','CONTRIBUTION_REVOKED'
));

-- Add EVENT_TRIGGERED + GOVERNED_ACTION triggers.
alter table change_ledger drop constraint if exists change_ledger_trigger_type_check;
alter table change_ledger add constraint change_ledger_trigger_type_check check (trigger_type is null or trigger_type in (
  'EVIDENCE_VERIFIED','FACT_PROMOTED','INTERACTION_RECEIVED','SCHEDULED_REFRESH','USER_OVERRIDE','CRM_SYNC',
  'PARTNER_DECISION','MODEL_RECALCULATION','MIGRATION','MANUAL','CONTRADICTION','EVENT_TRIGGERED','GOVERNED_ACTION'
));

-- Recompute-intent queue. Carries the TRIGGERING EVENT's occurred_at as the as-of
-- stamp so recompute reconstructs as of that event, never now() (R12). Idempotent
-- and loop-guarded (R23).
create table if not exists recompute_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  pursuit_id uuid not null references pursuits(id) on delete cascade,
  change_type text not null,
  target text not null check (target in ('SCORE','ROUTE','READINESS','TODAY','WHY_NOW')),
  as_of timestamptz not null,
  requested_by_event_id uuid,
  causation_id uuid,
  correlation_id uuid,
  status text not null default 'PENDING'
    check (status in ('PENDING','RUNNING','DONE','FAILED','SUPPRESSED')),
  attempts int not null default 0,
  reason text,
  data_environment text not null default 'PRODUCTION',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists recompute_requests_pending on recompute_requests (status, created_at);
create index if not exists recompute_requests_pursuit on recompute_requests (pursuit_id, target);

grant select, insert, update, delete on recompute_requests to app_rw;
alter table recompute_requests enable row level security;
drop policy if exists recompute_requests_rw on recompute_requests;
create policy recompute_requests_rw on recompute_requests for all to app_rw
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
