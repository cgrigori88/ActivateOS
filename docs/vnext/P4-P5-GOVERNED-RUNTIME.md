# PursuitOS vNext — P4 / P5 Governed Pursuit Runtime

**Status:** **P45-1 MIGRATION 0109 — HOSTED ACCEPTED** (2026-09-16) · hosted migration level **109** ·
flag default **OFF** · runtime tables **empty** · no external sending.
**P45-D1 — HOSTED CORRECTED / CLOSED.** **P45-1 — HOSTED ACCEPTED / CLOSED (2026-09-16).**
P4's first governed actor + explicit capability grant and P5's first durable Pursuit execution are
both **PROVEN HOSTED** through the real `app_rw` runtime. Fixture removed; **159/159 fingerprints
restored exactly**. **P45-2 (Slice 2) — HOSTED ACCEPTED / CLOSED** (2026-09-17) · hosted migration **110** · approval runtime and authorization substrate **proven hosted**. **Production human approval identity remains NOT PROVEN** — tracked separately. **P45-3 — SEQUENTIAL MULTI-STEP RUNTIME: HOSTED ACCEPTED / CLOSED** (2026-09-17) · hosted migration **111** · ordered multi-step runtime and generation-safe advancement **proven hosted**. Plan-derived program synthesis and DAG/parallel execution remain **separate future work**. Production human approval identity remains **NOT PROVEN**.

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


---

## 17. P45-2 — the approval lifecycle (Slice 2), implemented locally 2026-09-16

### The one rule

> **Approval authorizes continuation. It does not confer authority.**

Nothing in the approval path creates a capability, restores a revoked grant, reactivates a suspended
actor, bypasses principal matching, tenancy, feature gates or the send posture, or retargets a stale
run. A decision only unblocks work that was *already* governed.

### What was missing

`WAITING_FOR_APPROVAL` was schema-legal on runs and steps since 0109 but **unreachable**:
`governed_skills.approval_required` was read **nowhere** in `src/`, so nothing could produce it. There
was no Approvals surface and no application surface read the runtime at all.

### Migration 0110 — additive, append-only

`pursuit_run_approvals` with `REQUESTED | APPROVED | REJECTED | INVALIDATED`, plus the four ledger
values `APPROVAL_REQUESTED / GRANTED / REJECTED / INVALIDATED` (0103 §5 append pattern), plus a
`(org_id, id)` key on `pursuit_run_steps` so approvals can reference them tenant-consistently.

**Explicit request identity** (owner amendment): the `REQUESTED` row has its own id and a terminal row
**names** it via `request_id` — the request is never mutated. Enforced relationally:

- `pursuit_run_approvals_one_request` — one open `REQUESTED` per step;
- `pursuit_run_approvals_one_terminal` — **at most one terminal decision per request**;
- a composite self-FK `(request_id, org_id, run_id, run_step_id)` → `(id, org_id, run_id, run_step_id)`
  so a terminal decision **provably shares its request's org / run / step**;
- a shape CHECK giving each decision kind exactly the attribution it is entitled to — `INVALIDATED`
  carries **no deciding actor and a mandatory reason**, because it is system-governed, never a human act.

**`app_rw` receives `INSERT, SELECT` only.** UPDATE/DELETE are revoked and never re-granted. RLS
ENABLE + FORCE with `is_org_member(org_id)`. **No SECURITY DEFINER, no RLS weakening, no change to
`change_ledger` privileges, protected class still 31 / 0.**

### Policy — `approval_required_override`

```
TRUE  → REQUIRED (a grant may always NARROW policy)
NULL  → the canonical skill policy
FALSE → "not required" ONLY when the skill itself does not require it
```

**`FALSE` can never weaken a canonical requirement.** In Slice 2 every `approval_required = true` is
**hard**; a future soft-approval policy would need its own schema/policy change, and that abstraction
is deliberately not invented here.

### The recursion base case

The decision capability is **`decide_governed_action`** — neutrally named because one capability
authorises *both* outcomes, with `APPROVED | REJECTED` carried as the decision.
`effectiveApprovalRequired()` returns **false for it unconditionally**, so no grant override can force
an approval-of-an-approval. Without that base case the governance model recurses forever.

### Authority model

Approval is **itself a governed action**: the decider must be an ACTIVE `governed_actor` in the same
org, with a matching principal, holding a live grant for `decide_governed_action`, passing every
existing `dispatchSkill` check. **A governed actor cannot decide its own request.** Authority is
therefore explicit and grantable rather than inferred from UI visibility.

### The stale-authority rule

Authority at request time proves nothing about authority now, so it is re-evaluated **immediately
before continuation**. If the grant was revoked, the actor suspended, or the revision superseded while
the request waited, the request is **INVALIDATED** with that reason — a human must never be able to
approve an action that can no longer legally execute. `INVALIDATED` requests are **never** offered as
pending.

### The race — three independent arbiters, one transaction

1. **`pursuit_run_approvals_one_terminal`** — the *race arbiter*: exactly one terminal row commits.
2. **Compare-and-set** on the run and step out of `WAITING_FOR_APPROVAL` — the *runtime arbiter*.
3. **Step idempotency** (P45-1) — the backstop: even a double resume replays one invocation.

All inside **one transaction**, and the transition rowCount is checked: a durable `APPROVED` decision
can never commit while the run is stranded in `WAITING_FOR_APPROVAL` — it rolls back instead.

> **A defect found and fixed by the suite:** the decision's dispatch idempotency key originally omitted
> the decider, so a second approver was handed a **replayed** result instead of being evaluated on
> their own merits — a viewer could have inherited an operator's dispatch. The key was first scoped to
> the deciding actor, and then **removed entirely by the hosted gate** (§18, defect 1) because a
> decider-scoped key still cached a *governance refusal*. The unique index arbitrates the race;
> dispatch idempotency plays no part in a decision.

### The identity boundary — stated, not papered over

`decide()` resolves the principal **server-side** and **fails closed** if it cannot. A caller can
never nominate an approver.

- **Runtime authorization is provable today** — governed actor, lifecycle, org, principal match, live
  grant, tenant/RLS, all enforced server-side.
- **Production human identity is NOT proven**, because application auth is unconfigured here:
  `currentRole()` returns `"owner"` for every caller and no principal resolves. The interactive
  buttons therefore legitimately refuse in this posture, and say so.

The server model is **deliberately stricter than the demo can exercise**, and nothing was weakened to
accommodate it.

### Surface

`/approvals` — what is waiting, on which pursuit/account, what it would do, who asked, why a person
decides, and Approve / Reject, with a link through to the pursuit. Narrow by design; not a workflow
builder. **`WAITING_FOR_APPROVAL` is derived from the lifecycle, never stored twice** — the page and
Pursuit detail read the same `pendingApprovals` model, so there is one representation of the state.

### Local acceptance — `p45-approvals` 56/56

Every scenario runs through **`withTenantOrg` on the real `app_rw` login**. Policy resolution
(TRUE/NULL/FALSE + the recursion base case) · park with **no** invocation and **no** draft · resume
alone cannot release a pending approval · APPROVE resumes the **same persisted run** and **exactly one**
execution follows · append-only history with the terminal row naming its request and the request row
unchanged · `app_rw` can neither UPDATE nor DELETE approval rows · replayed APPROVE cannot duplicate
execution · a late REJECT cannot overturn a committed APPROVE · REJECT terminates durably as
`CANCELLED / APPROVAL_REJECTED` **without overloading the invocation vocabulary** · wrong principal,
ordinary viewer, self-approval and another tenant all refused with nothing executed · **grant revoked
→ INVALIDATED**, **actor suspended → INVALIDATED**, **revision superseded → INVALIDATED /
PLAN_SUPERSEDED** still pinned to the original revision · INVALIDATED never offered as pending · **the local
race set** (approve/approve, approve/reject, reject/reject) yields exactly one terminal decision, one
winner, the loser told *already decided*, and at most one consequential execution — note the hosted
race set differs (§18): it substituted approve/invalidate for reject/reject · both feature gates
· the decision capability never enters an approval workflow · **send 0/0/0/0/0**.

