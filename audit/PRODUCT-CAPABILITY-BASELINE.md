# PursuitOS — Product Capability Baseline

**Purpose.** An evidence-only inventory of what the platform *actually* is right now — what
is implemented, what is substrate without a face, what is a shell, what is designed but
unbuilt, and what is legacy — established *before* any new capability work, so that the next
phase is planned against reality rather than against navigation labels or roadmap prose.

**Method.** Repository + documentation audit across all 34 routes, 6 API routes, the worker,
93 migrations (`supabase/migrations/0001…0093`), `src/lib/*`, the 13 unit suites and ~20
live-DB verify harnesses, and 41 audit documents. Four parallel evidence sweeps
(ecosystem/outreach rooms, intelligence/revenue rooms, platform/substrate, docs↔code
reconciliation) plus direct verification of the claims below. **No credit is awarded because a
file or a nav label exists** — every classification cites the code path that does or does not
run in the live app.

**Discipline.** This is analysis only. Nothing here is implemented, repaired, or refactored.
Orphans are flagged, not fixed. Legacy (Category F) surfaces are described, not deleted.

**Date:** 2026-08-31 · **Branch:** `claude/activateos-platform-review-xzkgmd`

---

## 0. How to read this — the classification scale

| Class | Meaning |
|---|---|
| **A** | Fully implemented **and** well surfaced — a user can do the whole job today. |
| **B** | Real substrate exists and works, but it is under-exposed (read-only, headless, gated dark, or reachable by only one surface). |
| **C** | Partial — the capability does part of its job; a material piece is a stand-in or missing. |
| **D** | UI shell / placeholder — a surface exists but the capability behind it does not. |
| **E** | Designed/documented, not implemented — architecture or roadmap only. |
| **F** | Legacy / superseded — works, but on an object model the platform has declared it is moving off. **Not to be deleted or refactored.** |

A surface can be **A in its own terms and F against the new architecture** — that dual reading
is the single most important fact about this codebase and is called out wherever it applies.

---

## 1. The five cross-cutting truths that color everything

These are verified facts, not impressions. Every entry below inherits them.

1. **Two parallel object models coexist.**
   - **Canonical Pursuit model** — `pursuits`, `pursuit_route_snapshots`, `route_candidates`,
     `pursuit_score_snapshots`/`_dimensions`/`_contributions`, `pursuit_participants`,
     `pursuit_overrides`, `governed_action_invocations`, `action_outbox`, `pursuit_outcomes`,
     `attribution` (migrations **0063–0093**). It is **flag-gated behind
     `PURSUIT_EXPERIENCE_ENABLED` (default OFF)** — `src/lib/pursuits/experience-flags.ts` +
     per-tenant `experienceEnabledFor`.
   - **Legacy CRM model** — `companies`, `propensity_scores`, `revenue_motions`,
     `opportunities`, `pursuit_teams`, `campaigns`. It is **always-on** and powers almost every
     room a user actually touches.
   - Migration `0067_reparent_fks.sql` adds **nullable `pursuit_id` FKs** onto
     motions/opportunities/campaigns/teams. Reparenting is additive and **latent — not the live
     path.** The intended migration from legacy → canonical has *not* been wired into any live
     room.

2. **The whole "pursuit experience → federation → governed_action → outcome_learning" stack is
   dark by default.** Each layer is gated by an env master switch **AND** a per-org
   `org_features` row, fail-closed (`src/lib/pursuits/tenant-flags.ts`). The rich Pursuits
   surfaces and the federation panel render only for an explicitly enabled tenant, and
   `notFound()` otherwise. There is **no admin UI to toggle these flags** — they are DB-managed.

