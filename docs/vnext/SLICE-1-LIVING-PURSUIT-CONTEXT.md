# Vertical Slice 1 — Living Pursuit Context

**Status:** `NOT STARTED` — plan only. **Do not build without explicit approval.**
**Phase:** P1 · **Flag family:** `VNEXT_CONTEXT_HEALTH/STATE/MEMORY/INTELLIGENCE`
**Written:** 2026-09-12T02:47Z

---

## Objective

Take **one existing synthetic demo pursuit** through a complete, evidence-bound
context path, surfaced inside the **existing Pursuit Detail** room via progressive
disclosure:

```
canonical existing pursuit
  → pursuit-scoped facts / evidence / provenance
  → freshness
  → context health
  → pursuit state
  → chronological pursuit memory
  → Why this pursuit? / Why now? / What's missing?
```

**Not** a redesign of Pursuit Detail.

## Target pursuit

The **Globex Manufacturing virtualization hero pursuit** — the pursuit
`audit/DEMO-ITINERARY.md` §2 already uses (`/pursuits/<GLOBEX_PURSUIT>`). It is the
richest object in the synthetic world: facts with provenance, a recomputed route, a
preserved recommendation with a human override to WWT, an assembled team, a
RESTRICTED reason, federation participants, and a value case.

Resolve its UUID at build time from the locally seeded database — do not hard-code
it, and do not read it from the hosted demo:

```sql
select p.id, c.legal_name, p.use_case
from pursuits p join companies c on c.id = p.account_id
where c.legal_name like 'Globex%' and p.use_case = 'virtualization exit'
order by p.created_at limit 1;
```

Secondary check pursuit: **Stark Industries** — high propensity but timing stays
UNKNOWN. It is the honest-unknown case and will prove that thin context renders as
"we don't know" rather than as an empty panel (`ACCEPTANCE.md` S1-7).

---

## The headline finding: this slice needs no schema change

**Zero migrations. Zero writes. Zero new tables.** Everything Slice 1 needs already
exists in the schema; the work is composition and read-models.

| Slice 1 need | Already provided by | Verified |
|---|---|---|
| Pursuit↔fact linkage with typed relevance | `pursuit_facts` (mig. `0066`, widened `0072`) — `relevance_type` ∈ PRIMARY_TRIGGER / SUPPORTING_CONTEXT / TIMING_ANCHOR / SOLUTION_FIT / PARTNER_ROUTE / RISK / CONTRADICTION / CONTRADICTING / BACKGROUND, plus `relevance_score`, `reason`, `linked_by_type`, `linked_by_id` | DDL read |
| Chronological memory substrate | `change_ledger` (mig. `0065`, types extended `0073`/`0079`) with `occurred_at` (business time) separate from `recorded_at`, 4-level materiality, actor separated from trigger, and index `(pursuit_id, occurred_at desc)` | DDL read |
| Fact freshness | `src/lib/facts/freshness.ts` — `decay()`, `eventProximity()`, `factFreshness()`, predicate-specific policy | source read |
| Research coverage | `src/lib/intel/completeness.ts` — `COVERAGE_CATEGORIES`, `computeCompleteness()` | source read |
| Pursuit state | `src/lib/pursuits/lifecycle.ts`, `src/lib/lifecycle/state.ts`, `loadLifecycleFacts` | source read |
| Gap computations | `opportunities/meddpicc.ts` `meddpiccGaps()`, `opportunities/lifecycle.ts` coverage checklist, `stakeholders/coverage.ts`, `value/case.ts` absent drivers, `WhyNowView.unknowns[]` | source read |

This makes Slice 1 the safest possible first slice: **rollback is `git revert`, with
no data to clean up.**

---

## Files affected

### New (read-models and composition — all pure or read-only)

| File | Purpose |
|---|---|
| `src/lib/pursuits/read-models/context-health.ts` | Compose existing fact freshness × existing coverage into one pursuit-level health view. **Must not re-implement either.** |
| `src/lib/pursuits/read-models/memory.ts` | Chronological pursuit memory over `change_ledger`, ordered by `occurred_at`, **unfiltered by materiality**. |
| `src/lib/pursuits/read-models/missing-context.ts` | One ranked "what's missing", composed from the four existing per-domain gap computations. **No fifth independent computation.** |
| `src/lib/pursuits/read-models/pertinence.ts` | "Why this pursuit?" — pertinence relative to the portfolio. Deterministic, evidence-cited. |
| `src/components/pursuit/context-narrative.tsx` | The single surface that absorbs Why Now + Facts + change timeline into one narrative. |

