-- 0110 — P45-2: the approval lifecycle for the governed Pursuit Runtime (Slice 2).
--
-- WHAT THIS IS. `WAITING_FOR_APPROVAL` has been schema-legal on pursuit_runs and pursuit_run_steps
-- since 0109 but unreachable: `governed_skills.approval_required` is read nowhere, so nothing could
-- ever produce that state. This migration adds the one thing missing — a durable, append-only,
-- fully attributable record of an approval REQUEST and its single terminal DECISION.
--
-- WHY A NEW TABLE RATHER THAN REUSING governed_action_invocations.
--   • that table is ONE ROW PER INVOCATION and cannot hold a request→decision history;
--   • `app_rw` may UPDATE only `status` and `executed_at` on it — not `approved_at`, and there is no
--     `approved_by` column anywhere;
--   • its `REJECTED` already means POLICY REFUSED. A human declining is a different fact, and
--     conflating the two would destroy the audit distinction (owner ruling 2).
-- change_proposals (no org_id, model-governance) and review_queue (evidence) are different domains
-- and are deliberately NOT repurposed.
--
-- APPROVAL AUTHORIZES CONTINUATION. IT DOES NOT CONFER AUTHORITY. Nothing here grants a capability,
-- restores a revoked grant, reactivates a suspended actor, or relaxes tenancy. The runtime
-- re-evaluates every one of those immediately before continuing (the stale-authority rule).
--
-- NO SECURITY DEFINER. No RLS weakening. No change to existing privileges. The history table is
-- append-only: `app_rw` receives INSERT and SELECT and nothing else, matching the
-- pursuit_plan_revisions precedent for decision history.

-- ── 1. A composite key on steps, so approvals can reference them tenant-consistently ─────────────
-- 0109 gave governed_actors and pursuit_runs a (org_id, id) key; steps did not need one until now.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pursuit_run_steps_org_id_id_key'
                   and conrelid = 'pursuit_run_steps'::regclass) then
    alter table pursuit_run_steps add constraint pursuit_run_steps_org_id_id_key unique (org_id, id);
  end if;
end $$;

-- ── 2. The append-only approval lifecycle ────────────────────────────────────────────────────────
create table if not exists pursuit_run_approvals (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations(id) on delete cascade,
  pursuit_id            uuid not null references pursuits(id) on delete cascade,
  -- The pin travels with the approval: a decision is about THIS revision's action, nothing else.
  plan_revision_id      uuid not null references pursuit_plan_revisions(id) on delete cascade,
  run_id                uuid not null,
  run_step_id           uuid not null,
  skill_id              text not null,
  skill_version         integer not null default 1,
  -- REQUESTED opens the lifecycle. APPROVED/REJECTED are HUMAN decisions. INVALIDATED is
  -- SYSTEM-governed — authority disappeared while the request waited — and is never a human act.
  decision              text not null check (decision in ('REQUESTED','APPROVED','REJECTED','INVALIDATED')),
  -- Explicit request identity (owner amendment): a terminal row NAMES its request rather than being
  -- inferred from run_step_id or an idempotency key, and the request row is never mutated.
  request_id            uuid,
  requested_by_actor_id uuid,
  decided_by_actor_id   uuid,
  -- The SERVER-RESOLVED principal. Never client-supplied. Null in system INVALIDATED rows.
  decided_by_principal  uuid,
  reason                text,
  data_environment      text not null default 'PRODUCTION',
  created_at            timestamptz not null default now(),

  -- Shape. Each decision kind carries exactly the attribution it is entitled to.
  constraint pursuit_run_approvals_shape check (
    (decision = 'REQUESTED'
       and request_id is null and requested_by_actor_id is not null
       and decided_by_actor_id is null and decided_by_principal is null)
    or (decision in ('APPROVED','REJECTED')
       and request_id is not null and decided_by_actor_id is not null)
    -- INVALIDATED is system-governed: no deciding actor, and a reason is mandatory so the audit
    -- always says WHY authority lapsed (PLAN_SUPERSEDED, CAPABILITY_REVOKED, ACTOR_SUSPENDED, …).
    or (decision = 'INVALIDATED'
       and request_id is not null and decided_by_actor_id is null
       and decided_by_principal is null and reason is not null)
  ),
  -- The self-referential target that makes a terminal row provably share its request's context.
  constraint pursuit_run_approvals_ctx_key unique (id, org_id, run_id, run_step_id),
  -- A terminal decision MUST belong to the same org/run/step as the request it names. Enforced
  -- RELATIONALLY, not by application discipline.
  constraint pursuit_run_approvals_request_fk
    foreign key (request_id, org_id, run_id, run_step_id)
    references pursuit_run_approvals (id, org_id, run_id, run_step_id),
  constraint pursuit_run_approvals_run_fk
    foreign key (org_id, run_id) references pursuit_runs (org_id, id) on delete cascade,
  constraint pursuit_run_approvals_step_fk
    foreign key (org_id, run_step_id) references pursuit_run_steps (org_id, id) on delete cascade,
  constraint pursuit_run_approvals_actor_fk
    foreign key (org_id, requested_by_actor_id) references governed_actors (org_id, id),
  constraint pursuit_run_approvals_decider_fk
    foreign key (org_id, decided_by_actor_id) references governed_actors (org_id, id)
);

