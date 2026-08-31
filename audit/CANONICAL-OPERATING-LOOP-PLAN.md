# PursuitOS — Canonical Operating Loop Plan

**Objective.** Make a Pursuit capable of moving through its canonical lifecycle
— *detect → review → decide route → form team → approve motion → governed action → receipt/outcome
→ recompute → learning* — using **only the primitives already built** (canonical Pursuit model,
`dispatchSkill` mutation authority, governed outbox/executor, disclosure/federation, change
ledger, recompute engine, outcome/attribution/experiment layer). **No second lifecycle. No
big-bang rewrite.** A strangler-style migration toward the canonical system where practical.

**Status.** Design only. **Nothing in this document is implemented.** It halts for approval. It
resolves nothing silently: where the repository proves a fact it says so; where a human decision
is required it is marked **[DECISION]**.

**Grounding.** Every claim below is anchored to a file:line verified during this design pass.
The single most important verified fact: **the canonical read/decision surfaces are built, but
the three canonical *producers* — governed send (`enqueueApprovedSend`), recompute enqueue
(`recordAndEnqueue`/`enqueueRecompute`), and outcome capture (`recordOutcome`/`recordAttribution`)
— have no caller anywhere in `src/app` or `src/worker`. They are exercised only by
`scripts/*-verify.ts` and demo seeders.** Closing the loop is overwhelmingly a *wiring* problem,
not a *building* problem.

**Date:** 2026-08-31 · **Branch:** `claude/activateos-platform-review-xzkgmd`

---

## 1. Current-state architecture (what runs today)

### 1.1 The canonical substrate — built, verified, unwired

| Primitive | Entry point (signature) | Writes | Live producer in `src/app`/`src/worker`? |
|---|---|---|---|
| Pursuit create/dedup | `upsertPursuit(db, input)` — `model.ts:55` | `pursuits`, `change_ledger` | **No** — only `reparent.ts:82` + scripts. |
| Lifecycle transition | `transitionPursuit(db, id, to, ctx)` — `lifecycle.ts:75` | `pursuits`, `change_ledger` | **No** — only `scripts/pursuit-verify.ts`. |
| Score snapshot | `writeScoreSnapshot(db, input)` — `scoring.ts:70` | `pursuit_score_snapshots*` | **No** — only `reparent.ts:122` + scripts. |
| Mutation authority | `dispatchSkill(db, skillId, actor, ctx)` — `skills.ts:110` | `governed_action_invocations`, `action_outbox` | **Yes** — `api/mcp/route.ts:80`, `comms/sequence.ts:177`, `comms/governed-send.ts:40`. |
| Route selection/override | `selectPartnerRoute(...)` — `routing/override.ts:17` | `pursuit_route_snapshots.selected_partner_id`, `pursuit_overrides`, `change_ledger` | **No app caller** — ungoverned lib fn; not a registered skill. |
| Change ledger | `recordChange(db, e)` — `ledger.ts:63` | `change_ledger` | Yes (via transition/override), but only from the unwired primitives. |
| Human override | `recordOverride(db, input)` — `overrides.ts:31` | `pursuit_overrides`, `change_ledger` | Only `routing/override.ts` (itself unwired to app). |
| Recompute enqueue | `recordAndEnqueue(db, event, opts)` — `events.ts:252` | `recompute_requests` | **No** — only `scripts/*-verify.ts`. |
| Recompute drain | `drainRecomputeQueue(db, opts)` — `events.ts:171` | snapshots via `recomputeRoute` | Yes — worker tick every 60s (drains an **empty** queue in prod). |
| Governed send enqueue | `enqueueApprovedSend(db, actor, touchId)` — `governed-send.ts:37` | `action_outbox` (via `dispatchSkill`) | **No** — grep of `src/app` = zero. |
| Outbox drain/execute | `drainOutbox(db, opts)` — `executor.ts:77` | `action_receipts`, `change_ledger` | Yes — worker `runOutreach`, gated (`§1.4`). |
| Outcome capture | `recordOutcome(db, i)` — `outcomes.ts:52` | `pursuit_outcomes` | **No** — only scripts/demo. |
| Attribution | `recordAttribution(db, i)` — `outcomes.ts:108` | `attribution` | **No** — only scripts/demo. |
| Experiment/cohort | `createExperiment`/`assignCohort` — `outcomes.ts:140`/`175` | `experiments`, `cohort_assignments` | **No** — only scripts/demo. |
| Convergence | `markOverrideConvergence(db, i)` — `outcomes.ts:200` | `pursuit_overrides` | **No** — only scripts. |

**Lifecycle states** (`lifecycle.ts:13-18`, 15 states, non-linear map at `:26-42`):
`DETECTED → RESEARCHING → REVIEW_REQUIRED → QUALIFIED → ROUTED → MOTION_DESIGNED →
READY_TO_ACTIVATE → ACTIVATING → ACTIVE → CUSTOMER_ENGAGED → OPPORTUNITY_CREATED → WON`;
plus `LOST`, `DISQUALIFIED` (terminal), and `DORMANT` (live/reactivatable, **not** terminal).

**`dispatchSkill` registry** (`skills.ts:50-77`, 7 skills):

