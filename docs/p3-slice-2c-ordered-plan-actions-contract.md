# P3 Slice 2C — Ordered Plan Actions

**Status:** **2C-A CONTRACT FROZEN — implementation authorized (local only).** **2C-B is NOT
authorized.** Baseline at authorization: repository `17032e7` · certified serving/runtime `e55499b`
· hosted schema **114** · P45 inactive · sending disarmed · Production untouched.

> **A durable plan revision must be able to express an ordered set of intended actions rather than
> only one `nextAction`, while P3 remains the source of *what should happen* and P5 remains the
> runtime for *what is happening*.**

This contract is the architectural record. **If implementation proves an assumption here false, stop
and report the contradiction — do not rewrite the contract to fit the code.**

---

## 0. The canonical gap this closes

`PlanContent` v1 carries exactly one `nextAction`, and singularity is *derivational*, not merely a
field: `recommendPursuitPlan` computes `const top = s.gaps[0] ?? null`, and `focus`, `owner` and
`nextAction` all descend from that one gap. The gaps arrive already ranked from Missing Context and
are never re-ranked (D-019). Two functions — `actionFor(gap)` and `OWNER_ROLE_FOR_SOURCE[gap.source]`
— are already **pure per-gap**, so an ordered action set needs **no new derivation rules**, only a
wider slice of the same ranked list.

---

## 1. `PlanContent`

### 1.1 v1 is immutable and readable for life

`pursuit_plan_revisions` is append-only (`UPDATE`/`DELETE` revoked from `app_rw`, 0103). **No stored
v1 revision is rewritten, migrated or backfilled, ever.** v1 rows are read through the versioned
boundary (§2) and render exactly as they render today.

### 1.2 v2 shape

```ts
export const MAX_PLAN_ACTIONS_V2 = 3;          // product-global v2 bound
export const PLAN_CONTENT_SCHEMA_V2 = 2 as const;

export interface PlanActionV2 {
  key: string;                  // stable identity == stable commercial intent
  text: string;
  doneWhen: string | null;
  via: PlanEvidenceRef | null;
  owner: PlanOwner;
  dueInDays: number;
  milestoneKey: string | null;  // a REFERENCE into the milestone layer, never a new edge
}

export interface PlanContentV2 {
  schema: 2;
  focus: PlanFocus | null;
  motion: PlanMotionRef;
  actions: PlanActionV2[];      // ordered; length <= MAX_PLAN_ACTIONS_V2; [] is legal
  milestones: PlanMilestone[];
  why: PlanEvidenceRef[];
}
```

**`MAX_PLAN_ACTIONS_V2 = 3`** is a product-global, schema-versioned **presentation/commercial-plan
bound**. It is **not** a governance limit, a runtime authority limit, a semantic cohort definition,
or an organization-configurable policy.

### 1.3 What v2 content must never contain

**No `stagedMotionActionId`** — it does not exist in persisted v2 content. It was the field that
would have forced mutation of an immutable revision as staging advanced over time; lineage lives on
`motion_actions` (§4). **No `kind` discriminator, no `skillId`, no capability version, no `args`, no
runtime state, and no capability-shaped placeholder.** v2 actions are commercial plan intent and are
**non-executable by construction**.

### 1.4 Ordered, not sequential

> **`actions[]` is ordered recommendation priority. It is NOT a strict execution dependency chain and
> NOT a sequential runtime program.**

Dependency truth lives in the milestone layer: `PlanMilestone.dependsOn` already exists and
`evaluateMilestones` already computes `BLOCKED` when a dependency has not held. An action expresses
dependency by *referencing a milestone*, never by carrying edges. A deterministic ordered sequence is
sufficient for the product today; no DAG, parallelism, joins, branch-failure or compensation
semantics are introduced. Executable sequencing belongs to 2C-B.

### 1.5 Derivation and dedup

Scan the ranked gaps in order until **three distinct action keys** are selected or the gaps are
exhausted. Deduplicate by the stable commercial-intent key; **the highest-ranked occurrence wins**.
**Never append an array index to force uniqueness** — stable identity must represent stable intent.

**The characterized WHY_NOW behaviour is preserved deliberately:** `whynow:not_established`,
`whynow:unknown:{i}` and `whynow:contradiction:{i}` all map to `confirm_timing` when
`milestoneForGap` matches them to `timing_confirmed`. These are several *reasons* the same act is
needed, not several acts. One action, driven by the highest-ranked gap.

