# PursuitOS vNext — Build Plan

**Last updated:** 2026-09-14 (Slice 1 and Slice 2A DEMO CERTIFIED / FROZEN; Slice 2B PREVIEW READY locally)
**Lane:** `roadmap/pursuitos-vnext`
**Weekend target:** GATE A complete (done), then GATE B on explicit approval.

---

## What already exists — read this before planning anything

The Session 0 audit found that **much of P0–P2 is already built**. The vNext lane's
job is largely composition and completion, not greenfield construction. Treating
existing substrate as missing is the most likely way to damage this product.

### Already built and mature

| Roadmap area | Where it lives | What it already does |
|---|---|---|
| **Pursuit Memory substrate** | `change_ledger` (mig. `0065`, extended `0073`/`0079`/`0094`) | Append-only universal ledger. Org- and pursuit-scoped. `entity_type`/`change_type`/`before_state`/`after_state`, 4-level `materiality`, **actor (who) separated from trigger (what caused it)**, `model_version`, `agent_run_id`, and crucially **`occurred_at` (business time) distinct from `recorded_at` (record time)**. Indexed `(pursuit_id, occurred_at desc)`. Append-only is enforced at the grant level — `app_rw` has SELECT/INSERT but no UPDATE/DELETE. |
| **Materiality policy** | `src/lib/pursuits/materiality.ts`, `read-models/materiality.ts` | Single server-side authority for "is this material?" and "what class of attention is this?". `priorityDeltaMateriality`, `INHERENTLY_MATERIAL`, `classifyChange`, `isMaterial`, `isTimelineWorthy`, `todaySort`. Keeps **operational urgency separate from commercial priority**. The UI never decides materiality itself. |
| **Fact freshness** | `src/lib/facts/freshness.ts` | Predicate-specific freshness, not one global half-life. `decay()`, `eventProximity()`, `factFreshness()`, `sweepFreshness()`. Explicitly affects *confidence*, never *whether the proposition is true*. |
| **Research coverage** | `src/lib/intel/completeness.ts` | `COVERAGE_CATEGORIES` + `computeCompleteness()`, deliberately separate from propensity ("missing data is not low intent"). **Account-scoped.** |
| **Pursuit state** | `src/lib/pursuits/lifecycle.ts`, `src/lib/lifecycle/state.ts` | Lifecycle status + lifecycle facts/events. |
| **Why Now** | `getPursuitWhyNow` in `read-models/detail.ts` | Returns `businessTrigger`, `technologyCondition`, `timingAnchor`, `signalConvergence`, `routeRelevance`, `contradictions[]`, **`unknowns[]`**, `renderedSummary`, `asOf`, plus derived `lifecycle`. An embryonic "What's missing" already ships here. |
| **Timeline** | `getPursuitTimeline` + `MaterialChangeTimeline` | Reads `change_ledger` for a pursuit, filtered to timeline-worthy materiality. |
| **Per-domain gap computation** | `opportunities/meddpicc.ts` (`meddpiccGaps`), `opportunities/lifecycle.ts` (coverage checklist), `stakeholders/coverage.ts`, `value/case.ts` (absent drivers) | Several independent, correct "what's unknown" computations already exist. |
| **Feature flags** | `src/lib/pursuits/tenant-flags.ts` + `org_features`/`org_feature_changes` | `envEnabled(flag) && org_features.<flag>`, fail-closed, audited, dependency chains. |
| **Verification** | 33 suites, `scripts/verify-classes.ts` / `verify-run.ts` | FRESH (5) / SEEDED (13) / EITHER (14) / DEPLOYMENT_ONLY (1). |
| **Synthetic protection** | `environment_identity` (mig. `0102`), `assertSyntheticDatabase`, `CrossEnvironmentWriteError` | A guard that travels with the *data*, not the label. |

### Pursuit Detail already composes 18 surfaces

