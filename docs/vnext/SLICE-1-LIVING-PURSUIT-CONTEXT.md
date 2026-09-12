# Vertical Slice 1 — Living Pursuit Context

**Status:** `BUILDING` — chunks 1–4, 5A and 5B-1 complete (2026-09-12). Chunks 5B-2–8
**NOT STARTED**; 5B-2 needs explicit approval — it is the first change to what the demo shows.
**Phase:** P1 · **Flag family:** `VNEXT_CONTEXT_HEALTH/STATE/MEMORY/INTELLIGENCE`
**Written:** 2026-09-12T02:47Z · **As-built section appended:** 2026-09-12T04:05Z

> The plan below is preserved as written. See **AS-BUILT** at the foot of this file
> for what actually shipped and where it differs.

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

---

# AS-BUILT — chunks 1–4 (2026-09-12)

Chunks 1–4 are complete on `roadmap/pursuitos-vnext`. Chunks 5–8 remain
**NOT STARTED**. This section records where the implementation differs from the
plan above; where it is silent, the plan held.

## What shipped

| Chunk | Commit | File | Tests |
|---|---|---|---|
| 1 | `d1e5685` | `src/lib/pursuits/read-models/context-health.ts` | 13 |
| 2 | `b6b7b33` | `src/lib/pursuits/read-models/memory.ts` | 21 |
| 3 | `ac572ba` | `src/lib/pursuits/read-models/missing-context.ts` | 15 |
| 4 | `77f72ef` | `src/lib/pursuits/read-models/pertinence.ts` | 18 |

8 files added, **0 pre-existing files modified**. Not exported from
`read-models/index.ts`, so no UI can reach them. Typecheck clean, 220/220 tests,
build succeeds.

## Differences from the plan

**1. Pure functions over typed inputs, not async loaders.** The plan implied
read-models that query. They ship as pure composition functions with explicit
typed inputs, shaped as direct projections of `facts ⋈ pursuit_facts` and
`change_ledger`. The SQL loaders move to chunk 5, where they land with their
consumer and an integration verifier. See **D-016** — a loader with no consumer
and no integration test would look finished and be unverified.

**2. `pertinence.ts` is pursuit- and decision-scoped, not portfolio-relative.**
The plan described it as "Why this pursuit? — pertinence relative to the
portfolio". Building it showed those are two computations: ranking *within* a
pursuit for the decision at hand needs only pursuit-scoped inputs, while "why
this pursuit rather than another" needs cross-pursuit inputs that do not belong
in a pursuit-scoped slice. The former shipped; the latter is deferred to Slice 3.
See **D-017**.

Consequence for chunk 6: the narrative's "Why this matters" is assembled from
context health, the top gap and the top pertinent items — all pursuit-scoped.
It does not yet answer portfolio-relative pertinence, and must not imply it does.

**3. Disclosure filters before ranking rather than penalising within it.** Not in
the plan, and it matters: an un-entitled item that merely scores lower still
shifts the positions of visible items around it, making its existence inferable
from the ordering. Both ranking modules filter first and disclose only an
aggregate count. See **D-018**.

## Verified against the schema

Two suspected discrepancies were checked and are **not** discrepancies:

- `pursuit_facts.relevance_type` — migration `0066` allows only four values while
  `deriveRelevance()` returns nine. Migration **`0072` widens the constraint** to
  all nine. Schema and implementation agree.
- `change_ledger.change_type` — `FACT_LINKED_TO_PURSUIT` is absent from `0065`'s
  CHECK. Migrations **`0073`/`0079`/`0084` extend it**. Schema and implementation
  agree.

Both confirm LOW-materiality linkage events genuinely exist in the ledger — which
is precisely the connective tissue `getPursuitTimeline` filters out and Pursuit
Memory retains.

## Architectural discovery: the house four-state conclusion vocabulary

Three domains already express a four-way judgement separating verified /
inferred / degraded / absent:

| Domain | Vocabulary |
|---|---|
| Value case | `STRONG` · `INCOMPLETE` · `CONFLICTING` · `NOT_ESTABLISHED` |
| Stakeholder coverage | `VERIFIED` · `INFERRED` · `UNVERIFIED` · `MISSING` |
| Lifecycle dates | `VERIFIED_DATE` · `INFERRED_WINDOW` · `STALE_DATE` · `CONFLICTING_DATE` |

This is a deliberate house pattern, not a coincidence. Context health and
missing-context adopt the same shape rather than inventing a fourth and fifth,
which is why "stale", "conflicting", "unverified" and "not established" stay
distinguishable end to end instead of collapsing into "missing".