### 1.6 CONTEXT_HEALTH identity — a proven invariant, permanently guarded

All six concern emitters (`context-health.ts`) supply a **non-null `refId`**, and at most one concern
exists per `(kind, refId)` — the `SUPERSEDED_FACT` branches are mutually exclusive per fact, and the
`OPEN_CONTRADICTION` push is outside its loop, so N contradictions yield one concern. The
`?? "none"` branch in the gap builder is therefore **unreachable**.

Two permanent guards keep it true:

1. a test across all six emitter classes asserting non-null `refId` and unique `(kind, refId)`;
2. at the gap builder, a CONTEXT_HEALTH concern with a null `refId` **fails closed** — omitted with
   an explicit diagnostic reason, never given the synthetic identity `none`.

**Gap-key uniqueness is also required for deterministic total ordering, not only for dedup.** Gaps
sort `(b.rank - a.rank) || a.key.localeCompare(b.key)`; that tie-break is total **only while keys are
unique**. Duplicate keys would silently degrade a certified total order into insertion order.

---

## 2. The versioned content boundary

One canonical function, `normalizePlanContent`, is the **only** place stored plan content becomes a
usable object. It **explicitly inspects `schema`**, normalizes v1 into the v2 in-memory view (lifting
`nextAction` into `actions: [one]`, `[]` when null), accepts native v2, and **fails closed on an
unknown version**.

> **No shape inference. No blind fallback. No `coalesce(v2, v1)` semantic reader.**
> **SQL retrieves data. TypeScript interprets plan content.**

`schema` was written but never read before this slice; it starts being read here.

---

## 3. Fingerprinting

### 3.1 Versioned algorithms, dispatched from the stored revision

`assessPlanReview` compares a stored in-force fingerprint against a **freshly recomputed** one.
Therefore the **stored content version decides which algorithm computes *both sides***:

- a stored **v1** plan is compared **v1-to-v1 for life** using the unchanged v1 algorithm;
- a stored **v2** plan is compared **v2-to-v2**;
- an unknown schema **fails closed**;
- **no cross-version comparison, ever** — it would make every in-force v1 plan REVIEWABLE on deploy;
- **no global v1 re-baseline.**

`fingerprintInputs` / `fingerprintOf` are retained **verbatim as the live v1 algorithm**, not
archived as a type.

### 3.2 `PlanFingerprintInputsV2`

```ts
export interface PlanFingerprintInputsV2 {
  v: 2;
  pursuitStatus: string;
  opportunity: { id: string; stage: string } | null;
  route: { decided: boolean; selected: string | null } | null;
  motion: { id: string; status: string; linkage: string } | null;
  focus: { gapKey: string; kind: GapKind } | null;
  milestones: Record<string, MilestoneStatus>;
  actions: {                      // one entry per recommended action, in recommended order
    key: string;
    gapKey: string;               // the dedup winner
    source: GapSource;
    kind: GapKind;
    milestoneKey: string | null;
    owner: { role: string | null; memberId: string | null; status: string | null } | null;
  }[];
}
```

The v2 basis covers **recommendation membership, order and basis**. It does **not** hash rendered
prose (`text`, `doneWhen`, `via`), human adjustments, or the whole `PlanContent`.

### 3.3 Coverage proof (must hold in the implementation)

| Consumer | Input | Covered |
|---|---|---|
| `actionFor` | `source`, `refType`, `refId` | transitively — the action `key` encodes them |
| `actionFor` | `gap.key` | `gapKey` |
| `actionFor` | `accountLabel`, `gap.text` | **no — prose only**, changes the sentence, never identity/order |
| `OWNER_ROLE_FOR_SOURCE` | `source` | `source` |
| `resolveOwner` | team membership/status | `owner {role, memberId, status}` — the same triple v1 hashes |
| `milestoneForGap` | `source`, `refType`, `refId` | transitively — `milestoneKey` |
| `milestoneForGap` | WHY_NOW `gap.text` regex | **transitively, by effect**: if the verdict flips, `milestoneKey` changes |
| top-N / dedup | gap rank order | array order |
| top-N / dedup | dedup winner | `gapKey` |
| milestone evaluation | pursuit/opportunity/route/motion/stakeholders/qualification/value/timing | directly and via the `milestones` map, exactly as v1 |
| `doneWhen`, `via`, `dueInDays` | prose / declared constant | **deliberately excluded**, inherited from v1 |