`PursuitHero`, `PursuitRail`, `MetricBand`, `WhyNowBento`, `FactsBento`,
`MaterialChangeTimeline`, `RoutePath`, `RecommendationChange`, `RouteCandidateTable`,
`RouteComparisonInsight`, `RouteDecision`, `ExecutionPlan`, `PursuitBriefButton`,
`OutcomePanel`, `DisclosureTheater`, `StakeholderPanel`, `LifecycleBento`,
`ValueCaseCard`.

**Implication for Slice 1:** the room is already dense. Slice 1 must make it *read
as one narrative*, not add a nineteenth panel. See `ACCEPTANCE.md`.

### The genuine gaps

These are the real, specific, verified deltas — the actual work.

1. **No pursuit-level context health.** Freshness exists per *fact*; coverage exists
   per *account*. Nothing composes them into "how well-supported is *this pursuit*,
   right now?"
2. **Memory is conflated with What-Changed.** `getPursuitTimeline` filters by
   `isTimelineWorthy(materiality)`, so LOW-materiality events never appear. That is
   correct for an executive attention feed and wrong for a memory: a memory is the
   full chronological record. These are two different read-models over one ledger.
3. **Timeline orders by record time, not business time.** `getPursuitTimeline` sorts
   by `recorded_at desc`. The ledger deliberately carries `occurred_at` for exactly
   this purpose, and the pursuit index is already `(pursuit_id, occurred_at desc)`.
   A chronological memory must use business time.
4. **Facts on Pursuit Detail are account-scoped, not pursuit-scoped.**
   `getFacts(db, r.account_id)` takes the top 20 by confidence for the *company*,
   ignoring `src/lib/facts/pursuit-link.ts`, which already models fact→pursuit
   linkage. So the "facts" panel can show facts irrelevant to this pursuit and hide
   relevant lower-confidence ones.
5. **"What's missing" is scattered.** Four independent gap computations exist with no
   single ranked answer to "what is the most important unresolved context here?"
6. **No "Why this pursuit?"** Why Now answers timing. Nothing answers pertinence —
   why this pursuit deserves attention at all, relative to the portfolio.

---

## Vertical slice strategy

We cut **vertical slices**: each one takes a real existing synthetic pursuit through
a complete path from canonical data to a visibly better surface. We do **not**
horizontally complete P0, then P1, then P2.

Each slice must:

- use existing canonical data and at least one existing synthetic demo pursuit,
- land behind a vNext flag, default OFF,
- leave the repository coherent at every commit,
- add no new top-level navigation,
- pass the full regression matrix before it is considered done.

### Slice order and dependencies

