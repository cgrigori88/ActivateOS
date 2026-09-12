# PursuitOS vNext — Decisions

Durable architecture, product and UX decisions for the vNext lane. Append, don't
rewrite: a superseded decision stays, marked `SUPERSEDED`, with the reason.

**Last updated:** 2026-09-12T02:47Z

---

## D-001 · Preserve the existing product

**Decision.** vNext is an additive evolution of PursuitOS. There is no "vNext app",
no parallel product, and no rewrite.

**Why.** The existing application is a certified, demo-ready product with mature
substrate for much of P0–P2. Rebuilding would discard working governance, disclosure
and demo-integrity machinery that took many waves to get right, and would trade a
known-good product for an unknown one.

**Consequence.** Every slice lands underneath surfaces users already know. A change
that requires a new room needs an explicit exception recorded here.

---

## D-002 · Progressive enhancement over rebuild

**Decision.** New primitives are consumed by existing surfaces, not exposed as new
ones. Today, Pipeline, Pursuit Detail, Approvals, Activity, Partner View and
command/search get smarter; they do not get replaced.

**Why.** The value is in the app becoming more intelligent, not in there being more
app. Users measure improvement by better decisions, not by more screens.

---

## D-003 · Complexity underneath, clarity on top

**Decision.** The architecture may become significantly more complex. The interface
must become **no more complex — and ideally simpler.**

**Consequence.** A slice that adds a panel must justify why it could not instead
deepen, replace or merge an existing one. Pursuit Detail already composes 18
surfaces; adding a nineteenth is a failure mode, not progress.

---

## D-004 · Recommendation ≠ decision

**Decision.** A recommendation is never silently promoted to a decision, and a human
decision never overwrites the recommendation that preceded it. Both are preserved
and both remain visible.

**Why.** This is already a load-bearing product invariant — the Globex demo beat
turns on "Recommended CDW vs Selected WWT (human override — recommendation
preserved)". It is also what makes the learning system (P8) possible at all: you
cannot learn from overrides you have overwritten.

**Consequence.** Any new recommendation surface (next-best action, pertinence
ranking) must persist the recommendation independently of the human choice.

---

## D-005 · Generated narrative never replaces canonical evidence

**Decision.** LLM-generated prose may *summarise* or *sequence* canonical evidence.
It may never *be* the evidence, and it may never assert something the canonical
record does not support.

**Consequence.** Every explanatory surface cites its source records. If there is no
evidence, the honest output is an explicit UNKNOWN — not a fluent sentence. The
existing `WhyNowView.unknowns[]` is the pattern to follow: the product already says
"No verified timing anchor" rather than inventing one.

---

## D-006 · State ≠ memory

**Decision.** Pursuit **State** is what PursuitOS currently believes. Pursuit
**Memory** is the full chronological record of how that belief came to be. They are
two distinct read-models over one append-only ledger, and neither substitutes for
the other.

**Why.** The audit found these conflated: `getPursuitTimeline` filters by
`isTimelineWorthy(materiality)`, so LOW-materiality events never appear. That is
correct for an executive attention feed ("What Changed") and wrong for a memory,
which must be complete. Additionally it orders by `recorded_at` (when PursuitOS
wrote the row) rather than `occurred_at` (when the change happened in the business)
— and `change_ledger` carries both deliberately, with the pursuit index already on
`(pursuit_id, occurred_at desc)`.

**Consequence.** Memory reads by business time and does not filter by materiality;
What-Changed keeps its current filtering. Three read-models over one ledger, not one
compromise.

---

## D-007 · LLM reasoning is separated from deterministic authorization, calculation and mutation

**Decision.** Models may interpret, rank, summarise and explain. They may not
authorize, compute a reported metric, or perform a mutation. Authorization,
arithmetic and writes are deterministic code.

**Why.** A number a user acts on must be reproducible, and a permission decision
must be auditable. Neither property survives being delegated to a model.

**Consequence.** Scoring stays in `src/lib/scoring` and `src/lib/pursuits/scoring.ts`.
Materiality stays a server-side policy authority
(`read-models/materiality.ts`) — "the UI never decides `delta > 5 = material` on its
own", and neither does a model.

---

## D-008 · New consequential writes trend toward governed domain actions

**Decision.** Any new write with commercial or cross-company consequence is
implemented as a governed domain action — approval-gated, audited, and recorded in
the ledger — rather than as a direct mutation from a surface.

**Consequence.** Slices that only read (Slice 1) need no new governance. Slices that
act (Slice 2 onward) must route through the existing governed-action machinery
(`GOVERNED_ACTION_ENABLED`, `governed_action_invocations`, which is append-only).

---

## D-009 · Private, shared and derived context must remain distinguishable