**Chunk 6 must preserve this in the UI.** Rendering all four as "missing" would
discard a distinction the product has maintained in three places.

## Chunk 5 is still the risk

Unchanged from the plan: switching `getFacts` from account-scope to
`pursuit_facts` is the first change to what the demo shows, and it lands on the
itinerary's §2 hero screen. Flag-gated, and the beat must be walked both ways
before any promotion.

---

# AS-BUILT — chunk 5A (2026-09-12)

Loaders and the integration harness are complete. **Chunk 5B is NOT STARTED.**

## What shipped

| File | Role |
|---|---|
| `src/lib/pursuits/read-models/context-loaders.ts` | Four thin loaders + four convenience `load*` wrappers |
| `scripts/vnext-context-verify.ts` | 42-assertion read-only integration harness |
| `scripts/verify-classes.ts` | registry entry `vnext-context` (**SEEDED**) |
| `src/lib/intel/company-intel.ts` | one word: `export function familiesFromSignalTypes` |

Commit `0f86079`. No rendered consumer; nothing imports `context-loaders`.

## Canonical source → read-model

| Read-model input | Canonical source |
|---|---|
| `ContextHealthInput.facts` | `pursuit_facts pf JOIN facts f ON f.id = pf.ref_id`, scoped `pf.pursuit_id` + `f.org_id` |
| `.completeness` | `provider_runs` (status `succeeded`, grouped by `provider_id`) + `distinct signals.signal_type` → `familiesFromSignalTypes()` |
| `.openContradictions` | `fact_contradictions` where `status='open'` and either fact side is linked to the pursuit |
| `LedgerRow[]` | `change_ledger` where `pursuit_id` + `org_id`, `order by occurred_at desc`, **no materiality predicate** |
| `MissingContextInput.stakeholderCoverage` | `getStakeholderCoverage(db, orgId, pursuitId)` |
| `.meddpicc` | `meddpiccFor(db, [coverage.opportunityIds[0]])` — `null` when no linked opportunity |
| `.valueCase` | `getValueCase(db, orgId, pursuitId)` → `{ state, missingDrivers: .missing }` |
| `.whyNow` | `getPursuitWhyNow(db, pursuitId)` |
| `.contextHealth` | `loadContextHealth(...)` |
| `PertinenceCandidate[]` | linked facts (non-REJECTED) + memory entries + `composeMissingContext` gaps |

## Decisions taken inside the loaders

**`requiredCategories` is deliberately unset.** Which coverage categories a
use-case depends on is policy, and encoding it in a loader would be the second
business-logic layer this chunk exists to avoid. Unset, `computeContextHealth`
judges against every category — the honest default when the dependency is
undeclared. Declaring it is follow-up work that belongs beside the other
coverage policy.

**Null `facts.disclosure_class` normalises to `INTERNAL`.** Not a new rule: the
existing `PARTNER_WITHHELD` in `src/lib/value/drivers.ts` already documents
"NULL = unclassified = INTERNAL" and `partnerVisible()` treats null as withheld.

**Null `pursuit_facts.relevance_type` normalises to `SUPPORTING_CONTEXT`** — the
neutral member of the existing vocabulary, not a new default.

## Verifier classification: SEEDED, not the requested EITHER

The brief asked for EITHER. `verify-classes.ts` defines EITHER as "run-scoped
fixtures, no reliance on demo content", and `verify-run.ts` gives EITHER suites a
**disposable** database. The brief also required the harness to mutate nothing.
Those two constraints are incompatible: a harness that writes nothing can only
read demo content, which is the definition of SEEDED — and on a disposable
database it would find no pursuit and assert nothing. Read-only was the stronger
constraint, so the class follows it. The reasoning is recorded in the registry
entry itself so it survives without this document.

## Two findings the harness surfaced

### 1. Synthetic-lineage defect in the canonical world — reported, not fixed

Two `change_ledger` rows carry `data_environment = 'PRODUCTION'` in a wholly
synthetic world: `PARTNER_OVERRIDE` and `OVERRIDE_RECORDED`, both on the Globex
hero pursuit that the demo's §2 beat turns on.

Cause: `recordChange()` defaults `dataEnvironment` to `'PRODUCTION'`
(`src/lib/pursuits/ledger.ts`), and the two override call sites —
`src/lib/routing/override.ts` and `src/lib/pursuits/overrides.ts` — omit it.

Effect: those entries are not labelable as synthetic by any surface that reads
`data_environment`.

**Not fixed here.** It is a seed-path change two days before the demo, and the
loader layer is the wrong place for it. The verifier prints it as a prominent
warning and asserts loader *fidelity* — `synthetic` mirrors the ledger exactly —
rather than world integrity, because conflating those two claims is what made my
first assertion wrong.