**Certification:** tsc clean · 429/429 · build clean · p45-approvals **56/0** · p45-runtime 50/0 ·
persisted 17/0 · semantic 50/0 · dg85 19/0 · dp1 26/0 · partnership-app-rw 117/0 · tenant-isolation
205/0 · search-path 39/0 · catalogue guard 12/0 (**31 / 0**) · rehearsal 38/38 + 6/6 ·
**`certify-world --runs 2` 94 clean / 0 failures, digest `f72d1ff0d6b07b42` stable**. Local world 160
tables / 1051 rows; **zero fixture residue**; canonical `approval_required` still false on all skills.

**Hosted untouched.** Not pushed, not deployed, 0110 applied **locally only**.


---

## 18. P45-2 — HOSTED ACCEPTED / CLOSED

### Phase 1 — migration gate, 24/24 + 11/11 reconciliation

0110 applied alone under the identity guard → level **110**. Every claim proven: 109→110 with nothing
else executed · table count 159→**160** solely from `pursuit_run_approvals` · RLS **ENABLED + FORCED**
· `app_rw` **exactly `INSERT, SELECT`**, no UPDATE, no DELETE, no column-level UPDATE · **no SECURITY
DEFINER** (26 definer functions unchanged) · `change_ledger` privileges unchanged · every CHECK / FK /
unique / partial-unique present as designed, including the **composite self-FK proving a terminal row
shares its request's org/run/step** and both the **one-request** and **one-terminal** invariants at the
database layer · the four approval values are the **only** ledger vocabulary change.

**Every movement classified against a declaration made BEFORE mutation:**

| moved | cause |
|---|---|
| `schema_migrations` 109→110 rows | the ledger row — the **only** shared table whose content moved |
| +1 table, 0 rows | `pursuit_run_approvals` |
| business-data `6abe424f43bff901` → **`9e1fbd166fe06450`** | the metric hashes the whole table map minus `schema_migrations`, so it moves **solely** because the new empty table joined it |
| whole-world `c299c6e372c686c4` → **`f27321cd8803f04b`** | new table entry + the ledger row |
| security `569e5497a7622048` → **`092a20af64a0444e`** | +1 policy and grants **on the new table only**; 0 removed; functions/triggers/roles/protected identical |

**Unmoved, as declared:** `change_ledger` content (the CHECK extension adds no column) ·
`pursuit_run_steps` content (the new key is catalogue-only) · **`governed_skills` at 18 rows**.

> **`decide_governed_action` was inserted by neither the migration nor the deploy.** `seedGovernedSkills`
> is called only by seed/verify **scripts**, `defFor` resolves from the **code registry**, and there is
> **no FK** from invocations to `governed_skills` — so the workflow needs no hosted policy row, and none
> was created. Approval was required for the fixture via the synthetic grant's
> `approval_required_override = TRUE`, so **canonical `governed_skills` was never touched**.

### Phase 2 — hosted functional acceptance, 60/60

Synthetic Option-A world; every execution and decision through **`withTenantOrg` on the real hosted
`app_rw` login**; owner authority only for fixtures and cleanup.

**Request** — parks in `WAITING_FOR_APPROVAL` with one immutable `REQUESTED` record, **no consequential
invocation, no draft**; ordinary `resumeRun` cannot release it; visible only in the correct tenant.
**Approve** — self-approval refused; an authorized decider passes the full P4 path with a
server-resolved principal; the terminal row **references the original request** and names its decider;
the **REQUESTED row is unchanged**; the **same persisted run** resumes; **exactly one** consequential
execution; replay cannot duplicate. **Reject** — a terminal human-decision record, run/step
`CANCELLED / APPROVAL_REJECTED`, **invocation policy-REJECTED semantics untouched**, no execution,
replay safe, a later APPROVE cannot overturn it. **Invalidation** — grant revoked, actor suspended and
revision superseded each yield **INVALIDATED** with the right reason, the run **CANCELLED still pinned
to the original revision**, never retargeted, and the request **disappears from the pending read
model**. **Authority failures** — wrong principal, ordinary viewer, self-approval, wrong tenant,
**suspended decider**, **revoked decision capability** — all refused, none mutating the pending approval
or executing anything. **Concurrency** — **APPROVE vs APPROVE — hosted · APPROVE vs REJECT — hosted · APPROVE vs
INVALIDATE — hosted · REJECT vs REJECT — locally proven, NOT separately rerun hosted.** Each race
executed gives **exactly one terminal row, one winning transition, the loser `already decided`, no
stranded APPROVED+WAITING, at most one consequential execution and exactly one approval ledger
transition**. REJECT-vs-REJECT is closed on the **generic** `pursuit_run_approvals_one_terminal`
invariant — which is decision-value-agnostic and was proven hosted by the three races above — plus the
local race proof. It was **not** rerun hosted, and this gate does not claim it was.
**Append-only under real `app_rw`** — CAN insert and select, **CANNOT update a request, CANNOT update a
terminal decision, CANNOT delete either**, linkage present at INSERT. **Audit chain** — P3 revision →
run → step → request → requester → decider/principal → invocation → effect, with
`RUN_STARTED → APPROVAL_REQUESTED → APPROVAL_GRANTED → RUN_COMPLETED` in one ledger, no parallel model.
**Send 0/0/0/0/0** throughout.

### Two defects the hosted gate found in my own implementation

1. **A cached governance refusal.** The decision dispatch carried an idempotency key, so a retry after
   authority *changed* replayed the stale refusal — an approver refused for permission, then granted
   it, would still be refused. The key is **removed**: governance is re-evaluated every attempt, and
   duplicate effects remain impossible because `pursuit_run_approvals_one_terminal` is the designated
   arbiter. Dispatch idempotency was never load-bearing here.
2. **A user-visible change from a flag-OFF feature.** `decide_governed_action` was registered in
   `SKILL_REGISTRY`, which the Pursuit detail Federation panel lists as "actions you can take" — adding
   two lines to that page with the capability switched off. Caught by the **CFR-1.2 STRICT class**.
   Moved to `COORDINATION_SKILLS`, which `defFor` resolves but the panel does not list and
   `seedGovernedSkills` does not mirror. This also makes the recursion base case **structural**: with no
   policy row, there is nothing an operator could edit into requiring an approval-of-an-approval.

### Cleanup and restoration

Every acceptance row removed in dependency order by exact id: 28 ledger · 17 invocations · 2 touches ·
9 steps · 9 runs · 40 grants · 40 actors · 10 campaigns · 22 revisions · 10 plans · 10 goals ·
10 pursuits · 10 `org_features` · 10 organizations · 10 companies.

> **160/160 per-table fingerprints EXACTLY restored** to the post-0110 baseline, re-verified again after
> the crawls: **0 of 160 moved**. business-data `9e1fbd166fe06450` · whole-world `f27321cd8803f04b` ·
> security `092a20af64a0444e` · protected **31 / 0** · `governed_skills` still 18 · organizations 3.
> **No canonical residue. No rebaseline.**

**Flag-off crawl (CFR-1.2):** 37/37, 4/4 deterministic, **STRICT class 0**, line counts match,
**normalized digest identical `107b17e3f5f1b24d`**; the 3 clock-derived differences are validated
elapsed/age counters. **Regression:** p45-approvals 56/0 · p45-runtime 50/0 · persisted 17/0 · semantic
50/0 · dg85 19/0 · dp1 26/0 · partnership 117/0 · tenant-isolation 205/0 · search-path 39/0 · catalogue
12/0 (**31/0**) · rehearsal 38/38+6/6 · **`certify-world --runs 2` 94 clean / 0 failures, digest
`f72d1ff0d6b07b42` stable**. Env **38 / 18 / 33** byte-identical; **`VNEXT_CONTROL_PLANE_ENABLED`
remained ABSENT (OFF)** throughout.

