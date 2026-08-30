# PHASE 2 — TECHNICAL DESIGN — WORKSTREAM A: Pursuit Domain Model

> Foreman Phase 2. **Design only — no implementation code is written until this
> document is signed off.** Scope authority: the Phase-1 Sign-off & Phase-2
> Directive (Deep spine + scaffolded integrations; directional/versioned scoring;
> additive migrations + isolated demo tenant; workstream-gated cadence; hybrid
> real-vendor/synthetic-customer data with lineage). Grounded in the live schema
> (companies/products are GLOBAL reference tables; revenue_motions already carries
> org/company/product/partner/sellers/thesis — today's Motion conflates Pursuit +
> strategy). RLS baseline: app_rw + `is_org_member(org_id)` (migrations 0058–0062).

**Migration numbering:** new files are `0063`–`0068` (latest applied is `0062`).
New tables are added *after* 0058's data-driven RLS loop, so each needs an
**explicit** `enable row level security` + `_rw` policy in its own migration (the
0060/0061 pattern), plus registration in the cross-tenant test suite (Workstream I).

---

## Design invariants for Workstream A (non-negotiable)

1. **Additive & inert.** No table dropped, no column removed, no legacy path
   broken. `pursuit_id` added as **nullable**. New behavior gated by
   `PURSUITS_ENABLED` (env/feature flag) so schema can land dark on prod.
2. **No double authority.** Once an object is Pursuit-backed, the Pursuit is
   canonical for the *new* workflow; legacy account/motion views keep reading their
   own tables (projection, not a second source of business truth).
3. **Convenience ≠ authority.** `pursuits.current_*_score` columns are *cached
   projections* of the latest immutable snapshot; the snapshot is authoritative.
4. **Provenance everywhere.** Every Pursuit knows why it exists; every score keeps
   its contributions; every material change is a ledger event; every AI
   recommendation is distinct from the human decision.
5. **Lineage isolation.** Demo/synthetic rows are tagged and excluded from
   learning/calibration by default. Mandatory.
6. **As-of safe.** Snapshots immutable, ledger append-only, no in-place score
   history — historical reconstruction stays possible.

---

## A. Exact `pursuits` schema

```sql
create table pursuits (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references organizations(id) on delete cascade,
  account_id                uuid not null references companies(id) on delete cascade,   -- global company
  product_id                uuid references products(id) on delete set null,
  product_category_id       uuid references taxonomy_nodes(id) on delete set null,       -- category grain
  pursuit_type              text not null default 'NET_NEW',                            -- enum, §10
  status                    text not null default 'DETECTED',                           -- lifecycle, §B
  -- Commercial thesis (structured; narrative derived) --
  business_problem          text,
  compelling_event          text,
  why_now                   jsonb,        -- structured Why-Now (Workstream B authors; column reserved here)
  timing_window             text,         -- '0-90d' | '3-6m' | '6-12m' | '12-24m' | 'unknown'
  -- Cached current scores (projection of current_score_snapshot_id; NOT authoritative) --
  current_priority_score            numeric check (current_priority_score between 0 and 100),
  current_purchase_propensity_score numeric,
  current_evidence_confidence_score numeric,
  current_timing_score              numeric,
  current_solution_fit_score        numeric,
  current_partner_activation_score  numeric,
  current_seller_activation_score   numeric,
  current_score_snapshot_id         uuid,   -- FK added after snapshots table (H/E); nullable
  -- Expected value --
  expected_value_low        numeric,
  expected_value_high       numeric,
  expected_value_weighted   numeric,
  -- Recommendation vs decision (§80) --
  recommended_partner_id    uuid references partners(id) on delete set null,
  selected_partner_id       uuid references partners(id) on delete set null,
  recommended_motion_id     uuid references revenue_motions(id) on delete set null,
  approved_motion_id        uuid references revenue_motions(id) on delete set null,
  recommended_vendor_seller_id uuid references sellers(id) on delete set null,
  selected_vendor_seller_id    uuid references sellers(id) on delete set null,
  recommended_partner_seller_id uuid references sellers(id) on delete set null,
  selected_partner_seller_id    uuid references sellers(id) on delete set null,
  -- Identity / dedup / merge / split (§J, §80) --
  dedup_key                 text not null,             -- deterministic, §J
  strategic_initiative      text,                      -- optional identity component
  merged_into_pursuit_id    uuid references pursuits(id) on delete set null,  -- merge target (§80)
  split_from_pursuit_id     uuid references pursuits(id) on delete set null,  -- split parent (§80)
  -- Source lineage / creation provenance (§80) --
  created_by_actor_type     text not null default 'system'  check (created_by_actor_type in ('system','agent','human','import')),
  created_by_actor_id       uuid,
  created_via               text,          -- e.g. 'signal_convergence','motion_backfill','manual','import','agent:discover_pursuits'
  source_evidence_id        uuid,          -- soft ref (evidence global-ish)
  source_signal_id          uuid,          -- soft ref
  source_agent_run_id       uuid references agent_runs(id) on delete set null,
  -- Data lineage / synthetic isolation (§N) --
  data_environment          text not null default 'PRODUCTION' check (data_environment in ('PRODUCTION','DEMO','SIMULATED')),
  data_lineage              text          check (data_lineage in ('VERIFIED_PUBLIC','AUTHORIZED_FIRST_PARTY','SIMULATED','SYNTHETIC')),
  is_simulated              boolean not null default false,
  -- Timing/audit --
  first_detected_at         timestamptz not null default now(),
  last_material_change_at    timestamptz not null default now(),
  next_action_at            timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
```

