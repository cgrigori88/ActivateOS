# Workstream B — Facts / Intelligence · Phase 4 Blind Verification Report

**Scope:** the durable belief layer — Facts — on top of the Pursuit spine. Foreman-Architect
4-phase loop, Workstream B only, executed in the §46 order against the §48 Definition of Done.
**This is a HALT point — no Workstream C work has begun, and no production data was touched.**

**Branch:** `claude/activateos-platform-review-xzkgmd`
**Commits under review:**

| Commit | Contents |
|---|---|
| `94c826a` | WS-B Phase 3 (1/4): migrations 0069–0072 |
| `d777639` | WS-B Phase 3 (2/4): domain services + LLM candidate extractor |
| `95093ea` | WS-B Phase 3 (3/4): blind-verification harness + backfill (+ 0073, migration fixups) |

Phase 2 design (`883646d`) was signed off with 50 clarifications; all are reflected below.

---

## 1. Migrations applied

Applied in order to a **fresh throwaway database** on top of the Workstream A harness plus a
faithful intelligence substrate (`supabase/verify/wsb_intel_harness.sql`: evidence, signals,
signal_sources, contradictions, review_queue at their live column shapes). All clean:

```
00_harness · 01_intel · 0063–0068 (WS-A) · 0069 · 0070 · 0071 · 0072 · 0073  → all OK
```

| Migration | Purpose |
|---|---|
| 0069_fact_predicates | richly-typed **predicate registry** (distinct ontology, not a signal alias) + **fact_promotion_policies** (predicate-aware gate as governed data) + curated seed (14 predicates / 14 policies) |
| 0070_facts_core | **fact_candidates** (pre-promotion boundary) + durable **facts**; typed value envelope, full temporal fields, **identity-key vs value-key**, lifecycle CURRENT/DISPUTED/STALE/SUPERSEDED/EXPIRED/REJECTED, one-current-per-slot + active-value dedup partial-uniques, RLS |
| 0071_fact_associations | fact_evidence / fact_signals (M:N support/contradiction), **fact_contradictions (typed)**, **fact_reviews (human lineage)**, candidate→fact FK, RLS |
| 0072_fact_pursuit_whynow | extended pursuit_facts relevance vocabulary + **FK integrity** on the 0066 ref_id columns; **pursuit_why_now_snapshots** + **pursuit_convergence_snapshots** (versioned), RLS |
| 0073_change_ledger_fact_types | widen change_ledger change_type CHECK with the Fact events (§26) |

~499 lines of migration; all **additive** (no existing column dropped/retyped).

## 2. Schema created (verified in-DB)

**10 Fact/why-now/convergence tables**, all RLS-enabled with one policy each. The identity
split is enforced at the DB level: partial-unique `facts_current_slot` (one CURRENT fact per
`fact_identity_key`) and `facts_active_value` (dedup on `fact_value_key`). FK integrity now
binds `pursuit_facts.ref_id→facts`, `pursuit_signals.ref_id→signals`,
`pursuit_evidence.ref_id→evidence`. ~1,700 lines of typed services in `src/lib/facts/`.

## 3. Test results — §48 Definition-of-Done checklist

Harness: `scripts/facts-verify.ts` (`npm run facts:verify`). **Every** mutation runs as the
non-owner `app_rw` role with `app.org_id` set — RLS genuinely under test; superuser only seeds
global/reference rows.

```
[facts-verify] 69 passed, 0 failed
```

| Area (§48) | Assertions | Result |
|---|---|---|
| Predicate enforcement (§9/§29) | unknown predicate → unresolved → REJECTED; no durable fact | ✓✓✓ |
| Evidence gate (§4) | unverified source → REJECTED (unverified_source) | ✓ |
| Deterministic promotion (§7) | verified signal → CURRENT; provenance THIRD_PARTY_VERIFIED; family from predicate | ✓✓✓✓✓ |
| Idempotency / dedup (§1/§14) | same value → one CURRENT fact, reused id, M:N support accrues, confidence reproducible | ✓✓✓✓ |
| Contradiction independent (§10) | CONTRADICTS attached, counted, never netted; support retained | ✓✓ |
| Corroboration (§5) | first migration source → REVIEW; second independent source → PROMOTED | ✓✓ |
| Supersession (§12/§15) | competing value → SUPERSEDED_PRIOR; old preserved + superseded_by; one CURRENT in slot; COMPETING_VALUE contradiction recorded | ✓✓✓✓✓ |
| Freshness (§13/§16) | decayed → STALE; past-validity → EXPIRED; both retained (not deleted) | ✓✓✓ |
| As-of leakage (§23/§25) | far-past reconstruction excludes future facts; all returned knowable by then | ✓✓✓ |
| Pursuit linkage (§15/§18) | facts link live pursuit; technology → SOLUTION_FIT relevance | ✓✓ |
| Convergence (§17/§19) | independent families detected; **3 families from 1 source capped at 1**; low source diversity flagged; explanation persisted | ✓✓✓✓ |
| Why Now (§19/§21/§43) | structured, every element id-referenced, missing→null (not fabricated), idempotent, one snapshot | ✓✓✓✓✓✓ |
| Score impact (§22/§24/§25) | contributions referenceKind=fact; **featureObservedAt ≤ as-of (no leakage)**; composes with WS-A writeScoreSnapshot | ✓✓✓✓✓ |
| Extractor (§26/§30/§31) | candidate-only; **hallucinated span discarded**; only grounded created; candidate ≠ durable fact | ✓✓✓✓✓ |
| Human review (§27/§34/§35) | renewal_date → REVIEW; ACCEPT → durable HUMAN_ASSERTED fact; lineage captured | ✓✓✓✓✓ |
| Change ledger (§26) | FACT_PROMOTED/SUPERSEDED/CONTRADICTION_DETECTED/WHY_NOW_CHANGED/FACT_LINKED_TO_PURSUIT; actor≠trigger | ✓✓✓✓✓✓ |
| Tenant isolation (§28/§36) | org A cannot read org B facts (direct **and** association path), zero scoped, RLS WITH CHECK blocks cross-org insert | ✓✓✓✓ |
| Backfill (§30/§37) | run 1 promotes; run 2 promotes 0 (idempotent); report carries distributions | ✓✓✓ |
| Feature flag (§31/§40) | FACTS_ENABLED defaults OFF | ✓ |

