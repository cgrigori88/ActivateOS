# PursuitOS — Deferred Capability Reconciliation

**Purpose.** With the canonical route micro-loop shipped as the reference governed decision, this
document (1) maps the remaining canonical **lifecycle gaps** that now have clear architectural
priority (Parts B–E), (2) reconciles the broader deferred **capability vision** (Part F, ten
capabilities) against the canonical operating model and the scale-native UX doctrine, and (3)
proposes a single practical **7-day build plan** with dependencies, conflicts, and duplication risk.

**This is mapping / design / reconciliation only.** The only code change in this phase was the
Part A human-decision-persistence correction (shipped + verified 10/10). Nothing in Parts B–J is
implemented here. Halts for approval.

**Invariants preserved throughout:** two object models (canonical / legacy) coexist; RLS +
server-side disclosure; recommendation ≠ decision ≠ action ≠ outcome; UNKNOWN stays UNKNOWN;
governed-only mutation via `dispatchSkill`; append-only audit (0094); no external send; no CRM
migration; no new domain primitive unless explicitly identified below.

**Date:** 2026-08-31 · **Branch:** `claude/activateos-platform-review-xzkgmd`

---

## 0. Part A status — DONE

Human decision persists across belief-driven recompute (`persistRoute` carries the prior selection
onto the regenerated snapshot; recommendation regenerates independently; only a governed decision
changes the selection). Verified: `route-persistence:verify` 10/10 (recommended CDW / selected WWT →
recompute re-recommends a different route → selection stays WWT, history records CDW→new, read model
shows the divergence, a further recompute preserves it, only a governed selection changes it). All
loop/isolation/disclosure/recompute suites preserved.

---

## PART B–E — Canonical lifecycle gap maps (design; not implemented)

### B. Outcome + Attribution bridge

**Target loop:** Pursuit → recommendation → human decision → governed action → interaction/commercial
event → **outcome** → **attribution** → recompute → changed intelligence.

**Current-state map (verified):**
| Piece | State |
|---|---|
| Legacy live loop `outcome_events` | ~10 live writers (opp advance/close `CLOSED_WON/LOST/OPPORTUNITY_ADVANCED` `opportunities/lifecycle.ts:128`; promote `OPPORTUNITY_CREATED`; motion lifecycle/approve/reject/cadence; routing accept/decline `accounts/[id]/actions.ts`; agent creators). Readers: Insights, Analytics, Today, Account timeline. **This is the learning loop that operates today.** |
| Canonical `recordOutcome` / `recordAttribution` (`federation/outcomes.ts`) | Built + harness-proven; **no live app/worker caller** — only scripts/demo. |
| Attribution semantics | SOURCE / INFLUENCED / ASSISTED / OBSERVED / UNKNOWN, versioned, decision-time context (R14), override-convergence (R17). **Outcome ≠ Attribution** enforced (value lives on the Outcome; the claim is a governed interpretation). |
| `opportunities.pursuit_id` / `motions.pursuit_id` | Backfilled deterministically (opps 5+10 linked / 1 unresolved; motions 6 / 1). The bridge key exists. |
| Duplicate/conflicting sources | Analytics reads `POSITIVE_RESPONSE/NEGATIVE_RESPONSE/MEETING_BOOKED` from `outcome_events` but **no writer emits those there** (they live in `intel_events`/`email_events`) — a producerless slice to reconcile, not extend. |

**Exact gaps:** (1) a live producer of `pursuit_outcomes`; (2) a live producer of `attribution`;
(3) wiring recompute off a canonical outcome. **Design:** at each legacy human commercial-decision
writer that already fires and carries a `pursuit_id` (opp close, motion complete, routing
accept/decline), **dual-write** a governed `record_pursuit_outcome` skill → `recordOutcome` with
decision-time context (score/route/why-now snapshot ids, override id, `secondsSinceRecommended`) →
`recordAttribution` (versioned claim; never invents causality — UNKNOWN where the relationship isn't
provable) → `markOverrideConvergence` where the realized outcome agrees with the human's route → then
`recordAndEnqueue` so the loop reacts. Legacy `outcome_events` writes stay untouched (strangler).
**Do not** migrate ambiguous historical rows (already the backfill rule). **Governed:** a new
INTERNAL_WRITE skill `record_pursuit_outcome`. **Disclosure:** the outcome trail is disclosure-filtered
in the federation panel (built). **Complexity:** Medium. **This is the highest-closure, lowest-risk
next step** — all producers exist; it makes the loop's learning half operate.

