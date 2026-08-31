# Intelligence Wave — P1A/P1B UX Normalization Pass

**Scope discipline:** presentation-only. No intelligence architecture, scoring, domain model, route
logic, outcome logic, relationship semantics, or governance changes were made in this pass — the
one new read-model (`getObservedActivationPattern`, §5) is a pure grouping of existing canonical
evidence with no stored artifact, no composite, and no feedback into scoring. No production
credentials or flags were touched, nothing external was sent, and the demo `outcome_learning`
gate is unchanged (enabled only for the demo vendor-sponsor org, fail-closed everywhere else).

Screenshots: **before** = `audit/intel-wave-screens/*` (captured at P1A/P1B completion),
**after** = `audit/intel-wave-screens/ux-after/*` (desktop light/dark 1440px, mobile 390px).

---

## 1. Motions — the card wall is gone

`/motions` now has four view modes on one URL-persisted `view` param, rendered as the same
segmented pills Pipeline uses. Nothing was removed; the exhaustive surface moved off the default
path.

| Mode | What it shows | Screenshot |
|---|---|---|
| **Overview** (default) | The hypothesis funnel cards only — stages, $ addressable/ready, cohort chips, honest outcome line ("calibration in Insights →"), "Why aren't the other N ready?" | `ux-after/motions-overview.desktop.png`, `.dark`, `.mobile` |
| **Constraints** | Per hypothesis: **"$4.4M currently constrained"** headline, then one row per blocker family — *Team role not staffed · 2 pursuits · $1.7M*, *Timing UNKNOWN · 1 pursuit · $1.4M*, *Participant acceptance · 1 pursuit · $990k*, *Below qualifying band · 2 pursuits · $210k*. Each row opens the drawer scoped to exactly those pursuits (`mstage=family:<FAM>`). | `ux-after/motions-constraints.desktop.png`, `.dark`, `.mobile` |
| **Pursuits** | Compact scale-native table: Account · Readiness · Primary constraint (click → family drawer) · Route · Team (accepted/required + pending) · Value · Outcome. Ranked by expected value, capped at 60 rows with an explicit "narrow the scope" line, horizontal scroll contained to the table's own container. | `ux-after/motions-pursuits.desktop.png`, `.dark`, `.mobile` |
| **Manage** | The **entire** previous page verbatim: Draft motions (AI) tool, the six bentos, status/partner/goal/group filters, the by-status chart, and the grouped motion card list with approve/reject/activate/complete/abandon/goal/initiative/edit-notes actions. | `ux-after/motions-manage.desktop.png` |

Mechanics preserved: the `qs` URL builder carries `view` alongside status/partner/goal/group/
scope/mdrawer/mstage, so filters, ecosystem scope, and the drawer survive view switches; a draft
run or `compose=1` deep-link lands on Manage automatically so its results are never hidden.
Grouping is by each pursuit's **primary blocker** — the first failing canonical gate — computed at
render from the same funnel view; there is no stored constraint table, no constraint score, and no
new domain object.

## 2. Constraint drawer — compress first, expand second

Default entry (see `ux-after/motions-drawer-family.desktop.png` / `.mobile`):

```
Initech Financial (expansion)                    $990k   [nearly ready]
PRIMARY BLOCKER
● Waiting on vendor account executive to accept   Mark accepted →
▸ +1 additional constraint
```

Line 1: account · expected value · readiness state. Line 2: the primary blocker as one
evidence-grounded sentence with its governed remedy deep-link. Line 3: a `<details>` element
holding the complete decomposition — every remaining gating constraint, informational overlays
(WEAK_EVIDENCE / ROUTE_CONTESTED / STAKEHOLDER_GAP, still never gating), and severities — so the
full P1A detail is one tap away, not deleted. Two-second comprehension verified on the mobile
capture. The drawer title resolves `family:` stages ("Participant acceptance — Virtualization");
pagination stays at 30 with the deterministic-ordering "next" link; it remains server-rendered
only when open.

## 3. Reusable constraint presentation

