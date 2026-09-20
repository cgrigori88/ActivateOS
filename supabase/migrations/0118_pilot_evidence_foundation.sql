-- 0118 — Pilot Evidence Foundation (Slice 1).
--
-- WHAT THIS IS. The anti-regret pass: the facts a real pilot generates that would be PERMANENTLY
-- unrecoverable if we do not begin capturing them on day one. It adds no learning, no scoring, no
-- causality and no negative labels.
--
-- Three gaps, each proven by tracing rather than assumed:
--
--   1. PROVENANCE. `data_environment` already exists on 25 tables and `lineage.ts` already keeps
--      provenance separate from learning eligibility via an explicit allow-list. But the vocabulary
--      cannot say PILOT or CERTIFICATION, so real pilot evidence and gate fixtures would be the same
--      class forever. THIS HAS ALREADY STARTED: 18 invocations — including 4 of the 7 P8-0
--      observations — are flagged PRODUCTION because /api/mcp hardcodes it, and PRODUCTION is the
--      sole learning-eligible environment. Those rows are preserved as written; §3 gives them an
--      explicit exclusion manifest instead of rewriting history.
--
--   2. DECISION-TIME ATTENTION. P2 rank is computed at read time and never persisted, and the three
--      legacy snapshot tables (score / why-now / convergence) have zero rows and NO writer — they are
--      abandoned designs, not the canonical home. Ranking depends on the whole comparison set, which
--      moves, so a historical rank is unrecoverable from present-day state.
--
--   3. COMMERCIAL EVENTS. `change_ledger` is the ONLY append-only commercial store (app_rw=ar).
--      `outcome_events`, `pursuit_outcomes`, `route_outcomes` and `opportunities` are all `arwd` —
--      fully mutable and deletable. Opportunity creation and stage transitions are written ONLY to
--      `outcome_events`, with an untyped payload and no before/after. The ledger's vocabulary already
--      contains OPPORTUNITY_CREATED and STAGE_CHANGED with `before_state`/`after_state` columns and
--      no writer — so this needs NO new table, only the missing emission (code, not DDL).
--
-- TRANSACTION OWNERSHIP. No begin/commit — the applier owns it. Every statement is guarded.

-- ── 1. Provenance vocabulary ────────────────────────────────────────────────────────────────────
-- PILOT is real-world evidence. CERTIFICATION is gate traffic. NEITHER is added to
-- LEARNING_ELIGIBLE_ENVIRONMENTS: real-world provenance and training eligibility are SEPARATE
-- dimensions, and the existing design already expresses that — the enum is provenance, the
-- allow-list is eligibility. Whether PILOT rows may ever train anything is a later P8 corpus/label
-- determination, not a consequence of the activity being real.
--
-- Exactly ONE CHECK in the schema bounds this column (on `pursuits`); the other 24 columns are plain
-- text with a default, so this is the whole DDL surface for the vocabulary.
do $$
declare def text;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint
   where conname = 'pursuits_data_environment_check' and conrelid = 'pursuits'::regclass;
  if def is not null and def not like '%PILOT%' then
    execute 'alter table pursuits drop constraint pursuits_data_environment_check';
    execute 'alter table pursuits add constraint pursuits_data_environment_check ' ||
      replace(def, ']))', ', ''PILOT''::text, ''CERTIFICATION''::text]))');
  end if;
end $$;

-- ── 2. The legacy certification exclusion manifest ──────────────────────────────────────────────
-- Rows already written as PRODUCTION by certification gates are HISTORICAL TRUTH and are never
-- rewritten. They are named here instead, by exact id, so any future corpus can exclude them
-- deterministically rather than by timestamp, fixture-name folklore or someone's memory of a gate.
--
-- Append-only: a manifest that can be edited is not a manifest.
create table if not exists certification_exclusions (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  subject_kind text not null check (subject_kind in ('governed_action_invocation', 'change_ledger', 'pursuit')),
  subject_id   uuid not null,
  reason       text not null,
  recorded_at  timestamptz not null default now(),
  constraint certification_exclusions_unique unique (org_id, subject_kind, subject_id)
);
create index if not exists certification_exclusions_subject
  on certification_exclusions (org_id, subject_kind, subject_id);