**`recommenderVersion` is recorded in `basis` but NOT hashed** — hashing it would make every in-force
plan REVIEWABLE whenever the recommender is touched. `MAX_PLAN_ACTIONS_V2` is a versioned product
constant, not world state, for the same reason.

### 3.4 Human adjustment never rewrites the basis

`decidePlan` stores the **recommendation's** basis and fingerprint (`pending.basis`,
`pending.fingerprint`), never a recomputation over adjusted content. **This is intentional, not an
accidental consequence.** Plan review therefore asks *"has the recommendation basis materially
changed since this plan was decided?"* — never *"would the current world regenerate the human's
edited prose byte for byte?"* Edit, reorder and remove leave the fingerprint untouched.

---

## 4. Current action, and lineage

### 4.1 Standing vocabulary

```ts
type ActionStanding =
  | { standing: "ACTIONABLE" }
  | { standing: "BLOCKED"; milestoneKey: string }
  | { standing: "RESOLVED"; reason: "MILESTONE_DONE" | "MOTION_ACTION_DONE" | "MOTION_ACTION_SKIPPED" };
```

| Condition | Standing |
|---|---|
| milestone `DONE` | `RESOLVED(MILESTONE_DONE)` |
| milestone `BLOCKED` | `BLOCKED` |
| milestone `OPEN` / `NOT_ESTABLISHED` | `ACTIONABLE` |
| null milestone, linked queue row `done` | `RESOLVED(MOTION_ACTION_DONE)` |
| null milestone, linked queue row `skipped` | `RESOLVED(MOTION_ACTION_SKIPPED)` |
| null milestone, queue row pending or absent | `ACTIONABLE` |

Only `MILESTONE_DONE` carries canonical business truth. The motion-action reasons are **fallback
resolution for actions that have no milestone**, because no stronger domain signal exists there.
**`MOTION_ACTION_SKIPPED` never means the commercial condition succeeded** — it means the recommended
action is no longer pending. When every action is resolved, the product means **"no remaining
recommended actions"**, never that every business objective was achieved.

### 4.2 Selection

`selectCurrentPlanAction` is **one pure canonical implementation** that owns these semantics. It
scans in recommendation order and returns the first `ACTIONABLE`, **skipping `BLOCKED` and
`RESOLVED`**; `null` when none remain. A later action may legitimately become current when it is
itself the work that unblocks an earlier-ranked one.

> **There is one canonical current-action semantic implementation. Surfaces must not independently
> reproduce its rules.** Where a SQL path would need semantic selection, the selection moves above
> SQL into this function.

### 4.2a Two distinct concepts, and neither may impersonate the other

The canonical selector answers *"what is actionable now?"* from **current** canonical state. An
approved revision answers *"what did a person approve?"* and is **preserved when the world moves**
(D-028) — `frameApprovedPlan` labels it *"recorded before the changes above"*. These are different
questions, and collapsing them would silently rewrite a human decision.

| Concept | Source | Where it is used |
|---|---|---|
| **Approved primary action** | `actions[0]` of the revision, as stored | the single-action block on Pursuit Detail, including under REVIEW_NEEDED |
| **Current actionable action** | `selectCurrentPlanAction(actions, liveMilestones, staged)` | `isCurrent` in the ordered list · Today, where the surface's job is current attention · the staging writer, which stages exactly this one |

> **An approved plan under REVIEW_NEEDED must not have its approved headline rewritten merely
> because another action has since become current.** The ordered list states which action is
> currently actionable; the headline states what was approved. **Neither concept may masquerade as
> the other.**

The practical consequences, which are asserted rather than assumed:

- `view.nextAction` is `actions[0]` and carries `isCurrent`, so a reader can always tell whether the
  approved primary action is also the one to work on now. It is never re-selected.
- A v1 revision therefore renders **byte-identically**: its single action *is* `actions[0]`.
- Today uses `selectDisplayPlanAction`, which returns the current actionable action and falls back
  to `actions[0]` only when every action is resolved or blocked — so a plan with nothing to do still
  shows what it was, rather than rendering empty.
- Staging uses `selectCurrentPlanAction` and stages **only** that action; when it returns `null`,
  nothing is staged.

### 4.3 Lineage

