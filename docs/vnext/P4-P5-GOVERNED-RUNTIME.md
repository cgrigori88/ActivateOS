# PursuitOS vNext — P4 / P5 Governed Pursuit Runtime

**Status:** **P45-1 MIGRATION 0109 — HOSTED ACCEPTED** (2026-09-16) · hosted migration level **109** ·
flag default **OFF** · runtime tables **empty** · no external sending.
**P45-D1 — HOSTED CORRECTED / CLOSED.** **P45-1 — HOSTED ACCEPTED / CLOSED (2026-09-16).**
P4's first governed actor + explicit capability grant and P5's first durable Pursuit execution are
both **PROVEN HOSTED** through the real `app_rw` runtime. Fixture removed; **159/159 fingerprints
restored exactly**. Slice 2 **not started**.

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


---

## 11. Hosted migration gate — 0109 ACCEPTED (2026-09-16)

**Serving `2f16091` as `dpl_8MDMbJwHiKePAExe6xRifxhfsASh`** (Preview, READY) · `mejokqxriwyawfhawuxu` ·
`app_rw` / bypassRls false / tenantEnforcement true / probe live / sending off. The pre-migration
Preview (`d1f6023`, `dpl_5Gy8Dnm4jXDaNuNY7WSXzzQvtsnP`) was verified healthy against migration level
**108** first, proving the new application code is compatible with the un-migrated database.

### A defect caught at the gate, before applying

0109 was the **only** migration in the repository carrying its own `begin;`/`commit;`. Every other
migration lets the **applier** own the transaction — `scripts/migrate.ts` and the gate's
single-migration applier both wrap the file *and* the `schema_migrations` insert in one
`begin`/`commit`. An inner `commit;` would have ended that transaction early, leaving the ledger
insert un-atomic with the DDL it records: a failure between the two would have produced applied DDL
with no ledger row. Fixed in `2f16091` and re-verified before application.

### Structure, RLS and ACLs — 42/0

Four tables created; RLS **ENABLE + FORCE** on all four with exactly one `app_rw` policy each,
`is_org_member(org_id)` for both USING and WITH CHECK. `governed_actors` carries the
`USER/AGENT/WORKER/SYSTEM` vocabulary, `unique(org_id, key)`, the ACTIVE-USER-requires-principal
CHECK, and **no foreign key on `principal_user_id` or `owner_user_id`**. Grants carry the composite
`(org_id, actor_id)` reference and partial-unique live-grant index. Runs carry the plan/revision/
basis pin, composite actor reference, `unique(org_id, idempotency_key)` and the one-non-terminal-run
partial index. Steps carry the composite run reference, `unique(run_id, seq)`,
`unique(org_id, idempotency_key)`, **no DAG column**, and no worker-only required field.

**ACL finding, investigated rather than assumed.** `anon`, `authenticated` and `service_role` hold
`REFERENCES, TRIGGER, TRUNCATE` on the four new tables. This is **not** something 0109 introduced —
0109 grants only to `app_rw`. **155 of 155 pre-existing tables carry exactly the same grant set**,
which is the Supabase project-wide default already covered by every accepted security hash since
Gate 1b.1. None of the three roles can log in. The new tables are therefore **identical to the
certified baseline**, with no DML and no `PUBLIC` grant at all. `app_rw` holds `SELECT, INSERT` at
table level and column-level UPDATE on exactly the intended columns — **4 / 2 / 7 / 10**.

*(Tightening that platform default is a project-wide question affecting all 159 tables, not a P45-1
matter; it is recorded here, not acted on.)*

### Tenant consistency — 9/0, rollback-only, zero residue

A Vertex grant **cannot** reference a Meridian actor; a Vertex run **cannot** reference a Meridian
actor; a Meridian step **cannot** reference a Vertex run — each refused by the **composite foreign
key**, relationally, before RLS is consulted. Under the real `app_rw` login (BYPASSRLS false): no
tenant context sees **zero** rows on all four; Org A context sees only Org A; and Org A **cannot**
insert a row for Org B (RLS `WITH CHECK`). Every write was rolled back; all four tables remain empty.

