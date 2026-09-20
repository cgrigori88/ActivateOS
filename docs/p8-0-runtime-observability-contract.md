# P8-0 — Runtime Observability and Evaluation Hooks (contract, frozen 2026-09-20)

> **This slice builds the immutable execution-evidence spine that future P8 learning consumes.
> It does not implement learning, ranking, reward modelling, outcome prediction or policy adaptation.**

**Central invariant.** Observability may record **what happened**. It may not invent why it happened,
what model executed, what it cost, what plan action caused it, or what outcome resulted, unless the
runtime possesses trustworthy evidence for that fact. **`NULL` / absent means NOT OBSERVED — never
zero, none, unsuccessful, unrelated, or inferred.**

---

## 1. What discovery found, and what it refused to build

The spine is mostly present already. `governed_action_invocations` and `change_ledger` are the two
strong immutable surfaces (`app_rw` may update only `(status, executed_at)` on the first and nothing
at all on the second, and neither permits DELETE). `pursuit_runs.basis_fingerprint` is **already
NOT NULL** and captured at run start, so *"what was approved, from what evidence state, when
execution began"* is answerable today without recomputation — and **no historical fingerprint is
ever recomputed under a newer algorithm.**

Four things were proposed and **three were refused**, because a table with no legitimate writer is
future schema, not this slice:

| Refused | Why |
|---|---|
| model/usage/cost observation | **All 13 `ai/client.ts` call sites are uncorrelated** — they reach a Resend webhook and an analytics page, never a governed invocation or run step. Orphan evidentiary rows are worse than none. |
| external provider receipt observation | `action_receipts` is **fully mutable and DELETE-able**, and its `detail` holds an arbitrary provider payload. Sending is disarmed and no certified external path is in scope. |
| execution→outcome observation | `OBSERVED_AFTER` has no derivation job and `HUMAN_ATTRIBUTED` has no declaration path anywhere in the product. No attribution UI was invented to populate a table. |

`agent_runs` stays **legacy presentation telemetry**: fully mutable and deletable by `app_rw`, with
no link to any governed execution. Its historical rows were never written to evidentiary standards
and are **not** promoted, migrated or backfilled.

## 2. Cardinalities, proven before they were designed against

- **Invocation → effect is 0..N.** `assembleTeam` (`routing/team.ts:41`) inserts
  `pursuit_team_members` **inside a loop**; a REJECTED invocation has none. Singular
  `effect_kind`/`effect_id` columns on the invocation were therefore **withdrawn**.
- **Invocation → ledger is one-to-many.** One `decide_pursuit_plan` emits **two** events —
  `ACTION_CREATED` (conditional) and `PLAN_DECIDED` (always). A singular `emitted_event_id` cannot
  represent that, so it **stays LEGACY/DEAD and is never populated**; the canonical relation is
  `change_ledger WHERE invocation_id = ?`.
- **Not every effect has a single-UUID identity.** `stakeholders` has a **composite primary key
  `(opportunity_id, contact_id)`**, so `assert_stakeholder_role@1` **cannot** produce an
  `effect_id uuid` and is excluded from v1 rather than coerced into fabricating one.

## 3. The invocation write lifecycle this design depends on

For READ / INTERNAL_WRITE / authorized CROSS_TENANT — the P8-0 class:

```
guards … any refusal → record(…,"REJECTED")        ← single TERMINAL INSERT, no handler ran
savepoint sp_dispatch_xxxx
  handler(db, actor, ctx)                          ← business mutation + handler-level recordChange
release savepoint
record(…,"EXECUTED",{result,grantId})              ← THE INVOCATION ROW IS INSERTED HERE
  on throw → rollback to savepoint; release; record(…,"FAILED")
```

**The row is inserted terminally, once, after the effect, in the caller's single transaction.** That
is what lets the completeness marker be written truthfully on INSERT — no completion table, no
post-insert transition, no trigger machinery. **The lifecycle is not changed by this slice**: still
one terminal INSERT, no pre-handler EXECUTING row. EXTERNAL_ACTION keeps its own shape and is out
of scope.

## 4. The canonical invocation id

`governed_action_invocations.id` carries `default gen_random_uuid()` and `record()` returns it. P8-0
**preallocates the same UUID server-side** at the top of `dispatchSkill` and supplies it explicitly.

This is possible because **`change_ledger.invocation_id` carries NO foreign key** — it is a bare
nullable uuid, exactly the 0109 convention — so a ledger row written during the handler may carry an
id whose row is inserted moments later in the same transaction. No deferral, no lifecycle change.