### 2. Pertinence task-fit ignores gap source — chunk 5B

`"No verified timing anchor"` ranks **second** in missing-context (rank 72) but
`VALIDATE_TIMING` does not lift it in pertinence. `TASK_FIT` matches `relevance`
types and `refTypes`; a WHY_NOW gap's `refType` is the generic `"pursuit"`, so
the single most timing-relevant item is invisible to the timing task.

Relatedly, all gaps of one kind **tie** in pertinence: a GAP's linkage comes from
`gapKind` alone, so the ranked order missing-context worked out — economic buyer
80, timing anchor 72 — is discarded. The observed GENERAL top-5 is five coverage
gaps at 69 while the two most important gaps do not appear.

**Chunk 4 was not redesigned** — it is approved, and its behaviour is correct as
specified. This is composition work: pertinence should consume the gap's `rank`
and `source`, not just its `kind`.

## Chunk 5B scope — unchanged risk

Still the first change to what the demo shows, still on the itinerary's §2 hero
screen, still flag-gated. See the recommendation in `SESSION-HANDOFF.md`.

---

# AS-BUILT — chunk 5B-1 (2026-09-12)

The composition defect chunk 5A surfaced is fixed. **Chunk 5B-2 is NOT STARTED.**

Commit `1b05b8a`. Files: `read-models/pertinence.ts`,
`read-models/context-loaders.ts`, `scripts/vnext-context-verify.ts`,
`tests/vnext-gap-pertinence.test.ts` (new). No rendered consumer; no seed-path,
ledger, schema or migration change.

## Semantic fields now carried onto `PertinenceCandidate`

| Field | Source | Why |
|---|---|---|
| `gapRank` | `ContextGap.rank` | the upstream layer's declared importance |
| `gapSource` | `ContextGap.source` | which domain produced it — lets a task match on domain |
| `whyItMatters` | `ContextGap.whyItMatters` | upstream explanation, never regenerated |
| `gapKind` | `ContextGap.kind` | already carried; the four-state distinction |

## Ranking design — substitution, not addition

Upstream: `rank = KIND_WEIGHT[kind] + SOURCE_WEIGHT[source] + (blocking ? 20 : 0)`.
Pertinence previously: `linkage = LINKAGE_BY_GAP[kind]`.

Those two encode the *same* question — how tightly does this bind to the
decision — at different resolutions. So the richer one **replaces** the coarser
one at the same `linkage` weight of 0.30. Nothing is added to the score, and
`LINKAGE_BY_GAP` survives only as the fallback for a candidate that arrives
without a rank.

Adding them would have counted gap kind twice. The test
`"upstream importance is not counted twice"` pins the consequence: two gaps with
identical `gapRank` but different `gapKind` must score identically, which is
impossible if kind is still applied on top.

**Normalisation is against the fixed 0..100 scale**, not against the other
candidates present. A relative normalisation would make each score depend on its
neighbours — and then removing a restricted item could move a visible one, which
silently breaks the disclosure invariance of D-018.

`taskFit` is a genuinely separate axis and remains a separate contribution:
upstream rank says how much a gap matters *in general*, task fit says whether it
serves the decision *at hand*. A VALUE_CASE gap has a constant source weight but
only leads when you are building a value case.

## Task-fit changes

| Context | Added | Rationale |
|---|---|---|
| `VALIDATE_TIMING` | `gapSources: ["WHY_NOW"]` | WHY_NOW **is** the timing/urgency domain |
| `ASSESS_RISK` | `gapSources: ["CONTEXT_HEALTH"]` | stale / superseded / disputed / weakly-evidenced context is risk to what we believe |
| `QUALIFY` | `gaps: ["MISSING"]` → `gapSources: ["MEDDPICC"]` | **not in the named scope.** `MISSING` is the commonest kind, so QUALIFY was treating a *timing* gap as a qualification gap — the same semantic confusion this chunk exists to fix. Caught by a test; source is the precise signal now that it travels. |

All matching is on canonical enums. No keyword framework was introduced.

## Measured effect on the Globex pursuit

| | before 5B-1 | after |
|---|---|---|
| GENERAL top 5 | five coverage gaps, all tied at 69 | economic buyer 69 · timing anchor 67 · decision process 62 · paper process 62 · value driver 60 |
| task contexts that reorder | 4 of 6 | **6 of 6** |
| VALIDATE_TIMING leader | "No economic buyer identified" (69) | **"No verified timing anchor" (79)** |
| verifier | 42 / 0 | **47 / 0** |

The GENERAL ordering now mirrors the upstream gap ranking exactly, which is the
whole point of D-019.