### DISPOSITION

**P45-2 approval runtime — HOSTED ACCEPTED / CLOSED.**
**P4 approval authority — proven hosted.** **P5 `WAITING_FOR_APPROVAL` continuation — proven hosted.**

> **What this does NOT claim.** The interactive decision path resolves the principal server-side and
> **fails closed**; application auth is unconfigured, so **production human approval identity is NOT
> proven** and the hosted Approvals buttons legitimately refuse. This is a **remaining
> production-readiness boundary**, tracked separately — not a Slice 2 defect, and nothing was weakened
> to make it appear satisfied.

**HOSTED RECORD OF RECORD:** migrations **110** · business-data **`9e1fbd166fe06450`** · whole-world
**`f27321cd8803f04b`** · security **`092a20af64a0444e`** · protected **31 / 0** · `app_rw` LOGIN true /
BYPASSRLS false · serving `25c62db`. **Slice 3 NOT STARTED.**


---

## 19. P45-3 — SEQUENTIAL MULTI-STEP RUNTIME (local implementation)

**Status: implemented and certified LOCALLY. Migration 0111 applied to the local world only. Nothing
pushed, nothing applied hosted.**

### What this slice is, and what it deliberately is not

A run now carries an **ordered program** of steps, `seq 1..N`, executed strictly in order, **one
consequential step per `resumeRun` call**. That is the whole capability.

> **It is NOT the roadmap item "multi-step plans / DAG".** P45-3 proves the **sequential runtime
> substrate**. **Plan-derived program synthesis and DAG/parallel execution remain separate, unstarted
> future work**, and closing P45-3 does not close that roadmap line. It is also unrelated to the
> product roadmap's own **"SLICE 3 — Portfolio Pertinence (P2)"**, which is untouched and still
> NOT STARTED.

Precisely stated: **a run pinned to a P3 revision can durably execute a CALLER-SUPPLIED ordered
governed program.** It does **not** prove the program was derived from, or semantically synthesized
from, the decided plan. `PlanContent`, `nextAction`, plan fingerprints, milestone shape and every P3
plan surface are **untouched** — the diff contains no file under `read-models/` or `coordination/`.
The persisted ordered step rows are the durable program snapshot for this slice.

### How little of this was actually new

0109 already gave steps a `seq`, a `unique (run_id, seq)`, a position-bearing idempotency key,
per-step retry state and `app_rw` INSERT on the table; `resumeRun` already selected the lowest-seq
eligible step and already had a "no steps left → COMPLETED" branch. Slice 1 simply never created a
second step, and **`ok ? "COMPLETED"` ended the run on the first success**. That one expression was
the entire single-step assumption.

### Migration 0111 — one word, and nothing else

`change_ledger.change_type` **+ `RUN_STEP_COMPLETED`**, via the certified 0103 §5 read-append-never-
rewrite pattern. **No table, no column, no privilege, no policy, no role, no RLS change, no
SECURITY DEFINER, no grant.** Verified locally after applying: **160 tables → 160**, `change_ledger`
privileges for `app_rw` still exactly **`INSERT,SELECT`**, and a second application is a **no-op**.

**THE AUDIT CONTRACT, stated so consumers cannot misread it (ruling 2):**

```
RUN_STARTED → RUN_STEP_COMPLETED → RUN_STEP_COMPLETED → RUN_COMPLETED      (a 3-step program)
RUN_STARTED → RUN_COMPLETED                                                (a 1-step program)
```

An **intermediate** success emits `RUN_STEP_COMPLETED`; the **final** success emits `RUN_COMPLETED`
and **not both**. So a completed program carries **(successful steps − 1)** `RUN_STEP_COMPLETED`
events — **do not infer that every completed step has one**. A one-step run is byte-for-byte the
Slice-1 chain, which is why P45-1 and P45-2 evidence stands without reinterpretation.

### The four invariants

1. **Atomic birth.** The run, every step row, the server-assigned sequence, each step's immutable
   skill/version/args/idempotency identity and `RUN_STARTED` are one unit. A **savepoint** inside
   `startRun` makes that a property of the function rather than of its caller, so even a caller who
   catches the error and continues in the same transaction cannot observe a partial program. **The
   caller never supplies `seq`** — `ProgramStep` has no such field; position comes from array order.
2. **Whole-program identity.** `run:<pursuit>:<revision>:prog:<sha(canonical program)>`, hashing each
   step's **position, skill, version, canonical args and milestone key**. `max_attempts` is excluded:
   how often we retry is execution policy, not a change to what is being done. Same program →
   **replay onto the same run**. Same steps **reordered** → a **different** program. A different
   program while one is **live** → **`ProgramConflictError`**, never a silent replay of work nobody
   asked for. `pursuit_runs_one_live` would refuse the insert anyway, but a bare unique violation
   cannot tell a retry from a different request, and the two deserve opposite answers.
3. **Every step boundary is a fresh authority boundary.** The actor is pinned for the program — **a
   pinned identity is not a pinned entitlement**. Eligibility, permission, the capability grant, the
   revision pin and the approval policy are re-derived per step. **One `resumeRun` advances at most
   one consequential step**; the program is never drained in a loop, because a loop would let one
   request carry authority the caller was never separately granted.
4. **Never skip forward.** Progress is the **lowest-seq step that is not COMPLETED**, whatever its
   status — so a later `PENDING` step is *structurally* unreachable while an earlier one is
   unresolved. Selecting on "eligible statuses" would have stepped over a `BLOCKED` step and run
   step 3 on the assumption step 2 happened. **P45-3 adds no BLOCKED recovery path**: a `BLOCKED`
   run is not resumable today and redefining that is deliberately not part of this slice.

### A defect this slice found in the Slice-2 carry-over

Slice 2 answered *"has this run been approved?"* from **`continuation.approvedRequestId`**, which is
**run-scoped**. With one step that was the same question. With a program it is not: **step 3 would
have sailed through the approval gate on the approval a human gave for step 2** — exactly the
cascade ruling 8 forbids, and invisible to any skill-scoped check because the next step may name the
very same skill. The gate now asks about the **step**, and asks **`pursuit_run_approvals`** — which
is append-only and which `app_rw` cannot rewrite — rather than the run's mutable continuation. That
is a strictly stronger source, and the advance replaces the continuation wholesale so an approval can
never outlive its step. **Proven by checks 46–48: two steps, same skill, two independent parks, two
separate `REQUESTED` records.**

### Concurrency — generation-bound, serialized, compare-and-set, no lease

`loadRun` takes `select … for update`, making read-decide-write a critical section per run.
`transitionRun` is a **genuine compare-and-set**: `from` was previously only the ledger's `before`
value and is now a predicate with a checked `rowCount`. The step's own idempotency key remains a
further line of defence, so even a lost race yields a duplicate *attempt*, never a duplicate
*effect*. **`locked_at` was deliberately NOT activated** — no lease, no expiry, no crash-recovery
protocol, because a request-triggered INTERNAL_WRITE runtime needs none.

**But serialization alone was not sufficient — see §20, defect P45-3-D1.** A resume request may now
advance only the **run-step generation it observed when the request began**.

> **FUTURE BOUNDARY, recorded now:** do not generalize a long-held database transaction across an
> external/provider action. That needs its own worker/claim design. EXTERNAL_ACTION steps are out of
> scope here in any case.

### Cancellation — CANCELLED never means "nothing executed"