**Decision.** For every piece of context the system holds, it must remain
answerable: is this ours alone, was it shared with us, or did we derive it? The
distinction is never flattened.

**Why.** It is the basis of the intercompany trust boundary (P6) and of the
disclosure behaviour the demo depends on — the Sponsor⇄Partner toggle removes a
confidential figure **at the server**, "absent from this payload, not hidden in the
browser". Flattening provenance would make that guarantee unenforceable.

**Consequence.** New context primitives carry provenance from the start.
`facts.provenance_class` and the contribution model are the existing precedent.

---

## D-010 · Dynamic Pursuit Surfaces cannot invent permissions, metrics or write logic

**Decision.** A dynamic surface composes canonical data, existing metrics and
existing governed actions. It never defines its own data model, permission rule,
metric definition, state mutation or write path.

**Why.** A surface that can define its own permissions is a permission bypass with a
friendly name. A surface that can define its own metric produces numbers that do not
reconcile with the rest of the product.

**Consequence.** The dynamic-surface layer is a *query and composition* layer over
registered, named primitives — the existing intent registry (`src/lib/search/registry.ts`,
`intents.ts`) and interpreter catalog (`src/lib/interpret/catalog.ts`) are the
precedent to extend, not replace.

---

## D-011 · AI Control Plane and Pursuit Runtime start as thin backend primitives

**Decision.** P4 and P5 land first as backend registries, ledgers and observability
— **not** as major user-facing navigation. No "Control Plane" room.

**Why.** Operator tooling that arrives before the capability it governs is dead
weight, and a new top-level room contradicts D-003.

**Consequence.** `VNEXT_CONTROL_PLANE_ENABLED` is deliberately independent of the
tenant `experience` gate in `src/lib/env/vnext-flags.ts`, because it exposes no
tenant surface. Existing `/skills`, `/ops` and `/admin` are the surfaces to deepen
if operator visibility is needed.

---

## D-012 · Architecture terminology is never user-facing

**Decision.** Users never see "Context Health Engine", "Pursuit State Engine",
"Pertinence Engine" or similar. Internal names stay internal.

**Consequence.** The Slice 1 surface reads as *Why this matters · Current state ·
What changed · What's missing · Next move*, in the product's existing plain-language
voice.

---

## D-013 · vNext flags are a separate, narrowing staging layer — not a second flag system

**Decision.** vNext roadmap flags live in `src/lib/env/vnext-flags.ts` as
**env-only** gates. They do not get `org_features` columns until the capability
behind them is real.

**Why.** The shipped system is `envEnabled(flag) && org_features.<flag>` — env
master plus per-org opt-in, fail-closed and audited. That is the right shape for a
*shipped* capability being piloted by one tenant. It is the wrong shape for an
*unbuilt* capability, because adding `org_features` columns would mean migrating the
demo database for features that do not exist.

Env-only is also exactly the granularity the requirement needs: the preview
deployment arms them, demo and production set none of them and are dark by omission.

**The safety property, and how it is enforced structurally.** A vNext flag can only
ever **narrow**. It can hide a surface; it can never reveal one, widen a scope,
satisfy a permission check, or stand in for the tenant gate. This is enforced by
type signature, not convention: `vnextCapabilities(tenant: TenantFeatureView)` takes
the already-resolved tenant gate as a parameter and ANDs against it, so a caller
cannot reach a vNext capability without first having called
`tenantFeatures(db, orgId)`. There is no exported reader that grants a user-facing
capability from a vNext flag alone.

**Graduation path.** When a capability becomes real it gains an `org_features`
column, moves under the tenant system, and its vNext flag is retired.

**Naming.** `VNEXT_<CAPABILITY>_ENABLED` — the `VNEXT_` prefix marks the staging
lane; the `_ENABLED` suffix matches the existing `PURSUITS_ENABLED` family so the
whole flag surface greps as one thing.

---

## D-014 · Session 0 develops against the local synthetic path, not preview

**Decision.** Slice development uses the local synthetic database
(`scripts/seed-demo-world.ts` against local Postgres `pursuit_demo`). Preview
deployments are for **read-only visual review** until preview write-safety is
verified.

**Why.** Preview data access is classified **UNKNOWN**, and the available evidence
suggests Preview may share `DATABASE_URL` with Production — i.e. the hosted database
that serves Monday's demo. See `ENVIRONMENT-MAP.md` §6.

**Consequence.** No preview writes. No new database. No credential changes. The
local path is already isolated, already seeded, and already guarded by
`assertSyntheticDatabase`.

---

## D-015 · Completion does not imply deployment

**Decision.** Finishing a feature is not a decision to ship it. Promotion to the
demo requires explicit human approval against `DEMO-PROMOTION-GATE.md`, and the
default answer this weekend is **NO**.