### Existing contracts preserved — Parts J/K

`change_ledger.actor_id`, `governed_action_invocations.actor_id`, `pursuit_plan_revisions.actor_id`
and `pursuit_goals.proposed_by_actor_id` are **all still uuid, still nullable, still without a
foreign key** — unchanged type, meaning and behaviour. The runtime uses distinct
`governed_actor_id` / `run_id` / `run_step_id` / `invocation_id` columns, all nullable, and **zero
existing rows were backfilled**.

### Fingerprints — every movement explained

| | before | after |
|---|---|---|
| migrations | 108 | **109** |
| tables | 155 | **159** |
| policies | 380 | **384** (exactly the 4 new) |
| table grants | 620 | **636** (0 existing changed) |
| column grants | 11 | **34** (+23 = 4+2+7+10) |
| functions / triggers / roles / protected | 149 / 12 / 32 / 31 | **identical** |
| security hash | `2a5ea0509145ee81` | **`569e5497a7622048`** |
| whole-world | `933a5e30d79297a4` | **`c299c6e372c686c4`** |
| business-data | `c56a1d229e483f2b` | **`6abe424f43bff901`** |

**business-data moved, and the gate required this to be explained rather than accepted.** It is a
definitional property of the metric, not a data change: `businessFingerprint` hashes the *entire*
table→`rows:hash` map (excluding only `schema_migrations`), so four new tables necessarily move it.
Three shared tables also moved — `schema_migrations` (108→109 rows, the ledger itself) and, with
**identical row counts**, `change_ledger` (68→68) and `governed_action_invocations` (28→28), because
the per-table hash is `md5(row::text)` and the new nullable columns change every row's serialisation.

> **Proven, not asserted:** recomputing each of those two tables' hash over **only its original
> columns** reproduces the pre-migration value **exactly** —
> `change_ledger` `68:c955c9fcdc14a043ed8591e73a1fc3af` and
> `governed_action_invocations` `28:aadc6e1c0ec2b6d19b98fa153c677d0a` — and every new column is NULL
> on every existing row. Canonical counts are unchanged (3 orgs / 14 companies / 19 opportunities /
> 14 pursuits / 2 snapshots). **No business row changed.**

### Flag-OFF compatibility — 16/0

Two signed-in 37-room crawls, 4 passes: **37/37 rooms 200, all passes byte-identical, and 37/37
BYTE-IDENTICAL to the accepted Gate-9 baseline.** Meridian 0 under Vertex; owner rooms, joint
boundaries, palette, CDW label, Stark disclosure, most-common-outcome and the D-G8-1 order all
intact; Today, Queue, Pipeline, Partners, Joint and Admin unchanged. **No runtime table acquired a
row.**

### Regression and safety

persisted 17/0 · semantic 50/0 · dg85 19/0 · dp1 26/0 · partnership-app-rw 117/0 · tenant-isolation
205/0 · search-path 39/0 · catalogue guard 12/0 (**31 protected / 0 unsafe**) · rehearsal 38/38 + 6/6.
**Zero failures — the gate's STOP condition was never triggered.**

Runtime tables **0/0/0/0**; no fixture orgs; no new invocation or ledger row; **0 of 159 per-table
fingerprints moved** across all gate probing. Send **0/0/0/0/0**; `OUTREACH_AUTOSEND` and
`RESEND_API_KEY` absent; Vercel env **38 total / 18 branch-scoped / 33 Preview-visible**,
byte-identical to the Gate-9 inventory. Production untouched; `qifatlqxfuhwrwvpbwsc` never contacted.

### Owner rulings recorded

**1 — `principal_user_id` without an FK is APPROVED FOR SLICE 1**, on the stated boundary: an ACTIVE
USER actor still requires a non-null principal (DB CHECK, verified hosted), `owner_user_id` never
substitutes for identity, and runtime principal matching stays enforced. **This is NOT the final
production identity model.**

> **RECORDED REQUIREMENT:** before non-synthetic / real-user operation, principal identity binding
> **must be revisited and strengthened** — through an additive migration adding the foreign key once
> `auth.users` is populated, or an equivalent validated identity model.

