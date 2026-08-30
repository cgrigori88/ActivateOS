# PursuitOS — Workstream E: Federated Pursuit + Governed Execution + Outcome Loop

**Phase 1 (Deep Mapping) + Phase 2 (Technical Design). Design only — no implementation code. HALT for sign-off before Phase 3.**
No production data touched. Existing Pursuit/Fact/Routing/Experience flags stay dark for production tenants; every E surface ships behind new default-OFF flags.

Canonical loop E establishes:
`Observed Truth → Facts → Pursuit Intelligence → Route Candidates → Recommended Route → Human Decision → Federated Team Context → Governed Action → Interaction/Outcome → Updated Truth → Re-score/Re-route/Re-act`

---

# PHASE 1 — DEEP MAPPING

Six substrates were mapped against E's 25-point directive and classified reuse / extend / net-new. Every finding below is grounded in a concrete migration or `src` file.

## 1.1 Consent / grant / overlap / introductions
- **Bridge:** `partnerships` (`0031`) — 2-party (`initiator_org_id`, `counterpart_org_id`, `invite_code`, status `invited→active→revoked`), invite/redeem in `src/lib/partnerships/partnerships.ts`.
- **Grant:** `list_grants` (`0031`/`0032`) — `offered→accepted→declined→revoked`, `selected_fields text[]` (column-scoping), materialized copy on accept; `offer/accept/decline/revoke/sync` fns exist.
- **Audit:** `audit_log` (`0031`) — per-org, append-only (no UPDATE/DELETE policy), dual-write, `audit()` never throws; `auditEntries()` already answers "what did they see and when."
- **Disclosure ladder:** `overlap_probes` (`0037`) — `counts→bands→named`, requester can't approve own, symmetric `results`. `namedOverlapAccounts()` is the reusable "only consented entities are eligible" gate.
- **Others:** `warm_intro_requests` (`0042`), `evidence_shares` (`0053`, live read + revoke), `skill_shares` (`0048`), `joint_playbooks` (`0046`).
- **RLS:** `0058` (`app_rw`, `app_current_org()`, `is_org_member`), `0059` (`resolve_user_org`), `0060` (`can_see_partnership()` for partnership-scoped tables). `withTenant`/`withTenantOrg` set the `app.org_id` GUC.
- **Reuse:** propose→accept→revoke pattern, `audit_log`, field-scoping projection, `can_see_partnership` RLS, `namedOverlapAccounts` gate.
- **Net-new:** **TTL/expiration** (no `expires_at` anywhere), **purpose-binding enforced at read**, a **generalized shared-context grant target** (every grant today is type-specific), **DB-enforced audit immutability** (append-only is convention, not FORCE-enforced).

## 1.2 Rooms / guest / settlement / participation
- `joint_pursuits` (`0039`) is keyed on `(partnership_id, company_id)`, **disconnected from `pursuits.id`**, strictly 2-party → it is the **Room projection**, not the participation edge. Symmetric `joint_pursuit_events` (org NAMES in body, `org_id` null = broker) and the "what they can see" panel are reusable projection mechanics.
- `pursuit_team_members` (`0075`) is the **acceptance-lifecycle precedent** (`RECOMMENDED→INVITED→ACCEPTED→DECLINED→ACTIVE/…/SUPERSEDED`, `side ∈ VENDOR/PARTNER/DISTRIBUTOR`, 13 roles, recommendation≠decision, `app_rw` RLS) — but **single-org, person/seller-level**.
- Guest: `organizations.kind ∈ (full,guest)` (`0041`), public `/join/[code]` flow, `guest.ts`, invite-code capability. Reusable wholesale for `CUSTOMER_GUEST`.
- Settlement: computed in `settlement.ts` (no table), gated by a `joint_pursuits` row; attribution binary `sourced` (deal-reg exists) / `influenced`.
- **Net-new:** `pursuit_participants` (N-org edge on the canonical Pursuit) — nothing provides an N-org, org-level participation row; a Pursuit↔Room binding (`joint_pursuits` has no `pursuit_id`); multi-party consent beyond the 2-party partnership.

## 1.3 Skills / governed action / MCP
- MCP surface (`src/app/api/mcp/route.ts`, `mcp-tools.ts`): 8 READ tools + `draft_touch` (draft-only, structural via `campaign_touches.status`) + `request_warm_intro` (a **cross-tenant write mislabeled** as read). Per-org `api_keys` (`0040`), `resolve_api_key` (`0062`), `withTenantOrg` scoping.
- "Skill" = **three unrelated things**: (A) `ROUTING_SKILLS` (`src/lib/routing/skills.ts`) — declares `SideEffectClass READ/INTERNAL_WRITE/CROSS_TENANT_ACTION` but **nothing dispatches through it or enforces it**; (B) `DecisionAction` UI hints; (C) `skills` content table (`0047`, prompt grounding). Plus triggers/routines catalogs.
- **Reuse:** effect-class vocabulary, `McpToolDef` shape, `change_ledger` (audit+events, actor≠trigger, `agent_run_id`), `agent_runs`, consent fabric for CROSS_TENANT, approval precedent (`campaign_touches` draft→approved→sent, `approveMotion`), role model (`org_role`/`requireOwner`).
- **Extend:** `ROUTING_SKILLS`→ real registry+dispatcher; add **`EXTERNAL_ACTION`** class (both current vocabs have only 3); `DecisionAction.skill`→ FK into the registry.
- **Net-new:** stable `skill_id`+`version`, declarative `preconditions`, `idempotency_key` (none exists), `retry` policy, `compensation`/rollback (no saga concept anywhere), a **governed-action invocation table** (neither `agent_runs` nor `change_ledger` represents "invocation of skill X by actor Y, status pending/executed/compensated").