- **v2 lineage lives on `motion_actions`**, never in immutable plan content.
- **Live lineage requires `plan_revision_id`.**
- **A bare `plan_action_key` after parent deletion is PROVENANCE, never lineage.** It is the only
  surviving signal that the queue row was staged from a plan, and it never resolves to one.
- **At most one live staging row per `(org_id, plan_revision_id, plan_action_key)`.**
- **The audit ledger corroborates lineage; it never defines it.**

### 4.4 Staging-writer invariant

The FK proves the revision exists in the tenant. It **cannot** prove the supplied `plan_action_key`
is a member of that JSON revision. So before any v2 staging write, the application boundary proves:

1. the exact revision is the intended plan revision;
2. it normalizes successfully under a **known** schema;
3. the key exists in that revision's canonical action set;
4. it is the action the canonical selector chose for this operation;
5. the persisted pair comes from those **resolved objects**, never from unchecked caller strings.

A forged pair — valid revision with a nonexistent key, a different action's key, a cross-tenant
revision, or an unknown-schema revision — **must not stage work**. This establishes referential
semantic integrity above the JSON boundary. **It creates no authority.**

---

## 5. Authority

- **Plan content confers zero authority.**
- **Action text can never create executability.**
- **2C-A introduces no plan → runtime compiler.**
- **P4, P5 and `dispatchSkill` are untouched.** A malicious or stale plan cannot bypass them, because
  nothing in 2C-A compiles a plan into anything executable.

---

## 6. Migration 0115 — lineage integrity

Option A of the delete-lifecycle analysis. The repository's existing position is that **motion work
outlives the pursuit**: `revenue_motions → pursuits` is `ON DELETE SET NULL`, so the motion (and its
actions) survive a pursuit deletion, while `pursuit_plan_revisions → pursuits` CASCADEs away. A plan
revision must not acquire the power to delete queue work those rules deliberately preserve.

| Element | Design |
|---|---|
| Parent candidate key | `unique (org_id, id)` on `pursuit_plan_revisions` — the device 0110 added for `pursuit_run_steps` |
| Columns | `motion_actions.plan_revision_id uuid` nullable, `plan_action_key text` nullable |
| Tenant FK | `(org_id, plan_revision_id) → pursuit_plan_revisions (org_id, id)` |
| Delete action | **`ON DELETE SET NULL (plan_revision_id)` only** — `org_id` is this row's own tenant identity and must survive; `plan_action_key` is not a referencing column and cannot be nulled by the FK |
| Live-lineage CHECK | `plan_revision_id is null OR (plan_action_key is not null AND org_id is not null)` — **the converse is deliberately not required**; null revision + non-null key is legal detached provenance |
| Idempotency | partial unique index on `(org_id, plan_revision_id, plan_action_key) where plan_revision_id is not null` |

**None of:** new table · trigger · function · `SECURITY DEFINER` · policy change · explicit grant
statement · legacy backfill. `app_rw` holds table-level privileges on `motion_actions`, so new
columns are covered; the derived column-privilege count moves 9 → 11 per privilege as an expansion of
an unchanged table grant.

---

## 7. Surfaces

Minimum scope. **Pursuit Detail** shows the ordered recommended actions and makes the current
actionable work clear, **without presenting it as an executable runtime program**. **Today** keeps one
attention line per pursuit, via the canonical selector. **Approvals** uses the canonical
selected-action label, derived in TypeScript through `normalizePlanContent` — no JSON pointer, no
shape fallback. **Queue** keeps its existing worklist semantics and stages **only the current
`ACTIONABLE` action**; later actions may be staged as commercial state progresses, through the
lineage columns on the mutable row. Queue never learns the whole plan and never invents sequence or
eligibility. **No broad redesign.**

**Ledger:** the existing `ACTION_CREATED` corroboration may add exactly `planId`, `planRevisionId`
and `planActionKey` — **no action text, args, capability information, hidden evidence or cross-org
values.**

---

## 8. Adjustments

v2 adjustments may **edit text, edit owner, edit `dueInDays`, reorder and remove**. They may **not
add arbitrary actions** — an adjustment may modify or reduce the deterministic recommendation; it may
not create an entirely new ungrounded commercial action in this slice. Actions are addressed **by
stable action key**. Every adjustment creates a **new immutable revision** through the existing
append-only model, and records enough to reconstruct: what was recommended, what the human changed,
and the final approved order. `actions: []` remains legal.

---

## 9. 2C-B — deferred, explicitly unauthorized

