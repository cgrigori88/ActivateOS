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

---

## Slice 2A — Pursuit Coordination (Goal → Plan → Motion → Action)

Acceptance pursuit: the canonical **Globex Manufacturing Inc.** hero pursuit
(`MODERNIZATION`, "Exit legacy virtualization before renewal"). Flag:
`VNEXT_PURSUIT_COORDINATION_ENABLED` (requires the Slice 1 chain). Slice 1 "What
matters now" is **frozen** and must render identically with this slice on or off.

### Functional

| # | Criterion |
|---|---|
| S2A-1 | **Goal is first-class.** A durable `pursuit_goals` row with stable id, pursuit id, status, human-readable objective, provenance (system-proposed vs human-authored), who decided, and timestamps. Its objective and basis are immutable to `app_rw`; a change is a superseding row. The goal is the **commercial outcome only** — it never encodes the route, partner, motion, action or owner (D-033). |
| S2A-2 | **Plan is durable and evolvable.** A `pursuit_plans` identity plus append-only `pursuit_plan_revisions`. Milestones, dependencies, focus, motion reference, next action, owner and evidence basis travel in every revision. `app_rw` cannot UPDATE or DELETE a revision (proven as `app_rw`: `42501`). |
| S2A-3 | **Recommendation ≠ decision.** A system RECOMMENDATION and a human DECISION are separate rows; the decision references the recommendation; the recommendation is byte-identical after the decision. Only a USER may decide. A recommendation can be decided once. |
| S2A-4 | **Human changes are supervision data.** ADJUSTED records each changed field (`adjustments`) and writes `pursuit_overrides` (`field = 'plan'`) with both sides and the pursuit's own data lineage. The adjusted action keeps the recommended action's key. Adjust and decline require a reason. |
| S2A-5 | **Evidence lineage.** The focus carries the upstream gap's rank and source (D-019). Every "why" line cites a canonical record and states its scope; account context is labelled "Account context" and never reads as confirmed for the pursuit (D-020). The plan writes no `pursuit_facts`. The RESTRICTED route reason never enters a plan. |
| S2A-6 | **Course correction.** New material evidence makes an approved plan REVIEW_NEEDED with deterministic reasons; the approved plan is not rewritten. An updated recommendation records a `review_trigger` and a `PLAN_REVIEW_REQUIRED` event. A recommendation that no longer matches the pursuit cannot be approved. The clock alone never makes a plan stale. |
| S2A-7 | **Reuse, not re-model.** The motion is an existing `revenue_motions` row reached through a canonical link (pursuit or opportunity). Approval stages the next action as a pending `motion_actions` step only onto an ACTIVE motion. Approvals run through `dispatchSkill`. |
| S2A-8 | **Tenant isolation.** Every read and write is scoped to the caller's org; another org cannot read the plan, record a recommendation on it, or decide it (REJECTED at the governed boundary); under RLS as `app_rw`, another org reads zero rows. |
| S2A-9 | **Disclosure.** A caller without internal visibility receives no stakeholder names and no warm path; withheld lines are removed before rendering and disclosed only as a count (D-018). |
| S2A-10 | **No external send path.** Both plan skills are INTERNAL_WRITE; the write path references no outbox, provider or message table; running the full harness adds zero `action_outbox` and zero `messages` rows. `OUTREACH_AUTOSEND` untouched. |
| S2A-11 | **Flag OFF is the certified page.** With the coordination flag off, the plan loader is never called and the page body is identical to the pre-slice build (U-16). |
| S2A-12 | **Globex composed read-model.** Goal "Exit legacy virtualization before renewal and close the $920K opportunity" — thesis + opportunity only, no route in it; the WWT route a person chose (never CDW) lives in the plan; target = the opportunity's close date; focus = the missing economic buyer; motion = the WWT Virtualization motion via the opportunity; owner = Unassigned (account-executive role proposed, no one confirmed); 4 of 8 milestones done, decision/paper process waiting on the economic buyer; why includes the route override with the CDW recommendation preserved and the account renewal as account context. |
| S2A-13 | **Slice 1 untouched.** Seeding the Globex plan writes no ledger row (Globex ledger stays at 10), no `goals` and no `revenue_motions` row (manifest digest unchanged). |
| S2A-14 | **Goal ↔ plan boundary (D-033).** A route change WWT → CDW or CDW → WWT, a motion change and an action adjustment each leave the SAME goal row and objective, and change only plan history (a reviewable plan, a new recommendation on the same plan). No review reason mentions the objective. A genuinely different objective is replaced append-only: the new goal carries `supersedes_goal_id` + reason, the old goal keeps its meaning byte for byte and is SUPERSEDED, its plan is SUPERSEDED with history intact, a goal is superseded at most once, only a person may replace one, and `GOAL_REPLACED` is recorded. |

