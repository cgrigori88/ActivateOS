# Intelligence Wave — Motion · Seller/Partner · Stakeholder — Design & Reconciliation

**Status: DESIGN ONLY.** Nothing in this document is implemented. No flags were altered, no
credentials touched, no schema changed. The demo tenant's `outcome_learning` behavior is exactly as
previously configured and its demo-only status is documented in §0.4. This artifact is the
deliverable for the intelligence-wave design pass; implementation is HALTED pending review.

The three capabilities — **Motion Intelligence**, **Seller/Partner Intelligence**, **Stakeholder
Intelligence** — are designed here as *intelligence layers attached to the Pursuit lifecycle*, not
as rooms. The governing rule applied throughout: **reuse before extending; extend before
inventing.** The audit (§0) found that almost all of the required truth already exists in canonical
substrate; the wave is predominantly **read-models + surface integration**, one small additive
migration, and one governed skill. Two proposed schema touches exist in the entire wave, both
additive and nullable.

---

## 0. Substrate audit digest

A full-tree audit was performed at `78a5faf` across motions/campaigns, partners/sellers/ecosystem,
contacts/stakeholders/roles, scoring/routing, outcomes/attribution, and the query surfaces
(⌘K, drawer, Accounts pane, Today, Queue, Insights, Brief).

### 0.1 Canonical machinery this wave REUSES (no new equivalents may be built)

| Existing canon | Where | Reused by |
|---|---|---|
| Partner-activation dimensions (8: account_relationship .22, product_capability .20, transaction_adjacency .14, historical_performance .12, territory_alignment .10, seller_coverage .10, strategic_alignment .07, vertical_alignment .05), each with source + disclosure class | `src/lib/routing/types.ts:22-31`, `partner-activation.ts`, persisted in `route_candidate_dimensions` / `_reasons` / `_disqualifiers` | P1B comparisons; P1A route-viability chips |
| Relationship tiers `NONE · ACCOUNT_OVERLAP · ACTIVE_RELATIONSHIP · SELLER_RELATIONSHIP · EXECUTIVE_RELATIONSHIP` with temporal decay (`recencyFactor`) | `src/lib/routing/relationship.ts` | P1B "who actually knows this customer"; P1C warm paths |
| Disqualifier vocabulary (11 codes, HARD/SOFT): NO_REQUIRED_CAPABILITY, OUTSIDE_TERRITORY, PARTNER_DECLINED, CONSENT_BLOCKED, ENTITY_NOT_RESOLVED, NO_NAMED_SELLER, LOW_RECENT_ACTIVITY, WEAK_TECHNICAL_COVERAGE, LIMITED_VERTICAL_EXPERIENCE, CAPACITY_CONSTRAINT, NO_ACCOUNT_COVERAGE | `types.ts:33-36` | P1A constraint decomposition |
| Activation readiness decomposition (named seller −35 · capacity −25 · missing required role −15 each · hard-disqualified ⇒ ≤10) | `src/lib/routing/readiness.ts` | P1A execution-ready gate; unchanged as the stored readiness |
| Seller-fit dimensions (relationship .35, account_ownership .20, activity_recency .20, territory .15, workload .10); ownership ≠ auto-recommendation | `seller-fit.ts` | P1B seller paths |
| Team lifecycle + governed skills (`confirm_/accept_/decline_team_member`, timestamps `invited_at/accepted_at/declined_at`) | `routing/team.ts`, `federation/skills.ts` | P1A "acceptance pending" constraint; P1B responsiveness evidence |
| Participation consent lifecycle (`pursuit_participants`: INVITED/ACTIVE/DECLINED/LEFT/REVOKED + role registry) | `0080`, `federation/participation.ts` | P1B activation-when-asked |
| Canonical outcomes + attribution (5 classes, human override wins, model_version + evidence, idempotent bridge) | `0085`, `federation/outcomes.ts`, `bridge/outcome-bridge.ts` | P1A "what is working"; P1B execution history |
| Route outcomes with recommended-vs-selected + `seconds_since_recommended` + intervention | `routing/outcomes.ts`, `0078` | P1B acceptance latency |
| Buying-role map (`stakeholders`: economic_buyer, technical_buyer, champion, influencer, blocker, end_user × sentiment) + `stakeholderGaps()` | `0011:35-45`, `opportunities/lifecycle.ts:73-83` | P1C — the authoritative role object |
| MEDDPICC per-element assessment with `source human\|ai_assist`, never overwrites human rows | `0025`, `opportunities/meddpicc.ts` | P1C verified-vs-inferred pattern |
| Fact substrate (predicate registry, UNKNOWN/contradiction semantics, `leadership_change` CONTACT predicate, `pursuit_facts.relevance_type`) | `0069/0070/0072` | P1A timing gate; P1C evidence lines |
| Overlap ladder (counts→bands→named, consent-gated) + warm intros (`warm_intro_requests`, revealed_contact on accept) | `0037`, `0042`, `partnerships/*` | P1B activation ratio; P1C warm paths |
| Scale-disclosure UX system: scope (`getScopeContext`), ranked Today queue, contextual drawer (`IntelDrawer`), ⌘K single resolver (GO TO / SHOW ME / EXPLAIN), Brief as pure presentation | `src/lib/scope`, `read-models/today.ts`, `components/intel/*`, `lib/search/query.ts`, `read-models/brief.ts` | all placements |
| Governance: `dispatchSkill` single mutation authority; append-only ledger; recompute dependency map | `federation/skills.ts`, `events.ts`, `0094` | P1C role assertion; everything else is read-only |

### 0.2 Hygiene findings (pre-wave fixes; small, independent of the wave)

- **H1 — live schema/code mismatch.** `sellerRelationship()` selects
  `seller_account_relationships.last_interaction_at` (`relationship.ts:41-42`), a column that exists
  in **no migration** (only the `wsc` verify harness creates it). `rankSellers` runs inside every
  route recompute (`candidates.ts:63`), so a database built strictly from migrations fails route
  recompute. Fix: additive migration adding the nullable column (it is also the natural home for
  seller recency, which P1B needs).
- **H2 — `revenue_motions.pursuit_id` (0067) is nullable and mostly unpopulated.** Only the
  motion→opportunity path reads it. A deterministic backfill (company_id + taxonomy → canonical
  pursuit; ambiguous ⇒ left NULL, never guessed) is required for clean Motion↔Pursuit interlock.
  Same pattern as the existing 0067 backfill script.
- **H3 — two attribution vocabularies that never meet.** Settlement computes `sourced|influenced`
  from `deal_registrations` existence (`partnerships/settlement.ts:77-97`); canonical `attribution`
  carries SOURCE/INFLUENCED/ASSISTED/OBSERVED/UNKNOWN with model_version + human override. They must
  not be merged silently; §4 assigns authority and P1B labels the legacy figure "registration-based
  (settlement)" wherever both appear.
- **H4 — two team substrates.** Legacy `pursuit_teams` (company+taxonomy-keyed; feeds
  motion-designer gating and the Accounts room) vs canonical `pursuit_team_members`
  (pursuit-keyed, governed lifecycle). §4 names the canonical one authoritative; the wave reads only
  it; legacy remains for the motion-designer gate until Part-E-scale reconciliation (out of scope).
- **H5 — relationship truth is split across three unreconciled substrates:** list overlap/claims
  (`account_populations`/`partner_accounts`), asserted strength (`partner_relationships`, seed-only
  today), and consented participation (`pursuit_participants`). The wave does **not** merge them —
  it preserves the distinctions on-screen (§2), which is exactly what the product doctrine asks.
- **H6 — `EXECUTIVE_RELATIONSHIP` tier is declared but never assigned** (`relationship.ts`). The
  wave surfaces tiers as evidence; producing the executive tier needs a human-asserted source and is
  deliberately deferred (§8).