| skillId | effectClass | handler | Loop role |
|---|---|---|---|
| `explain_route` | READ | stub `{explained:true}` | trivial; EXPLAIN uses read-models directly. |
| `accept_participation` | INTERNAL_WRITE | real → `acceptParticipation` | **form team** (participant side). |
| `request_team_acceptance` | CROSS_TENANT_ACTION | **stub** `{requested:true}` | **form team** (request side) — see §6.8. |
| `send_partner_intro` | EXTERNAL_ACTION | no handler (outbox-only) | governed external action — see §6.8. |
| `send_campaign_touch` | EXTERNAL_ACTION | real via executor | **governed action** (outreach send). |
| `draft_campaign_touch` | INTERNAL_WRITE | real → `draftTouchImpl` | agent draft (not a human decision). |
| `request_warm_intro` | CROSS_TENANT_ACTION | real (`authorize` + handler) | partner intro (already wired via MCP). |

**No `select_partner_route` / `override_partner_route` skill exists** — yet the Today
ROUTE_APPROVAL card advertises exactly those skill ids (`today.ts:49`). This is the loop's
central missing link (§4, Phase 1).

### 1.2 The legacy live loop — always-on, feeding `outcome_events`

Ten live writers of `outcome_events` (verified): opportunity advance/close
(`opportunities/lifecycle.ts:128` — `CLOSED_WON`/`CLOSED_LOST`/`OPPORTUNITY_ADVANCED`,
MEDDPICC snapshotted into payload), promote-to-opp (`:219` — `OPPORTUNITY_CREATED`), motion
lifecycle (`motions/lifecycle.ts:68`), motion approve/reject (`motions/approve.ts:64`/`85`),
cadence resolve (`motions/cadence.ts:86`), routing accept/decline
(`accounts/[id]/actions.ts:43` — `TEAM_ACCEPTED`/`TEAM_DECLINED`), and three agent creators
(`MOTION_CREATED`, `CAMPAIGN_CREATED`). Readers: **Insights** (`insights/page.tsx:39`),
**Analytics** (`analytics/page.tsx:65`), **Today** feed (`page.tsx:193`), **Account timeline**
(`accounts/[id]/page.tsx:188`).

This is the loop that *actually operates today* — human decisions happen in the legacy rooms and
land in `outcome_events`, and Insights learns from them.

### 1.3 The bridge that exists but is unused

Migration `0067_reparent_fks.sql` put nullable `pursuit_id` FKs on `opportunities`, `motions`,
`campaigns`, `pursuit_teams`. **These are the strangler seam** — every legacy decision already
has a place to name the canonical Pursuit it belongs to. Today they are null and unread.

### 1.4 Safety gates already in place (must be preserved)

- **External send is doubly dark:** `real = job.dataEnvironment === "PRODUCTION" && opts.allowRealProvider === true` (`executor.ts:111`); `allowRealProvider = OUTREACH_AUTOSEND === "on"` (`worker/index.ts:86`). DEMO/synthetic always hits `simulatedExecutor`. **No synthetic/demo object can trigger external execution** — this invariant is enforced and non-negotiable.
- **Cross-tenant actions require an ACTION grant** (never a DATA grant, R24) at the dispatch chokepoint (`skills.ts:139-146`); the executor re-checks `grantIsLiveById` immediately before execution (`executor.ts:104`).
- **Recommendation ≠ decision** is structural: `pursuits.recommended_*` vs `selected_*`/`approved_*` columns, plus the `pursuit_overrides` divergence trail carrying `original_recommendation` and `human_decision` as separate columns (`overrides.ts:33-43`).
- **Disclosure** suppresses existence (T11) for viewers with no standing (`disclosure.ts:84`); nothing confidential is serialized to a client without standing.
- **UNKNOWN stays UNKNOWN:** the recompute engine refuses to fabricate scores — only ROUTE is recomputed; SCORE/READINESS/WHY_NOW/TODAY are materiality-judged from event numerics, never invented (R40, `events.ts:217-218`).

---

## 2. Target lifecycle — the closed loop

The loop is a **single canonical lifecycle** driven by governed mutations. Below is the
state/transition map. Each transition names the thirteen required properties.

Legend for **Mutation authority**: `dispatchSkill(<skill>)` = governed; `transitionPursuit` =
lifecycle service (called *inside* a governed skill handler or a governed server action, never
raw from UI); `—` = no mutation (read only).

### 2.1 Transition map