**2 — the runtime MAY read `org_features.governed_action` directly**, and must not route through
`governedActionEnabledFor()` while that helper imports the experience/federation chain. The effective
gate remains **both** `VNEXT_CONTROL_PLANE_ENABLED` **and** the per-org column, with the global flag
authoritative.

### HOSTED RECORD OF RECORD, updated

migrations **109** · business-data **`6abe424f43bff901`** · whole-world **`c299c6e372c686c4`** ·
security **`569e5497a7622048`** · protected **31 / 0** · `app_rw` LOGIN true / BYPASSRLS false ·
serving `2f16091` as `dpl_8MDMbJwHiKePAExe6xRifxhfsASh`.

### DISPOSITION

**P45-1 MIGRATION 0109 — HOSTED ACCEPTED.** The schema/security substrate is accepted.
**P45-1 functional/runtime acceptance remains OPEN** — no hosted run, actor, grant or step has been
created, and the runtime has never executed hosted. **Slice 2 NOT STARTED.**


---

## 12. DEFECT P45-D1 — the runtime could not execute under `app_rw` (found hosted, corrected locally)

### What was wrong

`runtime.ts` appended its ledger event with `recordChange` and then **UPDATEd that row** to attach
`run_id` / `run_step_id` / `invocation_id` / `governed_actor_id`:

```
ERROR 42501: permission denied for table change_ledger
```

`change_ledger` is **append-only for `app_rw`** — `INSERT, SELECT`, zero column-level UPDATE — a
deliberate certified invariant ("history is corrected by appending", 0094 / 0103 §4). The follow-up
UPDATE succeeds as the owner and is refused as `app_rw`, so the enclosing `withTenantOrg`
transaction rolled back and **no run could ever reach `COMPLETED` under the real runtime identity.**

### Why 45/45 locally did not catch it — a defect in the TEST, not only in the code

`scripts/p45-runtime-verify.ts` executed `startRun` / `resumeRun` on `owner.connect()` (BYPASSRLS,
full DML) and used `app_rw` **only** to assert RLS visibility. It was therefore *structurally unable*
to detect a privilege defect. The hosted gate found it precisely because it ran the product's own
`withTenantOrg` against the real `app_rw` login.

### The correction

`recordChange` now accepts the four linkage fields and writes them **in the original INSERT**; the
follow-up UPDATE is deleted. The append-only invariant is **strengthened, not relaxed** — no caller
needs UPDATE on `change_ledger` and none has it — and the write is now atomic, so there is no window
in which a ledger row exists unlinked.

**No migration. No grant, permission or RLS change.** `app_rw` on `change_ledger` remains exactly
`INSERT, SELECT` with **0** column-level UPDATE grants. The alternative — granting `app_rw` UPDATE —
was rejected: it would weaken a certified invariant to accommodate a fixable implementation error.

### Proven, not assumed

The corrected suite executes the runtime through **`withTenantOrg` on the real `app_rw` login** and
passes **50/50**. A **negative control** reintroduced P45-D1 verbatim and the corrected suite went
**FATAL with the exact hosted error** (`permission denied for table change_ledger`) — so the test gap
is genuinely closed, not merely stepped around. Four new assertions cover the invariant directly:
`app_rw` executed with BYPASSRLS false; it can SELECT the rows it wrote; it **cannot** UPDATE a prior
ledger row; it **cannot** DELETE one; and the linkage is present on every row without any UPDATE
having occurred.

---

## 13. PERMANENT ACCEPTANCE REQUIREMENT — real runtime identity

> **Every P45 gate, now and in future slices, must exercise runtime execution through the REAL
> `app_rw` identity and the product's own tenant-binding path (`withTenantOrg` / `withTenant`).
> Executing the runtime on the owner pool is not acceptance evidence.**

Rules, binding from here:

1. **Execution identity.** `startRun`, `resumeRun`, `pauseRun`, `resumeAfterPause` and any future
   runtime entry point are invoked through `withTenantOrg(orgId, …)` with `DATABASE_URL` pointed at
   the `app_rw` login. A suite that executes them as the owner does not certify the runtime.
