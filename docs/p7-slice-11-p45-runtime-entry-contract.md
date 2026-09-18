# P7 Slice 11 — P45 runtime entry and approval-bearing actions: discovery and contract

**Status:** **DISCOVERY ONLY — AND I AM RETURNING A STOP.** No implementation, no flag change, no DB
mutation was made. Decisions requiring a ruling are in §R. **Builds on:** Slices 1–10, all HOSTED
ACCEPTED / CLOSED. Slice 10 is not reopened.

> **A Dynamic Surface may let a human explicitly create a governed P45 operation. The surface does not
> execute, approve or authorize that operation; P45 owns its durable runtime, approval and continuation
> semantics.**

---

## 0. THE HEADLINE: there is no approval-bearing capability to integrate

You asked me to stop and say so if one did not exist. **It does not.** The approval *mechanism* is
implemented and looks carefully built — but **nothing is configured to use it**, and the substrate an
approval decision needs is empty.

Measured on hosted Preview (`mejokqxriwyawfhawuxu`), read-only:

| Evidence | Value |
|---|---|
| `governed_skills.approval_required = true` | **0 of 18 skills** — every registered capability is `false` |
| `governed_actors` | **0 rows** |
| `actor_capability_grants` | **0 rows** |
| `pursuit_runs` / `pursuit_run_steps` / `pursuit_run_approvals` | **0 / 0 / 0** |
| live (non-superseded) `DECISION` plan revision | **none** — see below |

**Approval is entirely data-driven.** `effectiveApprovalRequired(skillId, skillApprovalRequired,
override)` reads `governed_skills.approval_required` plus an optional
`actor_capability_grants.approval_required_override`. No skill is hard-coded to require approval, so
"the smallest existing approval-bearing capability" is **the empty set**.

**And the decision path cannot currently run at all.** `decide()` resolves the approver from a trusted
principal and then looks it up in `governed_actors`; with **zero** rows it raises
`NoTrustedPrincipalError` for every caller. Approval is unreachable in this environment regardless of
which capability were chosen.

**Nor is there a run to pin.** `startRun` requires `planId`, `planRevisionId` **and**
`governedActorId`, and refuses a revision unless `kind === "DECISION"`. Exactly one `DECISION`
revision exists (revision 2, `APPROVED`, on pursuit `8e5f5d34…` in the principal's org, which *is* a
governable P7 subject) — but supersession is `is_live_revision = no revision with a higher
revision_no exists`, and **revision 3 exists**. A run pinned to revision 2 would be **CANCELLED with
`PLAN_SUPERSEDED`** on its first advance.

**What this means.** A one-step approval-bearing vertical is not blocked by missing architecture — the
architecture is there. It is blocked by **five separate pieces of governance state that do not exist**,
and standing them up is a posture decision well outside P7:

1. a `governed_actors` row bound to the demo principal;
2. possibly an `actor_capability_grants` row;
3. **a skill whose `approval_required` is set to `true`** — which changes that skill's approval policy
   **everywhere it is used**, not merely on a surface;
4. a **live** `DECISION` plan revision to pin a run to;
5. `VNEXT_CONTROL_PLANE_ENABLED` turned on.

I have changed none of them. **(3) in particular is the one I most want ruled**, because it is the
difference between *demonstrating* approval and *inventing an approval requirement* — the thing you
explicitly told me not to do for `assemble_pursuit_team@1`, and the same objection applies to doing it
to any other skill purely to make a demo work.

---

## 1. The P45 runtime, as actually implemented

**Modules.** `src/lib/runtime/entry.ts` (gates + request-triggered entry points),
`src/lib/runtime/runtime.ts` (runs, programs, steps, resume, pin), `src/lib/runtime/approvals.ts`
(request/decide), with `dispatchSkill` in `src/lib/pursuits/federation/skills.ts` remaining the single
consequential boundary.

**Tables.** `pursuit_runs`, `pursuit_run_steps`, `pursuit_run_approvals`, `pursuit_plans`,
`pursuit_plan_revisions`, `governed_actors`, `actor_capability_grants`, `governed_skills`,
`governed_action_invocations`.

