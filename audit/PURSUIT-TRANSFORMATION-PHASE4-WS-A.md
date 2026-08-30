# Workstream A — Phase 4 Blind Verification Report

**Scope:** Pursuit domain spine (canonical commercial object). Foreman-Architect
4-phase loop, Workstream A only. Executed per the §41 execution order and the §43
Definition-of-Done checklist. **This is a HALT point — no Workstream B/C/D/E work
has begun.**

**Branch:** `claude/activateos-platform-review-xzkgmd`
**Commits under review:**

| Commit | Contents |
|---|---|
| `3e58340` | WS-A Phase 3 (1/4): migrations 0063–0068 |
| `2dc2520` | WS-A Phase 3 (2/4): domain services + idempotent backfill |
| `87ba11c` | WS-A Phase 3 (3/4): blind-verification harness + feature flag |

Phase 1 (`63605ae`) and Phase 2 TDD (`87c516a`) were signed off previously.

---

## 1. Migrations applied

Applied in order to a **fresh throwaway database** (Postgres 16, local), on top of
`supabase/verify/wsa_harness.sql` (a faithful minimal reproduction of the base
tables the Pursuit domain touches + the 0058 RLS mechanism: `app_current_org()`,
`is_org_member(org_id)`, non-owner `app_rw` role and grants). All applied cleanly,
no errors:

```
=== 00_harness.sql            OK ===
=== 0063_pursuits_core.sql    OK ===
=== 0064_pursuit_scoring.sql  OK ===
=== 0065_change_ledger.sql    OK ===
=== 0066_pursuit_context_links.sql OK ===
=== 0067_reparent_fks.sql     OK ===
=== 0068_pursuit_overrides.sql OK ===
```

| Migration | Lines | Purpose |
|---|---:|---|
| 0063_pursuits_core | 117 | `pursuits` table + 15-state status enum, recommendation/decision routing columns, expected-value, lineage, `pursuits_active_dedup` partial-unique index, RLS |
| 0064_pursuit_scoring | 75 | `pursuit_score_snapshots` / `_dimensions` / `_contributions`, deferred FK for current-snapshot cache, one-current partial-unique, RLS |
| 0065_change_ledger | 44 | universal append-only `change_ledger` (actor≠trigger, 4-level materiality), RLS |
| 0066_pursuit_context_links | 82 | 5 M:N link tables (evidence/signals/facts/interactions/relationships) with relevance metadata, parent-scoped RLS |
| 0067_reparent_fks | 24 | additive nullable `pursuit_id` on revenue_motions / pursuit_teams / opportunities / campaigns + indexes |
| 0068_pursuit_overrides | 32 | `pursuit_overrides` (recommendation vs human decision) + RLS |

All migrations are **additive** — no existing column is dropped or retyped, no
existing constraint tightened. Legacy tables gain only nullable columns.

## 2. Schema created (verified in-DB)

- **12 tables** present: `pursuits`, `pursuit_score_snapshots`,
  `pursuit_score_dimensions`, `pursuit_score_contributions`, `change_ledger`,
  `pursuit_evidence`, `pursuit_signals`, `pursuit_facts`, `pursuit_interactions`,
  `pursuit_relationships`, `pursuit_overrides`, `pursuit_teams` (reparented).
- **Dedup index** exactly as designed:
  `CREATE UNIQUE INDEX pursuits_active_dedup ON pursuits (org_id, dedup_key)
   WHERE status <> ALL('WON','LOST','DISQUALIFIED') AND merged_into_pursuit_id IS NULL`
  — so a thesis has at most one **live** pursuit, while terminal/merged rows never
  block a legitimate future pursuit on the same thesis.
- **RLS enabled with exactly one policy on every one of the 12 tables.**
  `app_rw` holds INSERT/SELECT/UPDATE/DELETE via default privileges (confirmed on
  `pursuits`, `change_ledger`, `pursuit_score_snapshots`).

## 3. Test results — §43 Definition-of-Done checklist

Harness: `scripts/pursuit-verify.ts`. Every mutation runs as **non-owner `app_rw`
with `app.org_id` set** (superuser used only to seed global/reference rows), so RLS
is genuinely exercised, not bypassed. `npm run pursuits:verify` equivalent.

```
[verify] 48 passed, 0 failed
```

| §43 item | Assertions | Result |
|---|---|---|
| Creation | new thesis → CREATED | ✓ |
| Idempotency / dedup | same thesis (diff casing/spacing) → MATCHED_EXISTING, same id, stable key | ✓✓✓ |
| Distinct thesis coexists | different `use_case`, same account/product/type → separate CREATED, distinct id + key | ✓✓✓ |
| Valid lifecycle | DETECTED→RESEARCHING→QUALIFIED | ✓✓ |
| Illegal lifecycle | DETECTED→WON throws `IllegalPursuitTransition` | ✓ |
| Reroute/retime no-fork | after changing partner + timing, re-upsert → MATCHED_EXISTING, same id | ✓✓ |
| Append-only scoring | seq 1→2, priority delta = 25, both snapshots retained | ✓✓✓ |
| One current snapshot | exactly one `is_current`, it is the latest (seq 2) | ✓✓ |
| Score cache coherence | `current_priority_score`=65, cache points at current snapshot id | ✓✓ |
| Explainability | dimension rows present, contributions carry `feature_observed_at` | ✓✓ |
| Shared context M:N | one evidence ref → two pursuits; re-link idempotent; relevance metadata updated | ✓✓✓ |
| Change ledger | PURSUIT_CREATED×1, STATUS_CHANGED×2, SCORE_CHANGED×2; actor_type + trigger_type distinct columns | ✓✓✓✓ |
| Human override | override row + OVERRIDE_RECORDED event, trigger=USER_OVERRIDE, recommendation≠decision columns distinct | ✓✓✓✓ |
| Backfill deterministic | run 1: 2 motions seen, pursuits created, opp+campaign linked, snapshot seeded | ✓✓✓✓✓ |
| Backfill idempotent | run 2: 0 created, all matched, 0 re-links | ✓✓✓ |
| Migration bootstrap | migrated pursuits carry one PURSUIT_MIGRATED event (not per-field noise) | ✓ |
| §24 no false NET_NEW | 0 backfilled pursuits defaulted to NET_NEW | ✓ |
| Cross-tenant isolation | org A cannot SELECT/scope org B pursuits or ledger | ✓✓✓ |
| Cross-tenant write | org A cannot INSERT a pursuit stamped for org B (RLS WITH CHECK) | ✓ |
| Feature-flag rollback | `pursuitsEnabled()` defaults OFF | ✓ |