2. **Owner authority is scoped.** The owner connection may be used **only** for fixture setup,
   cleanup, and cross-org assertions that must see past RLS. It may never be the execution identity.
3. **Privilege assertions are mandatory.** Each gate asserts, under the real login, that `app_rw`
   reports `BYPASSRLS false`, and that the append-only tables reject UPDATE and DELETE.
4. **Local green is not sufficient on its own.** Any behaviour proven only as the owner is recorded
   as *unproven under the runtime identity* until a gate demonstrates it as `app_rw`.
5. **New privilege surfaces.** When a slice adds a table or column the runtime writes, the gate must
   state the exact `app_rw` grant it relies on and prove the runtime works within it — rather than
   discovering the gap in production.

Retry/backoff, budget exhaustion, crash recovery, pause/resume, supersession and replay are all now
exercised under `app_rw` in the 50/50 suite, so the earlier caveat that they were "owner-only proven"
no longer applies.


---

## 14. CFR-1.2 — the clock-derived comparison rule (adopted 2026-09-16)

`CFR-1.1` covered one field (`days_since_activity`). The P45-D1 hosted gate showed the pilot baseline
is a **living synthetic world whose derived metrics move with the clock** — day counters, rolling
windows, record ages — so a crawl captured at time *T* cannot be reproduced byte-for-byte at *T+Δ*,
and will drift again at every future gate. `CFR-1.2` makes that explicit and narrow.

> **Clock-derived output may differ from an accepted baseline ONLY when the difference is
> deterministically recomputable from unchanged canonical source data and an explicitly identified
> time-dependent expression. Everything else remains strict.**

**This is not a tolerance for changing text, counts, ordering, membership or metrics.** A permitted
difference must satisfy **all five**:

1. The database fingerprints for the relevant canonical records are **unchanged**.
2. The changed value traces to a **named time expression in product source** — `now() - <ts>`,
   elapsed day/hour counters, rolling time windows, invite/record age, freshness/recency.
3. The new value **recomputes exactly** from the source data and the current clock.
4. **Nothing unrelated changed** — text, structure, ordering, permissions, tenant visibility,
   disclosure behaviour or record identity.
5. A window change that alters **cohort membership or an aggregate** must name the exact record(s)
   entering or leaving and **reconcile the count/value mathematically**.

**Any unexplained difference remains a STOP, even if it looks time-related.**

### Reporting: two classes, reported separately

| class | contents | tolerance |
|---|---|---|
| **STRICT** | structure, identities, ordering, non-time-derived text and metrics, permissions, visibility, disclosure, canonical membership, and all other deterministic output | **zero** |
| **CLOCK-DERIVED** | only the validated expressions above, each with source-recomputation evidence | permitted, itemised |

**The whole-world and per-table database fingerprints are NOT weakened — they remain exact.**
CFR-1.2 governs *rendered output comparison only*.

The gate tooling (`crawl-compare.mts`, session scratchpad — **no product source changed**) emits both
the **raw digest**, preserved for audit and expected to move, and a **normalized digest** that masks
only the approved clock-derived fields. Two crawls are equivalent under CFR-1.2 when the STRICT class
is empty **and** the normalized digests match.

---

## 15. Crawl re-baseline — accepted 2026-09-16 (CFR-1.2, Option A applied)

**`crawl-p45d1b` replaces `crawl-p45` as the accepted crawl baseline**, on this evidence:

- **Determinism:** 37/37 rooms 200, **all 4 passes byte-identical**.
- **STRICT class: 0 differences.** Line counts identical in every room.
- **NORMALIZED digest identical: `107b17e3f5f1b24d`** on both sides. (Raw digests
  `fe736e9a569f3493` → `8f33a5eff68fa481`, preserved for audit.)
- **Database: 0 of 159 per-table fingerprints changed** across the whole phase — deploy, append-only
  probe and both crawls. business-data `6abe424f43bff901`, whole-world `c299c6e372c686c4` and
  security `569e5497a7622048` all **identical**.