**Enums via CHECK for the small, stable sets (pursuit_type, status, data_*);** a
reference table is overkill pre-demo and CHECK is trivially alterable additively.
`why_now` is `jsonb` (structured, authored in Workstream B) — column reserved now
so B doesn't require a schema change to `pursuits`.

**Indexes / constraints:**
```sql
-- Active-identity uniqueness (dedup): one live pursuit per commercial thesis.
create unique index pursuits_active_dedup
  on pursuits (org_id, dedup_key)
  where status not in ('WON','LOST','DISQUALIFIED') and merged_into_pursuit_id is null;
create index pursuits_org_status      on pursuits (org_id, status);
create index pursuits_org_account     on pursuits (org_id, account_id);
create index pursuits_org_priority    on pursuits (org_id, current_priority_score desc);
create index pursuits_next_action     on pursuits (org_id, next_action_at) where next_action_at is not null;
create index pursuits_env             on pursuits (data_environment) where data_environment <> 'PRODUCTION';
```

---

## B. Pursuit lifecycle

**States** (§11): DETECTED, RESEARCHING, REVIEW_REQUIRED, QUALIFIED, ROUTED,
MOTION_DESIGNED, READY_TO_ACTIVATE, ACTIVATING, ACTIVE, CUSTOMER_ENGAGED,
OPPORTUNITY_CREATED, WON, LOST, DORMANT, DISQUALIFIED.

**Allowed transitions** are declared as **data**, not scattered in the UI. A
`pursuit_transitions` lookup (or a TS constant mirrored by a DB `CHECK` trigger)
defines `from → {to…}`. It deliberately permits non-linear reality (§11):

- Forward path: DETECTED→RESEARCHING→(REVIEW_REQUIRED|QUALIFIED)→ROUTED→
  MOTION_DESIGNED→READY_TO_ACTIVATE→ACTIVATING→ACTIVE→CUSTOMER_ENGAGED→
  OPPORTUNITY_CREATED→(WON|LOST).
- Regressions/branches (allowed): ACTIVE→REVIEW_REQUIRED (new contradiction);
  DORMANT→RESEARCHING (new compelling event); ROUTED→QUALIFIED (partner route
  invalidated); MOTION_DESIGNED→ROUTED (team replacement); ACTIVE→DISQUALIFIED
  (definitive contradiction); any non-terminal→DORMANT; any→DISQUALIFIED.
- Terminal: WON, LOST, DISQUALIFIED (no outbound except explicit re-open which
  creates a new pursuit or a merge, not a silent transition).

