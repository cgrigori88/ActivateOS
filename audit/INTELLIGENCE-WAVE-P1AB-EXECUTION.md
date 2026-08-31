# Intelligence Wave — P0 + P1A + P1B Execution

**Scope executed:** P0 hygiene → P1A Motion Intelligence → P1B Seller/Partner Intelligence, exactly
as approved. **P1C Stakeholder Intelligence was NOT implemented** (design decisions recorded in §12
for the next bounded phase). Halted for review after this artifact.

Doctrine held throughout: *reuse before extending; extend before inventing.* The wave shipped as
**read-models + surface integration over existing canonical truth** — one additive migration (a
repair of pre-existing drift), zero new domain primitives, zero new stored scores, zero recompute-
semantics changes, zero governance bypasses.

---

## 1. P0 — correctness / hygiene

### P0.1 — `sellerRelationship()` schema repair
- **Determination:** `last_interaction_at` IS part of the intended canonical relationship model —
  the Relationship Truth doctrine makes strength *temporal* ("a strong relationship with no recent
  engagement decays"), the seller-fit `activity_recency` dimension (weight .20) consumes it, and
  the verify harness models it. The code was right; the migration was missing.
- **Fix:** migration `0096_seller_relationship_recency.sql` — the smallest additive change
  (`add column if not exists last_interaction_at timestamptz`). **Deliberately no backfill:**
  interaction recency is never fabricated; NULL = UNKNOWN, and the reader already treats it as
  neutral (`recencyFactor(null) = 0.5`, displayed UNKNOWN).
- **Migrations-only routing verification:** `scripts/migrations-only-verify.ts` builds a database
  STRICTLY from `supabase/migrations/*.sql` (Supabase-compat bootstrap only, no harness SQL), seeds
  the previously-lethal shape (a VENDOR seller with an account relationship — the demo was dormant
  only because its sellers are partner-side), and runs the real `recomputeRoute`.
  **Demonstrated red before the migration** (`column "last_interaction_at" does not exist`),
  **green after: 5/5.** This is the regression that would have caught the drift.

### P0.2 — deterministic `revenue_motions.pursuit_id`
- One shared rule (`src/lib/motions/pursuit-link.ts`): exactly-one pursuit on (org, account,
  category) links; else exactly-one LIVE pursuit; else NULL — a total function of state, never a
  guess. Applied at **creation** (motion-designer insert now carries `pursuit_id`) and as a
  **reported backfill** (`scripts/backfill-motion-pursuits.ts`).
- **Report (demo world):** already linked **0** · deterministically backfilled **6** ·
  ambiguous, left NULL **1** (Globex — two live pursuits on the category) · no matching pursuit
  **0**. Idempotent on re-run.

### P0.3 — attribution vocabulary boundary
- Declared at the settlement module (`src/lib/partnerships/settlement.ts` header): registration-
  based `sourced|influenced` is **bounded to the partnership-settlement context**; the canonical
  attribution taxonomy (`SOURCE/INFLUENCED/ASSISTED/OBSERVED/UNKNOWN`, model_version + evidence +
  human override) is the **authoritative outcome interpretation for every Pursuit intelligence
  surface**. No silent merging; translation only explicit and one-way at a read boundary.
- **Enforced by construction** in every new P1A/P1B read-model (only canonical classes appear;
  asserted by tests) and **by labeling** where both coexist: the partner-room scorecard's
  settlement bentos now read *"registration-based (settlement)"*.

---

## 2. P1A — Motion Intelligence

### Read-model architecture (`src/lib/motions/funnel.ts`, read-only)
- `getMotionFunnels(db, orgId, {companyIds})` — one funnel per hypothesis. **The hypothesis level
  is the EXISTING structure** (a taxonomy node carrying revenue_motions, i.e. play/slug +
  propensity + Pursuit/Motion) — no `motion_targets`, no new membership substrate.
- `getMotionConstraints(db, orgId, node, companyId)` — the per-account decomposition.
- `accountsAtStage(view, stage)` — stage/cohort membership by the same predicates the counts use.
- `motionAcceptanceBlockage(db, orgId)` — Today's exceptions-only aggregate (one grouped query).
- All numbers derived at read time from canonical records. **No stored funnel counters.**

### Funnel / gate definitions (each gate reads ONE stored canonical object)
| Stage | Canonical source |
|---|---|
| evaluated | latest `propensity_scores` per company × node |
| qualify | latest band ∈ {very_high, high} |
| route-viable | current `pursuit_route_snapshots` with ≥1 non-disqualified `route_candidates` row |
| timing verified | `pursuits.current_timing_score` NOT NULL (UNKNOWN preserved otherwise) |
| team ready | required roles ACCEPTED/ACTIVE on canonical `pursuit_team_members` (no INVITED pending) |
| execution-ready | all above + governed route decision (`route_status='SELECTED'`) + an approved/active motion instance |

Where several pursuits exist on (account, node), the funnel evaluates the account's best pursuit —
"can at least one pursuit here move" — which needs no linkage guess (the strict linkage rule is
used only for writing `revenue_motions.pursuit_id`).

### Constraint taxonomy (existing vocabulary; nothing invented)
Gating: `BELOW_PROPENSITY_BAND`, `NO_PURSUIT`, `NO_ROUTE_SNAPSHOT`,
`ROUTE_DISQUALIFIED:<canonical disqualifier code>` (verbatim: NO_REQUIRED_CAPABILITY,
OUTSIDE_TERRITORY, …), `ROUTE_DECISION_PENDING`, `TIMING_UNKNOWN` (severity **UNKNOWN**),
`TEAM_ROLE_MISSING:<role>`, `ACCEPTANCE_PENDING:<role>`, `MOTION_NOT_APPROVED`,
`NO_MOTION_INSTANCE`. Informational (never gate — asserting them as blockers would invent a
relationship the readiness/disqualifier model does not define): `WEAK_EVIDENCE`, `ROUTE_CONTESTED`
(the existing Accounts-pane 6-point rule), `STAKEHOLDER_GAP:<role>` (only where a linked
opportunity's stakeholder map supports it). Every chip carries a ref and, where one exists, the
**governed remedy** (`select_partner_route`, `confirm/accept_team_member`, `approve_motion`) or a
deep link — intelligence becomes governed work through paths that already exist.

### Cohorts (P1A.3 — no new numeric score)
`ready` (zero gating constraints) · `nearly_ready` (exactly one SOFT gating constraint) ·
`blocked` (≥1 HARD or several) · `unknown` (only UNKNOWN-severity gates fail — timing UNKNOWN is
**never** shown as "blocked"). Ranked by `expected_value_weighted` within cohorts.

### Outcome rollup semantics (P1A.4)
Canonical `pursuit_outcomes` (WON/LOST/NO_DECISION) + `attribution` **effective** classes (human
override wins) for the hypothesis's pursuits; motions activated + canonically-linked opportunities
counted beside. `calibrated = sample ≥ 5`; below that the surface renders *"Early observed
outcomes … sample too small for calibrated performance conclusions."* Legacy motion-level outcome
words never mix into these figures.

### Surfaces
- **Motions room** — the funnel command view is the first viewport (one compact card per
  hypothesis: stages → $addressable/$ready → cohort chips → outcome line), with the signature
  **"Why aren't the other N ready?"** button. The pre-existing instance list remains beneath as the
  drill tier.
- **Constraint drawer** — server-rendered only when `?mdrawer=` is present (nothing serialized
  closed), same shell as the account drawer; accounts ranked by expected value with gating chips +
  dimmed informational lines; paginated at 30.
- **Pursuit Detail** — motion context strip (deterministic linkage only). **Brief** — motion
  context consumed automatically, `confidential: true` (withheld from the partner rendering).
  **Pipeline Portfolio** — `Motion` pivot dimension (existing `opportunities.motion_id` linkage).
  **Today** — one aggregate item (*"$X of <hypothesis> is blocked by participant acceptance"*)
  behind a $100k materiality floor; per-pursuit TEAM_WAITING items unchanged.
- **⌘K (single resolver extended)** — EXPLAIN: *why is <account> not execution-ready* (the
  funnel's own gate lines) and *why does <account> qualify* (propensity band + score features);
  hypothesis resolution deterministic (named-in-question wins, else the account's most recent
  motion — stated in the answer). SHOW ME: *execution-ready pursuits in <hypothesis>* resolved
  through the same funnel.

---

## 3. P1B — Seller/Partner Intelligence

### Activation Profile architecture (`src/lib/partners/intelligence.ts`, read-only)
`getPartnerActivationProfile` returns **separate named truths** — never a composite:
- **presence** (list truth): overlap accounts (partner_accounts ∪ partner populations), claimed
  accounts (customer/open lists), asserted relationship-tier distribution;
- **activation** (behavior): candidate/recommended/**SELECTED** pursuit counts, active joint rooms,
  asked→accepted/declined with `medianAcceptDays` from stored `invited_at→accepted_at` pairs
  (**UNKNOWN (null) when no pairs — never zero**; sample always beside the median; a missing
  acceptance record is never a decline — only status DECLINED is);
- **execution** (canonical outcomes only): won/lost/no-decision on their selected pursuits, by
  category, effective attribution-class mix, small-sample caveat;
- **blocking now** (INVITED waits with days) and **coverage gaps** (overlap w/o asserted
  relationship; w/o named seller).
Plus `partnerActivationHeadlines` (index/Insights chips) and `getSellerPaths` (five canonical
tiers, temporal decay identical to the seller-fit curve, NULL recency ⇒ UNKNOWN, ownership ≠
recommendation, flags a strongest relationship sitting outside the pursuit team) and
`getExecutionEvidence` (evidence lines for the route compare).

### Route intelligence (P1B.2 — scoring model untouched)
`RouteCandidateView` gains `executionHistory` / `executionSummary` — **display-only evidence**
attached in the read model for internal callers; the shareable payload never carries the win/loss
figures (verified). The candidate table renders an "execution history *(evidence, not a score)*"
row. `RouteComparisonInsight` renders the two-truths sentence (*"X has the stronger active
relationship, but Y has materially better execution history…"*) **only** when the human selection
differs from the recommendation AND both clauses independently ground (relationship bands actually
differ; the other side has wins on sample ≥ 2). On the current demo hero both relationship bands
render equal, so the sentence correctly does NOT fire — conservatism working as specified; the
demo's disagreement wow is carried by the profile headline instead. Recommendation and the human
decision remain separate and untouched (verified byte-identical across all intelligence reads).

### Relationship substrate boundaries (documented + enforced)
Four substrates, presented together, never merged: **lists** (overlap/claims — import truth, no
strength) · **asserted strength** (`partner_relationships` / `seller_account_relationships` —
tiers + decay) · **consented participation** (joint rooms, team acceptance — behavior) ·
**canonical outcomes/attribution** (what followed). A disagreement (CDW: present on 10, activated
in 40%) is surfaced as the intelligence, not reconciled away.

### Legacy/canonical team boundary
All new P1A/P1B reads use ONLY the canonical `pursuit_team_members` substrate (Phase C). The
legacy `pursuit_teams` table was not expanded, not migrated, and not read by any new surface; its
existing consumers (accounts room, motion-designer gate) are unchanged.

---

## 4. Exact surfaces changed

| Surface | Change |
|---|---|
| `/motions` | Funnel command view (first viewport) + constraint drawer (`?mdrawer/&mstage`), scope-aware |
| `/pursuits/[id]` | Motion context strip; route compare execution-evidence row + two-truths insight |
| Brief | Motion context line (confidential by default) |
| `/pipeline` | Portfolio `Motion` pivot dimension |
| Today | Participant-acceptance blockage aggregate (floor-gated); TEAM_WAITING urgency escalated only on high-band pursuits |
| `/partners` | Activation chips per partner card |
| `/partners/[id]` | Activation Profile leads the room; settlement bentos relabeled "registration-based (settlement)" |
| Accounts pane / drawer | THROUGH WHOM strongest-seller-path line (tier + recency + not-on-team flag) |
| `/insights` | Partner activation-vs-presence table (no leaderboard score) |
| ⌘K | 3 EXPLAIN intents + 1 SHOW ME family, in the single resolver |

**Screenshots** (after; no "before" captures exist for these surfaces):
`audit/intel-wave-screens/` — motions funnel (desktop light/dark + mobile), constraint drawer
(desktop + mobile), partner room CDW (desktop + mobile), partners index, hero pursuit, insights,
today. Captured from the production build against the rebuilt demo world; the auth-open build used
for capture was a local rebuild only (`.env.local` temporarily moved aside — restored; nothing
committed changes auth behavior).

### UX quality inspection (against the required checklist)
First viewport answers the Motion questions without scrolling; the drawer decomposition is
chip-per-constraint with governed actions (no card walls, no charts-without-questions, no
decorative AI); mobile wraps without horizontal overflow; density is calm-surface/dense-intel; the
partner room leads with the activation disagreement rather than directory data. Issues found and
fixed during the pass: hypothesis thesis line could surface a verify-created motion's text (now
prefers active/approved motions); the Today aggregate wording over-claimed "partner acceptance"
when the pending role can be vendor-side (now "participant acceptance"). The drawer scrim's
apparent cutoff in full-page screenshots is a fixed-position capture artifact shared with the
pre-existing account drawer, not a rendering defect.

---

## 5. Acceptance-test results

| Suite | Result |
|---|---|
| `motion-intel-verify` (funnel↔SQL reconciliation, ready cohort re-proven gate-by-gate, constraint↔source reconciliation, UNKNOWN separation, scope narrowing, canonical-attribution-only rollup, calibration flag, Brief withholding, Today floor via a real governed confirm/accept round-trip, EXPLAIN/SHOW ME grounded) | **20/20** |
| `partner-intel-verify` (separate truths + no composite, UNKNOWN median, latency↔timestamps, temporal decay + UNKNOWN recency, five tiers verbatim, reads mutate neither recommendation nor decision, shareable payload carries no execution figures, cross-tenant denial) | **17/17** |
| `migrations-only-verify` (P0.1 regression; red→green demonstrated) | **5/5** |
| Regressions: canonical-microloop 23 · route-persistence 10 · team-motion 0-failed · outcome-bridge 13 · closed-loop 18 · recompute 20 · outcomes 18 · append-only 11 · disclosure 21 · lifecycle-acceptance 21 | **all green** |
| Unit tests | **130/130** |
| `tsc --noEmit` · production `next build` | **clean** |

Isolation, disclosure, federation, governed mutation, tenant flags, closed loop, recompute,
outcomes, append-only, route persistence and the lifecycle acceptance proof are all re-verified
above, unchanged.

## 6. Performance at demo/scale volumes

The funnel is grouped-aggregate per hypothesis (≈7 queries per hypothesis, one row per evaluated
account, `ACCOUNT_CAP` 2000 defensive guard; constraint detail computed on drill-in only). Demo
volumes render instantly; the design scales by construction: stage counts stay grouped, drawer
lists paginate at 30, the partners index uses one grouped headline query, the profile is
constant-size. No infinite card walls were added anywhere.

## 7. Regressions discovered / fixed during the window

- **H1 (pre-existing, live):** migrations-only databases broke route recompute for any org with
  vendor sellers — fixed (P0.1) with the additive migration + permanent regression.
- Raw-audit corrections (documented, no code impact): `revenue_motions.pursuit_id` existed (0067);
  Analytics already reads `interaction_events`; the suspected `OPPORTUNITY_ADVANCED` constraint
  violation was not real (0011 re-adds it).
- The stale-container fast-forward at session start (work preserved on origin; no loss).

## 8. Unresolved issues

- The Globex motion↔pursuit linkage remains honestly NULL (two live pursuits on the category —
  the ambiguity is real; the funnel still evaluates Globex via its best pursuit).
- Seller recency has a schema home but no producer yet — recency renders UNKNOWN until the
  interaction→`last_interaction_at` producer is approved (deferred, §11).
- The two-truths route sentence has no firing example in the demo (both hero candidates band
  "high" on relationship) — by design; noted for demo narration.
- `pursuit-verify.ts` still requires the separate `wsa_verify` DB absent from this environment
  (pre-existing).

## 9. Demo story (all DEMO/synthetic; `scripts/demo-intel-story.ts`, idempotent)

Built through the REAL governed paths (dispatchSkill route decisions, team confirm/accept) and the
real outcome/attribution helpers: the Virtualization funnel now shows 10 evaluated → 8 qualify →
8 route-viable → 7 timing-verified → 3 team-ready → 3 execution-ready ($7.9M addressable / $3.0M
ready) with all four cohorts populated — timing UNKNOWN (Stark), acceptance pending (Initech,
nearly-ready, feeds the Today aggregate), no-route and below-band accounts, mixed outcomes. The
partner disagreement: **CDW appears in 10 overlapping accounts but is activated in 40% of them**,
while WWT activates in 80% of its smaller overlap; CDW carries more absolute canonical wins —
presence, activation and execution genuinely disagree, and neither partner becomes "correct":
recommendation and the human route decision remain separately governed. Results were not
manipulated to flatter the system (losses and no-decisions remain; UNKNOWNs remain).

## 10. Demo-only `outcome_learning` status (unchanged)

`scripts/demo-db.ts` enables `outcome_learning` only for the demo vendor-sponsor org. Demo
participant/guest tenants and all production tenants remain OFF, fail-closed behind the
`OUTCOME_LEARNING_ENABLED` env master AND the per-org row. This window changed nothing about that
configuration; no production flags or credentials were touched.

## 11. Explicit deferred list

fit-v2 (execution history into route scoring — versioned model decision) · interaction→seller-
recency producer · EXECUTIVE_RELATIONSHIP tier production · settlement↔canonical attribution
reconciliation (labeled coexistence stands) · relationship-substrate consolidation · Mapping
activation drill-in chips (kept minimal this window; profile exists for reuse) · Value Case ·
renewal/lifecycle expansion · expanded Ask · external sending · Part E broad Pursuit
creation/advancement · CRM migration · MDF · executive reporting expansion · production
commissioning · nav redesign.

## 12. P1C readiness (decisions LOCKED, implementation deferred per instruction)

Approved for the next bounded phase: extend the existing `stakeholders` table additively (nullable
`pursuit_id`; `source`; `assertion` ∈ verified/inferred/unverified); role assertions through a
governed `assert_stakeholder_role`; title→role inference forbidden; buying-side Brief content
confidential by default and disclosure-projected server-side; **the opportunity-dependent PK is
NOT relaxed in v1** — a pre-opportunity stakeholder surfaces as UNKNOWN / "not yet established"
until real design-partner workflow proves the structural change necessary. P1B's warm-path
ingredients (tiers, decay, consent state) are already in place for it.

---

**Status: P0 + P1A + P1B complete, verified, committed, pushed. P1C not implemented. HALTED FOR
REVIEW.**