## 1.4 Events / snapshots / recompute
- `change_ledger` (`0065`/`0073`/`0079`) — bitemporal (`occurred_at` business / `recorded_at` system), actor≠trigger, `materiality`, `data_environment`, append-only, `recordChange()` universal choke-point.
- Versioned one-current snapshots exist: `pursuit_score_snapshots`/`_dimensions`/`_contributions` (`0064`, `feature_observed_at` as-of), `pursuit_route_snapshots`/`route_candidates`/`_reasons(disclosure_class)`/`route_candidate_dimensions`/`pursuit_route_participants` (`0074`), `pursuit_why_now_snapshots`/`_convergence_snapshots` (`0072`). Partial-unique `where is_current` enforces "exactly one current."
- **No event→recompute pipeline.** `recomputeRoute`/`writeScoreSnapshot` are called **only from scripts** + one reparent path; producers call `recordChange` and stop; `getTodayQueue` is a read-time projection, not a trigger. `writeScoreSnapshot` is a **persister, not a scorer** (dimension math lives only in verify scripts). As-of enforcement is **partial** (only `transaction_adjacency` threads `asOf`).
- **Net-new:** event→recompute dispatcher, a `recompute_requests` intent queue carrying the triggering event's `occurred_at` as the as-of stamp, a deterministic dependency map, real `src`-side scorers, `READINESS_CHANGED` emission.

## 1.5 Interactions / opportunities / outcomes / experiments
- Two spines: legacy (`revenue_motions→campaigns→opportunities→outcome_events`) and Pursuit (`pursuits→route snapshots→route_outcomes→change_ledger`). Close & engagement are still recorded on the **legacy** spine.
- `interaction_events` (`0010`, channel-agnostic, `type` free text), `email_events`, `engagement_scores`. `opportunities`+`opportunity_stage_transitions`+`opportunity_meddpicc`(row-per-element)+`deal_registrations`+`stage_weights`. `advanceOpportunity` banks `CLOSED_WON/LOST`.
- Outcomes: `outcome_events` (24 types), `route_outcomes` (`0078`, 14 labels, `seconds_since_recommended`). **No `NO_DECISION`/`DORMANT`/`DISQUALIFIED` as outcome labels.** Decision-time context already fully snapshotted → link by id.
- Attribution: only binary `sourced/influenced` (derived in `settlement.ts`) + evidence-source tallies (`autopsy.ts`). **Experiments/cohorts: none exist.** `change_proposals` (`0002`) is the "divergence → human proposal, never silent update" discipline to follow.
- **Net-new:** unified `pursuit_outcomes` label table (+ missing labels), versioned **attribution** table (classes sourced/influenced/assisted/observed/attributed), **experiments/cohort_assignments** (assignment inputs derivable; `data_environment`/`is_simulated` isolation exists).

## 1.6 Entity resolution / providers / disclosure / provenance
- Disclosure vocab (6): `PUBLIC/INTERNAL/PARTNER_SHARED/TRANSACTION_CONFIDENTIAL/PII/RESTRICTED`, duplicated in **4 sites** (2 SQL CHECKs + `routing/types.ts` + `transactions/provider.ts`). Enforcement is server-side, pre-serialization, but **only** on `route_candidate_reasons`: `route.ts::buildCandidate` (internal vs shareable, `reasonsInternal=null` when not permitted), `explanation.ts::buildExplanation(audience)`, `caller.ts::callerFor` (keys on `organizations.kind`).
- Contribution modes `RAW/DERIVED/FEDERATED` already exist on `transaction_providers`/`transaction_features` (+`data_classification`, `source_lineage`); `TransactionSignalProvider` is a **generic, non-TD-SYNNEX** contract with a feature-minimized `FederatedAnswer` (query-at-source pattern). `facts.provenance_class` (7 values incl. `HUMAN_ASSERTED`) + `origin_kind` (incl. `CONVERGENCE`) are a second provenance substrate.
- Entity resolution: `company_aliases`(`0077`)+`entity_resolution_reviews`(`0077`)+`resolveCompany` (deterministic-before-fuzzy, AUTO 0.95 / REVIEW 0.75, sub-AUTO returns `companyId=null` → barred from scoring). `hierarchy_rollup_policies` governs roll-up. **Schema/code drift:** `identity-resolve.ts` queries `company_aliases.alias_value` but the column is `alias`.
- **Net-new:** a **generic `applyDisclosure` engine** + a disclosure column on facts/evidence/signals/contacts/relationships/team/activity/interactions/opportunities/outcomes (today only route reasons are gated); add `ASSERTED/AGGREGATED` modes; a queryable **`source_org_id`** across contributions ("provenance retained, disclosure controls inspection"); source-org-scoped entity resolution + fix the `alias_value` drift + unify the two resolvers; TD SYNNEX provider implementation.

### Phase 1 one-line verdict
The **storage, snapshotting, consent, and disclosure-enforcement primitives are largely built and high quality**; Workstream E is predominantly **net-new spine** — the N-org participation edge, the generic disclosure engine, the governed-action execution/idempotency/compensation layer, the event→recompute reactive loop, and the outcome/attribution/experiment substrate — wired onto those primitives, plus disciplined additive extensions to enums and the feature-read layer.

---

# PHASE 2 — TECHNICAL DESIGN

## 2.0 Principles & non-negotiables
1. **One canonical Pursuit.** No cloned per-tenant pursuits; no reparenting Facts/Routes/Teams/Actions under Rooms (§21). `pursuits.org_id` becomes the *sponsor* tenant; participation is additive.
2. **Disclosure is a server-side policy system, not a UI filter** (§2). Generate the caller-specific read model before the wire. The `$1.84M TD SYNNEX` case is a permanent regression fixture.
3. **Provenance retained, disclosure controls inspection** (§3). A row always knows its `source_org_id`; policy decides who sees it, generalized, aggregated, or not at all.
4. **Human governance** (§17). AI proposes; an approved policy + recorded actor is required for any mutation, especially cross-tenant/external.
5. **Causal humility** (§10). Attribution is explicit, versioned, and never fictional ROI.
6. **As-of correctness** (§8). A later event never leaks into a historical reconstruction.
7. **Additive & dark.** New migrations `0080+` follow the established additive-CHECK-widen pattern; all E surfaces behind `FEDERATION_ENABLED`, `GOVERNED_ACTION_ENABLED`, `OUTCOME_LEARNING_ENABLED` (default OFF, dependency fail-safe like `pursuitExperienceEnabled`).

## 2.1 Canonical object model (relationships)
```
Organization / Participant
  ↘  Canonical Pursuit (pursuits, 0063 — sponsor org_id)
     ├── Facts / Evidence / Signals            (+ source_org_id, disclosure_class)
     ├── Score snapshots                       (0064, as-of)
     ├── Route snapshots + candidates + reasons(0074, disclosure_class)
     ├── Pursuit participants                  ← NET-NEW pursuit_participants (N-org edge)
     ├── Team                                  (0075, per-participant)
     ├── Decisions                             (pursuit_overrides 0068 + selected_*)
     ├── Actions                               ← NET-NEW governed_action_invocations
     ├── Interactions                          (interaction_events 0010, + pursuit_id)
     ├── Outcomes                              ← NET-NEW pursuit_outcomes + attribution
     ├── Change ledger                         (0065, event spine)
     └── Collaboration projections / Rooms     (joint_pursuits 0039, + pursuit_id)
```