### Modified

| File | Change | Risk |
|---|---|---|
| `src/lib/pursuits/read-models/detail.ts` | `getFacts(db, r.account_id)` → pursuit-scoped via `pursuit_facts`, ordered by relevance then freshness. Add the four new views behind flags. | **Medium.** Changes which facts the demo shows. Flag-gated; OFF keeps today's behaviour exactly. |
| `src/lib/pursuits/read-models/types.ts` | Additive view types. | Low. |
| `src/app/pursuits/[id]/page.tsx` | Resolve `vnextCapabilities(tenant)` and render the narrative in place of three panels when armed. | **Medium.** The demo's §2 beat lives here. |
| `src/lib/pursuits/read-models/index.ts` | Export the new read-models. | None. |

### Deliberately NOT modified

`change_ledger` and any append-only table · the disclosure/grant layer ·
`getPursuitTimeline` (What-Changed keeps its materiality filter — see D-006) ·
scoring · route/override semantics · governed actions · any migration.

---

## Design notes that matter

**Context health is a composition, not an engine.** Pursuit-level health =
freshness of the pursuit's *linked* facts (weighted by `relevance_type`, since a
stale TIMING_ANCHOR matters far more than a stale BACKGROUND fact) × coverage of the
categories this pursuit's use-case actually depends on. It reports a band and the
two or three specific things dragging it down — never a bare score.

**Memory is not What-Changed.** Three read-models over one ledger:

| Read-model | Order by | Materiality filter | Answers |
|---|---|---|---|
| What-Changed (existing) | `recorded_at desc` | `isTimelineWorthy` | "what deserves my attention" |
| **Memory (new)** | **`occurred_at asc/desc`** | **none** | "how did we get here" |
| State (existing) | n/a | n/a | "what do we believe now" |

Memory ordering by business time is not a preference — the ledger carries
`occurred_at` for exactly this reason and the pursuit index is already
`(pursuit_id, occurred_at desc)`, so it is also the cheaper query.

**What's missing must rank, not list.** Four sources already compute gaps. The
composition's job is to return *the most important unresolved thing*, with its
source named. A list of every gap is the failure mode (`ACCEPTANCE.md` U-4, U-6).

**Why this pursuit? is deterministic.** Pertinence is computed from existing
scores and evidence, not generated. A model may phrase it; it may not decide it
(D-007).

---

## The density question — answered before building

`ACCEPTANCE.md` requires answering *which existing panel does this replace, absorb
or deepen?* before adding anything.

**Answer: Slice 1 should reduce the panel count.** `WhyNowBento`, `FactsBento` and
`MaterialChangeTimeline` are three panels that each hold one fragment of a single
story. When the flag is ON they are absorbed into one `ContextNarrative` reading
*Why this matters · Current state · What changed · What's missing*, with facts,
provenance and the full memory behind progressive disclosure.

Net panels: **18 → 16.** If the implementation ends at 19, it has failed GATE C.

---

## Feature-flag behaviour

| Flag | Gates |
|---|---|
| `VNEXT_PURSUIT_STATE_ENABLED` | "Current state" |
| `VNEXT_PURSUIT_MEMORY_ENABLED` | Chronological memory (progressive disclosure) |
| `VNEXT_CONTEXT_HEALTH_ENABLED` | Health band + drags; pursuit-scoped facts |
| `VNEXT_PURSUIT_INTELLIGENCE_ENABLED` | Why this / why now / what's missing narrative. **Requires STATE + MEMORY** — enforced in `vnextCapabilities`. |

All resolved through `vnextCapabilities(tenant)`, which takes the already-resolved
`TenantFeatureView` and ANDs against `tenant.experience`. **Flag OFF must be
byte-identical in behaviour to the pre-slice product** — that is a test, not an
aspiration.

---