-- ── 3. Decision-time attention observations ─────────────────────────────────────────────────────
-- ONE table, one row per (snapshot, pursuit). It answers exactly: what was eligible, how did
-- PursuitOS rank it, and what components did it actually use at that instant.
--
-- BOUNDED REFERENCES AND NUMBERS, NEVER A PAYLOAD COPY. `components` holds the signal contributions
-- P2 actually summed — numbers and declared signal keys — never prose, never evidence text, never
-- anything withheld. `comparison_set_size` is stored because, as portfolio-pertinence.ts says, a
-- rank is meaningless without it.
--
-- P2 SEMANTICS ARE UNTOUCHED. This records THAT a ranking occurred and what it was. It does not
-- change the computation, and `rank`/`score`/`band` keep their P2 meaning: RELATIVE ATTENTION
-- PRIORITY — never win probability, forecast, account quality or causal uplift.
--
-- SELF-DEDUPLICATING, NOT SCHEDULED. `snapshot_fingerprint` identifies the ranking INPUT STATE, so
-- capturing again while nothing has changed is a no-op rather than a row per invocation. That
-- removes the cadence question entirely: we capture on CHANGE, not on a timer.
create table if not exists attention_observations (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references organizations(id) on delete cascade,
  -- Groups the rows of one ranking into one observation.
  snapshot_id          uuid not null,
  snapshot_fingerprint text not null,
  taken_at             timestamptz not null default now(),
  algorithm_version    text not null,
  scope                text not null,
  comparison_set_size  integer not null check (comparison_set_size >= 0),
  withheld_count       integer not null default 0 check (withheld_count >= 0),
  -- The decision this ranking stood behind, when there is one. NULL means the ranking was captured
  -- without an accompanying decision — which is a fact, not a gap to be filled later.
  decision_ref_kind    text check (decision_ref_kind in ('pursuit_plan_revision')),
  decision_ref_id      uuid,
  -- One eligible subject and where it ranked.
  pursuit_id           uuid not null references pursuits(id) on delete cascade,
  rank                 integer not null check (rank >= 1),
  score                numeric(6,3) not null,
  band                 text not null,
  components           jsonb not null default '[]'::jsonb,
  context_health       text,
  data_environment     text not null default 'PRODUCTION',
  constraint attention_observations_unique unique (org_id, snapshot_fingerprint, pursuit_id)
);
create index if not exists attention_observations_snapshot
  on attention_observations (org_id, snapshot_id);
create index if not exists attention_observations_pursuit
  on attention_observations (org_id, pursuit_id, taken_at desc);
create index if not exists attention_observations_decision
  on attention_observations (org_id, decision_ref_id) where decision_ref_id is not null;

-- ── 4. Privileges — append-only, proved rather than asserted ────────────────────────────────────
-- THE REVOKE IS WHAT MAKES THESE APPEND-ONLY. `alter default privileges` grants app_rw `arwd` on
-- every new table in this database, so a GRANT alone adds nothing — UPDATE and DELETE arrive by
-- default and must be taken away. This is the device 0094 used for change_ledger and 0117 for
-- invocation_effect_refs; both end at `app_rw=ar`, and so must these. Evidence that can be edited
-- into a more favourable story is not evidence.
grant select, insert on certification_exclusions to app_rw;
revoke update, delete on certification_exclusions from app_rw;
grant select, insert on attention_observations to app_rw;
revoke update, delete on attention_observations from app_rw;

alter table certification_exclusions enable row level security;
alter table certification_exclusions force row level security;
alter table attention_observations enable row level security;
alter table attention_observations force row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='certification_exclusions' and policyname='certification_exclusions_rw') then
    create policy certification_exclusions_rw on certification_exclusions for all to app_rw
      using (org_id = current_setting('app.org_id', true)::uuid)
      with check (org_id = current_setting('app.org_id', true)::uuid);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='attention_observations' and policyname='attention_observations_rw') then
    create policy attention_observations_rw on attention_observations for all to app_rw
      using (org_id = current_setting('app.org_id', true)::uuid)
      with check (org_id = current_setting('app.org_id', true)::uuid);
  end if;
end $$;