### C. Team formation + governed Motion approval

**Target:** selected route → required Pursuit Team proposed → human confirms/changes → team
acceptance/readiness → Motion proposed → Motion approved → governed execution eligible.

**Current-state map:** route candidates ✓; selected route ✓ (Part A/micro-loop); seller-fit
(`routing/seller-fit.ts`) ✓; **Pursuit Team substrate** (`routing/team.ts`: `assembleTeam`,
`transitionMember`, `requiredRolesMet(pursuitType)`; `ParticipantRole` VENDOR/DISTRIBUTOR/RESELLER/
PARTNER/CUSTOMER) ✓; Motions lifecycle (`motions/lifecycle.ts:transitionMotion`,
`motions/approve.ts:approveMotion` writing legacy `outcome_events`) ✓; Queue ✓; `accept_participation`
skill (real) ✓; `request_team_acceptance` skill (**stub** `{requested:true}`); federation
participants + ACTION grants ✓.

**Exact gaps / unwired:** (1) `assembleTeam` has no live caller off a route selection; (2)
`request_team_acceptance` is a stub (no real invite/grant enforcement); (3) motion approval writes
legacy `outcome_events` but does **not** drive a canonical `transitionPursuit`
(MOTION_DESIGNED→READY_TO_ACTIVATE) nor `recordAndEnqueue`; (4) missing-role → readiness is computed
(`requiredRolesMet`) but not surfaced as a Today/Queue decision; (5) cross-org team acceptance needs
an ACTION grant (built) but no UI.

**Design (opinionated, not a workflow builder):** on a route SELECTED event, propose the required
team for the pursuit/motion type (`assembleTeam`) as a **recommendation** (recommendation ≠
assignment); a human confirms/changes via a governed skill; participant acceptance flows through
`accept_participation` (own-org) or `request_team_acceptance` made real (cross-org, ACTION-grant
gated); a designed Motion is approved via a new governed `approve_motion` skill that dual-writes
legacy + canonical `transitionPursuit` + `recordAndEnqueue`; missing required roles depress readiness
and surface a Today decision; decline/reroute re-opens the route decision. **Complexity:** Medium-High.
**Multi-party Execution Plan (F3) is the UI of this** — see F3.

### D. Governed external send (map only; do NOT implement)

**Target:** approved Motion → approved communication/action → `dispatchSkill` →
`governed_action_invocation` → outbox → executor → provider receipt → interaction/outcome.

**Current-state map:** the entire path is BUILT — `send_campaign_touch` (EXTERNAL_ACTION),
`action_outbox`, `executor.ts` (retry/dead-letter/compensation/revocation-recheck), `action_receipts`,
worker `drainOutbox`; `enqueueApprovedSend` exists but has **no app caller**. Gate:
`dataEnvironment==='PRODUCTION' && OUTREACH_AUTOSEND==='on'` — DEMO always simulates.

**Design constraint:** the system may draft / recommend / preview / request approval / **queue an
approved action**, but may not externally execute. `OUTREACH_AUTOSEND` stays OFF; no direct UI/agent
send; no autonomous outbound. **In-demo, a human confirm can walk decision→dispatch→outbox→receipt in
simulate mode**, proving the path without a live send. **Do not implement until B/C sequencing is
approved.**

### E. Canonical Pursuit creation / advancement

**Current-state map:** `upsertPursuit` (dedup on `(org_id, dedup_key)` where live) + `transitionPursuit`
(15-state non-linear map) are built; **no live app/worker producer** — pursuits materialize only via
the `pursuits:backfill` script + demo seed. Legacy account/opportunity flows are the live path.

**Design (strangler; no big-bang):** candidate producers to wire over time — propensity/account
intelligence (a scored account crossing a threshold proposes a Pursuit), user-created Pursuit (a
governed create), Motion (a motion implies its Pursuit), opportunity (an opp promotion), verified Fact
(a compelling event), interaction (deferred, Workstream G), import/API, agent proposal (**never
authoritative without governed policy** — an agent proposes, a governed skill + human/threshold
creates), partner/distributor contribution. Preserve deterministic creation/dedup. **First producer to
wire (lowest risk):** the propensity/opportunity path already in the app, behind a governed
`create_pursuit` skill with a deterministic dedup + threshold policy. **Complexity:** Medium; **breadth
is large** — this is a multi-phase strangler, not a single build.