| # | Transition | Initiating actor | Required evidence | Authorization | Tenant context | Disclosure boundary | Mutation authority | Audit event (`change_ledger`) | Governed action | Receipt | Outcome event | Recompute trigger | Learning consequence | Rollback / failure |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **detect** → `DETECTED` | WORKER / SYSTEM (research pipeline) | ≥1 promoted fact or signal; dedup key | none (internal) | sponsor org (`withTenant`) | ORG_PRIVATE | `upsertPursuit` inside a governed `INTERNAL_WRITE` skill or worker tx | `PURSUIT_CREATED` | — | — | — | `recordAndEnqueue(FACT_PROMOTED)` → SCORE/WHY_NOW/ROUTE/TODAY | seeds baseline; no learning yet | dedup `on conflict do nothing`; illegal input → no row |
| 2 | **review** → `REVIEW_REQUIRED` → `QUALIFIED` | USER (operator) reviews a flagged fact | `fact_reviews` row, `system_recommendation='REVIEW'` | operator (R9) | sponsor org | PURSUIT_INTERNAL | governed `review_fact` skill (INTERNAL_WRITE) → `transitionPursuit` | `FACT_ACCEPTED`/`FACT_SUPERSEDED` + `STATUS_CHANGED` | — | — | — | `recordAndEnqueue(FACT_ACCEPTED)` | human verdict banks a golden example; feeds source trust | reject → stays REVIEW_REQUIRED; UNKNOWN preserved |
| 3 | **decide route** → `ROUTED` | **USER (operator) — the signature human decision** | route snapshot `route_status='RECOMMENDED'`, ≥1 candidate | operator (R9) | sponsor org | route reasons disclosure-filtered (`reasonsInternal` withheld unless `canSeeInternal`) | `dispatchSkill('select_partner_route')` **or** `dispatchSkill('override_partner_route')` (INTERNAL_WRITE) wrapping existing `selectPartnerRoute` | `PARTNER_SELECTED` (approve) or `PARTNER_OVERRIDE` + `OVERRIDE_RECORDED` (override) | — | — | — | `recordAndEnqueue(ROUTE_SELECTED\|PARTNER_SELECTED)` → READINESS/TODAY | override captured in `pursuit_overrides` for later convergence (R17) | illegal transition → `IllegalPursuitTransition`, no write; recommendation preserved either way |
| 4 | **form team** → (participants ACTIVE) | USER (sponsor) requests; partner USER accepts | route decided; named overlap for cross-org | operator; **cross-org needs live ACTION grant (R24)** | sponsor org requests; participant org accepts (each `withTenantOrg`) | PARTICIPANT_SHARED; participant sees disclosure-filtered projection | `dispatchSkill('request_team_acceptance')` (CROSS_TENANT_ACTION) then `dispatchSkill('accept_participation')` (INTERNAL_WRITE) | `TEAM_MEMBER_ASSIGNED` / `PARTICIPANT_JOINED` / `TEAM_MEMBER_ACCEPTED` | — | — | — | `recordAndEnqueue(PARTICIPANT_JOINED\|TEAM_MEMBER_ACCEPTED)` → ROUTE/READINESS/TODAY | participation recorded as explicit consented edge | grant absent/expired → REJECTED invocation (audited); no participation |
| 5 | **approve motion** → `MOTION_DESIGNED` → `READY_TO_ACTIVATE` | USER (operator) approves a designed motion | motion drafted + cited evidence | operator (R9) | sponsor org | PURSUIT_INTERNAL | governed `approve_motion` skill (INTERNAL_WRITE) → `transitionPursuit` + legacy `approveMotion` bridge | `MOTION_APPROVED` (canonical) alongside legacy `outcome_events` write | — | — | — | `recordAndEnqueue(...)` → READINESS/TODAY | approval is a decision-time context anchor for later outcome | reject → MOTION_DESIGNED stays; legacy path unaffected |
| 6 | **governed action** → `ACTIVATING` | USER (operator) approves a send / intro | approved motion or intro request; recipient consent | operator; **external = ACTION grant + gates §1.4** | sponsor org (send) / cross-org (intro) | ORG_ALLOWLIST / PARTICIPANT_SHARED | `dispatchSkill('send_campaign_touch' \| 'send_partner_intro')` (EXTERNAL_ACTION → **`action_outbox`, never inline**) | `ACTION_INVOKED` (enqueue) | — | — | — | none at enqueue | — | enqueue idempotent (`org+idempotency_key`); demo → simulated, never sent |
| 7 | **receipt** → `ACTIVE` / `CUSTOMER_ENGAGED` | WORKER (executor drain) | outbox row PENDING, gate satisfied | worker; grant re-checked before execute | sponsor org | — | `drainOutbox` → provider → `writeReceipt` | `ACTION_EXECUTED` (`actorType:WORKER`) | **`action_receipts`** (accepted/failed/compensated) | — | `recordAndEnqueue(REPLY_RECEIVED\|MEETING_BOOKED)` when engagement returns | receipt ≠ outcome (kept separate) | retryable → backoff; permanent/exhausted → `FAILED_FINAL` dead-letter; revoked grant → `COMPENSATED` |
| 8 | **outcome** → `OPPORTUNITY_CREATED` / `WON` / `LOST` / `NO_DECISION` / `DORMANT` | USER (operator) or bridged legacy close | terminal signal (opp close, no-decision, dormancy) | operator (R9) | sponsor org | AGGREGATED across participants | governed `record_pursuit_outcome` skill (INTERNAL_WRITE) → `recordOutcome` **with decision-time context (R14)** | `OUTCOME_RECORDED` + `STATUS_CHANGED` | — | **`pursuit_outcomes`** (+ `attribution` claim, versioned) | terminal outcome → recompute suppressed (terminal) | `recordAttribution` (SOURCE/INFLUENCED/…); `markOverrideConvergence` if selection==outcome direction | mis-record → append corrective outcome (append-only); never mutate prior |
| 9 | **recompute** (reactive, continuous) | SYSTEM (worker tick) | any `recompute_requests` PENDING | worker | per-request org + as-of | — | `drainRecomputeQueue` → `recomputeRoute` (ROUTE only wired) | `ROUTE_RECOMMENDATION_CHANGED` when material | — | — | — (this *is* the recompute) | immaterial delta → `SUPPRESSED` (R22); as-of honored (R12) | poison cap → `FAILED`; lease recovery (5 min) |
| 10 | **learning** (dashboard) | USER reads | `pursuit_outcomes` + `attribution` + `pursuit_overrides` | viewer | sponsor org | AGGREGATED | — (read) | — | — | — | — | override-convergence + calibration surfaced in Insights (canonical section) | n/a |

### 2.2 Invariants the map enforces (restated as acceptance criteria)