Completed steps keep their effects and stay `COMPLETED`. **P45-3 invents no compensation, rollback,
undo or reverse skill** — the runtime has no authority to synthesize an inverse the registry never
declared. What it owes instead is an unambiguous halt point, so every cancellation (including
`PLAN_SUPERSEDED`) now records `stepsTotal`, `stepsCompleted`, `lastCompletedSeq`, `haltedAtSeq` and
`effectsRetained` in the ledger.

### Local certification

**`p45-program` 69 / 0**, every run and decision through **`withTenantOrg` on the real `app_rw`
login**. Atomic creation and its zero-residue failure · empty and invalid programs refused · replay,
reorder and conflict · one step per call · the cursor advancing inside the same CAS · the audit
contract, including a one-step run proving no new event · failure/block halting without skipping ·
partial cancellation with effects retained and the halt point recorded · supersession mid-program
still pinned · **one approval releasing exactly one step with the same skill on both** · grant
revoked and actor suspended *between* steps · pause/resume mid-program resuming at the right seq ·
concurrent advance · `app_rw` unable to rewrite a step's `skill_id` or `args` · `governed_skills`
unchanged · **send 0/0/0/0/0** and an empty outbox.

**Negative control:** reintroducing `ok ? "COMPLETED"` literally drives **20+ checks red**, including
the audit contract (`RUN_STARTED → RUN_COMPLETED` for a three-step program) and the approval-cascade
check. The suite is structurally capable of catching the defect it exists to prevent.

**Two suite corrections, both made from captured evidence rather than by adjusting an expectation:**

1. **My concurrency assertion was wrong — and so was the replacement. See §20.** I first asserted
   "two concurrent resumes dispatch at most once", then, on probe evidence that the second caller
   advances the *next* step, relaxed it. **The owner rejected the relaxation, correctly**: the
   original assertion was expressing a real invariant I had mis-stated rather than an invariant that
   did not exist. Recorded here only so the sequence is legible; the accepted semantic is §20.
2. **`p45-runtime` check 10** presented a replay that omitted `milestoneKey`. Under the old key
   (skill + args only) that still replayed; under whole-program identity it is a materially different
   program — which is the point of the rule. The replay now presents the identical program.

**Battery:** tsc clean · build clean · unit **429 / 429** · SEEDED class **1663 / 0** (including
p45-program 69, p45-runtime 50, p45-approvals 56, dp1 26, tenant-isolation 205, partnership 117,
search-path 39) · FRESH **238 / 0** · EITHER **215 / 0** · `certify-world --runs 2` **96 clean / 0
failures**, digest **`f72d1ff0d6b07b42`** — *unchanged from P45-2*, because the world digest hashes
table contents and the table set, and 0111 adds neither. (96 rather than P45-2's 94 is one new suite
across two runs.)

### An unexplained digest movement I chased rather than re-baselined

The first P45-3 certification run reported digest `3f857ccbeda49a10` instead of P45-2's
`f72d1ff0d6b07b42`. The obvious story — "0111 moved it" — was **wrong**, and proving that was the
point: cloning the local world, reverting *only* the 0111 CHECK value on the clone, and comparing
fingerprints gave **IDENTICAL digests and 0 differing tables**, because the world fingerprint is
table contents plus the table set and a CHECK constraint is neither.

The real cause was mine. While diagnosing the concurrency question I pointed a throwaway probe at
`pursuit_demo` — **the canonical local world — instead of a clone**, and its cleanup deleted
`organizations` by `org_id`, a column that table does not have, so the error was swallowed and one
row survived. Residue was then enumerated exactly: **one `organizations` row**, with **zero** rows in
all eleven referencing tables. Deleting that single row by id returned the world to **3 organizations,
160 tables and digest `f72d1ff0d6b07b42` exactly**. No re-baseline, and the P45-2 local record stands
unchanged. The lesson is the one the SEEDED_CLONE guard already encodes and my scratch probe bypassed:
**a throwaway script is exactly the thing that should be pointed at a clone.**

### Identity boundary — unchanged

No auth code was touched. The interactive decision path still resolves the principal server-side and
**fails closed**. **P45-3 claims no production human identity integration and no production-ready
interactive approvals.** Multi-step increases the number of human decision points; it does not change
who may be one.

### Expected hosted movement, when authorized

migrations **110 → 111** · **0 tables added** · **0 policies, 0 grants, 0 roles changed** ·
**business-data hash UNCHANGED** (no table joins or leaves the hashed map) · whole-world and security
hashes move for the CHECK redefinition and are reconciled exactly · `governed_skills` **18**,
unmoved · protected **31 / 0**.


---

## 20. P45-3-D1 — a stale resume could advance the NEXT step

**Found by the owner at the local review gate. Corrected locally; P45-3 remained unpushed throughout.**

### The defect

Serializing on the run row made every step execute exactly once, and dispatch idempotency made every
effect at-most-once. Both were true — **and neither was the invariant that mattered.** Two requests
issued against step 1 queued on the lock and became:

```
request A → executes step 1
request B → waits, then executes step 2      ← B never intended to advance step 2
```

So a double-click, a network retry, a duplicate job delivery or two callers acting at once would
**authorize two sequential consequential actions from what was only ever one intent**. The second
request is *stale with respect to the cursor it meant to advance*, and "every step ran once" cannot
see that, because from the steps' point of view nothing is wrong.

My own reasoning had drifted here. I probed the behaviour, saw one invocation per step and distinct
effects, concluded the runtime was right and the test wrong, and rewrote the test. The evidence was
accurate; the conclusion I drew from it was not. **Correctly reading a measurement is not the same as
asking whether it measures the right thing.**

### The correction — a generation token, no lease, no migration

> **A resume request may advance only the run-step generation it observed when that request began.**

`resumeRun` now reads the generation **without a lock, before** `loadRun` takes `for update`, then
re-reads it **under** the lock and declines if it moved. Under READ COMMITTED the locking statement
re-reads the row it waited for, so the loser sees the winner's committed generation.

The token is built from state the runtime already owns:

| component | what it ends a generation on |
|---|---|
| `current_step_id` | the program advancing to the next step |
| run `status` | parking for approval, completing, failing, cancelling |
| that step's `attempt` | a retry — so a stale request cannot silently spend another attempt |

**Nothing is client-supplied.** The cursor is read from the database, never accepted from a caller.
Recorded for the future: if an entry point ever exposes one, it may serve **only** as an
optimistic-concurrency precondition — **never as authorization, and never as step selection**.

### What this does and does not constrain

- Two concurrent resumes against step 1 → **exactly one** advances; the loser is a clean no-op
  carrying `stale: true`, dispatching nothing and **writing nothing to the ledger**.
- A resume **issued after** step 1 committed observes the new generation and advances step 2
  normally. **Request-driven progression is untouched** — this constrains duplicate and concurrent
  requests, not progress.

### Proof — `p45-program` 78 / 0

Same-generation race: exactly one advance, loser `stale`, **one step-1 invocation and zero step-2
invocations**, one effect, **steps 2 and 3 still PENDING**, one `RUN_STEP_COMPLETED` · fresh
next-generation resume executes step 2 normally · **five** concurrent same-generation resumes still
advance exactly once · concurrent resumes on an approval-required step raise **exactly one** request
with no draft · **immediately after an approval releases a step**, concurrent resumes advance exactly
once and step 2 does not execute on that approval · a one-step program dispatches exactly once · a
stale resume leaves the ledger at `RUN_STARTED,RUN_COMPLETED` with no residue.

**Negative control.** Disabling the generation check reproduces the defect verbatim — the two-racer
case returns **`advanced(seq=1) · advanced(seq=2)`**, two effects, `seq1=1 seq2=1`, and the five-racer
case advances **3 of 5**. Seven checks go red. (The approval-park checks pass either way: the
`pursuit_run_approvals_one_request` index and the WAITING guard already covered that path — worth
stating, so the generation check is not credited with work those two were already doing.)