**The 30 observed differences, classified exactly:**

| # | class | difference | validation |
|---|---|---|---|
| 23 | elapsed-day counters | `N days` → `N+1 days` | `extract(day from now() - <ts>)` — `divergence.ts:33`, `today.ts`, `projection.ts`. All 19 seeded opportunity timestamps cluster in **one hour**, so their 24-hour anniversaries coincide; `next increment in 1438 min` (≈23.97 h) confirmed the tick |
| 6 | rolling 90-day aggregate | `$1.78M` → `$1.17M`, `4 deals` → `3 deals` (×3 rooms) | **`Hist · DR modernization` ($610,000)** crossed `closed_at >= now() - interval '90 days'` (`today.ts:297`). **1,780,000 − 610,000 = 1,170,000** exactly; **4 − 1 = 3**. The single record entering/leaving is named and the aggregate reconciles |
| 1 | invite age | `"1d"` → `"2d"` (split across lines by the extractor) | `floor(extract(epoch from now() - coalesce(invited_at, created_at)) / 86400)` — `intelligence.ts:154`. **Recomputed hosted as exactly `2`**, matching the candidate, against an unchanged record |

**No structural, ordering, membership, disclosure, tenant or canonical-data regression occurred**, with
the one exception being the **expected membership change inside the explicitly time-bounded 90-day
derived metric**, reconciled above. Meridian remains absent under Vertex; owner rooms healthy; joint
boundaries, palette, CDW label, Stark disclosure, most-common-outcome and the **D-G8-1 order
(Dana → Mike → Priya → Sarah)** all intact.

**The manifest digest movement** (`14e2e97f8453fb75` → `cbddf5de9433b9fd`) is **fully attributable to
`days_since_activity`** — `scripts/demo-manifest.ts:71`,
`extract(day from now() - o.updated_at)::int` — the exact field CFR-1.1 was adopted for. No other
manifest input changed.

**Canonical demo data was NOT modified or reseeded.**


---

## 16. P45-1 — HOSTED ACCEPTED / CLOSED (2026-09-16)

### Phase 1 — P45-D1 correction, hosted

`d742a77` pushed fast-forward and deployed as **`dpl_2syZQr94SCB2kyPpCs1vJN594BNV`** (Preview,
`app_rw` / bypassRls false / tenantEnforcement true / probe live / sending off). Env **38 / 18 / 33**,
byte-identical; `VNEXT_CONTROL_PLANE_ENABLED` **absent (OFF)** throughout. **0 of 159 fingerprints
moved merely because application code deployed.**

**Append-only contract, proven hosted under the real `app_rw` login — 9/9.** ACL is exactly
`INSERT, SELECT` with **0** column-level UPDATE grants. `app_rw` **CAN** insert through the corrected
`recordChange`; **CAN** select what it wrote; the row is **born with** `run_id` / `run_step_id` /
`invocation_id` / `governed_actor_id` (no follow-up UPDATE); and **CANNOT** update or delete it —
both refused with `permission denied for table change_ledger`. Rolled back; `change_ledger`
byte-identical at `68:d476182767fd6b54…`. **P45-D1 is corrected without adding a single permission.**

### Phase 2 — synthetic hosted functional acceptance, 48/48

Fully synthetic disposable world (Option A). **Globex was not used; no canonical stakeholder fact or
P3 row was altered.** The approved action's semantic was authored FIRST and the skill bound second:

```
nextAction.key : draft_campaign_touch:first
nextAction.text: "Draft the first campaign touch for … on the '… Renewal Outreach' campaign."
milestone      : first_touch_drafted (rule TOUCH_DRAFTED)   kind/decision: DECISION / APPROVED
```

**Every runtime execution ran through `withTenantOrg` on the real `app_rw` login** — the product's own
tenant binding — with owner authority confined to fixture setup and cleanup.