-- ONE open request per step. A second REQUESTED cannot exist while one is live.
create unique index if not exists pursuit_run_approvals_one_request
  on pursuit_run_approvals (org_id, run_step_id) where decision = 'REQUESTED';
-- AT MOST ONE terminal decision per request. THIS INDEX IS THE RACE ARBITER: two concurrent
-- approvers both insert, exactly one commits, the loser is told the request was already decided.
create unique index if not exists pursuit_run_approvals_one_terminal
  on pursuit_run_approvals (request_id) where decision <> 'REQUESTED';
create index if not exists pursuit_run_approvals_pending
  on pursuit_run_approvals (org_id, decision, created_at desc, id desc);
create index if not exists pursuit_run_approvals_run
  on pursuit_run_approvals (org_id, run_id, created_at, id);

-- ── 3. Grants — append-only, minimum sufficient ──────────────────────────────────────────────────
-- 0058's default privileges hand app_rw full DML on every new table, so the inherited UPDATE/DELETE
-- must be revoked explicitly. Nothing re-grants them: an approval decision is corrected by appending
-- another event, never by rewriting one.
grant select, insert on pursuit_run_approvals to app_rw;
revoke update, delete on pursuit_run_approvals from app_rw;

-- ── 4. RLS — ENABLE + FORCE, the certified org-membership pattern ────────────────────────────────
alter table pursuit_run_approvals enable row level security;
alter table pursuit_run_approvals force row level security;
drop policy if exists pursuit_run_approvals_rw on pursuit_run_approvals;
create policy pursuit_run_approvals_rw on pursuit_run_approvals for all to app_rw
  using (is_org_member(org_id)) with check (is_org_member(org_id));

-- ── 5. Ledger vocabulary — four values, every prior value kept (the 0103 §5 pattern) ─────────────
-- change_ledger.change_type is CHECK-constrained, so an approval event is rejected by the database
-- unless declared here. Read the current definition, append, never rewrite; re-running is a no-op.
do $$
declare def text;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint
   where conname = 'change_ledger_change_type_check' and conrelid = 'change_ledger'::regclass;
  if def is not null and def not like '%APPROVAL_REQUESTED%' then
    execute 'alter table change_ledger drop constraint change_ledger_change_type_check';
    execute 'alter table change_ledger add constraint change_ledger_change_type_check ' ||
      replace(def, ']))', ', ''APPROVAL_REQUESTED''::text, ''APPROVAL_GRANTED''::text,'
                       || ' ''APPROVAL_REJECTED''::text, ''APPROVAL_INVALIDATED''::text]))');
  end if;
end $$;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────────────────────────
-- Additive only. Reverting drops the approval lifecycle entirely; any decision history is lost with
-- it, so this is an emergency measure. The ledger vocabulary and the steps composite key are inert
-- when the table is absent and may be left in place.
--
--   begin;
--   drop table if exists pursuit_run_approvals;
--   commit;
