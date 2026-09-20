-- 0117 — P8-0: runtime observability and evaluation hooks.
--
-- WHAT THIS IS. The immutable execution-evidence spine future P8 learning consumes. It adds no
-- learning, no ranking, no reward model and no prediction. It records WHAT HAPPENED and refuses to
-- invent why.
--
-- WHAT IS DELIBERATELY ABSENT, AND WHY. No model/usage/cost table: all 13 `ai/client.ts` call sites
-- are uncorrelated — they are reached from a Resend webhook and an analytics page, never from a
-- governed invocation or a run step, and an orphan evidentiary row is worse than none. No receipt
-- table: `action_receipts` is fully mutable and DELETE-able and its `detail` holds an arbitrary
-- provider payload, and no certified external path is in scope while sending is disarmed. No
-- execution→outcome table: `OBSERVED_AFTER` has no derivation job and `HUMAN_ATTRIBUTED` has no
-- declaration path anywhere in the product, and no attribution UI was invented to populate one.
-- `agent_runs` stays legacy and is neither migrated nor backfilled. `emitted_event_id` stays dead.
--
-- TRANSACTION OWNERSHIP. No begin/commit — the applier owns the transaction. Every statement is
-- guarded so re-running the file is a no-op (R1-G7).

-- ── 1. The parent gains the tenant-composite candidate key the FK pattern requires ───────────────
-- `governed_action_invocations` carried only PRIMARY KEY (id) and UNIQUE (org_id, skill_id,
-- idempotency_key), so the child's composite FK could not be written at all.
--
-- THIS IS NOT A NEW IDENTITY MODEL. `id` remains the canonical primary key and is already globally
-- unique; `org_id` is already NOT NULL. The candidate key therefore permits no business state that
-- was previously impossible. It exists for exactly one reason: so the child relationship makes it
-- RELATIONALLY IMPOSSIBLE for an observation row and the invocation it describes to belong to
-- different organizations — refused before RLS is ever consulted.
--
-- PRECEDENT. This is the device 0110 added to `pursuit_run_steps` and 0115 added to the
-- pre-existing, certified `pursuit_plan_revisions`. 0109's earlier note about avoiding retrofits
-- onto certified tables described the convention before those two migrations; they, not it, are the
-- governing precedent for this case.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'governed_action_invocations_org_id_id_key'
                   and conrelid = 'governed_action_invocations'::regclass) then
    alter table governed_action_invocations
      add constraint governed_action_invocations_org_id_id_key unique (org_id, id);
  end if;
end $$;

-- ── 2. The observation contract marker ──────────────────────────────────────────────────────────
-- PER INVOCATION AND PER COVERED CAPABILITY — never a global runtime claim.
--
--   registered capability + 1     → the v1 effect/ledger observation contract applies here
--   registered capability + NULL  → NOT OBSERVED under v1
--   unregistered capability + NULL→ v1 claims no effect completeness for that capability
--
-- Named for what it is: an EXECUTION OBSERVATION CONTRACT version. It is not a migration level, not
-- a runtime build, and not a statement that the deployment "supports observability".
--
-- IMMUTABLE BY OMISSION: the column is absent from app_rw's (status, executed_at) UPDATE allowlist,
-- so 1 → NULL and 1 → 2 are impossible without a new grant. Monotonicity is a privilege property,
-- not trigger machinery.
alter table governed_action_invocations add column if not exists observation_contract_version integer;

-- THE REGISTRY, ENFORCED BY THE DATABASE. Application code alone must not be able to mark an
-- unregistered invocation as observation-complete — that would let a future evaluator read "zero
-- effects" as fact for a capability nothing ever instrumented. NULL is always legal; 1 is legal
-- ONLY for the exact four v1 capability versions; no other value is legal at all.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'governed_action_invocations_observation_contract_v1'
                   and conrelid = 'governed_action_invocations'::regclass) then
    alter table governed_action_invocations add constraint governed_action_invocations_observation_contract_v1
      check (
        observation_contract_version is null
        or (observation_contract_version = 1 and skill_version = 1 and skill_id in (
              'draft_campaign_touch', 'recommend_pursuit_plan', 'decide_pursuit_plan', 'assemble_pursuit_team'))
      );
  end if;
end $$;