- a deterministic plan → runtime compiler;
- an explicit executable capability representation, in a later plan content version;
- plan-action identity on `pursuit_run_steps`;
- no caller-supplied semantic divergence from the pinned revision.

2C-B additionally depends on a **real executable capability existing**, which P7 Slice 11 Ruling A
records as absent: all 18 registered skills have `approval_required = false`, and no plan action names
a skill.

**P3 Slice 2C-B — Plan → Runtime Compilation: NOT STARTED / DEFERRED.** The closure of 2C-A does
**not** authorize executable capability fields in `PlanContent`, compiler work,
`pursuit_run_steps.plan_action_key`, caller-independent autonomous execution, or P45 activation.

---

## 10. Unrelated carry-forward

**D-P6IG-GOVERNANCE-FLAKE — OPEN / UNCHARACTERIZED.** One observed `91/1` run of `p6ig-governance` on
`0f5f40e`, never reproduced across ten later clean `92/0` runs; the failing assertion was never
captured. It is not related to this slice and must not be absorbed into it. If it reproduces during
any required regression: **stop on the first failure, capture the evidence with
`VERIFY_DUMP_ON_FAIL`, do not retry, and report it separately.**

---

## 11. Acceptance — 2C-A

Every security/integrity assertion carries a negative control; no vacuous PASS.

| # | Must prove |
|---|---|
| 1 | v1 stored revision parses, normalizes and renders byte-identically |
| 2 | v2 derives ≥3 ordered actions from ranked gaps |
| 3 | Deterministic identity and order across runs and heap orders |
| 4 | WHY_NOW dedup: several timing gaps → one `confirm_timing`, highest-ranked wins, winner in the basis |
| 5 | v1↔v1 and v2↔v2 fingerprint dispatch; never cross-version |
| 6 | No global REVIEWABLE event for stored v1 plans |
| 7 | v2 stale detection when action 2 or 3's canonical basis changes |
| 8 | Edit / reorder / remove create immutable new revisions with a reconstructable trail |
| 9 | Human adjustment never makes its own plan stale |
| 10 | Unknown schema fails closed, including on the approval-label path |
| 11 | The current-action selector is shared and deterministic; surfaces agree |
| 12 | Only the current actionable item reaches the Queue |
| 13 | v2 lineage via columns; v1 lineage only via an explicit `schema = 1` branch |
| 14 | Authority unchanged — executable-looking text produces no dispatch, no step, no P45 state |
| 15 | P2 / P6 / P6-IG / P7 incl. Slice 14, multi-grant union, cohort completeness, statement bound unchanged |
| 16 | All six CONTEXT_HEALTH emitters: non-null `refId`, unique `(kind, refId)` |
| 17 | Gap-key uniqueness protects the total ordering |
| 18 | RESOLVED reason fidelity — a skip never reads as success |
| 19 | Staging-writer membership validation, with forged-pair negative controls |
| 20 | Ledger payload bounds |
| D1–D12 | The deletion/integrity matrix of §6 |

---

## 11a. The v2 write-activation boundary

### 11a.1 What was proven about rollout, on disposable clones

| Application | Schema | Data | Result |
|---|---|---|---|
| `e55499b` | 114 | v1 | **current certified** |
| `e55499b` | 115 | v1 | **SAFE / PROVEN** — every path healthy; old writes stay v1-shaped and leave the lineage columns null, which the live-lineage CHECK permits. Every old INSERT into `motion_actions` carries an explicit column list, so two added nullable columns cannot break one |
| 2C-A | 115 | v1 | **SAFE / PROVEN** — renders v1 through normalization; three full read passes moved **nothing** (identical world digest, 0 tables), no backfill, no read-triggered write |
| 2C-A | 115 | v1+v2 | **intended target** |
| `e55499b` | 115 | v1+v2 | **UNSAFE / PROVEN** |

**`e55499b` against v2 data does not fail — it proceeds confidently and wrongly.** It reads no
`nextAction` and renders an empty action block on a plan that has actions; the v2-staged queue row
resolves to no plan and reads as an ordinary cadence action; every v2 plan appears permanently stale
because a v2 fingerprint can never equal the old algorithm's recomputation, so Today shows
`PLAN_REVIEW_REQUIRED` with a null owner; and it then records a **new v1 recommendation**, approves
it, and **stages a second action for work already queued**.

> **Rollback to `e55499b` ceases to be valid at the first persisted v2 revision.**