| part | result |
|---|---|
| **Two-gate feature** | global OFF+org OFF → disabled · global ON+org OFF → **disabled** · global ON+org ON → **enabled only then** · global back OFF → disabled. No execution during any refusal |
| **Governed USER actor** | ACTIVE, non-null principal distinct from `owner_user_id`, `PRODUCTION` |
| **Principal matching** | a wrong acting principal is **REFUSED**, no draft |
| **Capability grant** | no grant → **REFUSED**; and a grant does **NOT** override `required_permission` — `viewer` still refused |
| **Successful run** | step **COMPLETED**, run **COMPLETED**, **exactly ONE EXECUTED invocation**, **exactly ONE draft touch**, status `draft`, **no outbox row**, no provider call |
| **Audit chain** | P3 decision → run → step → actor → grant → invocation → draft → ledger, fully linked; `RUN_STARTED → RUN_COMPLETED`; every row carries run, step, governed actor, `GOVERNED_ACTION` and `data_environment`; generic `actor_id` semantics untouched |
| **Idempotent replay** | same run returned, no re-dispatch, **no second draft, no second consequential invocation** |
| **Pause / resume** | PAUSED is durable and does not dispatch; RESUME completes from persisted state on a fresh invocation; both are first-class ledger transitions |
| **Plan supersession** | **CANCELLED, reason `PLAN_SUPERSEDED`**, still pinned to the ORIGINAL revision, never retargeted, no draft, no consequential invocation |
| **Suspend / revoke** | SUSPENDED actor refused; REVOKED grant refused; neither created a draft or consequential invocation |

**An important distinction proven, not assumed:** a refusal **also records an invocation, with status
`REJECTED`** — that is the audit trail working. What must be unique is the **EXECUTED** one. Across the
whole gate: `EXECUTED 28 → 29` for the single successful run, with the refusals audited separately.

**Tenant / RLS:** execution `current_user = app_rw`, `BYPASSRLS false`, `app.org_id` = the synthetic
org. **No owner pool anywhere in the runtime execution stack.**

**Send safety:** `0 / 0 / 0 / 0 / 0` throughout; no outbox row; no provider call; `OUTREACH_AUTOSEND`
and `RESEND_API_KEY` absent; `draft_campaign_touch` remains `INTERNAL_WRITE`.

**Retry / failure paths** were not manufactured hosted — no product test hook was added and no hosted
state was damaged. The local `p45-runtime` **50/50** remains authoritative for retry/backoff, budget
exhaustion, crash recovery and failure classification, and those are now proven **under the real
`app_rw` identity**, not owner authority.

### Cleanup and restoration

Every acceptance row enumerated by exact id and removed in dependency order: 18 ledger, 7 invocations,
2 touches, 8 steps, 8 runs, 1 grant, 1 actor, 1 campaign, 18 revisions, 8 plans, 8 goals, 8 pursuits,
1 `org_features`, 1 organization, 1 company. No wildcard deletes; nothing outside the manifest.

> **159/159 per-table fingerprints EXACTLY match the pre-test baseline.** migrations **109** ·
> business-data **`6abe424f43bff901`** · whole-world **`c299c6e372c686c4`** · security
> **`569e5497a7622048`** · protected **31 / 0**. **No rebaseline.**

**Post-cleanup flag-off crawl: RAW digest `8f33a5eff68fa481` — byte-identical to the accepted
baseline.** STRICT 0, clock-derived 0. The acceptance left no trace whatsoever.

**Regression:** p45-runtime **50/0** · persisted 17/0 · semantic 50/0 · dg85 19/0 · dp1 26/0 ·
partnership-app-rw 117/0 · tenant-isolation 205/0 · search-path 39/0 · catalogue guard 12/0 (**31/0**)
· rehearsal 38/38 + 6/6.

### DISPOSITION

**P45-D1 — HOSTED CORRECTED / CLOSED.** **P45-1 — HOSTED ACCEPTED / CLOSED.**
**P4:** first governed actor + explicit capability grant **proven hosted**.
**P5:** first durable Pursuit runtime execution **proven hosted**.
Migration **109 unchanged**. Permanent Preview `controlPlane` remained **OFF** throughout.
**Slice 2 — NOT STARTED.**