## 2.2 Layer 1 — Federated Shared Pursuit (schema + state machine)
**NET-NEW `pursuit_participants`** (illustrative DDL):
```
pursuit_participants(
  id uuid pk, org_id uuid not null,            -- the participating org (RLS subject)
  pursuit_id uuid not null → pursuits,
  sponsor_org_id uuid not null,                -- = pursuits.org_id at join time
  role_in_pursuit text check in
    ('VENDOR','DISTRIBUTOR','RESELLER','SERVICES_PARTNER','HYPERSCALER',
     'TECH_ALLIANCE','CONSULTANT_SI','CUSTOMER_GUEST','OBSERVER'),
  participation_state text check in ('INVITED','ACTIVE','DECLINED','LEFT','REVOKED') default 'INVITED',
  consent_grant_id uuid → context_grants(id),  -- scope+purpose+expiry (2.5)
  disclosure_default text,                     -- default class ceiling for this participant
  inviter_org_id uuid, invited_by uuid, sponsor_actor uuid,
  source_of_participation text,                -- partnership | invite | join_code | broker
  joined_at, left_at, effective_from, effective_to,
  data_environment text default 'PRODUCTION',
  unique(pursuit_id, org_id))
```
- **State machine:** `INVITED →(accept) ACTIVE →(leave) LEFT`; `INVITED →(decline) DECLINED`; `ACTIVE|INVITED →(sponsor/participant revoke) REVOKED`. Terminal: DECLINED/LEFT/REVOKED (a fresh invite creates a new row).
- **RLS (new visibility pattern):** widen Pursuit-family reads from single-org `is_org_member(org_id)` to *"is_org_member(pursuits.org_id) OR EXISTS an ACTIVE pursuit_participants row for the caller org"*. Implement as a SECURITY DEFINER `can_see_pursuit(pursuit_id)` mirroring `can_see_partnership`; apply to `pursuits` and every child by pursuit_id, in a `0060`-style loop. Participants see **only through the disclosure engine** (2.3) — visibility of the row ≠ visibility of its confidential fields.
- **Graceful partial participation (§13):** participation is optional; readiness derives from present participants; absence lowers `activation_readiness` but never errors.
- **Room binding (§5):** add `pursuit_id uuid → pursuits` to `joint_pursuits`; a Pursuit may have N rooms (internal, distributor-enabled, exec, customer-safe) — room membership determines collaboration context, not commercial truth. Rooms remain 2-party today; multi-party rooms compose from participation.

## 2.3 Layer 2 — Disclosure policy system
- **Vocabulary (7):** `PRIVATE_TO_ORG, PURSUIT_INTERNAL, SHAREABLE_WITH_PARTICIPANTS, SHAREABLE_WITH_SPECIFIC_ORGS, GENERALIZED, AGGREGATED, PUBLIC`. Introduce a **single Postgres domain** `disclosure_class` + a single shared TS enum, ending the 4-way duplication. Migration maps the legacy 6 → 7 (`INTERNAL→PURSUIT_INTERNAL`, `PARTNER_SHARED→SHAREABLE_WITH_PARTICIPANTS`, `TRANSACTION_CONFIDENTIAL→PRIVATE_TO_ORG`, `PII/RESTRICTED→PRIVATE_TO_ORG`, `PUBLIC→PUBLIC`) while retaining the raw source class for audit.
- **Engine (net-new):** `applyDisclosure(rows, classAccessor, viewer): { visible, generalized, aggregated }` — a single function every read model calls before returning. Reuses the proven `route.ts`/`explanation.ts` split (internal vs shareable, `null` when not permitted, `GENERALIZED[code]` prose) generalized to arbitrary object types.
- **Viewer context (extend `Caller`):** `{ orgId, isSponsor, participantRoles[], specificGrants[], canSeeInternal, canSeeTransactionDetail }`; `callerFor` loads participation + grants (not just `organizations.kind`).
- **Coverage:** add a `disclosure_class` column (or companion `*_classification`) to facts/evidence/signals/contacts/relationships/team/activity/interactions/opportunities/outcomes; the engine is invoked in `read-models/{detail,portfolio,today,route}.ts` and the new federation/outcome read models. **Payload-absence invariant:** confidential values are generalized/aggregated/absent *before* serialization — never CSS-hidden (server-component rendering already reinforces this, per D.5).

## 2.4 Layer 3 — Contribution without surrender
- **Modes:** extend `mode` CHECK to `RAW, DERIVED, FEDERATED, ASSERTED, AGGREGATED` (align with `facts.provenance_class`: `HUMAN_ASSERTED`≈ASSERTED, `origin_kind CONVERGENCE`≈AGGREGATED).
- **`source_org_id`** (net-new, queryable FK) on contribution-bearing rows (facts/evidence/signals/relationships/transaction_features), independent of disclosure. Invariant enforced in tests.
- **Federated query-at-source:** reuse `TransactionSignalProvider.query()` returning the minimized `FederatedAnswer` (present/recency/adjacency/relationship bands — never SKU/spend/invoice). This is the "strengthen a Pursuit without exposing raw data" mechanism (§22 long-term: query-at-source / private computation / returned derived feature / consented raw transfer). Domain contracts must not require central raw custody.

## 2.5 Layer 4 — Consent / grant engine
- **Generalize `list_grants` → `context_grants`** (net-new, or an additive extension): `id, partnership_id (nullable for multi-party), from_org_id, to_org_id, grant_target_type, grant_target_id (polymorphic: list|fact|evidence|pursuit_context|skill), scope jsonb, purpose text not null, coverage jsonb, status(offered→accepted→declined→revoked→expired), expires_at timestamptz, decided_at, revoked_at, created_at`.
- **TTL (net-new):** `expires_at` + a worker sweeper (mirror `runDueRoutines`) that flips `expired` and emits `ACCESS_REVOKED`.
- **Purpose-binding enforced at read (net-new):** the disclosure engine consults the grant's `purpose`/`coverage`, not just its existence.
- **Immutable audit (extend/harden):** reuse `audit_log` (dual-write, non-throwing); add typed fields (`grant_id`, scope snapshot, purpose); after the RLS cutover, `ALTER TABLE audit_log FORCE ROW LEVEL SECURITY` + no UPDATE/DELETE policy = tamper-evident. "Why can CDW see this?" = grant row + `auditEntries()` replay (who/what/which pursuit/expiry/revocation).
- **Revocation:** stops *future* retrieval (disclosure engine checks live grant state), never destroys historical audit.