**48 / 48 passed.**

## 4. Row / backfill counts (post-run verify DB)

Two seeded tenants; org A carries 2 legacy motions (one MODERNIZATION-inferred, one
RENEWAL_ATTACH-inferred), 1 opportunity, 1 campaign, 1 propensity score.

| Metric | Count |
|---|---:|
| pursuits total | 5 |
| — created via MOTION_MIGRATION | 2 |
| pursuit_score_snapshots | 4 |
| change_ledger events | 12 |
| opportunities linked | 1 |
| campaigns linked | 1 |
| motions reparented | 2 |

Counts are stable across repeated backfill runs (idempotency proven by run-2 zeros).

## 5. Security results

- All Pursuit mutations executed under **`app_rw` (non-owner) + `app.org_id` GUC**.
- Cross-tenant **read** blocked: org A sees 0 of org B's pursuits, ledger rows,
  scoped queries.
- Cross-tenant **write** blocked: an attempt to INSERT a pursuit with a foreign
  `org_id` is rejected by the RLS `WITH CHECK` (`row-level security` violation).
- 12/12 Pursuit tables RLS-enabled, one policy each, `is_org_member(org_id)` (or
  parent-scoped equivalent for child tables).

## 6. Compilation / typecheck

`npx tsc --noEmit` — **clean, no errors** across the whole project including the
new domain services, backfill runner, verify harness, and flag.

## 7. Known deviations from the Phase 2 TDD

1. **Verification harness, not full 62-migration rebuild.** The prod schema is
   large and this container is periodically recycled; a full sequential rebuild is
   reset-fragile. Instead, migrations 0063–0068 were verified against a faithful
   minimal base schema (`supabase/verify/wsa_harness.sql`) reproducing the exact
   column shapes and the 0058 RLS mechanism. This isolates the Pursuit domain and
   is the same technique used to verify `resolve_api_key` earlier. The harness is
   committed for reproducibility.
2. **`check_function_bodies = off`** is set at the top of the harness only, so the
   `is_org_member` function can be defined before its base table in a single file.
   This is a harness convenience; the real migrations create objects in dependency
   order and do not require it.
3. **Service-level lifecycle guards, no DB trigger** (per §22): `transitionPursuit`
   is the only sanctioned status path (SELECT FOR UPDATE → validate → write →
   ledger). No enforcing DB trigger pre-demo, as agreed.

## 8. Unresolved risks / watch items

- **Backfill not yet run against production.** Verified idempotent and deterministic
  on synthetic data only. Production run remains a gated operational step (dry-run
  first) after implementation sign-off.
- **`use_case` discriminator is caller-supplied.** The backfill leaves it null
  (thesis identity = account×product×type for legacy rows); net-new detection paths
  (Workstream B) must populate a normalized `use_case` to split genuinely distinct
  theses. Verified the mechanism works; population is downstream.
- **No UI reads these tables yet.** The spine ships dark behind `PURSUITS_ENABLED`.
  Surfacing is Workstream D and out of scope here.
- **Scoring is directional/versioned by construction** (score_version label + append
  -only snapshots). No calibrated probability is emitted or implied — consistent
  with the binding "no 88% chance to buy" rule.

## 9. Definition-of-Done status

| DoD criterion (§43) | Status |
|---|---|
| Migrations additive + apply clean on fresh DB | ✅ |
| Pursuit identity idempotent + concurrency-safe (partial-unique + ON CONFLICT) | ✅ |
| Distinct theses coexist via normalized `use_case` | ✅ |
| Non-linear lifecycle with service-level guards; DORMANT is live | ✅ |
| Append-only versioned scoring, one-current, explainable | ✅ |
| Universal change ledger, actor≠trigger, 4-level materiality | ✅ |
| Shared context objects are M:N with relevance metadata | ✅ |
| Human override captured; recommendation≠decision | ✅ |
| Backfill deterministic + idempotent; legacy type→UNCLASSIFIED not NET_NEW | ✅ |
| Multi-tenant isolation (read + write) under app_rw + RLS | ✅ |
| Ships dark behind a feature flag (clean rollback) | ✅ |
| tsc clean | ✅ |

**Workstream A DoD: GREEN. 48/48 verification assertions pass.**

---

## HALT

Per the Phase 2 sign-off directive, I am halting here for **Workstream A
implementation sign-off**. Workstreams B (Facts/intelligence), C (routing),
D (UX), and E (operational loop) will not begin until you approve this report.