---

## PART F — Deferred capability reconciliation (ten capabilities)

Fields per capability: **Baseline class · Substrate · Works today · Missing · Loop dependency · UX
placement · Default-visible · Progressive · Persona · Buyer problem · Wow · Disclosure · Governed ·
Outcome/learning · New room? · Demo fit · Complexity · Priority.**

### F1 — Pursuit / Account / Meeting Brief  ★ signature wow
- **Class:** E (designed) on a B substrate. · **Substrate:** `getPursuitDetail`, `getAccountIntel`
  (hunt/why-now/through-whom/what-next), the **server-side disclosure engine** + `buildFederationViewer`
  (sponsor⇄participant projection), route read-model, facts. Legacy `/briefs/[motionId]` is an
  *activation* brief (different job). · **Works today:** all the underlying intelligence + the
  disclosure projection exist and are rendered piecemeal in Pursuit Detail. · **Missing:** a single
  "Brief me" assembly answering WHAT'S HAPPENING / WHY NOW / WHO MATTERS / ROUTE / WHAT WE KNOW / WHAT
  THEY CAN KNOW / WHAT TO SAY / WHAT TO ASK / WHAT NOT TO CLAIM / NEXT BEST ACTION; and the meeting
  variant. · **Loop dependency:** low (reads existing intelligence); richer with B (outcome trail). ·
  **UX:** a **contextual drawer** on Pursuit / Account / Partner (NOT a new room; NOT `/briefs`). ·
  **Default-visible:** the one-line "what's happening + next best action". · **Progressive:** the full
  brief + the sponsor↔partner toggle. · **Persona:** seller / exec before a meeting. · **Buyer problem:**
  "walk into the room knowing what to say, what to ask, and what I may not claim to this partner." ·
  **Wow:** **sponsor view ↔ partner view of the SAME brief** via the built disclosure engine —
  "what to say" changes by audience, decided server-side. · **Disclosure:** IS the disclosure engine's
  showcase. · **Governed:** none (read). · **Outcome/learning:** consumes; a brief opened before a
  logged meeting is a signal (future). · **New room:** NO. · **Demo fit:** very high — the clearest
  differentiation. · **Complexity:** Medium (assembly + one drawer; the disclosure is built). ·
  **Priority:** **P1 (first) — challenge: this is the highest wow-per-effort and reuses the platform's
  most distinctive built asset; strongly consider pulling it forward.**

### F2 — Business Value / Value Case
- **Class:** E (no dedicated substrate). · **Substrate:** motion economics (`agents/motion-designer.ts`),
  `pursuits.expected_value`, facts (for verified inputs) — but **no `value_case` table**. · **Works
  today:** expected value + motion economics exist. · **Missing:** a Value Case object distinguishing
  verified / inferred / customer-confirmed / missing inputs, value confidence, defensible impact,
  assumptions; and the "what to obtain next to strengthen this" gap engine. · **Loop dependency:**
  medium (needs the facts-gap machinery; ties to outcome for realized value). · **UX:** a Pursuit-detail
  section / drawer. · **Default-visible:** expected value + confidence + "N inputs missing". ·
  **Progressive:** the input ledger + the strengthening recommendation. · **Persona:** seller / deal
  desk. · **Buyer problem:** "defend this number to a CFO." · **Wow:** "what information should we
  obtain next to materially strengthen this value case?" · **Disclosure:** internal / partner-safe /
  customer-ready variants (future). · **Governed:** none (read); confirming an input could be a governed
  write. · **Outcome/learning:** realized-vs-projected value feeds calibration. · **New room:** NO. ·
  **Demo fit:** medium-high. · **Complexity:** **High — thinnest substrate, and highest risk of
  violating "don't invent numbers" (doctrine 6).** · **Priority:** **P2 — challenge: DEMOTE from the
  user's P1. A safe P1-scoped slice is possible (surface EXISTING economic inputs + gaps only, no new
  modeling); the full Value Case object is P2.**

