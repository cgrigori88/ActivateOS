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

## 12. Hosted rollout — not designed here

0115 makes 2C-A **migration-bearing**, so its hosted rollout obeys **§16F and §16I**: the migration is
applied while the already-certified application serves, old-app/new-schema health is proven, the
post-migration baseline is established, and only then does the alias move. **No hosted work is
authorized by this contract.**