**The path.** decided plan revision → `startRun` (validates the revision is a `DECISION`, captures
`basis_fingerprint`, inserts the run **and its whole ordered program atomically**) → `resumeRun` →
lowest-seq step not `COMPLETED` → per-step approval policy → either park in `WAITING_FOR_APPROVAL` and
`requestApproval`, or dispatch → `dispatchSkill` → handler → step `COMPLETED` → audit.

**The standing invariants are real and I traced their enforcement rather than trusting the claim.**

> **Approval authorizes continuation. It does not confer authority.**

Enforced structurally: the approval gate is evaluated **immediately before** anything consequential,
and the comment is borne out by the code — *"the actor is pinned for the program, but a pinned identity
is not a pinned entitlement: eligibility, permission, the capability grant, the pin and the approval
policy are all re-evaluated per step."* An approval is recorded in `pursuit_run_approvals` keyed on
`(org_id, run_id, run_step_id)` and the gate asks the **step**, not the run — so an approval for step 2
cannot release step 3, explicitly to prevent that cascade.

> **One resume performs at most one consequential step.**

Enforced in **three layers**, which is what I checked rather than assuming: a `select … for update` row
lock making read-decide-write a critical section per run; a compare-and-set in `transitionRun`; and the
step's own idempotency key inside `dispatchSkill`. The code states the consequence precisely — *"even a
lost race produces a duplicate ATTEMPT, never a duplicate EFFECT."*

**Progress cannot skip.** It is defined as the lowest-seq step that is not `COMPLETED`, so a later
`PENDING` step is structurally unreachable while an earlier one is unresolved.

**The pin.** A run is bound forever to the revision that justified it; if that revision is superseded
the run is `CANCELLED` with `PLAN_SUPERSEDED` and is **never** retargeted.

**Explicit non-scope, from the runtime itself:** no DAG or parallel branches, no autonomous draining,
no compensation/rollback, no derivation of the program from the decided plan, and **no
`EXTERNAL_ACTION` steps**. The row lock is deliberately *not* a lease, and the code warns against
generalizing a DB transaction across a provider action.

## 2. Substrates stay explicit

`dispatchSkill` and the P45 runtime remain **two separate registered consequential substrates**. Slice
9 already records the substrate on every action capability (`substrate: "DISPATCH_SKILL"`), so a P45
action would declare its own and P7 would never choose an executor because "both are actions". No
generic action abstraction may erase that boundary.

## 3. Rendering still creates nothing

Unchanged and already proven twice hosted: `?surface=`, `?compose=`, headless assembly and React
rendering create **zero** P45 plans, runs, steps or approvals. Model composition may propose the
registered affordance and nothing else.

> **Rendering an operation is not creating an operation.**

## 4. What P45 already gives us for the deferred non-idempotency problem

This is the genuinely good news, and it answers the question Slices 9–10 deferred.

**Run identity hashes the whole canonical ordered program** — position, skill, version, args and
milestone key. Therefore: the **same program retried replays onto the same run**; the same steps in a
different order are a **different** program; and a different program offered while one is live is an
explicit **CONFLICT**, never a silent replay. A `pursuit_runs_one_live` constraint enforces one live
run per revision.

That is exactly the durable-operation semantic a non-idempotent action needs, and it is **already
implemented** — which is why the ruling to evaluate the non-idempotency problem *here* rather than
inventing a P7 key was right. P7 must not add a `(subject, capability)` key; the run **is** the
operation instance.

## 5. Approval UX — nothing to build

`/approvals` **already exists** (`src/app/approvals/page.tsx` + `actions.ts`): what is waiting, on which
pursuit, what it would do, who asked, why a human is needed, and approve/reject wired to `decide()`.
It reads the same `pendingApprovals` model as Pursuit detail — *"one representation of the state, not
two that can disagree"* — and is itself gated on `control_plane` plus `org_features.governed_action`.

