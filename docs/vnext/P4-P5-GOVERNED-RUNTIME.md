# PursuitOS vNext — P4 / P5 Governed Pursuit Runtime

**Status:** **P45-1 IMPLEMENTED LOCALLY / NOT PUSHED** (2026-09-16) · migration **0109** · flag default **OFF** ·
45/45 slice proof · no external sending · Slice 2 **not started**.

This is the architecture record for the amended roadmap's P4 (AI Control Plane) and P5 (Pursuit
Runtime). It begins after H1 closed and Gate 9 accepted pilot readiness.

---

## 1. What already existed (and is therefore NOT re-modelled)

The design gate's most consequential finding was that most of the control plane was already built
and certified. P45-1 consumes it rather than duplicating it.

| Concern | Owner | Status |
|---|---|---|
| **WHAT capability may be invoked** | `governed_skills` — 18 rows, versioned, with `effect_class`, `eligible_actors`, `required_permission`, `input_schema`, `preconditions`, `approval_required`, `idempotent`, `retry_policy`, `compensation_skill_id` | **EXISTED** |
| **The consequential-action boundary** | `dispatchSkill` — idempotency replay, actor eligibility, role rank, loop guard, preconditions, cross-tenant consent authority, outbox routing, SAVEPOINT-isolated handlers | **EXISTED** |
| **Single-action execution** | `governed_action_invocations` → `action_outbox` → executor → `action_receipts`: retry classification, bounded backoff, dead-letter, per-skill compensation, revocation re-check, simulated executor for non-PRODUCTION | **EXISTED** |
| **The unified event model** | `change_ledger` — actor, trigger, materiality, before/after, `model_version`, `agent_run_id` | **EXISTED** |
| **WHO or WHAT may act** | — | **MISSING → added by 0109** |
| **A durable, resumable RUN** | — | **MISSING → added by 0109** |

**Effect classes, already taxonomised and unchanged:** `READ` · `INTERNAL_WRITE` ·
`CROSS_TENANT_ACTION` · `EXTERNAL_ACTION`. An action is *consequential* when it is not `READ`.

---

## 2. The three questions

- **P3 — what should happen.** `pursuit_goals` → `pursuit_plans` → `pursuit_plan_revisions`
  (`content.milestones` carry declarative completion **rules**, so progress is computed from
  canonical state, never typed).
- **P4 — who or what may do it, with which capability.** `governed_actors` +
  `actor_capability_grants` + the existing `governed_skills`.
- **P5 — what is happening now, what happened, what is next, how to resume.** `pursuit_runs` +
  `pursuit_run_steps`.

**P5 reads P3 and never writes it.** Not `pursuit_plans`, not `pursuit_plan_revisions`, not
`pursuit_goals`, not `basis_fingerprint`, and never a milestone — milestone completion stays derived.

---

## 3. Naming and identity decisions

**`governed_actors`, not `runtime_actors`** (owner ruling 1). P4 identity exists independently of any
one runtime; P5 references the governed identity. An actor is *not* "an agent": `USER`, `AGENT`,
`WORKER` and `SYSTEM` share one identity space, or policy fragments across four vocabularies.

**`principal_user_id` carries NO foreign key — a reported, deliberate divergence.** The certified
world has **no populated user identity**: `auth.users` is empty, `org_members` is empty, and
`resolve_user_org(null)` falls back to the oldest organization (the demo/Basic-Auth posture). Every
existing actor column already reflects that and carries no FK — `change_ledger.actor_id`,
`governed_action_invocations.actor_id`, `pursuit_plan_revisions.actor_id`,
`pursuit_goals.proposed_by_actor_id`. A `references auth.users(id)` would have made it **impossible
to create a USER governed actor in the certified pilot world**. Adding the FK later is a one-line
additive migration once `auth.users` is populated.

Identity is still enforced where it can be: a **database CHECK** refuses a `USER` actor that is
`ACTIVE` without a principal, and `dispatchSkill` refuses when the actor's principal does not match
the acting user. `owner_user_id` is *governance ownership* and is never accepted as identity.