> **The id is server-allocated. A payload field named `invocationId`, `effects` or anything else has
> zero authority over it.** It travels through a module-private symbol, not through `DispatchCtx`.
> The database default is retained for other legitimate insert paths.

## 5. `observation_contract_version` — per invocation, per capability

Named for what it is: an **execution observation contract**, not a migration level, not a runtime
build, not a global support claim.

| State | Meaning |
|---|---|
| registered capability + `1` | the v1 effect/ledger observation contract applies to this invocation |
| registered capability + `NULL` | **not observed under v1** |
| unregistered capability + `NULL` | v1 claims no effect completeness for that capability |

`1` is written for terminal **REJECTED / FAILED / EXECUTED** invocations of the four registry
capabilities on the non-EXTERNAL path. It is `NULL` for everything else, including EXTERNAL_ACTION —
whose row exists before any effect does, so marking it would be exactly the false certification this
design exists to prevent.

**Monotonicity is guaranteed by privilege, not by triggers:** the column is absent from `app_rw`'s
`(status, executed_at)` UPDATE allowlist, so `1 → NULL` and `1 → 2` are impossible without a new
grant. **A CHECK additionally makes `1` legal only for the exact four registry members**, so
application code alone cannot mark an unregistered invocation.

**P8 consumption requires BOTH the marker and registry membership. Support is never inferred from a
timestamp.**

## 6. The v1 effect-observed registry — exactly four, frozen

> **THE FROZEN PRINCIPLE. Observation completeness means the system completely observed the
> capability's declared v1 effect contract. It does NOT mean the capability necessarily produced an
> effect.** A declared effect contract therefore describes **actual creation**, never merely
> successful execution.

| Capability | Required refs | Cardinality |
|---|---|---|
| `draft_campaign_touch@1` | **if the dispatch actually creates a campaign touch**, exactly one `CREATED / campaign_touch / <id>` | **0..1** |
| `recommend_pursuit_plan@1` | **whenever the dispatch actually creates a recommendation revision**, `CREATED / pursuit_plan_revision`; **plus** `CREATED / pursuit_goal` and/or `CREATED / pursuit_plan` for those objects actually created during the same dispatch | **0..3** |
| `decide_pursuit_plan@1` | `CREATED / pursuit_plan_revision` for the decision revision; **plus** `CREATED / motion_action` when staging creates it | **1..2** |
| `assemble_pursuit_team@1` | one `CREATED / pursuit_team_member` per row actually inserted | **0..N** |

**The two successful-zero-effect cases, stated rather than left to be discovered:**

| Case | Outcome |
|---|---|
| `draft_campaign_touch@1` executes but **no campaign matches** and it returns `created: false` | **EXECUTED · marker 1 · zero refs** |
| `recommend_pursuit_plan@1` returns **UNCHANGED** (D-028 — the world has not moved, so no new revision exists) | **EXECUTED · marker 1 · zero refs** |
| REJECTED, or FAILED before any effect | **marker 1 · zero refs** |

In every one of these, **zero means observed zero declared effects**, because the invocation is
marked and its exact capability is in the v1 registry. `recommend_pursuit_plan@1`'s full range is
therefore **0** (UNCHANGED) · **1** (new revision against an existing goal and plan) · **2** (a new
revision plus one bootstrap object, where reachable) · **3** (fresh bootstrap: goal, plan and
revision).

Effects are recorded **at the actual creation branch**, never inferred afterwards from pre-existence
and never reconstructed by parsing `governed_action_invocations.result`.

**Explicitly NOT attributable effects:** `decide_pursuit_plan`'s `pursuit_goals.status → ACTIVE` and
`pursuit_plans.status → ACTIVE` updates. They are **internal parent lifecycle transitions**, frozen
as such. *Database mutation and contract-declared attributable effect are not the same thing.*

`recommend_pursuit_plan`'s conditional goal/plan creations are **kept, not collapsed into invisible
setup** — their conditional presence is legitimate observation, not instrumentation uncertainty.

**`N = 0` on `assemble_pursuit_team@1` is the canonical supported-and-empty case**, and it is the
reason the marker lives on the required parent rather than on an optional child: zero child rows
alone cannot distinguish *observed zero effects* from *never instrumented*.

## 7. `CREATED` is the only v1 relation