### F3 — Multi-Party Seller / Team Orchestration
- **Class:** C (substrate exists, unexposed). · **Substrate:** `routing/team.ts`, route participants,
  seller-fit, Queue, federation participants, ACTION grants. · **Works today:** team assembly + required
  roles compute; Queue is a personal worklist. · **Missing:** the "who across the ecosystem does what
  next, and who is blocking" projection; "the Pursuit is waiting on THIS participant, not the customer."
  · **Loop dependency:** **HIGH — this is the UI of Part C.** · **UX:** the **Queue becomes the personal
  projection of a shared execution plan**; a per-Pursuit "execution plan" panel on Pursuit Detail. ·
  **Default-visible:** "waiting on: <participant>". · **Progressive:** the full participant plan +
  blockers. · **Persona:** every ecosystem role (AE, partner seller, distributor BDM, architect). ·
  **Buyer problem:** "co-sell stalls because nobody owns the next step." · **Wow:** "the Pursuit is not
  waiting on the customer — it is waiting on this participant." · **Disclosure:** each participant sees
  their disclosure-filtered slice. · **Governed:** team confir/accept are governed (Part C). ·
  **Outcome/learning:** who-activated-when feeds partner activation history. · **New room:** NO (extends
  Queue + Pursuit). · **Demo fit:** high. · **Complexity:** Medium (mostly surfacing Part C). ·
  **Priority:** **P1 — but sequenced as the visible surface of Part C, not a separate build.**