**69 / 69 passed.** The hallucination-resistance test (§42) and the syndication/independence
test (§19) are permanent assertions in the suite.

## 4. Row counts (post-run verify DB)

| Metric | Count |
|---|---:|
| facts total | 11 |
| — CURRENT | 8 |
| — SUPERSEDED | 1 |
| — STALE/EXPIRED | 2 |
| fact_candidates | 17 |
| — REJECTED (unknown predicate / unverified) | 2 |
| fact_evidence support links | 13 |
| fact_contradictions | 1 |
| fact_reviews (lineage) | 6 |
| why-now snapshots | 1 |
| convergence snapshots | 2 |
| change-ledger Fact events | 22 |

## 5. Security results

- All Fact mutations run under **`app_rw` (non-owner) + `app.org_id` GUC**.
- Cross-tenant **read** blocked directly and **via the association path** (org A cannot read
  org B's `fact_evidence` for a B-owned fact — the §36 indirect-leakage test).
- Cross-tenant **write** blocked by RLS `WITH CHECK`.
- 10/10 Fact tables RLS-enabled, one policy each; child tables parent-scoped via the fact's org.

## 6. How the binding constraints are enforced (evidence)

- **Fact ≠ LLM summary (§0/§1/§4/§28-31):** durable `facts` require a predicate resolved
  against the controlled registry (unknown → REJECTED, tested); confidence is deterministic and
  versioned (`v1-facts-deterministic`), never model-set; the LLM extractor produces candidates
  only and a quoted span not present in the source is discarded (tested).
- **Why Now = graph output (§2/§21/§43):** `pursuits.why_now` + `pursuit_why_now_snapshots`
  are assembled from linked facts/convergence; every component references a real id; missing
  components are null, not fabricated (tested); recompute is idempotent.
- **Leakage guard absolute (§25):** `factsToContributions` emits `featureObservedAt = fact.as_of`
  and the as-of reconstruction excludes any fact not knowable at the score's time (tested).

## 7. Known deviations from the Phase 2 design

1. **Verification harness, not a full 62+ migration rebuild** — same isolation technique signed
   off for Workstream A; the harness is committed for reproducibility.
2. **Backfill promotes verified *signals* only; the LLM extractor is not run in backfill**
   (§18/§38/§39) — the agent path exists and is tested, but is a demo-tenant / opt-in step, kept
   out of the automated migration for cost + prod safety.
3. **Hypothesis is reserved, not built** (§32): commercial reasoning stays out of Fact storage;
   the distinction is documented for a later workstream, as instructed.

## 8. Unresolved risks / watch items

- **Facts backfill not yet run against production** — proven idempotent on synthetic data only;
  the production run is dry-run-first → report → inspection → explicit approval (§37/§47).
- **`FACTS_ENABLED` / `PURSUITS_ENABLED` remain OFF for production tenants** (§40).
- **partner_route_relevance and recommended_immediate_action are scaffolds** at the C/E
  boundaries (§44/§45) — populated there, not here.
- **Full app/DB integration check in the real deployment environment remains a pre-demo release
  gate** — the harness is strong workstream verification, not production-release certification.

## 9. Definition-of-Done status (§48)

All 32 DoD criteria demonstrated by the 69-assertion suite: verified evidence → normalized
candidate → subject/predicate/object resolution → predicate-aware promotion → CURRENT fact (or
Review / stays candidate) → unknown predicate blocked → contradiction attached → DISPUTED/
supersession/stale/expiry lifecycle → history queryable → multi-pursuit linkage with relevance
→ independence-aware, explainable convergence → structured, traceable, non-fabricated Why Now →
versioned score impact excluding future facts → change-ledger events → agent cannot create
durable truth → no-span candidate cannot promote → review lineage preserved → cross-tenant
(direct + association) reads fail → backfill idempotent → FACTS_ENABLED-off preserves legacy →
**tsc clean**.

**Workstream B DoD: GREEN. 69/69 verification assertions pass.**

---

## HALT

Per the sign-off directive, I am halting for **Workstream B implementation sign-off**.
Workstream C (Routing) will not begin until you approve this report. No production Fact
promotion will occur before a reviewed dry-run and explicit approval.