### Nothing else changed

One step per successful fresh resume · no autonomous drain · no `locked_at` lease · whole-program
identity · step-scoped approval · per-step authority re-evaluation · append-only audit ·
**migration 0111 unchanged** — the correction needed no schema change at all.

### Re-run clean

tsc · build · unit **429/429** · `p45-program` **78/0** · `p45-runtime` **50/0** ·
`p45-approvals` **56/0** · SEEDED **1663/0** · FRESH **238/0** · EITHER **215/0** ·
`certify-world --runs 2` **96 clean / 0 failures**, digest **`f72d1ff0d6b07b42`** · world **160
tables, 3 organizations**, no residue.

> **A correction to my own earlier figure.** I reported the SEEDED class as **1666**. That total was
> taken while the residue org from §19 was still present, and `today-tenant` and `vnext-attention`
> enumerate `organizations`, so they emitted **9** and **3** extra checks respectively. The true
> baseline at 3 organizations is **1654**, and **1654 + 9 new P45-3-D1 checks = 1663** — which is
> exactly what runs now. The 1666 figure has been corrected wherever it appeared rather than left to
> read as a drop.


---

## 21. P45-3 — HOSTED ACCEPTED / CLOSED

### Phase 1 — migration gate, 24/24

Baseline captured **before any mutation** and compared to the accepted P45-2 record: **0 of 160
per-table hashes moved**; the only differences were `pendingVsRepo` (0111 awaiting) and the live
session count. Expected movement was then **declared in writing before the push**.

`0111` applied alone through the allowlisted single-migration applier → level **111**. Proven:
exactly one migration since 0110 · **160 tables → 160** · `RUN_STEP_COMPLETED` present and the
vocabulary grew **86 → 87**, the sole addition, every prior member retained · `app_rw` on
`change_ledger` still exactly **`INSERT, SELECT`**, no UPDATE, no DELETE, **no column-level UPDATE** ·
`change_ledger` **contents** unchanged (68 rows, 0 runtime rows) · policies 385, SECURITY DEFINER 26,
functions 149, roles 32, RLS+FORCE 160 — all unchanged · `governed_skills` 18 with the same content
hash · runtime and approval tables **empty** · organizations 3 · send 0/0/0/0/0 · **re-applying 0111
is a byte-identical no-op** that does not double-add the member.

### ATTRIBUTION OF RECORD — the business-data movement was D-P1's writer, NOT 0111

> **Owner-accepted attribution (2026-09-17).** The business-data movement
> `9e1fbd166fe06450 → 6db00c6841c51fc3` during this gate has **one cause: D-P1's read-triggered
> canonical `pipeline_snapshots` writer**, which wrote the row for `taken_on = 2026-09-17` when this
> gate's own flag-off crawl viewed `/pipeline` on a new calendar day.
>
> **It must not be attributed to migration 0111.** 0111 adds one `change_ledger` CHECK member and
> touches `pg_constraint` only; it was applied at `01:50:38Z`, *after* the crawls that caused the
> write; and the world fingerprint is table contents plus the table set, so a CHECK constraint
> cannot move it. Independently confirmed locally before the gate: reverting only the 0111 CHECK
> value on a clone gave **identical digests and 0 differing tables**.
>
> Any future gate that views `/pipeline` on a day with no snapshot row will reproduce this, by
> design. It is correct canonical history, not residue, and it is not a migration effect.

### The one undeclared movement — found, chased and attributed

My declaration said business-data must not move. **It moved**: `9e1fbd166fe06450` →
**`6db00c6841c51fc3`**. I stopped and reconciled before any functional testing.

Exactly **two** tables moved between pre and post: `schema_migrations` (declared) and
**`pipeline_snapshots`, 2 → 3 rows**. The new row is **`taken_on = 2026-09-17`**, with values
identical to the 09-15 and 09-16 rows (`open_count 11`, `open_usd 8,040,000.00`, `weighted_usd
3,361,500.00`) — matching the canonical world gate2 independently reports as *11 open · $8,040,000*.
The prior-date rows are untouched.

**Cause: D-P1's read-triggered canonical snapshot writer, plus the calendar.** The owner ruled in
D-P1 that viewing `/pipeline` writes today's canonical row. My own flag-off crawl viewed `/pipeline`,
and the day had rolled to 09-17. It was **not** the migration — 0111 was applied at 01:50:38Z, after
the crawls, and it touches only `pg_constraint`. **Business-data therefore moved SOLELY because of
that one D-P1 row; 0111 contributed nothing to it.** The row is correct canonical history produced by
the certified writer, so it stays: deleting it would invent a false history and would itself be an
unauthorized canonical mutation.

**My declaration was also wrong in the safe direction:** I predicted the security hash would move for
the CHECK redefinition. It did **not** — `092a20af64a0444e` throughout. The security hash does not
cover CHECK constraints, and neither does the world fingerprint, which is table contents plus the
table set. Both moved only for the two data tables above.

### The deployment changed nothing user-visible — proven by a same-day control

The first CFR-1.2 comparison against the P45-2 crawl reported **STOP**: two absolute dates
`2026-09-16 → 2026-09-17`, and `/queue` at **173 vs 171 lines**. Rather than reason about it, I
crawled the **previous deployment (`fbdeef5`) and the new one (`59f48a4`) on the same day against the
same level-110 database**. They produced a **byte-identical RAW digest `947ab4a844cd3785`**, 37/37
rooms, **STRICT 0**, line counts equal.

So the entire delta was the calendar: an action **due 2026-09-16** became *overdue · 2026-09-16*,
moving overdue **3 → 4** and due-today **1 → 0** (3+1 = 4+0), which empties the "Today" bucket and
removes its 2-line heading — **173 − 2 = 171**, reconciled exactly. A due-date bucket boundary
crossing, the same category as the declared rolling-window reconciliations. I classified it by
**control experiment rather than by adding a normalizer**, because a normalizer that masks absolute
dates could also mask a real change.

### Phase 2 — hosted functional acceptance, 75/75

Synthetic Option-A fixtures; every run and decision through **`withTenantOrg` on the real hosted
`app_rw`** (BYPASSRLS false); owner authority only for fixtures, cleanup and bounded negatives.