Every declared effect across all four contracts is a creation. `UPDATED` is **unreachable**:
`DraftTouchArgs` is `{campaign, name, subject, body}`, the MCP tool declares exactly those with
`additionalProperties: false`, and `draftTouchImpl` calls `upsertTouch` without a `touchId`, so the
upsert's update branch cannot be reached through any sanctioned dispatch path.

> **The effect contract describes reachable governed behaviour, not latent helper capability.**

`UPDATED`, `ASSERTED`, `REQUESTED` and `APPROVED` arrive by migration with the capabilities that can
legitimately reach them.

## 8. The effect sink, and the failure rule that makes it honest

Effects are staged in **module-private application memory**, reached through a symbol that is not
exported, so no caller can inject one. `noteEffect` is an internal instrumentation primitive.

> **PostgreSQL savepoint rollback does not rewind JavaScript memory.** A handler may stage effects
> and then throw. **The FAILED path must therefore discard the entire staged set before recording
> the FAILED invocation.**

| Path | Staged effects |
|---|---|
| REJECTED | zero — no handler ran |
| handler FAILED | savepoint rollback **and sink discarded** → terminal FAILED row, marker 1, **zero refs** |
| EXECUTED | retained → terminal INSERT → exact refs, same transaction |
| effect-ref INSERT fails after a successful handler | propagate → **outer transaction aborts everything** |

A FAILED or REJECTED invocation must **never** inherit staged refs from rolled-back work, and the
acceptance suite proves the *in-memory sink was cleared*, not merely that the database rolled back.

## 9. Atomicity

```
server UUID → handler mutation → handler ledger events → release savepoint
   → terminal invocation INSERT (same UUID) → effect-ref INSERTs → one outer commit
```

| Failure | What survives |
|---|---|
| handler throws | savepoint rollback discards business writes **and the handler's ledger rows**; FAILED row + zero refs |
| handler ledger write fails | handler throws → same FAILED path |
| terminal invocation INSERT fails | outer transaction aborts — nothing commits |
| effect-ref INSERT fails | outer transaction aborts — nothing commits |

> **No durable state may claim v1 completeness when required observations failed to persist, and no
> row may durably refer to an invocation that never commits.**

## 10. Ledger correlation

`change_ledger.invocation_id` is the canonical **one-to-many** relation. For the v1 registry
handlers, the server-preallocated id is threaded into **every** covered handler-level `recordChange`
call, so a marked invocation's ledger events all carry the same id.

**No inference of old links. No backfill. No proximity matching. No new FK.** For `marker = NULL`,
missing ledger linkage stays historically ambiguous, and it must be reported that way.

## 11. Schema — migration 0117 (116 → 117), additive

**The parent gains the tenant-composite candidate key first.** `governed_action_invocations` carried
only `PRIMARY KEY (id)` and `UNIQUE (org_id, skill_id, idempotency_key)`, so the required FK could
not be written. Adding `UNIQUE (org_id, id)` follows the device **0110** applied to
`pursuit_run_steps` and **0115** applied to the pre-existing, certified `pursuit_plan_revisions`;
those, not 0109's earlier statement, are the governing precedent. `id` is already globally unique
and `org_id` is already `NOT NULL`, so **the candidate key permits no business state that was
previously impossible** — it exists solely so the child relationship enforces that the observation
and its invocation belong to the same organization.

| Target | Change |
|---|---|
| `governed_action_invocations` | `+ observation_contract_version integer NULL`, immutable by omission; `+ unique (org_id, id)`; `+ CHECK` — NULL always legal, `1` legal **only** for the exact four registry `(skill_id, skill_version)` pairs, nothing else legal |
| **`invocation_effect_refs`** | new append-only table; tenant-composite FK `(org_id, invocation_id) → governed_action_invocations (org_id, id)`; RLS + FORCE; `app_rw` **INSERT/SELECT only**; `CHECK effect_relation = 'CREATED'`; `CHECK effect_kind in (campaign_touch, pursuit_plan_revision, pursuit_goal, pursuit_plan, motion_action, pursuit_team_member)`; `unique (org_id, invocation_id, effect_kind, effect_id)` |

**No arbitrary JSON. No prompt, body or argument payload. No foreign recipient data.** The table
stores a bounded relation, a bounded kind, and an identifier.

Deliberately absent: model usage table · receipt evidence table · outcome observation table ·
`agent_runs` migration · any `emitted_event_id` writer · any synthetic run · any 2C-B artefact.

