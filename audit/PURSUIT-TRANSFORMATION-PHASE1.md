# Pursuit Transformation — PHASE 1: DEEP MAPPING

> Architect discipline (foreman): map the graph first, design second, execute in
> atomic verified increments, never trust narration. **This document is Phase 1
> only. No code is written until the Phase 2 Technical Design Document is signed
> off.** Source directive: the 28-part "PursuitOS Pre-Demo Transformation
> Directive." Current platform state: see `docs/PLATFORM-CAPABILITIES.md`.

---

## 1. The reframe, stated precisely

**Today** the app's implicit organizing object is the **Account** (companies), with
Motions, Opportunities, Campaigns, and Scores hanging off it as siblings.

**Target:** a first-class **Pursuit** — `Account × Product × (Partner, Seller,
Motion, Time)` — becomes the canonical commercial object. Everything else reparents
under it or references it:

```
ACCOUNT → POTENTIAL NEED → PURSUIT → MOTION → ACTIVATION → INTERACTION → CRM OPPTY → OUTCOME
```

**The central invariant** (the North Star, Part XXVIII): every object, score,
agent, and surface must help *determine, explain, coordinate, advance, or learn
from a Pursuit* — and must do so with **preserved provenance and deterministic
explainability** (no black-box score, no invented commercial truth), under the
**existing security invariants** (RLS/app_rw, consent ladder, audit) which may not
be weakened for the demo.

---

## 2. Biggest finding — the proto-Pursuit already exists

The graph already contains the skeleton of a Pursuit; it just isn't first-class:

| Directive concept | Already in the schema/code today |
|---|---|
| Pursuit = Account × Product × Partner × Seller | `pursuit_teams` (org, company_id, taxonomy_node_id, partner_id, seller_id, partner_fit_id, **status: recommended/accepted/declined/superseded**, reason) — migration 0007 |
| Partner Fit as a score (§13) | `partner_fit_scores` + `partner_fit_features` + `partner_capabilities` (Phase-2 ecosystem) |
| Pursuit Team + acceptance (§15–16) | `pursuit_teams.status` lifecycle + `ecosystem/teams.ts` assembly |
| Next-best action (§28) | `portfolio/next-best.ts` |
| Motion as strategy (§2) | `revenue_motions` + `motion_designer` agent |
| Propensity, features, versions (§3–4) | `propensity_scores`, `score_features`, `score_versions` |
| Evidence w/ status (§8–9) | `evidence` (verified/quarantined/rejected, source_type, provider_id, first_party, computed_confidence) + contradiction detection |
| Signals + time-to-event (§6) | `signals` (typed, canonical) + time-to-event relevance |
| Joint pursuit room / settlement / warm intro | `joint_pursuits`, settlement ledger, `warm_intro_requests` |

**Implication:** the transformation is primarily **(a) introduce an explicit
`pursuits` table that the routing artifact `pursuit_teams` becomes a child of, (b)
lift scoring from one propensity number to the multi-dimensional set, (c) add the
three genuinely-new substrates — Facts, Interactions, Relationships, (d) reparent
Motion/Campaign/Opportunity references onto `pursuit_id`, and (e) rebuild the UX
around it.** That is a large but *bounded* program, not a rewrite.

---

## 3. Current substrate → target: REUSE / EXTEND / NET-NEW

**REUSE as-is (reference from Pursuit):** companies (account), products,
taxonomy_nodes (product category), partners, sellers, evidence, signals,
propensity_scores, partner_fit_scores/features, partner_capabilities,
seller_account_relationships, partner_relationships, revenue_motions,
opportunities, campaigns, messages/threads, provider_runs, research_jobs,
agent_runs, joint_pursuits, settlement, warm_intro_requests, guest seats, RLS
stack, MCP server.

**EXTEND (add columns / formalize):**
- `pursuit_teams` → becomes a child of `pursuits` (add `pursuit_id`; keep routing
  features). Team-member acceptance states (§16) generalize its status enum.