**A — atomic creation:** one run, three PENDING steps, server-assigned seq 1/2/3, one `RUN_STARTED`;
an invalid step rejects the whole program leaving **zero run, zero steps, zero ledger residue**.
**B — whole-program identity:** identical program replays onto the same run; **reordered** steps and a
**different milestone identity** are each a different program; a different program against a live run
raises `ProgramConflictError`, never a false replay; no second run from any conflict.
**C — sequential progression:** each fresh resume executes exactly one step; the cursor advances; the
audit chain is exactly `RUN_STARTED → RUN_STEP_COMPLETED → RUN_STEP_COMPLETED → RUN_COMPLETED`, and a
one-step run remains exactly `RUN_STARTED → RUN_COMPLETED`.
**D — generation-aware concurrency (the P45-3-D1 closure condition):** two same-generation resumes →
**exactly one advances**, loser `stale` with `invocationId` null, **one step-1 invocation and zero
step-2 invocations**, one effect, **steps 2–3 still PENDING**, one `RUN_STEP_COMPLETED` and **no
ledger event from the loser**; a fresh next-generation resume then executes step 2 normally; **five**
same-generation resumes advance exactly once with all losers stale. **Retry generation proven
hosted:** a handler that throws before any write leaves the step `RETRYABLE_FAILURE` at attempt 1, and
two concurrent retries consume **attempt 1 → 2, not 3** — a stale duplicate cannot spend another
attempt, and step 2 never executed.
**E — approval mid-program:** each step parks independently on the **same skill**; **three separate
REQUESTED records, one per step**, with exactly **one open** at a time naming the right step;
approval releases one step only; concurrent resumes right after release advance it **once**; step 3
does not execute on step 2's approval. Chain:
`RUN_STARTED → APPROVAL_REQUESTED → APPROVAL_GRANTED → RUN_STEP_COMPLETED → APPROVAL_REQUESTED →
APPROVAL_GRANTED → RUN_STEP_COMPLETED → APPROVAL_REQUESTED`.
**F — failure / no skipping:** retryable stays on the same step; terminal halts; governance BLOCKS;
later steps remain PENDING; **no BLOCKED recovery added**.
**G — stale authority:** grant revoked and actor suspended each refuse step 2 for the same pinned
actor; supersession gives `CANCELLED / PLAN_SUPERSEDED` **still pinned, never retargeted**, and both
cancellation paths record `stepsTotal / stepsCompleted / lastCompletedSeq / haltedAtSeq /
effectsRetained`.
**H — actor binding:** one governed actor across the whole program, on the run and on every
invocation, with **no substitution**.
**I — boundaries:** a foreign tenant cannot advance or even see the run; `app_rw` cannot rewrite a
step's `skill_id`, `args` or `idempotency_key`, and can neither update nor delete a ledger row.
**J — send safety:** 0/0/0/0/0, empty outbox, `governed_skills` 18 → 18 (approval came from the
grant override, so canonical policy was never touched).

> **A nuance worth preserving.** The generation guard is **not** what prevents duplicate approval
> requests. `pursuit_run_approvals_one_request` and the `WAITING_FOR_APPROVAL` state already provide
> that, and E-series checks pass with or without the guard. The guard's contribution is confined to
> stale *advancement*.

### Three harness defects I fixed — none in the product

The first hosted run reported 72/74 and then crashed. All three causes were mine: `stepsOf` omitted
the step `id` so a cursor assertion compared against `undefined`; two assertions counted **all**
`REQUESTED` rows instead of **open** ones (a decided request's REQUESTED row is history — the partial
unique index is per *step*, so three REQUESTED rows across three steps is exactly right); and a
leftover malformed line crashed the run. A fourth was a bad experiment: my induced failure used a
non-existent campaign, but `draftTouchImpl` *returns* `{created:false}` rather than throwing, so the
step succeeded. Replaced with `accept_participation` on an unknown id, which throws **before any
write** (`participation.ts:78`) — a genuine, effect-free transient failure. Each diagnosis was made
from queried hosted state, not from adjusting an expectation to fit.

### Cleanup and restoration

The acceptance run wrote its fixture manifest **on every plant**, so exact ids survive a crash. All
13 fixture orgs and 13 companies were removed **by exact id in dependency order** — 335 rows across
16 tables — and a pattern query proved the manifest listed **every** fixture row (0 unlisted). No
wildcard delete drove any statement.

> **160/160 per-table fingerprints EXACTLY restored** to the post-0111 baseline, and re-verified
> again after both crawls: **0 of 160 moved**. business-data `6db00c6841c51fc3` · whole-world
> `f2d83f71489c6682` · security `092a20af64a0444e` · manifest `cbddf5de9433b9fd` · protected 31/0 ·
> organizations 3 · `governed_skills` 18 · runtime and approval tables empty · send 0/0/0/0/0.
> `pipeline_snapshots` held at the same hash across both crawls, confirming the D-P1 writer is
> idempotent within a day. **No re-baseline.**

**Post-cleanup CFR-1.2 crawl:** 37/37, 4/4 byte-identical passes, **STRICT 0**, clock-derived 0,
**RAW digest `947ab4a844cd3785` — byte-identical to the pre-migration same-day baseline.** The hosted
acceptance left no user-visible trace whatsoever.

### Certification

tsc clean · unit **429/429** · `p45-program` **78/0** · `p45-runtime` **50/0** · `p45-approvals`
**56/0** · partnership-app-rw **117/0** · tenant-isolation **205/0** · search-path **39/0** ·
catalogue/protected **31/0** · SEEDED **1663/0** · FRESH **238/0** · EITHER **215/0** ·
`certify-world --runs 2` **96 clean / 0 failures**, digest **`f72d1ff0d6b07b42`** stable.
Env **38 entries byte-identical** to both the pre-gate and the P45-2 snapshots ·
**`VNEXT_CONTROL_PLANE_ENABLED` ABSENT (OFF)** throughout · serving `59f48a4` as
`dpl_3JP1VTcqjZbMCbYFZYm1zD89Z1gQ`.

### DISPOSITION

**P45-3 — Sequential Multi-Step Runtime: HOSTED ACCEPTED / CLOSED.**

This closure claims, and only claims: durable ordered multi-step runtime **proven hosted** · one
governed step per fresh resume · **generation-safe concurrent advancement** · per-step authority
re-evaluation · per-step approval isolation · durable partial-execution semantics · same-run
progression across multiple governed actions.

> **It does NOT claim** plan-derived program synthesis · DAG/parallel execution · worker or autonomous
> drain · compensation/rollback · **production human identity integration** · EXTERNAL_ACTION
> orchestration. None of those has been started.

**NEW HOSTED RECORD OF RECORD:** migrations **111** · business-data **`6db00c6841c51fc3`** ·
whole-world **`f2d83f71489c6682`** · security **`092a20af64a0444e`** · manifest
**`cbddf5de9433b9fd`** · protected **31 / 0** · `governed_skills` 18 · organizations 3 ·
`app_rw` LOGIN true / BYPASSRLS false · serving `59f48a4`.

---

## 22. P45-4 — AGENT ACTOR EXECUTES A GRANTED CAPABILITY (contract, frozen 2026-09-20)

> **A production AGENT credential resolves to a durable governed actor, that actor holds an exact
> live capability grant, and one real consequential same-org action executes through the existing
> governed chokepoint with immutable actor + credential + grant attribution.**

First certified capability: **`draft_campaign_touch@1`**, reached through the actual `/api/mcp`
AGENT production path. INTERNAL_WRITE · same-org · no external send.

### 22.1 What discovery found, and why this slice exists

`governed_actors` has admitted `AGENT` since 0109 and has **zero rows**. Meanwhile an AGENT actor
**already executes governed writes in production**: `src/app/api/mcp/route.ts` builds
`Actor{type:"AGENT", id: key.keyId}` from an API key and dispatches `draft_campaign_touch` /
`request_warm_intro` — passing **no `governedActorId`**, so the 0109 grant gate
(`if (ctx.governedActorId) …`) never engages. **Agent authority today comes from an API-key scope,
not from a grant to a durable governed actor.** That gap, not the absence of an AGENT type, is what
P45-4 closes.

`assert_stakeholder_role` was considered first and rejected: its only production callers are two
browser Server Actions building `{type:"USER"}` — **no non-human route exists**, so proving it would
have meant a verifier calling `dispatchSkill`, which is not product proof. It is retained as an
independent negative control (an AGENT may never assert `verified`), never as the subject.

### 22.2 Identity — three facts, three columns, never overloaded

| Slot | Value | Meaning |
|---|---|---|
| `Actor.id` | `keyId` | the credential/caller — **existing semantics retained** |
| `ctx.governedActorId` | resolved `governedActorId` | **trusted credential resolution only** |
| `governed_action_invocations.actor_id` | `keyId` | which credential invoked — **unchanged** |
| `governed_action_invocations.governed_actor_id` | the governed actor | which durable agent that credential represented |
| `governed_action_invocations.grant_id` | the exact authorizing row | which authority instrument permitted the action |