- **H7 — stubbed dimensions.** `historical_performance` and `strategic_alignment` are hardcoded 0.5;
  seller `territory`/`workload` hardcoded 0.6. Phase B's outcomes make historical performance
  computable — the wave exposes it as **evidence only**; feeding it into the score is a versioned
  model change (`fit-v2`) explicitly deferred (§8).
- **H8 — partner scorecard v1 reads none of the canonical route/outcome/attribution/team substrate**
  (`partners/hub.ts`). P1B extends it from canonical truth instead of building a parallel scorecard.
- **H9 — Contacts stores no role/seniority** (regex-derived at render); buying roles exist only on
  opportunity-scoped `stakeholders`. P1C reparents that truth to Pursuits additively (§3).
- **H10 — ⌘K EXPLAIN is two hardcoded branches** (route, timing) and SHOW ME's entity allowlist is
  `opportunity` only (`search/query.ts`). The wave extends the *single* resolver — no parallel stack.

### 0.3 Corrections to raw audit output

Two claims from the audit fan-out were checked and corrected against the current tree:
`revenue_motions.pursuit_id` **does** exist (0067), and Analytics reads response/meeting slices from
`interaction_events` (Phase B2), not producerless `outcome_events`. The suspected
`OPPORTUNITY_ADVANCED` check-constraint violation is **not** real — 0011 re-adds it.

### 0.4 Demo `outcome_learning` — demo-only status (explicit)

`scripts/demo-db.ts` enables the `outcome_learning` org feature **only for the demo vendor-sponsor
org**, so the closed learning loop is demonstrable on a fresh demo build. It remains OFF for demo
participant/guest tenants and for every production tenant: the flag is fail-closed behind the
`OUTCOME_LEARNING_ENABLED` env master AND the per-org row, and no production flag is altered by this
design. This wave keeps that configuration exactly as is.

---

## 1. MOTION INTELLIGENCE (P1A)

**Hero concept: commercial constraint intelligence — not campaign reporting.** A Motion answers why
it exists, where it should run, through whom, what can move now, what blocks scale, what is working,
and what should change — every answer decomposed into canonical constraints with refs.

### Current substrate

- `revenue_motions` is a **single-account** record (`company_id NOT NULL`) carrying the hypothesis
  narrative (thesis, trigger_summary, personas, cta), economics, partner/seller links, goal link,
  operator_notes, lifecycle `draft→approved→active→completed|abandoned`, legacy outcome
  (`won|lost|no_decision`), and (0067) a nullable `pursuit_id`.
- The **hypothesis level already exists** one level up: `play_templates` (slug, taxonomy, definition,
  economics) + `propensity_scores` (per company, banded, versioned, with `score_features`) are
  literally "product/commercial hypothesis → qualifying accounts". The Motions page already groups
  by play slug.
- Multi-account reach is expressed via campaigns → `campaign_populations` → `population_members`.
- Motion approval is governed (`approve_motion`/`reject_motion` via `dispatchSkill`, Phase C4);
  activation instantiates `motion_actions` (the Queue's cadence source).
- Qualification/eligibility logic exists only for opportunities (MEDDPICC) and partnerships
  (named-overlap); **no motion-level qualification funnel exists anywhere.**

### What already works

The whole causal chain the activation thesis needs is stored, per account: propensity (qualify) →
canonical pursuit (belief, timing, why-now, unknowns) → route snapshot + candidates + disqualifiers
(through whom / route viability) → team + readiness (who executes) → governed Motion status → outcome
+ attribution (what worked). Phase B/C closed the last two links.

### What is underexposed

Every number in the target experience is derivable today but never assembled:
"62 evaluated" (propensity rows for the slug), "21 qualify" (band ≥ high), "14 viable partner
overlap" (current route snapshot with a non-disqualified partner candidate), "9 verified timing"
(timing score known + timing-anchor fact), "6 execution-ready" (readiness gates green + motion
approved), "$4.8M addressable" (sum of `expected_value_weighted` over the ready set). The
per-account *reason for exclusion* is likewise already stored as disqualifier codes, missing roles,
INVITED team rows, draft status, unknown timing, claim conflicts — it has just never been read out
as one decomposition.

### What is actually missing

- A funnel read-model at the **hypothesis (play/slug × taxonomy) level** and a per-account
  **constraint decomposition** read-model.
- The Motion⇄Pursuit linkage hygiene (H2 backfill).
- A Motion context strip on Pursuit Detail (a pursuit does not currently say which hypothesis it
  serves).
- Nothing else. **No new domain primitive is required.** In particular, a `motion_targets`
  membership table is NOT needed: hypothesis→account membership is already expressed by
  `propensity_scores` (evaluated) and populations (curated lists); inventing a third membership
  substrate would create duplicate truth (§8).

### Required read-model changes (new code, read-only)

`src/lib/motions/funnel.ts` — pure read-models, no stored score, no recompute participation:

```ts
export interface MotionFunnelStage { key: "evaluated"|"qualified"|"route_viable"|"timing_verified"|"team_ready"|"approved"|"execution_ready";
  label: string; count: number; accountIds: string[] }
export interface MotionConstraint { code: string;            // reuses canonical codes below — never invented
  label: string; severity: "HARD"|"SOFT"|"UNKNOWN"; refType: string; refId: string|null;
  remedy: { label: string; skill?: string; deepLink: string } | null }
export interface MotionFunnelView { hypothesis: { slug: string; name: string; taxonomyNodeId: string|null; thesis: string|null };
  stages: MotionFunnelStage[]; addressableUsd: number|null; readyUsd: number|null;
  outcomes: { byAttributionClass: Record<string, number>; canonicalTotal: number; legacyMotionOutcomes: {won:number;lost:number;no_decision:number} };
  scopeNarrowed: boolean }

getMotionFunnels(db, caller, opts:{companyIds?:string[]|null}): MotionFunnelView[]   // one per hypothesis with ≥1 evaluated account
getMotionConstraints(db, caller, slug, companyId): MotionConstraint[]                // the decomposition, ordered by gate
```

Gate definitions (all existing truth; UNKNOWN is a legitimate gate outcome, never coerced):

| Gate | Canonical source | Constraint emitted when failing |
|---|---|---|
| qualified | `propensity_scores.band` (latest per company × slug) | `BELOW_PROPENSITY_BAND` (label only; refs score id) |
| route_viable | current `pursuit_route_snapshots` + `route_candidates.disqualified` + `route_candidate_disqualifiers` | the stored `DisqualifierCode` verbatim (NO_REQUIRED_CAPABILITY, OUTSIDE_TERRITORY, …) or `NO_ROUTE_SNAPSHOT` |
| timing_verified | `pursuits.current_timing_score` known + `why_now.timing_anchor` / TIMING_ANCHOR pursuit_fact | `TIMING_UNKNOWN` (severity UNKNOWN — displayed as unknown, not red) |
| team_ready | `readiness.missingRequiredRoles`, `pursuit_team_members.status='INVITED'` | `TEAM_ROLE_MISSING:<role>` / `ACCEPTANCE_PENDING:<role>` |
| approved | `revenue_motions.status` | `MOTION_NOT_APPROVED` (remedy = governed `approve_motion`) |
| conflict overlay | claim conflict (2+ partner `customer/open_opportunity` claims — the existing overlap-workbench rule) or top-2 partner strengths within 6 pts (existing Accounts-pane rule) | `OWNERSHIP_CONFLICT` / `ROUTE_CONTESTED` (SOFT) |
| evidence overlay | `pursuits.current_evidence_confidence_score` low / `why_now.evidence_gap` | `WEAK_EVIDENCE` (SOFT) |
| stakeholder overlay (after P1C) | `getStakeholderCoverage` gaps | `ROLE_UNVERIFIED:economic_buyer` etc. (severity UNKNOWN) |

The stage progression is **presentation-level composition of canonical truths** — deliberately NOT a
new stored "execution readiness" score, so `activationReadiness` remains the single stored readiness
and recompute semantics are untouched.

### Required write/governance changes

None. The funnel is read-only. Every remedy points at an existing governed skill
(`approve_motion`, `select_partner_route`, `confirm_team_member`, `accept_team_member`) or an
existing deep link — intelligence becomes governed work through the paths that already exist.

### Outcome/learning dependencies

"WHAT IS WORKING" per hypothesis = canonical `pursuit_outcomes ⋈ attribution` grouped by effective
class (human override wins), exactly the Insights Phase-B3 card's query re-scoped to the
hypothesis's pursuits. Legacy `revenue_motions.outcome` counts are shown alongside, explicitly
labeled *"motion-level (legacy)"* — never summed with canonical outcomes (H3 discipline). Gated by
`outcomeLearningEnabledFor` exactly like the existing outcome surfaces; when the gate is off the
section reads "Outcome learning is not enabled for this tenant."

### Disclosure/federation implications

The funnel is **sponsor-org-private** (its inputs — propensity, expected value, claims — are
INTERNAL/TRANSACTION_CONFIDENTIAL classes). No funnel row is serialized into any participant-visible
payload. Where the Brief consumes a funnel constraint (below), the line inherits `confidential: true`
unless it is a pure process fact already shareable ("awaiting partner acceptance" is shareable; the
addressable-value figure is not — same rule the Brief already enforces).

### Scope behavior

`getMotionFunnels` takes the standard `companyIds` narrowing (empty array ⇒ empty funnel; null ⇒
RLS-scoped set; never widens) — identical idiom to `today.ts`/`portfolio.ts`. The funnel header
restates the active scope ("within scope: Ecosystem — CDW accounts").

### UX placement (+ wireframe)

**Motions room stays first-class** — its distinct job is exactly "how is this commercial hypothesis
performing across the ecosystem?", which no other room answers (evaluated explicitly, per the
brief). It is *reorganized around the funnel*, not redesigned; nav untouched.