## 2.6 Layer 6/7 — Governed action execution + Action/Decision/Interaction/Outcome
**NET-NEW `governed_skills`** registry (seed from `ROUTING_SKILLS` + `DecisionAction`):
```
governed_skills(
  skill_id text, version int,                  -- stable versioned identity (pk: skill_id,version)
  description text, effect_class text check in
    ('READ','INTERNAL_WRITE','EXTERNAL_ACTION','CROSS_TENANT_ACTION'),
  eligible_actors text[],                       -- USER|AGENT|WORKER|SYSTEM
  required_permission text,                     -- owner|operator|viewer
  input_schema jsonb, preconditions jsonb,      -- declarative, evaluable
  mutation_boundary text, approval_required boolean,
  idempotent boolean, retry_policy jsonb, compensation_skill_id text,
  emitted_change_types text[], status text)
```
**NET-NEW `governed_action_invocations`**:
```
governed_action_invocations(
  id uuid, org_id uuid, skill_id text, skill_version int,
  actor_type text, actor_id uuid, pursuit_id uuid,
  target_kind text, target_id uuid, args jsonb,
  idempotency_key text, status text check in
    ('PENDING','APPROVED','EXECUTING','EXECUTED','FAILED','COMPENSATED','REJECTED'),
  consent_grant_id uuid,                         -- required for CROSS_TENANT_ACTION
  requested_at, approved_at, executed_at, result jsonb, error text,
  emitted_event_id uuid → change_ledger,
  unique(org_id, skill_id, idempotency_key))
```
- **`dispatchSkill(skillId, version, actor, args, idempotencyKey)` chokepoint** (net-new): resolve registry → check `required_permission` vs `org_role` AND `eligible_actors` vs `actor_type` → validate `input_schema` → evaluate `preconditions` → enforce `effect_class` (READ may not mutate; `CROSS_TENANT_ACTION` requires an accepted, unexpired `context_grant`/participation authority; `EXTERNAL_ACTION` is **never casually retried**) → idempotency dedup on the unique key → run the bound handler → write the invocation row + a `change_ledger` event (+ `agent_runs` when AI-initiated) → on failure apply `retry_policy` or `compensation_skill_id`.
- **Reconcile MCP:** route `MCP_TOOLS` writes (`draft_touch`, and the currently-mislabeled `request_warm_intro`) through `dispatchSkill` so the "draft-only / cross-tenant" boundary is enforced by effect-class, not convention.
- **Five-way persistence (§7):** Recommendation (snapshots) · Decision (`pursuit_overrides`+`selected_*`) · Action (`governed_action_invocations`) · Interaction (`interaction_events`+`pursuit_id`) · Outcome (`pursuit_outcomes`, 2.8). Each separate, linked by id — the future learning record.

## 2.7 Layer 8 — Event-driven loop
- **Extend `change_type`** (`0080_change_ledger_e_types.sql`, additive widen + `ChangeType` union): `FACT_ACCEPTED, ROUTE_SELECTED (alias), PARTICIPANT_INVITED, PARTICIPANT_JOINED, PARTICIPANT_LEFT, ACCESS_GRANTED, ACCESS_REVOKED, TEAM_MEMBER_ASSIGNED, INTRO_REQUESTED, INTRO_ACCEPTED, OUTREACH_SENT, REPLY_RECEIVED, MEETING_BOOKED, OPPORTUNITY_CREATED, STAGE_CHANGED, PURSUIT_WON, PURSUIT_LOST, PURSUIT_DORMANT, READINESS_CHANGED`. Add `trigger_type EVENT_TRIGGERED`.
- **NET-NEW `recompute_requests`**: `id, org_id, pursuit_id, dimension_set text[], as_of timestamptz (= triggering event occurred_at), requested_by_event_id uuid, status(PENDING/RUNNING/DONE/FAILED), attempts int, created_at`.
- **Deterministic dependency map** (net-new, declarative — analogous to `classifyChange`): `change_type → invalidated {dimensions, route, readiness, today}`. E.g. `FACT_ACCEPTED → {evidence_confidence, propensity, route, today}`; `ACCESS_GRANTED → {route (new participant activation), today}`; `PARTNER_DECLINED → {route, readiness, today}`.
- **Dispatcher:** a transactional-outbox hook at `recordChange` (the universal choke-point) enqueues `recompute_requests`; a **worker drain** (`drainRecomputeQueue`, mirroring `drainScheduledTouches`) reads pending material rows and calls the persisters with `asOf = request.as_of` (never `now()`). Idempotent, deterministic, advisory-locked.
- **Real `src`-side scorers (net-new):** move the pursuit-dimension feature math out of verify scripts into `src/lib/pursuits/score-engine.ts` producing `{dimensions, contributions}` (with correct `feature_observed_at`) for `writeScoreSnapshot`. **As-of hardening:** extend `partner-activation.ts` + relationship/capability/territory reads to filter by `feature_observed_at ≤ as_of` (today only `transaction_adjacency` does).
- **Readiness (net-new):** first-class recompute + `READINESS_CHANGED`.

## 2.8 Layers 9/10/11 — Outcomes, attribution, experiments
- **NET-NEW `pursuit_outcomes`** (unified, Pursuit-spine): `id, org_id, pursuit_id, company_id, outcome_label text, occurred_at, recorded_at, score_snapshot_id, route_snapshot_id, why_now_snapshot_id, override_id, attribution_id, experiment_id, cohort text, seconds_to_* numeric[], data_environment, is_simulated`. Label set adds the missing `NO_DECISION, DORMANT, DISQUALIFIED` plus the existing route/opportunity labels. `advanceOpportunity` + `transitionPursuit` both emit a unified outcome on close (reconciling the two spines).
- **NET-NEW `attribution`** (versioned, explicit, NOT ROI): `pursuit_id/opportunity_id, org_id, partner_id/seller_id, attribution_class ∈ (sourced,influenced,assisted,observed,attributed), attribution_model_version, evidence jsonb, computed_at`. Generalizes `settlement.ts`'s binary logic; `deal_registrations`/`joint_pursuits`/`route_participants` are the inputs.
- **NET-NEW `experiments` / `experiment_arms` / `cohort_assignments`**: assignment inputs are derivable (`pursuit_overrides`, `recommended_route` vs `selected_route`, `route_topology`, `transaction_features`); materialize an assignment/label layer with a stable `experiment_id`/`arm` and `data_environment`/`is_simulated` isolation. **Fairness invariant:** experiments never cross tenant isolation or disclosure boundaries. Follow the `change_proposals` discipline — divergence surfaces a human proposal, never a silent weight update; **no predictive-calibration claims on synthetic data** (analytics/backtesting/threshold-tuning only).

