# PursuitOS vNext — Acceptance Criteria

**Last updated:** 2026-09-12T02:47Z

Every slice is measured against both halves of this file. Functional correctness
without the UX bar is a failed slice, and vice versa.

---

## The governing principle

> **The architecture may become significantly more complex. The interface must
> become no more complex — and ideally simpler.**

---

## Part 1 — Functional acceptance

### Must hold for every slice

| # | Criterion |
|---|---|
| F-1 | **Nothing existing regresses.** All 33 verifier suites, `typecheck`, `npm test` and `next build` pass. Pre-existing failures are recorded separately from new ones. |
| F-2 | **Behind a flag, default OFF.** The capability is invisible with no env set, in demo and in production. |
| F-3 | **Flags narrow only.** No vNext flag can reveal a surface, widen a scope, or satisfy a permission check. Enforced by `vnextCapabilities(tenant)` taking the resolved tenant gate as a parameter. |
| F-4 | **Evidence-bound.** Every claim the UI makes traces to a canonical record. No asserted fact without a source. |
| F-5 | **Honest unknowns.** Missing context renders as an explicit unknown, never as a confident-sounding sentence or a zero. A zero and an unknown are different values and must look different. |
| F-6 | **Recommendation ≠ decision.** Recommendations persist independently of human choices; an override never overwrites what was recommended. |
| F-7 | **Disclosure unchanged.** Confidential values are withheld **at the server**, absent from the payload — not hidden in the browser. The Sponsor⇄Partner split still behaves exactly as it does today. |
| F-8 | **Provenance preserved.** Private / shared / derived context remains distinguishable end to end. |
| F-9 | **Synthetic-cannot-send preserved.** `externalSendingArmed()` stays false unless `OUTREACH_AUTOSEND === "on"`. No new code path can send externally without passing the existing approval gate. |
| F-10 | **Additive migrations only.** No destructive migration. No column drop, no type narrowing, no data deletion, no backfill that overwrites existing values. |
| F-11 | **Numbers reconcile.** The canonical demo facts still hold: 11 open opportunities, $8,040,000 open, $3,361,500 weighted, $1,850,000 motion value, 14 pursuits. |
| F-12 | **Deterministic where it counts.** Authorization, arithmetic and mutation are deterministic code. Models interpret, rank, summarise — they do not authorize, compute reported metrics, or write. |
| F-13 | **Append-only respected.** `change_ledger`, `governed_action_invocations` and `pursuit_overrides` are insert-only. No slice introduces an update or delete against them. |
| F-14 | **Rollback is a revert, not a repair.** Turning the flag off, or reverting the commit, returns the product to its prior behaviour with no data cleanup required. |

### Slice 1 specific

| # | Criterion |
|---|---|
| S1-1 | One named existing synthetic pursuit renders the full path: pursuit → pursuit-scoped facts/evidence/provenance → freshness → context health → state → chronological memory → why this / why now / what's missing. |
| S1-2 | Context health is computed at the **pursuit** level and composes existing fact freshness with existing coverage. It does not re-implement either. |
| S1-3 | Memory is chronological by **`occurred_at`** (business time) and is **not** filtered by materiality. What-Changed keeps its existing materiality filter. The two are visibly different things. |
| S1-4 | Facts shown on Pursuit Detail are **pursuit-scoped** via the existing `facts/pursuit-link.ts`, not the current account-scoped top-20-by-confidence. |
| S1-5 | "What's missing" is one ranked answer composed from the existing per-domain gap computations (MEDDPICC, stakeholder coverage, value drivers, timing anchor) — not a fifth independent one. |
| S1-6 | Read-only. Slice 1 introduces **no writes**. |
| S1-7 | A pursuit with thin context still renders correctly and says so, rather than rendering empty panels. |

---

## Part 2 — UX acceptance

These are not suggestions. A slice that fails these has not landed.

| # | Criterion |
|---|---|
| U-1 | **Do not expose backend architecture as UI complexity.** The user sees a narrative, not a system diagram. |
| U-2 | **Progressive disclosure.** The default view carries the conclusion; detail is one deliberate interaction away. Depth is available, not imposed. |
| U-3 | **No new top-level navigation** unless genuinely necessary. Slice 1 adds none. |
| U-4 | **One primary action or decision dominates each state.** If the eye has to choose between three equally weighted things, the hierarchy is wrong. |
| U-5 | **Explanations are concise and evidence-backed.** A short sentence that cites a record beats a paragraph that does not. |
| U-6 | **No dashboard or gauge explosion.** A number does not earn a tile by existing. |
| U-7 | **No dense control panels built merely because data exists.** |
| U-8 | **Apple-like hierarchy, whitespace, clarity, restraint and discoverability.** Generous space, few weights, obvious primary, quiet secondary. |
| U-9 | **New capabilities should make the product feel simpler, not more complicated.** If Pursuit Detail feels busier after the slice, the slice is not done. |
| U-10 | **Desktop and mobile/responsive both considered.** Verified at ~1600×1000 (the presentation viewport) and at phone width. No horizontal body scroll. |
| U-11 | **The existing demo visual language is not casually replaced.** Reuse the established tokens, `Card`/`Panel`/`Bento` primitives and type scale. Introducing a new visual idiom needs a recorded decision. |
| U-12 | **No architecture terminology in the interface.** Never "Context Health Engine", "Pursuit State Engine", "Pertinence Engine". |

