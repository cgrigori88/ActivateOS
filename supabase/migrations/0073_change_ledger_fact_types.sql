-- 0073: Extend the change_ledger change_type vocabulary with the Workstream B Fact events
-- (§26). Additive — the column stays text; we only widen the CHECK. Flat + idempotent.

alter table change_ledger drop constraint if exists change_ledger_change_type_check;
alter table change_ledger add constraint change_ledger_change_type_check
  check (change_type in (
    'PURSUIT_CREATED','PURSUIT_MIGRATED','STATUS_CHANGED','SCORE_CHANGED','TIMING_CHANGED',
    'FACT_PROMOTED','FACT_SUPERSEDED','CONTRADICTION_DETECTED','PARTNER_ROUTE_CHANGED',
    'SELLER_ROUTE_CHANGED','TEAM_CHANGED','MOTION_CHANGED','ACTION_CREATED','ACTION_COMPLETED',
    'CUSTOMER_ENGAGED','OPPORTUNITY_LINKED','OUTCOME_RECORDED','PURSUIT_MERGED','PURSUIT_SPLIT',
    'OVERRIDE_RECORDED','EXPECTED_VALUE_CHANGED',
    -- Workstream B — Facts / Intelligence
    'FACT_CANDIDATE_CREATED','FACT_CONFIDENCE_CHANGED','FACT_DISPUTED','FACT_STALE','FACT_EXPIRED',
    'FACT_REJECTED','FACT_LINKED_TO_PURSUIT','CONVERGENCE_CHANGED','WHY_NOW_CHANGED'
  ));