- `evidence` → add `provenance_type` (typed provenance, §9 = roadmap O-4).
- Scoring → add the multi-dimensional scores + persisted per-feature contributions
  (§3–4) alongside existing `score_features`/`score_versions`.
- `revenue_motions` → structured-object-first (§2): the Motion Designer emits the
  structured Motion, narrative derived after; add `pursuit_id`.
- `opportunities`, `campaigns` → add `pursuit_id` linkage (§30, §32).
- Admin observability → extend to operational dashboard + demo-readiness (§51–52).
- Provider abstraction → add `DISTRIBUTOR_TRANSACTION` provider_type + interaction
  providers (§17, §20) without coupling to any vendor.

**NET-NEW tables/subsystems (confirmed missing):**
- `pursuits` (the canonical object) + status lifecycle.
- `facts` (durable belief w/ supersession + freshness, §8, §10).
- `interactions` (§20) + Google/Microsoft provider adapters (§21–22).
- `relationships` (generalized actor↔actor edge, §25).
- `change_ledger` (universal material-change record, §11–12).
- `pursuit_actions` / NBA lifecycle formalized (§28–29).
- `capability_registry` / Pursuit Skills over the existing MCP tools (§34–37).
- `pursuit_policy` explicit authorization functions (§38) layered over RLS.
- `surface_router` events + routing (§41–42).
- `experiments`/`cohorts`/`outcomes` + backtest import (§48–50).
- CRM adapter (`crm_provider`, Salesforce) + canonical↔external ID map (§32–33).
- Automated cross-tenant regression suite (§40) + demo-readiness check (§51).

---

## 4. The reparenting (what "canonical" changes)

```
                       ┌─────────── pursuits (NEW) ───────────┐
account (companies) ── │ status · scores · why_now · value    │
product ──────────────▶│ primary_partner · seller · team      │
                       └──┬───────┬────────┬────────┬─────────┘
                          │       │        │        │
                    pursuit_teams │   revenue_motions│  campaigns
                    (EXTEND +pid) │   (EXTEND +pid)   │ (EXTEND +pid)
                          │       │        │
                     opportunities (EXTEND +pid) ──▶ outcomes (NEW)
```

Facts, Interactions, Relationships, Signals, Evidence all attach to
`pursuit_id` and/or `account_id`; the Change Ledger records material deltas on any
of them.

---

## 5. Ripple map — what recentering touches

Introducing a canonical object that sits *above* Opportunity ripples widely:
- **RLS:** `pursuits` and every new table need `org_id` + an `_rw` policy (per the
  0058 data-driven pattern); cross-tenant pursuit objects (if a pursuit spans a
  partnership) need partnership-scoped policies (0060 pattern). **This is the #1
  security-invariant touch point** — every new table is a potential leak if
  policied wrong. The automated cross-tenant suite (§40) becomes mandatory.
- **Scoring/worker:** the refresh runner must (re)compute multi-dim scores + write
  the change ledger + fire material-change events.
- **Agents/MCP:** the 10 MCP tools become Skills with side-effect classes; new
  Pursuit skills (`discover_pursuits`, `explain_pursuit`, …) wrap existing logic.
  Agent prompt isolation (§66) must pass org/user/role/pursuit scope explicitly.
- **Every room:** primary nav reframes (Today, Ask, Pursuits, Ecosystem, Campaigns,
  Pipeline, Insights); existing rooms become secondary. New Pursuits list + the
  canonical Pursuit detail page (the "best page in the product").
- **Demo data:** a dedicated demo tenant with a seeded full lifecycle + 3 hero
  pursuits; every displayed fact must be pristine (§56–60).
- **Exports/comms/CRM:** Salesforce adapter + canonical ID map.

---

## 6. Workstream dependency graph + critical path to the Demo DoD