```
SLICE 1  Living Pursuit Context            (P1)        DEMO CERTIFIED / FROZEN
   │      context health · state · memory · why/why-now/what's-missing
   ↓
SLICE 2A Pursuit Coordination              (P3)        DEMO CERTIFIED / FROZEN
   │      Goal → Plan → Motion → Action on Pursuit Detail; durable, revisable plan
   │      (was "Next Move" — superseded by the P3 amendment, D-025). Human product
   │      acceptance passed on the isolated hosted Preview (ACCEPTANCE.md § Slice 2A)
   ↓
SLICE 2B Pursuit Attention + Today/Queue   (P3)        DEMO CERTIFIED / FROZEN
   │      derived pursuit attention on Today (one card per PURSUIT, not per account) · plan
   │      lineage on Queue · "Current approved plan" labelling · D-034…D-042, D-046 · no
   │      migration · Today/Queue tenant-scoped explicitly (D-041) · hosted human review PASSED
   ↓
H1  PRE-PILOT HARDENING GATE               (P6 / #67)  H1A · GATE 1 · H1B-0 · GATE 1b PASS · H1B-0.1 · GATE 1b.1 PASS · GATE 2 PASS · GATE 3 PASS · GATE 4 APPLIED (owner decision pending)  ← current
   │      H1B-0: partnership/consent flows work under app_rw — consent-scoped definer functions,
   │      a guard against forged consent rows, best-effort audit that cannot abort (D-049);
   │      /api/build posture proof. 0104 applied to the isolated hosted DB (Gate 1b PASS)
   │      H1B-0.1: temp-schema shadowing closed — migration 0105 pins pg_catalog, public, pg_temp
   │      on 31 authorization-sensitive functions (D-050); applied to the isolated hosted DB
   │      (Gate 1b.1 PASS: 31/31 hardened, 0 unsafe, business data unchanged)
   │      Gate 2 PASS: app_rw given LOGIN + operator credential (rolcanlogin false → true only;
   │      nothing else changed)
   │      Gate 3 PASS: app_rw.<ref> pooler login (SCRAM) proven; RLS exact on all 155 tables for
   │      no-context + 3 orgs; no context leak across 10 txns on one pooled backend; foreign
   │      writes refused; zero residue
   │      Gate 4 APPLIED: Preview (branch-scoped) DATABASE_URL_OWNER added; DATABASE_URL unchanged;
   │      runtime still postgres; owner paths + 37-room signed-in crawl identical before/after;
   │      fingerprint moved by the crawl's own render-time writes (/routines, /pipeline) on the
   │      pre-change deployment → owner decision (re-baseline or revert) before Gate 5
   │      H1A: every data path explicitly tenant-scoped (D-043); certification integrity —
   │      clone isolation + whole-world fingerprint gate (D-044); broad adversarial verifier
   │      H1B: web runtime → app_rw so RLS binds (D-045) — owner-approved hosted cutover
   │      H1 is NOT complete until H1B passes hosted certification. No product slice before it.
   ↓
SLICE 2C Coordination breadth              (P3)        NOT STARTED
   │      goal editing · plan closure · multi-pursuit plans · review recording on events
   ↓
SLICE 3  Portfolio Pertinence              (P2)
   │      "why this pursuit" ranked across the portfolio; Today + Pipeline ordering
   ↓
SLICE 4  Thin Control Plane + Run Ledger   (P4, P5)
   │      backend primitives: agent/skill registry, run ledger, cost/observability
   ↓
SLICE 5  Learning Loop                     (P8)
          prediction snapshots → decisions → outcomes → evaluation
```

Slice 1 is a hard dependency for 2 and 3: neither a next action nor a pertinence
ranking can be evidence-bound without state, memory and context health underneath.
Slice 4 is independent of 1–3 and can be interleaved. Slice 5 depends on 4 (it needs
the run ledger) and on 2 (it needs recommendations to score).

### VERTICAL SLICE 1 — "Living Pursuit Context"

**This is the identified first slice.** Full implementation plan in
`docs/vnext/SLICE-1-LIVING-PURSUIT-CONTEXT.md`.

Target path, on one existing synthetic demo pursuit:

```
canonical existing pursuit
  → facts/evidence/provenance (pursuit-scoped)
  → freshness
  → context health
  → pursuit state
  → chronological pursuit memory
  → Why this pursuit? / Why now? / What's missing?
```

Proving ground: **existing Pursuit Detail**, via progressive disclosure. Not a
redesign of Pursuit Detail.

**DEMO CERTIFIED / FROZEN (2026-09-14).** "What matters now" is frozen absent real
pilot feedback. Its accepted hierarchy: Why it matters · What we know (Confirmed for
this pursuit / Relevant account context) · Needs attention · What changed · Earlier
history.

### VERTICAL SLICE 2A — "Pursuit Coordination" (P3)

**PREVIEW READY on the local synthetic path (2026-09-14).** Acceptance: `ACCEPTANCE.md`
§ Slice 2A. Decisions: D-024…D-032.

```
Slice 1 context (focus gap · evidence · scope)
  → Pursuit Goal        pursuit_goals            proposed by PursuitOS, confirmed by a person
  → Pursuit Plan        pursuit_plans            stable identity a runtime can resume
      revisions         pursuit_plan_revisions   append-only: RECOMMENDATION ≠ DECISION
      milestones        computed from canonical domains, with declared dependencies
  → Motion              revenue_motions          reused — reached by a canonical link only
  → Action              motion_actions           reused — staged on approval, active motions only
  owner                 pursuit_team_members     a role; "Unassigned" is a first-class answer
  approve / adjust      dispatchSkill            recommend_pursuit_plan · decide_pursuit_plan
  divergence            pursuit_overrides        field 'plan'
  history               change_ledger            PLAN_DECIDED · PLAN_REVIEW_REQUIRED
```