3. **RLS is latent, not active.** `withTenant`/`withTenantOrg` open a transaction, resolve org
   via `SECURITY DEFINER resolve_user_org`, set the `app.org_id` GUC, and fail closed
   (`src/lib/db/tenant.ts`). `0090_force_rls` applies `FORCE ROW LEVEL SECURITY` to 150 tables.
   But the app still connects as the **table owner**, so RLS is inert defense-in-depth; today's
   isolation rests on explicit `where org_id = $` predicates. The documented cutover to the
   non-owner `app_rw` role is **not yet flipped** (task #67, still `pending`).

4. **Scope-awareness is uneven — three consumers, not the whole app.** `src/lib/scope` is
   imported by exactly: `src/app/layout.tsx` (the rail selector), `src/app/page.tsx` (Today),
   `src/app/pipeline/page.tsx` (Pipeline), and `src/app/api/palette/route.ts` (⌘K). **Accounts,
   Queue, Ask, Skills, Routines, Admin, and the MCP surface are NOT scope-aware** — contrary to
   the intuition that Accounts/Queue (both hero-ish worklists) narrow with the ecosystem lens.

5. **Governed mutation and disclosure each have exactly one real surface.**
   - `dispatchSkill` (the single mutation authority, 7 registered skills) is invoked by exactly
     **one caller: the MCP/agent API** (`src/app/api/mcp/route.ts`). **No human UI button
     invokes a governed action anywhere.** The new Pursuit surfaces only *describe* governed
     skills and *display* past invocations.
   - The two-dimension disclosure engine (`federation/disclosure.ts`, Audience × Sensitivity,
     EXACT/GENERALIZED/AGGREGATED/SUPPRESSED, existence-hiding) is real and server-side, and is
     surfaced in exactly **one UI: Pursuit Detail** (`DisclosureTheater`).

6. **Nothing beyond RLS migrations `0058–0062` is deployed to production.** Per
   `PRODUCTION-COMMISSIONING-REPORT.md`, `PILOT-OPERATIONAL-READINESS.md`, and
   `RISK-1-CUTOVER-STATE.md`: prod's `schema_migrations` tracker is stale, `0058–0062` were
   hand-applied, and the entire Pursuit transformation (`0063–0093`) is verified on the local
   `pursuit_demo` tenant only. **The canonical product exists as reviewed, harness-verified code
   plus a demo tenant — not as a deployed capability.** ("Done" in the transformation reports
   means *demo-tenant-done*.)

---

## 2. Capability inventory (A–F, with 12-field evidence)

Fields per entry: **Problem · Implementation · Files/routes/tables/workers · What a user can do
today · What's missing · Canonical-object · Scope-aware · Server-side disclosure · Governed
actions · Outcome-loop feed · UX surface · Class + strategic note.**

### 2.1 Canonical / disclosure surfaces (flag-gated, read-only)

#### Pursuits (portfolio) — `/pursuits`
- **Problem:** "What should I work next?" across all active commercial pursuits.
- **Impl:** `getPursuitPortfolio` renders one band-first row per Pursuit (priority, propensity,
  evidence, timing, route, readiness); never recomputes. `notFound()` unless flag on.
- **Files/tables:** `src/app/pursuits/page.tsx`; `read-models/portfolio.ts`, `caller.ts`,
  `types.ts`; `pursuits`, `pursuit_route_snapshots`, `pursuit_score_snapshots`.
- **Today:** **Read-only.** View grouped bands; click a row → detail. No forms, no mutations
  (no `actions.ts`).
- **Missing:** all action; off by default.
- **Canonical:** YES · **Scope-aware:** NO · **Disclosure:** NO (uses `callerFor`, not the
  federation viewer) · **Governed:** NO · **Outcome:** NO.
- **UX:** visually rich, functionally thin.
- **Class B** — canonical substrate, well-rendered, read-only, flag-off.

#### Pursuit Detail — `/pursuits/[id]` ★ crown jewel
- **Problem:** The executive decision surface for one pursuit — why now, route decision,
  disclosure, team, federation.
- **Impl:** bento from `getPursuitDetail`; branches **sponsor vs participant**; federation panel
  via `getPursuitFederation`/`getGovernedActions`/`getPursuitOutcomes` +
  `buildFederationViewer` when `federationEnabledFor`. `DisclosureTheater` toggles
  internal-vs-shareable reasons (`reasonsInternal`/`reasonsShareable`).
- **Files/tables:** `src/app/pursuits/[id]/page.tsx`; `read-models/detail.ts`,
  `federation/{read-models,grants,disclosure}.ts`; `pursuit_route_snapshots`,
  `route_candidate_reasons`, `governed_action_invocations`, `pursuit_outcomes`,
  `pursuit_participants`.
- **Today:** **Read-only** (the richest read surface in the app). Toggle disclosure audience
  client-side; view route compare, governed-action *history*, outcome trail. **No
  approve/override/select controls** — the "Route decision" panel is a candidate table, not a
  control.
- **Missing:** the entire route-decision *write* (governed-action write path is agent-only);
  half the panels depend on the federation flag.
- **Canonical:** YES (strongest) · **Scope-aware:** NO · **Disclosure:** **YES — the one true
  disclosure UI** · **Governed:** displays, never invokes · **Outcome:** reads
  `pursuit_outcomes` (display only).
- **Class B** — hero read surface; the decision *write* is absent.

#### Today (pursuit decision queue portion) — `/`
- **Problem:** "What decisions need me now?" — an executive command center.
- **Impl:** `getTodayQueue`/`getTodayExposure` (`read-models/today.ts`); scope-aware; renders
  decision cards with a deep-link CTA per item.
- **Files:** `src/app/page.tsx`; `read-models/today.ts`; scope substrate.
- **Today:** read the ranked queue and exposure; click through. **Scope-aware (narrows the whole
  page to `scope.companyIds`).**
- **Missing / ORPHAN:** the ROUTE_APPROVAL card deep-links to `/pursuits/${id}/route`
  (`today.ts:50`) — **a subpage that does not exist** (only `[id]/page.tsx` exists). The
  "Approve →" CTA **404s**. See §6.
- **Canonical:** YES · **Scope-aware:** YES · **Disclosure:** NO · **Governed:** NO (CTA is a
  broken link, not a dispatch) · **Outcome:** NO.
- **Class B/C** — scope-aware canonical read surface with a dead primary CTA.

### 2.2 Always-on legacy CRM surfaces (interactive, complete — A in their own terms / F vs canonical)

#### Pipeline — `/pipeline` ★ strongest always-on room
- **Problem:** Opportunity board with progressive disclosure — Attention / Portfolio / All /
  Review (deal-reg).
- **Impl:** 1,103-line `page.tsx` + `actions.ts` over legacy `opportunities`; view switch;
  MEDDPICC, momentum, condition, autopsy, stage-weight calibration, deal registration, CRM
  writebacks, renewal radar, ecosystem pivots (`PortfolioMatrix`, `PipelineAllTable`,
  `IntelDrawer`). Imports `getScopeContext`/`scopeParamFrom`.
- **Today (very rich):** advance stage; set/assess **MEDDPICC** (incl. AI assess); set
  stakeholder role/sentiment; register deal + set status; draft CRM writebacks + approve/dismiss;
  assign initiative; promote motion→opp. All `requireWrite`.
- **Missing:** on the legacy object model (`pursuit_id` FK unused here).
- **Canonical:** NO · **Scope-aware:** **YES** (re-authorized server-side) · **Disclosure:** NO
  (its "disclosure"-named helpers are pipeline formatting, not the federation engine) ·
  **Governed:** legacy writebacks/advancement, not skills/outbox · **Outcome:** **YES** (closes
  feed calibration/attribution/Insights; writebacks reconcile CRM).
- **Class A** (the deepest interactive board, scope-aware, progressive-disclosure UX) — **F vs
  canonical** (legacy `opportunities`).

#### Motions — `/motions` (+ Briefs `/briefs/[motionId]`)
- **Problem:** Agent-proposed revenue plays, human-approved, at scale; then a one-page
  activation brief per motion.
- **Impl:** `revenue_motions` ⋈ companies/taxonomy/propensity/partner/goal; lifecycle engine.
  Briefs assemble motion + cited evidence + cadence + threads.
- **Today (rich):** draft motions from a list or picked accounts (`designMotion`, batched,
  suppression-guarded); Approve/Reject/Activate/Abandon/Complete-won/lost/no_decision; edit
  thesis/trigger/CTA/notes; set goal/initiative. In Briefs: generate outreach draft (AI); Approve
  & send / Package for seller; Promote to opportunity. All `requireWrite`.
- **Canonical:** NO (`revenue_motions`, `pursuit_id` latent) · **Scope-aware:** NO ·
  **Disclosure:** NO · **Governed:** legacy lifecycle transitions (send uses legacy comms send,
  not the `action_outbox` executor) · **Outcome:** **YES** (approvals/completions → outcomes →
  Insights).
- **Class A** (most complete write surface) — **F vs canonical pursuit routing.**

#### Account Detail — `/accounts/[id]`
- **Problem:** Single-account flight recorder + evidence + team + motion.
- **Impl:** digest, deal timeline, meetings, propensity score/dimensions/features with cited
  evidence, completeness/coverage, partner-fit team, latest motion + assets, `outcome_events`
  timeline.
- **Today:** **Draft a motion (AI)**; **record a meeting note** (→ first-party evidence);
  **Accept/Decline routing** (`setTeamStatusAction` → writes `outcome_events`
  TEAM_ACCEPTED/DECLINED). Real governed-ish writes with `requireWrite`.
- **Canonical:** NO (companies/propensity_scores/pursuit_teams/revenue_motions) · **Scope-aware:**
  NO · **Disclosure:** NO · **Governed:** AI motion + routing via legacy actions, **not**
  `dispatchSkill` · **Outcome:** **YES** (writes `outcome_events`).
- **Class A** as legacy room — **F vs canonical.**

#### Accounts (list) — `/accounts`
- **Problem:** Scored-account CRM worklist with filtering/columns/export.
- **Impl:** legacy `propensity_scores` ⋈ companies/partners/opps/evidence; URL filters,
  configurable columns, sort, CSV export, slide-in `AccountIntelPane` via `getAccountIntel`.
- **Today:** filter by band/industry/partner/search; toggle/reset columns (shareable `cols`);
  sort; export CSV; open intel pane; deep-link to account room. All read/navigate.
- **Canonical:** NO · **Scope-aware:** **NO** (verified — missed the scope redesign) ·
  **Disclosure:** NO · **Governed:** NO · **Outcome:** NO.
- **Class A** as a legacy surface / **F-leaning vs canonical** (well-built CRM table on the
  superseded model; notably *not* scope-aware).

#### Queue (action worklist) — `/queue`
- **Problem:** One dated worklist merging motion cadence steps + conversation follow-ups.
- **Impl:** `motion_actions` (active motions) + `communication_actions`; window/source/partner/
  search filters, group-by, overdue floats up.
- **Today:** mark cadence Done/Skip; conversation Done/Dismiss. `requireWrite`.
- **Canonical:** NO · **Scope-aware:** **NO** (notable — a hero-ish worklist that never got
  scope) · **Disclosure:** NO · **Governed:** legacy resolves · **Outcome:** indirect.
- **Class A** (legacy, complete) — flagged: not scope-aware, not on the pursuit model.

#### Goals — `/goals`
- **Problem:** S.M.A.R.T. goals + revenue/pipeline targets with computed pace.
- **Impl:** `listGoals`/`listTargets`; progress from linked motions/campaigns; base-vs-joint
  target bars from opportunities.
- **Today:** create goal; mark achieved/archive/reactivate; set/delete revenue-or-pipeline
  target (overall or per-partner). `requireWrite`.
- **Canonical:** NO · **Scope-aware:** NO · **Disclosure:** NO · **Governed:** NO · **Outcome:**
  partial (progress from won/pipeline actuals).
- **Class A** (legacy, complete).

#### Insights — `/insights`
- **Problem:** What the outcome log says about machine performance + calibration controls.
- **Impl:** `computeFunnel(outcome_events)`, `calibrateStages` (declared vs observed, ±15pt
  divergence flag, per-partner overrides), `editIntensity`, `sourceOutcomeAttribution`,
  attention-trigger catalog toggles.
- **Today:** **edit stage weights** (org/per-partner, reset); **toggle attention triggers**
  (affects Today/Pipeline). `requireWrite`; revalidates `/pipeline`.
- **Canonical:** NO · **Scope-aware:** NO (its partner `wscope` is not `lib/scope`) ·
  **Disclosure:** NO · **Governed:** NO · **Outcome:** **YES — this IS the live
  calibration/attribution surface.**
- **Class A** (legacy but the real learning-loop dashboard).

#### Review (evidence triage) — `/review`
- **Problem:** Human triage of sampled/disputed/contradicted evidence, grouped by account.
- **Impl:** `review_queue` ⋈ `evidence`, contradiction/checker-disagreement first, source-trust
  popover.
- **Today:** Accurate/Inaccurate/Unsure verdict per item → tunes source trust + banks golden
  examples. `requireWrite`.
- **Canonical:** NO · **Scope-aware:** NO · **Disclosure:** NO · **Governed:** legacy verdict
  write · **Outcome:** **YES** (verdicts feed source-trust calibration).
- **Class A** (legacy, genuinely end-to-end).

#### Analytics — `/analytics`
- **Problem:** How the whole outreach program performs — send→meeting funnel, weekly trend,
  cadence, funnel cut by propensity band.
- **Impl:** aggregates over `campaign_touches`/`email_events`/`outcome_events`; complements
  Insights (Insights = machine calibration; Analytics = program performance).
- **Today:** **Read-only** analytics with band/timeframe filters.
- **Canonical:** NO · **Scope-aware:** NO · **Disclosure:** NO · **Governed:** NO · **Outcome:**
  reads the outcome/engagement log.
- **Class A** for read purpose (legacy).

### 2.3 Ecosystem & outreach rooms (legacy, interactive)

#### Intake — `/intake` (+ `/intake/[batchId]`)
- **Problem:** Per-partner CSV ingest — staged analyze → map → commit, with field auto-detect.
- **Impl:** `import_batches`/`partner_accounts`; per-partner cards (rows, match rate, freshness),
  runs log, upload; staged mapping pipeline with surfacing controls.
- **Today:** upload a partner book; auto-detect + adjust field mapping; commit; watch match rate;
  drill a batch. `requireWrite`.
- **Canonical:** NO (partner_accounts/companies) · **Scope-aware:** NO · **Disclosure:** NO ·
  **Governed:** legacy commit · **Outcome:** upstream (feeds mapping/scoring).
- **Class A** (legacy, complete ingestion).

#### Mapping — `/mapping`
- **Problem:** Overlap workbench — where partner books and our accounts meet, ranked by
  propensity, with real plays, conflict, and named lists.
- **Impl:** overlap/coverage/targets consolidated into one workbench (why-propensity, conflict
  descriptions, named target lists).
- **Today:** explore overlap, build named target lists, launch plays; conflict-aware.
  `requireWrite`.
- **Canonical:** NO · **Scope-aware:** NO · **Disclosure:** partial (own-tenant overlap; the
  *blind* cross-tenant overlap ladder lives in Admin/Partners) · **Governed:** legacy · **Outcome:**
  indirect.
- **Class A** (legacy, the ecosystem-mapping hero).

#### Contacts — `/contacts`
- **Problem:** One taxonomy for the whole co-sell buying committee, merging reachable contacts +
  PDL-discovered people + committee structure.
- **Impl:** merges three sources into typed, filterable people; engagement-annotated; capture
  from lists; deep filters.
- **Today:** browse/filter the committee; capture people to lists. `requireWrite`.
- **Canonical:** NO (contacts/pdl_people) · **Scope-aware:** NO · **Disclosure:** NO ·
  **Governed:** legacy · **Outcome:** indirect (engagement).
- **Class A** (legacy, complete).

#### Partners — `/partners` (+ `/partners/[id]`, `/partners/[id]/review`) · absorbs Joint
- **Problem:** Every partner as a room — scorecards, blind overlap, warm-intro requests, and the
  co-sell workspace.
- **Impl:** Partner Hub index (connected float up); partner scorecards (joint win rate, cycle
  time, sourced/influenced mix, responsiveness); blind overlap ladder (counts→bands→named, mutual
  approval, audit-logged); warm-intro requests (EQL) consent-gated on named overlap; Joint tab.
- **Today:** walk a partner room; run blind overlap; request warm intros; manage partnership;
  review. `requireWrite`.
- **Canonical:** NO (partnerships/partner_relationships) · **Scope-aware:** NO (but it *is* the
  partner axis scope narrows *by*) · **Disclosure:** **YES for overlap/intro** (consent +
  disclosure-ladder gating — the second real consent surface, distinct from the E3 federation
  engine) · **Governed:** warm-intro request routes through MCP `request_warm_intro` governed
  skill in the API path; the room's own writes are legacy · **Outcome:** partial (scorecards).
- **Class A** (legacy + real consent gating).

#### Joint pursuits — `/joint` (+ `/joint/[id]`)
- **Problem:** The cross-tenant co-sell rooms this tenant shares with partners; symmetric
  settlement ledger.
- **Impl:** co-sell workspace, broker proposal, "what they can see" panel, symmetric
  sourced/influenced ledger; a pursuit can only be proposed on a NAMED-overlap account.
  `joint_pursuits.pursuit_id` binds each room to a canonical Pursuit (E3-A).
- **Today:** propose/broker joint pursuits; view symmetric ledger; disclosure-gated proposal.
- **Canonical:** partial — **the joint room is now a projection bound to canonical `pursuits`
  via `joint_pursuits.pursuit_id`** (the clearest place the two models are stitched) ·
  **Scope-aware:** NO · **Disclosure:** partial (named-overlap door key; not the full E3 engine)
  · **Governed:** legacy · **Outcome:** ledger.
- **Class A/B** — demoted to a tab under Partners; the pursuit binding is the migration seam.

#### Campaigns — `/campaigns` (+ `/campaigns/[id]`) · Upcoming — `/upcoming`
- **Problem:** Compose multi-touch branded email sequences against target lists; then the dated
  send plan across every launched sequence.
- **Impl:** branded HTML template renderer; multi-touch sequence generator agent; two-layer touch
  personalization; campaign ↔ target lists; AI list suggestions. Upcoming = the dated fire plan;
  due rows sendable now, rest wait for cadence offset or the armed worker.
- **Today:** compose/preview/approve/reject/send campaigns; manage lists; send due rows or let the
  worker fire them. `requireWrite`; real send gated on Resend config.
- **Canonical:** NO (campaigns/campaign_touches) · **Scope-aware:** NO · **Disclosure:** NO ·
  **Governed:** send is legacy comms path, **not** the governed outbox executor · **Outcome:**
  **YES** (sends → engagement → signals/scoring; replies → Insights).
- **Class A** (legacy, complete outreach engine).

### 2.4 Read-only instrumentation

#### Sources — `/sources`
- Per-source earned trust / verification outcomes ("anti-intake dashboard"). `signal_sources` ×
  evidence rollup (trust_score, audit sampling, verified/quarantined/rejected, predictive_value).
  **Uses raw `getPool()` — no `withTenant`.** Read-only. Canonical NO · Scope NO · Disclosure NO
  · Governed NO · Outcome indirect (predictive_value). **Class A** for its narrow read purpose.

#### Provider health — `/provider-health`
- Live state of every intelligence provider (tier/cost/enabled/runs, sparkline, last error). Raw
  pool, no tenant scope. Read-only (no enable/disable here). **Class A** for read purpose / **B**
  if provider toggles are expected here.

#### Trust center — `/trust`
- Enterprise procurement self-serve. Live counts from `audit_log`/`agent_runs`/`evidence`/
  `api_keys` under `withTenant`; residency/subprocessors are declared prose. **Class A/B** (live
  where a number exists; **E/documented** where prose).

### 2.5 Platform & agent surfaces

#### Ask (conversational grounded answers) — `/ask`
- `askTheRecord` runs a Claude Haiku tool loop over the **READ-only** subset of `MCP_TOOLS`
  (`t.write===false`), max 6 rounds, persists to `ask_exchanges`; uses the org BYO key. Writes
  structurally excluded. Canonical YES (reads canonical read-models via MCP) · Scope **NO** ·
  Disclosure partial (inherits MCP tool boundaries, not the E3 engine) · Governed **NO** (by
  design) · Outcome NO. **Class A.**

#### Skills (curated-instruction library) — `/skills`
- `skills` table typed by `kind × scope`; `skillsForContext` injects them into motion/campaign
  runs; usage counted from `agent_runs.skill_ids` (real grounding). Cross-tenant offer→accept
  (`skill_shares`, live-read never copied). Canonical YES · Scope NO (own typed scope) ·
  Disclosure partial (sharing gated by partnership + consent) · **Governed NO — this is NOT
  `dispatchSkill`; it is a prompt-grounding library despite the shared word "skill"** · Outcome
  YES (reply attribution back onto skills). **Class A.** *(Namespace collision flagged in §7.)*

#### Routines (scheduled standing jobs) — `/routines`
- Fixed `ROUTINE_CATALOG` of exactly two kinds — `morning_brief` (daily), `account_digest`
  (weekly), both **read-only digests** (guardrail displayed), compiled deterministically,
  watermarked. Worker `runDueRoutines`; Resend delivery. Canonical YES · Scope NO · Governed
  **NO** (never call `dispatchSkill`) · Outcome NO. **Class A** for its deliberately narrow
  scope.

#### Admin (platform operations, owner-only) — `/admin`
- 939-line owner-gated room: members/roles/invites, ICP + suppression, partnerships + invite
  codes + `/join` guest links, blind overlap ladders, agent API keys (mint/revoke), BYO-model
  key, shared lists (grants), GDPR export/erase, audit ledger, AI-operations panel (spend/latency/
  override-rate, provider failures, queue depths, worker heartbeat). Canonical YES · Scope NO ·
  Disclosure YES for overlap/grants · **Governed:** no direct `dispatchSkill` but **it is the
  governance substrate's control panel** (keys, roles, consent grants) · Outcome partial
  (override-rate). **Class A.**

#### Ops (governance ops, owner-only) — `/ops`
- Owner-gated read-only view over `governed_action_invocations`/`recompute_requests`/
  `action_outbox` status roll-ups + dead-letter table. Canonical YES · Scope NO · Disclosure YES
  (ids/status only) · **IS the governance-substrate observability surface** · Outcome indirect.
  A `trace` helper exists in `ops.ts` but the page doesn't render it; no retry/compensate
  controls; empty until governed_action/federation enabled. **Class B** (strong substrate,
  under-exposed). **Navigation orphan — no rail entry; reachable only by typed URL (§5, §6).**

### 2.6 API & headless surfaces

#### MCP server — `/api/mcp`
- Stateless JSON-RPC 2.0 (GET→405). Bearer `pos_` key → `resolveKey` → org + role. Reads run
  `withTenantOrg`. **Write tools never run inline** — they carry a `skillId` dispatched through
  `dispatchSkill` (two write tools: `draft_campaign_touch`, `request_warm_intro`). Rate-limited.
  **The primary — and only — external caller of `dispatchSkill`** (`route.ts:80`). Canonical YES
  · Scope **NO** (key = org) · Disclosure YES (cross-tenant only where consented) · Governed
  **YES** · Outcome indirect. **Class A** as an API / **B** as a capability (little UI beyond key
  mint).

#### Palette / unified search — `/api/palette`
- GET; five org-scoped entity lookups + R6 three-intent resolver: **GO TO** (entity nav), **SHOW
  ME** (allowlisted structured SQL over the opportunity read-model, **honors scope** via
  `resolveScope`), **EXPLAIN** (verbatim route/timing facts, disclosure-filtered — TRANSACTION_
  CONFIDENTIAL/RESTRICTED/PII withheld). Deterministic; unmatched fails honestly. Canonical YES ·
  **Scope-aware YES** · **Disclosure YES** · Governed NO · Outcome NO. **Class A.** *(SHOW ME
  covers only the `opportunity` entity; EXPLAIN grounds only route/timing — noted for future
  breadth.)*

#### Research trigger — `/api/research`
- Bearer `RESEARCH_TRIGGER_SECRET` (closed if unset). POST drains `research_jobs` under a global
  advisory lock; GET returns queue status. Owner pool with caller-`orgId` validated against
  `organizations` (R1-G3). Headless. **Class A** (infra).

#### Writebacks — `/api/writebacks`
- GET, `withTenant` + `requireWrite`; exports approved CRM corrections as **CSV** and flips them
  to `exported` — the same queue a future live adapter would drain; human gate preserved. **No
  live CRM push adapter.** Headless. **Class C** (partial — CSV stand-in, no push).

#### Privacy export — `/api/privacy/export`
- GET, owner-only + `withTenant`; `exportDataSubject` returns portable JSON (Art.15/20). Paired
  with Art.17 erase in `src/lib/privacy` (anonymize-in-place, ERASE-confirmation, audited with a
  one-way email hash). Surfaced via Admin. **Class A.**

#### Resend webhook — `/api/webhooks/resend`
- POST, **Svix signature verified (503 if no secret — never unauthenticated)**. Inbound →
  `processInboundMessage`; delivery events → `email_events`; OPEN refreshes engagement, CLICK
  emits scoring signals + rescores; BOUNCE/COMPLAINT suppress. Outcome **YES** (engagement →
  signals → score). Headless. **Class A** (infra).

### 2.7 Substrate (real, mostly headless)

#### dispatchSkill — the single mutation authority ★
- `dispatchSkill(db, skillId, actor, ctx)` over a versioned code registry (`SKILL_REGISTRY`, **7
  skills**): idempotency → actor eligibility + role rank (R9) → loop guard (R23, MAX_CHAIN=25) →
  precheck → **effect-class routing**: READ/INTERNAL_WRITE run the handler; CROSS_TENANT_ACTION
  needs an ACTION grant or a skill `authorize` hook (R24, never a DATA grant); EXTERNAL_ACTION is
  **enqueued to `action_outbox`, never run inline** (R25). Never throws on policy rejection — the
  REJECTED invocation *is* the audit row. `src/lib/pursuits/federation/skills.ts`. Callers:
  `api/mcp/route.ts`, `comms/governed-send.ts`, `comms/sequence.ts`. Missing: only 7 skills;
  several handlers are stubs (`request_team_acceptance`, `send_partner_intro` return
  `{requested:true}`); single-version in practice. **IS the governance substrate.** UX headless
  (Ops is its read window). **Class B.**

#### External-action outbox + executor
- `dispatchSkill` enqueues EXTERNAL_ACTION to `action_outbox` (unique on org+idempotency_key). The
  **executor** (`executor.ts`, R1-G4) is the sole transport: idempotency, bounded exponential
  retry with retryable-vs-final classification, dead-letter (`FAILED_FINAL`), per-skill
  compensation, revocation re-check before execution, feature gating (demo/synthetic never hits a
  live provider), provider ack → `action_receipts`. Real send only with `OUTREACH_AUTOSEND=on` +
  PRODUCTION. **Class B.**

#### Recompute engine — `federation/events`
- `DEPENDENCY_MAP` (R11) change-type → recompute targets (SCORE/ROUTE/READINESS/TODAY/WHY_NOW);
  runs at event as-of not now() (R12); append-only snapshots (R13); immaterial recomputes
  computed then **SUPPRESSED** (R22); loop guard (R23). Worker drains `recompute_requests` every
  tick, recovers stale RUNNING, caps poison attempts. Only **route** recompute is wired (R40 —
  proves the machinery); inert until experience/federation enabled. **No live producer enqueues
  recomputes** (§6). **Class B.**

#### Federation (disclosure / grants / participation / read-models)
- Two independent policy dims — Audience × Sensitivity (`disclosure.ts`); `resolveDisclosure`
  returns exact/generalized/aggregate/**suppressed** (existence hidden, T11), never
  string-redaction. Consent grants (`grants.ts`) bind purpose+scope+expiry, DATA vs ACTION (R24),
  revocation via `grant_is_live` (never deletes). Per-viewer read-models over RLS-scoped rows.
  Gated dark; grant proposal/accept UI thin; mostly exercised by verify scripts. **Class B.**

#### Tenant isolation — withTenant / RLS / FORCE RLS
- Described in §1.3. Substrate present, cutover-pending. **Class B.**

#### Tenant-scoped feature flags — `org_features`
- `live_for = envEnabled(flag) && org_features.<flag>`, fail-closed; dependency chains resolved in
  `tenantFeatures`. Server-enforced (`experienceEnabledFor`/`federationEnabledFor`), never
  nav-hiding alone. **No admin toggle UI** (DB-managed). **Class B.**

#### Ecosystem scope — `src/lib/scope`
- Pure `scope.ts` (types/serialize/parse, fail-safe → ALL) usable client-side; `server.ts`
  derives only options that have data and **resolves a scope to an authorized `companyIds[]`
  inside RLS**, re-evaluated every request. URL `?scope=` (shareable, re-authorized) + cookie.
  Empty array is a valid empty state, never widened. Consumed by Today/Pipeline/palette only.
  **Class A** (where wired).

#### Observability — `src/lib/obs`
- `reporter.ts` — a `Reporter` interface selected by env, no-op if unconfigured;
  `TelemetryEvent` carries **only ids + typed metadata + a short safe message, deliberately no
  free-form payload field**. `log.ts` — one JSON line/event with correlation id. `dispatchSkill`/
  executor emit on reject/fail. **No concrete provider adapter shipped** (Sentry-class = roadmap);
  no alerting. **Class B/E** (interface designed, no provider wired).

#### Research pipeline + providers
- `intel/provider.ts` normalized flow SOURCE→RAW→ENTITY→EVIDENCE→SIGNAL→TAXONOMY→TRUST→
  CORROBORATION→SCORING→MOTION; **~16 providers** (EDGAR, Tavily, GitHub, Greenhouse/Lever/
  careers, BuiltWith/Wappalyzer/http-fingerprint, DNS/Censys/ipinfo, GDELT, CommonCrawl, PDL,
  website). `research-runner.ts` drains `research_jobs` under advisory lock, re-maps + re-scores.
  Many gated on API keys; free tier works. Headless (surfaced via Sources/Provider-health/Review).
  **Class A** (infra).

#### Signals / Facts / Scoring
- `signals/types.ts` — canonical families + decay half-lives. `facts/model.ts` is the **only
  writer of `facts`**: one current fact per semantic slot (supersede, append-only, idempotent,
  as-of aware) + an 18-module facts subsystem (confidence, convergence, freshness, promotion,
  why-now, contradictions). `scoring/score.ts` computes explainable dimensioned scores. **Is the
  object-model core.** Full dimension recompute not yet wired into the reactive engine (R40).
  **Class A** (substrate) / **B** where recompute-gated.

#### AI client + BYO-model — `src/lib/ai`
- Two-tier routing (`claude-haiku-4-5` cheap vs `claude-opus-5` frontier); SDK credential order
  incl. OAuth. Tenant key AES-256-GCM under `APP_ENCRYPTION_KEY`, never displayed, clearing
  reverts to platform key; disabled without an encryption key. Surfaced (Admin BYO card). **Class
  A.**

#### Background worker — `src/worker/index.ts`
- Single Railway process; HTTP triggers (secret-auth, `/health` open) + minute-ticker: research
  every N hours; **recompute-queue drain every tick**; outreach drain only when
  `OUTREACH_AUTOSEND=on` (dark; non-PRODUCTION always simulates); `runDueRoutines`; nightly
  logical backup; daily screening sweep. Registers the governed executor and drains the outbox.
  Headless (heartbeat on Admin). **Class A** (infra).

### 2.8 Outcome/learning — the split that must not be conflated

#### Legacy outcome loop (`outcome_events`) — LIVE
- The always-on rooms (Pipeline closes, Motions completions, Account routing decisions, Review
  verdicts, engagement events) write `outcome_events`; **Insights** and **Analytics** read it
  (funnel, calibration, source→outcome attribution, reply outcomes, edit intensity). **Class A —
  this is the learning loop that actually operates.**

#### Canonical E3-F loop (`pursuit_outcomes` / `attribution` / `experiment`) — DEMO-FED
- `federation/outcomes.ts` keeps three objects that never collapse (R10/R15), outcomes captured
  with decision-time context (R14), org-scoped experiments (R16), override convergence (R17).
  **But `recordOutcome`/`recordAttribution`/`createExperiment`/`assignCohort` are invoked only by
  demo/verify scripts** — never by `transitionPursuit`/`advanceOpportunity` in the live app.
  `OUTCOME_LEARNING_ENABLED` off; docs explicitly disclaim "no calibration on synthetic data."
  Surfaced read-only in the gated federation panel's outcome trail. **Class B/E** — canonical
  layer built and harness-proven, not operating.

### 2.9 Designed-only / not built (Category E)

| Capability | Evidence |
|---|---|
| **Salesforce (or any live CRM) write-back adapter** | Generic `crm_writebacks` + `/api/writebacks` CSV exist; `grep -ri salesforce src/ supabase/` = **empty**. No provider adapter. **E** (the queue is C). |
| **Interaction base model + Gmail/Calendar/Microsoft Graph capture** | Only the link table `pursuit_interactions` (`0066`) with a dangling `ref_id`; **no base `interactions` table, no OAuth, no adapter.** Workstream G never executed. **E.** |
| **Generalized actor↔actor `relationships` table** | Only link table `pursuit_relationships` (`0066`) with dangling `ref_id`; no base `relationships` table. Legacy `partner_relationships`/`seller_account_relationships` are the only relationship stores. **E.** |
| **Surface Router (events + routing, roadmap §41-42)** | `grep surface_router / surfaceRouter` = **empty** in `src/` and migrations. **E.** |
| **Observability provider adapter (OR-3)** | Interface + null/console sinks ship; COMMISSIONING §3 marks OR-3 "LIVE PASS BLOCKED — a real provider adapter must be wired." No Sentry/Datadog code. **E** (seam built). |
| **Human governed-action UI** | `dispatchSkill` has no human caller; the Pursuit route-decision panel renders no controls; Today's approve CTA 404s. The *decision-write* half of the canonical product is **designed, not built into any UI.** **E.** |

---

## 3. What existed before the UX redesign — and remains preserved

The scale-native redesign (scope, Today command center, Pipeline views, intel drawer, ⌘K) and the
earlier demo-experience work changed *how* capabilities are reached, not *whether* they exist.
Accounting for every prior capability:

### 3.1 Preserved unchanged
- **Motions, Briefs, Campaigns, Upcoming, Contacts, Intake, Mapping, Goals, Review, Analytics,
  Sources, Provider health, Trust, Admin, Ask, Skills, Routines** — same routes, same behavior,
  same object models. None were touched by the redesign beyond shared design-kit styling.
- **Account Detail** — the full flight-recorder room is intact (motion drafting, meeting notes,
  routing accept/decline).

### 3.2 Preserved but resurfaced differently
- **Today** was a page of cards; it is now an **executive command center** (exposure + ranked
  decision queue) and is scope-aware. The underlying `outcome_events`/motion/opportunity data is
  the same; the framing is new.
- **Pipeline** kept every field but gained the **Attention / Portfolio / All / Review** view
  switch, ecosystem pivots, and the contextual **intel drawer**. Nothing was removed — the count
  bentos, MEDDPICC, deal-reg, writebacks, renewal radar are all still reachable.
- **Joint pursuits** were a top-level room; now a **tab inside Partners** (`also: ["/joint"]`),
  and each joint room is bound to a canonical Pursuit (`joint_pursuits.pursuit_id`).
- **Account intelligence** (hunt / why-now / through-whom / what-next) is the same
  `getAccountIntel` model, now rendered both as the Accounts slide-in pane **and** flat inside the
  Pipeline intel drawer (`AccountIntelPane flat`).

### 3.3 Preserved underneath progressive disclosure
- Pipeline's analytical depth (momentum, condition, autopsy, stage-weight calibration) now sits
  **behind the Attention default and the drawer** rather than all-at-once — simple by default,
  complete on demand. The compression tightened the header; it removed no information.
- The **approved future pattern** (see §8) extends this to a "compact portfolio intelligence
  summary → optional Pipeline intelligence progressive disclosure."

### 3.4 Still present but currently absent from the hero demo
- **Pursuits / Pursuit Detail / federation panel** — the canonical decision surfaces exist and
  are the richest read surfaces in the app, but they are **flag-gated OFF** and so do not appear
  in the default (unflagged) demo. The demo journey runs largely on the legacy always-on rooms.
- **The E3-F canonical outcome/attribution/experiment layer** — present and harness-proven, but
  demo-fed and gated, so it is not part of the hero narrative except as the (now enriched)
  synthetic MEDDPICC qualification signal.
- **Ops** — the governance observability room exists but is off the rail (typed-URL only), so it
  is not part of any walked journey.

### 3.5 Superseded (Category F — coexists, not deleted)
- **Account** as the implicit organizing object → **Pursuit** as the canonical object (both
  routes live).
- **Single `propensity_scores` number** (+ `score_features`/`score_versions`) → **multi-
  dimensional `pursuit_score_snapshots`** (both coexist: Accounts uses the former, pursuit
  read-models the latter).
- **`settlement.ts` binary attribution** → **versioned `attribution` object**
  (SOURCE/INFLUENCED/ASSISTED/OBSERVED/UNKNOWN + model_version).
- **Legacy 6-value disclosure classes** → **two independent Audience × Sensitivity dimensions**
  (a legacy 6→audience map is retained in `disclosure.ts`).
- **Ungoverned inline MCP write `run()` / autonomous LLM write tools** → **`dispatchSkill`
  chokepoint** (inline `run()` now throws; Ask filters all write tools).
- **Inline outreach send (`sendTouchNow` direct)** → **governed outbox → executor → receipt**
  (`sequence.ts` now enqueues).
- **App connecting as table owner** → **`app_rw` non-owner role + RLS + FORCE RLS** (cutover
  pending).
- All of the above are intentional supersessions with the old path still running; the reparent
  FKs (`0067`) are the unbuilt bridge.

### 3.6 Accidentally lost or apparently orphaned — flagged, not repaired
1. **`/pursuits/[id]/route` — dead deep-link.** `read-models/today.ts:50` builds a ROUTE_APPROVAL
   CTA to `/pursuits/${id}/route`; only `[id]/page.tsx` exists → the "Approve →" action **404s**.
   (Latent today because Pursuits are flag-off, but it will surface the moment a tenant is
   enabled.)
2. **`/ops` — navigation orphan.** A functional owner room with **no rail entry** anywhere in
   `shell.tsx` (not in the Platform group, not in `ADMIN_ITEMS`). Reachable only by typing the
   URL.
3. **Dangling link tables.** `pursuit_interactions` and `pursuit_relationships` (`0066`) carry
   `ref_id` FKs to base tables **that were never created** — scaffolds pointing at nothing.
4. **`ops.ts` `trace` helper** exists but is never rendered by the Ops page — built capability
   with no surface.
5. **`request_team_acceptance` / `send_partner_intro` governed-skill handlers are stubs**
   (`{requested:true}`) — registered but inert.

*(None of these is repaired here per the halt instruction; §6 consolidates them.)*

---

## 4. Navigation assessment — one OS, or a rail of mini-apps?

Current rail (from `src/components/shell.tsx`):

| Group | Items |
|---|---|
| *(top)* | Today |
| **Ecosystem** | Intake · Mapping · Contacts · Partners *(also: Joint)* |
| **Outreach** | Campaigns · Upcoming · Analytics |
| **Intelligence** | Pursuits *(flag-gated)* · Accounts · Sources · Provider health · Review · Trust |
| **Execution** | Motions *(also: Briefs)* · Queue |
| **Revenue** | Goals · Pipeline · Insights |
| **Platform** | Ask · Skills *(+ Routines · Admin for owners)* |
| *(unlisted)* | **Ops** — no rail entry |

**Classification of entries:**

- **First-class rooms (a distinct job, a real destination):** Today, Pipeline, Motions, Partners,
  Mapping, Campaigns, Pursuits (when enabled), Accounts, Admin, Ask.
- **Supporting rooms (serve a first-class job, arguably a tab or drawer of one):** Briefs (of
  Motions — already `also`), Upcoming (of Campaigns), Queue (the execution worklist), Contacts
  (of the ecosystem), Insights & Analytics (two learning dashboards that overlap), Provider health
  (of Sources — already a historical room-pair), Goals.
- **Plumbing surfaced as rooms:** Sources, Provider health, Trust, Ops — instrumentation/
  procurement views that are read-only windows onto substrate.
- **Duplicated / overlapping:** **Insights vs Analytics** (machine calibration vs program
  performance — genuinely two things, but the rail doesn't say which is which); **Accounts vs
  Pursuits** (the same "which target" question on two object models); **Sources + Provider health
  + Review** (three angles on evidence trust).
- **Weakly justified as standalone:** Trust (largely procurement prose), Upcoming (a Campaigns
  view), Goals (could live beside Insights under Revenue as it does).
- **Contextual-drawer candidates (don't deserve a rail slot):** Account intelligence (already a
  drawer in Pipeline), the disclosure theater, Ops' status roll-ups (belong beside the thing that
  produced them), Provider health (beside Sources).

**The core tension.** The rail reads today as **a collection of mini-applications** — Intake,
Mapping, Contacts, Campaigns, Upcoming, Motions, Queue, Goals, Pipeline, Insights, Analytics,
Accounts each open a full-page app with its own filters and object model. The redesign has begun
converting this into **one operating system** — Today as the command center, Pipeline's
progressive disclosure, the intel drawer, ⌘K spanning rooms — but only Today, Pipeline, and ⌘K
actually behave that way. The gap between "one OS" and "rail of apps" is exactly the set of rooms
that are **not scope-aware and not reachable contextually**: Accounts, Queue, Contacts, Analytics,
Insights, Goals. **No nav change is proposed here** (per the halt); this is the map the next
navigation decision should be made against.

---

## 5. Future UX-placement recommendations (design assessment only — nothing built)

For every under-exposed (**B**), partial (**C**), and designed-only (**E**) capability: how it
*could* be surfaced, favoring the contextual drawer / progressive disclosure / existing surfaces
over a new room. **These are options for a future decision, not commitments.**

| Capability (class) | Primary persona | Default-visible | On-demand | A "wow" moment? | Placement (prefer existing) |
|---|---|---|---|---|---|
| **Pursuit Detail decision-write** (E) | Sponsor exec | The route recommendation + why | The candidate compare + governed **Approve/Override** control | **Yes** — the first human governed action with a live receipt in Ops is the platform's signature moment | Add controls to the *existing* Pursuit Detail route panel; wire the Today "Approve →" CTA to it (also fixes the orphan). No new room. |
| **Governed-action outbox / Ops** (B) | Owner / RevOps | "N actions in flight, 0 stuck" one-liner | The `trace` timeline (already in lib) + dead-letter with retry | Watching a real send flow decision→dispatch→outbox→receipt live | Fold Ops' roll-up into **Admin's AI-operations panel**; keep Ops as the deep view; render the existing `trace`. |
| **Federation disclosure / grants** (B) | Both sides of a co-sell | The "what they can see" projection (already in Pursuit Detail) | Grant propose/accept flow | The sponsor⇄participant toggle showing the *same* fact generalized vs suppressed | Keep in Pursuit Detail; surface grant accept in the **Partners** room (where consent already lives). |
| **E3-F canonical outcome/attribution** (B/E) | RevOps / exec | "Did we converge to human judgment?" headline | Override-convergence + experiment cohorts | The moment the machine's recommendation and the human's override agree over time | Extend the **Insights** dashboard with a canonical-outcome section once a live producer exists; do not build a new room. |
| **Recompute engine** (B) | (invisible) | Nothing — it should be felt, not seen | Ops health only | A score visibly moving the instant a material fact lands | No dedicated surface; its "wow" is *latency*, expressed through Today/Pipeline freshness. |
| **Ecosystem scope on more rooms** (A, uneven) | Every persona | The scope chip already in the rail | — | — | Extend `getScopeContext` to **Accounts and Queue** (highest-value gaps) before any new room. |
| **CRM write-back push** (C) | RevOps | "N corrections approved" | Push-now / schedule | — | Keep the `/api/writebacks` queue; add a live adapter behind the *existing* approval gate. |
| **Salesforce / Gmail / Calendar capture** (E) | Seller | Interaction timeline on Account/Pursuit | — | Auto-captured meetings appearing as first-party evidence | Feeds the *existing* Account Detail timeline and facts; build the base `interactions` table first (the link table already awaits it). |
| **Observability provider** (E) | Owner | Worker/queue health (already on Admin) | Error feed | — | Wire a provider into the existing `Reporter` seam; surface on Admin. No new room. |
| **MCP surface** (B) | Partner bots / RevOps | Key state (already on Admin) | Tool catalog + governed-write log | — | Document the tool surface in Admin; no new room. |
| **Ask** (A, could deepen) | Every persona | The answer box (present) | Per-answer evidence/tool-call drill-down; threading | The moment an answer cites the exact governed read that grounded it | Enhance in place. |

**Cross-cutting recommendation:** almost every gap above is closed by **wiring into an existing
surface** (Pursuit Detail, Admin, Insights, Partners, Accounts, the intel drawer), not by adding
rail entries. The only genuinely new *interaction* the platform is missing is the **human
governed-action control** — and its natural home is the Pursuit Detail panel that already renders
its read side.

---

## 6. Consolidated report — discrepancies, regressions, orphans, conflicts

### 6.1 Regressions introduced by recent work
- **None found.** The MEDDPICC enrichment (`scripts/demo-meddpicc.ts`, commit `37e12c8`) and the
  scale-native + polish work all landed with green regression suites on the production build; the
  13 unit suites are unaffected (they test legacy primitives). The enrichment is idempotent,
  synthetic-labeled, preserves UNKNOWNs, and reconciles (won avg 63 / lost avg 44 / open avg 55 —
  a noisy, overlapping gap, not a clean separator).

### 6.2 Orphaned / dead functionality (flagged, not repaired)
1. **`/pursuits/[id]/route` 404** from Today's ROUTE_APPROVAL CTA (`today.ts:50`). Latent while
   Pursuits are flag-off; live-facing the moment a tenant is enabled. *Highest-priority fix when
   work resumes.*
2. **`/ops` has no navigation entry** — functional owner room reachable only by typed URL.
3. **Dangling link tables** `pursuit_interactions` / `pursuit_relationships` point at base tables
   that were never built (Workstream G).
4. **`ops.ts` `trace` helper** built but never rendered.
5. **Two stub governed-skill handlers** (`request_team_acceptance`, `send_partner_intro`)
   registered but inert.

### 6.3 Capabilities unintentionally narrowed
- **Scope-awareness** was expected (per the redesign intuition) to reach Accounts and Queue; it
  reaches **neither**. Both are hero-ish worklists that silently ignore the ecosystem lens.
- **Disclosure** engine reaches only Pursuit Detail; the redesign did not extend it.
- **Governed actions** remain agent-only; no human surface gained one.

### 6.4 Conflicting / stale roadmap artifacts
1. **RLS prod status contradiction.** `RISK-1-CUTOVER-STATE.md` says "CUT OVER & VERIFIED ON PROD";
   `enterprise-risk-ledger.md` + `RISK-1-rls-enforcement-TDD.md` say "cutover gated." The ledger/
   TDD are the earlier snapshot. **Code + `PRODUCTION-COMMISSIONING-REPORT.md` support the gated
   reading** (task #67 still pending; app connects as owner). Treat "verified on prod" as
   aspirational.
2. **FORCE RLS drift.** Cutover-state lists FORCE RLS as a *remaining optional* step, but
   `0090_force_rls` (R1-G3) already applies it to 150 tables. Cutover-state is stale.
3. **Which migrations are on prod.** Cutover-state: prod hand-applied `0058–0062`. The entire
   transformation (`0063–0093`) is on `pursuit_demo` **only**. The transformation reports' "done"
   = demo-tenant-done; production is un-migrated.
4. **Duplicate security-audit files.** `SECURITY-AUDIT-2026-08-27.md` (uppercase, truncated
   single-finding stub) vs `security-audit-2026-08-27.md` (lowercase, full 5-finding report) —
   same sweep, different completeness.
5. **Resolved in-code doc bug (historical).** R1-G1 corrected a prior false comment claiming only
   one write tool existed in the Ask set — noted so it isn't re-flagged.

### 6.5 The single most important discrepancy
**The read/decision surface of the canonical Pursuit product is built and demo-verified; its
write/lifecycle/learning half is library-and-harness-complete but unwired to any live producer.**
- No `src/app` action or `src/worker` path **creates or advances a Pursuit** — they materialize
  only via the `pursuits:backfill` script + demo seeding.
- No live path **enqueues a recompute** (the worker drains an always-empty queue in production).
- No live path **records a canonical outcome/attribution/experiment** — only demo/verify scripts
  do.
- The governed-action write path exists end-to-end but has **no human invoker**.

The platform today is, precisely: **a mature legacy CRM/co-sell application (always-on, feeding
the live `outcome_events` learning loop) with a fully-built, demo-verified, flag-gated canonical
Pursuit *reading* layer sitting beside it — and the canonical *writing* layer complete in library
and harness but not yet wired to a live producer or a human control.**

---

## 7. Namespace & conceptual hazards to carry forward

- **Two unrelated "skills":** `src/lib/skills/skills.ts` (prompt-grounding library, Class A UX)
  vs `src/lib/pursuits/federation/skills.ts` `dispatchSkill` (governed mutation authority, Class
  B, headless). Never merge them in planning or UI copy.
- **Two unrelated "outcome" systems:** live `outcome_events` (Insights/Analytics) vs canonical
  `pursuit_outcomes`/attribution/experiment (demo-fed). Never conflate their numbers.
- **Two "pursuit" meanings:** the canonical `pursuits` object vs the legacy joint co-sell room
  (`joint_pursuits`). E3-A binds them via `joint_pursuits.pursuit_id`; the words still overlap.
- **"Disclosure" appears in pipeline helpers** (`opportunities/*`) that are formatting, unrelated
  to the federation disclosure engine.

---

## 8. Approved future pattern (recorded, not implemented)

Per the standing instruction to keep the current Pipeline default layout for now, the following is
recorded as an **approved future UX pattern** and is **not implemented in this pass**:

> **Compact portfolio intelligence summary → optional Pipeline intelligence progressive
> disclosure.** The Pipeline header's analytical intelligence (qualification/MEDDPICC health, AI
> learned signal, calibration) collapses to a compact one-line portfolio summary by default, with
> the full intelligence panel available on demand — extending the "simple by default, complete on
> demand" doctrine already applied to the Attention/Portfolio/All views and the intel drawer.

The current layout (tightened header, full intelligence visible) stands until that redesign is
explicitly commissioned.

---

## 9. Design & product doctrine preserved (invariant across all future work)

1. **Materiality before chronology** — surface what matters, not merely what is latest.
2. **Business question before database object** — a room answers a question, not a table.
3. **Progressive disclosure** — simple by default, complete on demand; nothing removed.
4. **One canonical commercial truth** — figures reconcile across every surface.
5. **UNKNOWN remains legitimate** — never fabricated into false certainty.
6. **Recommendation ≠ decision** — the machine recommends; the human decides; overrides are
   preserved, not overwritten.
7. **Server-side disclosure** — projection happens on the server; nothing confidential is
   serialized to a client that shouldn't see it.
8. **Ecosystem-native behavior** — partner/vendor/territory/seller are first-class axes.
9. **Scope narrows, never widens** — the ecosystem lens can only restrict the already-authorized
   set; the server re-authorizes every request.
10. **Human attention is scarce** — the UI spends it deliberately.
11. **Evidence adjacent to intelligence** — a claim shows its source and confidence.
12. **Calm UI, dense intelligence** — restraint on the surface, depth underneath.
13. **Demo data is honest** — synthetic provenance is explicit; small samples stay small;
    outcome-learning never claims perfect accuracy.
14. **No new primitives without cause** — no new domain object, scoring concept, data model,
    governed-action semantic, disclosure rule, federation semantic, or demo-only business object
    is introduced except by explicit design.

**No new domain primitive, scoring concept, data model, governed-action semantic, disclosure
rule, federation semantic, or demo-only business object was introduced by this audit** — it is
analysis only.

---

## 10. Deliverables checklist for this chapter

- [x] **Final demo-quality refinement** — synthetic MEDDPICC/outcome enrichment
  (`scripts/demo-meddpicc.ts`, wired into `demo-stories.ts` Layer 10), committed `37e12c8`;
  existing structures only, no new primitive, DEMO provenance explicit, UNKNOWNs preserved,
  reconciles with Pipeline/Insights, honest small sample, regressions green.
- [x] **Current Pipeline layout kept**; collapse redesign **not** implemented.
- [x] **Approved future pattern recorded** (§8).
- [x] **Repository + documentation audit** across routes, domain/read models, actions, API
  routes, worker, AI/agent infra, Skills/Ask/Routines, every room, migrations, tests, audit docs,
  roadmap docs.
- [x] **Capability inventory** with A–F classification and 12-field evidence (§2), no credit for
  mere file/label existence.
- [x] **Preserved-functionality accounting** in six buckets (§3), orphans flagged not repaired.
- [x] **Navigation assessment** against real capabilities (§4).
- [x] **Future UX-placement recommendations** for every B/C/E capability (§5), design-only.
- [x] **Report** of discrepancies, regressions, orphaned functionality, conflicting roadmap
  artifacts, and capabilities unintentionally narrowed (§6).
- [x] **Doctrine preserved** (§9).

**HALT.** No capability expansion is implemented. The next phase should begin from this baseline,
with the deferred-feature list, once provided.
