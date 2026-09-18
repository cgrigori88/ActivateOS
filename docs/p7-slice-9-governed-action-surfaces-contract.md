# P7 Slice 9 — governed action surfaces: discovery, contract and plan

**Status:** **CONTRACT RULED — A–F APPROVED. LOCALLY IMPLEMENTED AND PROVEN.** Hosted acceptance
requires separate authorization. The rulings as returned are recorded in §R. **Builds on:** Slices 1–8, all HOSTED ACCEPTED / CLOSED. Slice 8 is not reopened.

> **A Dynamic Surface may present a governed action affordance. It may not execute, authorize or
> approve the action. Every consequential action remains a P5 operation under current authority.**

---

## 1. P5 inventory — what already exists

There are **two** distinct consequential substrates, and conflating them is the first mistake
available here.

### 1a. `dispatchSkill` — the single mutation authority (certified, live, in use today)

`src/lib/pursuits/federation/skills.ts`. Every human mutation on the existing Pursuit page already
goes through it. It enforces, in order: registry lookup → **idempotency replay** → actor eligibility →
role rank vs `requiredPermission` → the optional governed-actor gate → `precheck` → `authorize` →
handler, recording every attempt in `governed_action_invocations`.

### 1b. The P45 runtime — plans, runs, approvals (certified, and **OFF**)

`src/lib/runtime/{entry,runtime,approvals}.ts`. **Double-gated and inert**: `VNEXT_CONTROL_PLANE_ENABLED`
(deployment) **and** `org_features.governed_action` (per-org). The hosted capability readout shows
`controlPlane: false` for **every** organization. Approvals live here, not in `dispatchSkill`.

### The registered capabilities, as they actually stand

| skill | effect | actors | perm | subject | args the caller supplies | approval | external |
|---|---|---|---|---|---|---|---|
| `explain_route` / `explain_partner_route` | READ | any | viewer | pursuit | — | no | no |
| **`assemble_pursuit_team`** | INTERNAL_WRITE | USER, SYSTEM | operator | **pursuit** | **none** | no | no |
| `select_partner_route` | INTERNAL_WRITE | USER | operator | pursuit | `candidateKey` | no | no |
| `override_partner_route` | INTERNAL_WRITE | USER | operator | pursuit | `candidateKey`, `reason`, `category` | no | no |
| `confirm_team_member` / `accept_` / `decline_` | INTERNAL_WRITE | USER | operator | team member | `memberId` | no | no |
| `approve_motion` / `reject_motion` | INTERNAL_WRITE | USER | operator | motion | `motionId`, free-form `edits`/`note` | no | no |
| `assert_stakeholder_role` / `assert_economic_fact` | INTERNAL_WRITE | USER, AGENT | operator | stakeholder / economic subject | structured evidence | no | no |
| `draft_campaign_touch` | INTERNAL_WRITE | USER, AGENT | operator | campaign | **free-form content** | no | no |
| `request_warm_intro` / `request_team_acceptance` | CROSS_TENANT_ACTION | USER (AGENT) | operator | account / member | structured | no | no |
| `send_partner_intro` / `send_campaign_touch` | **EXTERNAL_ACTION** | USER (WORKER, SYSTEM) | operator | — | — | — | **yes** |

**Existing product call sites:** `src/app/pursuits/[id]/actions.ts` (route decision, team decisions,
stakeholder assertion — Next **server actions**), `src/app/pipeline/actions.ts`, `src/app/api/mcp/route.ts`,
and `src/app/approvals/actions.ts` for the P45 decision path.

### The recommendation, and why

**`assemble_pursuit_team@1` is the smallest already-certified action suitable for the first vertical**
— and the decisive property is that **it takes no caller-supplied arguments at all**. Its handler is
`assembleTeam(db, pursuitId, dataEnvironment)`. That single fact removes the entire payload-authoring
risk class from Slice 9 rather than mitigating it.