### The Slice 1 target voice

The surface should read approximately as:

> **WHY THIS MATTERS** — short, evidence-backed explanation.
>
> **CURRENT STATE** — what PursuitOS currently believes is happening.
>
> **WHAT CHANGED** — concise chronological updates.
>
> **WHAT'S MISSING** — the most important unresolved context.
>
> **NEXT MOVE** — eventually one recommended next action (may belong to Slice 2).

Plain language, the product's existing voice, no engine names.

### The density test

Pursuit Detail already composes 18 surfaces (`PursuitHero`, `PursuitRail`,
`MetricBand`, `WhyNowBento`, `FactsBento`, `MaterialChangeTimeline`, `RoutePath`,
`RecommendationChange`, `RouteCandidateTable`, `RouteComparisonInsight`,
`RouteDecision`, `ExecutionPlan`, `PursuitBriefButton`, `OutcomePanel`,
`DisclosureTheater`, `StakeholderPanel`, `LifecycleBento`, `ValueCaseCard`).

**Before adding anything, answer in writing: which existing panel does this
replace, absorb or deepen?** "None — it's additional" is an answer that needs an
explicit exception recorded in `DECISIONS.md`. The likely correct shape for Slice 1
is that Why Now, Facts and the Change timeline are *absorbed* into one coherent
context narrative, so the panel count goes **down**.

---

## Verification evidence required

A slice is not accepted on assertion. Each slice must record:

- the four validation results (`typecheck`, `npm test`, verifier suites, `next build`),
  with pre-existing failures listed separately;
- the named synthetic pursuit used, and its id;
- desktop and mobile screenshots of the changed surface, flag ON and flag OFF;
- confirmation that flag OFF is byte-identical in behaviour to the pre-slice product;
- the reconciled canonical demo numbers.

---

## Added after chunk 6B — UX rules learned from the first rendered slice

| # | Criterion |
|---|---|
| U-13 | **Collapsing panels must preserve their anchors.** `#whynow`, `#evidence` and `#activity` are deep-link targets from Today, the lifecycle horizon, intents and the section rail. A three-for-one panel merge that drops an anchor silently breaks six navigation paths and no test would notice. Carry every collapsed anchor onto the replacement. |
| U-14 | **State language is chosen in the view-model, never in the component.** All five state phrasings come from one declared table (`CONTEXT_STATE_LABEL`). A component that picks its own wording from a state is where the four-state vocabulary quietly collapses during a later style pass. |
| U-15 | **A caveat that only fires in the top slot is not a caveat.** The Globex timing note was first attached to the top-ranked gap; on real data the economic-buyer gap outranked timing, so the note stayed silent while the page showed a verified-looking renewal date elsewhere. A correctness note must be driven by the condition it describes, not by ranking position. |
| U-16 | **Verify a flag-off claim by rendering it.** "Unchanged because the flag defaults off" is not evidence. Render the pre-change commit and the post-change commit with the flag off and compare bodies; the only permitted differences are per-build asset filenames. |

## Added after the GATE C refinement — lessons from the first reviewed slice

| # | Criterion |
|---|---|
| U-17 | **A disclosure must reveal what it counted.** "Earlier history (7 more)" that expands to a pointer is worse than no disclosure: the count is a promise, and a reader who opens it and finds nothing has been told the product lost their data. Define the count *as* the length of what will render (`hiddenCount = earlier.length`) so the two cannot drift. The same applies to a bare count with no affordance at all — "10 other unresolved items." with nothing to open is a number where the reader expected a door. |
| U-18 | **Absorbing panels changes the page's row structure, not just the panel.** A three-for-one merge made one grid cell 1,068px tall beside a 475px neighbour (593px of dead space below the fold) and left a third panel without a row partner. Panel count went *down* and the page got *no shorter*. So when a merge lands, measure the column imbalance and the orphaned neighbours, not only the panel count — and check whether the surviving half-width panels still pair evenly. |
| U-19 | **Scope belongs in the chip, not only in the heading above it.** An account-scoped fact under a "Relevant account context" heading still rendered a bare "Verified" chip, and the chip is the most-skimmed element on the row: it read as verified *for the pursuit*. Qualify the label itself ("Verified on account") wherever a state is true at a different scope from the thing the reader is looking at. Leave already-degraded states unqualified — they say the claim is not to be relied on, so scope adds noise. |
| U-20 | **Copy that reads like machine output is a defect, not a polish item.** "1 independent families", "champion — verified (supersedes champion — inferred)", "Linked fact (SOLUTION_FIT)" were all correct and all read as database exhaust. Translate in the view-model, from the canonical *structure* rather than by parsing the canonical prose, degrade to the canonical string for any vocabulary the table has not seen, and keep the canonical value on the line. See D-022. |