## 12. Execution compatibility is not observation completeness

> **An old runtime may execute correctly after rollback while writing invocations with
> `observation_contract_version = NULL` and no effect refs. That is observation-INCOMPLETE, not
> corrupt — and future P8 must interpret those invocations as NOT OBSERVED UNDER P8-0, regardless of
> their timestamp.**

There is **no feature gate**: this is additive observation, not an authority boundary, and inventing
a gate would imply a risk that does not exist. The first hosted v1 observation boundary is recorded
during rollout as **operational evidence only** — P8 never uses it to infer completeness, because a
timestamp cannot survive an execution-compatible rollback.

## 13. No user-visible surface

Backend evidence infrastructure only. No dashboard, no P7 surface, no MCP observation tool, no new
user-facing status. P45-4's **"Drafted by \<governed actor\>"** is unchanged.

## 14. THE FROZEN v1 PROMISE

> **For an exact `skill_id@version` in the P8-0 v1 effect-observed registry, a terminal
> non-EXTERNAL_ACTION invocation marked `observation_contract_version = 1` atomically records, in the
> same transaction as its invocation row, every effect required by that capability's declared v1
> effect contract. Every covered handler-level `change_ledger` event written during that invocation
> carries the same server-allocated canonical invocation ID. Zero effect rows is meaningful only for
> a marked invocation whose exact capability/version is covered by v1. For an unmarked invocation or
> a capability outside the registry, absence means NOT OBSERVED UNDER v1, never that no effect or
> event occurred. Provider receipts, model telemetry, execution→outcome relation, causal attribution
> and per-attempt timing are not promised by v1 and remain UNESTABLISHED.**

## 15. Deferred semantics, frozen now so they cannot drift

**Causation remains UNESTABLISHED**, and the two relations a future slice may add are already
distinguished so neither can later be reinterpreted:

| Relation | Evidence class | Causal status |
|---|---|---|
| `OBSERVED_AFTER` | DERIVED — deterministic temporal/subject association only | **UNESTABLISHED** |
| `HUMAN_ATTRIBUTED` | DIRECT declaration — a human said the execution contributed | **UNESTABLISHED as a system fact** |

Future causal evidence — experiment, holdout, instrumentation — arrives under a **new** relation and
evidence class. **Existing `OBSERVED_AFTER` and `HUMAN_ATTRIBUTED` records are never reinterpreted.**

Also UNESTABLISHED in v1: external provider receipts · correlated model usage · per-attempt timing
(the runtime counts attempts on the step but cannot reconstruct when each pre-dispatch attempt
occurred) · plan/basis for direct MCP execution, because **no run exists and none is manufactured**.

## 16. P8 hook contract

**DIRECT** — plan/revision identity and run-start `basis_fingerprint` (runs only) · recommendation
basis and `responds_to_revision_id` · human `adjustments` · run/step identity and attempt **count** ·
invocation identity, skill, version, status, reason class · actor, credential, grant · **effect refs
for marked registry invocations**.

**DERIVED deterministic** — ledger events via `change_ledger WHERE invocation_id = ?`, one-to-many,
where threading has run.

**UNESTABLISHED** — everything in §15.

> **P8 may never convert UNESTABLISHED into `false`, `0`, "no effect" or "unrelated", and may never
> read a relation observation as causal.**


---

## 17. Hosted acceptance — P8-0 HOSTED ACCEPTED / CLOSED (2026-09-20)

**Schema 117.** Canonical runtime **P8-A `dpl_BTiW1EiqRGHMTJTPYPVFv1QPks7R`**, source
**`1f4fabb6d216d86c9e5038b97d44a5a0b34e2c6c`**. Observation-complete rollback **P8-B
`dpl_u9YPaENRa7pzi8Vp7gBtn88hHXMk`**, same source.

### 17.1 Two boundaries, neither of them an authority boundary

| | |
|---|---|
| **O1 — first committed hosted v1 observation** | **2026-09-20T17:10:40.972Z** · invocation `af4c9376-4e09-43d7-9945-4a9163a28b9c` · `draft_campaign_touch@1` · **1 effect ref** |
| **O2 — canonical activation** | **2026-09-20T17:12:28Z** · the canonical hostname began serving P8-A |

> **O1 and O2 are OBSERVATION boundaries, not authority boundaries. P45-4 authority did not change
> at either: enforcement stayed true, the actor, grant and bound credential were untouched, sending
> stayed disarmed and the P45 runtime stayed at zero.** This is the clearest difference from
> Boundary A and Boundary B, which *were* authority boundaries and retired rollback targets.