**Validation mechanism:** a single service `transitionPursuit(db, pursuitId,
toStatus, {reason, actor})` in `src/lib/pursuits/lifecycle.ts`:
1. `SELECT … FOR UPDATE` the pursuit (concurrency, §L);
2. assert `toStatus ∈ ALLOWED[fromStatus]` else throw `IllegalPursuitTransition`;
3. update status + `last_material_change_at`;
4. append a `STATUS_CHANGED` **change-ledger** event (§F);
5. no UI or agent may set `pursuits.status` directly — enforced by convention +
   a DB trigger `pursuits_status_guard` that rejects updates to `status` not made
   in the same statement that sets a matching `_last_transition_token` GUC (belt;
   primary control is the service). *(Trigger optional; flagged for Phase 3 to
   confirm it doesn't fight app_rw — fallback is service-only.)*

---

## C. Reparenting plan

Add a **nullable** `pursuit_id uuid references pursuits(id) on delete set null` to:

| Table | Meaning after reparent | Notes |
|---|---|---|
| `revenue_motions` | Motion = *strategy for* the Pursuit | Motion keeps org/company/product/partner/sellers/thesis fields; Pursuit becomes the commercial thesis it serves. One Pursuit may have several Motions over time; the *approved* one is `pursuits.approved_motion_id`. |
| `pursuit_teams` | The routed team *for* the Pursuit | Already (company, taxonomy, partner, seller, fit, status) — attach to the matching Pursuit. |
| `opportunities` | The CRM opportunity the Pursuit advanced into | `opportunities.pursuit_id`; keep existing `motion_id`. |
| `campaigns` | Execution supporting the Pursuit | via its Motion's Pursuit; `campaigns.pursuit_id`. |

**No double authority:** legacy Motions/Accounts/Pipeline rooms continue reading
their own tables; the Pursuit does not overwrite them. New Pursuit workflow reads
`pursuits` + links. A follow-on (Workstream D) projects Motions/Pipeline *from* the
Pursuit where it improves the UX, but business state is written once.

---

## D. Shared-context linkage (many-to-many — §13 correction)

Evidence/Signals/Facts/Interactions/Relationships are **account/context objects
that multiple Pursuits may consume** (e.g. "VMware installed" → migration +
automation + modernization pursuits). Do **not** attach them 1:1. Associative
tables:

```sql
create table pursuit_evidence (
  pursuit_id uuid not null references pursuits(id) on delete cascade,
  evidence_id uuid not null,               -- FK to evidence(id)
  role text,                               -- 'supporting' | 'contradicting' | 'context'
  weight numeric,
  linked_by text, linked_at timestamptz not null default now(),
  primary key (pursuit_id, evidence_id)
);
-- identical shape: pursuit_signals(signal_id), pursuit_facts(fact_id [WS-B]),
--                  pursuit_interactions(interaction_id [WS-G]),
--                  pursuit_relationships(relationship_id [WS-G]).
```
`pursuit_facts`, `pursuit_interactions`, `pursuit_relationships` are **created now
(empty, correct shape)** even though Facts/Interactions/Relationships tables land
in Workstreams B/G — so those workstreams don't require a schema change to link.
Canonical evidence/signals/facts remain single-source; Pursuits reference them.

---

## E. Score persistence model (versioned, contribution-level)

Three tables; the pursuit row caches only the latest values.

```sql
create table pursuit_score_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  pursuit_id uuid not null references pursuits(id) on delete cascade,
  score_version_id uuid not null references score_versions(id),   -- reuse existing versioning
  seq int not null,                       -- monotonic per pursuit (v1,v2,…)
  computed_at timestamptz not null default now(),
  is_current boolean not null default true,
  data_environment text not null default 'PRODUCTION',
  unique (pursuit_id, seq)
);
create unique index pursuit_snapshot_one_current
  on pursuit_score_snapshots (pursuit_id) where is_current;

create table pursuit_score_dimensions (
  snapshot_id uuid not null references pursuit_score_snapshots(id) on delete cascade,
  dimension text not null check (dimension in
    ('purchase_propensity','evidence_confidence','timing','solution_fit',
     'partner_activation','seller_activation','pursuit_priority')),
  value numeric not null,
  band text,                              -- 'very_high'|'high'|'medium'|'low' where used
  primary key (snapshot_id, dimension)
);

create table pursuit_score_contributions (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references pursuit_score_snapshots(id) on delete cascade,
  dimension text not null,
  feature_name text not null,
  source text,                            -- provenance_type of the driving evidence/fact
  raw_value numeric,
  normalized_value numeric,
  weight numeric,
  contribution numeric not null,          -- signed points (e.g. +17, -7)
  evidence_reference uuid,                -- soft ref to evidence/fact
  feature_observed_at timestamptz,        -- as-of eligibility (§18/M)
  calculated_at timestamptz not null default now()
);
create index pursuit_contrib_snapshot on pursuit_score_contributions (snapshot_id, dimension);
```

**Recompute is append-only:** write a new snapshot (+ dimensions + contributions),
then in one txn flip the old `is_current=false`, new `is_current=true`, and set
`pursuits.current_score_snapshot_id` + cached `current_*` columns. No race, no lost
history. **Directional labeling** (score honesty): `score_versions.label` carries
the calibration state (e.g. `v0-directional-2026-09`); surfaces read it to show
"directional — not statistically calibrated."

**Feature-leakage guard (§18):** `feature_observed_at` must be `<= computed_at`;
the scorer only ingests features whose `observed_at <= as_of`. Snapshots are the
as-of record.

---

## F. Change Ledger

```sql
create table change_ledger (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  pursuit_id uuid references pursuits(id) on delete cascade,   -- nullable: account/other-entity changes
  entity_type text not null,              -- 'pursuit'|'account'|'fact'|'score'|'motion'|'partner_route'|'seller_route'|'team'|'opportunity'|'relationship'
  entity_id uuid,
  change_type text not null,              -- §27 enum (PURSUIT_CREATED, STATUS_CHANGED, SCORE_CHANGED, …)
  before_state jsonb,
  after_state jsonb,
  materiality text not null default 'material' check (materiality in ('material','minor','info')),
  reason text,
  trigger_type text,                      -- 'provider_run'|'interaction'|'human'|'agent'|'recompute'
  trigger_id uuid,
  actor_type text,                        -- 'system'|'agent'|'human'
  actor_id uuid,
  model_version text,
  agent_run_id uuid references agent_runs(id) on delete set null,
  data_environment text not null default 'PRODUCTION',
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now()
);
create index change_ledger_pursuit on change_ledger (pursuit_id, occurred_at desc);
create index change_ledger_org_type on change_ledger (org_id, change_type, occurred_at desc);
```
Append-only (no update/delete in the app path). **Materiality thresholds (§28)**
live in a small config module `src/lib/pursuits/materiality.ts` (score-delta ≥ N,
timing-window change, new first-party evidence, new contradiction, route change,
etc.); only `material` events raise alerts / drive "What Changed?".

---

## G. Migration strategy

Additive, ordered, each independently reversible:
1. `0063_pursuits_core.sql` — `pursuits` + indexes + RLS.
2. `0064_pursuit_scoring.sql` — snapshots/dimensions/contributions + RLS + the
   deferred `pursuits.current_score_snapshot_id` FK.
3. `0065_change_ledger.sql` — ledger + RLS.
4. `0066_pursuit_context_links.sql` — the five associative tables + RLS.
5. `0067_reparent_fks.sql` — add nullable `pursuit_id` to revenue_motions,
   pursuit_teams, opportunities, campaigns (+ indexes).
6. `0068_pursuit_overrides.sql` — override-capture table (§80).
Backfill is a **separate idempotent step** (script, not a data migration inside DDL)
— see §I. No `DROP`, no `ALTER … DROP COLUMN`, no `NOT NULL` on new FK columns.

---

## H. RLS (explicit per new table)

Every new table is org-scoped and gets, in its own migration:
```sql
alter table <t> enable row level security;
drop policy if exists <t>_rw on <t>;
create policy <t>_rw on <t> for all to app_rw
  using (is_org_member(org_id)) with check (is_org_member(org_id));
```
Tables **with `org_id`** (pursuits, snapshots, change_ledger, overrides) → direct
policy above. **Associative tables without `org_id`** (pursuit_evidence, _signals,
_facts, _interactions, _relationships, dimensions, contributions) → parent-scoped
(0061 child pattern), e.g.:
```sql
create policy pursuit_evidence_rw on pursuit_evidence for all to app_rw
  using (exists (select 1 from pursuits p where p.id = pursuit_id and is_org_member(p.org_id)))
  with check (exists (select 1 from pursuits p where p.id = pursuit_id and is_org_member(p.org_id)));
-- dimensions/contributions scope through their snapshot → pursuit → org.
```
`score_version_id`, `companies`, `products` are global/reference (already
`using(true)` for app_rw per 0061) — reads work. **Grant** app_rw select/insert/
update/delete on each new table (0058 already grants ALL TABLES; new tables need an
explicit grant since they post-date it) — included in each migration.

---

## I. Backfill rules (deterministic + idempotent)

Script `scripts/backfill-pursuits.ts`, runnable repeatedly, per org:
1. **From Motions:** for each `revenue_motions` row, compute `dedup_key` (§J) from
   `(org_id, company_id, coalesce(product_id, taxonomy_node_id), inferred_type)`.
   `inferred_type` from motion thesis/trigger heuristics → default `NET_NEW`.
   `upsert_pursuit(dedup_key)` (§K); set `motion.pursuit_id`. If the motion is
   `approved/active`, set `pursuits.approved_motion_id`; else `recommended_motion_id`.
2. **From pursuit_teams:** attach each to the Pursuit matching `(org, company,
   taxonomy)`; map its partner/seller into `recommended_*`/`selected_*` by team
   status (recommended→recommended, accepted→selected).
3. **Opportunities:** `opportunities.pursuit_id = (its motion's pursuit)`; if no
   motion, upsert a Pursuit from `(org, company, taxonomy)`.
4. **Campaigns:** `campaigns.pursuit_id = (its motion's pursuit)`.
5. Seed an initial score snapshot per Pursuit from the existing
   `propensity_scores` (maps to `purchase_propensity`), leaving other dimensions
   null until Workstream B/C compute them — clearly a `v0-directional` version.
6. Emit a `PURSUIT_CREATED` ledger event per new Pursuit with `created_via =
   'motion_backfill'`.
Idempotent: re-running matches existing pursuits by `dedup_key` and updates in
place; creates none twice.

---

## J. Duplicate prevention / Pursuit uniqueness

**Identity grain:** `dedup_key = lower(hash(org_id : account_id :
coalesce(product_id, product_category_id) : pursuit_type : coalesce(strategic_initiative,'')))`.
Rationale (§80): account+product alone is insufficient; **type** and optional
**strategic_initiative** discriminate distinct commercial theses; **partner route
and timing are NOT identity** (a Pursuit re-routes partners and its timing evolves
within one thread). The `pursuits_active_dedup` partial unique index enforces one
*live* pursuit per key; terminal/merged pursuits don't collide (history preserved).
The components are stored (columns) so "why is this the same / a different Pursuit"
is answerable — explainable dedup, not a black box.

---

## K. Idempotency

`upsert_pursuit(db, {orgId, accountId, productId?, categoryId?, type, initiative?,
provenance})` → `INSERT … ON CONFLICT (org_id, dedup_key) WHERE <active> DO UPDATE
SET updated_at = now() RETURNING id`. Workers/agents/backfill all go through it;
safe to retry. Score recompute keys on `(pursuit_id, seq)` (unique) → a retried
recompute can't double-insert a snapshot.

---

## L. Concurrency

- **State/route/priority updates:** `SELECT … FOR UPDATE` the pursuit row inside the
  `withTenant` txn; lifecycle transitions and route changes serialize per pursuit.
- **Score recompute:** append-only snapshot + atomic `is_current` flip guarded by
  the `pursuit_snapshot_one_current` partial unique index (a concurrent double-flip
  fails the second writer, who retries against the new current).
- **Ledger/associative:** insert-only; PKs prevent duplicate links.
- **Backfill:** the active-dedup unique index makes concurrent creators converge to
  one row (loser catches the conflict and reads).

---

## M. Event-time architecture

Workstream A carries the time-triple where it owns data:
- `change_ledger`: `occurred_at` (business time of the change) + `recorded_at`.
- `pursuit_score_contributions.feature_observed_at` (as-of eligibility).
- `pursuits.first_detected_at` / `last_material_change_at`.
Evidence/Signals/Interactions gain `occurred_at | observed_at | ingested_at` in
Workstreams B/G; A **reserves** the pattern and its scorer consumes `observed_at`.
Design rule: never use `now()` where a business timestamp is knowable.

---

## N. Synthetic-data lineage (mandatory)

- Row-level: `data_environment` (PRODUCTION|DEMO|SIMULATED), `data_lineage`
  (VERIFIED_PUBLIC|AUTHORIZED_FIRST_PARTY|SIMULATED|SYNTHETIC), `is_simulated` on
  `pursuits`, snapshots, and `change_ledger`. Propagated to child rows on create.
- Tenant-level: the demo tenant carries `organizations.kind = 'demo'` (reuse the
  existing guest/kind concept) as a coarse gate.
- **Exclusion is default:** Insights / calibration / source-predictive-value /
  backtest queries add `AND data_environment = 'PRODUCTION' AND is_simulated =
  false` unless an explicit override flag is passed. A shared helper
  `productionOnly(sql)` centralizes this so no query forgets. Non-negotiable.

---

## O. As-of compatibility

Reconstruct state at time `T`:
- **Scores:** latest `pursuit_score_snapshots` with `computed_at <= T`.
- **Changes:** replay `change_ledger` where `occurred_at <= T`.
- **Facts (WS-B):** validity-aware (`valid_from/valid_until`).
Design choices that preserve this: immutable snapshots (no update), append-only
ledger (no delete), contribution `feature_observed_at`. Full event-sourcing is not
required; these primitives suffice.

---

## P. Existing-room compatibility

| Room | Change for Workstream A |
|---|---|
| Accounts, Contacts, Mapping, Intake, Review, Sources, Routines, Queue, Goals, Admin, Analytics, Insights | **None.** Read legacy tables; unaffected (additive schema). |
| Motions | **None now.** Later (WS-D) projects from Pursuit. `motion.pursuit_id` populated but unused by the current room. |
| Pipeline, Campaigns | **None now.** `pursuit_id` populated, unused by current rooms until WS-D/E. |
| (new) Pursuits, Pursuit detail, Today, Ask | Built in **Workstream D**, not A. A delivers data + services only. |

No transitional adapter is required for A because nothing legacy reads the new
tables. `PURSUITS_ENABLED=false` keeps new nav hidden while schema is live.

---

## Q. Exact file targets

**Migrations (new):** `0063_pursuits_core.sql`, `0064_pursuit_scoring.sql`,
`0065_change_ledger.sql`, `0066_pursuit_context_links.sql`, `0067_reparent_fks.sql`,
`0068_pursuit_overrides.sql`.
**Domain/services (new dir `src/lib/pursuits/`):** `model.ts` (types + upsert/dedup),
`lifecycle.ts` (transition map + `transitionPursuit`), `scoring.ts` (snapshot write
+ current flip; dimension/contribution assembly), `ledger.ts` (append + materiality),
`materiality.ts` (thresholds), `context-links.ts` (link/unlink evidence/signals/…),
`overrides.ts` (capture), `dedup.ts` (key computation), `lineage.ts`
(`productionOnly` helper + env tagging).
**DB:** `src/db/*` type additions; RLS lives in the migrations. No change to
`src/db/client.ts` (app_rw path already correct).
**Scripts:** `scripts/backfill-pursuits.ts` (idempotent), extend
`scripts/migrate.ts` usage docs (owner-string only, per RISK-1).
**Worker/agents:** **no behavior change in A** — but `src/lib/agents/mcp-tools.ts`
and the refresh runner gain *interfaces* they'll call in later workstreams (score
recompute + ledger). Explicitly out of scope to wire until WS-B/E.
**UI:** none in A.
**Tests:** `src/lib/pursuits/__tests__/` (lifecycle, dedup, scoring flip, idempotency,
materiality) + `scripts/pursuit-rls-check.ts` (cross-tenant, feeds WS-I suite).