## Test plan

**Unit (no DB)** — pure composition functions:
relevance-weighted freshness · health banding · gap ranking and tie-breaks ·
memory ordering by `occurred_at` including null handling · honest-unknown rendering
when a pursuit has no linked facts.

**Integration (local synthetic DB)** — `EITHER`-class suite
`tests/`/`scripts/vnext-context-verify.ts`: Globex renders the full path; Stark
returns UNKNOWN timing without fabrication; memory includes LOW-materiality events
that What-Changed omits; pursuit-scoped facts differ from account-scoped and are
correct; flag OFF produces the pre-slice payload exactly.

**Regression** — all 33 suites, `typecheck`, `npm test`, `next build`. Highest
signal: `interpret`, `lifecycle-query`, `lifecycle-acceptance`, `value-case`,
`stakeholder-intel`, `disclosure`, `federation`, `isolation`, `scope`.

**Demo integrity** — `seed-demo-world.ts` `verify()` and the `demo-manifest.ts`
digest, plus the canonical numbers (11 / $8,040,000 / $3,361,500 / $1,850,000 / 14).

**UX** — desktop ~1600×1000 and phone width, flag ON and OFF, both pursuits.

---

## Regression risk

| Risk | Severity | Mitigation |
|---|---|---|
| Pursuit-scoped facts change what the demo's §2 beat shows | **High** — this is the itinerary's hero screen | Flag-gated. Walk §2 with the flag both ways before any promotion. If pursuit-scoping makes the beat *worse*, keep account-scoping and record why. |
| Absorbing three panels alters familiar visual rhythm | Medium | Reuse existing `Card`/`Panel`/`Disclosure` primitives and tokens (U-11). No new visual idiom. |
| `unknowns[]` double-reported by Why Now and "what's missing" | Medium | Single source: the composition consumes `WhyNowView.unknowns` rather than recomputing. |
| Unbounded memory query on a long-lived pursuit | Low | Paginate; default to a bounded window with explicit "show earlier". |
| Read-model latency on a `force-dynamic` page | Low | Existing page already runs ~12 queries at `maxDuration = 60`; parallelise the four new reads and measure before/after. |
| Scope creep into Slice 2 (next-best action) | Medium | "Next move" is explicitly **out of scope**. `VNEXT_NEXT_BEST_ACTION_ENABLED` stays off. |

---

## Rollback

1. **Flag off** — capability inert, zero data implications.
2. **Revert the commits** — no migration, no backfill, nothing to undo.
3. **Vercel** — promote the prior deployment.

Known-good reference: `97e975f0` / tag `demo-safe-2026-09-12`.

---

## Implementation chunks

Each chunk is one small commit leaving the repository coherent (typecheck + tests
green). Chunks 1–4 change no rendered output at all.

| # | Chunk | Ships |
|---|---|---|
| 1 | `context-health.ts` + unit tests | Composition only, unreferenced |
| 2 | `memory.ts` + unit tests | Read-model only, unreferenced |
| 3 | `missing-context.ts` + unit tests | Composition only, unreferenced |
| 4 | `pertinence.ts` + unit tests | Composition only, unreferenced |
| 5 | Pursuit-scoped facts in `detail.ts`, behind `contextHealth` | First behaviour change, flag-gated |
| 6 | `context-narrative.tsx`, behind `pursuitIntelligence`; absorb the three panels | The visible slice |
| 7 | `scripts/vnext-context-verify.ts` (EITHER class) + register in `verify-classes.ts` | Integration proof |
| 8 | Full regression run; update `STATUS.md`, `SESSION-HANDOFF.md`, screenshots | GATE B evidence |

**Chunks 1–4 are safe to build at any time** — they are pure functions referenced by
nothing. Chunks 5–6 are the ones that need the demo-risk conversation.

Estimate: chunks 1–4 ≈ half a day; 5–6 ≈ half a day; 7–8 ≈ a quarter day. Within one
Saturday **only if** nothing else competes. Per `BUILD-PLAN.md`, if chunks 5–6 are
not complete by Saturday night, Slice 1 does not ship to Monday's demo — and chunks
1–4 sitting unreferenced on the branch is a perfectly good place to stop.