`src/components/intel/constraint-language.tsx` is the single constraint vocabulary:
`ConstraintView { blockedBy, why?, exposureUsd?, severity HARD|SOFT|UNKNOWN, action? }` rendered
by `ConstraintLine` (dot · blocked-by · why · exposure · governed action) and
`ConstraintAggregateRow` (label · count · $ · click-through). The Motion drawer, Constraints
panel, and Pursuits table all render through it; Today, Pursuit Detail, Pipeline, Queue, Partner
and the Brief already phrase constraints in the same blocked-by/why/exposure/remedy structure and
can adopt the component verbatim as they are next touched. UNKNOWN renders neutral (never an
alarm), exposure renders only when known, and severity colors follow the canonical vocabulary. It
is pure presentation — no store, no score.

## 4. Partners — intelligence separated from administration

`/partners/[id]` first viewport (see `ux-after/partner-cdw.desktop.png`, `.dark`, `.mobile`) now
answers, in order: **presence** (overlap/claimed/asserted tiers) · **activation** (candidate →
recommended → SELECTED, invitations, acceptance median with n) · **execution & outcomes**
(canonical wins/losses + attribution classes, by category) · **what's waiting** (blocking
invitations, coverage gaps) · **where to activate** (§5 below) · the **Scorecard** (win rate,
cycle, sourced/influenced still labeled "registration-based (settlement)", responsiveness) · the
**Execution rollups** (motions/campaigns/pipeline/won/accounts with this partner).

Classification applied:

| Commercial intelligence (first tier) | Partnership operations (under "Manage partnership") |
|---|---|
| Activation Profile (hero) | Initiatives (create/complete/archive + rollups) |
| Observed activation pattern (§5) | Trust ladder (read + Admin links) |
| Scorecard bentos | Their book · Shared lists · Joint rooms |
| Execution bentos | Warm intros (request/decide) |
| | Playbook (edit) · Evidence exchange · Skill sharing · Settlement |