## R. Tests (Workstream A gate)

- **Unit:** transition map (legal accepted / illegal rejected); dedup key
  determinism + component sensitivity; snapshot `is_current` single-current
  invariant; materiality threshold decisions; `productionOnly` filter.
- **Integration (local pg):** `upsert_pursuit` idempotency (2× → 1 row); backfill
  idempotency (2× → identical state); score recompute append + atomic flip;
  transition writes exactly one ledger event.
- **RLS / cross-tenant (blind, per 0058 method):** for **every** new table —
  tenant A with GUC set reads only its rows; with no GUC → 0 rows; associative
  tables scope through pursuit→org; a tenant cannot link to another tenant's pursuit.
- **Migration:** all six apply clean on a fresh DB and on a prod-shaped snapshot;
  rollback (§S) restores prior state; re-apply is safe.
- **Concurrency:** parallel `upsert_pursuit` and parallel recompute converge to one
  live row / one current snapshot.

## S. Rollback

Additive ⇒ reversible. Two levers:
1. **Soft (default):** `PURSUITS_ENABLED=false` — schema stays, all new behavior
   dark; legacy app fully intact.
2. **Hard:** a `0069_pursuits_rollback.sql` that `DROP`s the six new tables and the
   four `pursuit_id` columns (safe: nothing legacy reads them). Backfill is undone
   by dropping `pursuits` + nulling `pursuit_id`; no legacy data mutated at any
   point, so no restore needed. Verified in the migration test.