```
MOTIONS  ──────────────────────────────────────────────  scope: All ecosystems ▾
┌────────────────────────────────────────────────────────────────────────────┐
│ VMware displacement · infrastructure/virtualization        [play: vmware-…]│
│  62 evaluated → 21 qualified → 14 route-viable → 9 timing-verified         │
│  → 7 team-ready → 6 execution-ready        $4.8M addressable · $1.9M ready │
│  ⓘ each number is a button → account list with constraint chips           │
│  What's working: 3 CLOSED_WON (2 INFLUENCED · 1 UNKNOWN) · legacy: 1 won   │
│  [Why aren't the other 15 ready?]                                          │
├────────────────────────────────────────────────────────────────────────────┤
│ M365 security expansion · …                       (next hypothesis group)  │
└────────────────────────────────────────────────────────────────────────────┘
```

Clicking a stage number or "Why aren't the other N ready?" opens the **existing contextual drawer**
(extended with a motion-constraints body, §1 Progressive disclosure) listing the excluded accounts,
each with its constraint chips:

```
┌─ Why not execution-ready · VMware displacement ────────────── ✕ ─┐
│ Globex Manufacturing      TIMING UNKNOWN · no timing anchor      │
│   → the one gate holding an otherwise-ready account              │
│ Initech Financial         ACCEPTANCE PENDING: partner acct mgr   │
│   waiting 6d on WWT · [Mark accepted]  (governed)                │
│ Stark Industries          NO ROUTE: OUTSIDE_TERRITORY (CDW),     │
│   NO_REQUIRED_CAPABILITY (Acme MSP) — no viable candidate        │
│ Hooli Cloud               MOTION NOT APPROVED · [Approve motion] │
│ …ranked by expected value; chips deep-link to /pursuits/[id]#…   │
└──────────────────────────────────────────────────────────────────┘
```

**Pursuit Detail** gains a one-line *Motion context strip* under the hero (only when the pursuit maps
to a hypothesis): `Serving: VMware displacement · execution-ready (6 of 21 qualified)` — linking back
to the funnel. **Pipeline** portfolio view gains a `motion` group-by pivot (data exists via
`revenue_motions.pursuit_id` after H2) — pivots only, Attention cards untouched. **Today** gets
nothing new from P1A by default; a high-value hypothesis fully blocked on ONE constraint may surface
later via the existing materiality policy (deferred, §8).

### Default-visible state

The Motions room shows only the funnel headline rows (one per hypothesis) + outcome line — calm
surface. No per-account cards are rendered by default.

### Progressive disclosure

funnel row → stage account list (drawer) → per-account constraint chips → chip deep-link into the
pursuit's own decision surface (`#route`, `#team`) where the governed action lives. The existing
`IntelDrawer` is extended with a second body type (`motion-constraints`) behind a new URL param
(`?mdrawer=<slug>&stage=`) — one drawer component, two bodies; no new overlay system.

### Signature wow interaction

**"Why aren't the other 15 accounts ready?" → click → exact constraint decomposition** (wireframe
above): every chip is a canonical code with a ref and, where a governed action exists, the action
itself — CRO-legible in seconds because the chips are words, not scores.

### ⌘K / EXPLAIN behavior

Extend `resolveExplain` (single resolver, same file) with two intents:
- *"why is Globex not execution-ready (for VMware displacement)?"* → `getMotionConstraints`,
  rendered as the same chip decomposition, subject resolution reusing the existing company-name
  matcher; hypothesis inferred from the account's motions when unnamed, ambiguity answered with a
  disambiguation line (never guessed).
- *"why does Globex qualify for VMware displacement?"* → propensity band + top `score_features` +
  supporting facts (all existing).
Also register the funnel stages under SHOW ME: `show me execution-ready accounts for <motion>` —
extending `parseShowMe`'s allowlist with a `motion:<slug>` + `stage:<key>` condition (entity remains
bounded; results render like existing SHOW ME lists).

### Demo story

Seeded demo: the hero motions (VMware-displacement-like plays exist per play_templates seed) over the
~10 demo accounts. Story: open Motions → the funnel shows the seeded hypothesis with Globex
execution-ready and 2-3 accounts excluded for distinct, visibly different reasons (timing UNKNOWN;
acceptance pending on WWT; motion draft) → click through Initech's ACCEPTANCE_PENDING chip → land on
its Pursuit `#team` → Mark accepted (governed) → return: funnel count increments. The loop closes on
screen.

### Scale behavior

One query set per hypothesis (grouped aggregates), not per account; stage account lists are
paginated (drawer shows top-N by expected value, "view all" continues); constraint decomposition is
computed per account **only on drill-in**, never for the whole book. Thousands of accounts ⇒ the
default surface renders a handful of funnel rows.

### Exact proposed code changes

| File | Change |
|---|---|
| `src/lib/motions/funnel.ts` | NEW — `getMotionFunnels`, `getMotionConstraints` (read-only) |
| `src/app/motions/page.tsx` | Reorganize: funnel headline rows per hypothesis above the existing instance list (list becomes the drill-in tier) |
| `src/components/intel/intel-drawer.tsx` (+ small `motion-constraints` body component) | Second drawer body; `?mdrawer=` param on /motions |
| `src/app/pursuits/[id]/page.tsx` | Motion context strip (1 query, only when linkage exists) |
| `src/lib/pursuits/read-models/portfolio.ts` + `src/app/pipeline/page.tsx` | `motion` group-by pivot |
| `src/lib/search/query.ts` + `src/app/api/palette/route.ts` | 2 EXPLAIN intents + SHOW ME condition |
| `scripts/backfill-motion-pursuits.ts` | NEW — deterministic H2 backfill (ambiguous ⇒ NULL) |