A v2 revision is written only by an explicit human action — `requestPlanRecommendationAction`
through `dispatchSkill`, or a decision. **Rendering a pursuit never writes one.** So the rollback
window closes on the first human plan action after deploy, not on deploy itself.

### 11a.2 The gate

`PLAN_CONTENT_V2_WRITES_ENABLED`, read through `planContentV2WritesEnabled()`, using the
repository's canonical opt-in deployment-switch idiom (`"true" | "1" | "on" | "yes"`, absent ⇒
false) — the same parser `pursuitsEnabled()`, `envEnabled()` and `vnextEnvEnabled()` all use
verbatim.

It is **deployment-global · default OFF · not tenant-configurable · not an org feature · not a
`VNextFlag` · not part of `vnextCapabilities` · not authority · not disclosure · not a product
entitlement.**

> **The gate governs only whether a NEW schema-2 plan revision may be PERSISTED.**
> **v2 reads are always enabled. The gate is a write brake, never a downgrade mode.**

Its posture is reported in the authenticated `/api/build` **`posture`** block as
`planContentV2WritesEnabled`, deliberately **not** in the tenant `capabilities` array: a hosted gate
must be able to prove whether the serving deployment can create v2 data without relying on anyone's
memory of a Vercel setting.

### 11a.3 Schema preservation — a decision never changes generation

**A decision responds to one immutable recommendation revision, so the recommendation's stored schema
determines the decision's schema.** There is no downconversion and no upgrade.

| Gate | Operation | Result |
|---|---|---|
| OFF | generate recommendation | persist **v1** content, v1 basis, legacy staging pointer |
| OFF | decide a **v1** recommendation | persist a **v1** decision, v1 staging semantics |
| ON | generate recommendation | persist **v2** |
| ON | decide a **v2** recommendation | persist a **v2** decision, v2 lineage |
| OFF→ON between generation and decision | decide a **v1** recommendation | decision stays **v1**. **Not upgraded** |
| ON→OFF between generation and decision | decide a **v2** recommendation | **REFUSED before any mutation** — no revision, no staged action, no ledger row. Not downconverted, and never a v1 decision responding to a v2 recommendation |
| any | unknown schema | fails closed at the versioned boundary |

The invariant this buys:

> **While `PLAN_CONTENT_V2_WRITES_ENABLED` is OFF, no new schema-2 plan revision can be persisted.
> Existing schema-2 revisions remain fully readable.**

### 11a.4 Every production serializer is covered, structurally

Certification fails if a future production path can persist schema 2 without either consulting the
gate or inheriting its schema from a pinned parent revision. Readers are never gated.

### 11a.5 The post-v2 rollback rule

- **Before the first v2 persistence:** `e55499b` remains a valid rollback target.
- **After the first v2 persistence:** `e55499b` is **permanently retired** as a rollback target for
  that database state.

A valid post-v2 rollback runtime must understand v1 **and** v2 reads, understand v2 lineage, and
preserve versioned fingerprint dispatch. **Turning `PLAN_CONTENT_V2_WRITES_ENABLED` OFF on a
v2-capable runtime is the safe operational brake — it stops new v2 data being created. It does not
restore compatibility with `e55499b`, and nothing can.**

#### 11a.5.1 The boundary event — FINAL, for Preview `mejokqxriwyawfhawuxu`

| | |
|---|---|
| **First persisted hosted v2 revision** | `3d94daee-72d4-4fbe-82c5-2c8e68900be3` |
| **Timestamp** | **2026-09-20T04:25:21.481Z** |
| **Serving deployment** | `dpl_J4d7ynXoZ4PGNV42NqWoRgHP4kWk` |
| **Source** | `89ed7001eccf33d1074b5a55506c78af032f9b38` |

**This event permanently retires `e55499b` as a rollback target for this database.** The synthetic v2
fixtures were deleted afterwards and the persisted plan revisions returned to all-schema-1 — **and
that did not restore the old boundary, because nothing can.** The claim a rollback target has to
satisfy is about what the database *has ever held*, not what it holds today. A clean fixture-residue
count must never be read as the boundary being restored.

#### 11a.5.2 The canonical post-v2 rollback target