## 2.9 Layers 14/15/16 — Identity, providers, integration boundary
- **Federation-aware entity resolution:** add source-org scoping to `entity_resolution_reviews`/`company_aliases` (record which participating org's id space an external id belongs to, so the same external_id from two orgs never collides); **fix the `alias_value`/`alias` drift**; unify the two resolvers (`identity/resolve.ts`, `transactions/identity-resolve.ts`) under one federation-aware entry point. Unresolved (`companyId=null`) contributions stay quarantined and never silently affect another org's Pursuit (§14).
- **Generic distributor provider (mostly built):** extend the `feature_key` vocabulary + `transactionScore` weights for **inventory / renewal / marketplace** signals; add provider methods if needed. **TD SYNNEX is an implementation of `TransactionSignalProvider`, not schema** (§15). Renewal features can promote to a `renewal_date` fact.
- **Integration boundary (§16):** CRM/PRM/distributor/email/calendar/campaign/deal-reg/portal/data-provider via the existing provider/adapter contracts; the demo uses seeded/synthetic fixtures and **must never imply synthetic distributor data is live TD SYNNEX data** (persistent demo badge + `data_environment='DEMO'`/`is_simulated`).

## 2.10 Layer 12/19 — Today + UX deltas (minimal, preserve D.5)
- **Today:** extend `getTodayQueue` to classify the new event types; each item already carries why/pursuit/material-event/skill/deadline; add **deterministic disposition** (acting on an item transforms/removes it, never merely hides). Categories `DECISION_REQUIRED/RISK/ACTION_REQUIRED/MATERIAL_CHANGE/FYI` unchanged.
- **Pursuit detail (additive panels, D.5 grammar):** a **Participants** strip (org · role · state, Invite/Accept), a disclosure-safe **shared context** view (what each participant may see), **governed action controls** (buttons that call `dispatchSkill`, honest per effect-class), and an **action state/history** + material-outcome trail. Complexity stays in the substrate; the screen adds only the minimum federation/execution affordances. No second shell; no reparenting.

## 2.11 Migration plan (additive, `0080+`)
1. `0080_change_ledger_e_types` — widen `change_type`, add `EVENT_TRIGGERED`.
2. `0081_disclosure_domain` — `disclosure_class` domain + 6→7 map (keep raw source class).
3. `0082_source_org_and_modes` — `source_org_id` + `ASSERTED/AGGREGATED` on contribution tables.
4. `0083_pursuit_participants` + `can_see_pursuit()` + widen Pursuit-family RLS.
5. `0084_context_grants` (+ `expires_at`, purpose, coverage) + `joint_pursuits.pursuit_id`.
6. `0085_governed_skills` + `governed_action_invocations`.
7. `0086_recompute_requests`.
8. `0087_pursuit_outcomes` + `attribution`.
9. `0088_experiments` + `experiment_arms` + `cohort_assignments`.
10. `0089_entity_resolution_source_org` + alias drift fix.
Every migration additive and inert until read; new flags gate all reads/writes.

## 2.12 Rollback plan
- Flags `FEDERATION_ENABLED`/`GOVERNED_ACTION_ENABLED`/`OUTCOME_LEARNING_ENABLED` → OFF restores exact pre-E behavior (all new tables go unread; `dispatchSkill` unused; recompute drain idle).
- New tables are additive; a down-path drops them without touching `0001–0079`.
- The 6→7 disclosure map retains the raw source class, so it is reversible.
- Recompute drain is opt-in; disabling the worker tick stops the reactive loop with no data loss (ledger + snapshots intact).

## 2.13 Read models (server-side, disclosure-first)
New/extended read models, all routed through `applyDisclosure` + the extended `Caller`:
- `getPursuitFederation(db, viewer, pursuitId)` — participants, roles, states, per-viewer shared-context.
- `getGovernedActions(db, viewer, pursuitId)` — eligible skills for this actor (effect-class + preconditions), invocation history.
- `getPursuitOutcomes(db, viewer, pursuitId)` — outcome trail + attribution (disclosure-filtered).
- extend `getPursuitDetail`/`getTodayQueue` for participants + new event types.

## 2.14 Demo fixtures (synthetic, §16/§20)
Extend `scripts/demo-db.ts`: seed Red Hat (vendor sponsor), TD SYNNEX (distributor participant), CDW (reseller), Globex (customer), with `pursuit_participants`, a `context_grant` from TD SYNNEX (FEDERATED contribution), a distributor transaction signal that flips the recommendation to `Red Hat → TD SYNNEX → CDW → Globex`, a governed route-approval action, and a simulated meeting/opportunity event feeding back. All `data_environment='DEMO'`, `is_simulated=true`; the restricted figure stays vendor-internal.

---

## 2.15 Threat / risk register (federation security invariants → §18)
| # | Threat | Control |
|---|---|---|
| T1 | Org A enumerates Org B's Pursuits | `can_see_pursuit()` RLS; no listing endpoint returns non-participant pursuits |
| T2 | Org A infers participation in a Pursuit it has no grant for | participation rows gated by `can_see_pursuit`; existence not leaked in errors (not-found, not forbidden) |
| T3 | Participant reads another participant's private evidence | `applyDisclosure` + `source_org_id` + `PRIVATE_TO_ORG`; per-object class enforced pre-serialization |
| T4 | Restricted source value in a shareable payload | disclosure engine drops/generalizes before serialize; permanent `$1.84M` regression fixture; server-component render |
| T5 | Revoked/expired grant still grants access | disclosure engine checks live grant state + `expires_at`; sweeper emits `ACCESS_REVOKED` |
| T6 | Guest escalates via room membership | room membership ≠ commercial truth; capabilities derive from participation + grants, not room presence |
| T7 | Association table bypasses RLS | every new table in the `can_see_pursuit`/`can_see_partnership` loop; blind per-policy re-test as `app_rw` |
| T8 | Cross-tenant write without authority | `dispatchSkill` requires an accepted `context_grant` for `CROSS_TENANT_ACTION`; enforced at the chokepoint |
| T9 | Audit rewritten by ordinary users | append-only + `FORCE ROW LEVEL SECURITY`, no UPDATE/DELETE policy |
| T10 | As-of leakage into historical scores | feature reads filter `feature_observed_at ≤ as_of`; recompute uses event `occurred_at` |

---

## 2.16 Definition of Done (§24 — the closed loop must be proven)
E is complete only when a **blind harness** proves, with seeded/synthetic data, the full loop end to end:

> shared Pursuit → caller-specific disclosure → human decision → governed action → durable audited state change → interaction/outcome event → intelligence recomputation → resulting Today/Pursuit state change

with these invariants intact throughout:
1. Cross-tenant isolation (T1–T3, T7) — verified as `app_rw` under RLS.
2. Disclosure/payload-absence (T4) — restricted value absent from the participant payload at the HTTP layer.
3. Consent lifecycle (T5, T8) — grant → access; revoke/expire → no future access; audit immutable (T9).
4. As-of correctness (T10) — a historical reconstruction never sees a later event.
5. Governed execution — every mutation flows through `dispatchSkill` with effect-class + idempotency + audit; no dead demo buttons; AI cannot silently perform cross-tenant/external actions (§17).
6. Event→recompute — a material event deterministically re-scores/re-routes and changes Today.
7. Outcome/attribution — outcome captured with decision-time context; attribution explicit + versioned, no fictional ROI.
8. Graceful partial participation — vendor-only … vendor+distributor+reseller all function.

Deliverables at Phase 4: schema migrations (dark), the loop harness, real-app screenshots of the federation/action/outcome surfaces (per D.5 discipline), the threat-matrix blind verification, and an honest done-ladder — **architecture → harness → authenticated-app → demo-runtime verified; production-deploy NOT claimed.**

---

## 2.17 Phase 3 execution order (proposed, for the sign-off)
A. Disclosure domain + engine + extended `Caller` (foundation; 2.3). →
B. `pursuit_participants` + `can_see_pursuit` RLS + federation read model + Participants UI (2.2). →
C. `context_grants` + TTL/purpose + audit hardening (2.5). →
D. `governed_skills` + `governed_action_invocations` + `dispatchSkill` + MCP reconciliation + action UI (2.6). →
E. `change_type` extension + `recompute_requests` + dependency map + `drainRecomputeQueue` + real scorers + as-of hardening (2.7). →
F. `pursuit_outcomes` + `attribution` + experiments (2.8). →
G. Federation-aware entity resolution + generic distributor feature extension + demo fixtures (2.9/2.14). →
H. Loop harness + threat-matrix blind verification + real-app proof (2.16).

Each sub-phase is independently flag-gated and independently verifiable.

---

**Phase 2 signed off (approved with refinements). The refinements below are LOCKED into this artifact and the DoD. Phase 3 proceeds in the gated E3-A…E3-H order; every sub-phase ends with a targeted blind harness + RLS test + tsc + migration verification + production-flag-OFF confirmation + committed audit artifact, then the full E blind suite.**

---

# PHASE 2 REFINEMENTS — SIGN-OFF GUARDRAILS (LOCKED)

These 42 refinements are incorporated as permanent invariants. They refine, not redesign, §§2.0–2.17.

## A. Canonical object & separation of concerns (R1, R2, R3, R10, R20)
- **R1 One Pursuit identity.** Federation never produces vendor/distributor/reseller/room/partner copies + reconciliation. Participants receive **policy-governed projections** of the one canonical Pursuit. Rooms/guest/exec/customer-safe views are projections, never the authoritative commercial object.
- **R2 Four concepts modeled explicitly, never derived from one another:** (i) **Pursuit participation** (`pursuit_participants`) — who legitimately participates; (ii) **Commercial route** (`route_candidates`/`selected_*`) — who is recommended/selected to market; (iii) **Collaboration scope** (`joint_pursuits`/room membership) — who may collaborate in a context; (iv) **Disclosure authorization** (`context_grants` + disclosure engine) — what each org/user may receive. Disclosure is **not** derived from participation; participation **not** from route; route membership **not** from room membership. TD SYNNEX may participate, CDW be the selected reseller, a Red Hat/CDW room exist, and TD SYNNEX still hold evidence CDW cannot inspect.
- **R3 Multi-party topology, not bilateral.** `pursuit_participants` must support arbitrary authorized topologies (Vendor→Distributor→Reseller→Customer; Vendor→Hyperscaler→SI→Customer; Vendor→Distributor→MSP→Customer; Vendor→ISV→GSI→Customer; one distributor→many resellers; etc.). `role_in_pursuit` is an **extensible registry** (a `pursuit_role_types` seed table, not a frozen CHECK); the initial roles are seed data, not the graph shape.
- **R10 Recommendation ≠ Decision ≠ Action ≠ Execution ≠ Interaction ≠ Outcome** is elevated to a **canonical invariant** persisted across six objects (snapshots · `pursuit_overrides`+`selected_*` · `governed_action_invocations` requested · execution/accepted state · `interaction_events` · `pursuit_outcomes`). They never collapse into one status. This is the learning graph.
- **R20 Account intelligence ≠ Pursuit intelligence.** The Account ("Globex runs VMware") never substitutes for the Pursuit thesis ("migrate before renewal, via this route, now, these people, these reasons"). Many Pursuits per account; Account score never stands in for Pursuit intelligence.

## B. Context Contribution as a durable provenance object (R4, R5, R30, R34)
- **R4 NET-NEW `context_contributions`** — the durable object beneath the RAW/DERIVED/FEDERATED/ASSERTED/AGGREGATED modes and the provenance boundary that Facts, route features, and score features reference:
```
context_contributions(
  contribution_id uuid pk, pursuit_id uuid, source_org_id uuid not null,
  source_system text, provider_id uuid,
  contribution_mode text,                 -- RAW|DERIVED|FEDERATED|ASSERTED|AGGREGATED
  data_category text, subject_entity_id uuid, subject_kind text,
  semantic_meaning text, provenance jsonb,
  observed_at timestamptz, contributed_at timestamptz, valid_until timestamptz,
  disclosure_class text, sensitivity_class text,       -- two dimensions (R6)
  purpose text, scope jsonb, consent_grant_id uuid,
  raw_stored boolean, derived_only boolean,            -- R5 no-central-custody
  retention_class text, expires_at timestamptz,        -- R29
  onward_sharing_allowed boolean, delegation_allowed boolean, -- R8
  revocation_state text, data_environment text)
```
  A Fact/route-feature/score-feature carries `contribution_id` as its provenance boundary; the contribution stays inspectable independent of the derived artifact.
- **R5 No central custody as a requirement.** `raw_stored`/`derived_only` + the provider mode set (`RAW_TRANSFER, DERIVED_FEATURE, FEDERATED_QUERY, ASSERTION, AGGREGATED_RESULT`) ensure the schema supports "ask my system a permitted question; I keep the rows." Advanced mechanisms (secure computation, clean-room, PSI, local connectors) are **not implemented now**, but the schema must not preclude them.
- **R30 TD SYNNEX is an implementation, never schema.** No `td_synnex_*` columns anywhere except inside a provider-specific adapter module.
- **R34 The Pursuit Graph is the moat.** Preserve structured stable-ID edges (Company × Product × Problem × Timing × Evidence × Partner × Distributor × Seller × Route × Action × Outcome over time). Never flatten into blobs or unstructured AI memory. Postgres stays; explicit edge semantics are preserved (R19).

## C. Disclosure — two policy dimensions, policy resolution not redaction (R6, R7)
- **R6 Separate AUDIENCE from SENSITIVITY.** Two enums, not one overloaded field:
  - **Audience (`disclosure_class`):** `ORG_PRIVATE, PURSUIT_INTERNAL, PARTICIPANT_SHARED, ORG_ALLOWLIST, GENERALIZED, AGGREGATED, PUBLIC`.
  - **Sensitivity (`sensitivity_class`):** `PUBLIC, INTERNAL, CONFIDENTIAL, RESTRICTED`.
  A highly sensitive item may still be `ORG_ALLOWLIST`-shareable with one authorized org; a low-sensitivity item may still be irrelevant to a given participant. (Supersedes the single 7-value field in §2.3.)
- **R7 `applyDisclosure()` is policy resolution.** It can omit fields, substitute generalized facts, return aggregates, return boolean/ordinal features, substitute safe explanations, or **suppress existence entirely** — never mere `"$1.84M"→"[REDACTED]"`. **Invariant:** unauthorized data must not exist in the serialized payload (response body, HTML, JSON, React/RSC flight, client-readable logs, hidden DOM). The three-tier TD SYNNEX result (internal exact / partner-safe generalized / unauthorized absent) is a **permanent regression test**.

## D. Consent — purpose limitation, delegation, revocation, retention (R8, R28, R29)
- **R8 Purpose-limited grants.** `context_grants` carries subject, granting org, receiving org, permitted **information classes**, permitted **actions**, **commercial purpose**, **pursuit/account/list scope**, effective time, `expires_at`, revocation, **delegation_allowed**, **onward_sharing_allowed**. "Org A permits X to Org B for purpose Y within Pursuit Z until T."
- **R28 Graceful revocation.** On revoke: future reads blocked immediately; historical audit preserved; prior derived decisions remain historically explainable; **future recomputation must not use data beyond its permitted retention/use policy**. Revocation ≠ `deleted=true`.
- **R29 Retention.** Contribution metadata supports `retention_class`, `expires_at`, purge policy, `retain_derived_result`, `retain_audit_reference`. No schema assumes contributed data lives forever. No retention UI now.

## E. Governed action as a commercial transaction boundary (R9, R24, R25, R26, R35)
- **R9 `dispatchSkill()` is one of the most security-sensitive boundaries.** UI **asks**; the Skill boundary **decides legality**; the domain service **mutates**; the ledger **records**. UI code never directly mutates commercial state for governed-Skill actions. Every execution carries: authenticated actor + actor org + pursuit + action authority + consent/grant + current object version + policy version + skill version + input validation + idempotency + preconditions + effect class + approval rule + outcome + audit event.
- **R24 Data consent ≠ action authority.** A sharing grant never implies action rights. CROSS_TENANT_ACTION requires a **separate action-family capability/grant** (`action_grants` or an `authority` field on `context_grants` scoped to an action family), distinct from data-disclosure consent.
- **R25 External-action outbox.** EXTERNAL_ACTION side effects are **never tied to DB-transaction success**: domain txn → durable `action_outbox` record → executor → provider → receipt → event. Prevents partial-state failures; supports safe retries. Provider execution is not required in the demo; the **boundary is**.
- **R26 External-action receipts.** Every external execution eventually yields a receipt (provider, provider-action-id, submitted/accepted/completed timestamps, status) — operational proof the system *did* something, not merely recommended it.
- **R35 LLMs subordinate to governed state.** AI proposes Facts/summaries/Pursuits/routes/actions/messages; authoritative state passes deterministic/policy/domain boundaries. LLM output never becomes durable truth by emission. Fact-candidate boundary, governed Skills, provenance, human override all preserved.

## F. Event / recompute discipline (R11, R12, R13, R22, R23, R36, R37)
- **R11 Deterministic dependency map** (never recompute-everything): material event → affected Pursuits → affected dimensions → enqueue → recompute at correct as-of → append-only snapshot → material-delta detection → Today update → persisted explanation. Worked examples (verified fact→propensity/evidence/timing/why-now; distributor contribution→route dims/score/recommendation/readiness; PAM accepts→readiness/today/team; closed-won→outcome/experiment/cohort/calibration) are locked into the dependency table.
- **R12 Event time ≠ knowledge time.** `occurred_at` vs `observed_at`/`recorded_at` preserved through E; an as-of reconstruction uses only what was known then (the Aug-1 transaction contributed Aug-12 must not appear in an Aug-5 reconstruction).
- **R13 Recompute never rewrites history.** Every recalculation is versioned append-only. "What did PursuitOS believe on July 17 given only July-17 knowledge?" must remain answerable. No silent mutation of historical snapshots.
- **R22 Materiality suppression (versioned).** No Today item for `propensity 68→69`; **yes** for band change, route-recommendation change, required-participant decline, timing-anchor appearance, contradiction, opportunity close, value-threshold crossing, consent revocation. Materiality rules carry a version.
- **R23 Action-loop guards.** Track `originating_event`, `causation_id`, `correlation_id`, actor, invocation, recompute request, resulting events; automated actions carry explicit recursion/loop guards to prevent action→event→recompute→action storms.
- **R36 "Unknown" is a legitimate commercial state** across federation/scoring/UI/recompute/experiments — never 0/false/low/negative/absence. Preserved end to end.
- **R37 System-version lineage** on every learning-critical output: fact-policy, score-model, route-model, disclosure-policy, entity-resolution, skill, attribution, experiment versions. Without it, backtesting is unreliable.

## G. Outcomes, attribution, experiments, overrides (R14, R15, R16, R17)
- **R14 Event-rich outcomes.** `pursuit_outcomes` captures economically-meaningful intermediates (intro-accepted, seller-accepted, meeting-booked/completed, opportunity-created/qualified/progressed, deal-registered, quote-created, partner-accepted, technical-resource-engaged, customer-responded, renewal-retained, expansion-created, closed-won/lost, dormant, disqualified) — frequent intermediate signal while final revenue stays sparse.
- **R15 Outcome ≠ attribution.** Separate `attribution` object: classes `SOURCE, INFLUENCED, ASSISTED, OBSERVED, UNKNOWN` (fractional policies later), each with policy/version, reason, evidence, `calculated_at`, human override. Marketing-style attribution never contaminates the factual Outcome.
- **R16 Experiments retain intervention history:** treatment/intervention, eligible population, assigned cohort, timestamps, **intelligence state before intervention**, recommendation, human decision, actions taken, outcome (recommended-CDW vs overridden-WWT; distributor-signal present/absent; intro vs no-intro; action-within-24h vs delayed).
- **R17 Human overrides are first-class supervision observations** (not mere audit): recommended value + confidence + alternatives + human choice + override category + reason + actor role + outcome + whether the system later converged. Enables "when experienced channel execs override, are they usually right?"

## H. Entity resolution, org graph, identity (R18, R19)
- **R18 Org-scoped, federation-aware resolution.** An org may assert "our internal account X = canonical company Y" **without overwriting another org's source-specific identity record**. Maintain source identity → candidate canonical → resolution, with provenance. One tenant's dirty CRM never globally poisons the company graph.
- **R19 Organization graph as strategic infrastructure.** The Org/Commercial/Evidence/Relationship/Transaction/Execution/Outcome graphs get **stable IDs + explicit edge semantics** in Postgres (no new graph DB now) so they can be coherently projected/analyzed later.

## I. UX freeze & trust-not-complexity (R31, R32, R33)
- **R31 D.5 UX freeze holds.** No global redesign in E. New federation/execution UI is native to the D.5 token/component system (dark navy rail; Ecosystem→Outreach→Intelligence→Execution→Revenue IA; Pursuits first-class; tinted Bentos; hairlines; semantic dimension colors; quiet demo badge; light-mode primary; mobile decision-first).
- **R32 Federation UI reveals trust, not complexity.** Show participating orgs, what's shared vs internal, who granted access, and purpose. Hide policy-engine internals, grant IDs, ACL matrices, DB concepts, provider mechanics (Admin/debug only).
- **R33 Product narrative preserved:** Observe → Establish truth → Form Pursuits → Decide → Coordinate → Execute → Observe outcome → Learn — visible in architecture, docs, and GTM language.

## J. Honesty & production safety (R35, R40, R42)
- **R40 No "self-learning AI" claim.** Correct language: PursuitOS *captures* structured outcomes/decisions/history so policies *can be evaluated and progressively calibrated*; automated calibration comes later with real design-partner data. No fake intelligence from synthetic results.
- **R42 Production safety (unchanged, release-blocking):** no production backfill; no real TD SYNNEX data; no live cross-tenant action; no unapproved provider writes; all federation/action flags default OFF; synthetic/demo data clearly labeled; dry-run first on any migration affecting existing data; cross-tenant RLS remains a release blocker.

## K. Security invariants — add inference-attack tests (R27)
Extend the T1–T10 register with **T11 inference resistance**: the attacker who cannot read a value directly must not trivially reconstruct it via count differences, existence/non-existence, sorting, route-score deltas, error behavior, timing behavior, hidden association rows, or tiny-cohort aggregates. No sophisticated privacy math now; sensitive raw values must not be trivially reconstructable from derived outputs.

## L. Definition of Done — LOCKED as a permanent regression scenario (R38, R39)
The §2.16 closed loop becomes a **permanent** regression scenario (not a one-time E test):
> shared Pursuit → caller-specific disclosure → human decision → governed action → audited state transition → interaction/outcome → event → recomputation → changed Pursuit intelligence → changed Today,
with tenant isolation, disclosure absence, consent enforcement, as-of correctness, provenance, recommendation/decision separation, and immutable history all held.

**R39 Adverse-path hero scenario (added, required):** CDW recommended → TD SYNNEX context supports CDW → route approved → required CDW resource **declines** → readiness falls → event triggers recompute → alternate route becomes materially better → Today surfaces "Route reconsideration required" → human selects alternate → previous route preserved historically → outcome eventually lands → learning records the entire sequence. Proves PursuitOS is an operating system reacting to changing commercial reality, not a static recommender. Both the happy-path and adverse-path scenarios ship in the E blind suite.

---

## Phase 3 dependency-ordered execution (LOCKED)
`E3-A` Federation identity + participation (participants, extensible roles, `can_see_pursuit`, room projection) → `E3-B` Consent + disclosure (grants w/ purpose limitation + two-dimension classes, caller-specific serialization, T1–T11 invariants) → `E3-C` Context contributions (the provenance object + modes) → `E3-D` Governed Skill boundary (registry, authority incl. action-vs-data-consent, dispatch, invocation, outbox/receipt boundary, audit) → `E3-E` Event/recompute engine (dependency map, idempotent jobs, as-of propagation, versioned materiality, loop guards) → `E3-F` Outcomes + intermediate outcomes + attribution + experiments + intervention history → `E3-G` Federation-aware entity resolution + provider contract hardening → `E3-H` Closed-loop integration + UX (happy-path + adverse-path).
After every sub-phase: targeted blind harness · RLS test · tsc · migration verification · production-flag-OFF confirmation · no production backfill · committed audit artifact. Then the full E blind suite (both hero scenarios).

**APPROVED. Proceeding to Phase 3 E3-A.**