Surface: one full-width "Pursuit plan" panel directly beneath "What matters now",
behind `VNEXT_PURSUIT_COORDINATION_ENABLED` (requires the Slice 1 chain).

**DEMO CERTIFIED / FROZEN (2026-09-14)** after human product acceptance on the isolated
hosted Preview. The twelve proven steps are in `ACCEPTANCE.md` § "Slice 2A human product
acceptance".

### VERTICAL SLICE 2B — "Pursuit Attention + Today / Queue coordination" (P3)

**DEMO CERTIFIED / FROZEN (2026-09-14)** after hosted human review on the isolated Preview.
Acceptance: `ACCEPTANCE.md` § Slice 2B. Decisions: D-034…D-042, D-046. One account may contain
multiple independent pursuits; Today composes one card per PURSUIT, not per account.

```
TODAY  = decision / attention layer          QUEUE = execution layer
  "what needs my judgment, and why?"           "what work exists, what do I execute?"

Slice 2A plan context (the SAME read Pursuit Detail makes — loadPursuitPlanContext)
  → pursuit-attention.ts (pure, derived)   7 reasons · declared order · one primary per pursuit
      keys: attention:<pursuit>:<kind>:<canonical ids>   (no table, nothing persisted)
  → composeAttentionQueue                  existing Today items fold under the pursuit's card;
                                           tenant-scoped; ranked by the existing todaySort
  → Today "Needs your attention"           the existing decision panel, composed — not a 2nd list
  → Queue lineage                          stagedMotionActionId → plan, decision, still current?
  → Pursuit Detail                         "Current approved plan" framing (labelling only)
  due buckets                              src/lib/motions/due-buckets.ts — one definition,
                                           shared by Queue and Today
```

Behind `VNEXT_PURSUIT_ATTENTION_ENABLED`, which requires `VNEXT_PURSUIT_COORDINATION_ENABLED`.
No migration, no new table, no write path.

---

## Weekend gates

Each gate is a decision point, not a milestone to be assumed passed.

### GATE A — Foundation ✅ PASSED (Session 0, 2026-09-12)
Safe vNext branch, preview path assessed, durable handoff documentation, flag
scaffolding. **No roadmap feature implementation may begin before this passes.**

### GATE B — Vertical Slice
One existing synthetic pursuit works end to end through the first
context/state/memory slice. Behind flags, visible in preview, demo untouched.

### GATE C — Product
Multiple pursuits work **and the UX is clearly better, not merely more
feature-rich**. If the room got denser, this gate fails.

### GATE D — Architecture
Thin Control Plane / domain-action / evaluation foundations established **without
destabilising the app**. Backend primitives only; no new user-facing navigation.

### GATE E — Promotion
Explicit human decision on whether anything is safe *and worthwhile* to promote to
Monday's demo. See `DEMO-PROMOTION-GATE.md`. **Default is NO.**

### Cutoff principle — non-negotiable

> **If a meaningful user-facing roadmap feature is not effectively complete by
> Saturday night, assume it will NOT ship to Monday's demo.**

Sunday is reserved for:

- review,
- cleanup,
- regression testing,
- UX refinement,
- certification,
- rollback validation.

Sunday is **not** additional build time. A feature finished Sunday afternoon has not
been regression-tested, and an untested change to a demo two days out is a worse
outcome than no change.

### Calendar reality for this weekend

| When | Available for |
|---|---|
| Saturday 2026-09-12 | Slice 1 implementation (on approval). Feature work stops Saturday night. |
| Sunday 2026-09-13 | Review, regression, UX refinement, certification, rollback validation. No new features. |
| Monday 2026-09-14 | **Demo day.** No changes. |