1. **One lifecycle.** Every state above is a `PURSUIT_STATUSES` value; no parallel status column is introduced. The legacy opportunity/motion stages remain, but they *feed* canonical transitions via the bridge (§3), they do not define a second lifecycle.
2. **Recommendation ≠ decision.** Steps 3/5/8 write the human decision to `selected_*`/`approved_*`/`pursuit_overrides`, never overwriting `recommended_*`. A UI approve and a UI override are two different governed skills with two different ledger events.
3. **UNKNOWN stays UNKNOWN.** No transition fabricates a score or a fact. Timing/criteria that are UNKNOWN remain UNKNOWN through the whole loop (the demo MEDDPICC enrichment already models this).
4. **Cross-org is explicit + consented.** Steps 4/6 cross a tenant boundary only through a live ACTION grant, re-checked before execution.
5. **No synthetic external execution.** Step 6/7 external side effects are gated by `dataEnvironment==='PRODUCTION' && OUTREACH_AUTOSEND==='on'`; the demo tenant is DEMO and always simulates.
6. **Governed-only mutation.** Every state change in the loop flows through `dispatchSkill` (or a governed server action that calls a lifecycle primitive inside `withTenant`), producing a `governed_action_invocations` audit row — including rejections.

---

## 3. Legacy ↔ canonical boundary (strangler map)

The rule: **the canonical system grows by wrapping legacy decision points, not by replacing them
in a big bang.** Each legacy `outcome_events` writer that represents a *human commercial decision*
gains a canonical emission alongside it, keyed by the reparent `pursuit_id`. The legacy loop keeps
running untouched.