The directive's Definition of Done (Part XXVII) is a **25-step single demo path**.
That path — not the 70 items — is the true gate. Mapping the DoD to workstreams:

```
A Domain model (pursuits, lifecycle, motion reparent, team, multi-dim score, change ledger)
        │  ← foundational; everything depends on it
        ▼
B Intelligence (facts, provenance, freshness/supersession, contradiction, convergence, Why Now)
        │
        ├────────────▼
        │        C Routing (partner fit score, seller fit, team reco, distributor abstraction)
        ▼                    │
D UX (Pursuits nav/list/detail, Today, Ask) ◀────────────┘
        │
        ▼
E Operational loop (NBA, action + activation lifecycle, campaign/oppty/outcome linkage)
        │
        ▼
F Proof (experiment/cohort tables, backtest import, calibration/Insights)   ← demo can show simulated-marked
H Agent platform (skill registry, MCP→capabilities, permissions/approvals)  ← needed for Ask + MCP parity
I Security/ops (RLS regression, cross-tenant suite, observability, demo-readiness, error handling, demo tenant)
        │  ← runs alongside ALL; gates the demo
G Integration (interaction base model, Gmail/Calendar, Salesforce, surface router)
        │  ← ARCHITECT NOW; full impl is largely POST-demo (see §9)
```

**Critical path to a working demo:** A → B → C → D → E, with H (enough for Ask/MCP)
and I (security + demo tenant + graceful failure) in parallel. F is "show the
learning loop with clearly-marked simulated calibration." G is scaffolded.

---

## 7. Decisions that need your call BEFORE Phase 2 design

A foreman surfaces forks rather than assuming. These change the design materially:

1. **Demo date & realistic scope.** The single biggest risk. The full 70-item
   directive is a multi-team, multi-week program; a clean, secure, operational
   build of the *demo critical path* (A→E + I) is itself substantial. **What is the
   demo date, and do you want (a) the full Pursuit spine working end-to-end on the
   demo tenant with integrations scaffolded, or (b) a broader but shallower build?**
   My strong recommendation: **(a)** — depth on the Pursuit loop, integrations as
   clean architecture. The directive's own "build architecture now, implement
   later" language (interaction, distributor, surface router) supports this.

