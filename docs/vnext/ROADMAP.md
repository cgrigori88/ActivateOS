# PursuitOS vNext — Roadmap

**Status:** canonical. This file is the product direction of record for the vNext lane.
**Lane:** `roadmap/pursuitos-vnext` (see `SESSION-HANDOFF.md` for live state).

---

## Product thesis

PursuitOS is evolving toward a **shared commercial world model between companies**.

It should understand:

- what each company independently knows,
- what companies learn through collaboration,
- the target/end-user companies they pursue together,
- the signals, evidence, interactions, decisions, commitments, and actions generated around those pursuits,
- what happened over time,
- what actions contributed to outcomes,
- and how the system can continuously learn to make the next pursuit better.

## The long-term loop

```
OBSERVE → UNDERSTAND → RECOMMEND → ACT → MEASURE → LEARN → IMPROVE → REPEAT
```

Every roadmap phase below exists to close one more link of that loop, and to close
it with evidence rather than narrative.

---

## THIS IS ADDITIVE, NOT A REBUILD

Read this before planning any work in this lane.

The existing PursuitOS application is the product. These phases are **architectural
phases, not instructions to rebuild the application phase-by-phase.** There is no
"vNext app". There is one app that progressively becomes smarter by consuming new
primitives underneath the surfaces users already know: Today, Pipeline, Pursuit
Detail, Approvals, Activity, Partner View, and command/search.

Concretely, that means:

- **No horizontal phase completion.** We do not finish all of P0, then all of P1.
  We cut vertical slices that each deliver one visible improvement end to end.
- **New primitives land underneath existing surfaces**, not beside them as new rooms.
- **Nothing existing gets replaced to make room.** Governance invariants, synthetic-demo
  protections, disclosure behaviour, recommendation-vs-decision semantics, and
  approvals/activity behaviour are preserved as-is.
- **A great deal already exists.** The Session 0 audit found mature substrate for
  much of P0–P2 (see `BUILD-PLAN.md` §"What already exists"). Assume a capability
  is partially built until the code says otherwise.

---

## Phases

### P0 — Canonical Commercial Foundation
Organizations, people, accounts, products, sellers, partners, opportunities, motions,
campaigns, entity resolution, aliases, provenance.

### P1 — Living Pursuit Context
Pursuit object, facts, evidence, signals, interactions, permissions, freshness,
conflicts, Context Health, Pursuit State Engine, Pursuit Memory.

### P2 — Pursuit Intelligence
Pertinence Engine, multidimensional scoring, product/account propensity, partner fit,
relationship strength, execution readiness, partner/route selection, *Why this pursuit?*,
*Why now?*, *What's missing?*

### P3 — Pursuit Coordination
Pursuit Teams, recommended motions, commitments, owners, milestones, Today integration —
organised as **Pursuit Goal → Pursuit Plan → Motion → Action**, not as isolated
next-best-action recommendations. *(Amended 2026-09-14.)*

The Pursuit Plan is a durable, evolvable object. Over time it must support:

- milestones and dependencies between them,
- plan progress, computed from canonical state rather than typed,
- course correction — new evidence makes an approved plan **reviewable**, never silently rewritten,
- human changes and overrides, preserved alongside what was recommended,
- new evidence causing plan review, with the reason recorded.

First vertical cut: Slice 2A (`BUILD-PLAN.md`), decisions D-024…D-033 — DEMO CERTIFIED / FROZEN.
Second: Slice 2B, the ATTENTION portion of the loop (WHAT MATTERS NOW → GOAL → PLAN → MOTION →
ACTION → **ATTENTION** → EXECUTION → NEW EVIDENCE → PLAN REVIEW). Today becomes the decision /
attention layer over the same plan primitives the Queue executes. Attention is derived, never
stored (D-034…D-042) — **DEMO CERTIFIED / FROZEN** after hosted human review (D-046).

> **One account may contain multiple independent pursuits. Today composes one card per PURSUIT,
> not per account.**

**Pre-pilot hardening gate (H1) — before any further product slice.** H1A: every data path
explicitly tenant-scoped, and certification can no longer change the world it certifies (D-043,
D-044). H1B: the web runtime moves to the least-privilege `app_rw` role so RLS binds (D-045,
design only). H1 is complete only when H1B passes hosted certification.
`H1-PRE-PILOT-HARDENING.md`.

### P4 — AI Control Plane
Agent/Skill Registry, identities, versions, model routing, scopes, capabilities,
permissions, lifecycle, observability, cost tracking, evaluation criteria.

### P5 — Pursuit Runtime
Governed domain actions, deterministic controls, approvals, execution policies,
audit events, run ledger, APIs/MCP. *(Amended 2026-09-14:)* long-horizon execution,
resumable runs against **durable plans** (a run resumes a Pursuit Plan by its stable id
across days or weeks), stateful continuation, dynamic steering — with governed domain
actions reserved for consequential execution. P3 plans are the thing a runtime runs;
P5 must consume them, not re-model them.

### P6 — Intercompany Governance
Consent, disclosure controls, organization boundaries, provenance restrictions,
effective-policy computation, private/shared/derived context.

### P7 — Pursuit Analysis
GO TO / SHOW ME / EXPLAIN / ANALYZE, deterministic portfolio computation, semantic
metrics, cohort/query engine, Dynamic Pursuit Surfaces.

**Dynamic Pursuit Surfaces** means users can ask for task-specific live views such as:

> "Show me the 20 RHEL virtualization pursuits that need CDW seller validation this week."

These surfaces may compose canonical data, metrics, and governed domain actions, but
**MUST NOT invent their own**:

- data model,
- permissions,
- metrics,
- state mutation,
- or write behaviour.

### P8 — Learning System
Prediction snapshots, recommendation history, human decisions, overrides, actions,
outcomes, causal memory, evaluation, cohort analysis. *(Amended 2026-09-14:)* explicitly
including **action sequencing**, **timing effectiveness**, and **human-vs-agent decision
quality** — which is why P3 records recommendation, recommendation time, evidence basis,
human decision, override, action selected and eventual status as separate, append-only
facts from its first slice.

### P9 — Ecosystem Intelligence
Privacy-safe generalized learning, benchmarking, reusable commercial patterns/playbooks,
network intelligence. *(Amended 2026-09-14:)* including reusable **Pursuit Playbooks**
learned from winning and losing intercompany motions — i.e. generalised Pursuit Plans. A
playbook is a plan shape with evidence behind it, so P3's plan structure (milestones,
dependencies, motion, action, outcome) is the unit P9 will generalise.

### P10 — Attribution, Reconciliation & Settlement
Contribution tracking, influence attribution, revenue attribution, reconciliation,
incentives/economics, eventual settlement.

---

## How the loop maps onto the phases

| Loop stage | Primary phases |
|---|---|
| OBSERVE | P0, P1 |
| UNDERSTAND | P1, P2 |
| RECOMMEND | P2, P3 |
| ACT | P3, P5 |
| MEASURE | P5, P8 |
| LEARN | P8, P9 |
| IMPROVE | P2, P9, P10 |

P4 (Control Plane) and P6 (Governance) are cross-cutting: they constrain *how* every
other stage is allowed to operate rather than occupying a stage of their own.