The operations tier sits under one `<details>` ("Manage partnership — initiatives · trust ladder ·
… · settlement"). **Progressive disclosure never hides a pending decision**: the summary shows an
"N decisions waiting" chip and the section auto-opens whenever an intro request, skill/evidence
offer, joint-room proposal, or ladder rung awaits this side, or when an action redirect
(`?intro=`, `?playbook=`, `?initiative=`) lands. `ux-after/partner-cdw-manage-open.desktop.png`
shows every operation intact when expanded (partnership-gated sections — intros, evidence, skills,
settlement — still render exactly when an active partnership exists, unchanged). Nothing deleted;
no navigation redesign.

## 5. "Where should I use this partner?" — observed pattern, not a score

`getObservedActivationPattern(db, orgId, partnerId)` groups the partner's **existing** route and
execution evidence by category × asserted relationship state and reports per cell: candidate
pursuits, governed selections, acceptances, terminal canonical outcomes, industry segments
observed — every figure with its sample size. Rendered in the Activation Profile as "WHERE TO
ACTIVATE · OBSERVED PATTERN":

> *Virtualization · active-relationship accounts — candidate 7 · selected 6 · accepted 3 · 3W/2L
> (n=3)* `insufficient evidence` *segments: Consumer Goods, Financial Services, Healthcare*

Honesty properties, all visible in the CDW capture: every cell below the calibrated floor (n≥5,
the same MIN_CALIBRATED_SAMPLE as Motion Intelligence) is chipped **insufficient evidence** and the
footer states "observations, not a score — nothing here feeds route scoring · every cell is below
the calibrated floor, so this reads as early observation only". A partner with no evidence renders
**UNKNOWN** with the sentence naming what evidence is missing. There is no composite number and no
feed into route selection (fit-v2 remains deferred and versioned).

## 6. Recency — honest UNKNOWN preserved; the missing producer named

`seller_account_relationships.last_interaction_at` remains nullable and NULL still renders
**UNKNOWN** everywhere (seller paths recency, acceptance medians, decay factor neutral 0.5). No
fabrication and no new interaction integration were added.

**Documented future requirement (not built):** the platform has no lifecycle producer for
`last_interaction_at` — nothing stamps it when a seller actually interacts with an account. A
future slice must define the producing events (e.g., governed team actions, logged communications
via the existing interaction_events pipeline, or an explicit human assertion skill) and their
provenance rules before recency can ever be non-NULL at scale. Until that producer exists, UNKNOWN
is the correct and permanent answer, and any UI displaying recency must keep rendering it.

## 7. P1C locked decisions — untouched

No stakeholder work was started. All P1C decisions remain exactly as locked: additive stakeholders
extension, nullable `pursuit_id`, `source` provenance, verified/inferred/unverified, governed
`assert_stakeholder_role`, no title→role inference, buying-side Brief confidential by default,
pre-opportunity coverage UNKNOWN in v1, no PK relaxation.

## 8. UX acceptance

Checked at demo scale and simulated large scale (§9), desktop 1440px + mobile 390px, light + dark
(dark via the real `pursuitos:theme` boot path, not a stub):

- **Card walls:** gone from the default path (Overview = one card per hypothesis; blocked accounts
  compress to aggregate rows — at simulated scale, 306 blocked accounts render as 5 rows).
- **Scrolling:** the Pursuits table scrolls horizontally inside its own container; the page body
  never scrolls sideways (verified on the 390px captures).
- **Repeated information:** Outcomes stay a one-line rollup linking to Insights — the calibration
  detail is not duplicated; the Motions bentos/chart now render only in Manage.
- **Density:** table truncates the constraint cell with a title tooltip (defect found in the first
  capture round, fixed, re-captured); drawer entries are three lines by default.
- **Drawer overflow:** compressed default + `<details>` expansion + 30-row pagination.
- **Hierarchy:** intelligence before administration on both surfaces; eyebrow labels consistent.
- **Controls:** the view pills reuse Pipeline's segmented-control pattern; filters keep QuerySelect.
- **Over-exposure:** disclosure unchanged — partner-facing renderings and the settlement labeling
  boundary verified by the suites below.

## 9. Scale verification

`scripts/ux-scale-sim.ts` (kept, reproducible): inside one transaction it inserts **300 synthetic
evaluated companies** (half qualified/high, half below band) on the busiest hypothesis, re-derives
everything, asserts, and **rolls back**. Result — 12/12:

- funnel absorbs the cohort (310 evaluated) and derives in **16ms**; aggregation in **1ms**;
- aggregation reconciles exactly (family counts sum to gated accounts; exposure sums match);
- 306 blocked accounts compress to **5** aggregate rows — the card-wall failure mode cannot recur;
- family drill-ins resolve their aggregates exactly (`NO_PURSUIT`:150, `BELOW_PROPENSITY_BAND`:152);
- the 60-row table cap and 30-row drawer page both engage;
- rollback proven: evaluated count restored, zero synthetic companies survive.

## 10. Regression evidence (all green, this pass)

| Suite | Result |
|---|---|
| motion-intel-verify | 20/20 |
| partner-intel-verify | 17/17 |
| canonical-microloop | 23/23 |
| route-persistence | 10/10 |
| team-motion | 18/18 |
| outcome-bridge | 13/13 |
| closed-loop | 18/18 |
| recompute | 20/20 |
| outcomes | 18/18 |
| append-only | 11/11 |
| disclosure | 21/21 |
| lifecycle-acceptance | 21/21 |
| migrations-only routing | 5/5 |
| unit tests | 130/130 |
| ux-scale-sim (new) | 12/12 |
| production build | clean |

Isolation, disclosure, federation, governed mutation, route persistence, canonical lifecycle, the
outcome bridge, recompute, append-only, and both intelligence suites are covered above; no
regressions were introduced. One visual defect was found and fixed during acceptance (Pursuits
table constraint-cell overflow into the Route column).

## 11. Nothing removed — the checklist

- Motions: draft-AI tool, bentos, filters, group-by chart, grouped cards, every lifecycle action,
  next-step CTA, notices, drawer, scope, URL state — all present (Manage view + always-on notices).
- Motion drawer: full constraint decomposition, informational overlays, governed remedies,
  pagination — all present behind "+N additional constraints".
- Partner room: scorecard, initiatives, trust ladder, book, shared lists, joint rooms, warm intros,
  playbook, evidence exchange, skill sharing, settlement, execution — all present; operations
  under "Manage partnership" with pending-decision auto-open.

## 12. P1C readiness

The substrate this pass leaned on is exactly what Stakeholder Intelligence needs: the constraint
language component gives `STAKEHOLDER_GAP` (and future stakeholder constraints) a ready rendering
slot; the Pursuits table has a natural coverage column position; the partner room's
intelligence-first layout gives relationship-map surfaces a home above the operations fold. With
this pass verified and the locked decisions untouched, **P1C Stakeholder Intelligence is ready to
open** on explicit approval.

**HALTED FOR REVIEW.**