### New schema/migration requirements

**None for P1A itself.** (H1's column fix ships in the pre-wave hygiene migration; H2 is data-only.)

### Risks

- Funnel gate definitions drift from readiness semantics → mitigated by deriving gates *from* the
  stored readiness/disqualifier objects, never re-deriving their inputs.
- Propensity staleness misread as qualification truth → stage label carries `computed_at`; stale
  scores render with the existing freshness treatment, and "evaluated" is explicitly "evaluated by
  scoring vN at date", not a live claim.
- Legacy motion outcome vs canonical outcome confusion → hard visual separation + labels (H3).

### Tests required

Funnel determinism on seeded fixtures (counts reproducible); one account per constraint code
asserted (timing UNKNOWN, disqualified route, missing role, acceptance pending, draft motion,
ownership conflict); scope narrowing (empty ⇒ empty, never widens); gate-off tenant sees no outcome
section; EXPLAIN answers grounded (no invented text); drawer pagination cap; regression: existing
motions actions + team/route verifies stay green.

---

## 2. SELLER / PARTNER INTELLIGENCE (P1B)

**Hero concept: activation evidence, not a partner score.** Every statement decomposes to canonical
evidence; the five relationship distinctions and UNKNOWN are preserved verbatim; no new composite
score is created (§8).

### Current substrate

Dimensional scoring per pursuit (`route_candidates` + dimensions/reasons/disqualifiers), relationship
tiers with decay, seller fit, team acceptance lifecycle with timestamps, participation consent
lifecycle, `route_outcomes` (PARTNER_ACCEPTED/DECLINED + latency), canonical outcomes+attribution,
settlement statements (registration-based sourced/influenced), overlap ladder + warm intros, partner
scorecard v1 (`partners/hub.ts`: joint win rate, sourced/influenced USD, cycle days, joint-room
responsiveness, motion win rate), Mapping workbench (claims/conflict/plays over lists).

### What already works

Per-pursuit comparison is genuinely strong: the Route panel already shows two candidates across five
dimension cells with disclosure-filtered reasons — "Why WWT instead of CDW?" is half-built. The
timestamps needed for "activated when asked" all exist (`invited_at→accepted_at`,
`joint_pursuits.decided_at`, `seconds_since_recommended`, warm-intro `decided_at`).

### What is underexposed

- **Activation ratio** — "appears in 18 overlapping accounts, activated in 3" — is fully computable
  (overlap from populations/partner_accounts; activation from selected routes + ACCEPTED team rows +
  ACTIVE participations) and computed nowhere.
- **Acceptance behavior** — accept/decline rates and latency per partner — stored per event, never
  aggregated.
- **Execution history** — canonical outcomes + attribution per partner × taxonomy — exists since
  Phase B, read by nothing partner-facing (H8).
- **Coverage gaps** — overlap accounts with no relationship strength, no named seller, or no
  capability on the needed category — each substrate exists; the join is never made.
- **Who is blocking progress** — INVITED-stale rows per partner exist per pursuit (Today) but have no
  partner-level rollup.

### What is actually missing

Nothing structural. **No new domain primitive and no new table.** The one true absence is H1's
`last_interaction_at` column (already referenced by code); its migration is pre-wave hygiene. Seller
recency *population* (what updates that column) is honest-by-absence for now: where NULL, recency
renders UNKNOWN (the code's existing neutral-0.5 behavior) — wiring interaction ingestion to update
it is listed §8 as a producer change needing its own approval.

### Required read-model changes

`src/lib/partners/intelligence.ts` — read-only:

```ts
getPartnerActivationProfile(db, caller, partnerId, opts:{companyIds?}) => {
  identity: { name, type, capabilities: [{taxonomy, strength, certified}] },
  presence:   { overlapAccounts, claimedAccounts, relationshipTiers: Record<Tier, number> },  // three substrates, SHOWN SEPARATELY (H5)
  activation: { candidateIn, recommendedIn, selectedIn, participationsActive,
                askedToAccept, accepted, declined, medianAcceptDays },                        // team+participation+route_outcomes
  execution:  { canonicalOutcomes: byEffectiveClass, byTaxonomy: [{taxonomy, won, lost, classMix}],
                settlementLegacy: { sourcedUsd, influencedUsd, label: "registration-based" } },
  blocking:   [{ pursuitId, accountLabel, role, waitingDays }],                               // INVITED rows for this partner
  coverageGaps: [{ companyId, gap: "NO_RELATIONSHIP"|"NO_NAMED_SELLER"|"NO_CAPABILITY" }],
}
getSellerPaths(db, caller, companyId) => [{ sellerId, name, partnerLabel|`vendor`,
  tier: RelationshipTier, strength: ScoreView|UNKNOWN, recency: known|UNKNOWN, lastAt }]      // ranked; ownership ≠ recommendation preserved
getExecutionEvidence(db, caller, partnerId, taxonomyNodeId|null) => evidence lines            // feeds route compare + EXPLAIN
```

Route read-model extension: `RouteCandidateView` gains `executionHistory: ScoreReason[]` — evidence
lines like *"3 canonical wins in virtualization, 2 INFLUENCED (model outcome-bridge/v1) · median
cycle 84d"* with refs into `pursuit_outcomes`/`attribution`. **Displayed as evidence beside the
existing dimensions; not an input to any score** (H7 discipline). Disclosure: these lines carry
class INTERNAL (values) with GENERALIZED substitutes ("prior joint execution in this category") so
the existing explanation/Brief machinery handles the partner rendering unchanged.

### Required write/governance changes

None. All reads. (The optional interaction→recency producer is explicitly out of this wave, §8.)

### Outcome/learning dependencies

Execution history requires Phase B outcomes; where a tenant's `outcome_learning` is off, the
execution section renders the honest empty state and the comparison falls back to the existing
dimensions only. Attribution is always reported by **effective class with the human override
visible** ("human override · machine said OBSERVED") — never silently promoted.

### Disclosure/federation implications

The activation profile is **internal-only** in this wave: it aggregates sponsor-side truth (imports,
claims, settlement, outcomes). Nothing from it is added to participant-visible payloads. Partner-
facing sharing continues to live where consent already governs it (joint rooms, settlement,
named-overlap). The route-compare execution lines flow through the existing disclosure classes, so
the Partner view of the theater/Brief generalizes or drops them exactly like today's reasons.

### Scope behavior

Profile aggregates narrow to the scope's `companyIds` (an ecosystem-scoped view of the same partner);
`getSellerPaths` is account-scoped by nature. Never widens.

### UX placement (+ wireframes)

**Partners room verdict: KEEP first-class, transformed.** Its distinct job — "manage this partner as
a commercial capability across all accounts" — is not expressible contextually on any single pursuit.
But it stops being a directory: `/partners/[id]` leads with the activation profile; the existing
scorecard v1 metrics remain beneath it, with the settlement figures relabeled "registration-based".

```
/partners/wwt ────────────────────────────────────────────────────────────────
│ PRESENCE      overlap 18 accts · claims 7 · relationship: ACTIVE 5 · OVERLAP 9 · UNKNOWN 4
│ ACTIVATION    candidate in 12 pursuits · recommended 6 · SELECTED 3
│               asked to accept 5 → accepted 3 · declined 1 · median 2.1d
│               ⚠ appears in 18 overlapping accounts but has activated in only 3   ← headline
│ EXECUTION     canonical: 2 CLOSED_WON (INFLUENCED) · 1 NO_DECISION · by category ▸
│               settlement (registration-based): $410k sourced · $220k influenced
│ BLOCKING NOW  Initech · partner acct mgr INVITED · waiting 6d  → /pursuits/…#team
│ COVERAGE GAPS 4 overlap accounts with no named seller ▸ · 2 without capability ▸
```

**Pursuit Detail** (primary contextual surface): the Route panel's candidate table gains the
execution-history evidence row; the existing "Why <candidate>" disclosure panel absorbs the new
lines automatically.

```
Route decision · why WWT instead of CDW?          (existing compare, one added row)
             relationship   capability   seller   territory   execution history
  CDW  rec   ██ high        ██ high      ██       ██          3 wins in category · med 84d
  WWT  SEL   ██ ACTIVE 5yr  ██ high      ██ fresh ██          1 win · 1 no-decision
  "WWT has the stronger active relationship; CDW has materially better execution
   history in this Motion."  ← rendered ONLY when both facts hold; refs attached
  Human decision: WWT (override, RELATIONSHIP_KNOWLEDGE) — preserved, shown separately
```

**Accounts pane** THROUGH WHOM gains the strongest-seller-path line (from `getSellerPaths`):
*"Strongest path: J. Rivera (WWT) — seller relationship, active 3w ago"* with UNKNOWN rendered as
UNKNOWN. **Mapping** stays topology; each overlap cell's existing drill-in gains two chips
(activation ratio, last execution outcome) reusing the profile — Mapping does not become Pipeline.
**Today**: one new high-materiality item only — *partner acceptance blocking a high-band pursuit ≥ N
days* — which is a materiality upgrade of the existing TEAM_WAITING item (band-gated), not a new
class. **Insights**: partner activation-vs-presence card + acceptance-latency distribution (from the
same read-model; no leaderboard — partners are listed with evidence chips, ranked only where the
same evidence type genuinely supports comparison).

### Default-visible state

Partner room: the five headline lines above. Pursuit Detail: nothing new visible unless a
recommendation exists (the compare row appears inside the existing panel).

### Progressive disclosure

headline → per-section drill (account lists, outcome lists with refs) → pursuit deep links.
Comparative sentence → click → the underlying evidence rows (tier + tenure; outcome ids + classes +
model version).

### Signature wow interaction

**"Why WWT instead of CDW?" → click → overlap + relationship + execution + outcome evidence, with
the human route decision preserved and displayed separately** (wireframe above). And the profile
headline: **"This partner appears in 18 overlapping accounts but has activated in only 3"** — each
number a click into its account list.

### ⌘K / EXPLAIN behavior

- *"which seller has the strongest path into Acme?"* → `getSellerPaths` (new EXPLAIN intent; answers
  with tier + recency evidence; UNKNOWN preserved).
- The existing route EXPLAIN branch gains the execution-history lines automatically (it already
  reads `route_candidate_reasons`; the new lines ride the same table? — no: they are derived; the
  branch calls `getExecutionEvidence` additively).
- *"which partners are active versus nominal?"* → SHOW ME condition `partners activation-gap`
  returning profiles ranked by presence-vs-activation delta (bounded allowlist addition).

### Demo story

Open `/partners/wwt` → activation headline (present-many/activated-few) → BLOCKING shows Initech
waiting on acceptance → click through, Mark accepted (governed) → back: blocking clears. Then open
Globex pursuit → route compare shows the two-hands sentence (WWT relationship vs CDW execution) over
the seeded outcomes, with the earlier human override visibly preserved.

### Scale behavior

Profile = grouped aggregates per partner (constant-size result); account/outcome lists paginate on
drill-in; the partners index shows ranked headline chips only (no card walls); dozens→hundreds of
partners stay one row each.

### Exact proposed code changes

| File | Change |
|---|---|
| `src/lib/partners/intelligence.ts` | NEW — three read-models above |
| `src/lib/pursuits/read-models/route.ts` (+ `types.ts`) | `executionHistory` evidence on candidates (derived, disclosure-classed) |
| `src/app/partners/[id]/page.tsx` | Activation profile sections above scorecard v1; relabel settlement figures |
| `src/app/partners/page.tsx` | Headline chips per partner (presence/activation/blocking counts) |
| `src/components/pursuit/route.tsx` | One evidence row + the conditional comparative sentence |
| `src/lib/accounts/intel.ts` + `intel-pane.tsx` | THROUGH WHOM seller-path line |
| `src/lib/pursuits/read-models/today.ts` | Band-gate escalation of TEAM_WAITING materiality (no new item type) |
| `src/app/insights/page.tsx` | Activation-vs-presence + acceptance-latency cards |
| `src/lib/search/query.ts` | 1 EXPLAIN intent + 1 SHOW ME condition + route-branch extension |

### New schema/migration requirements

**None beyond pre-wave H1** (`alter table seller_account_relationships add column if not exists
last_interaction_at timestamptz` — additive; fixes the live mismatch and gives recency a real home).

### Risks

- Aggregating three relationship substrates invites silent merging → the read-model returns them as
  separate named fields and every surface labels them separately (H5).
- Settlement vs canonical attribution conflation → permanent labels + §4 authority assignment (H3).
- Comparative sentence over-claiming → template renders only when both clauses have grounded
  evidence above threshold; otherwise the plain dimensional compare stands.
- Acceptance metrics on sparse data → counts shown with denominators ("3 of 5 asked"), never as
  percentages below a floor.

### Tests required

Activation-profile determinism on seed; acceptance latency computed from timestamps (fixture with
known invited/accepted times); execution evidence excludes other tenants and respects
outcome_learning gate; disclosure: partner rendering of route compare drops INTERNAL execution
values (generalized line survives); tier distinctions never collapse (assert all five surfaced
verbatim); scope narrowing; H1 migration verify (route recompute green on migrations-only DB).

---

## 3. STAKEHOLDER INTELLIGENCE (P1C)

**Hero concept: buying-role coverage around the Pursuit — verified vs inferred vs unverified vs
UNKNOWN — with evidence-backed warm paths.** Not another contact database.

### Current substrate

`stakeholders` (opportunity-scoped person-role map: economic_buyer, technical_buyer, champion,
influencer, blocker, end_user × sentiment; PK (opportunity_id, contact_id)); `stakeholderGaps()`;
`opportunity_meddpicc` (per-element status unknown/gap/weak/strong, `source human|ai_assist`,
human rows never overwritten, AI assess derives *from* stakeholders + verified evidence); `contacts`
(typed, partner-linked, no stored role/seniority); PDL committee as provider observations
(render-derived, unverified); fact substrate with exactly one person predicate (`leadership_change`)
and one relationship predicate; warm-intro ladder (consent-gated, revealed_contact on accept);
`pursuit_team_members.relationship_strength` (selling side).

### What already works

The role vocabulary, the human/AI provenance pattern, the gap logic, and the Pipeline editing UI all
exist and are sound. `assessMeddpicc`'s rule — proposals from evidence, human assertions never
overwritten — is precisely the verified-vs-inferred discipline this capability needs, already
enforced in code.

### What is underexposed

- Coverage is **invisible outside Pipeline**: Pursuit Detail, Brief, and Accounts never state "you
  have a champion but no verified economic buyer".
- The PDL-discovered committee never meets the stakeholder map (unverified candidates go nowhere).
- Warm-path reasoning exists as separate parts (partner tier, seller recency, contact.partner_id,
  warm-intro consent) and is never composed into "who can reach the likely buyer, through whom".

### What is actually missing

- **Pursuit-scoped role coverage.** `stakeholders` keys on opportunity, but the canonical object is
  now the Pursuit, which typically precedes an opportunity. This is the wave's one real gap.
- **An explicit assertion level** on a stakeholder row (verified / inferred / unverified). MEDDPICC
  has provenance per *element*; the person-role row has none.
- A governed path for asserting/verifying a role (today `setStakeholderAction` is a direct update —
  a human commercial decision bypassing `dispatchSkill`).

### Required read-model changes

`src/lib/pursuits/read-models/stakeholder-coverage.ts`:

```ts
export interface RoleCoverage { role: string;                      // existing enum values verbatim
  holder: { contactId, name, title } | null;
  assertion: "verified"|"inferred"|"unverified"|"UNKNOWN";        // UNKNOWN = no row at all
  source: "human"|"ai_assist"|"import"|null; sentiment: string|null;
  evidence: { kind: "fact"|"engagement"|"meddpicc"|"discovery"; label: string; refId: string|null }[] }
export interface WarmPath { toRole: string; via: { kind: "partner"|"seller"|"direct",
  label: string, tier: RelationshipTier, recency: "fresh"|"stale"|"UNKNOWN" };
  consent: "available"|"requires_named_overlap"|"none"; refIds: string[] }
getStakeholderCoverage(db, caller, pursuitId) => { roles: RoleCoverage[]; gaps: string[];
  discovered: { name, title, source: "pdl_people" }[];             // unverified candidates, labeled
  warmPaths: WarmPath[] }
```

Warm-path ranking reuses only existing evidence: partner tier + tenure (`partner_relationships`),
named-seller recency (`seller_account_relationships` post-H1), partner-linked contacts
(`contacts.partner_id`), and named-overlap/warm-intro consent state — each path decomposes to those
refs. **No inference from job titles**: a title never produces a role; PDL rows appear only under
"Discovered — unverified".

### Required write/governance changes

- **Governed skill `assert_stakeholder_role`** (INTERNAL_WRITE, operator, precheck: contact + target
  in actor's org): wraps the existing upsert, sets `source='human'`, `assertion` per an explicit
  argument (`verified` requires a stated basis string, recorded), writes an append-only ledger event
  (`STAKEHOLDER_ROLE_ASSERTED` — additive member of the TS `ChangeType` union; the DB column is
  unconstrained text, so no migration). The Pipeline UI's `setStakeholderAction` is repointed through
  `dispatchSkill` — same UX, governed spine (exactly the route/team/motion pattern).
- **No recompute-map change**: role assertions do not enqueue recomputes (no score reads them);
  Today surfacing is a direct read-model item like TEAM_WAITING, keeping recompute semantics
  untouched.
- Promotion of a discovered (PDL) person to a stakeholder row goes through the same skill with
  `source='ai_assist'`/`assertion='inferred'` — a human clicks it; the machine never self-promotes.

### Outcome/learning dependencies

None required. (Future calibration — "pursuits with verified economic buyers close at X%" — is an
Insights consumer of existing outcome truth; listed as P1D-optional.)

### Disclosure/federation implications

Stakeholder identity is the most sensitive object in the wave (person-level, PII-adjacent):
- Coverage is **ORG_PRIVATE**; no stakeholder row enters any participant payload.
- In the **Brief**, buying-side lines are `confidential: true` by default (withheld from the
  partner rendering) — with one deliberate exception: a role-validation *ask routed through that
  partner* is shareable as the ask alone ("help us validate the economic buyer") without the
  internal coverage map. WHAT TO ASK gains these; WHO MATTERS gains the internal map.
- Warm-path reveals remain behind the existing consent ladder — the design never surfaces a
  partner's named contact without an accepted warm-intro (`revealed_contact` stays the only source).

### Scope behavior

Coverage is pursuit-scoped (inherits pursuit tenancy). Account-level rollups (Accounts pane, SHOW ME
role-gap lists) take standard scope narrowing.

### UX placement (+ wireframe)

**Pursuit Detail** — the existing "Pursuit team" panel becomes the two-sided **Who matters** surface:
selling side stays the Phase-C ExecutionPlan; a buying-side coverage map joins it.

```
WHO MATTERS ─ buying side ────────────────────────────────────────────────
  champion            R. Vance · VERIFIED (human) · positive     [evidence ▸]
  technical validator D. Okafor · verified                       [evidence ▸]
  economic buyer      UNKNOWN                                    ← the gap
     Strongest warm path: WWT (ACTIVE relationship · named seller, fresh)
     · consent: named-overlap approved  [Request warm intro] (governed, existing)
  procurement         — no assertion (UNKNOWN)
  Discovered — unverified: "J. Meyer · VP Infrastructure" (pdl) [Propose as role ▸]
```

**Brief** consumes coverage automatically (builder extension only — the Brief remains a pure
presentation): WHO MATTERS adds the buying map (confidential), WHAT TO ASK adds gap-validation asks
(shareable), WHAT NOT TO CLAIM adds "do not assert executive sponsorship — unverified" when an
inferred-only role would be overclaimed. **Accounts pane**: WHAT NEXT gains one line — *"No verified
economic buyer on the active pursuit"* — when true. **Pipeline**: unchanged (already the
opportunity-scoped editor; now writing through the governed skill). **Contacts room verdict: KEEP,
not first-class for this job** — it remains the directory/hygiene surface (dedupe, reachability,
capture) and receives no stakeholder-intelligence investment; role truth renders on
Pursuit/Accounts/Pipeline surfaces. Do not delete; recommend revisiting its room status only in a
future nav phase (nav untouched now). **Today**: one high-materiality exception only — *high-band
pursuit entering late lifecycle with no verified economic buyer* (band- and lifecycle-gated,
ACTION_REQUIRED, deep-link `#team`). **Queue**: no new source; role-validation work arrives as the
existing motion/communication actions naturally reference it.

### Default-visible state

On Pursuit Detail: the coverage map renders compact (one line per role with a holder; UNKNOWN rows
grouped as "3 roles unknown" until expanded) — calm by default.

### Progressive disclosure

role line → evidence popover (facts, engagement, MEDDPICC note, discovery source) → contact; gap →
warm-path card → governed ask. Discovered candidates expand only on demand.

### Signature wow interaction

**"Who are we missing?" → click → buying-role map + strongest evidence-backed warm path:**
*"You have a champion and technical validator, but no verified economic buyer. WWT appears to have
the strongest warm path to the likely buyer."* — the sentence renders only when each clause is
grounded (roles from assertions, path from tier+recency+consent), and every clause decomposes on
click. "Likely buyer" language appears ONLY when a discovered-unverified candidate exists and is
always labeled unverified.

### ⌘K / EXPLAIN behavior

- *"who are we missing at Globex?"* / *"who is the economic buyer at Globex?"* → coverage answer
  with assertions + UNKNOWN preserved (new EXPLAIN intent).
- *"which WWT pursuits lack an economic buyer?"* → SHOW ME condition `missing:economic_buyer` +
  existing `through <partner>` filter, entity extended to pursuits (bounded allowlist).

### Demo story

Globex pursuit: seeded champion + technical validator verified, economic buyer absent, one PDL
discovered VP. Walk: Pursuit Detail shows the gap + WWT warm path → open Brief: sponsor rendering
shows the map; partner rendering withholds it but carries the validation ask → back on detail,
propose the discovered VP as inferred economic buyer (governed) → coverage updates to inferred —
honest, not verified.

### Scale behavior

Coverage is one bounded query per pursuit (≤ role-count rows); account rollups are aggregates;
discovered lists cap at the provider's small payloads. Many stakeholders per account stay grouped
under roles, not card walls.

### Exact proposed code changes

| File | Change |
|---|---|
| `supabase/migrations/0096_stakeholder_pursuit_scope.sql` | NEW — see below |
| `src/lib/pursuits/read-models/stakeholder-coverage.ts` | NEW — coverage + warm paths |
| `src/lib/pursuits/federation/skills.ts` | `assert_stakeholder_role` governed skill (+ precheck) |
| `src/lib/pursuits/ledger.ts` | additive `STAKEHOLDER_ROLE_ASSERTED` ChangeType member |
| `src/app/pipeline/actions.ts` | repoint `setStakeholderAction` through `dispatchSkill` |
| `src/components/pursuit/stakeholder-coverage.tsx` + `src/app/pursuits/[id]/page.tsx` | buying-side panel beside ExecutionPlan |
| `src/lib/pursuits/read-models/brief.ts` | WHO MATTERS / WHAT TO ASK / WHAT NOT TO CLAIM extensions (confidential rules above) |
| `src/lib/accounts/intel.ts` (+ pane) | whatNext gap line |
| `src/lib/pursuits/read-models/today.ts` | gated economic-buyer exception item |
| `src/lib/search/query.ts` | 1 EXPLAIN intent + SHOW ME `missing:<role>` condition |

### New schema/migration requirements (the wave's only migration)

```sql
-- 0096: additive; nullable; reversible. Extends the EXISTING primitive, invents nothing.
alter table stakeholders add column if not exists pursuit_id uuid references pursuits(id) on delete set null;
alter table stakeholders add column if not exists source text not null default 'human'
  check (source in ('human','ai_assist','import'));
alter table stakeholders add column if not exists assertion text not null default 'unverified'
  check (assertion in ('verified','inferred','unverified'));
create index if not exists stakeholders_pursuit on stakeholders (pursuit_id) where pursuit_id is not null;
-- deterministic backfill: pursuit_id from the opportunity's 0067 linkage; ambiguous ⇒ NULL
update stakeholders s set pursuit_id = o.pursuit_id from opportunities o
 where o.id = s.opportunity_id and s.pursuit_id is null and o.pursuit_id is not null;
```

Optional (flagged for explicit approval, not required by the design): additive role-enum extension
(`executive_sponsor`, `procurement`, `security`, `evaluator`). Default design maps the brief's role
list onto the existing six (executive sponsor→champion? **no** — left UNKNOWN rather than mislabeled;
hence the optional extension is *recommended* but severable).

### Risks

- PK remains `(opportunity_id, contact_id)`; a pursuit without an opportunity cannot yet hold a row.
  Mitigation options at implementation: allow a pursuit-scoped row via a relaxed PK **only if
  needed** (bigger change — would need its own approval), or v1 keeps coverage UNKNOWN-until-
  opportunity with the honest note "role map opens with the first opportunity". The design ships v1
  with the honest note; the PK question is surfaced now so review can decide.
- PII leak via Brief/participant payloads → covered by the confidential-by-default rule + tests.
- Title-based inference creep → forbidden by construction (no code path maps title→role).
- Duplicate truth vs MEDDPICC → §4 fixes authority: `stakeholders` owns *who holds the role*;
  `opportunity_meddpicc` owns *element assessment* and continues deriving from stakeholders.

### Tests required

Governed assertion (EXECUTED, ledger row, cross-tenant REJECTED); human rows never overwritten by
ai_assist promotion; coverage UNKNOWN honesty (no row ⇒ UNKNOWN, discovered stays unverified); warm
path requires consent state for reveal language; Brief partner rendering withholds the map but keeps
the ask; Today item only fires band+lifecycle-gated; migration idempotence + backfill determinism;
append-only unaffected; full regression battery.

---

## 4. CROSS-CAPABILITY INFORMATION MODEL

One authoritative object per fact; everything else is a derived read model. **Bold** = touched by
this wave.

| Chain link | Authoritative object | Derived read models | Owner org | Participant visibility | Evidence attached | UNKNOWN handling | Human decision? | Recompute may change? |
|---|---|---|---|---|---|---|---|---|
| Account | `companies` (+ facts) | Accounts pane, drawer | sponsor | via federation projections only | facts/evidence | fields nullable, shown as — | no | n/a |
| Account membership in a hypothesis | `propensity_scores` (evaluated) + `account_populations` (curated) | **Motion funnel stages** | sponsor | none | score_features | unevaluated ≠ 0 — absent from funnel | list approval | yes (rescoring) |
| Pursuit | `pursuits` (+ snapshots) | detail, portfolio, today, **funnel constraint rows** | sponsor | disclosure-filtered federation view | pursuit_facts | scores nullable | lifecycle decisions | yes (belief) |
| Motion (hypothesis) | `play_templates` + motion narrative fields | **MotionFunnelView** | sponsor | none | agent_runs citations | — | approve/reject (governed) | recommendation only |
| Motion (instance) | `revenue_motions` (company-scoped; `pursuit_id` = H2) | motions page rows | sponsor | none | operator_notes | outcome nullable | approve/activate/complete (governed) | no — status is decision |
| Route recommendation | `pursuit_route_snapshots` + `route_candidates` (+dims/reasons/disqualifiers) | route compare, **execution-history evidence row** | sponsor | shareable reasons only | reasons w/ refs + disclosure class | dimension absent ⇒ UNKNOWN cell | no (it's the machine) | **yes** |
| Route decision | `selected_*` on snapshot + `pursuit_overrides` | decided state, Brief ROUTE | sponsor | generalized | override reason/category | — | **yes (governed)** | **never** (invariant) |
| Partner presence (overlap/claim) | `account_populations`/`partner_accounts` | **activation profile · presence** | sponsor (their import) | overlap ladder w/ consent | import batch | not-listed ≠ no-relationship | list approval | no |
| Partner relationship strength/tier | `partner_relationships` | tier chips, warm paths | sponsor-asserted | GENERALIZED | tenure, notes | no row ⇒ NONE (distinct from UNKNOWN strength) | human-asserted | no |
| Partner participation | `pursuit_participants` | **activation profile · asked/accepted** | sponsor+participant | symmetric by design | consent grants | — | accept/decline (governed) | no |
| Pursuit Team | `pursuit_team_members` (canonical; legacy `pursuit_teams` = H4, non-authoritative) | ExecutionPlan, TEAM_WAITING, **responsiveness evidence** | sponsor | role-level only | ledger TEAM_* events | — | confirm/accept (governed) | proposal only, never confirmed rows |
| Seller relationship | `seller_account_relationships` (+H1 recency) | **getSellerPaths**, seller-fit | sponsor | none | last_interaction_at | NULL recency ⇒ UNKNOWN | assertable | fit recomputes; assertion stays |
| Stakeholder (buying role) | **`stakeholders` (+0096: pursuit_id, source, assertion)** | **coverage, gaps, warm paths, Brief WHO MATTERS** | sponsor | **none (ORG_PRIVATE; asks shareable)** | facts, engagement, MEDDPICC, discovery | **no row ⇒ UNKNOWN; discovered ⇒ unverified** | **yes — assert_stakeholder_role (governed)** | **never** |
| MEDDPICC element | `opportunity_meddpicc` | pipeline editor, coverage evidence | sponsor | none | notes + source | status `unknown` | per-element (human wins) | ai_assist proposals only |
| Action | `motion_actions` / `communication_actions` | Queue | sponsor | none | — | — | resolve done/skip | no |
| Outcome | `pursuit_outcomes` (canonical; `route_outcomes` + `revenue_motions.outcome` legacy, labeled) | outcome panel, **funnel WHAT-IS-WORKING, execution history** | sponsor | label w/o value magnitude | source_ref, snapshots | — | no (projection of events) | no (append-only) |
| Attribution | `attribution` (canonical; settlement sourced/influenced = registration-based legacy, labeled — H3) | insights, **partner execution mix** | sponsor | class only, disclosure-filtered | model_version, evidence, reason | UNKNOWN class is terminal-honest | override only (visible) | machine class recomputable; override wins |
| Learning | recompute queue + DEPENDENCY_MAP | readiness/today refresh | sponsor | n/a | correlation ids | — | no | is the recompute |

**Duplicate-truth register resolved by this model:** H3 (attribution vocabularies — canonical wins,
legacy labeled), H4 (teams — canonical wins), H5 (three relationship substrates — kept separate,
never merged), MEDDPICC-vs-stakeholders (role holder vs element assessment), funnel-vs-readiness
(gates are presentation; `activationReadiness` is the only stored readiness), legacy motion outcome
vs canonical outcomes (labeled, never summed).

---

## 5. INTERLOCK — one chain, worked

> **VMware displacement** (play slug) → Globex **qualifies strongly** (`propensity_scores` band
> very_high, features visible) → **WWT is the selected route** (`pursuit_route_snapshots.selected_partner_id`,
> human override preserved, `pursuit_overrides`) → **WWT seller is confirmed**
> (`pursuit_team_members` PARTNER_ACCOUNT_MANAGER ACCEPTED via governed skill) → **customer technical
> validator is verified** (`stakeholders` role=technical_buyer, assertion=verified) → **economic buyer
> remains UNKNOWN** (no row) → funnel gate `stakeholder overlay` holds Globex at **"not yet
> execution-ready for executive-value action"** → highest-information-value next move = the failed
> gate's remedy with the strongest consented path: **"validate the economic buyer through the WWT
> relationship"** (warm path: WWT ACTIVE tier + fresh named seller + named-overlap approved →
> governed `request_warm_intro`).

Every clause above names its authoritative object; every surface (funnel chip, Pursuit Detail, Brief
WHAT NEXT, ⌘K EXPLAIN) renders the *same* decomposition because all four read the same read-models.
Three dashboards showing unrelated scores is structurally impossible in this design: there are no
new scores.

---

## 6. IMPLEMENTATION SEQUENCE (challenged and refined)

The directional order P1A → P1B → P1C → P1D **stands** — repository evidence supports it (P1A is
pure derivation over finished substrate; P1B needs no migration; P1C carries the only migration +
governance change and benefits from P1B's warm-path pieces). Two refinements based on the audit:

**P0 — pre-wave hygiene (tiny, unblocks everything; ~half a bounded window):**
1. Migration: `seller_account_relationships.last_interaction_at` (H1 — fixes a live route-recompute
   break on migrations-only databases).
2. `scripts/backfill-motion-pursuits.ts` (H2 — deterministic, ambiguous ⇒ NULL) + verify.
3. This document's §0.4 demo-flag statement is the required documentation (done here).

**P1A — Motion Intelligence** (funnel + constraints read-models, Motions-room funnel, constraint
drawer, Pursuit Detail motion strip, portfolio pivot, 2 EXPLAIN intents + 1 SHOW ME) — verified +
committed as one slice. *Each phase lands its own surface integration immediately* (the pattern that
worked for B/C/F1), so "P1D Integration" stops being a big bang.

**P1B — Seller/Partner Intelligence** (activation profile + seller paths + execution evidence,
partner room transformation, route-compare row + sentence, Accounts line, Today materiality gate,
2 resolver additions).

**P1C — Stakeholder Intelligence** (migration 0096, coverage read-model, `assert_stakeholder_role`
governed skill + Pipeline repoint, Pursuit Detail panel, Brief extension, Accounts line, Today
exception, resolver additions). Sequenced last deliberately: it carries the schema + governance
surface and the PK question flagged in §3 Risks, which review should settle first.

**P1D — reconciliation (thin):** Insights cards (funnel rollup, activation-vs-presence,
optional buyer-coverage calibration), cross-capability EXPLAIN polish, demo-story seed touches,
consolidated acceptance verify + execution artifact.

**Realistic bounded-window fit:** P0 + P1A comfortably in the next build window; P1B likely fits in
the same window if review approves both at once (it is read-only and additive). P1C should be its own
window (migration + governed-write care + the PK decision). P1D closes the wave.

---

## 7. RISKS & DEPENDENCIES (consolidated)

| Risk | Phase | Mitigation |
|---|---|---|
| H1 breaks route recompute on clean databases *today* | P0 | additive column migration first |
| Motion↔Pursuit linkage sparse ⇒ funnel under-counts | P0/P1A | deterministic backfill; unlinked accounts shown in `evaluated` with `NO_PURSUIT` chip, never guessed into a pursuit |
| Gate definitions drifting from stored readiness | P1A | gates read stored objects (readiness, disqualifiers), never recompute inputs |
| Attribution vocabulary conflation (H3) | P1B | permanent labels; §4 authority; no summed totals across systems |
| Relationship substrates silently merged (H5) | P1B | separate named fields end-to-end; tests assert all five tiers surface verbatim |
| Sparse acceptance data → misleading rates | P1B | denominators always shown; floors before percentages |
| Stakeholder PII in shared payloads | P1C | ORG_PRIVATE default, Brief confidential-by-default, reveal only via consent ladder; explicit tests |
| `stakeholders` PK blocks pre-opportunity coverage | P1C | v1 honest-UNKNOWN note; PK relaxation is a flagged review decision, not slipped in |
| Score-model temptation (feeding execution history into fit) | all | forbidden this wave; `fit-v2` is a separate versioned proposal (§8) |
| Today noise creep | P1B/C | only the two gated exceptions defined above; both band-gated |
| Demo DB absent in fresh containers | all | verifies remain self-contained against the seeded demo build step, as this session already does |

Dependencies: Phase B outcomes/attribution (done) for execution history and funnel outcomes; Phase C
team/governance (done) for acceptance evidence and remedies; F1 Brief builder (done) for automatic
consumption; scope/drawer/⌘K systems (done).

---

## 8. WHAT SHOULD **NOT** BE BUILT (existing behavior already expresses it, or it violates doctrine)

1. **A Motion targeting/membership table** (`motion_targets`) — hypothesis→account membership is
   already `propensity_scores` (evaluated) + `account_populations` (curated). A third membership
   substrate would be duplicate truth.
2. **A composite partner score** — the dimensional system + tiers + evidence is the product stance;
   "one opaque number" is explicitly rejected by the brief and by §54 of the routing doctrine.
3. **A new stored "execution readiness" score** — staged gates are presentation over
   `activationReadiness` + canonical constraints; a second stored readiness would fork truth.
4. **Feeding execution history into route scoring this wave** — that is `fit-v2`, a versioned model
   change with recompute/learning implications; propose separately with calibration evidence.
5. **A stakeholder room / another contact database** — coverage lives on Pursuit, Accounts, Pipeline,
   Brief; Contacts remains directory/hygiene. (Both Partners and Motions rooms KEEP first-class
   status — each passed the distinct-job test; Contacts does not get new investment.)
6. **A parallel chat/query stack** — all questions extend the single `resolveExplain`/`parseShowMe`
   resolver with bounded intents.
7. **Title→role inference** — no code path may map a job title to a buying role; discovery stays
   labeled unverified until a human asserts.
8. **Merging settlement with canonical attribution** — labeled coexistence until a dedicated
   reconciliation phase.
9. **Producing the EXECUTIVE_RELATIONSHIP tier** or wiring interaction→seller-recency producers —
   both need producer-side changes (assertion UX / ingest wiring) that deserve their own bounded
   approval; the read side renders UNKNOWN honestly meanwhile.
10. **Nav redesign, external send, Value Case, MDF, CRM migration, production commissioning,
    broad Pursuit creation** — unchanged exclusions.

---

*Design pass complete. HALTED FOR REVIEW — no implementation until approved.*