### UX

| # | Criterion |
|---|---|
| S2A-U1 | One full-width "Pursuit plan" panel immediately after "What matters now". No new navigation, no sidebar entry, no new room. |
| S2A-U2 | Reading order: goal · progress · (review, only when needed) · current focus + why · next move (motion, action, done-when, path, owner, when) · approve / adjust. Milestones and plan history each behind one disclosure. |
| S2A-U3 | Not project-management software: no board, columns, Gantt or task list on the default view. Progress is one line and one thin segmented rule. |
| S2A-U4 | Does not duplicate "What matters now" (focus is one line; its explanation lives above) or the Route decision (the route appears only as the motion's "via"). |
| S2A-U5 | All state words chosen in the view-model from declared tables (U-14); no architecture terms reach the reader (U-12) — pinned by test. |
| S2A-U6 | Unassigned and unqueued are said plainly, never hidden: "Unassigned — Account executive role proposed, no one confirmed yet", "Not queued — no active motion to carry it". |

### Slice 2A human product acceptance — PASSED (isolated hosted Preview, 2026-09-14) → DEMO CERTIFIED / FROZEN

Manually proven by the owner on the isolated hosted Preview (`mejokqxriwyawfhawuxu`, Globex):

1. The goal remained route-independent.
2. The plan carried the WWT route, motion and action.
3. A person approved the recommendation.
4. Exactly one economic-buyer action entered the Queue.
5. The recommendation and the human approval remained separate history records.
6. The economic buyer was later verified.
7. Milestones moved from 4 of 8 to 5 of 8.
8. The approved plan changed to NEEDS REVIEW. It did not silently rewrite itself.
9. The next unresolved gap became timing.
10. Requesting an updated recommendation added a third history record: "Updated recommendation from PursuitOS".
11. The approved historical plan remained intact.
12. External sending remained off.

One UX note came out of that review. While a plan needs review, the panel still shows the
preserved approved content ("No economic buyer identified") while current reality has a
verified economic buyer. That is architecturally correct. Slice 2B addresses it with labelling
only (S2B-U5).

**Frozen:** do not materially redesign the Goal → Plan → Motion → Action model, its surface
or its semantics absent real pilot feedback.

---

## Slice 2B — Pursuit Attention + Today / Queue coordination

Flag: `VNEXT_PURSUIT_ATTENTION_ENABLED`. It requires `VNEXT_PURSUIT_COORDINATION_ENABLED` and
the Slice 1 chain.

> **Today = decision / attention layer. Queue = execution layer.** The same pursuit, plan,
> motion and action primitives power both. Nothing is stored twice. D-034…D-040.

### Functional

| # | Criterion |
|---|---|
| S2B-1 | **Derived, not stored.** No new table, no migration, and no attention row. Every reason is recomputed from the Slice 2A plan context Pursuit Detail renders. Each reason carries a deterministic key grounded in canonical ids (a revision, a motion action, the live fingerprint). |
| S2B-2 | **States.** The model derives these reasons: `PLAN_REVIEW_REQUIRED`, `PLAN_DECISION_REQUIRED`, `ACTION_OVERDUE`, `ACTION_BLOCKED` (a real dependency only), `OWNER_MISSING`, `ACTION_DUE` (inside the Queue's own seven-day window), and `MILESTONE_ADVANCED`. |
| S2B-3 | **Priority.** Within a pursuit: review › decision › overdue › blocked › owner › due › progress. This order never contradicts Today's class ranking (pinned by test). Across pursuits, cards rank by the existing materiality policy, with a stable final tie-break. |
| S2B-4 | **One card per pursuit.** Every other reason for the pursuit is counted beneath the card as "N other items". A reason the card already carries is subsumed, never repeated: a pending update inside a review, or progress that caused the review. Nothing is lost by collapsing: every original item is either a card or listed beneath one (verified on the real world, 36 → 11). |
| S2B-5 | **Globex States A–D.** A: "Plan awaiting approval" → Review plan. B: the approved action surfaces with no higher plan decision, and exists in the Queue exactly once. C: "Plan needs review" outranks the old queued action, the action stays in the Queue, and the Queue row says "Plan needs review". D: still one plan-review card, which invites the pending decision. No Globex-specific code. |
| S2B-6 | **Queue composes, never mutates.** No action is removed, cancelled, replaced or blocked because its plan needs review. Lineage comes from the existing `stagedMotionActionId`: which pursuit, which plan and decision, whether that plan is still current, and whether a person approved it. No action is duplicated to establish it. |
| S2B-7 | **Reads never write.** Opening Today or Queue creates no ledger event, recommendation, plan change, queue change, owner or status. Every read is proven inside a `READ ONLY` transaction. |
| S2B-8 | **Tenant.** Attention is derived only for the caller's org. The composed Today drops any pursuit item the org does not own, before grouping, ranking and counting. Another org's plan changes no card, count, rank, badge or hidden "other items" number. |
| S2B-9 | **Disclosure.** A partner-safe caller gets declared wording only: no names, warm paths, plan free text, reasoning or economics. Filtering happens before ranking and counting (D-018). |
| S2B-10 | **Flag OFF is certified.** Today, Queue and Pursuit Detail render byte-identically to the pre-slice build (U-16), with Slice 2A on or with no vNext flags at all. |
| S2B-11 | **No send path.** Zero outbox, message or email rows. |

### UX

| # | Criterion |
|---|---|
| S2B-U1 | No new navigation. The existing Today decision panel is composed (retitled "Needs your attention" under the flag), not joined by a second list. |
| S2B-U2 | A card reads: pursuit · reason · why now · owner · due (execution reasons only) · CTA, with the rest behind "Why is this here?" and "N other items". |
| S2B-U3 | CTAs: plan reasons → "Review plan" (`#plan`) · due / overdue → "Open the work" (the Queue's own destination) · blocked → "Open pursuit" · no owner → "Open team" (`#team`). |
| S2B-U4 | Queue: one quiet lineage segment on the row's meta line. "From the approved plan · View plan →", or a restrained "PLAN NEEDS REVIEW" chip with "Review plan →". |
| S2B-U5 | Pursuit Detail, labelling only: once a plan needs review, its preserved content sits under "Current approved plan — Approved <date>, recorded before the changes above", and the focus reads "Focus when approved". |
| S2B-U6 | Mobile: composed cards stack (chip · body · CTA) below `sm`, with no horizontal overflow at 390px. |

### Slice 2B security gate — Today / Queue tenant isolation (PASSED 2026-09-14, local)

A pre-existing leak blocked Slice 2B. With the flag OFF, a guest org's Today listed 17–18 of another org's items and its whole open pipeline. The gate:

| # | Criterion | Proven by |
|---|---|---|
| S2B-S1 | The guest org receives zero Vertex Today items with the flag OFF. | `today-tenant` §2 |
| S2B-S2 | …and zero with the flag ON. | §2 |
| S2B-S3 | Foreign rows change no card count, ranking, "other items" count, urgency or badge. | §3, with 10 planted clones |
| S2B-S4 | Vertex's Today and Queue output is unchanged when guest data is added. | §3 (identical projection) |
| S2B-S5 | The guest's own data still renders. | §3 |
| S2B-S6 | The Queue exposes no foreign rows or lineage, and no foreign queue item can be resolved. | §2, §4 |
| S2B-S7 | Plan-review attention still outranks action-due. | `vnext-attention`, unit tests |
| S2B-S8 | Reads create zero writes. | `READ ONLY` transactions, every org |
| S2B-S9 | Partner disclosure still holds. | `vnext-attention` disclosure checks |
| S2B-S10 | Slice 1 and Slice 2A stay green. | 62 / 0 · 116 / 0 |
| S2B-S11 | Zero external send rows. | §5 |

Flag-OFF Today is no longer required to be byte-identical where the only difference is foreign data removed. Security correctness supersedes byte identity (D-041).

### Slice 2B hosted human review — the final defect, and its resolution (2026-09-14)

**Hosted review results:** Queue PASS · Pursuit Detail stale-plan labelling PASS · Today FAIL
(the one-card-per-pursuit invariant). In State D, Today showed two Globex cards: "Plan needs
review" and "Approve route via CDW".

> **One pursuit can produce many underlying attention/decision reasons, but Today renders one
> pursuit-level attention card.**

**Root cause, confirmed read-only on the hosted database.** The two cards belong to two canonical
Globex pursuits: the hero MODERNIZATION pursuit, whose route is already decided (WWT), and a
separate EXPANSION pursuit, "AI platform expansion", whose own CDW route approval is pending.
The composition already grouped by pursuit. The cards were indistinguishable because a card
named only the account.

**Resolution (D-042):**
- Two pursuits stay two cards — never merged by account.
- Where one account has several pursuit cards, each card names its pursuit.
- Every reason for one pursuit competes under the existing ranking, and folds beneath the winner
  with its own CTA intact.
- "Decisions to make" counts every underlying reason again: its certified meaning.

| # | Criterion | Proven by |
|---|---|---|
| S2B-R1 | State D with a plan review, a route approval and the queued approved-plan action on ONE pursuit renders exactly ONE card, with plan review primary. | unit test · `vnext-attention` D |
| S2B-R2 | A same-pursuit route approval sits in "other items", still actionable ("Approve route via CDW → Approve"). | unit test |
| S2B-R3 | No pursuit appears twice, in the top decisions or in View all. | unit test · `vnext-attention` D |
| S2B-R4 | A pursuit with only a route approval renders exactly the certified card. | unit test |
| S2B-R5 | Two canonical pursuits on one account are NOT collapsed; each card names its pursuit. | unit test · `vnext-attention` D, on the real world |
| S2B-R6 | Tenant and disclosure filtering happen before grouping, hidden counts, labels and ranking. A foreign pursuit on the same account changes nothing. | unit test · `today-tenant` |
| S2B-R7 | An existing decision that outranks the plan's attention leads its pursuit's card. | unit test |
| S2B-R8 | "Decisions to make" counts underlying reasons; View all counts cards. | unit test · `vnext-attention` D |
| S2B-R9 | Queue, Pursuit Detail, the drawers and flag-OFF Today are unchanged against the accepted build (`c0eea5a`). | render comparison |

### Slice 2B hosted human review — PASSED → DEMO CERTIFIED / FROZEN (2026-09-14)

Accepted on the isolated hosted Preview:
- one primary card per pursuit;
- different pursuits on the same account remain separate:
  - Globex modernization, "Exit legacy virtualization before renewal" → Plan needs review;
  - Globex expansion, "AI platform expansion" → its own, separate CDW route decision;
- plan review outranks the stale action;
- the Queue preserves the action once, with plan-review context;
- Pursuit Detail distinguishes "Current approved plan / Focus when approved";
- external sending remains off.

> **One account may contain multiple independent pursuits. Today composes one card per PURSUIT,
> not per account.** (D-046)

Slice 2B is frozen: no material redesign of Today, Queue or the Pursuit Detail labelling absent
pilot feedback.

---

## H1A — Tenant isolation + certification integrity (pre-pilot hardening gate)

Full record, audit matrix and results: `H1-PRE-PILOT-HARDENING.md`. Decisions D-043, D-044.

| # | Criterion | Proven by |
|---|---|---|
| H1A-1 | Every application data path (rooms, server actions, API routes, MCP tools, search / Ask, routines, worker entry points) is inventoried and classified. | audit matrix |
| H1A-2 | No reachable path is RLS_ONLY or UNSCOPED. The org comes only from authenticated server context, and filtering precedes limits, aggregates, ranking and counts. | fixes + `tenant-isolation` |
| H1A-3 | Foreign tenant rows change no record, count, total, pipeline, ranking, recommendation, Today card, Queue row, badge, search hit, drawer, hidden count or analytic of another org. | `tenant-isolation` §2 (stable-line identity + marker scan, every room) |
| H1A-4 | No write accepts another org's id. | `tenant-isolation` §3 |
| H1A-5 | The detector is proven sensitive. The same rows planted into the sponsor appear, and every room moves. | `tenant-isolation` §4 (negative control) |
| H1A-6 | Every verifier is READ_ONLY, ROLLBACK_SAFE or DISPOSABLE_DB_ONLY. None is UNSAFE. | harness audit |
| H1A-7 | The full battery run twice leaves the canonical world byte-identical. | `certify-world --runs 2` |
| H1A-8 | Slice 1, 2A and 2B stay green and frozen. | their verifiers + unit tests |

## H1B-0 — Partnership / consent flows under the least-privilege runtime role

Record: `H1-PRE-PILOT-HARDENING.md` § H1B-0. Decision D-049. Migration 0104 (local only; hosted is Gate 1b).

| # | Criterion | Proven by |
|---|---|---|
| H1B0-1 | Every partnership flow works as the real `app_rw` login:<br>• invite → redeem;<br>• context grant;<br>• field-limited list grant (accept, pull-in, sync, revoke);<br>• overlap ladder counts → bands → named, with results equal to the true book intersection;<br>• evidence share;<br>• skill share, including grounding a motion;<br>• warm intro with contact reveal;<br>• joint pursuit with cross-party lines and the broker line;<br>• settlement across both books;<br>• partnership revoke. | `partnership-app-rw` |
| H1B0-2 | A third-party org gets nothing and can do nothing at any step. | `partnership-app-rw` (WITHHELD / REFUSED) |
| H1B0-3 | No consent row can be forged under `app_rw`: partnership, context grant, list grant, overlap probe (row or results), evidence share, skill share, warm intro, joint pursuit, joint-room line, ledger row. | `partnership-app-rw`, and the guard-dropped negative control |
| H1B0-4 | No self-approval; no action after revoke; no access without tenant context. | `partnership-app-rw` |
| H1B0-5 | Audit rows reach BOTH parties' ledgers, and an audit write never aborts the business transaction. | `partnership-app-rw` §10 (one transaction, every step) |
| H1B0-6 | Revocation ends access on both sides immediately, including the receiver's materialised copy. | `partnership-app-rw` §3, §11 |
| H1B0-7 | The partnership rooms render counterpart consent data identically under `app_rw` and the owner. | `app-rw-rehearsal` consent fixture |
| H1B0-8 | `/api/build` proves the runtime posture live: owner → `postgres` / `bypassRls: true` / `tenantEnforcement: false`; `app_rw` → `app_rw` / `false` / `true`. | `app-rw-rehearsal`; unit tests |
| H1B0-9 | Full certification stays green and the canonical world is unchanged. | `certify-world --runs 2` |