## T. Definition of Done — Workstream A

1. Migrations 0063–0068 apply cleanly (fresh + prod-shaped) and roll back cleanly.
2. `pursuits` + lifecycle service + versioned scoring + change ledger + 5 context
   links + reparent FKs + overrides exist, RLS-policied, `tsc` clean.
3. Backfill produces a deterministic, idempotent Pursuit set from existing Motions/
   teams/opportunities/campaigns on a seeded DB; re-run is a no-op.
4. A Pursuit can be created (idempotent), transitioned (illegal transitions
   rejected), scored (snapshot + contributions + current flip), and every material
   change lands in the ledger — all via services, under `withTenant`.
5. **Cross-tenant suite green for every new table** (A can't read/link B).
6. Lineage: demo/synthetic rows tagged; `productionOnly` excludes them; unit-proven.
7. Existing rooms verified unchanged (owner-vs-app_rw parity crawl on the affected
   pages still identical).
8. No UI (that's D); no worker/agent behavior change (that's B/E) — interfaces only.

---

## §80 canonical requirements — how A satisfies them

- **Uniqueness / dedup:** §J (explainable key + partial-unique active index).
- **Merge:** `merged_into_pursuit_id` + a `mergePursuits()` service **stub**
  (architected; full UX post-demo) that repoints links/ledger and marks the loser
  merged. Not on the demo critical path.
- **Split:** `split_from_pursuit_id` + modeling that never blocks splitting (context
  is M:N, so re-pointing a subset of links to a new child Pursuit is possible).
  Service stub now; full UX later.
- **Source lineage / creation provenance:** `created_by_actor_*`, `created_via`,
  `source_evidence_id`, `source_signal_id`, `source_agent_run_id` + the first
  `PURSUIT_CREATED` ledger event → "Why does this Pursuit exist?" is answerable.
- **Recommendation vs decision:** distinct `recommended_*` vs `selected_/approved_*`
  columns for partner, sellers, and motion. AI never silently becomes the decision.
- **Override capture (§80):**
  ```sql
  create table pursuit_overrides (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null references organizations(id) on delete cascade,
    pursuit_id uuid not null references pursuits(id) on delete cascade,
    field text not null,               -- 'partner'|'seller'|'motion'|'timing'|'status'|'priority'
    original_recommendation jsonb,
    human_decision jsonb,
    reason text,
    actor_id uuid, actor_type text default 'human',
    created_at timestamptz not null default now()
  );
  ```
  Populated whenever a human overrides a recommendation → model-supervision data.

---

## 🛑 HALT — Phase 2 (Workstream A) complete. Awaiting sign-off.

No implementation code has been written. On approval, **Phase 3 (Workstream A)**
executes exactly this design as atomic, verified increments — migrations first
(applied to local pg + blind RLS re-test), then the `src/lib/pursuits/*` services,
then the idempotent backfill, then the Phase-4 blind verification against the DoD
in §T — halting again only if something materially diverges from this approved
design.

**Open confirmations that would refine Phase 3 (not blockers to approval):**
1. `pursuit_type` inference heuristic for backfill — accept a default of `NET_NEW`
   with a light thesis-keyword pass, refine later? (Recommend yes.)
2. The `pursuits_status_guard` DB trigger — implement it, or rely on the
   service-only control given app_rw (recommend service-only for the demo, add the
   trigger post-demo)?
3. Demo tenant provisioning: create it as part of Workstream A's backfill test, or
   as a dedicated step in Workstream I? (Recommend I, referenced here.)