Also: its subject is exactly **one pursuit**, which is precisely the Slice 7 binding; it is
`INTERNAL_WRITE`, so nothing leaves the system; it is **idempotent by design** ("assembleTeam is
idempotent and skips confirmed roles"); it carries `precheck: pursuitInOrg`; it needs no approval; and
its consequence is a **recommendation** — it cannot move a confirmed human assignment, which only the
separate `confirm_team_member` decision can do.

**Rejected, with reasons:** `select_partner_route`/`override_partner_route` (need `candidateKey` → the
spec becomes a payload); `confirm_team_member` (subject is a member, not a pursuit, and it moves a
human commitment); `approve_motion`/`draft_campaign_touch` (free-form content → payload authoring);
`send_*` (EXTERNAL_ACTION — excluded by §18); the P45 runtime entries (gated OFF, see below).

### The finding that most changes the shape of this slice

**No environment change is required.** `dispatchSkill` is independent of `VNEXT_CONTROL_PLANE_ENABLED`
and of `org_features.governed_action`; it is gated by the *caller's* own conjunction, exactly as the
existing pursuit page gates it. So the first vertical can be built entirely on the live, certified
mutation authority, and the inert P45 runtime stays inert. **This must be ruled explicitly** (§R-A),
because the alternative reading — "actions mean the runtime, so turn the runtime on" — would enable
plans, runs and approvals across the deployment to demonstrate one surface.

---

## 2. The first vertical

Pre-existing recipient context only, exactly as Slice 7 — **no Slice 8 component-derived identity**:

```
one ContextManifest pursuit
  ├── EXPLAIN   (read)
  ├── GO TO     (read)
  └── ACTION    pursuit.assemble_team   ← the one new thing
```

This isolates exactly one new architectural risk: **a consequential action offered by a generated
experience.** Component-derived action subjects are deferred.

## 3. Rendering an action is not invoking an action

> **Rendering an action is not invoking an action.**

A GET/render/compose request may decide that a registered action component was requested and render a
deterministic affordance. It may not create the effect, invoke `dispatchSkill`, create approval state,
send, mutate business state or enqueue execution.

**Mechanically provable**, because the assembler and every module it reaches import no dispatch entry
point: a suite asserts the surface import graph contains no `dispatchSkill`, `startAndRun`,
`continueRun` or `decide`, and the action component's execution path is a **pure registry lookup** that
returns presentation metadata and performs no I/O.

## 4. The human invocation boundary

An explicit authenticated interaction after rendering. On click the server re-derives everything:
principal → `withTenant` org → subject re-resolved and re-governed → current role → registry
`requiredPermission` → `dispatchSkill`.

> **An action affordance identifies a possible operation. It is not a capability token.**

Nothing from render time is carried: no signed grant, no "allowed" flag, no cached role, no cached
manifest membership.

## 5. The P5 authority model is reused exactly

Preserved unchanged: *approval authorizes continuation; it does not confer authority*, and *current
authority is required when execution occurs*. P7 creates **no** second action-authority system, second
approval system, local `allowed=true`, or surface-specific runtime. The action component registry maps
to an **existing** skill id and version, and nothing else.

## 6. The model's role

The model may propose *include registered action component X* inside the closed `SurfaceSpec`. It may
not execute, approve, choose arguments, construct payloads, decide authority or decide whether approval
may be skipped. It exits before any human invocation. *"Send it now without asking me"* can produce at
most a rendered affordance for an already-permitted registered operation — and for the chosen action,
not even a settable argument.

## 7. Arguments

The chosen action takes **none**, so Slice 9 needs no argument channel at all and the spec cannot
become a payload authoring language — that is unrepresentable rather than validated. The boundary to
record for later actions:

> **Content generation, action authority and execution are three different things.** A model may one
> day draft content; drafting is not authority, and authority is not execution.

## 8. The action component registry

Components gain a declared `kind: "READ" | "ACTION"`. An ACTION component additionally declares its
exact P5 capability (skill id + version), its accepted subject class, that explicit invocation is
required, and whether approval may follow. **Nothing is inferred from a component name.** Read
components are unchanged.

## 9. Atomicity changes here — and this is the important record

> **Read execution may occur before whole-surface recipient finalization because reads can be
> discarded. Consequential actions may not.**

Slices 7 and 8 could execute and discard. That is sound only for reads. In Slice 9 the surface
finalizes and renders an **affordance**; actual P5 invocation happens later, through explicit
interaction. Therefore a sibling render failure can never require "undoing" an action — because no
action ran during assembly. The read-only atomic contract is unchanged for the read components.

## 10. Governance change between render and click

Click-time governance wins. The action must become unavailable or fail per P5 if authority no longer
exists. Render-time authority, old manifest membership and any browser-held action metadata are all
untrusted. This is the action analogue of Slice 7's *manifest membership is identity binding, not
durable authorization* and Slice 8's *upstream visibility is not downstream authorization*.

## 11. Subject identity

Slice 9 binds only the pre-existing Slice 7 `ContextRef`; no component-derived handle, no raw UUID in
model output. The **invocation transport** carries the canonical pursuit id, and that is not bearer
authority because the server re-resolves and re-governs it under the current principal: `withTenant`
supplies the org from the session (never the client), RLS scopes the row, and `pursuitInOrg` refuses a
pursuit outside the actor's org. An id names *which* object; it grants nothing.

## 12. Approval

`assemble_pursuit_team` requires none, so Slice 9 introduces no approval experience. Where approval
exists it belongs to the P45 runtime: `approvals.ts`, the `/approvals` surface, and `decide()`, whose
approver is resolved from a **server-side trusted principal** and which **fails closed** when none
resolves. P7 must never call `decide()` and must never render an approve control. If a future action
requires approval, invocation returns the existing P5 approval-required state and the recipient is sent
to the existing surface.

## 13. No action persistence inside P7

The surface stays ephemeral. Runtime, approval and audit state created by invocation belong to P5 and
are expected there (`governed_action_invocations`, the ledger). P7 adds no persisted action state, no
queue, no approval table and no surface-local history.

## 14. The headless result

An ACTION component carries only deterministic presentation and invocation metadata: the registry
title, the recipient-safe operation wording, the capability key, the subject reference, and whether the
affordance is offered. It carries **no** pre-authorization, approval grant, P5 internal state, model
payload or executable value. React renders the affordance; React makes no authority decision.

## 15. Invocation, CSRF and replay

Reuse the existing protections exactly — a **Next server action**, as `src/app/pursuits/[id]/actions.ts`
already does: `"use server"`, POST-only by construction with the framework's origin checks, org from
`withTenant`, role from `currentRole(db)` server-side, and `dispatchSkill` carrying a `correlationId`
and an `idempotencyKey`. `dispatchSkill` already implements replay protection on
`(org_id, skill_id, idempotency_key)`, returning the prior invocation rather than re-executing.

**Do not build a weaker P7-specific invocation path.** The certified path exists.

## 16. Read versus action disclosure

Distinguish *may disclose that an operation exists* from *may execute it now*. The affordance's
presence is derived from **registry metadata plus the viewer's own role** — not from object data — so
it discloses nothing about the pursuit that the surface has not already disclosed by rendering it. The
existing precedent is Slice 4's `UNAVAILABLE_TARGET`: acknowledging an operation is permissible where
existence is already authorized. Rendering authority still never substitutes for click-time authority.

## 17. The threat model the implementation must prove

Page render never executes P5 · model composition never executes P5 · a hostile "do it now" prompt
never executes P5 · only a registered capability can be surfaced · the model cannot invent a capability
key · the model cannot supply any argument · surface possession confers no action authority · a stale
affordance loses to current governance · invocation derives the principal server-side · approval never
confers missing authority · repeated invocation follows existing P5 idempotency · no consequential
execution occurs during assembly, so no sibling failure can need undoing · every mutation is
attributable to explicit P5 invocation · **P7 itself writes nothing**.

## 18. Excluded, unchanged

Autonomous actions · model-triggered execution · autosend · background execution from rendering ·
component-derived action subjects · model-authored payloads · action chaining · second-level identity
chaining · generic workflow/dataflow · a P7 approval system · pinning/persistence · cross-org action
surfaces.

---

## R. Rulings (returned and recorded)

> **A Dynamic Surface may expose more than one consequential substrate over time, but the substrate is
> an explicit part of the registered action contract. P7 may not substitute one mutation/runtime
> substrate for another merely because both are "actions."**

**R-A — APPROVED.** `assemble_pursuit_team@1` through `dispatchSkill`. `VNEXT_CONTROL_PLANE_ENABLED`
and `org_features.governed_action` stay **off**; no P45 plan, run, approval or UI is created, and
`controlPlane=false` remains part of the hosted posture. This slice proves **governed explicit mutation
from a Dynamic Surface**, not P45 orchestration.

**R-B — APPROVED WITH A BOUNDARY.** Render the affordance only when the surface is available, the
component is registered, its subject came from the currently governed recipient context, and the viewer
satisfies the registered permission — so the affordance may reflect the viewer's own ability to be
offered it, and is not shown to users who could never perform it. But **render-time eligibility is
disclosure logic, not execution authorization**: P7 must not reproduce the dispatch pipeline, and
rendering must never invoke `dispatchSkill`, because **a dispatch records an attempt and an attempt is
consequential state**. No P7-local `authorized=true`, capability token, cached permission or
preauthorization record.

> **May disclose an action affordance ≠ may execute the action later.**

**R-C — APPROVED WITH A NARROWER TRANSPORT.** A Next server action following
`src/app/pursuits/[id]/actions.ts`. The canonical pursuit id is **untrusted subject input** — not
secret authority, not a bearer capability, not proof of org or role, not durable authorization. The
server re-derives principal, organization, role and subject, then enters `dispatchSkill`. **No
caller-supplied `skillId`:** a dedicated action with the capability **fixed server-side**, so a browser
cannot turn one affordance into a generic dispatch endpoint. A generic dispatcher needs its own ruling
once multiple action components exist. **No signed opaque action handle.**

**R-D — APPROVED.** No approval state exists here. P7 must not call `decide()`, render approve/reject
controls, create an approval record or simulate approval state. Recorded for later: *if a registered
surface action requires approval, P7 reuses that substrate's certified approval/runtime semantics and
may not invent a surface-local approval system.*

**R-E — APPROVED.** Zero caller- or model-authored arguments, made **structural**: no `args`, `payload`,
`body`, free-form content or arbitrary JSON position exists. The registry supplies the capability, the
governed subject supplies the identity, and `assembleTeam` derives everything else through existing
product logic. **A hostile prompt cannot smuggle a payload because no payload position exists.** The
schema is not generalized for future actions yet.

**R-F — APPROVED, WITH NO NEW STABLE-KEY SEMANTIC.** Preserve `dispatchSkill`'s existing
`(org_id, skill_id, idempotency_key)` mechanism and the per-submission/correlation pattern: the same
submission replays safely, a **new explicit click may create a new attempt**. Acceptable here only
because `assemble_pursuit_team@1` is idempotent at the business-effect level. A permanent
`(subject, capability)` key is **not** adopted — it would turn *never double-execute accidentally* into
*cannot intentionally run this again later*, a different product semantic. Recorded instead:

> **Registry eligibility for future non-idempotent actions requires an explicit
> invocation/idempotency contract before that action can be surfaced** — nonce, generation, finite
> window, stable operation instance or P45 semantics, chosen per action rather than generically.

UI disabling while a submission is pending is presentation hygiene only; correctness does not depend
on it.

## R (original). Decisions returned for ruling

**R-A — which P5 capability, and on which substrate.** *Recommend `assemble_pursuit_team@1`, dispatched
through `dispatchSkill`.* The decisive property is that it accepts **no caller-supplied arguments**,
which removes the payload-authoring risk class outright; it is also single-pursuit-subject,
`INTERNAL_WRITE`, idempotent, approval-free, and produces a recommendation rather than a commitment.
**The load-bearing half of this decision:** `dispatchSkill` is independent of the P45 runtime gates, so
**no environment change is required and the inert runtime stays inert**. Please confirm that reading
explicitly — the alternative ("actions mean the runtime") would mean enabling plans, runs and approvals
deployment-wide to demonstrate one surface, which I do not recommend and have not begun.

**R-B — render-time disclosure rule.** *Recommend: render the affordance only when the surface's own
capability conjunction holds, the subject came from the governed ContextManifest, and the current role
satisfies the registry's `requiredPermission`.* Consequence to accept: the affordance's presence then
reflects **the viewer's own role**, which reveals nothing about the object. *Alternative:* always render
and refuse at click — simpler to reason about, but it advertises operations to viewers who can never
perform them.

**R-C — invocation transport and subject binding.** *Recommend a Next server action beside the
experience route, mirroring `src/app/pursuits/[id]/actions.ts` exactly*, carrying the canonical pursuit
id as the only subject reference, with the server re-resolving org, role and subject. *Alternative
considered and rejected:* a server-signed opaque action handle — that would be a **new capability
token**, which §4 forbids by name.

**R-D — approval reuse.** *Recommend: none in Slice 9*, because the chosen action requires none.
Recorded: P7 never calls `decide()` and never renders an approve control; a future approval-bearing
action returns the existing P5 state and navigates to the existing `/approvals` surface.

**R-E — argument boundary.** *Recommend: zero arguments, structurally.* The action bind carries
`{ capability, subject }` and **has no args field at all**, so a payload is unrepresentable rather than
rejected. The three-way boundary — content generation ≠ action authority ≠ execution — is recorded for
the first action that needs a payload, which is not this one.

**R-F — replay/idempotency.** *Recommend inheriting `dispatchSkill`'s existing protection unchanged*,
including the existing call sites' pattern of a fresh `correlationId` per click. **The honest
consequence to rule on:** that pattern means *the same submission replays safely, a new click
re-executes* — which is correct here only because `assembleTeam` is itself idempotent. A future
non-idempotent action must use a **stable** key per (subject, capability), and I would rather have that
recorded now than discovered later. If you prefer double-submit protection in Slice 9 regardless, the
stable-key variant is a one-line change and I will take it instead.

---

## V. Implementation status — LOCALLY IMPLEMENTED AND PROVEN (hosted acceptance NOT authorized)

**Evidence.** `p7-slice9` **25/25** · unit **742/742** · `p7-slice1` **66/66** (seeded clone) · tsc and
`next build` clean · `certify-world` **52 suites clean, no drift** (`c9004670ffda112f`). All six ruled
negative controls bite, four of them **on the checkers themselves** (dispatch during render, a generic
caller-supplied skill id, trusting render-time permission on click, a bespoke write that skips the
dispatcher, and entering the P45 runtime are each constructed in memory and confirmed caught).

**No database schema, environment, flag, P5 or P6 change.** `controlPlane` stays false.

| Module | Change |
|---|---|
| `surface/actions.ts` | **new, declarative** — the closed action capability registry and `mayOffer` |
| `surface/registry.ts` | `kind: READ \| ACTION`; `pursuit.assemble_team` |
| `surface/schema.ts` | the ACTION validated node; `SurfaceComponentResult` as a union |
| `surface/compile.ts` | ACTION bind validation (subject only); provenance no longer anchored on a node |
| `surface/assemble.ts` | the ACTION branch executes nothing; `offered` decided from role |
| `app/experience/pursuits/actions.ts` | **new** — the single human invocation boundary |
| `page.tsx` | the affordance, as a form with no caller-controlled field |

**An action never becomes an "intent".** The ACTION bind is validated in the surface compiler, not
through `compileIntent` — so the Slice 5 grammar that Slices 1–8 certified as incapable of writing
stays read-only by construction, and nothing consequential can arrive through it.

**The Slice 1 no-writes invariant was narrowed in the Slice 5 shape, and strengthened.** It said *no P7
module may reach an action path*, which was true while P7 was read-only. It now asserts that the action
boundary is **exactly one named file** and that the entire `lib/experience` surface/assembly tree
reaches **no** dispatcher and **no** P45 runtime. That pins *which* file, which the original did not —
the old assertion would have been satisfied by any arrangement with no dispatcher, including one that
later moved a dispatch somewhere less visible. The raw-SQL clause is unchanged and still applies to
every P7 file.

**One real product defect found by the suite and fixed.** An action-only surface could not compile:
provenance was being lifted off whichever node happened to be directly bound, so a surface composed of
an ACTION alone was refused with *"a surface needs at least one directly-bound component"* — an
implementation detail leaking as a rule. Provenance is now computed independently from the vocabulary,
the manifest and the inputs; the values are identical either way, so this removed a dependency rather
than a check.

**Two defects of my own in the suite**, both caught before the recorded run: an assertion that an
action-only spec compiles (which is what surfaced the defect above — it was right and the product was
wrong), and a not-offered text check that scanned a character window instead of the branch, now scoped
to the branch and asserting it uses **no** object-derived value.