The earlier draft made `Actor.id` become the governed actor when bound, which would have silently
rewritten `actor_id`'s historical meaning. It does not. **A payload value never establishes `orgId`,
`keyId`, `governedActorId` or `grantId`; a compatibility field that disagrees with trusted
resolution is REJECTED, not ignored.**

`dispatchSkill` validates the **actor** (resolves in-org, ACTIVE, `actor_type === actor.type`). It
cannot validate the **binding** — that is established upstream from `ResolvedApiCredential`. The
chokepoint is not claimed to check what it does not check.

### 22.3 Authority

**Being an AGENT confers zero authority.** Under enforcement, an AGENT consequential dispatch
requires a credential-bound **ACTIVE** governed AGENT plus a **live exact** capability grant, in the
same tenant, on top of every pre-existing check. A grant may **narrow, never rescue**: it cannot
save an actor type or role the registry already refused, which is why the gate stays ordered after
`eligibleActors` and `ROLE_RANK`. **Approval authorizes continuation; it never creates authority.**

**`WORKER` and `SYSTEM` are outside this slice.** `src/lib/comms/sequence.ts:188` dispatches
`send_campaign_touch` as `Actor{type:"WORKER", id:"scheduler"}` with no governed actor and no grant.
That remains **known legacy, non-governed behaviour**, recorded here for a future separately
authorized item. **P45-4 does not make every non-human actor governed. It makes AGENT execution
governed.**

### 22.4 Grant liveness — database time, one implementation

```
status = 'ACTIVE'
  and revoked_at is null
  and (expires_at is null or expires_at > transaction_timestamp())
```

**The database establishes "now."** No caller, application or model timestamp enters production
authority evaluation, and the live predicate exposes **no time operand at all** — not even a
`coalesce($n, transaction_timestamp())`. This is §14/CFR-1.2 and the D-P6-1 correction applied to a
new instrument: a `timestamptz` carries microseconds and a JavaScript `Date` carries milliseconds,
so an instant that round-trips through the application is up to 999µs stale and can allow what the
database has already denied. The deliberate as-of helpers in `federation/grants.ts` and
`federation/contributions.ts` stay separate and **must never be repurposed as the live P45 authority
helper**.

