-- 0095: Idempotency key for the canonical outcome bridge (Phase B). A single legacy commercial
-- system event (an opportunity close, a motion completion, an opportunity creation) must produce at
-- most ONE canonical pursuit_outcome, even under webhook/import/worker retry or a duplicate external
-- id. `source_ref` carries a deterministic key derived from the originating event
-- (e.g. 'opp:<id>:CLOSED_WON'); a partial unique index enforces one outcome per key. NULL source_ref
-- (script/demo seeds that don't bridge) is unaffected — the partial index only covers non-null keys.

alter table pursuit_outcomes add column if not exists source_ref text;

create unique index if not exists pursuit_outcomes_source_ref
  on pursuit_outcomes (org_id, source_ref) where source_ref is not null;