| # | Responsibility | Legacy owns (today) | Canonical owns (target) | Treatment this phase |
|---|---|---|---|---|
| 1 | Detect a commercial opportunity | research → `propensity_scores`/`opportunities` | `upsertPursuit` → `pursuits` | **Bridge:** seed/keep pursuits from the same signals; legacy scoring stays live. |
| 2 | Route decision | `accounts/[id]/actions.ts setTeamStatus` → `TEAM_ACCEPTED/DECLINED` | governed `select/override_partner_route` → `pursuit_route_snapshots` + `pursuit_overrides` | **Replace at the canonical surface** (Pursuit Detail/Today); legacy account-room accept/decline stays until parity. |
| 3 | Motion approval | `motions/approve.ts` → `MOTION_APPROVED` | governed `approve_motion` → `transitionPursuit` | **Dual-write:** legacy write stays; add canonical emission keyed by `motions.pursuit_id`. |
| 4 | Outreach send | `comms/*` → legacy send; `send_campaign_touch` governed path exists but unused by app | governed outbox → executor → receipt | **Do NOT migrate the live send path this phase.** Keep legacy sending; wire the governed path only in demo/simulate. |
| 5 | Opportunity close (won/lost) | `opportunities/lifecycle.ts` → `CLOSED_WON/LOST` (+ MEDDPICC) | governed `record_pursuit_outcome` → `pursuit_outcomes`/`attribution` | **Bridge:** on legacy close, also record a canonical outcome keyed by `opportunities.pursuit_id`. |
| 6 | Learning / calibration | Insights/Analytics over `outcome_events` | Insights canonical section over `pursuit_outcomes`/`attribution` | **Additive:** add a canonical panel; keep the legacy funnel. |
| 7 | Cadence / queue work | `motion_actions`/`communication_actions` | (unchanged) | **Not migrated** — stays legacy; only made scope-aware (P0 #3). |
| 8 | Campaigns / Intake / Contacts / Mapping | legacy tables | (unchanged) | **Not migrated this phase** — explicitly out of scope. |

**Which legacy producers can temporarily feed canonical events:** #3 (motion approve), #5 (opp
close), and routing accept/decline (#2) — each already fires at a human decision and already has
(or can trivially set) a `pursuit_id`. These become the temporary producers of canonical
`recordAndEnqueue`/`recordOutcome` calls.

**Which should eventually be replaced:** the route decision (#2) and, later, motion approval (#3)
should migrate their *primary* surface to the canonical Pursuit decision room, leaving the legacy
account/motion rooms as compatibility surfaces.

**What must NOT be migrated during this phase:** the live outreach **send** path (#4), the CRM
opportunity object wholesale, Campaigns/Intake/Contacts/Mapping (#8), and the `outcome_events`
readers (Insights/Analytics keep working as-is). No legacy table is dropped or refactored.

---

## 4. Exact gaps (what stands between current and target)

| Gap | Evidence | Closes at |
|---|---|---|
| **G1** No governed route-decision skill; Today CTA names non-existent skills + 404s | `today.ts:49-50`; registry `skills.ts:50-77` has no `select/override_partner_route`; `src/app/pursuits/[id]/route/` absent | Phase 1 |
| **G2** No human control on the Pursuit route panel | `pursuits/[id]/page.tsx:139-143` renders read-only `RouteCandidateTable`; no server action imported | Phase 1 |
| **G3** No live producer of recompute requests | `recordAndEnqueue` callers = scripts only (`events.ts:252`) | Phase 2 |
| **G4** No live producer of canonical outcomes/attribution | `recordOutcome`/`recordAttribution` callers = scripts/demo only (`outcomes.ts:52/108`) | Phase 3 |
| **G5** Team-formation request handler is a stub | `request_team_acceptance` → `{requested:true}` (`skills.ts:59`) | Phase 4 |
| **G6** Motion approval not governed / not canonical | `motions/approve.ts:64` writes `outcome_events` only | Phase 4 |
| **G7** Accounts not scope-aware | `accounts/page.tsx` no `getScopeContext`; unfiltered query `:98-118` | P0 |
| **G8** Queue not scope-aware | `queue/page.tsx` no `getScopeContext`; both queries unfiltered `:47-84` | P0 |
| **G9** `0066` link tables target non-existent base tables; nothing writes them | `0066` `ref_id` bare uuid; `interactions`/`relationships` tables absent; `linkContext` uncalled | P0 (decision) |
| **G10** Append-only is convention, not enforced | `0065:40`/`0068:28` grant update/delete to `app_rw`; no trigger/rule | Phase 2 (safety) |

---

## 5. P0 correctness fixes (independently shippable, no loop-behavior change)

Each is a separate verifiable unit. Ordered by independence.

### P0-1 — Repair the `/pursuits/[id]/route` dead CTA
- **Repository proves:** the CTA deep-links to a non-existent segment **and** advertises
  unregistered skills (`select_partner_route`/`override_partner_route`).
- **Recommendation:** do **not** create a throwaway `route/page.tsx`. Repoint the Today deep-link
  to the existing `/pursuits/${id}` detail page (`today.ts:50`), and land the actual decision
  control there (Phase 1). Until Phase 1 ships, the CTA should link to the detail route panel
  (valid page) rather than 404. **[DECISION]** confirm the deep-link target is `/pursuits/${id}`
  (recommended) vs a dedicated `/pursuits/${id}/route` sub-room. *Note: this fix is latent-only
  today because Pursuits are flag-off; it becomes user-facing the moment a tenant is enabled.*

### P0-2 — Make Accounts ecosystem-scope-aware
- **Unblocked** — `propensity_scores.company_id` exists. Add `getScopeContext(scopeParamFrom(...))`,
  add predicate `and ($2::boolean is false or p.company_id = any($1))` to the inner select
  (`accounts/page.tsx:98-118`), thread `scope` through `buildQS`/CSV export links. Mirrors the
  Today/Pipeline idiom exactly. No schema change.

### P0-3 — Make Queue ecosystem-scope-aware
- **Unblocked** — both sources already join `companies` and select `company_id`
  (`queue/page.tsx:51`, `:65-66`). Add `getScopeContext`, add
  `and ($1::boolean is false or m.company_id = any($2))` /
  `... t.company_id ...` to the two loader queries, thread `scope` through filter links. Actions
  (`resolveActionAction`/`resolveCommActionAction`) need **no** change (RLS + id-scoped). No
  schema change.

### P0-4 — Reconcile RLS / FORCE-RLS / production-cutover documentation
- **Repository proves:** DB role is chosen purely from env (`DATABASE_URL` / `DATABASE_URL_OWNER`;
  `getOwnerPool` falls back to `getPool` when no owner URL — `db/client.ts:151`); the code is
  **inert until the env flip** (`tenant.ts:15-19`); task #67 is backlog/non-blocking. The repo
  **cannot** prove which role prod runs as, whether FORCE RLS ran on prod, or whether the tracker
  was reconciled.
- **Contradiction:** `RISK-1-CUTOVER-STATE.md` ("cut over & verified on prod", "flip is done") is
  the lone outlier against `RISK-1-rls-enforcement-TDD.md`, `enterprise-risk-ledger.md`,
  `PILOT-OPERATIONAL-READINESS.md` ("HALTED FOR GO/NO-GO"), and `PRODUCTION-COMMISSIONING-REPORT.md`
  ("BLOCKED — LIVE EXECUTION REQUIRED").
- **Treatment (design):** write a single **status-of-record** note at the top of
  `RISK-1-CUTOVER-STATE.md` marking it a *session log of an attempted cutover*, not a verified
  production state, and pointing to the readiness reports as authoritative until an operator
  re-verifies against the live env. Do **not** edit the readiness reports. **[DECISION — human/
  operator]** the actual prod `DATABASE_URL` role, whether FORCE RLS is applied on prod, and
  whether the migration tracker is reconciled are environment facts only the operator can confirm;
  the repository cannot. This is a documentation reconciliation, not a code change.

### P0-5 — Correct treatment of the unbuilt `0066` link tables
- **Repository proves:** `pursuit_interactions`/`pursuit_relationships` exist (RLS-enabled),
  `ref_id` is a bare `uuid` with **no FK**, the intended base tables `interactions`/`relationships`
  **do not exist**, and `linkContext` (their only writer) is **never called**. The `0066` header
  says the base tables "land in Workstreams B/G" — Workstream G was never executed.
- **Recommendation:** **leave the tables in place, unchanged** (they are shape-correct scaffolds;
  dropping them is a migration risk for zero benefit and they harm nothing while empty). Add a
  short note to the baseline that they are **inert scaffolds pending Workstream G** and are *not*
  part of this loop. Do **not** build the base tables this phase (interaction/relationship capture
  is deferred-feature territory). **[DECISION]** confirm "leave inert" vs "drop until needed" —
  recommend leave inert (reversible, low-risk).

### P0-6 — Reconcile duplicate security-audit artifacts
- **Repository proves:** `audit/security-audit-2026-08-27.md` (lowercase) is the complete 110-line
  report; `audit/SECURITY-AUDIT-2026-08-27.md` (uppercase) is a 15-line fragment truncated
  mid-sentence with no unique content.
- **Recommendation:** delete the uppercase stub; the lowercase file is canonical. (Pure cleanup,
  no code impact.) **[DECISION]** confirm deletion vs keeping the stub as a redirect.

### P0-7 — `/ops` reachability
- **Repository proves:** `/ops` is owner-gated (`ops/page.tsx:15`), has **no** nav entry
  (`shell.tsx` — zero `href` to `/ops`), and is reachable only by typed URL.
- **Recommendation:** surface it as an **owner-only item in the Platform group** beside Admin
  (matching how `ADMIN_ITEMS` are appended, `shell.tsx:327`), because once the loop produces live
  `governed_action_invocations`/`recompute_requests`/`action_outbox` rows, Ops becomes the human
  window onto loop health — a runbook-only console is the wrong default for an operating system.
  **[DECISION]** owner-nav item (recommended) vs intentionally-hidden operator console.

### P0-8 — Classify the two governed-skill stubs
- `request_team_acceptance` (CROSS_TENANT_ACTION, stub `{requested:true}`): **required-for-loop**
  (step 4, form team). Promote to a real handler in **Phase 4**.
- `send_partner_intro` (EXTERNAL_ACTION, no inline handler — outbox-only by design): **deferred,
  not obsolete.** Its "stub-ness" is the intended EXTERNAL_ACTION shape (executes via the outbox
  provider, like `send_campaign_touch`). It becomes live only when a partner-intro provider is
  registered and the send gates are opened — **out of scope this phase** (§3 rule #4). Keep
  registered.
- *(Also noted: `explain_route` READ stub is trivial — EXPLAIN already runs off read-models via
  the palette; leave as-is.)*

---

## 6. Proposed code changes (per phase)

> Design intent only. Signatures shown are the shape the implementation would take; no code is
> written yet.

### Phase 1 — Governed route decision (the first closed micro-loop) · **highest value**
1. **Register two skills** in `SKILL_REGISTRY` (`skills.ts`), both `INTERNAL_WRITE`, `operator`,
   eligible `["USER"]`:
   - `select_partner_route` → handler wraps existing `selectPartnerRoute(db, {pursuitId, selectedPartnerId===recommended})`.
   - `override_partner_route` → handler wraps `selectPartnerRoute(...)` with a required `reason` + `category` (routes through `recordOverride`).
   The route-write logic already exists in `routing/override.ts:17`; the skills are thin governed wrappers so every route decision becomes an audited `governed_action_invocations` row.
2. **Add a decision control** to the Pursuit Detail route panel (`pursuits/[id]/page.tsx:139-143`):
   an Approve button (select recommended) and an Override affordance (pick alternative + reason),
   posting to a **server action** `decideRouteAction(pursuitId, candidateKey, reason?)` that calls
   `withTenant((db, orgId) => dispatchSkill(db, 'select_partner_route'|'override_partner_route', {type:'USER', orgId, role}, {...}))`.
   Progressive disclosure: the control lives under the existing candidate table; the page stays a
   decision room, not a form.
3. **Repoint Today CTA** `today.ts:50` deep-link to `/pursuits/${pursuit_id}` (P0-1).
4. On successful decision, the skill handler calls `transitionPursuit(db, id, 'ROUTED', ctx)` and
   `recordAndEnqueue(db, {change_type:'PARTNER_SELECTED', ...})` (first live recompute producer).

### Phase 2 — Recompute producer wiring + append-only hardening
5. Wire `recordAndEnqueue` at the canonical write points created in Phase 1 (route decision) and
   at fact acceptance (step 2). The worker's `drainRecomputeQueue` (already running every tick)
   now drains a **non-empty** queue → `recomputeRoute` produces fresh route snapshots.
6. **Safety (G10):** add DB-level append-only enforcement for `change_ledger`, `pursuit_overrides`,
   `governed_action_invocations`, `pursuit_outcomes`, `attribution` — a `BEFORE UPDATE OR DELETE`
   trigger that raises, and/or `REVOKE UPDATE, DELETE ... FROM app_rw`. **[DECISION]** trigger vs
   grant-revoke (recommend REVOKE for the append-only tables where the app never updates; trigger
   where the app legitimately updates status, e.g. `governed_action_invocations` progresses
   PENDING→EXECUTED — there, restrict to status-forward updates only).

### Phase 3 — Outcome capture + learning (canonical)
7. **Bridge the legacy close** (`opportunities/lifecycle.ts:128`): when an opportunity carrying a
   non-null `pursuit_id` closes, additionally call a governed `record_pursuit_outcome` skill →
   `recordOutcome(db, {pursuitId, class, valueUsd, scoreSnapshotId, routeSnapshotId, overrideId, secondsSinceRecommended, ...})` with **decision-time context (R14)**, then `recordAttribution` (versioned claim) and `markOverrideConvergence` if the selected route matches the realized outcome direction. Legacy `outcome_events` write is unchanged (dual-write).
8. **Insights canonical panel:** add a section reading `pursuit_outcomes`/`attribution`/
   `pursuit_overrides` (override-convergence, calibration) beside the existing legacy funnel.
   Honest small-sample messaging (the demo data already models the noisy won/lost overlap).

### Phase 4 — Team formation + motion approval as governed transitions
9. Real handler for `request_team_acceptance` (participant invited via `addParticipant`, ACTION
   grant enforced); pair with `accept_participation` (already real).
10. Governed `approve_motion` skill that dual-writes: legacy `approveMotion` + canonical
    `transitionPursuit('READY_TO_ACTIVATE')` + `recordAndEnqueue`.

### Phase 5 — (Deferred / gated) governed external action from a human surface
11. Only in DEMO/simulate: expose the `send_campaign_touch` governed path from a human confirm on
    the Pursuit surface, proving decision→dispatch→outbox→receipt end-to-end **without** opening
    the production send gates. Real send stays behind `OUTREACH_AUTOSEND` + PRODUCTION (§1.4).
    **This phase is optional and explicitly does not migrate the live send path.**

---

## 7. Migration / data implications

- **Phases 1, 3, 4:** **no schema change** — all target tables (`pursuit_route_snapshots`,
  `pursuit_overrides`, `governed_action_invocations`, `pursuit_outcomes`, `attribution`,
  `pursuit_participants`, `recompute_requests`) already exist (migrations 0063–0093).
- **Phase 2 (append-only):** one new migration adding triggers/revokes. Reversible.
- **Bridge (Phase 3):** requires `opportunities.pursuit_id` / `motions.pursuit_id` to be
  **populated**. Today they are null (0067 added them nullable, unread). A backfill
  (`pursuits:backfill` via `reparent.ts`) links existing legacy rows to canonical pursuits — this
  is a **data** step, not schema, and runs on the demo tenant first. **[DECISION]** backfill
  strategy and whether new legacy rows set `pursuit_id` at creation time going forward.
- **No table is dropped** except the P0-6 duplicate *doc* file (not a DB object).
- **`0066` link tables:** untouched (P0-5).

---

## 8. Safety / invariant impact

| Invariant | Impact | Mitigation |
|---|---|---|
| Recommendation ≠ decision | Phase 1 adds the first *human write* to `selected_partner_id` | Two distinct skills + `pursuit_overrides` trail; `recommended_*` never overwritten |
| UNKNOWN stays UNKNOWN | Recompute wiring must not fabricate scores | Only ROUTE recompute runs (R40); no score synthesized; UNKNOWN facts untouched |
| Cross-org consent | Phase 4 crosses tenants | ACTION grant (R24) at dispatch + `grantIsLiveById` re-check |
| No synthetic external send | Phase 5 exposes send path | `dataEnvironment` + `OUTREACH_AUTOSEND` gates unchanged; demo simulates |
| Server-side disclosure | Pursuit decision room shows route reasons | `reasonsInternal` withheld unless `canSeeInternal`; nothing confidential serialized |
| Append-only audit | Currently convention-only (G10) | Phase 2 adds DB enforcement |
| Fail-closed tenancy | All new server actions run in `withTenant` | No raw pool; RLS/GUC pinned |
| Governed-only mutation | Every loop write is a governed invocation | No UI calls a lifecycle primitive except inside a skill/`withTenant` action |

---

## 9. UX changes (doctrine-preserving)

- **Today** = decisions requiring attention → the ROUTE_APPROVAL card now leads to a *working*
  decision (P0-1 + Phase 1). No new room.
- **Pursuit Detail** = the governed decision room → gains the Approve/Override control **in the
  existing route panel** (progressive disclosure under the candidate table). This is the
  platform's signature moment: the first human governed action with a live audit trail. No CRUD
  form; a decision with reasons.
- **Insights** = outcomes/learning → gains a canonical panel beside the legacy funnel (Phase 3).
- **Ops** = loop health → becomes reachable (P0-7) and meaningful once live invocations flow.
- **Accounts / Queue** = now respect the ecosystem scope chip (P0-2/3) — consistency with
  Today/Pipeline, no new UI.
- **No new permanent rooms.** Every change lands in an existing surface as a contextual control,
  drawer, or panel. Confirmation dialogs for governed writes; nothing auto-fires.

---

## 10. Tests required

- **Existing harnesses to keep green:** `pursuit-verify`, `routes-verify`, `governance-verify`,
  `governed-mutation-verify`, `recompute-verify`, `recompute-recovery-verify`, `outcomes-verify`,
  `closed-loop-verify`, `outbox-verify`, `ops-verify`, `isolation-verify`, `experience-verify`,
  `e2e-pursuit`, plus the 13 `npm test` unit suites.
- **New coverage:**
  - Phase 1: a test that a route Approve and a route Override each produce the correct
    `governed_action_invocations` + `change_ledger` rows, that recommendation is preserved, and
    that an illegal actor/role is REJECTED (audited). Extend `governed-mutation-verify`.
  - Phase 2: a live-path test that a route decision **enqueues** a `recompute_requests` row and the
    worker drain produces a new route snapshot; an append-only test that UPDATE/DELETE on the
    protected tables raises.
  - Phase 3: a bridge test that a legacy opp close on a `pursuit_id`-linked opportunity records a
    canonical `pursuit_outcomes` + `attribution` row with decision-time context, and that
    convergence is marked correctly.
  - Phase 4: `request_team_acceptance` real handler enforces the ACTION grant; participation
    accept transitions correctly.
  - P0-2/3: scope-narrowing tests for Accounts and Queue (ALL vs a partner scope vs empty scope).
- **Every phase:** production-build verification (demo runs on `next build && next start` only),
  desktop/mobile + light/dark for any UI touched.

---

## 11. Demo implications

- The demo tenant is **DEMO** (`dataEnvironment='DEMO'`), so Phase 5's external send always
  simulates — the loop can be walked end-to-end in the demo **without any real send**.
- Phase 1 makes the demo's Today "Approve route" CTA *actually work*, and Phase 3 lets the demo
  show a canonical outcome/attribution trail feeding Insights — turning the current read-only
  hero surfaces into a walkable decision→outcome→learning story.
- The synthetic MEDDPICC enrichment (commit `37e12c8`) already provides the honest, noisy
  qualification-vs-outcome signal the canonical Insights panel will render.
- Requires the demo tenant's `PURSUIT_EXPERIENCE_ENABLED`/`FEDERATION_ENABLED`/
  `GOVERNED_ACTION_ENABLED` flags on (they are, for the demo org) and a backfill so demo
  opportunities carry `pursuit_id`.

## 12. Pilot implications

- **Nothing here requires the production cutover** (P0-4) to be resolved first — the loop is
  exercised on the demo tenant and behind per-org flags. But the **append-only DB enforcement
  (Phase 2)** and the **`app_rw` cutover (task #67)** are the two items that gate turning the loop
  on for a *real* pilot tenant, because a live governed loop writing an audit ledger that `app_rw`
  can still UPDATE/DELETE is not defensible to a security officer.
- The governed external send (Phase 5) must stay dark for any pilot until the send gates and a
  real provider are explicitly commissioned — unchanged from today.

---

## 13. Explicit non-changes (out of scope this phase)

- The live outreach **send** path (legacy `comms/*`) — not migrated.
- The CRM opportunity/motion/campaign object models — not replaced.
- Intake, Contacts, Mapping, Campaigns, Upcoming, Analytics rooms — untouched (except Queue/
  Accounts scope P0).
- `outcome_events` and its readers (Insights/Analytics legacy funnel) — kept live.
- The `0066` interaction/relationship base tables — not built (deferred to Workstream G).
- Interaction capture (Gmail/Calendar/Graph), Salesforce write-back adapter, Surface Router,
  observability provider — deferred-feature territory, not this phase.
- The production RLS cutover itself (task #67) — an operator action, tracked, not performed here.
- No new domain primitive, scoring concept, disclosure rule, federation semantic, or demo-only
  business object.

---

## 14. Implementation sequence (smallest independently verifiable phases)

Each phase is shippable and verifiable on its own; later phases depend only on earlier ones as
noted. **P0 items can land in any order, before or interleaved with Phase 1.**

| Phase | Deliverable | Depends on | Independently verifiable by |
|---|---|---|---|
| **P0-a** | Accounts scope-aware (P0-2) | — | scope-narrowing test + visual |
| **P0-b** | Queue scope-aware (P0-3) | — | scope-narrowing test + visual |
| **P0-c** | Dead-CTA repoint (P0-1, interim) | — | Today CTA resolves (no 404) |
| **P0-d** | Doc reconciliations (P0-4/5/6/7 notes + stub delete + Ops nav) | — | doc review; Ops reachable |
| **1** | Governed route decision (skills + control + transition + first recompute enqueue) | P0-c | `governance`/`governed-mutation` + new route-decision test |
| **2** | Recompute producer wiring + append-only DB enforcement | 1 | `recompute-verify` on live path + append-only raise test |
| **3** | Canonical outcome/attribution bridge + Insights panel | 1, 2, backfill | `outcomes-verify`/`closed-loop-verify` on live path |
| **4** | Team formation + governed motion approval | 1 | participation + `request_team_acceptance` grant test |
| **5** | *(optional, gated)* governed send from human surface, DEMO-only | 1, 2 | outbox→receipt walk in simulate mode |

**Recommended first cut:** P0-a/b/c/d + Phase 1 + Phase 2. That yields a genuinely closed
micro-loop — *decide route (governed, audited) → recompute → fresh recommendation* — with the
audit ledger made tamper-evident, without touching sending, outcomes bridging, or the CRM model.
Phase 3 (outcome/learning) is the natural second cut.

---

## 15. Rollback strategy

- **Per-phase flag gating.** The loop lives behind the existing `GOVERNED_ACTION_ENABLED` /
  `OUTCOME_LEARNING_ENABLED` per-org flags (fail-closed). Disabling the flag returns the tenant to
  read-only canonical surfaces + the legacy loop — an instant, data-safe rollback.
- **Additive/dual-write.** Phases 1–4 *add* canonical writes beside the untouched legacy path, so
  reverting a phase never breaks the legacy loop that pilots/demos already rely on.
- **Append-only migration (Phase 2)** is reversible (drop trigger / re-grant), but should be
  reverted only deliberately since it is a security control.
- **Backfill (Phase 3)** writes only `pursuit_id` FKs and canonical rows; it neither mutates nor
  deletes legacy data, and can be re-run idempotently or ignored by turning the flag off.
- **Git-level:** each phase is a separate commit on `claude/activateos-platform-review-xzkgmd`;
  any phase can be reverted without unwinding earlier ones because of the additive design.

---

## 16. Decisions required before implementation (consolidated)

1. **[P0-1]** Route-decision deep-link target: `/pursuits/${id}` detail (recommended) vs a
   dedicated `/pursuits/${id}/route` sub-room.
2. **[P0-4]** Operator confirmation of the *actual* production RLS state (role, FORCE RLS, tracker)
   — a human/environment fact the repo cannot prove; and approval to mark
   `RISK-1-CUTOVER-STATE.md` as a session log rather than authoritative.
3. **[P0-5]** `0066` link tables: leave inert (recommended) vs drop until Workstream G.
4. **[P0-6]** Delete the uppercase duplicate security-audit stub (recommended).
5. **[P0-7]** Surface `/ops` as an owner-nav item (recommended) vs keep hidden.
6. **[Phase 2]** Append-only enforcement mechanism: REVOKE vs status-forward trigger, per table.
7. **[Phase 3]** Backfill strategy for `opportunities.pursuit_id` / `motions.pursuit_id` and
   whether new legacy rows set it at creation.
8. **Scope of first cut:** confirm P0 + Phase 1 + Phase 2 as the initial bounded implementation
   (recommended), deferring outcome-bridge (3), team/motion (4), and send (5).

---

**HALT.** This is the design artifact. No code, schema, or documentation change has been made.
Awaiting approval (and the decisions in §16) before implementing any phase. After the loop is
agreed, the deferred-capability list can be reconciled against this canonical operating model and
the UX doctrine.