2. **Score honesty framing.** The directive both wants numeric scores (priority 88)
   and forbids fake precision ("87% chance to buy"). Proposed resolution:
   deterministic, explainable, **versioned** scores with persisted per-feature
   contributions, labeled as *directional model v0* (e.g., "Pursuit Priority 88 —
   directional, not calibrated") until backtest calibration exists. **Confirm this
   framing** — it shapes every score surface and the Insights story.

3. **Demo entities.** Real public companies (Red Hat / CDW / a synthetic "Initech")
   with verified public facts, vs. fully synthetic. Directive permits real public
   facts with verification + no confidential data. **Which named entities are
   sanctioned for the TD SYNNEX / Red Hat demo?** (Affects data QA, §56–60.)

4. **Interaction capture for the demo.** Live Gmail OAuth (real but risky/L-effort)
   vs. **seeded interactions in the demo tenant** (safe, deterministic) + the
   interaction base model + Google adapter scaffolded. Recommend seeded-for-demo,
   real-OAuth post-demo. **Confirm.**

5. **Prod-vs-demo strategy.** Prod now runs real data under app_rw. Proposed:
   build the whole transformation behind migrations that are **additive and inert**
   to existing prod rooms (same discipline as the RLS cutover), and run the *demo*
   from a **dedicated demo tenant** — so nothing risks the live prod tenant.
   **Confirm** we build additively + demo from a separate tenant.

6. **Execution cadence.** This is a program, not a single change. Proposed: execute
   **workstream by workstream**, each as its own Phase 2 (design) → Phase 3
   (atomic build) → Phase 4 (blind verify) → your sign-off, starting with
   Workstream A. **Confirm** you want it gated per workstream (vs. one giant PR).

---

## 8. Risk register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Scope vs. demo timeline** — 70 items can't all ship cleanly pre-demo | High | Cut to the DoD critical path (A→E+I); scaffold G; §9 tiers |
| R2 | **New tables leak cross-tenant** if policied wrong | High | Every new table gets an `_rw` policy + the automated cross-tenant suite (§40) as a release gate |
| R3 | **Fake precision** undermines the "verified" differentiator | High | Decision #2: versioned, explainable, directional scores; never "% will buy" uncalibrated |
| R4 | **Reparenting migration** breaks existing Motions/Opps in prod | Med | Additive migrations; `pursuit_id` nullable + backfill; demo from separate tenant |
| R5 | **Demo fragility** — a provider/LLM failure breaks the hero page | Med | Graceful failure + timeouts + cached verified state (§53–54); demo freeze (§55) |
| R6 | **Agent cross-tenant contamination** via prompts | High | Explicit per-invocation scope (§66); skill side-effect classes + approval (§36–37) |
| R7 | **Hallucinated demo facts** | High | Pristine data QA (§56); never demo quarantined/disputed as fact (§57) |

---

## 9. Proposed scope tiers (maps directive items to demo-criticality)

**Tier D — Demo-critical (must be LIVE end-to-end on the demo tenant):**
Pursuit model + lifecycle (1–2), Motion reparent structured-first (2), multi-dim
scoring + explainability (3–4), Why Now + convergence (5–6), Facts + provenance +
supersession + change ledger (8–12), Partner Fit + Seller Fit + Pursuit Team +
acceptance (13–16), Pursuits nav/list/detail + Today + Ask (43–47), NBA + action +
activation + campaign/oppty/outcome linkage (27–31), skill registry enough for
Ask/MCP parity + approvals (34–37), security invariants + cross-tenant suite +
demo-readiness + graceful failure + demo tenant + hero pursuits (39–40, 51–60,
65–68), terminology + buyer-surface language (69–70).

**Tier S — Architect now, partial/scaffold impl for demo:**
Distributor `TransactionSignalProvider` abstraction + normalized signals + purchase-
sequence scaffolding (17–19), Interaction base model + Gmail/Calendar adapter
(20–24) seeded for demo, Relationship + warm-intro paths (25–26), Surface Router
foundation (41–42), experiment/cohort/backtest/calibration marked-simulated (48–50).

**Tier P — Post-demo:**
Microsoft Graph (22), full live interaction OAuth at scale, Salesforce deep write-
back (32 read-first only for demo), capital-allocation destination.

---

## 10. Verification gates (Phase 4 targets for every workstream)

- `tsc --noEmit` clean; migrations apply cleanly on a fresh DB.
- **Cross-tenant regression suite (§40)** green: Tenant A ≠ Tenant B on every new
  table; counts-consent returns no names; named overlap reveals no contacts; MCP =
  UI permissions; no service-role bypass in the app path.
- The **25-step Demo DoD scenario** executes without manual intervention or a raw
  error, on the demo tenant.
- **demo-readiness** check (§51) passes: migrations, RLS tests, provider/job/agent/
  MCP/email/backup health, seed + demo-tenant integrity.

---

## 11. HALT — Phase 1 complete. Awaiting sign-off.

**Nothing is built yet.** Before I write the Phase 2 Technical Design Document
(schemas, exact file targets, data shapes) for **Workstream A — the Pursuit domain
model**, I need your answers to the six decisions in §7 (especially #1 demo date/
scope, #2 score honesty, #5 additive+demo-tenant, #6 per-workstream cadence).

On sign-off, Phase 2 for Workstream A will specify: the `pursuits` table + status
lifecycle, how `pursuit_teams`/`revenue_motions`/`opportunities`/`campaigns`
reparent, the multi-dimensional score tables + persisted contributions, and the
change-ledger schema — with exact migrations and file targets — and then halt again
for approval before any code.