-- ── 3. The effect observations ──────────────────────────────────────────────────────────────────
-- ONE ROW PER DURABLE BUSINESS OBJECT a covered invocation actually created. Cardinality is 0..N and
-- was proven, not assumed: `assembleTeam` inserts team members inside a loop, and a REJECTED
-- invocation creates nothing. That is why singular effect columns on the invocation were withdrawn.
--
-- A BOUNDED RELATION, A BOUNDED KIND, AND AN IDENTIFIER. No arbitrary JSON, no handler payload, no
-- prompt, no email body, no capability arguments, no foreign recipient data. Effect refs are
-- recorded AT THE CREATION BRANCH by internal instrumentation — never reconstructed later by
-- parsing `governed_action_invocations.result`, which remains compatibility data and not P8 truth.
create table if not exists invocation_effect_refs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  invocation_id   uuid not null,
  -- CREATED is the ONLY v1 relation, and that is proven rather than chosen: every declared effect of
  -- all four registry capabilities is a creation. `draft_campaign_touch@1` cannot reach the upsert's
  -- update branch — its argument schema is {campaign,name,subject,body} with additionalProperties
  -- false and no touchId reaches `upsertTouch`. The vocabulary describes REACHABLE GOVERNED
  -- BEHAVIOUR, not latent helper capability; UPDATED/ASSERTED/REQUESTED/APPROVED arrive by
  -- migration with the capabilities that legitimately need them.
  effect_relation text not null check (effect_relation = 'CREATED'),
  -- Exactly the kinds the four v1 contracts can produce. `stakeholders` is absent on purpose: it has
  -- a COMPOSITE primary key (opportunity_id, contact_id) and therefore no single uuid to record, so
  -- `assert_stakeholder_role@1` is excluded from v1 rather than made to fabricate an identity.
  effect_kind     text not null check (effect_kind in (
                    'campaign_touch', 'pursuit_plan_revision', 'pursuit_goal',
                    'pursuit_plan', 'motion_action', 'pursuit_team_member')),
  effect_id       uuid not null,
  observed_at     timestamptz not null default now(),
  -- THE TENANT-COMPOSITE PARENT. An observation and the invocation it describes cannot belong to
  -- different organizations — refused RELATIONALLY, before RLS is consulted. This is the whole
  -- reason section 1 exists.
  constraint invocation_effect_refs_invocation_fk
    foreign key (org_id, invocation_id) references governed_action_invocations (org_id, id) on delete cascade,
  -- One observation per (invocation, object). A retried instrumentation pass cannot inflate a
  -- future evaluator's effect count.
  constraint invocation_effect_refs_unique unique (org_id, invocation_id, effect_kind, effect_id)
);
create index if not exists invocation_effect_refs_invocation
  on invocation_effect_refs (org_id, invocation_id);
create index if not exists invocation_effect_refs_object
  on invocation_effect_refs (org_id, effect_kind, effect_id);

-- ── 4. Privileges — append-only, proved rather than asserted ────────────────────────────────────
-- INSERT and SELECT only. No UPDATE and no DELETE: a learning corpus that can be edited into a more
-- favourable story is not evidence. Immutability is a PRIVILEGE property here, exactly as it is for
-- governed_action_invocations and change_ledger.
grant select, insert on invocation_effect_refs to app_rw;
-- AND THE REVOKE IS THE PART THAT ACTUALLY MAKES IT APPEND-ONLY. `alter default privileges` in this
-- database grants app_rw `arwd` on every new table in `public`, so the GRANT above adds nothing the
-- table did not already have — UPDATE and DELETE arrive by default and must be taken away
-- explicitly. This is the device 0094 used for change_ledger and governed_action_invocations, 0103
-- for the plan tables and 0110 for pursuit_run_approvals; `change_ledger` ends at `app_rw=ar`, and
-- so must this table. Without these two lines "immutable" would be prose, and the P8-0 acceptance
-- suite proves it by privilege precisely so the claim cannot be made on trust.
revoke update, delete on invocation_effect_refs from app_rw;

alter table invocation_effect_refs enable row level security;
alter table invocation_effect_refs force row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'invocation_effect_refs' and policyname = 'invocation_effect_refs_rw') then
    create policy invocation_effect_refs_rw on invocation_effect_refs for all to app_rw
      using (org_id = current_setting('app.org_id', true)::uuid)
      with check (org_id = current_setting('app.org_id', true)::uuid);
  end if;
end $$;