**Why.** There is a demo on Monday 2026-09-14. A feature completed late and promoted
untested is strictly worse than no feature.

---

## D-016 · Slice 1 read-models are pure functions over typed inputs; loaders land with their consumer

**Decision.** `context-health.ts`, `memory.ts`, `missing-context.ts` and
`pertinence.ts` export pure composition functions taking explicit typed inputs.
They perform no database access. The SQL loaders that feed them are written in
chunk 5, alongside the first consumer and the integration verifier.

**Why.** Chunks 1–4 were required to be independently reviewable and to have no
rendered consumer. A loader with no consumer and no integration test is code
nobody has executed against a real schema — it would look finished and be
unverified. Pure functions with declared inputs can be exhaustively tested with
no database at all, which is what actually happened: 67 tests, no fixtures, no
container.

The input types are shaped as direct projections of the canonical tables
(`facts` ⋈ `pursuit_facts`, `change_ledger`), so the loaders are mechanical
rather than interpretive. Nothing is reinterpreted between SQL and composition.

**Consequence.** Chunk 5 adds the loaders *and* their verifier together. A loader
must never merge without an integration test that runs it against a real schema.

---

## D-017 · Pertinence is pursuit- and decision-relative; portfolio-relative pertinence is a different question

**Decision.** `pertinence.ts` answers "within this pursuit, and for the decision
this caller is making, what should they look at next?" It ranks facts, remembered
events and open gaps against each other on one list.

It does **not** answer "why this pursuit rather than another one". That is a
portfolio ranking question, it needs cross-pursuit inputs this module
deliberately does not take, and it belongs to Slice 3.

**Why.** The Slice 1 plan described this module as "Why this pursuit? — pertinence
relative to the portfolio". Building it revealed those are two different
computations with different inputs and different consumers. Conflating them
would have produced a module that did neither well, and would have pulled
cross-pursuit data into a pursuit-scoped slice.

**Consequence.** The Slice 1 narrative's "Why this matters" is assembled from
context health, the top gap and the top pertinent items — all pursuit-scoped.
A genuine portfolio-relative "why this pursuit" is deferred to Slice 3 and is
noted as such in `BUILD-PLAN.md`.

---

## D-018 · Disclosure filters before ranking, never penalises within it

**Decision.** Anywhere a read-model ranks or counts, items the caller may not see
are removed **before** the computation and contribute nothing — not a lowered
score, not a displaced neighbour, not a reason string. Only an aggregate count is
disclosed.

**Why.** A restricted item that merely scores lower still shifts the positions of
the visible items around it. Its existence, and something about its properties,
becomes inferable from the ordering. That is a leak by arithmetic, and it is
invisible to a test that only checks "the secret string is absent".

**Consequence.** `rankPertinence` filters first and is tested by comparing the
complete visible ranking with and without a restricted item present, asserting
the scores and order are identical. `composeMissingContext` applies the same rule
and additionally refuses to report un-entitled information as the caller's own
knowledge gap — a boundary is not a hole.

---

## D-019 · Composition must preserve upstream meaning

**Decision.**

> A downstream intelligence layer may re-rank information for a task, but it must
> not silently discard the importance, source, state, confidence, provenance, or
> other decision-relevant semantics established by an upstream canonical or
> read-model layer.

**Why.** Chunk 5A's harness caught exactly this failure. `composeMissingContext`
ranked the Globex pursuit's gaps carefully — economic buyer 80, timing anchor 72,
qualification 56, value drivers 50 — and the conversion into
`PertinenceCandidate` kept only `gapKind`. All eleven MISSING gaps then tied on
linkage, the two most important gaps vanished from the top five, and the timing
task could not see a timing gap. The information was not wrong anywhere; it was
*dropped in transit*.

**The division of authority this implies.**

| Layer | Authoritative for |
|---|---|
| Upstream (gap / canonical read-model) | gap kind and state · source and domain · declared importance / rank · explanation · provenance |
| Downstream (pertinence) | task-relative relevance · user- and scope-relative relevance · recency · pursuit linkage · unresolved state · corroboration |

**This is not a licence to duplicate business logic.** Preserving upstream
meaning means *carrying* it, never recomputing a parallel version of it. If a
downstream layer needs a number the upstream layer already produced, it takes
that number.

**And carrying is not the same as adding.** Where the upstream value and a
downstream signal answer the *same* question, the richer one **replaces** the
coarser one — it is never summed on top, which would count one business signal
twice and make the arithmetic indefensible. Where they answer *different*
questions (upstream importance vs task fit), they are separate contributions.

**Test for a violation:** can a reader answer "why did this rank here?" from the
exposed contributions alone? If the answer requires knowing something the
upstream layer decided and the downstream layer silently re-derived, the
composition is wrong.