**Liveness and applicability are separate questions.** Liveness is status/revocation/expiry.
Applicability is actor/org/capability/**exact version**. Exact matching must not duplicate expiry
logic.

`dispatchSkill` and `staleAuthority` **share one implementation**, and a structural certification
proves there is no second P45 grant-expiry comparison anywhere. Today they agree only by
coincidence; adding expiry to one alone would let a human approve what can no longer execute, which
is exactly what `staleAuthority` exists to prevent.

### 22.5 Expiry vs the ACTIVE unique slot

The partial index is `unique (org_id, actor_id, skill_id) where status = 'ACTIVE'` — **`skill_version`
is not in it**, and `now()` cannot enter a partial-index predicate. Therefore an **expired but
status-ACTIVE grant confers zero authority and still occupies the slot**: live-for-uniqueness and
dead-for-authority are deliberately different questions.

**Renewal is `revoke old grant → insert new grant`.** This is the table's existing shape —
`app_rw` may update only `(status, revoked_at)`, and a grant is created and revoked, never edited
into a different capability. **Capability identity and version are immutable.**

### 22.6 Exact version under strict AGENT enforcement

Legacy grant infrastructure supports `skill_version is null` as broader historical semantics and is
**not globally rewritten**. But strict AGENT execution of `draft_campaign_touch@1` requires an
authorizing row with `skill_id = 'draft_campaign_touch'` **and** `skill_version = 1`. A grant for
version 2, any other explicit version, or **NULL/wildcard** does not satisfy it.

### 22.7 Historical attribution

The grant used by an executed invocation **remains permanently attributable for the tenant's
lifetime**. `grant_id` is a tenant-composite FK with **NO ACTION**, never `SET NULL`.

This is safe because within a tenant's life **nothing can delete a grant**: `app_rw` holds no
`DELETE` on `actor_capability_grants`, `governed_actors` or `governed_action_invocations`. Physical
deletion occurs only through organization cascade, where the referencing audit rows are removed in
the same statement — which `NO ACTION` tolerates at end-of-statement and `RESTRICT` would not.
**That is a claim about PostgreSQL behaviour under two concurrent cascade paths, so it is proved on
a disposable clone, not asserted.**

### 22.8 Provisioning — no bound-but-ungranted window

Canonical order: **create governed AGENT → create its exact grant → mint a new API credential
already bound to that actor.**

This ordering is forced by existing code: the 0109 gate demands a grant **whenever
`ctx.governedActorId` is present**, even with the new enforcement switch OFF. So creating an actor
is inert, and creating a grant for an actor with no credential is inert, but **binding a credential
is not** — from that moment the credential must already hold the grant for its intended action.
A legacy Slice 14 key is never bound to preserve its identity; a new bound key is minted, and
unbound legacy keys remain only for OFF-posture compatibility testing.

### 22.9 The binding is immutable after issue

`api_keys.governed_actor_id` is set **at INSERT**. There is **no production rebinding operation**,
and `app_rw`'s `UPDATE` on `api_keys` is narrowed to `revoked_at` so rebinding is **structurally
impossible rather than merely unimplemented**. `last_used_at` is stamped inside the hardened
SECURITY DEFINER resolver, which runs as owner and needs no `app_rw` privilege.

**Identity change means revoke the credential and issue a new one.**

### 22.10 Enforcement rollout — `GOVERNED_AGENT_ENFORCEMENT_ENABLED`

Deployment-global, **absent ⇒ OFF**, scoped to `actor.type === 'AGENT'` only.

| Posture | Credential | Behaviour |
|---|---|---|
| OFF | unbound legacy | **certified Slice 14 semantics preserved exactly**; no governed actor or grant attribution is invented |
| OFF | bound | the **existing 0109 gate** applies — bound-without-live-grant REJECTS. Accepted existing behaviour, not a bug |
| ON | unbound | REJECTED at the new mandatory-binding check |
| ON | bound, missing/invalid grant | REJECTED at the grant check |
| ON | bound ACTIVE AGENT + exact live v1 grant | executes, if every pre-existing eligibility/role/precheck also permits |
| either | WORKER / SYSTEM | unchanged |

**Turning enforcement OFF after strict activation widens authority and is NOT an emergency brake.**
The post-activation brake is **credential revocation, grant revocation, or actor suspension** —
each a normal, audited operation that narrows. Disabling enforcement requires its own ruling.

This is the substantive difference from the 2C-A write gate, which removed a capability to write a
new format. This gate removes an *authority requirement*, so it is not symmetric with it and its
rollback semantics must not be copied mechanically.

### 22.11 Rollback — two different compatibilities

- **Data compatibility.** `89ed7001` reads schema 116 correctly: every change is a nullable column,
  a new constraint or a new FK, and it reads none of them.
- **Authority-contract compatibility.** Once strict enforcement is armed **while an AGENT-capable
  credential exists**, `89ed7001` **ceases to be a valid security rollback** — it silently removes
  the mandatory actor/grant requirement and restores scope-only AGENT authority while operators
  believe every agent write is granted.

> **The boundary is never the first successful invocation.** There is no new data format here that
> old code misreads; the risk is authority regression.

### 22.11a Two boundaries, not one — corrected by hosted-rollout review

The local authority matrix proved something the first draft of §22.11 did not say: on the same
database, with the same credential and the same **revoked** grant, `89ed7001` **still executes**
what the P45-4 runtime refuses — because it never consults the governed actor or the grant at all.
That behaviour does not wait for strict enforcement. The **pre-existing 0109 gate** applies to a
bound credential the moment one exists, enforcement switch or not, and `89ed7001` does not apply it.

So the security boundary begins **earlier** than arming, and there are two of them:

> **BOUNDARY A — the bound-credential boundary.** From the instant the first live AGENT credential
> is bound to a governed actor, `89ed7001` is no longer a valid security rollback for governed AGENT
> authority — **even while `GOVERNED_AGENT_ENFORCEMENT_ENABLED` is false.**
>
> **BOUNDARY B — the strict-enforcement boundary.** When enforcement is armed, every AGENT
> consequential execution requires a trusted bound governed actor plus an exact live grant. From
> there, turning enforcement off widens authority for unbound legacy keys.

Three compatibilities are therefore tracked **separately**, and no hosted certification language may
collapse them: **data compatibility** · **bound-credential security compatibility** · **global
strict-enforcement compatibility**.

| State | Condition | Is `89ed7001` a valid rollback? |
|---|---|---|
| **1** | New schema/runtime not yet serving; no bound AGENT credential | **Yes** — the certified rollback |
| **2** | P45-4 runtime serving, enforcement OFF; still no bound AGENT credential | **Yes** — both data- and security-compatible with the existing authority contract |
| **3** | A governed actor and/or its grant exist, but **no bound credential** | **Yes** — still inert; nothing applies the gate to any live credential |
| **4** | **The first live bound AGENT credential exists** | **No** — retired as the security rollback for governed AGENT authority. The certified P45-4 OFF deployment becomes the rollback target |
| **5** | Enforcement **ON** | **No.** The OFF runtime remains the *code* rollback target only where its posture suits the emergency; **turning enforcement off in the serving environment is not an approved brake**, because it widens authority for unbound legacy keys |

**Creating the actor, or the actor and its grant, remains inert.** Binding a credential is the act
that moves the boundary — which is the same fact §22.8 states from the provisioning side, seen from
the rollback side.

**The preferred emergency narrowing, at every state from 4 onward, is to narrow authority rather
than to widen it:** revoke the credential · revoke the grant · suspend the governed actor.

### 22.12 Telemetry — what this slice does not claim

**P45-4 claims no model, provider, token or cost evidence, and 0116 contains no column for any of
it.** On the MCP path PursuitOS is the server *being called*: `src/lib/agents/mcp-writes.ts` and the
`/api/mcp` write branch perform **no provider call**, so there is no observed provider, model
version, token usage or cost. Nullable fields are not added merely so that every value in the first
certified execution can be null.

**Configuration is not evidence.** Execution-time model and usage fields may be written only by a
trusted server-side execution context that itself performed the model call — never from a request
payload, MCP caller metadata, or mutable actor configuration. `governed_actors.model_provider` /
`model_id` are therefore **deferred**: a mutable "configured model" strengthens neither identity,
authority, attribution nor cost, and would exist to support a display.

Trusted model/usage/cost attribution moves to the immediately-following **Runtime observability +
P8 hooks** item. **That item inherits the obligation to design honest attribution — not to populate
these fields.** If PursuitOS still does not own the model execution at that point, the facts remain
unavailable and must stay unrecorded; the next slice improves the observation spine, it does not
fabricate telemetry. It should also record what discovery found about the internal server-side
path, which is only partly attestable today: tokens are provider-reported (`ai/client.ts:123`) but
`cost_usd` is computed locally from a hardcoded list-price table (`client.ts:133`) and `model` is
the locally-declared `MODELS[tier]` constant, not the provider's returned model string.

### 22.13 User-visible change

**"Drafted by \<governed actor display name\>"** on the existing campaign-touch/activity
representation, rendered **only when `governed_actor_id is not null`**. No model. No cost. No
actor-model configuration UI. No agent-history redesign. An unbound legacy AGENT execution must
**not** display governed-agent attribution, and grant authorization is carried by `grant_id`, never
inferred from the presence of an actor.

### 22.14 Refusal disclosure

A user-facing refusal must never reveal whether a foreign or forged grant exists. A foreign actor is
reported **unknown**, indistinguishably from one that does not exist — the existing 0109 convention,
preserved.

### 22.15 P3

**2C-A remains closed; 2C-B remains deferred.** No plan compiler, no `PlanContent` capability
fields, no `pursuit_run_steps.plan_action_key`. P45-4 executes through `dispatchSkill` with a
governed actor and **no run**, so it never touches the plan-bound run tables
(`pursuit_runs.plan_revision_id` is NOT NULL — requiring a run here is what would have dragged 2C-B
forward).

### 22.16 Migration 0116 — exactly this, and nothing else

| Target | Change |
|---|---|
| `governed_actors` | `check (actor_type <> 'AGENT' or principal_user_id is null)` — an agent is not a person |
| `actor_capability_grants` | `+ expires_at timestamptz` (insert-only **by omission** — UPDATE stays `(status, revoked_at)`); `+ unique (org_id, id)` |
| `governed_action_invocations` | `+ grant_id uuid`, tenant-composite FK → grants with **NO ACTION**, plus a partial lookup index; **not** added to the UPDATE allowlist |
| `api_keys` | `+ governed_actor_id uuid`, tenant-composite FK → `governed_actors` with **ON DELETE CASCADE**; `app_rw` UPDATE narrowed to `revoked_at` |
| `resolve_api_key(text)` | drop/recreate for the return-type change only; returns `governed_actor_id`; **SECURITY DEFINER** and `search_path = pg_catalog, public, pg_temp` preserved exactly |

**Explicitly absent:** model, token, cost and latency fields · any new table · prompt/persona/tool
catalogue · P3/P45 run or compiler columns.

`api_keys.governed_actor_id` uses CASCADE rather than RESTRICT because an actor is only ever
physically deleted with its tenant, and RESTRICT could abort a legitimate organization cascade
depending on cascade order. The invariant it protects — **a live credential may never resolve to a
nonexistent governed actor** — is satisfied either way; CASCADE additionally does not block cleanup.

### 22.17 Acceptance — the permanent `p45-4` suite

Every refusal must prove **the intended check was actually reached** (§16N). At minimum: identity
separation and forged-payload refusal · lifecycle DRAFT/SUSPENDED/RETIRED · grant cannot rescue
registry ineligibility · grant missing/revoked/expired/wrong-capability/wrong-explicit-version/
NULL-wildcard all reject and exact `@1` executes · database transaction time only · expired-ACTIVE
occupies the slot and revoke-then-insert succeeds · executed invocation records the exact immutable
grant id · cross-org actor and grant relations refused relationally with an indistinguishable
user-facing denial · binding immutable to `app_rw` · OFF/unbound is Slice 14-compatible with null
governed/grant attribution · ON/unbound rejects at mandatory binding · OFF/bound-without-grant
rejects at the existing gate · WORKER unaffected under both postures · the draft mutation occurs
with no external send · `assert_stakeholder_role` AGENT-cannot-assert-`verified` retained ·
organization-cascade passes · `grant_id` and `expires_at` immutable to `app_rw` · the resolver keeps
its hardened `search_path` and the protected-function class stays **31 / 0** · human/USER P45
behaviour, the full 2C-A suite and the P6/P7 governance regressions unchanged · **no model, token or
cost attribution exists anywhere in this slice**.

The core positive must drive the real product path:

```
credential → trusted resolver → MCP Actor → governed actor context → exact live grant
  → dispatchSkill → draft_campaign_touch → campaign-touch draft → invocation audit
```

A verifier calling `dispatchSkill` directly is **insufficient** for that positive proof.

### 22.18 Wrong-version proof respects grant immutability

A grant's capability version is never re-pinned. The certified sequence is: insert an ACTIVE grant
for `draft_campaign_touch@2` → attempt v1 → **rejected by the version check** → revoke the v2 grant
→ insert a new ACTIVE `@1` grant → the identical dispatch **succeeds**. One sequence proves four
things: wrong version rejects, exact version authorizes, grant identity is immutable, and
replacement is revoke-then-insert.