### 17.2 The seven persistent marked invocations, and the eight refs

| # | Invocation | Surface | Capability | Refs |
|---|---|---|---|---|
| 1 | `af4c9376…` **O1** | P8-A direct (`/api/mcp`) | `draft_campaign_touch@1` | **1** |
| 2 | `49d852ad…` | P8-A direct | `draft_campaign_touch@1` — successful no-match | **0** |
| 3 | `81443af0…` | **P8-B direct** | `draft_campaign_touch@1` — standby certification | **1** |
| 4 | `80074789…` | P8-A Server Action | `recommend_pursuit_plan@1` — fresh pursuit | **3** |
| 5 | `c064a66f…` | P8-A Server Action | `recommend_pursuit_plan@1` — UNCHANGED (D-028) | **0** |
| 6 | `7f525617…` | P8-A Server Action | `decide_pursuit_plan@1` — with staging | **2** |
| 7 | `5a99c8f1…` | **canonical alias** (post-O2) | `draft_campaign_touch@1` | **1** |

**1 + 0 + 1 + 3 + 0 + 2 + 1 = 8**, matching `invocation_effect_refs` exactly. The transactional
`assemble_pursuit_team@1` observations were rolled back and are deliberately **not** in this count.
Every marked invocation is a v1 registry capability; every effect ref belongs to a marked one; and
**no `send_campaign_touch` dispatch has ever existed**.

### 17.3 Certification surfaces, stated exactly

| Evidence | Substrate |
|---|---|
| permanent `p8-0` suite **43/0** | its required **SEEDED_CLONE** substrate. It is **intentionally not runnable against canonical Preview**, because its fixture model depends on clone disposal rather than transactions — pointing it at the canonical world would trip its own guard and leave residue. |
| hosted invariant harness **22/0** | canonical Preview, **one transaction, rolled back**, no residue. **Not the same artefact as the permanent verifier.** |

| Capability | Proving surface |
|---|---|
| `draft_campaign_touch@1` | **deployed product path** (`/api/mcp`) |
| `recommend_pursuit_plan@1` | **deployed product path** (pursuit-page Server Action) |
| `decide_pursuit_plan@1` | **deployed product path** |
| `assemble_pursuit_team@1` | **hosted transactional verifier** — no externally callable app route presently exists |

**43/0 is not a hosted canonical-Preview run, and the 22-test harness is not the permanent verifier.
Those two sentences are the record.**

### 17.4 P8-B, certified rather than assumed

Invocation **`81443af0-cb82-438e-9bf9-069e0a25019f`**, `2026-09-20T17:10:42.847Z`,
`draft_campaign_touch@1`, **EXECUTED**, marker **1**, **one** ref
`CREATED / campaign_touch / 43331f0d-0178-4f76-8975-495ecf6201e4`, actor `a3f6ad1e…`, governed actor
`9e5f147e…`, grant `723d1431…`, `run_step_id` **NULL**, no synthetic run, **no send**, fixture cleaned.

**The request demonstrably reached P8-B's own deployment**, which the database alone cannot show:
Vercel's runtime logs for `dpl_u9YPaENRa7pzi8Vp7gBtn88hHXMk` record exactly **one** `POST /api/mcp`,
at `17:10:42.64Z` on host `pursuitos-demo-80gvgem8j-…`, ~200 ms before the invocation row. P8-A's
logs show its own three POSTs at different instants — two on its direct host and one on the
canonical alias after O2 — so the four executions are attributable to distinct surfaces rather than
inferred from timing.

**P8-B is classified OBSERVATION-COMPLETE / EXECUTION-COMPATIBLE / P45-STRICT ROLLBACK.**

### 17.5 Rollback map

| Class | Deployment |
|---|---|
| **Preferred observation-complete rollback** | **P8-B `dpl_u9YPaENRa7pzi8Vp7gBtn88hHXMk`** (`1f4fabb`) |
| Execution-compatible / **observation-incomplete** fallback | `dpl_3CiYuRLR4eZ8ZW3QaM89XN3zLEeo` (`7c4aea5`) — schema-117-compatible and P45-strict, but writes `observation_contract_version = NULL` |

**These are not equivalent.** An observation-incomplete rollback creates a legitimate **evidence
gap**, not database corruption. No deployment was removed in this phase.