**So P7's smallest reuse is a link.** It builds no approval table, no approver calculation, no
`approved=true`, no local approve/reject mutation and no bypass around `decide()`.

## 6. The authority timeline, stage by stage

| Stage | What is evaluated today |
|---|---|
| **T1 render** | P7 only: surface capability conjunction + registry `requiredPermission` vs current role. Creates nothing. |
| **T2 invoke** | Server-side principal/org re-derivation and the Slice 10 render-binding integrity check; then P45 `runtimeEnabled` (env + org column); `startRun` validates the revision is a live `DECISION` and pins the basis. |
| **T3 approve** | `decide()` resolves the approver from a **trusted principal** server-side, requires an ACTIVE `governed_actors` row for that principal, checks the `DECIDE_SKILL` grant through `dispatchSkill`, and appends to `pursuit_run_approvals`. A caller can never nominate an approver. |
| **T4 resume** | Eligibility, permission, capability grant, the pin and the approval policy are **all re-evaluated**, then `dispatchSkill` runs its own full pipeline. |

Against your minimum contract: render-time eligibility does not authorize invocation ✓; invocation-time
eligibility does not permanently authorize execution ✓ (per-step re-evaluation); approval does not
restore revoked authority ✓ (approval releases a step; authority is re-checked at T4); resume uses
current authority ✓. **I found no gap requiring repair, and nothing would be repaired inside P7 if I
had.**

## 7. Subject and transport transition

Slice 10's protected closure may identify the render-time selected subject. On explicit invocation the
**P45 run id becomes the durable operation reference**, and the closure's job ends there — it is
neither authority nor a run token. Retry of that invocation refers to the **same run**, because run
identity is the program hash; a later intentional invocation may create a **distinct** run.

## 8. Mutation allowlist for eventual hosted certification

A blanket `0/160` is wrong once a run is intentionally created. The expected write set, declared in
advance, would be: `pursuit_runs`, `pursuit_run_steps`, `pursuit_run_approvals`,
`governed_action_invocations`, plus the chosen capability's own business table. Everything else must be
unchanged, and `securityHash`, `stableManifestDigest`, policies, RLS, grants, functions and triggers
must be identical.

## 9. Still excluded

Action chaining · conditional next steps · autonomous continuation · model-selected continuation ·
multi-step generated workflows · `EXTERNAL_ACTION` steps · model-authored plans or payloads · any P7
approval semantics.

---

## R. Decisions requiring a ruling

**R-A — the existing approval-bearing capability: THERE IS NONE.** All 18 registered skills have
`approval_required = false`; `governed_actors` and `actor_capability_grants` are empty; the only
`DECISION` plan revision is superseded. **This is the STOP you asked for.** Proceeding requires
*provisioning*, not architecture — but one piece of it, setting a skill's `approval_required = true`,
changes that skill's governance **product-wide**, which is the same objection you raised against
manufacturing an approval requirement for `assemble_pursuit_team@1`. I will not choose which skill that
should be.

**R-B — does P45 already provide the durable/non-idempotency contract? YES.** Run identity is the hash
of the canonical ordered program, with one-live-run-per-revision, so retry replays onto the same run
and a different program is an explicit CONFLICT. **P7 must add no `(subject, capability)` key** — the
run *is* the operation instance. I recommend recording that the deferred non-idempotency problem is
answered by P45 and not by P7.

**R-C — render → invoke → approve → resume authority semantics.** Traced in §6; the current
implementation already satisfies your minimum contract at all four stages, with per-step
re-evaluation and a server-resolved approver. **No gap found, and none would be repaired inside P7.**
Confirming that reading is the ruling I need.

**R-D — subject/transport transition.** Recommend: the protected closure identifies the render-time
subject only; on invocation the **P45 run id** becomes the durable operation reference; the closure is
never a run token and never authority.

**R-E — approval UX reuse.** Recommend: **P7 builds nothing.** `/approvals` already renders the
approval-required state over the same `pendingApprovals` model and is wired to `decide()`. The smallest
reuse is a navigation link. Building presentation over existing P45 semantics would be acceptable
later; creating approval semantics never is.