**Cross-org references — the repository has no composite-FK convention.** There are **zero**
composite foreign keys across all 155 certified tables; the certified pattern is single-column FK +
RLS(FORCE) + an explicit org-scoped guard in the write path. 0109 follows that pattern for references
to existing tables **and additionally** applies composite `(org_id, id)` keys *within the new
subsystem only*, where no convention is being retrofitted. The result is the stated goal, enforced
relationally before RLS is consulted: a Vertex row cannot reference a Meridian actor or run.

---

## 4. Migration 0109 — what it adds

Four tables — `governed_actors`, `actor_capability_grants`, `pursuit_runs`, `pursuit_run_steps` —
plus additive nullable columns: `run_id`, `run_step_id`, `invocation_id`, `governed_actor_id` on
`change_ledger`, and `governed_actor_id`, `run_step_id` on `governed_action_invocations`.

**`change_ledger.actor_id` is NOT touched or reinterpreted.** `governed_actor_id` is a distinct
additive column resolving to the new registry; the pre-existing free-uuid contract is preserved
exactly.

**Ledger vocabulary extended, every prior value kept** (the 0103 §5 pattern): `RUN_STARTED`,
`RUN_PAUSED`, `RUN_RESUMED`, `RUN_COMPLETED`, `RUN_FAILED`, `RUN_BLOCKED`, `RUN_CANCELLED`.
`trigger_type` is **not** extended — a runtime transition is triggered by the existing
`GOVERNED_ACTION`, and inventing a second word for one concept would be a mistake.

**Least privilege.** 0058's `alter default privileges` hands `app_rw` full DML on every *new* table,
so 0109 explicitly revokes UPDATE/DELETE and re-grants column by column: an actor's identity is
immutable and only its lifecycle moves; a grant is created and revoked, never edited into a different
capability; a run's pin is immutable; a step's `skill_id`/`args`/`idempotency_key` are fixed at
creation, which is what makes a replay provably the *same* step.

**RLS ENABLE + FORCE** on all four, policy `is_org_member(org_id)` for `app_rw`.
**No SECURITY DEFINER function** — the protected class stays **31 / 0**. No CASCADE beyond the
standard org/pursuit ownership. No backfill. Idempotent and safely re-appliable.

---

## 5. Enforcement — `dispatchSkill` remains the only boundary

The grant check is **strictly additive** and engages only when a caller names a governed actor, so
every pre-existing caller is evaluated exactly as before. It can **reject, never permit**, and is
ordered *after* eligibility and permission so a grant cannot rescue an actor type or role the
registry already refused.

Before a Slice-1 invocation executes: the governed actor exists · in the same org · lifecycle
`ACTIVE` · the USER principal matches the acting user · a live `actor_capability_grant` exists · and
then every pre-existing check — `eligible_actors`, `required_permission`, loop guard, preconditions,
cross-tenant consent authority, send gates and data-environment rules.

> **A grant permits consideration. It does not override policy.** Proven: a grant-holding actor
> acting as `viewer` is still refused for lack of the `operator` permission.

---

## 6. Runtime semantics

**The pin (owner ruling 5).** A run is bound to its `plan_revision_id` and the `basis_fingerprint`
captured at start, **forever**. If a newer DECISION supersedes it, the run becomes `CANCELLED` with
reason `PLAN_SUPERSEDED`. It is never retargeted — a different decision deserves a different run.
Cancellation does **not** undo an effect that already completed; the runtime has no authority to
invent a compensation the registry did not declare.

**Resumability.** No in-memory continuation is authoritative. `RUNNING` + attempt + `idempotency_key`
+ `started_at` are persisted **before** dispatch; invocation, result/error, failure class and
terminal status **after**. Recovery is a query, so a crash between the two is safe: re-dispatch
replays the existing invocation for that key rather than acting twice.

**Idempotency — the honest invariant.** Not distributed exactly-once. It is
**at-most-once per (run, step, attempt-identity), de-duplicated durably at both the decision and
transport layers**, with a step key deterministic over `(run, seq, skill, version, canonicalised
args)`. Argument canonicalisation matters: without it, key order alone would turn a replay into a
second consequential action.

**States.** `PENDING · READY · RUNNING · WAITING_FOR_APPROVAL · BLOCKED · PAUSED ·
RETRYABLE_FAILURE · TERMINAL_FAILURE · COMPLETED · CANCELLED`. Slice 1 exercises all but
`WAITING_FOR_APPROVAL`, which is Slice 2's first-class user workflow. A governance REJECTION maps to
`BLOCKED`, not to a retry — retrying would produce the same answer and burn the budget.