| | |
|---|---|
| **Deployment** | `dpl_3hXGEzo6njtV7VDhJHVQB8fqtYL9` |
| **Direct URL** | `https://pursuitos-demo-lduummxhq-cgrigori-s-projects.vercel.app` |
| **Source** | `89ed7001eccf33d1074b5a55506c78af032f9b38` — identical to the serving source |
| **Posture** | `planContentV2WritesEnabled = false` · schema 115 · `app_rw` · `bypassRls` false · tenant enforcement true · sending disarmed |

Certified **after real hosted v2 data existed** to: read v1 · read v2 · resolve v2 Queue lineage by
columns · dispatch versioned fingerprints · preserve business state · **refuse new v2 writes**.

The exact rollback command — **recorded, not executed**:

```
npx vercel alias set https://pursuitos-demo-lduummxhq-cgrigori-s-projects.vercel.app pursuitos-demo-git-roadmap-pursuitos-vnext-cgrigori-s-projects.vercel.app
```

> **Turning the write gate OFF is the post-v2 operational brake. It does not make `e55499b` safe
> again.** The brake stops new v2 data from being created; only a v2-capable runtime can be rolled
> back to.

---

## 11b. Hosted acceptance — 2C-A

**P3 Slice 2C-A — Ordered Plan Content: HOSTED ACCEPTED / CLOSED.** Serving
`dpl_J4d7ynXoZ4PGNV42NqWoRgHP4kWk` on source `89ed7001`, schema **115**,
`planContentV2WritesEnabled = true`, `app_rw` / `bypassRls` false / tenant enforcement true, sending
disarmed, P45 zero. **Production `qifatlqxfuhwrwvpbwsc` never addressed.**

**OFF-posture certification — 57/0 with zero hosted v2 revisions throughout.** The 2C-A runtime was
proven on the canonical hostname *before* the gate was armed: it reads v1, operates on schema 115 and
persists nothing in schema 2.

**The first v2 recommendation.** `content.schema = 2`; `actions[]` present and `nextAction` absent;
three bounded, distinct, semantic keys with no index suffix; v2 basis and v2 fingerprint. **A
recommendation alone stages no motion action** — a proposal queues nothing.

**The v2 decision.** Schema 2 preserved; the exact parent recommendation; `adjustments` null;
**exactly one** current action staged; its `plan_action_key` proven a member of the decision
revision's `actions[]`; lineage resolved through the columns; **no persisted v2 execution pointer**;
ledger payload restricted to `planId` / `planRevisionId` / `planActionKey` with no action text,
arguments, capability or evidence.

**v1 + v2 coexistence.** Both render correctly under the activated deployment — a stored v1 plan
beside live v2 data, on the same surfaces, with no cross-version comparison anywhere.

**Today — characterized precisely.** The v2 plan action **participates correctly in Today**. The
default Today surface is presentation- and ranking-limited (`TODAY_TOP_DECISIONS = 4`); the fixture
did not enter that window because of its ranking inputs, not because of its schema. `?today=all`
exposes the correct v2 `ACTION_DUE` item, and the activated and rollback deployments **agree as dual
readers**. See §16M.

**The write brake.** With real v2 data present, the OFF deployment reads v2 correctly, and a genuine
pending v2 decision attempt is refused with the expected disabled-write error: no plan decision, no
queue row, no lineage and no other business state is created. An immutable failed-dispatch audit row
is appended, and that is expected.

> **The write brake prevents prohibited business-state mutation. It does not suppress audit evidence
> of the attempted governed invocation.**

See §16N for why two earlier attempts to prove this did not certify it.

**Final reconciliation after fixture cleanup.** pursuits **14** · motions **7** · queue rows **6** ·
plan revisions **3**, all schema 1 · live lineage rows **0** · `change_ledger` **68** · `api_keys`
**0** · P45 **0** · schema **115**. The single accepted persistent movement is **+13
`governed_action_invocations`** immutable audit rows, fully classified: **6 recommend EXECUTED, 2
decide EXECUTED, 4 decide FAILED, 1 `select_partner_route` FAILED** on a harness argument shape.
Retained as audit evidence under the Slice 9/10 precedent.

Final world digest **`f716178809021a09`**. **This is not an unexplained rebaseline:** the prior digest
moved because the retained immutable invocation audit rows are themselves part of the world.

---

## 12. Hosted rollout — not designed here

0115 makes 2C-A **migration-bearing**, so its hosted rollout obeys **§16F and §16I**: the migration is
applied while the already-certified application serves, old-app/new-schema health is proven, the
post-migration baseline is established, and only then does the alias move. **No hosted work is
authorized by this contract.**