**R-F — activation blast radius and bounded Preview posture.** Traced in full, and the three
load-bearing claims were verified by reading the code directly rather than accepted on report.

**The radius is small: exactly two production read sites.** `runtimeEnabled` in `runtime/entry.ts:35`
(the whole runtime entry boundary) and `approvals/page.tsx:26` (a *duplicated* inline gate — the page
imports `pendingApprovals` directly rather than going through `listPendingApprovals`). A third site,
`vnext-flags.ts:154`, only populates the reported capability. **No worker or cron path reads it at
all** — the runtime is request-triggered by design, so activation adds no autonomous execution.

**`controlPlane` is a chain-free master, and unusually so.** Verified at `vnext-flags.ts:153-155`:

```ts
const controlPlane = vnextEnvEnabled("control_plane");
if (!tenant.experience) return { ...OFF, controlPlane };   // survives the early return
```

It ANDs with **nothing** — not even the tenant's experience entitlement — so it is the one capability
that can be true while every other is false. It also **enables** nothing: no other capability reads it.

**The execution half stays callerless.** Verified: `startAndRun`, `continueRun`,
`listPendingApprovals`, `pause`, `resume` and `cancel` have **zero** importers anywhere under `src/`
outside `lib/runtime/` itself. Flag-ON makes *reading and deciding* live; it does not make *run
execution* live, because nothing in the application starts or advances a run.

**Activation CANNOT be constrained to one org via the env flag.** `vnextEnvEnabled(flag)` reads
`process.env` and takes no `orgId`; there is deliberately no `org_features` column for
`control_plane`. The only per-org lever is `governed_action`, which is **`true` for all three orgs** —
so flipping the env var today activates **all three at once**. Constraining to one org would require
first setting `governed_action = false` on the other two, which is a posture change to organizations
not under test, writing `org_features` plus an `org_feature_changes` audit row. **Sequence matters:
other orgs' column OFF first, then env ON — never the reverse.** Rollback also requires a redeploy,
since Vercel env changes apply only to new deployments.

**THE FINDING I MOST WANT RULED — a latent cross-surface effect with no control-plane gate.**
`portfolio-pertinence-loaders.ts` already queries `pursuit_run_approvals` for
`decision = 'REQUESTED'` and emits *"A governed action is waiting for approval"*. **That loader is
gated on `pursuit_intelligence`, not on `control_plane`.** It is silent today only because the table
is empty. So the moment any approval request exists, that reason can begin appearing on
pertinence/pipeline surfaces **for any org with `pursuit_intelligence`**, with no control-plane gate of
its own. That is a real surface change outside the flag's apparent radius, and it is exactly the class
of thing you told me to return rather than design around.

**Proposed posture — returned, NOT taken.** Preview `mejokqxriwyawfhawuxu` only; principal org
*Vertex Systems*; `governed_action = false` on *Meridian Technology Partners* and *TD SYNNEX (demo)*
first, then `VNEXT_CONTROL_PLANE_ENABLED=true` with a redeploy; rollback is the exact reverse, env off
plus redeploy, then restore both columns. Production untouched and never contacted. **I have made none
of these changes, and I do not recommend making them until R-A is resolved — activating a runtime that
has no approval-bearing capability, no governed actor and no live decided revision would light up
`/approvals` for three orgs and demonstrate nothing.**

**R-G — mutation allowlist.** Recommend the set in §8, declared before any consequential invocation,
with everything outside it required to be unchanged.

**R-H — gaps in the replay / one-resume guarantees.** **None found for `INTERNAL_WRITE` steps**, and I
traced the enforcement rather than relying on the historic invariant: row lock, compare-and-set, and
the step idempotency key, with the explicit property that a lost race yields a duplicate *attempt*,
never a duplicate *effect*. **The caveat is the code's own:** the lock is not a lease and must not be
generalized across a provider action; `EXTERNAL_ACTION` steps are out of scope and should stay so.