---

## 7. Execution model — request-triggered only

**The worker drain is deliberately NOT wired** (owner ruling 6). The existing worker runs on the
**owner pool**, which bypasses RLS; making that the runtime's execution identity would hand ambient
mutation authority to a background process — precisely the posture H1 spent eight gates removing.

Slice 1 executes under **`app_rw` + `withTenant(orgId)`**, using the authenticated org context a
request already carries. No owner-pool shortcut anywhere in the runtime.

> **Recorded for a future slice, not implemented:** a worker will need a **two-stage** model —
> (1) a narrowly scoped discovery/coordinator identifies which org has due work; (2) execution for
> that org runs under `app_rw` + `withTenant(orgId)`. The owner connection may not become ambient
> mutation authority for runtime execution. This gets its own design and implementation slice
> **before** worker activation.

---

## 8. Feature flags — double-gated, default OFF

`VNEXT_CONTROL_PLANE_ENABLED` (deployment) **and** `org_features.governed_action` (per org). No new
flag was created; the `control_plane` slot already existed, plumbed and unconsumed.

**The per-org column is read directly, not via `governedActionEnabledFor()` — a deliberate
decision.** That helper returns the tail of a dependency chain (`governedAction` requires
`federation`, which requires `experience`, which requires `pursuits && facts && routing &&
pursuit_experience`, each additionally env-gated). It is right for the **federation surface**, which
cannot render without the pursuit experience beneath it. It is wrong for the runtime: `control_plane`
is documented in `vnext-flags.ts` as *"backend-only and deliberately independent of experience — it
is infrastructure, not a pursuit surface"*, so routing execution through that chain would contradict
the flag's own design and make backend execution depend on which UI surfaces an org happens to have
enabled. **When a later slice exposes the runtime on a pursuit surface, that surface must apply its
own tenant gate — a read-model gate is not an execution gate, and vice versa.**

With either flag off the runtime is inert: no table is read, no row is written, and no existing
surface changes. **No application surface reads the runtime tables at all in Slice 1** — the proof is
a service entry point (`src/lib/runtime/entry.ts`), not a console. Display is deferred to Slice 2,
per the gate's "correctness > demo decoration".

---

## 9. What Slice 1 proves — `p45-runtime`, 45/45

Happy path end to end (run → step → invocation → **one** draft touch → ledger → `COMPLETED`) ·
registry semantics unbent (`draft_campaign_touch` is still `INTERNAL_WRITE`, idempotent,
USER-eligible, so dispatch can never route it to the outbox) · the invocation traces back to actor
**and** step · `RUN_STARTED → RUN_COMPLETED` in `change_ledger` with no parallel log · replay returns
the same run and creates **no** duplicate draft · a missing/revoked grant and a `SUSPENDED` actor both
refuse and create nothing · a grant cannot override `required_permission` · a USER actor cannot be
ACTIVE without a principal (DB constraint) · cross-org grant and run references refused
**relationally** by the composite keys · pause genuinely stops execution, resume continues from
durable state, both are first-class ledger transitions · backoff honoured, retry bounded, the **same**
step identity reused, exactly one effect rather than one per attempt, exhaustion terminal · a run
interrupted mid-dispatch recovers from the database alone without double-executing · a superseded pin
is `CANCELLED` as `PLAN_SUPERSEDED`, not retargeted, and terminal · `app_rw` sees zero runs with no
context and only its own under context · the feature gate defaults OFF and both flags are required ·
**send surfaces 0/0/0/0/0**.

---

## 10. Explicitly NOT built

Multi-provider agent marketplace · autonomous AGENT execution · approval workflow (Slice 2) ·
multi-step plans / DAG (Slice 3, and the only genuine P3 change proposed) · worker drain ·
model routing, prompt storage, eval criteria, cost budgets, actor delegation · policy-expression
language · external sending · P8 learning engine · P9 playbooks · P10 settlement · Dynamic Pursuit
Surfaces · broad UI redesign.

`actor_capability_grants.approval_required_override` exists **nullable and unused**, solely so Slice 2
needs no migration against a table that will already hold live grants. Slice 1 reads
`approval_required` from `governed_skills` and ignores the column entirely.