### F4 — Motion / Campaign Intelligence
- **Class:** A (Motions/Campaigns live) → reframed canonical. · **Substrate:** `revenue_motions`,
  campaigns, pursuits, facts, propensity, Insights funnel. · **Works today:** motion lifecycle, campaign
  composer, Insights funnel/calibration. · **Missing:** the canonical thesis view — why this Motion
  exists, where it runs, which accounts qualify, through whom, what's working, **what constrains scale**
  ("explain why only six are execution-ready"). · **Loop dependency:** medium (needs readiness from C +
  outcomes from B for "what's working"). · **UX:** extend the **Motions** room + Insights (NOT a new
  room). · **Default-visible:** the funnel (62 evaluated → 6 execution-ready → $4.8M). · **Progressive:**
  the per-account constraint breakdown. · **Persona:** partner/marketing leader. · **Buyer problem:**
  "why won't this program scale?" · **Wow:** surfaces commercial **constraints** (partner overlap,
  verified timing, execution-readiness) rather than campaign vanity metrics. · **Disclosure:** partner-
  scoped. · **Governed:** none (read). · **Outcome/learning:** coverage-vs-win learning already exists
  (task #60) — extend. · **New room:** NO. · **Demo fit:** high. · **Complexity:** Medium-High. ·
  **Priority:** **P2** (agree with user; depends on B+C being live for the constraint story).

### F5 — Ask / Conversational Intelligence
- **Class:** A (Ask + ⌘K live). · **Substrate:** `agents/ask.ts` (READ MCP tool loop), `search/query.ts`
  (⌘K GO TO / SHOW ME / EXPLAIN), scope, disclosure. · **Works today:** grounded Q&A over READ tools;
  ⌘K structured queries + evidence-bound EXPLAIN. · **Missing:** breadth — natural language over the
  whole governed Pursuit graph ("which WWT Pursuits are waiting on us?", "what changed since Friday?",
  "where do CRM stage and engagement disagree?"). · **Loop dependency:** **HIGH — the marquee queries
  need B (outcomes/what-changed) + C (waiting-on).** · **UX:** evolve Ask + ⌘K (the SAME resolver — do
  NOT fork). · **Default-visible:** the box. · **Progressive:** per-answer evidence/provenance drill-in.
  · **Persona:** every persona. · **Buyer problem:** "ask the business a question in English and trust
  the answer." · **Wow:** every answer inherits authorization / scope / disclosure / evidence /
  UNKNOWN / recommendation-vs-decision. · **Disclosure:** inherited. · **Governed:** read-only (Ask
  never mutates). · **Outcome/learning:** consumes. · **New room:** NO. · **Demo fit:** high. ·
  **Complexity:** Medium (extend the resolver) but **gated on B+C for the best questions.** ·
  **Priority:** **P2** (agree; sequence after B+C so the headline queries actually resolve).

### F6 — Seller / Partner Intelligence
- **Class:** A/B (partner scorecards live; seller-fit built). · **Substrate:** `/partners` scorecards,
  `seller_account_relationships`, seller-fit, partner activation history, overlap ladder,
  `AccountIntelPane` (through-whom). · **Works today:** partner rooms, blind overlap, warm-intro,
  seller-fit ranking. · **Missing:** **contextual** surfacing (who owns/knows this customer, strongest
  relationship, who actually activates when asked) at the point of decision, distinguishing overlap /
  ownership / relationship / active-relationship / capability / activation-history. · **Loop
  dependency:** low-medium (activation history strengthens with B). · **UX:** contextual in the intel
  drawer + route decision (NOT just directory pages). · **Default-visible:** "through: <seller/partner>
  · activates ✓". · **Progressive:** the relationship/coverage/activation breakdown. · **Persona:**
  AE / partner manager. · **Buyer problem:** "who actually activates when I ask?" · **Wow:** the
  activation-history distinction (active vs nominal partner). · **Disclosure:** overlap/relationship
  are consent-gated (built). · **Governed:** warm-intro is governed (built). · **Outcome/learning:**
  activation history is outcome-fed. · **New room:** NO (extend drawer + Partners). · **Demo fit:**
  medium-high. · **Complexity:** Medium. · **Priority:** **P2.**

### F7 — Contacts / Personas / Stakeholder Intelligence
- **Class:** A/B (Contacts live; MEDDPICC stakeholders live). · **Substrate:** `/contacts`, `pdl_people`,
  MEDDPICC stakeholder role/sentiment (`opportunities/meddpicc.ts`), warm-path. · **Works today:**
  buying-committee taxonomy, stakeholder role/sentiment on opportunities. · **Missing:** the
  Pursuit-centric stakeholder view — who matters, which role is missing (economic buyer / technical
  validator / champion / detractor), warm path through which participant. · **Loop dependency:** low. ·
  **UX:** contextual on Pursuit/Account (NOT another contact database). · **Default-visible:** "champion
  ✓ · economic buyer UNKNOWN". · **Progressive:** the committee map + warm paths. · **Persona:** seller.
  · **Buyer problem:** "who do I still need, and who reaches them?" · **Wow:** missing-role + warm-path
  in one view. · **Disclosure:** contact reachability is consent-aware. · **Governed:** none (read). ·
  **Outcome/learning:** stakeholder coverage vs win. · **New room:** NO. · **Demo fit:** medium. ·
  **Complexity:** Medium. · **Priority:** **P2.**

### F8 — Renewal / Lifecycle Intelligence
- **Class:** B/C (renewal radar live on Pipeline). · **Substrate:** renewal radar (task #82),
  `opportunities/condition.ts`, transaction features, facts freshness, time-to-event signal (task #1). ·
  **Works today:** renewal radar surfaces renewal windows on Pipeline. · **Missing:** feeding renewal /
  contract / EOL-EOS / migration-window / installed-base-adjacency triggers directly into **Pursuit
  formation + Why Now**, with confidence + UNKNOWN preserved. · **Loop dependency:** medium (a renewal
  trigger is a Pursuit-creation producer — ties to Part E). · **UX:** Why Now + Pursuit creation (NOT a
  new room). · **Default-visible:** "renewal in 47d (verified)" / "renewal UNKNOWN". · **Progressive:**
  the lifecycle-trigger evidence. · **Persona:** renewals / expansion. · **Buyer problem:** "don't miss
  the window." · **Wow:** UNKNOWN honesty where renewal timing isn't verified. · **Disclosure:** own-
  tenant. · **Governed:** a renewal trigger can propose a governed Pursuit create (Part E). ·
  **Outcome/learning:** renewal outcome feeds timing calibration. · **New room:** NO. · **Demo fit:**
  medium. · **Complexity:** Medium. · **Priority:** **P2.**

### F9 — MDF / Investment / Program Measurement
- **Class:** E (**no substrate at all** — `grep mdf/market_development/program_investment` = empty). ·
  **Substrate:** none; would build on motions/campaigns + outcomes + attribution. · **Works today:**
  nothing MDF-specific. · **Missing:** everything — where money was invested, which Motions/Pursuits it
  supported, what happened, where to invest more/less. · **Loop dependency:** **HIGH — needs B
  (outcome/attribution) fully live to attribute sourced/influenced revenue to investment.** · **UX:**
  extend Insights/Portfolio (NOT reimbursement/claim processing yet). · **Persona:** partner-program
  leader. · **Buyer problem:** "is our co-marketing money producing pipeline?" · **Wow:** investment →
  sourced/influenced revenue lift. · **New room:** eventually, maybe. · **Demo fit:** low (no substrate,
  no demo data). · **Complexity:** High (greenfield). · **Priority:** **Later** (agree with user;
  strictly after B).

### F10 — Executive Ecosystem Reporting
- **Class:** A/B (Insights/Portfolio/Analytics live). · **Substrate:** Insights calibration, Portfolio
  matrix, Analytics funnel, partner scorecards. · **Works today:** funnel, calibration, portfolio pivots.
  · **Missing:** the executive narrative — where ecosystem revenue is emerging, which partners/routes
  work, what's blocked, which assumptions proved wrong, where investment produces lift, active vs
  nominal partners, where leadership should intervene. · **Loop dependency:** HIGH (needs B outcomes +
  C blockers + attribution). · **UX:** progressive disclosure over Insights/Portfolio (NOT generic
  dashboards, NOT a new room). · **Persona:** exec / leadership. · **Buyer problem:** "where do I
  intervene?" · **Wow:** "which assumptions proved wrong" + "which partners are nominal." · **New
  room:** NO. · **Demo fit:** medium (exec framing). · **Complexity:** Medium-High. · **Priority:**
  **P2/Later** (agree; after B+C provide the underlying truth).

---

## PART G — UX doctrine compliance (the filter every capability passed)

All eighteen principles hold for the placements above; the load-bearing ones for this roadmap:
**contextual drawers / progressive disclosure before new rooms** (every F-item lands in an existing
surface — *no new permanent room is proposed*); **recommendation ≠ decision ≠ action ≠ outcome**
(the four-stage distinction now spans the whole loop after B/C); **disclosure enforced server-side**
(F1's sponsor↔partner brief is its showcase, not a new mechanism); **UNKNOWN is legitimate** (F2
value inputs, F8 renewal timing, F7 economic-buyer must render UNKNOWN, never invented); **AI may
propose/explain, authoritative state stays governed** (F5 Ask stays read-only; E's agent proposals
never create a Pursuit without a governed policy); **ecosystem-native** (F3/F6 are the co-sell
differentiators). **No capability requires a nav redesign** — a stated non-goal.

---

## PART I — Proposed 7-day build plan

**Reality check:** the P0 loop-completion work (B + C) plausibly consumes most of a 7-day window on
its own. The plan is ranked by commercial differentiation × wow × substrate-reuse × loop-dependency ÷
risk, and is explicit that not everything fits.

### P0 — must ship (completes the canonical operating loop)
1. **[done] Part A** — decision persistence.
2. **Outcome + Attribution bridge (B).** Dual-write a governed `record_pursuit_outcome` at the
   legacy commercial-decision writers (keyed by the backfilled `pursuit_id`) → `recordOutcome` +
   `recordAttribution` (UNKNOWN where unprovable) + `markOverrideConvergence` + `recordAndEnqueue`;
   add a canonical panel to Insights. **Highest architectural closure, lowest risk (all producers
   built).** Verifiable end-to-end (extend `closed-loop-verify`).
3. **Team formation + governed Motion approval (C)** with its **Queue/Today surface = the core of the
   Multi-party Execution Plan (F3)**: propose team on route-select, governed confirm/accept, real
   `request_team_acceptance`, governed `approve_motion` (dual-write + `transitionPursuit`), missing-role
   → readiness → Today, "waiting on <participant>" in Queue.

### P1 — should ship if P0 is green
4. **Pursuit / Meeting Brief (F1)** — the sponsor↔partner disclosure brief drawer. **Challenge to the
   user's ordering: this is the single highest wow-per-effort and reuses the platform's most
   distinctive built asset (server-side disclosure); if P0 runs long, F1 is the one P1 item to protect
   for the demo.**
5. **Multi-party Execution Plan (F3) completion** — the full participant plan + blockers view (finishes
   the surface begun in C).

### P2 — next wave
6. **Motion Intelligence (F4)** · 7. **Ask expansion (F5)** (both need B+C live) · 8. **Value Case
   (F2) — scoped to existing inputs + gaps only** (challenge: demoted from the user's P1; the full
   object is deferred to avoid inventing numbers) · 9. **Seller/Partner Intelligence (F6)** · 10.
   **Stakeholder Intelligence (F7)** · 11. **Renewal/Lifecycle Intelligence (F8)** (ties to Part E
   creation).

### Deferred (Later)
12. **Canonical Pursuit creation/advancement (E)** — a multi-phase strangler; wire the first governed
   producer (propensity/opportunity threshold) after B/C, not in this window. · 13. **MDF (F9)** — no
   substrate; strictly after B. · 14. **Executive Reporting expansion (F10)** — after B/C supply the
   truth. · 15. **Governed external send (D)** — remains OFF; demo-simulate only, after B/C sequencing
   is approved.

### Where I challenge the directional ordering (with evidence)
- **B before C** (both P0): B is lower-risk and completes the learning half with zero new substrate;
  C is the larger build. Sequence B → C.
- **F3 is the UI of C, not a separate P1 build** — fold its core into C; only its full blockers view is
  the P1 remainder.
- **F1 up, F2 down:** F1 reuses the built disclosure engine for the biggest demo wow at Medium cost;
  F2 has **no substrate table** and the highest doctrine risk (inventing numbers). Recommend F1 as the
  protected P1 and F2 as a scoped P2 (existing inputs + gaps only).
- Otherwise the directional priority is sound.

---

## PART — Dependencies & conflicts

- **F3 → C**, **F5 → B+C**, **F4 → B+C**, **F9 → B**, **F10 → B+C**, **F8 → E** (as a creation
  producer). B is the keystone: five downstream capabilities need canonical outcomes live.
- **Naming/room conflict — "Brief":** legacy `/briefs/[motionId]` is a motion *activation* brief; F1 is
  a *decision/disclosure* brief. Ship F1 as a **contextual drawer on Pursuit/Account**, not a `/briefs`
  room, and disambiguate the term, or the two collide.
- **Attribution source conflict (B):** Analytics reads response/meeting event types from `outcome_events`
  that no writer emits there. Reconcile (point Analytics at the real `intel_events`/`email_events`
  source, or emit those types) — do not paper over it in the bridge.
- **Ask/⌘K fork risk (F5):** must extend the single `search/query.ts` resolver, not add a parallel NL
  path, or the two diverge on disclosure/scope.
- **`persistRoute` selection-preservation (Part A)** is now a dependency for any belief-driven ROUTE
  recompute that C/E introduce — satisfied.

---

## PART — Capabilities that would be harmed or duplicated by the roadmap

- **Value Case (F2)** risks **duplicating motion economics / `expected_value`** and, worse, violating
  "don't invent numbers" — constrain to surfacing existing inputs + gaps; do not build a parallel ROI
  calculator.
- **Motion Intelligence (F4)** risks **duplicating Insights/Analytics funnels** — must extend those
  surfaces, not add a competing dashboard.
- **Executive Reporting (F10)** risks **duplicating Insights + Portfolio** — same rule.
- **Seller/Partner (F6)** and **Stakeholder (F7)** risk **duplicating `/partners` scorecards, the
  Accounts intel pane, `/contacts`, and MEDDPICC stakeholders** — surface contextually, reuse the
  read-models, add no new directory.
- **Renewal (F8)** must extend the existing **renewal radar**, not add a second renewal surface.
- **A new "Brief" room** would **orphan the legacy motion brief** — reconcile as above.
- **Ask expansion (F5)** must not spawn a second conversational surface competing with ⌘K.
- No proposed item harms a current invariant: all reads inherit disclosure/scope; all writes are
  governed; no CRM migration; no new room.

---

## HALT

Delivered: (1) the verified Part A decision-persistence fix; (2) this reconciliation
(`audit/DEFERRED-CAPABILITY-RECONCILIATION.md`) mapping Parts B–F against the canonical loop + UX
doctrine; (3) the 7-day sequence (P0 B→C, P1 F1(+F3), P2 wave, Deferred E/D/F9/F10); (4) dependencies
& conflicts; (5) harm/duplication analysis. **No deferred capability was implemented.** Awaiting
approval of the sequence before any Part B/C/D/E build.
