# PursuitOS vNext — Status

**Last updated:** 2026-09-17 — **P45-3 (SEQUENTIAL MULTI-STEP RUNTIME) + P45-3-D1 CORRECTION: IMPLEMENTED LOCALLY / NOT PUSHED.** Migration **0111** (one ledger word, `RUN_STEP_COMPLETED`) applied **locally only**; a run carries an ordered program executed one step per request, born atomically, identified as a whole, halting rather than skipping, re-authorized at every step boundary, and — after **P45-3-D1** — **a resume may advance only the run-step generation it observed when the request began**, so duplicate or concurrent requests cannot authorize two sequential consequential actions. `p45-program` **78/0**; SEEDED **1663/0**, FRESH **238/0**, EITHER **215/0**, unit **429/429**; `certify-world --runs 2` **96 clean / 0 failures**, digest **`f72d1ff0d6b07b42` unchanged from P45-2**. **P45-3 proves the sequential runtime substrate ONLY** — plan-derived program synthesis and DAG/parallel execution remain separate, unstarted future work, and the product roadmap's own *Slice 3 — Portfolio Pertinence (P2)* is untouched. **Hosted authorization not yet given: nothing pushed, 0111 not applied hosted.** Hosted record of record remains migrations **110** · business-data **`9e1fbd166fe06450`** · whole-world **`f27321cd8803f04b`** · security **`092a20af64a0444e`** · **31/0**. **Production human approval identity is still NOT proven.** Permanent `controlPlane` **OFF**; send **0/0/0/0/0**. *(Earlier entries below are a dated historical log; where they say an item is OPEN, that was true on that date and has since been superseded.)*

**2026-09-17 (latest) — P45-3-D1: a stale resume could advance the NEXT step. CORRECTED LOCALLY.**
- **The defect, found by the owner at the local review gate.** Serializing on the run row made every step execute exactly once and dispatch idempotency made every effect at-most-once — **both true, and neither the invariant that mattered.** Two requests issued against step 1 queued on the lock and became `A → executes step 1` / `B → waits, then executes step 2`, so a double-click, network retry, duplicate job delivery or two concurrent callers would **authorize two sequential consequential actions from one intent**. The second request is stale with respect to the cursor it meant to advance, and "every step ran once" cannot see that.
- **My own reasoning had drifted.** I probed the behaviour, saw one invocation per step and distinct effects, concluded the runtime was right and the test wrong, and rewrote the test. The measurement was accurate; the conclusion was not. **Correctly reading a measurement is not the same as asking whether it measures the right thing.**
- **The correction — a generation token. No lease, no migration, no schema change.** `resumeRun` reads the generation **without a lock, before** `loadRun` takes `for update`, re-reads it **under** the lock, and declines if it moved (READ COMMITTED re-reads the row the locker waited for, so the loser sees the winner's committed generation). The token is `current_step_id` + run `status` + that step's `attempt` — so advancing, parking for approval, completing, cancelling **and retrying** each end a generation, and a stale request cannot silently spend another attempt from the retry budget. **Nothing is client-supplied**; recorded for the future: if an entry point ever exposes a cursor it may serve **only** as an optimistic-concurrency precondition, never as authorization and never as step selection.
- **What it constrains, and what it does not.** Two concurrent resumes against step 1 → exactly one advances; the loser is a clean no-op carrying `stale: true`, dispatching nothing and **writing nothing to the ledger**. A resume **issued after** step 1 committed observes the new generation and advances step 2 normally — **request-driven progression is untouched**.
- **`p45-program` 78/0.** Same-generation race (one advance, one step-1 invocation, **zero** step-2 invocations, one effect, steps 2–3 still PENDING, one RUN_STEP_COMPLETED) · fresh next-generation resume executes step 2 normally · **five** concurrent same-generation resumes advance exactly once · concurrent resumes on an approval-required step raise **exactly one** request with no draft · **immediately after an approval releases a step**, concurrent resumes advance exactly once and step 2 does not execute on that approval · one-step program dispatches exactly once · a stale resume leaves no ledger residue.
- **Negative control:** disabling the generation check reproduces the defect verbatim — `advanced(seq=1) · advanced(seq=2)`, two effects, and **3 of 5** racers advancing. Seven checks go red. The approval-park checks pass either way, because `pursuit_run_approvals_one_request` and the WAITING guard already covered that path — stated so the generation check is not credited with their work.
- **Nothing else changed:** one step per successful fresh resume · no autonomous drain · no `locked_at` lease · whole-program identity · step-scoped approval · per-step authority re-evaluation · append-only audit · **0111 unchanged**.
- **A correction to my own earlier figure.** I reported SEEDED as **1666**. That was measured while the §19 residue org was still present, and `today-tenant` / `vnext-attention` enumerate `organizations`, emitting **9** and **3** extra checks. True baseline at 3 orgs is **1654**; **1654 + 9 new checks = 1663**, exactly what runs now. Corrected wherever it appeared rather than left to read as a drop.
- **Re-run clean:** tsc · build · unit 429/429 · p45-program 78/0 · p45-runtime 50/0 · p45-approvals 56/0 · SEEDED **1663/0** · FRESH **238/0** · EITHER **215/0** · `certify-world --runs 2` **96 clean / 0 failures**, digest **`f72d1ff0d6b07b42`** · 160 tables, 3 organizations, no residue.
- Record: `P4-P5-GOVERNED-RUNTIME.md` §20. **Still NOT pushed; 0111 still NOT applied hosted. Awaiting review of this correction.**

**2026-09-17 — P45-3 SEQUENTIAL MULTI-STEP RUNTIME: IMPLEMENTED LOCALLY / NOT PUSHED.**
- **The capability.** A run carries an **ordered program**, `seq 1..N`, executed strictly in order, **one consequential step per `resumeRun` call**. Named **P45-3 — Sequential Multi-Step Runtime**; it does **NOT** close the roadmap item "multi-step plans / DAG" (plan-derived synthesis and DAG/parallel execution stay separate future work) and is unrelated to the product roadmap's **Slice 3 — Portfolio Pertinence (P2)**, which is untouched.
- **How little was new.** 0109 already gave steps a `seq`, `unique (run_id, seq)`, a position-bearing idempotency key and per-step retry state, and `resumeRun` already selected the lowest-seq eligible step and already had a "no steps left → COMPLETED" branch. `startRun` only ever created seq 1, and **`ok ? "COMPLETED"` ended the run on the first success** — that single expression was the entire single-step assumption.
- **Migration 0111 — one word.** `change_ledger.change_type` **+ `RUN_STEP_COMPLETED`**, via the 0103 §5 append pattern. **No table, column, privilege, policy, role, RLS change, SECURITY DEFINER or grant.** Verified after applying locally: **160 tables → 160**, `change_ledger` still exactly `INSERT,SELECT` for `app_rw`, re-application a **no-op**.
- **THE AUDIT CONTRACT (ruling 2), stated so consumers cannot misread it:** `RUN_STARTED → RUN_STEP_COMPLETED → RUN_STEP_COMPLETED → RUN_COMPLETED` for a 3-step program; the **final** success emits `RUN_COMPLETED` and **not both**, so a completed program carries **(successful steps − 1)** `RUN_STEP_COMPLETED` events — **do not infer one per completed step**. A one-step run still emits exactly `RUN_STARTED → RUN_COMPLETED`, leaving P45-1/P45-2 evidence valid without reinterpretation.
- **Four invariants.** (1) **Atomic birth** — run, every step, server-assigned sequence, immutable step identity and `RUN_STARTED` are one unit, held by a **savepoint inside `startRun`** so even a caller who catches the error mid-transaction cannot see a partial program; the caller never supplies `seq`. (2) **Whole-program identity** — the key hashes each step's position, skill, version, canonical args and milestone key (`max_attempts` excluded: retry budget is execution policy, not what is being done), so the same program **replays**, reordered steps are a **different** program, and a different program against a **live** run is an explicit **`ProgramConflictError`**, never a silent replay. (3) **Every step boundary is a fresh authority boundary** — the actor is pinned but **a pinned identity is not a pinned entitlement**; one call advances at most one step and the program is never drained in a loop. (4) **Never skip forward** — progress is the **lowest-seq step that is not COMPLETED**, so a later PENDING step is *structurally* unreachable while an earlier one is unresolved; **no BLOCKED recovery path is introduced**.
- **A defect this slice found in the Slice-2 carry-over.** Slice 2 read `continuation.approvedRequestId`, which is **run-scoped**. With a program, **step 3 would have passed the approval gate on the approval a human gave for step 2** — the cascade ruling 8 forbids, and invisible to a skill-scoped check because the next step may name the same skill. The gate now asks about the **step**, against the **append-only `pursuit_run_approvals`** that `app_rw` cannot rewrite, rather than the run's mutable continuation. Proven: two steps, same skill, two independent parks, two separate REQUESTED records.
- **Concurrency.** `loadRun` takes `select … for update`; `transitionRun` is a genuine **compare-and-set** (`from` was previously only the ledger's `before` value) with a checked rowCount; the step's idempotency key is the third line of defence. **`locked_at` deliberately NOT activated** — no lease, no expiry, no crash-recovery protocol. **Future boundary recorded:** do not generalize a long-held database transaction across an external/provider action; that needs its own worker/claim design.
- **Cancellation.** Completed steps keep their effects and stay COMPLETED — **no compensation, rollback, undo or reverse skill**. Every cancellation (including `PLAN_SUPERSEDED`) now records `stepsTotal`, `stepsCompleted`, `lastCompletedSeq`, `haltedAtSeq`, `effectsRetained`, so **CANCELLED never reads as "nothing executed."**
- **`p45-program` 69/0**, every call through **`withTenantOrg` on the real `app_rw` login**. **Negative control:** reintroducing `ok ? "COMPLETED"` drives **20+ checks red**, including the audit contract and the approval-cascade check.
- **Two suite corrections, both from captured evidence rather than adjusted expectations.** (1) *My concurrency assertion was wrong.* A probe showed the second caller blocks on the row lock and then advances the **next** step — one invocation per step, two distinct effects, step 3 untouched. "At most one dispatch" demanded that a request-driven runtime refuse a second request, which is not the rule; replaced with the real invariants plus a **one-step** race where exactly one dispatch is the only correct answer. (2) `p45-runtime` check 10 replayed while omitting `milestoneKey`, which is now part of program identity per ruling 5.
- **An unexplained digest movement chased, not re-baselined.** The first certification reported `3f857ccbeda49a10`. "0111 moved it" was **wrong** — reverting only the 0111 CHECK value on a clone gave **identical digests and 0 differing tables**, since the fingerprint covers table contents and the table set, not constraints. The real cause was mine: a throwaway probe pointed at **`pursuit_demo` instead of a clone**, whose cleanup deleted `organizations` by `org_id` (a column that table lacks), swallowing the error. Residue enumerated exactly — **one `organizations` row, zero rows across all eleven referencing tables** — deleted by id, restoring **3 organizations, 160 tables, digest `f72d1ff0d6b07b42`**. The P45-2 local record stands unchanged.
- **Battery:** tsc clean · build clean · unit **429/429** · SEEDED **1663/0** · FRESH **238/0** · EITHER **215/0** · `certify-world --runs 2` **96 clean / 0 failures**, digest **`f72d1ff0d6b07b42`** (unchanged from P45-2; 96 vs 94 is one new suite over two runs).
- **Footprint:** `runtime.ts`, `ledger.ts` (+1 type), `verify-classes.ts`, `p45-runtime-verify.ts`, new `p45-program-verify.ts`, new `0111`. **No P3 plan surface touched** — no `PlanContent`, `nextAction`, plan fingerprint, milestone shape, `read-models/` or `coordination/` file changed. **No auth code touched.**
- **NOT CLAIMED:** that the program was derived from the decided plan (it is **caller-supplied**; the persisted step rows are the durable program snapshot for this slice), production human identity integration, or production-ready interactive approvals.
- Record: `P4-P5-GOVERNED-RUNTIME.md` §19. **Awaiting hosted authorization — nothing pushed, 0111 not applied hosted.**

**2026-09-17 — P45-2: HOSTED ACCEPTED / CLOSED. Approval runtime proven hosted.**
- **Phase 1 — migration gate, 24/24 + 11/11 reconciliation.** 0110 applied alone → level **110**; table count 159→**160** solely from `pursuit_run_approvals`; RLS **ENABLED+FORCED**; `app_rw` **exactly INSERT, SELECT** with no UPDATE/DELETE and no column-level UPDATE; **no SECURITY DEFINER**; `change_ledger` privileges unchanged; every constraint present as designed including the **composite self-FK** proving a terminal row shares its request's org/run/step, and both the **one-request** and **one-terminal** invariants at the DB layer.
- **Every movement classified against a pre-mutation declaration:** `schema_migrations` 109→110 was the **only** shared table whose content moved; business-data → **`9e1fbd166fe06450`** solely because the new EMPTY table joined the hashed map; whole-world → **`f27321cd8803f04b`**; security → **`092a20af64a0444e`** from +1 policy and grants **on the new table only**, 0 removed, functions/triggers/roles/protected identical. **Unmoved as declared:** `change_ledger` content, `pursuit_run_steps` content, **`governed_skills` at 18**.
- **`decide_governed_action` was inserted by NEITHER the migration NOR the deploy** — `seedGovernedSkills` is called only by seed/verify scripts, `defFor` resolves from the code registry, and no FK exists, so the workflow needs no hosted policy row. Approval was required for the fixture via the synthetic grant's **`approval_required_override = TRUE`**, so **canonical `governed_skills` was never touched**.
- **Phase 2 — hosted functional acceptance, 60/60**, every execution and decision through **`withTenantOrg` on the real hosted `app_rw` login**. Request parks with **no invocation and no draft**, one immutable REQUESTED record, tenant-scoped · self-approval refused · authorized APPROVE passes the full P4 path with a server-resolved principal, terminal row **references the original request**, **REQUESTED unchanged**, the **same persisted run** resumes, **exactly one** execution, replay cannot duplicate · REJECT → `CANCELLED / APPROVAL_REJECTED`, **invocation policy-REJECTED semantics untouched**, replay safe, a later APPROVE cannot overturn it · **all three INVALIDATED paths** (grant revoked / actor suspended / revision superseded) with the run **still pinned, never retargeted**, and the request gone from the pending model · **six authority refusals** incl. suspended decider and revoked decision capability, none mutating or executing · **concurrency — APPROVE vs APPROVE (hosted) · APPROVE vs REJECT (hosted) · APPROVE vs INVALIDATE (hosted) · REJECT vs REJECT (locally proven, NOT separately rerun hosted)**, each executed race giving one terminal row, one winning transition, loser *already decided*, **no stranded APPROVED+WAITING**, ≤1 execution, exactly one ledger transition; REJECT-vs-REJECT is closed on the **decision-value-agnostic** one-terminal-per-request invariant (proven hosted by the three races above) plus the local proof, and is **not** claimed as rerun hosted · append-only under real `app_rw`: **CANNOT update a request, CANNOT update a terminal decision, CANNOT delete either** · full audit chain `RUN_STARTED → APPROVAL_REQUESTED → APPROVAL_GRANTED → RUN_COMPLETED` in one ledger.
- **Two defects the hosted gate found in my own code, both fixed:** (1) the decision dispatch **cached a governance refusal** under an idempotency key, so a retry after authority *changed* replayed the stale answer — key removed, governance re-evaluated every attempt, duplicate effects still impossible via the terminal index; (2) `decide_governed_action` was in `SKILL_REGISTRY`, which the Pursuit Federation panel lists, **adding two lines to a flag-OFF page** — caught by the **CFR-1.2 STRICT class** and moved to `COORDINATION_SKILLS`, which also makes the recursion base case **structural** (no policy row exists to be edited into requiring an approval-of-an-approval).
- **Cleanup & restoration:** every row removed by exact id in dependency order (28 ledger, 17 invocations, 2 touches, 9 steps, 9 runs, 40 grants, 40 actors, 10 campaigns, 22 revisions, 10 plans, 10 goals, 10 pursuits, 10 features, 10 orgs, 10 companies). **160/160 fingerprints EXACTLY restored**, re-verified after the crawls: **0 of 160 moved**; `governed_skills` still 18; organizations 3. **No canonical residue, no rebaseline.**
- **Flag-off crawl (CFR-1.2):** 37/37, 4/4 deterministic, **STRICT 0**, line counts match, **normalized digest identical `107b17e3f5f1b24d`**. **Regression:** p45-approvals 56/0 · p45-runtime 50/0 · persisted 17/0 · semantic 50/0 · dg85 19/0 · dp1 26/0 · partnership 117/0 · tenant-isolation 205/0 · search-path 39/0 · catalogue 12/0 (**31/0**) · rehearsal 38/38+6/6 · **`certify-world --runs 2` 94 clean, digest `f72d1ff0d6b07b42` stable**. Env **38/18/33** byte-identical; **`controlPlane` ABSENT (OFF)** throughout; send **0/0/0/0/0**.
- **What this does NOT claim:** the interactive decision path resolves the principal server-side and **fails closed**; application auth is unconfigured, so **production human approval identity is NOT proven** and the hosted Approvals buttons legitimately refuse. A **tracked production-readiness boundary** — not a Slice 2 defect, and nothing was weakened to make it look satisfied.
- Record: `P4-P5-GOVERNED-RUNTIME.md` §18. **P45-2 CLOSED · P4 approval authority proven hosted · P5 WAITING_FOR_APPROVAL continuation proven hosted · Slice 3 NOT STARTED.**

**2026-09-16 — P45-2 SLICE 2: THE APPROVAL LIFECYCLE, IMPLEMENTED LOCALLY / NOT PUSHED.**
- **What was missing:** `WAITING_FOR_APPROVAL` was schema-legal since 0109 but **unreachable** — `governed_skills.approval_required` was read **nowhere** in `src/`. No Approvals surface existed and no surface read the runtime at all.
- **Migration 0110 (additive, append-only, applied LOCALLY ONLY):** `pursuit_run_approvals` with `REQUESTED | APPROVED | REJECTED | INVALIDATED`, four ledger values, and a `(org_id, id)` key on steps. **Explicit request identity** — the `REQUESTED` row has its own id and terminal rows **name** it via `request_id`; the request is never mutated. Enforced relationally: one open request per step · **at most one terminal decision per request** · a composite self-FK proving a terminal decision **shares its request's org/run/step** · a shape CHECK where `INVALIDATED` carries **no deciding actor and a mandatory reason** because it is system-governed. `app_rw` gets **INSERT, SELECT only**; RLS ENABLE+FORCE; **no SECURITY DEFINER, no RLS weakening, `change_ledger` grants untouched, protected 31/0**.
- **Policy:** override `TRUE` narrows (requires approval); `NULL` inherits the skill; **`FALSE` can NEVER weaken a canonical requirement** — every `approval_required = true` is hard in Slice 2, and a soft-approval abstraction was deliberately not invented.
- **Recursion base case:** the decision capability is **`decide_governed_action`** (neutral — one capability authorises both outcomes). `effectiveApprovalRequired()` returns false for it **unconditionally**, so no grant override can create an approval-of-an-approval.
- **Authority:** approval is **itself a governed action** — ACTIVE governed actor, same org, principal match, live grant for the decision capability, every existing dispatch check. **A governed actor cannot decide its own request.**
- **Stale authority:** re-evaluated **immediately before continuation**. Grant revoked → **INVALIDATED / CAPABILITY_REVOKED**; actor suspended → **ACTOR_SUSPENDED**; revision superseded → **PLAN_SUPERSEDED**, still pinned to the original revision, never retargeted. INVALIDATED is **never** offered as pending.
- **The race — three arbiters in ONE transaction:** the partial unique terminal index (race arbiter) · compare-and-set out of `WAITING_FOR_APPROVAL` with a checked rowCount (runtime arbiter) · step idempotency (backstop). A durable APPROVED decision can never commit while the run is stranded — it rolls back. **The LOCAL race set proven:** approve/approve, approve/reject, reject/reject each give exactly one terminal decision, one winner, the loser *already decided*, and at most one consequential execution. (The HOSTED race set differs — see the 2026-09-17 entry — substituting approve/invalidate for reject/reject.)
- **A defect the suite caught and I fixed:** the decision's dispatch idempotency key omitted the decider, so a second approver got a **replayed** result instead of their own governance evaluation — a viewer could have inherited an operator's dispatch. The key was first scoped to the deciding actor, then **removed entirely by the hosted gate** (a decider-scoped key still cached a governance refusal); the unique index arbitrates the race, and dispatch idempotency plays no part in a decision.
- **Identity boundary, stated not papered over:** `decide()` resolves the principal **server-side** and **fails closed**; a caller can never nominate an approver. **Runtime authorization is provable today; production human identity is NOT**, because application auth is unconfigured (`currentRole()` returns `"owner"` for everyone, no principal resolves). The interactive buttons legitimately refuse and say so. **Nothing was weakened to accommodate the demo.**
- **Surface:** `/approvals` — what is waiting, which pursuit/account, what it would do, who asked, why a person decides, Approve/Reject, link through. Narrow by design. **State is derived from the lifecycle, never stored twice** — one representation shared with Pursuit detail.
- **`p45-approvals` 56/56**, every scenario through **`withTenantOrg` on the real `app_rw` login**: park with no invocation/draft · resume cannot release a pending approval · APPROVE resumes the **same run**, exactly one execution · append-only history, `app_rw` cannot UPDATE or DELETE it · replayed APPROVE cannot duplicate · a late REJECT cannot overturn a committed APPROVE · REJECT → `CANCELLED / APPROVAL_REJECTED` **without overloading invocation semantics** · wrong principal / viewer / self-approval / other tenant all refused with nothing executed · the three INVALIDATED paths · both feature gates · **send 0/0/0/0/0**.
- **Certification:** tsc · **429/429** · build · p45-approvals **56/0** · p45-runtime 50/0 · persisted 17/0 · semantic 50/0 · dg85 19/0 · dp1 26/0 · partnership 117/0 · tenant-isolation 205/0 · search-path 39/0 · catalogue 12/0 (**31/0**) · rehearsal 38/38+6/6 · **`certify-world --runs 2` 94 clean / 0 failures, digest `f72d1ff0d6b07b42` stable**. Local world 160 tables / 1051 rows; **zero residue**; canonical `approval_required` still false on every skill.
- **Hosted untouched** — not pushed, not deployed, 0110 local only. Hosted stands at migrations 109 · `6abe424f43bff901` · `c299c6e372c686c4` · `569e5497a7622048` · 31/0.
- Record: `P4-P5-GOVERNED-RUNTIME.md` §17. **Next: hosted P45-2 migration gate + acceptance. Slice 3 NOT STARTED.**

**2026-09-16 — P45-1: HOSTED ACCEPTED / CLOSED. P45-D1: HOSTED CORRECTED / CLOSED.**
- **Phase 1 — the correction, hosted.** `d742a77` deployed as **`dpl_2syZQr94SCB2kyPpCs1vJN594BNV`**; **0 of 159 fingerprints moved merely because code deployed**. **Append-only proven under the real `app_rw` login, 9/9:** ACL exactly `INSERT, SELECT` with **0** column-level UPDATE; `app_rw` **CAN** insert through the corrected `recordChange` and **CAN** select it; the row is **born with** run/step/invocation/actor linkage (no follow-up UPDATE); and **CANNOT** update or delete it. Rolled back, `change_ledger` byte-identical. **P45-D1 corrected without adding a single permission.**
- **CFR-1.2 adopted + crawl re-baselined.** The pilot baseline is a living synthetic world whose derived metrics move with the clock. CFR-1.2 permits a difference **only** when it recomputes exactly from unchanged canonical source and a **named** time expression; five conditions must all hold; **any unexplained difference remains a STOP**. Reporting is now two-class: **STRICT** (zero tolerance) and **CLOCK-DERIVED** (itemised with source evidence). Database fingerprints are **not** weakened — they stay exact. `crawl-p45d1b` accepted as the new baseline on: STRICT **0**, normalized digest identical `107b17e3f5f1b24d`, **0/159 database fingerprints changed**, line counts identical. The 30 differences: **23** day counters (`extract(day from now() - <ts>)`; all 19 seeded timestamps cluster in one hour so their anniversaries coincide), **6** from the 90-day won window — **`Hist · DR modernization` ($610,000)** crossing `closed_at >= now() - interval '90 days'`, reconciled as **1,780,000 − 610,000 = 1,170,000** and **4 − 1 = 3** — and **1** invite age `1d→2d` (`intelligence.ts:154`, recomputed hosted as exactly `2`). Manifest movement fully attributable to `days_since_activity`. **Canonical demo data was not modified or reseeded.**
- **Phase 2 — synthetic hosted functional acceptance, 48/48.** Fully synthetic disposable world; **Globex not used**; no canonical stakeholder fact or P3 row altered. The approved action's semantic was authored FIRST (`draft_campaign_touch:first`, "Draft the first campaign touch…") and the skill bound second. **Every execution ran through `withTenantOrg` on the real `app_rw` login**; owner authority confined to fixture setup/cleanup.
- **Proven hosted:** two-gate feature control (global ON + org ON required; neither bypassable) · governed USER actor with principal distinct from `owner_user_id` · **wrong principal REFUSED** · **no grant REFUSED** · **a grant does NOT override `required_permission`** (viewer refused) · **step COMPLETED, run COMPLETED, exactly ONE EXECUTED invocation, exactly ONE draft touch (`status=draft`), no outbox row, no provider call** · full audit chain P3 → run → step → actor → grant → invocation → draft → ledger with `RUN_STARTED → RUN_COMPLETED` · **idempotent replay: no second draft, no second consequential invocation** · **pause/resume from durable state on a fresh invocation** · **PLAN_SUPERSEDED cancellation, never retargeted, still pinned to the original revision** · **SUSPENDED actor and REVOKED grant both refused**.
- **A distinction proven, not assumed:** a refusal **also records an invocation with status `REJECTED`** — the audit trail working. What must be unique is the **EXECUTED** one: `EXECUTED 28 → 29` for the single successful run, refusals audited separately.
- **Tenant/RLS:** `current_user = app_rw`, **BYPASSRLS false**, `app.org_id` = synthetic org. **No owner pool anywhere in the runtime execution stack.** **Send:** 0/0/0/0/0 throughout.
- **Retry/failure paths** were not manufactured hosted — no product test hook, no damaged state. Local `p45-runtime` **50/50** remains authoritative for retry/backoff, budget exhaustion, crash recovery and failure classification, and is now proven **under the real `app_rw` identity**.
- **Cleanup & restoration:** every row enumerated by exact id and removed in dependency order (18 ledger, 7 invocations, 2 touches, 8 steps, 8 runs, 1 grant, 1 actor, 1 campaign, 18 revisions, 8 plans, 8 goals, 8 pursuits, 1 org_features, 1 org, 1 company). No wildcard deletes. **159/159 per-table fingerprints EXACTLY match the pre-test baseline; no rebaseline.** Post-cleanup flag-off crawl **RAW digest `8f33a5eff68fa481` — byte-identical**; STRICT 0, clock-derived 0. **The acceptance left no trace.**
- **Regression:** p45-runtime 50/0 · persisted 17/0 · semantic 50/0 · dg85 19/0 · dp1 26/0 · partnership-app-rw 117/0 · tenant-isolation 205/0 · search-path 39/0 · catalogue guard 12/0 (**31/0**) · rehearsal 38/38 + 6/6.
- **HOSTED RECORD, unchanged:** migrations **109** · business `6abe424f43bff901` · world `c299c6e372c686c4` · security `569e5497a7622048` · **31/0** · `app_rw` LOGIN true / BYPASSRLS false. Permanent Preview `controlPlane` **OFF** throughout; runtime tables **0/0/0/0**.
- Record: `P4-P5-GOVERNED-RUNTIME.md` §14–16. **P45-D1 CLOSED · P45-1 CLOSED · P4 first governed actor/capability substrate PROVEN HOSTED · P5 first durable Pursuit execution PROVEN HOSTED · migration 109 unchanged · Slice 2 NOT STARTED.**

**2026-09-16 — DEFECT P45-D1: CORRECTED LOCALLY / NOT PUSHED. Real-identity testing now permanent.**
- **The defect.** `runtime.ts` appended its ledger event with `recordChange` and then **UPDATEd that row** to attach `run_id`/`run_step_id`/`invocation_id`/`governed_actor_id`. `change_ledger` is **append-only for `app_rw`** — `INSERT, SELECT`, zero column-level UPDATE, a deliberate certified invariant. Under the real runtime identity the update is refused (`permission denied for table change_ledger`, 42501), the `withTenantOrg` transaction rolls back, and **no run could ever reach COMPLETED**.
- **Why local 45/45 missed it — a defect in the TEST as much as the code.** `scripts/p45-runtime-verify.ts` executed `startRun`/`resumeRun` on `owner.connect()` (BYPASSRLS, full DML) and used `app_rw` only for RLS visibility. It was **structurally unable** to detect a privilege defect. The hosted gate caught it because it ran the product's own `withTenantOrg` against the real `app_rw` login.
- **The correction (exactly what was approved, nothing more).** `recordChange` now accepts the four linkage fields and writes them **in the original INSERT**; the follow-up UPDATE is deleted. Append-only is **strengthened, not relaxed** — no caller needs UPDATE and none has it — and the write is now atomic, so no ledger row ever exists unlinked. **No migration. No grant/permission change. No RLS weakening.** `app_rw` on `change_ledger` is still exactly `INSERT, SELECT` with **0** column-level UPDATE grants. Granting UPDATE was rejected as weakening a certified invariant to accommodate a fixable implementation error.
- **The verification gap is closed, and proven closed.** The suite now executes the runtime through **`withTenantOrg` on the real `app_rw` login** (product pool pointed at the app_rw URL before the first lazy `getPool()`), with owner authority limited to fixture setup/cleanup. **50/50.** A **negative control** reintroduced P45-D1 verbatim and the corrected suite went **FATAL with the exact hosted error** — so the gap is genuinely closed, not stepped around. Five new assertions cover it directly: executed as `app_rw` with BYPASSRLS false · can SELECT its own ledger rows · **cannot UPDATE** a prior ledger row · **cannot DELETE** one · linkage present on every row with no UPDATE having occurred.
- **All prior P45 semantics intact under the new identity:** retry/backoff, budget exhaustion, crash recovery, pause/resume, PLAN_SUPERSEDED cancellation, replay idempotency and the audit chain are now all exercised as `app_rw` — the earlier "owner-only proven" caveat no longer applies.
- **Certification:** tsc clean · **429/429** · build clean · **p45-runtime 50/0** · persisted 17/0 · semantic 50/0 · dg85 19/0 · dp1 26/0 · partnership-app-rw 117/0 · tenant-isolation 205/0 · search-path 39/0 · catalogue guard 12/0 (**31 protected / 0 unsafe**) · rehearsal 38/38 + 6/6 · **`certify-world --runs 2`: 92 clean / 0 failures, digest `d1f970a533dbee1a` stable across both runs**. Local world 159 tables / 1051 rows; **zero fixture residue**; send **0/0/0/0/0**; `OUTREACH_AUTOSEND` and `RESEND_API_KEY` absent.
- **Files changed (3):** `src/lib/pursuits/ledger.ts` (+25/−2), `src/lib/runtime/runtime.ts` (+8/−8), `scripts/p45-runtime-verify.ts` (+83/−12). **No migration touched. No grant/revoke/policy statement added.**
- **PERMANENT ACCEPTANCE REQUIREMENT ADOPTED:** every P45 gate must exercise runtime execution through the **real `app_rw` identity and the product's own tenant-binding path**. Owner authority is limited to fixture setup, cleanup and cross-org assertions, and may never be the execution identity. Each gate must assert `BYPASSRLS false` under the real login and that append-only tables reject UPDATE/DELETE. Behaviour proven only as the owner is recorded as *unproven under the runtime identity*. Recorded in `P4-P5-GOVERNED-RUNTIME.md` §13.
- **Hosted untouched:** no push, no deploy, no hosted mutation, no Vercel/env change, no send enablement. Hosted stands at migrations 109 · `6abe424f43bff901` · `c299c6e372c686c4` · `569e5497a7622048` · 31/0, runtime tables 0/0/0/0.
- Record: `P4-P5-GOVERNED-RUNTIME.md` §12–13. **P45-1 NOT CLOSED — the hosted functional rerun is separately authorised. Slice 2 NOT STARTED.**

**2026-09-16 — P45-1 MIGRATION 0109: HOSTED ACCEPTED. Functional acceptance still OPEN.**
- **Scope:** this gate certifies the **schema/security substrate and flag-OFF compatibility only**. No hosted governed actor, grant, run or step was created; controlPlane was never enabled; `org_features.governed_action` was not turned on for any org; `draft_campaign_touch` was never executed through P5; the worker was not wired; Slice 2 not started; Production untouched; sending untouched.
- **Deployment:** `d1f6023` pushed, then `2f16091` (the fix below). Serving **`dpl_8MDMbJwHiKePAExe6xRifxhfsASh`** (Preview, READY) · `app_rw` / bypassRls false / tenantEnforcement true / probe live / sending off. **The pre-migration Preview was verified healthy against level 108 first**, proving the new code runs against an un-migrated database.
- **A defect caught at the gate, before applying:** 0109 was the **only** migration carrying its own `begin;`/`commit;`. Both appliers wrap the file *and* the `schema_migrations` insert in one transaction, so an inner `commit;` would have left the ledger insert un-atomic with the DDL — a failure between the two would have produced applied DDL with no ledger row. Fixed in `2f16091` and re-verified before application.
- **0109 applied alone**, identity hard-guarded, one transaction → level **109**, nothing pending, nothing applied-not-in-repo.
- **Structure/RLS/ACL 42/0:** four tables, RLS **ENABLE+FORCE** on all four with one `app_rw` policy each (`is_org_member(org_id)` on USING and WITH CHECK); the ACTIVE-USER-requires-principal CHECK present; **no FK on `principal_user_id` or `owner_user_id`**; composite actor/run references; partial-unique live grant; the one-non-terminal-run index; **no DAG column**; `app_rw` = SELECT+INSERT with column-level UPDATE on exactly **4 / 2 / 7 / 10** columns.
- **ACL finding, investigated not assumed:** `anon`/`authenticated`/`service_role` hold `REFERENCES,TRIGGER,TRUNCATE` on the new tables. **0109 grants only to `app_rw`** — and **155 of 155 pre-existing tables carry exactly the same set**, the Supabase project default already covered by every accepted security hash since Gate 1b.1. None of the three can log in. The new tables are **identical to the certified baseline**, with no DML and no `PUBLIC` grant. *(Tightening that platform default is a project-wide question for all 159 tables, recorded not acted on.)*
- **Tenant consistency 9/0, rollback-only, zero residue:** a Vertex grant cannot reference a Meridian actor; a Vertex run cannot reference a Meridian actor; a Meridian step cannot reference a Vertex run — each refused by the **composite FK, relationally, before RLS**. Under the real `app_rw` login: no context → **zero** rows on all four; Org A sees only Org A; Org A **cannot** insert for Org B (RLS WITH CHECK).
- **Existing contracts preserved:** `change_ledger.actor_id`, `governed_action_invocations.actor_id`, `pursuit_plan_revisions.actor_id`, `pursuit_goals.proposed_by_actor_id` all **still uuid, still nullable, still no FK** — unchanged type, meaning and behaviour. Runtime linkage uses distinct nullable columns; **zero existing rows backfilled**.
- **Catalogue 13/0:** policies 380→**384** (exactly the 4 new) · RLS 155→**159** · table grants 620→**636** with **0 existing changed** · column grants 11→**34** (+23 = 4+2+7+10) · functions (149), triggers (12), roles (32), protected (31) **identical** · **no new SECURITY DEFINER** · CREATE-on-public identical.
- **NEW SECURITY HASH `569e5497a7622048`** (was `2a5ea0509145ee81`) — recorded only after all of the above passed. **NEW WHOLE-WORLD `c299c6e372c686c4`** (was `933a5e30d79297a4`).
- **business-data MOVED to `6abe424f43bff901` — stopped and explained, not auto-accepted.** It is definitional: the metric hashes the *entire* table→`rows:hash` map (minus `schema_migrations`), so four new tables necessarily move it. Three shared tables also moved: `schema_migrations` (the ledger), and — with **identical row counts** — `change_ledger` (68→68) and `governed_action_invocations` (28→28), because the per-table hash is `md5(row::text)` and the new nullable columns change every row's serialisation. **Proven, not asserted:** recomputing both hashes over **only their original columns** reproduces the pre-migration values **exactly** (`68:c955c9fc…`, `28:aadc6e1c…`), every new column is NULL on every row, and canonical counts are unchanged (3/14/19/14/2). **No business row changed.**
- **Flag-OFF compatibility 16/0:** two crawls, 4 passes — **37/37 rooms 200, all passes byte-identical, 37/37 BYTE-IDENTICAL to the accepted Gate-9 baseline**. Meridian 0; owner rooms, joint boundaries, palette, CDW label, Stark disclosure, most-common-outcome and D-G8-1 ordering all intact; Today/Queue/Pipeline/Partners/Joint/Admin unchanged. **No runtime table acquired a row.**
- **Regression, zero failures (STOP never triggered):** persisted 17/0 · semantic 50/0 · dg85 19/0 · dp1 26/0 · partnership-app-rw 117/0 · tenant-isolation 205/0 · search-path 39/0 · catalogue guard 12/0 (**31/0**) · rehearsal 38/38 + 6/6.
- **Empty-runtime posture:** `governed_actors`/`actor_capability_grants`/`pursuit_runs`/`pursuit_run_steps` all **0 rows**; no fixture orgs; no new invocation or ledger row; **0 of 159 per-table fingerprints moved** across all gate probing.
- **Safety:** send **0/0/0/0/0**; `OUTREACH_AUTOSEND` and `RESEND_API_KEY` absent; Vercel env **38 total / 18 branch-scoped / 33 Preview-visible**, byte-identical to the Gate-9 inventory; `DATABASE_URL` → `app_rw`, `DATABASE_URL_OWNER` → owner; Production untouched; `qifatlqxfuhwrwvpbwsc` never contacted.
- **Owner rulings recorded.** (1) `principal_user_id` without an FK is **APPROVED FOR SLICE 1** — ACTIVE USER still requires a principal (DB CHECK verified hosted), `owner_user_id` never substitutes for identity, runtime principal matching enforced. **This is NOT the final production identity model: before non-synthetic / real-user operation, principal identity binding MUST be revisited and strengthened via an additive migration or an equivalent validated identity model.** (2) The runtime **may** read `org_features.governed_action` directly and must not route through `governedActionEnabledFor()`; the effective gate stays **both** flags with the global one authoritative.
- Record: `P4-P5-GOVERNED-RUNTIME.md` §11. **P45-1 MIGRATION 0109 HOSTED ACCEPTED · P45-1 FUNCTIONAL/RUNTIME ACCEPTANCE OPEN · SLICE 2 NOT STARTED.**

**2026-09-16 — P45-1: THE GOVERNED PURSUIT RUNTIME, IMPLEMENTED LOCALLY / NOT PUSHED.**
- **What it is:** the first amended-roadmap P4/P5 vertical slice — "execute one approved plan action through the governed Pursuit Runtime". Local only; not pushed, not deployed, hosted untouched, sending untouched, Slice 2 not started.
- **The design gate's finding held up:** most of the control plane already existed and is certified — `governed_skills` (capability registry), `dispatchSkill` (the single consequential-action boundary), and `governed_action_invocations` → `action_outbox` → executor (idempotency, retry, dead-letter, compensation). P45-1 adds only the two genuinely missing pieces: **who or what may act**, and **a durable, resumable run**.
- **Migration 0109 (additive, idempotent, no SECURITY DEFINER):** `governed_actors`, `actor_capability_grants`, `pursuit_runs`, `pursuit_run_steps`, plus nullable `run_id`/`run_step_id`/`invocation_id`/`governed_actor_id` on `change_ledger` and `governed_actor_id`/`run_step_id` on `governed_action_invocations`. RLS **ENABLE + FORCE** on all four with the certified `is_org_member(org_id)` policy; UPDATE/DELETE revoked then re-granted column by column (0058's default privileges otherwise hand `app_rw` full DML on every new table). Ledger vocabulary extended by the 0103 §5 pattern — every prior value kept; `trigger_type` deliberately **not** extended, since `GOVERNED_ACTION` already means this.
- **Identity finding, reported not worked around:** the certified world has **no populated user identity** — `auth.users` is empty, `org_members` is empty, `resolve_user_org(null)` falls back to the oldest org. A `references auth.users(id)` on `principal_user_id` would have made it **impossible to create a USER governed actor in the pilot world**, so it follows the four existing precedents (`change_ledger.actor_id` and friends all carry no FK). Identity is still enforced: a **DB CHECK** refuses an ACTIVE USER actor without a principal, and dispatch refuses a principal mismatch.
- **Cross-org finding:** the repo has **zero** composite FKs across 155 tables, so the gate's preferred `(org_id, id)` pattern was not a repo convention. 0109 follows the certified pattern (single-column FK + RLS FORCE + explicit org-scoped guards) for existing tables **and additionally** applies composite keys *within the new subsystem only* — so a Vertex row cannot reference a Meridian actor or run, refused **relationally** before RLS is consulted.
- **`dispatchSkill` remains the only boundary.** The grant check is strictly additive, engages only when a caller names a governed actor, and can **reject, never permit**; it is ordered after eligibility/permission so **a grant cannot override `required_permission`** — proven by a grant-holding `viewer` still being refused.
- **Flag finding:** the gate named `org_features.governed_action`, but `governedActionEnabledFor()` is the tail of a dependency chain (`governedAction` ← `federation` ← `experience` ← `pursuits && facts && routing && pursuit_experience`). `control_plane` is documented as *"backend-only and deliberately independent of experience"*, so the runtime reads the **per-org column directly**. Double-gated, **default OFF**; a later surface must apply its own tenant gate.
- **Worker drain deliberately NOT wired** (owner ruling 6): the existing worker runs on the **owner pool** (BYPASSRLS), and making that the runtime's identity would hand ambient mutation authority to a background process. Slice 1 runs under **`app_rw` + `withTenant`**. The two-stage worker model is recorded for its own future slice.
- **`p45-runtime` 45/0** proves: happy path end-to-end with exactly **one** draft touch; registry semantics unbent; invocation traces to actor **and** step; `RUN_STARTED → RUN_COMPLETED` in `change_ledger` with no parallel log; replay creates no duplicate; no-grant and SUSPENDED actor both refuse and create nothing; USER actor cannot be ACTIVE without a principal; cross-org refused relationally; pause stops execution and resume continues from durable state; backoff honoured, retry bounded, same step identity, one effect not one per attempt, exhaustion terminal; a run interrupted mid-dispatch recovers from the database alone; a superseded pin is **CANCELLED as PLAN_SUPERSEDED**, never retargeted; `app_rw` isolation; the feature gate defaults OFF; send **0/0/0/0/0**.
- **Certification:** tsc clean · **429/429** tests · build clean · persisted 17/0 · semantic 50/0 · dg85 19/0 · dp1 26/0 · partnership-app-rw 117/0 · tenant-isolation 205/0 · search-path 39/0 + catalogue guard 12/0 (**31 protected / 0 unsafe**) · rehearsal 38/38 + 6/6 · **`certify-world --runs 2` digest `d1f970a533dbee1a` identical at start and after both runs**. Local world digest legitimately moved from `e98b43254f98d5ec` because 0109 adds four tables. **Fixture residue in the canonical world: ZERO** (all fixtures run on disposable clones).
- **One unclassified transient, reported not dismissed:** `today-tenant` returned **50/1 in run 1** of the final certification and **51/0 in run 2**, plus 51/0 in both runs of the preceding certification, both Gate-9 runs, and 3 standalone re-runs (7 passes around 1 failure). **The failing assertion name was NOT captured** — certify-world's summary records counts only, which is a tooling gap worth closing. `today-tenant` has **zero** references to `dispatchSkill` or any runtime table, so it is not in P45-1's change path; it does carry 6 time-sensitive constructs, a plausible but **unproven** cause. Recorded as unclassified, matching two earlier precedents.
- **Hosted untouched:** no push, no deploy, no hosted contact, no env change, no Production. Hosted record stands at migrations 108 · `c56a1d229e483f2b` · `933a5e30d79297a4` · `2a5ea0509145ee81` · 31/0.
- Record: `P4-P5-GOVERNED-RUNTIME.md`. **Next: the hosted P45-1 migration gate (0109 is the first migration since 0108, so the hosted security hash and whole-world digest will legitimately move — no value is pre-authorized). Slice 2 NOT started.**

**2026-09-16 — GATE 9: PASS. PILOT READY WITH CURRENT OPERATING BOUNDARIES. H1 CLOSED.**
- **Evidence/decision gate — no product functionality implemented, no hardening sweep, no new D-G8/D-P item, no UI redesign, no P4/P5 work, Production untouched, sending not enabled. No new deployment was needed to run it.**
- **Baseline identity:** branch `roadmap/pursuitos-vnext`, HEAD `46e9258` = origin (0/0), tree clean; serving **`dpl_8Mh8XDCVph5hpLgGRd8xX5MrWgnD`** (READY). `/api/build`: `mejokqxriwyawfhawuxu` / `app_rw` / bypassRls false / tenantEnforcement true / probe live / sending off.
- **Database / security: 26/26, ZERO movement.** migrations 108 · business `c56a1d229e483f2b` · world `933a5e30d79297a4` · security `2a5ea0509145ee81` · 31/0 — all matching the record of record, **nothing rebaselined**. Against the accepted D-P1 closeout: 380 policies, 155 RLS rows, 620 table grants, 11 column grants, 31 protected functions, 149 functions, 12 triggers, all 32 roles — **identical**; **0 of 155 per-table fingerprints moved**; `txid` NULL.
- **Closed-gate evidence matrix built** for D-G5-1, D-G8-1, D-G8-2A, D-G8-3A/B/D, D-G8-4A/B/C/D, D-G8-5 and D-P1 — each with its invariant, local evidence, hosted evidence, disposition and current regression evidence. **Semantic decisions preserved:** deterministic ordering vs semantic *unresolved* · normalized canonical identity · nullable unresolved campaign seed · canonical shared-evidence LIMIT membership · canonical snapshots immune to filtered-view poisoning.
- **Final regression:** tenant-isolation **205/0** · partnership-app-rw **117/0** · search-path **39/0** + catalogue guard 12/0 (**31 protected / 0 unsafe**) · app-rw-rehearsal **38/38 + 6/6** · dg85 **19/0** · persisted **17/0** · semantic **50/0** · dp1 **26/0**. **Crawl 12/12 assertions: 37/37 rooms ×4 passes byte-identical, and 37/37 identical to BOTH the accepted D-P1 and D-G8-5 crawls.** Meridian 0; owner rooms, joint boundaries, palette, CDW label, Stark disclosure, most-common-outcome and D-G8-1 ordering all intact. **No new rendered difference.**
- **Harness-fix reconciliation — answer (C):** the two D-P1 acceptance-harness defects were in **session-scratchpad tooling that never entered the repository**, so there was nothing to revert. None of those files is tracked, present in the repo, or referenced by any tracked file; the D-P1 commits touched only the suite, the registry, `page.tsx`, `snapshot.ts` and docs. **The repository retains NO vacuous or broken certification check** — proven four ways: no vacuous-comparison pattern in source; check 9 is a negative control a vacuous harness could not satisfy; check 20's regexes were negative-controlled; and the suite **empirically produced a genuine red** during implementation. Not a Gate-9 blocker; nothing was patched.
- **Env-count reconciliation:** **18** = entries branch-scoped to `roadmap/pursuitos-vnext` (what earlier gates counted); **38** = the whole project inventory across all targets/scopes (18 branch-scoped + 20 unscoped); **33** = entries visible to a Preview build on this branch. No contradiction, no addition or removal — the 38-entry inventory is **byte-identical** to the D-G8-1-era, D-P1-pre and D-P1-post snapshots. **Authoritative rule adopted: record "N total / M branch-scoped / K Preview-visible" (now 38 / 18 / 33), and always compare byte-identity over all 38.**
- **Send safety:** 0/0/0/0/0; `OUTREACH_AUTOSEND` and `RESEND_API_KEY` **absent from the entire Vercel project**, not merely unset. Synthetic data cannot create an external-send condition: two **independent** fail-closed gates (`externalSendingArmed()` requires the exact string `on`; `send.ts` marks the message failed and throws before any provider call without a key), and there are zero message rows to reach either.
- **Operating envelope — all existing safeguards classified:** tenant targeting **PASS** · `app_rw`/owner separation **PASS** · RLS/tenant enforcement **PASS** · autosend OFF **PASS** · synthetic-send prohibition **PASS** · rollback ownership **PASS** (rehearsed at Gate 8 Phases 1–2) · environment identity **PASS** · production-target guardrails **PASS** · **backup/snapshot expectations NOT APPLICABLE YET** (no managed backups on this Supabase plan; irrelevant to an isolated synthetic world reproducible from seed, but **applicable the moment non-synthetic data enters** — flagged, not expanded).
- **One factual documentation correction made** (permitted; nothing else expanded): `ENVIRONMENT-MAP.md` §6 still classified Preview data access as **UNKNOWN** and warned of possible `UNSAFE_SHARED_WRITE`. Gates 1–8 resolved this; it now reads **ISOLATED_SYNTHETIC_LEAST_PRIVILEGE**, with the superseded reasoning and operating rule kept verbatim as collapsed historical record.
- **PILOT BLOCKERS: NONE.** Deferred and explicitly non-blocking: **D-G8-2B** (display-only UI backlog, prior owner decision, no correctness/membership/persistence/governance effect), the amended **P0–P10** roadmap remainder (P4/P5, continued P3 depth, P6–P10), the backup job confirmation, the Production-demo serving-SHA reconciliation (a different, out-of-scope target), and the final broad UI/UX cleanup.
- Record: `H1-PRE-PILOT-HARDENING.md` § "GATE 9 — PILOT READINESS DECISION GATE". **GATE 9 PASS · PRE-GATE-9 HARDENING COMPLETE · H1 PRE-PILOT HARDENING COMPLETE · PILOT READINESS ACCEPTED. No new hardening phase. Next: the amended P0–P10 roadmap — P4/P5 transition and continued P3 depth. Roadmap implementation NOT started.**

**2026-09-16 — D-P1: HOSTED ACCEPTED / CLOSED. PRE-GATE-9 HARDENING COMPLETE.**
- **Deployment:** `f936fbe` (carrying `6f3e65d`) pushed fast-forward `ae424d5..f936fbe`, deployed as **`dpl_FnUKb4vWHMQkpAKAbxtDxCKeyyYp`** (Preview, READY, branch `roadmap/pursuitos-vnext`). `app_rw` / bypassRls false / tenantEnforcement true / probe live / sending off. **No migration — level stays 108.** Vercel env **byte-identical, 38 entries**.
- **Part 0 — PRE-DEPLOY HOSTED SNAPSHOTS: CLEAN.** Before pushing anything, both hosted rows were re-read and checked against an **independent pure-SQL recomputation** that never reads `pipeline_snapshots`: 2026-09-15 and 2026-09-16 each stored 11 / 8,040,000.00 / 3,361,500.00 / null and each **equalled** canonical 11 / 8,040,000 / 3,361,500 / null. `txid` NULL. **No repair required and none performed** — this settles the question the pre-push evidence correction left open.
- **Deployed code identity:** writer is `upsertCanonicalPipelineSnapshot(db, orgId)`; it accepts no caller timeframe, horizon, scope or aggregate and derives all four fields itself; `taken_on` is the database's `now()::date`. `page.tsx` holds **no** snapshot INSERT/UPDATE, has **exactly one** call site passing only `(db, tieOrgId)` **inside `withTenant`** — no owner shortcut — and retains both reads plus the timeframe and ecosystem-scope rendering semantics.
- **Canonical baseline after unfiltered render:** `{"open_count":11,"open_usd":"8040000.00","weighted_usd":"3361500.00","crm_usd":null}` → **`9b2c3c6ce81d9f12`**, equal to independent recomputation.
- **Filtered-view proof — each view checked TWICE (rendered projection correct for that filter *and* canonical row frozen):** `?timeframe=7` → 0/$0/$0 · `?timeframe=30` → 2/$800K/$160K · `?timeframe=90` → 11/$8.04M/$3.36M · `?scope=PARTNER:WWT` → 7/$5.66M/$2.14M · **scope + timeframe=7** → 0/$0/$0. Every one matched an independent SQL recomputation of that same horizon/scope, and in **every** case the canonical row stayed **byte-identical at `9b2c3c6ce81d9f12`**. The scope used is the app's **real** `?scope=` mechanism (re-authorized server-side), narrowing 10 companies/19 opps → 6/11; the original scope was restored afterwards. **Under the pre-fix code each of these would have persisted its filtered totals.**
- **Repeated reads:** 8 renders across 7/30/90/narrow-scope/combined/unfiltered → **exactly ONE distinct canonical content hash**. **Concurrency:** 8 concurrent mixed requests across two sessions, all 200; today's row then **exactly equalled independent canonical recomputation**. No locks introduced. Prior-date rows byte-identical throughout.
- **CFR-1.1: HOLDS and is STRENGTHENED** — canonical recomputation is now enforced by the **writer boundary** instead of depending on the page caller. CFR-1.1 itself unchanged, not weakened.
- **Tenant / app_rw:** `pipeline_snapshots` RLS **true** / FORCE RLS **true**; both policies `is_org_member(org_id)`, never the catalogue `true` form; **all 380 policies byte-identical to the accepted D-G8-5 baseline**. Under real `app_rw` (BYPASSRLS false): no context → 0 rows; Org A → exactly its 2 rows; Org B insert **refused by RLS**, update 0, delete 0 — with a **positive control** proving Org A can reach its own row. All attempts rolled back; **zero residue**.
- **Certification:** dp1-snapshot-boundary 26/0 · dg85 19/0 · persisted 17/0 · semantic 50/0 · partnership-app-rw 117/0 · tenant-isolation 205/0 · search-path 39/0 · rehearsal **38/38 + 6/6**.
- **Crawl: 37/37 rooms 200, all 4 passes byte-identical, and 37/37 BYTE-IDENTICAL to the accepted D-G8-5 crawl — ZERO rendered difference**, exactly right for a persistence-only change. Meridian 0 under Vertex; owner rooms 200; palette healthy; joint boundaries, CDW label, Stark disclosure and most-common-outcome all stable; **D-G8-1 order Dana → Mike → Priya → Sarah** intact. All prior defects remain closed.
- **Database: 0 of 155 per-table fingerprints moved** — `pipeline_snapshots` sat at `2:cb3b239393b46d6e266f2ae860905804` **before and after**, because the repeated canonical upserts wrote byte-identical content. No UTC rollover, so no new-date row. migrations **108** · business **`c56a1d229e483f2b`** · world **`933a5e30d79297a4`** · security **`2a5ea0509145ee81`** · **31/0** — all unchanged.
- **Send safety:** 0/0/0/0/0 · `OUTREACH_AUTOSEND` and `RESEND_API_KEY` absent · Production untouched · `qifatlqxfuhwrwvpbwsc` never contacted.
- **Three first-failures captured before any re-run — all TOOLING, none product:** (1) my `H2` check wrongly demanded the 90-day view differ from unfiltered — read-only diagnosis showed all 11 open opps close 18–54 days out with no null dates, so the horizon is legitimately a no-op; the gate's real requirement was then verified against independent recomputation and passed. (2) my `N2` check looked for a literal `app.org_id` in policy text, but scoping runs through `is_org_member()` — no drift, proven by 380 byte-identical policies. (3) an env "CHANGED DATABASE_URL" alarm came from diffing a **stale** pre-Gate-5 snapshot; against the correct baseline the env is byte-identical. Two harness defects (an RLS refusal aborting its transaction; two wrong JSON keys making one check vacuous) were fixed and re-run to the real results.
- **HOSTED RECORD OF RECORD, unchanged:** migrations 108 · business `c56a1d229e483f2b` · world `933a5e30d79297a4` · security `2a5ea0509145ee81` · 31/0 · serving `f936fbe` as `dpl_FnUKb4vWHMQkpAKAbxtDxCKeyyYp`.
- Record: `H1-PRE-PILOT-HARDENING.md` § "D-P1 — HOSTED ACCEPTED / CLOSED". **D-P1 CLOSED. PRE-GATE-9 HARDENING COMPLETE. Gate 9 is the exact next step and was NOT started.**

**2026-09-16 — D-P1: FIXED LOCALLY / NOT PUSHED. Code-only, no migration.**
- **Defect:** `/pipeline` computed `open`, `total` and `weighted` from its **rendered** projection — narrowed by `?timeframe=7|30|90` — and wrote them into the canonical `pipeline_snapshots (org_id, taken_on)` row via an inline upsert. **Looking at a 7-day view overwrote today's canonical history with filtered totals**, and the next unfiltered view overwrote it back; what persisted depended on which URL a human opened last.
- **Defect class widened at implementation, ACCEPTED by owner decision — no new workstream.** `allOpps` is also narrowed by `scopeIds` (the ecosystem scope), so the *scope selector* corrupted the row too. The owner ruled this a second instance of one class, **FILTERED-VIEW SNAPSHOT POISONING** — any caller-side narrowing reaching the canonical row — not unrelated scope creep. The structural writer closes timeframe filtering, ecosystem-scope filtering and any future caller-side filtered projection together.
- **Fix (Owner Ruling 1, option B):** new `src/lib/pipeline/snapshot.ts` → `upsertCanonicalPipelineSnapshot(db, orgId)`. It accepts **no caller-computed value** — no `open_count`, `open_usd`, `weighted_usd`, `crm_usd`, `timeframe`, horizon or filtered set — and derives everything itself from the org's **full unfiltered** set using the canonical stage curve. **Poisoning is impossible by API shape, not by caller discipline.** `/pipeline` now holds no snapshot write at all.
- **Owner Ruling 2 honoured:** the read-triggered write is **KEPT** — history still accrues just by looking. No cron, job, endpoint or scheduler added.
- **Owner Ruling 3 honoured:** `crm_usd` is recomputed **inside** the writer (latest-per-opportunity `distinct on … reported_at desc, id desc` over `crm_snapshots`, closed stages and nulls excluded). The page passes none. **No architectural widening was needed**, so the ruling's STOP clause was not reached.
- **`dp1-snapshot-boundary` 26/0** (SEEDED / `SEEDED_CLONE`), covering the 21-item list. Every expected value is computed **independently** — the writer never certifies itself. `?timeframe=7/30/90` leaves the row **byte-identical** *and* the filtered projection is asserted materially different, so it cannot pass vacuously. **Negative control: the pre-fix flow, replicated literally, DOES poison the row**; the fixed writer cannot reproduce it. Plus 6 concurrent writers, cross-org refusal under `app_rw`, prior-date immutability, CFR-1.1, a static call-site guard, and send safety.
- **One first-failure captured, not overwritten:** first run was **24/25** — `13: weighted_usd is canonical — 447500.00 vs 462500`. **The test was wrong, not the writer:** the suite's hardcoded curve used `qualification 0.25` / `negotiation 0.8` where canonical `STAGE_PROBABILITY` is `0.2` / `0.75`. `400000×0.6 + 250000×0.75 + 100000×0.1 + 50000×0.2 = 447500`, exactly what the writer produced. The suite now reads the canonical constant.
- **Certification:** `tsc` clean · **429/429** tests · build clean · dg85 19/0 · persisted 17/0 · semantic 50/0 · partnership-app-rw 117/0 · tenant-isolation 205/0 · search-path 39/0 · **31 protected / 0 unsafe** · rehearsal **38/38 + 6/6** · **`certify-world --runs 2` 90 clean / 0 failures, digest `e98b43254f98d5ec` unchanged across both runs**.
- **No migration** — `supabase/migrations` stays at **108** files. Canonical local world unchanged (`e98b43254f98d5ec`, 154 tables, 1051 rows); local `pipeline_snapshots` still its single `2026-09-14` row; all fixtures ran in disposable seeded clones. Send 0/0/0/0/0.
- **Hosted untouched:** no push, no deploy, no hosted read or write, no env / `DATABASE_URL` / `DATABASE_URL_OWNER` / Production change. Hosted record stands: migrations 108 · business `c56a1d229e483f2b` · world `933a5e30d79297a4` · security `2a5ea0509145ee81` · 31/0. **Hosted `pipeline_snapshots` was not modified or rewritten** and no repair routine was added. The last read-only hosted verification during the D-P1 design gate found the 2026-09-15 and 2026-09-16 rows **equal to independent canonical recomputation** (`open_count` 11, `open_usd` 8,040,000, `weighted_usd` 3,361,500) and concluded **no hosted poisoning had occurred**. The local implementation made **no hosted contact**, so it can neither confirm nor disturb that finding. Their current state will be **re-verified read-only as the first step of hosted D-P1 acceptance**. No claim is made that those rows are poisoned or wrong, and none that they are still clean.
- Record: `H1-PRE-PILOT-HARDENING.md` § "D-P1 — FIXED LOCALLY". **Next: hosted D-P1 acceptance — the FINAL pre-Gate-9 gate. Gate 9 NOT started.**

**2026-09-16 — D-G8-5: HOSTED ACCEPTED / CLOSED. Migration 0108 applied. D-P1 is the last blocker.**
- **Deployment:** `b991b0b` pushed fast-forward, deployed as **`dpl_4UPcJFWfxxExqd1MxAXP6WCVR8HW`** (Preview, READY). **`src/` unchanged in that commit**, so it is application-code equivalent to the accepted build. `app_rw` / bypassRls false / tenantEnforcement true / probe live / sending off; env unchanged (18 vars).
- **0108 applied alone**, identity hard-guarded, one transaction → level **108**, pending none. The pushed file was verified byte-identical to the locally certified one before applying: `CREATE OR REPLACE`, no DROP, no CASCADE, signature and 4-column shape unchanged, consent/filter clauses verbatim, hardened security header, ROLLBACK block present.
- **Function posture:** exactly 1 definition · 4 columns · SECURITY DEFINER · STABLE · `pg_catalog, public, pg_temp` · owner `postgres` · ACL `{postgres,app_rw}` · **`order by e.observed_at desc, s.id desc limit 20`** · no DROP/CASCADE side effects.
- **Security:** `search-path-verify` 12/12, **31 protected / 0 unsafe**; policies, RLS, grants, triggers, roles, protectedFns, CREATE-on-public all identical; **exactly ONE function body changed — `shared_in_evidence(uuid)`**. **NEW security hash `f31e51d50e9dec49` → `2a5ea0509145ee81`**, recorded only after all of that passed.
- **Functional acceptance on the REAL hosted function (rollback-only, 9/9, zero residue):** 30 planted shares with 12 tied across positions 13..24 → the function returned exactly 20, all strictly-newer present, no older row, **`s.id DESC` selected the 8 highest share ids of the tied band**, identical across 5 planner configurations, non-party zero. Counts returned to baseline `0/20/1/14`.
- **Crawl:** **37/37 rooms 200, all 4 passes byte-identical, and 37/37 identical to the accepted D-G8-4C crawl — no new rendered difference.** All prior defects (D-G5-1, D-G8-1, D-G8-2A, D-G8-3, D-G8-4) remain closed.
- **Database:** **exactly 1 of 155 per-table fingerprints moved — `schema_migrations` 107 → 108**. `evidence_shares` still 0, `companies` 14, `pipeline_snapshots` 2 (CFR-1.1 not needed). **business-data UNCHANGED `c56a1d229e483f2b`.** **NEW whole-world `ff4a3f28c4940a9d` → `933a5e30d79297a4`**, moving only because it includes the ledger.
- **Consent/tenant:** unchanged; Vertex correct, Meridian hidden, no context leak, settlement non-party zero; the two already-accepted policy-visible tables unchanged, with full output captured before any re-run and policies proven byte-identical pre→post.
- **Send safety:** 0 / 0 / 0 / 0 / 0. Duplicate-share behaviour intentionally unchanged.
- **HOSTED RECORD OF RECORD:** migrations **108** · business-data `c56a1d229e483f2b` · whole-world **`933a5e30d79297a4`** · security **`2a5ea0509145ee81`** · 31/0 · `app_rw` LOGIN true / BYPASSRLS false.
- Record: `H1-PRE-PILOT-HARDENING.md` § "D-G8-5 — HOSTED ACCEPTED / CLOSED". **D-P1 is now the FINAL pre-Gate-9 blocker. Gate 9 NOT started.**

**2026-09-16 — D-G8-5: FIXED LOCALLY / NOT PUSHED. Migration 0108, no application-code change.**
- **Defect:** `shared_in_evidence()` ended `order by e.observed_at desc limit 20` — not total. With >20 eligible rows and ties across the 20/21 boundary, heap/planner order decided which rows survived the **cap**. The damage is **membership**: `timeline.ts` re-sorts and re-slices, so a dropped row never reaches the timeline at all.
- **Final key is `s.id`, not `e.id`:** `evidence_shares` is `unique (evidence_id, partnership_id)`, so one evidence object shared on two partnerships returns the same `e.id` twice. `s.id` is the PK of the returned row, consulted only after `observed_at` ties.
- **0108 uses `CREATE OR REPLACE`, never DROP** — the shape and signature are unchanged, so owner/ACL/`search_path` survive; no CASCADE, no grant churn. Consent, filters and joins carried over verbatim. ROLLBACK block states plainly that reverting reintroduces the defect.
- **Verified locally:** 1 definition · same 4 columns · SECURITY DEFINER · STABLE · `pg_catalog, public, pg_temp` · owner `postgres` · ACL `{postgres,app_rw}` · `order by e.observed_at desc, s.id desc limit 20` · **31 protected / 0 unsafe**.
- **New `dg85-determinism` suite 19/0** on a 30-row fixture with 12 rows tied across positions 13..24: identical selected set across 5 planners × 2 heaps; the deployed **function** identical under owner and the real `app_rw`; forward/reverse/shuffled insertion identical; **negative control — the pre-fix clause produced 3 distinct selected sets over 20 runs**; ≤20 populations unchanged pre/post; non-party zero; revoke and partnership-deactivation remove rows; duplicate shares deliberately still two rows.
- **Application-code impact: NONE** (`git status src/` empty).
- **Certification:** SQL smoke · `tsc` · **429/429** · build · **certify-world --runs 2 88 clean / 0 failures**, digest `e98b43254f98d5ec` unchanged · persisted 17/0 · semantic 50/0 · partnership 117/0 · tenant-isolation 205/0 · search-path 31/0 · fingerprint identical · **zero fixture residue** · send 0/0/0/0/0 · local migration level **108**.
- **One unclassified observation:** the first rehearsal run after 0108 reported 37/38; the differing room was not captured before re-running, and three subsequent runs were 38/38 + 6/6. Recorded, not dismissed.
- **Hosted unchanged** (migrations 107, `f31e51d50e9dec49`). The hosted security hash **will** move when 0108 is applied; no value is pre-authorized. Record: `H1-PRE-PILOT-HARDENING.md` § "D-G8-5". **D-P1 is now the final pre-Gate-9 blocker. Gate 9 NOT started.**

**2026-09-16 — D-G8-4C: HOSTED ACCEPTED / CLOSED. D-G8-4 OVERALL: HOSTED ACCEPTED / CLOSED.**
- **Deployment:** `48a6157` pushed fast-forward, deployed as **`dpl_Ey7DdPDSWzsk5dJ3ASMbqbLmtxf7`** (Preview, READY, alias target). `app_rw` / bypassRls false / tenantEnforcement true / probe live / sending off. Env unchanged (18 vars). Code-only — no migration, no `normalized_name` repair.
- **Deployed resolver:** rung 4 applies `normalizeCompanyName` to **both** sides; reads `companies.normalized_name` **zero** times; no `length(`, no `order by` in the module; ladder intact (canonical id → ID alias → name/domain alias → normalized exact → unique fuzzy → unresolved).
- **Initech regression FIXED on real hosted data:** exactly 1 canonical name normalizes to the input while 2 fuzzy candidates remain, and `"Initech Financial"` now **RESOLVES via NORMALIZED_NAME** (was AMBIGUOUS). `Globex Manufacturing Inc.` and `Stark Industries LLC` likewise resolve at rung 4.
- **Ambiguity intact:** two names normalizing alike → **AMBIGUOUS (2)**, proven in a **rolled-back** transaction with **zero residue** (`companies` 14 → 14); zero normalized-exact → fuzzy → **UNRESOLVED (2)**; `"o"` still AMBIGUOUS (7). ask-scope still **fails closed** with no candidate leakage — and the now-resolvable exact name is **allowed**.
- **Crawl:** **37/37 rooms 200, all 4 passes byte-identical, and 37/37 identical to the accepted D-G8-4 crawl — no new rendered difference**, as predicted. D-G5-1, D-G8-1, D-G8-2A, D-G8-3A/B/D all remain closed; the Stark disclosure and most-common-outcome line persist.
- **Database:** **0 of 155 per-table fingerprints changed**; **`companies` content hash identical at 14 rows** — no row rewritten, `normalized_name` untouched. migrations **107**, business-data `c56a1d229e483f2b`, whole-world `ff4a3f28c4940a9d`, security `f31e51d50e9dec49`, 31/0. CFR-1.1 not needed.
- **Send safety:** 0 / 0 / 0 / 0 / 0.
- **D-G8-4A, 4B, 4C and 4D are all CLOSED. D-G8-4 overall is HOSTED ACCEPTED / CLOSED** — not to be reopened absent a new concrete defect. Record: `H1-PRE-PILOT-HARDENING.md` § "D-G8-4C HOSTED ACCEPTED / CLOSED". **D-G8-5 and D-P1 remain OPEN. Gate 9 NOT started.**

**2026-09-16 — D-G8-4C: CORRECTED LOCALLY, NOT PUSHED.**
- **Ruling applied:** normalization at comparison time. No backfill, no migration, no hosted data rewrite, no raw-`legal_name` rung, no weakening of ambiguity.
- **Root cause:** rung 4 compared the normalized input against the STORED `companies.normalized_name`, which holds raw legal names here (**0/14** agreement) — so the rung was inert and exact names fell through to fuzzy.
- **Fix:** rung 4 applies `normalizeCompanyName` to **both** sides (typed input and `legal_name`), scoped to the authorized set when given. One match resolves · two or more AMBIGUOUS · zero falls through to unique-fuzzy, which can never override it. `normalized_name` is neither read by this resolver nor modified — other consumers keep their contract.
- **Verified against REAL hosted data, read-only:** `Initech Financial` **AMBIGUOUS (2) → RESOLVED via NORMALIZED_NAME**; Globex / Stark / Acme / Tyrell all moved from UNIQUE_FUZZY to NORMALIZED_NAME; `"o"` still AMBIGUOUS (7), so ambiguity is unweakened.
- **Tests:** `semantic-determinism` **50/0**, including the Initech reproduction against the canonical world's own rows, two-names-normalize-alike → AMBIGUOUS, and alphabetical/uuid/heap decoys proven irrelevant.
- **Certification:** `tsc` · **421/421** · build · **certify-world --runs 2 86 clean / 0 failures** digest `e98b43254f98d5ec` unchanged · rehearsal 38/38 + 6/6 · partnership 117/0 · tenant-isolation 205/0 · persisted-determinism 17/0 · search-path 31/0 · fingerprint identical · send 0/0/0/0/0 · **migrations 107** · `companies` still 14.
- Record: `H1-PRE-PILOT-HARDENING.md` § "D-G8-4C CORRECTION". **Hosted still runs `982a01f` with the fail-safe defect. D-G8-5 and D-P1 remain open. Gate 9 NOT started.**

**2026-09-16 — D-G8-4A/B/D: HOSTED ACCEPTED / CLOSED. D-G8-4C: NOT ACCEPTED, OPEN.**
- **Deployment:** `982a01f` pushed fast-forward and deployed as **`dpl_29srUo2LNtc6FW7dm12K3ZVxRGo5`** (Preview, READY, alias target). `/api/build`: `mejokqxriwyawfhawuxu` · `app_rw` · bypassRls false · tenantEnforcement true · probe live · sending off. Env unchanged (18 vars).
- **Database — D-G8-4 is code-only and the database proves it:** migrations **107**, business-data `c56a1d229e483f2b`, whole-world `ff4a3f28c4940a9d`, security `f31e51d50e9dec49`, 31 protected / 0 unsafe, **0 of 155 per-table fingerprints changed**; policies/RLS/grants/triggers/roles/functions/applied all identical. CFR-1.1 not needed.
- **Crawl:** **37/37 rooms 200, all 4 passes byte-identical**; 34/37 identical to the accepted D-G8-3 crawl with **3 explained differences**, line counts unchanged: the **pre-registered Stark disclosure** (`Contract expiry / Renewal`, with the **union** of competing dates `2026-10-31 vs 2026-12-12`) on `/pipeline` and partner review, and 4B's new `Most common outcome CLOSED_WON (4 of 4 · 100%)` on Globex pursuit detail. D-G5-1, D-G8-1, D-G8-2A and D-G8-3A/B/D all remain closed; CDW label intact; Meridian absent.
- **4A ACCEPTED:** CUSTOMER_DECLARED > THIRD_PARTY_VERIFIED, THIRD_PARTY_UNVERIFIED > INFERRED, HUMAN_ASSERTED = SECOND_PARTY (→ UNRESOLVED); both selectors share the comparator; LADDER_RANK stays out; live Stark tie returns UNRESOLVED.
- **4B ACCEPTED:** median independently recomputed from hosted rows — 4 terminal, **0 timestamped → null (UNKNOWN, never zero)**; mode CLOSED_WON 4/4 100%; no categorical value labelled median.
- **4D ACCEPTED:** verified in a **rolled-back** hosted transaction — an unscored population leaves `company_id` NULL and the LEFT JOIN keeps it visible; **zero residue**.
- **Tenant/consent PASS; send safety 0/0/0/0/0.**
- **4C NOT ACCEPTED — defect found in acceptance.** `companies.normalized_name` holds the **raw** legal name on hosted (agreement **0/14** with `normalizeCompanyName`), so ladder **rung 3 (exact normalized match) never fires** and identity falls through to unique-fuzzy. Demonstrated: the exact name **`Initech Financial`** (1 exact match) returns **AMBIGUOUS (2)** because fuzzy also catches `Initech Financial (expansion)`. **Fail-safe — it never resolves to the wrong company, and ask-scope correctly blocks — but it is not the approved semantics.** Everything else in 4C passed (canonical id, unique fuzzy, multi-candidate → unresolved with 7 candidates, no length/alphabet/uuid/row-order rule anywhere; ask-scope fails closed as its own outcome with no leakage; as-of in-force facts reproducible including a historical 2020 as-of; plan-loaders VERIFIED > INFERRED).
- Record: `H1-PRE-PILOT-HARDENING.md` § "D-G8-4 HOSTED ACCEPTANCE". **D-G8-4 overall NOT CLOSED pending 4C. D-G8-5 and D-P1 remain open. Gate 9 NOT started.**

**2026-09-16 — D-G8-4A/B/C/D: FIXED LOCALLY / NOT PUSHED. CODE-ONLY — no migration.**
- **No migration created.** The repo stays at **107**, matching hosted, so database security/catalogue state is untouched. Local only; nothing pushed or deployed.
- **4A:** `PROVENANCE_STRENGTH` is canonical for lifecycle/source-truth selection (`LADDER_RANK` untouched, still serving value drivers). Order: confidence → recency → provenance strength → UNRESOLVED. `projection.ts` gained the missing recency key so the two selectors cannot disagree. **CUSTOMER_DECLARED > THIRD_PARTY_VERIFIED**, **THIRD_PARTY_UNVERIFIED > INFERRED**, and **HUMAN_ASSERTED = SECOND_PARTY → UNRESOLVED** when only they separate candidates. `primaryLifecycleEvent` stays a state question; ties are **disclosed** (shared state/timing, both labels, union of competing dates). **This surfaced a real ambiguity: Stark has two CONFLICTING_DATE events, previously resolved by array order — `/pipeline` now reads "Contract expiry / Renewal". Expect this visible change at hosted acceptance.**
- **4B:** the median was one arbitrary `outcome_label` group's percentile picked by `rows.find()` over an unordered `group by` — now computed over the **whole eligible terminal timestamped population**. Added **"Most common outcome"** with count and share; **tied modes surface as a tie**. null stays UNKNOWN, never zero.
- **4C entity:** new query-side ladder — canonical id → ID-type alias → name/domain alias → exact normalized name → unique fuzzy → unresolved. Name length, alphabet, uuid and row order are gone as identity signals. Conflicting ID aliases with no namespace → UNRESOLVED (no precedence invented among id types).
- **ask-scope:** ambiguity now **FAILS CLOSED** with a distinct `ambiguous_account` outcome — never reported as out-of-scope — carrying a **count only**, no candidate names or ids.
- **4C facts:** eligibility now includes the **validity window** against an **explicit asOf captured once** at the read-model boundary; `loadDrivers` no longer reads the clock. `conflicting → UNRESOLVED` preserved. `plan-loaders`: **VERIFIED_DATE beats INFERRED_WINDOW** on an equal date, via the existing state rank.
- **4D:** explicit validated seed → unique top scorer → **UNRESOLVED (`company_id` NULL)**. Both forbidden fallbacks removed. `company_id` was already nullable so **no migration**; readers LEFT JOIN and render **"Seed account not selected"**; **launch refuses** until a seed is chosen.
- **Certification:** `tsc` clean · `npm test` **420/420** · build OK · **`certify-world --runs 2` 86 clean / 0 failures**, digest `e98b43254f98d5ec` unchanged · rehearsal **38/38 + 6/6** · `partnership-app-rw` **117/0** · `tenant-isolation` **205/0** · `lifecycle-query` **80/80** · search-path **31/0** · new **`semantic-determinism` 38/0** · canonical fingerprint identical · 0 send rows · **migrations still 107**.
- Record: `H1-PRE-PILOT-HARDENING.md` § "D-G8-4A/B/C/D". **D-G8-5 and D-P1 remain OPEN. Gate 9 NOT started.**

**2026-09-16Z — D-G8-3A/B/D: HOSTED ACCEPTED / CLOSED. D-G8-3 complete for the approved scope.**
- **Deployment:** `21326e5` pushed as a normal fast-forward (`230ee7b..21326e5`, no force/rewrite/tags) and deployed as **`dpl_K88acSQbydWTU4UjthhCEuT4GXsC`** (Preview, READY, branch alias target). `/api/build`: `mejokqxriwyawfhawuxu` · `app_rw` · bypassRls false · tenantEnforcement true · probe live · sending off.
- **No migration re-applied.** Level **107** verified; `partnership_settlement_rows` still 10 columns / `opportunity_id` last / SECURITY DEFINER / STABLE / `search_path pg_catalog, public, pg_temp` / ACL `{postgres,app_rw}` / `order by o.updated_at desc, o.id`; **31 protected / 0 unsafe**; security hash **`f31e51d50e9dec49`** steady. No drift.
- **Crawl:** two signed-in 37-room crawls, 4 passes. **37/37 rooms 200, all 4 passes byte-identical, and 37/37 byte-identical to the accepted D-G8-2A crawl** — the D-G8-3 app code produced **zero rendered change** on hosted, as predicted. D-G5-1, D-G8-1 and D-G8-2A all remain closed; CDW label unchanged; "Meridian" appears 0 times.
- **3A (9/9):** deployed readers use `position asc nulls last, id`; composer writes the authored index. A **rollback-safe hosted round trip** inserted 4 assets in REVERSE with identical `created_at` and proved the deployed reader returns the authored order, the old clause returns the exact reverse, and a duplicate slot is refused — **no residue** (`campaign_assets` and `campaigns` back to 0 rows).
- **3B (7/7):** `SettlementEntry` carries `opportunityId`, used as the render key; **no raw id in visible UI text**; authorized rows render with unique non-null `opportunity_id`, order exactly `updated_at DESC, opportunity_id ASC`, identical across 5 plans, **non-party zero**.
- **3D (8/8):** every certified tie-break present in the built commit; `campaign-email.ts` has exactly **one** `brand_profiles` query; read-only evaluation returned identical identity over 10 reads per site with **no durable writes**. Five of seven sites have empty live hosted populations — their determinism rests on deployed-code identity plus the local suite (17/0); the two with live data were genuinely exercised.
- **Database: the deployment mutated nothing — 0 of 155 per-table fingerprints changed.** business-data `c56a1d229e483f2b` · whole-world `ff4a3f28c4940a9d` · security `f31e51d50e9dec49` · manifest `14e2e97f8453fb75` · `campaign_assets` 0 rows. `pipeline_snapshots` stayed at 2 rows with an identical hash, so **CFR-1.1 did not need to apply**.
- **Tenant/consent:** Vertex correct, Meridian hidden, no context leak, consent correct, settlement non-party zero. The only context-less visible tables are the two already accepted (`environment_identity`; `pursuit_team_requirements`, 5/5 `org_id IS NULL` templates). No new isolation failure.
- Env unchanged (18 vars); sending off; Production and `qifatlqxfuhwrwvpbwsc` untouched. Record: `H1-PRE-PILOT-HARDENING.md` § "D-G8-3 HOSTED APPLICATION ACCEPTANCE". **D-G8-3C is NOT solved — it is D-G8-4D. Gate 9 NOT started.**

**2026-09-15 local / 2026-09-16Z — D-G8-3 HOSTED MIGRATION GATE: PASS.**
- **Migrations only.** `0106` then `0107` applied separately to `mejokqxriwyawfhawuxu` while the accepted Preview (`dpl_Ebt9cv9v7ZVNMNYsNBk5ytL96fzP`, `230ee7b`) kept serving. **No app code pushed or deployed** — `b1d7c6a` and `0a5e9a8` stay local, `origin` stays at `230ee7b`. No Vercel env, `DATABASE_URL`, `DATABASE_URL_OWNER`, Production or `qifatlqxfuhwrwvpbwsc` change.
- **Baseline matched exactly** (migrations 105, business `c56a1d229e483f2b`, world `68b56d3093a2607c`, security `30772757ebd4688c`, 31/0, `campaign_assets` 0 rows, 0 send rows). CFR-1.1 did not apply — no new-date `pipeline_snapshots` row.
- **0106:** level 106; `position` integer / nullable / no default; partial unique index `(campaign_id, position) where position is not null`; existing `campaign_assets_campaign_idx` kept; 0 rows. Old app healthy afterwards.
- **0107:** level 107; function returns **10 columns with `opportunity_id` last**; SECURITY DEFINER, STABLE, `search_path pg_catalog, public, pg_temp`; ACL `{postgres=X/postgres,app_rw=X/postgres}`; body `order by o.updated_at desc, o.id`; one definition; **no CASCADE side effects**.
- **Security:** hosted `search-path-verify` **12/12, 31 protected / 0 unsafe**; policies, RLS/FORCE, grants, triggers, roles, CREATE-on-public, `app_rw` attributes and `protectedFns` all byte-identical pre/post; the only function changed is `partnership_settlement_rows(uuid)`. **New security hash `f31e51d50e9dec49`** (was `30772757ebd4688c`) — accepted only because every invariant passed.
- **Data:** **exactly one of 155 per-table fingerprints moved — `schema_migrations` 105 → 107 rows.** `campaign_assets` still 0 rows; `pipeline_snapshots` still 2. **Business-data fingerprint UNCHANGED at `c56a1d229e483f2b`**, proving no canonical business row was rewritten. Manifest unchanged. Whole-world `68b56d3093a2607c` → **`ff4a3f28c4940a9d`**, moving only because that digest includes the ledger.
- **Settlement (as `app_rw`):** authorized party gets its rows, `opportunity_id` present/unique, order exactly `updated_at DESC, opportunity_id ASC`, identical across 5 planner configurations, **non-party zero**, nothing written.
- **Old-app compatibility:** 10/10 rooms 200 after 0107 (Partners, partner detail, Joint, joint room, Today, Pipeline, Admin, account detail, brief, `/api/build`), line counts equal to the pre-migration crawl, no foreign data.
- **Tenant isolation:** `tenant-isolation` **205/0 three times with full output retained**, zero failure lines — the earlier local transient did not recur. The two tables my broad sweep flagged (`environment_identity`, `pursuit_team_requirements`) are visible **by their own unchanged policies**, all 5 of the latter being `org_id IS NULL` templates; both policies and fingerprints are byte-identical pre/post. Classified, not dismissed.
- Record: `H1-PRE-PILOT-HARDENING.md` § "D-G8-3 HOSTED MIGRATION GATE". **D-G8-3 is NOT fully hosted-accepted — the app code is still undeployed. Gate 9 NOT started.**

**2026-09-15 — D-G8-3A/B/D: FIXED LOCALLY / NOT PUSHED. D-G8-3C reclassified to D-G8-4D.**
- **Design gate first**, then owner-approved implementation. Local only: nothing pushed or deployed; hosted untouched.
- **0106 (D-G8-3A):** `campaign_assets.position` — nullable integer, no default, partial unique index on `(campaign_id, position)`, backfilled by the composer's own canonical `asset_type` order. The composer writes the array index; readers use `order by position asc nulls last, id`. `created_at` was `transaction_timestamp()`, so all four assets tied and heap order decided the brief. `NOT NULL` deferred (0108 not created). Hosted `campaign_assets` = 0 rows.
- **0107 (D-G8-3B):** `partnership_settlement_rows()` gains `opportunity_id uuid` as the last column and orders `updated_at desc, o.id`. A `RETURNS TABLE` change needs **DROP + CREATE**, so the migration atomically restores SECURITY DEFINER, STABLE, `search_path pg_catalog, public, pg_temp`, the PUBLIC/anon/authenticated/service_role revokes and `EXECUTE` to `app_rw`. No CASCADE. **31 protected / 0 unsafe** confirmed after the replace. The read model carries `opportunityId` as the render key.
- **D-G8-3C NOT implemented → D-G8-4D OPEN (pre-Gate-9 blocker).** The seed rule is "best-scoring population member"; on a score tie — and when nothing is scored — it picks no winner, and alphabetical `legal_name` must not become the product rule. The site is left exactly as it was, with a guard asserting so.
- **D-G8-3D:** mechanical tie-breaks on all scoped persisted-selection sites (brand, thread, previous score, motion score/play/team, routines ×6). Every business key preserved, only a stable final unique key appended. `campaign-email.ts` now resolves the brand **once**, so the rendered brand and the persisted `brandId` can no longer diverge. `motions/actions.ts` stays closed from D-G8-2A.
- **Certification:** `tsc` clean · `npm test` **407/407** · build OK · **`certify-world --runs 2` 84 clean / 0 failures**, digest `e98b43254f98d5ec` unchanged · rehearsal **38/38** + **6/6** · `partnership-app-rw` **117/0** · `search-path` 31/0 · new **`persisted-determinism` 17/0** (5 plans × 2 heaps × owner/app_rw, reversed insertion, duplicate-position refusal, non-party settlement visibility zero) · canonical fingerprint **identical before and after both migrations** · zero residue · 0 send rows.
- **One unreproduced transient:** the first `certify-world` run reported `tenant-isolation` 204/1; detail was lost and it never recurred (six clean runs since). Recorded, not dismissed.
- Record: `H1-PRE-PILOT-HARDENING.md` § "D-G8-3A/B/D". **Gate 9 NOT started.**

**2026-09-15 local / 2026-09-16Z — D-G8-2A: HOSTED ACCEPTED / CLOSED.**
- **Deployment:** `a5da3b2` as `dpl_BcKULAScmeWVZaQYkakWbCRiZw7w` (Preview, READY, branch alias target). `/api/build`: `mejokqxriwyawfhawuxu` · `app_rw` · bypassRls false · tenantEnforcement true · probe live · sending off — unchanged after both crawls.
- **Crawl:** two signed-in 37-room crawls, each with its own `/login` sign-in as the synthetic Vertex owner, every room twice — **4 passes. All 37 rooms 200 and all 4 passes byte-identical.** No empty state, no error, no foreign tenant data ("Meridian" appears in none of the 37 rooms).
- **Ordering (Part E):** measured against a fresh 4-pass crawl of the still-READY accepted D-G8-1 deployment (`dcde3b6`) — **32/37 rooms byte-identical, 5 pure reorders, 0 membership changes.** The reorders are the Acme/Stark motion-draft rows on Today + drawer, the champion provenance pair on Globex pursuit detail, and the `/pipeline` deal cards; each maps to a committed tie-break in `pipeline/page.tsx`, `motions/actions.ts`, `detail.ts` or `coverage.ts`. A pure reorder preserves the line multiset exactly, so **no amount, status or business scalar changed**. The changed queries are all cap-bearing yet no row entered or left a capped set.
- **Regressions (Part F):** D-G5-1 Today order and D-G8-1 stakeholder order (Dana → Mike → Priya → Sarah) both render exactly as accepted; CDW label intact; shell stable; both sign-ins selected the same org; motions `5 active · 2 draft` stable.
- **Database (Part G):** migrations 105, security hash `30772757ebd4688c`, manifest `14e2e97f8453fb75` unchanged (no CFR-1.1 normalisation needed), `app_rw` LOGIN true / BYPASSRLS false, protected 31 / unsafe 0, roles-policies-grants-triggers byte-identical. **154/155 per-table fingerprints identical**; only `pipeline_snapshots` 1 → 2, a new-UTC-date row with **identical** values (11 open · $8,040,000 · $3,361,500) — the look-to-write behaviour Gate 4 explicitly predicted. Digests moved to business `c56a1d229e483f2b` / world `68b56d3093a2607c`; **NOT auto-re-baselined — the fingerprints of record need an owner decision.**
- **Tenant/consent (Part H):** no-context `app_rw` returns 0 rows on all 127 org-scoped tables; the 28 catalog tables plus `environment_identity` and `pursuit_team_requirements` are visible by their own unchanged policies (all 5 of the latter are `org_id IS NULL` templates, 0 org-owned). Vertex sees exactly its 13 pursuits; the Meridian pursuit stays hidden; consent surface correct; no cross-transaction context leak.
- **Send safety:** sending unarmed; 0/0/0/0/0 send rows; no delivery, no webhook events.
- **Closure (Part J):** manifest re-verified by `shasum` — 333 files, SHA-256 `94491ea1…`; scanner `ordering-scan` v1.1.0; 173 original findings; **unresolved inside the boundary = 0**. `src/worker/**`, `src/proxy.ts` and the other excluded modules remain **NOT ASSESSED** — not "clean". The audit was not reopened.
- No Vercel env, `DATABASE_URL`/`DATABASE_URL_OWNER`, migration, role/RLS/grant/policy, deliberate-data or Production change; `qifatlqxfuhwrwvpbwsc` never contacted. Record: `H1-PRE-PILOT-HARDENING.md` § "D-G8-2A hosted acceptance". **Gate 9 NOT started.**

**2026-09-15 — D-G8-2A: CONVERGED within the frozen certified-surface boundary.**
- **Frozen closure (the reproducibility anchor):** `docs/vnext/D-G8-2A-CLOSURE-MANIFEST.txt`, **333 files**, **SHA-256 `94491ea17071b38fd75f73219a8d5f262ceb4d9d367f136371c281cd3b68716a`**, builder `closure-manifest` v1.0.0, scanner `ordering-scan` v1.1.0, allowlist 9 (each with a checkable reason). Soundness proved by a resolution-based reverse-dependency check; **`--verify` after all edits returns VERIFY PASS**, so nothing escaped the closure.
- **Result: 173 → 63; unresolved D-G8-2A inside the boundary = 0.** All 173 dispositioned: 110 resolved (fixes + 9 reasoned allowlist entries), 21 D-G8-3, 13 MCP/agent-only, 11 ingest/intel-only, 10 D-G8-4C, 3 D-G8-4A, 2 D-G8-4C in-force, 2 worker/send, 1 D-G8-2B.
- **Scanner correction:** v1.0.0's 177 is **void** — its ORDER BY extraction ran past lateral/subquery boundaries and re-flagged already-certified sites. The baseline of record is 173 at v1.1.0.
- **In scope by impact, not pathname:** the shared shell (`layout.tsx` — a tie flipped the `/routines` alert count), tenant/org context (`auth/org.ts`, `join`, `login`), and reachable read-models deciding a rendered value, a pick, or membership under a cap.
- **Reclassified on evidence:** `motions/actions.ts:73` was labelled D-G8-3 but actually decides which accounts enter the draft batch under a cap → 2A, fixed. `trust/page.tsx:29` confirmed a non-defect (`model` is the GROUP BY key) and left unmodified.
- **NOT ASSESSED BY D-G8-2A CLOSURE:** `src/worker/**`, `src/proxy.ts` and 51 other excluded modules — outside the frozen closure, *not* declared clean.
- **Certification:** SQL smoke tests pass, `tsc` clean, `npm test` 388/388, `ordering-determinism` 43/43, build OK, **`certify-world --runs 2` 82 clean / 0 failures**, digest `e98b43254f98d5ec` unchanged, rehearsal **38/38** + 6/6, no residue, send rows 0/0/0.

Record: `H1-PRE-PILOT-HARDENING.md` § "D-G8-2A — CONVERGED within the frozen certified-surface boundary". **Gate 9 NOT begun.**

**2026-09-15 (latest) — D-G8-2A final convergence attempt: STOPPED, NOT CONVERGED.**
- **Fixed (16 sites, 8 files, local only):** the three remaining pure tie-breaks (`intelligence.ts` ×2, `mapping/page.tsx` play templates), `insights.ts` ×3 (including the rank comparator before a 200-row cut that decides which accounts are selectable and therefore persistable), `funnel.ts` ×5, `value/aggregate.ts`, `overlap.ts`, `partnerships.ts`, `quotes.ts` ×2.
- **Reclassified as directed:** `projection.ts:87` → D-G8-4A · `intelligence.ts:384` → D-G8-4B · `multi-vendor.ts:202` → D-G8-3C · `mapping/page.tsx:843` → D-G8-2B.
- **Round five found C = 44 across 27 root files, none audited in rounds 1–4** — so convergence (C = 0) is NOT met and the sweep was stopped rather than expanded a fifth time.
- **The structural finding:** the closure reachable from `src/app/**` is 109 lib modules; rounds 1–4 examined ~15. Fixes were applied per SITE, not per PATTERN, so round-four fixes have unfixed twins (`value/aggregate.ts:53` fixed / `value/intents.ts:60` not; `funnel.ts:262` fixed / `outcome-summary.ts:28` not). Four patterns account for all 44.
- **Recommendation:** approve a bounded, mechanical sweep of those four patterns across the full closure as its own workstream, with an explicit file list — not another fix-and-re-audit cycle.
- **Evidence for the 16 fixes:** SQL smoke test (all changed statements execute), `tsc` clean, `npm test` 388/388, `ordering-determinism` 43/43, build OK, **`certify-world --runs 2` 82 clean / 0 failures**, digest `e98b43254f98d5ec` unchanged, no drift, rehearsal **38/38** + 6/6, no residue, send rows 0/0/0.
- **New, recorded not implemented:** D-G8-3D (persisted brand/thread/score/motion/routine selections), D-G8-4C (entity resolution by `length(name)`), D-G8-5 (migration-gated `shared_in_evidence()`).

Record: `H1-PRE-PILOT-HARDENING.md` § "D-G8-2A final convergence attempt". **Gate 9 NOT begun.**

**2026-09-15 (latest) — D-G8-2A: FIXED LOCALLY / NOT CONVERGED / NOT PUSHED.**
- **The sweep:** tie-breaking only across the certified surface — every key appended was already in the query's scope; no filter, join, scope or business-ranking change. Six local commits (`ca7e279`, `bb4e484`, `5ac77ce`, `2a8b7ea`, `2211f75`, `aea55c9`), 28 files, +534 / −117.
- **Headlines:** Today's four unordered feeders and both DISTINCT ON picks; `next-best.ts` (cut to a limit on priority alone); the `todaySort` call site; `timeline.ts`, whose comparator never returned 0 — now the exported total `compareTimelineEvents`; the portfolio order and its account-group encounter order; `/pipeline`'s book, ecosystem, CRM tie-out, first-wins registration Map and both capped cuts; the mapping matrix's coverage feeder.
- **Evidence:** `ordering-determinism` red **32/11 → 43/0**, byte-identical over 5 plans × 2 heaps × owner/`app_rw`; negative controls for all seven classes; `tsc` clean; `npm test` **386/386**; build OK; **`certify-world --runs 2` 82 clean / 0 failures**, digest `e98b43254f98d5ec` unchanged, no drift; rehearsal **38/38** + 6/6 consent under both roles, no residue.
- **A flaky certification, root-caused — and it was the harness, not the fix.** Three old-clause negative controls asserted that the planner *must* misbehave, which depends on physical layout, not on the code. Now a deterministic tie-existence check with the variation count kept as a diagnostic.
- **SCOPE EXCEEDED APPROVAL:** 51 sites / 25 files were approved; 83 constructs + 24 + 10 were delivered across 28 files, three of them off the approved list. Each was a one-line tie-break meeting the stated criterion, but the size is an owner call. Nothing is pushed.
- **NOT CONVERGED:** three audit rounds found 24 → 6 → 7. **7 sites remain open**, 4 of which need an owner decision (a provenance tie in `projection.ts:87`; a business-semantics defect at `intelligence.ts:384` where an arbitrary label's median prints as *the* median; a **persisted** campaign seed identity at `multi-vendor.ts:202`, which is the deferred D-G8-3A class; and a column-order choice at `mapping/page.tsx:843`).
- **Open:** D-G8-2B deferred; **D-G8-3A, D-G8-3B and D-P1 remain OPEN** pre-Gate-9.

Record: `H1-PRE-PILOT-HARDENING.md` § "D-G8-2A determinism hardening". **Gate 9 NOT begun.**

**2026-09-15 (latest) — D-G8-1: HOSTED ACCEPTED / CLOSED.**
- **The deployment:** `dcde3b6` auto-deployed as `dpl_7KsA9ssaPHwUxiZcQW8LWXAAe6Pe` (Preview, READY, the alias target). `/api/build` reports `app_rw` / false / true / live; sending off; env unchanged.
- **The crawls:** two full signed-in crawls (4 passes), byte-identical, all 37 rooms 200.
- **The stakeholder order:** on the one multi-stakeholder deal, "Legacy virtualization exit", Postgres derives the order **Dana Whitfield → Mike Rivera → Priya Shah → Sarah Kim** from the rule, and every pass renders it. Against the Gate 8 Phase 2 crawl, the only difference is Priya's and Sarah's rows trading places, each with its own badge.
- **Unchanged:** D-G5-1 order and the CDW label.
- **Database:** 40/0; CFR-1.1 5/0.

Record: `H1-PRE-PILOT-HARDENING.md` § "D-G8-1 hosted acceptance". **Gate 9 NOT begun.**

**2026-09-15 — D-G8-1: FIXED LOCALLY** (hosted-accepted above).
- **The fix:** the `/pipeline` stakeholder query (`page.tsx:169`) had no ORDER BY, so the owner rendered Sarah Kim first and `app_rw` Dana Whitfield. It now orders by `s.opportunity_id, coalesce(ct.name, ct.email), s.contact_id`: the displayed label, then the primary key. There is no business ranking, and no filter, join or scope change.
- **Tests:**
  - static guard: red 4/5 → 5/5;
  - `ordering-determinism` D-G8-1 section: tie fixture, query read from `page.tsx`, 5 plans × 2 heaps × owner/`app_rw`; red 20/3 → **23/0**, byte-identical;
  - rehearsal with a stakeholder tie fixture: **38/38**, documented order under both roles.
- **Regression:** `tsc` clean; `npm test` 377/377; build OK; **`certify-world --runs 2`: 82/82 clean, 3,600 assertions**; digest `e98b43254f98d5ec` throughout; 0 send rows.
- **Audit:** the ordering audit recorded latent category-C candidates as **D-G8-2**. None were observed in hosted crawls; not fixed; the owner decides before Gate 9.
- **Open:** D-P1 stays OPEN. **Not pushed** (a push auto-deploys).

Record: `H1-PRE-PILOT-HARDENING.md` § "D-G8-1". **Gate 9 NOT begun.**

**2026-09-15 — H1B GATE 8: PASS** (Phase 2, restoring `app_rw`: PASS).
- **The restoration:** a value-only update of the branch Preview `DATABASE_URL` (`m6TuSKisz54kJlsD`) from the owner to `app_rw`, built in memory and probed first. Only its `updatedAt` changed; `DATABASE_URL_OWNER` is untouched.
- **The deployment:** `dpl_7UEXPHAU63VqEAuDZja4Ba99iEtu` (`5adeebe`). `/api/build` reports `app_rw` / bypassRls false / tenantEnforcement true / probe live, sending off.
- **Owner paths:** identical.
- **Crawls:** two full crawls, identical to each other; against the Gate 7 `app_rw` crawl, only the 29 Phase 1-validated clock lines differ (deal ages recomputed from source). **D-G8-1: Dana Whitfield first again, matching Gate 7.**
- **Isolation smoke:** 0 tenant rows with no context; Vertex counts equal the owner-scoped counts; the Meridian pursuit is hidden, and 404 through the Preview; no context leak; 3 live `app_rw` backends.
- **Database:** 40/0 pre and post; CFR-1.1 5/0.
- **Env:** equals the Gate 7 `app_rw` record apart from `updatedAt`. Sending is off; Production is untouched.
- **Open:** D-G8-1 (stakeholder ORDER BY) and D-P1 (`?timeframe=` overwrite) — both **must be fixed before Gate 9**.

Record: `H1-PRE-PILOT-HARDENING.md` § "Gate 8 Phase 2". **Gate 9 NOT begun.**

**2026-09-15 — H1B GATE 8 PHASE 1: PASS, with one recorded pre-existing deviation (D-G8-1)** (the rollback to the owner, since restored).
- **CFR-1.1 adopted:** `days_since_activity` is validated by recomputation from its source `updated_at`; everything else stays strict.
- **The rollback:** a value-only update of the branch Preview `DATABASE_URL` (`m6TuSKisz54kJlsD`) to the owner connection. The metadata delta is that entry's `updatedAt` only; `DATABASE_URL_OWNER` is untouched.
- **The deployment:** `dpl_B2wmS3WW1eGeugYnsiWwr6WHsj8H` (`5adeebe`, Preview). `/api/build` reports **`postgres` / bypassRls true / tenantEnforcement false / probe live**, sending off: the expected emergency posture.
- **Owner paths:** identical.
- **Crawls:** two full crawls, identical to each other; D-G5-1 order and the CDW label unchanged. Against the Gate 7 `app_rw` crawl, 29 lines are time-derived +1-day text (the 21:02Z rollover) and 2 lines are the **D-G8-1** swap: the `/pipeline` stakeholder query has no ORDER BY, so Sarah Kim comes first under the owner in every owner crawl and Dana Whitfield first under `app_rw` in every `app_rw` crawl. It is order only and pre-existing.
- **Database:** 40/0 pre and post, every per-table fingerprint identical; CFR-1.1 5/0 pre and post; hero source timestamps unchanged.
- **Production:** untouched.
- **Docs:** committed locally and **not pushed**, so the paused owner state is not redeployed.

Record: `H1-PRE-PILOT-HARDENING.md` § "CFR-1.1" and § "Gate 8 Phase 1". **Phase 2 NOT begun.**

**2026-09-15 — H1B GATE 7: PASS** (final; closed). On `84c09e4` (docs-only over `1c4fb5e`) on the `app_rw` Preview; read-only or rolled back throughout.
- **(i) RLS:** the exact-RLS probe as the real `app_rw` pooler login gives **80/0**.
  - 0 tenant rows with no context.
  - Exact authorized visibility for Vertex, Meridian and TD SYNNEX on all 155 tables.
  - Foreign rows hidden on all 81 org-scoped tables.
  - No pooled-context leak; cross-org writes and escalation refused.
  - `search-path` 12/0.
- **(ii) Crawl:** 37 rooms identical in order to the accepted D-G5-1 crawl; owner paths intact.
- **(iii) Supplemental owner-backed suites:** `vnext-context` 62/0 and `today-tenant` 51/0. `demo-team`, `vnext-attention` and `vnext-coordination` hit hosted-data harness limitations: the kept Slice 2A/2B acceptance history; `vnext-attention`'s tenant sections pass 11/0. The world is unchanged after each suite.
- **(iv) Blind test, an accepted substitution:** the Meridian pursuit fetched through the Preview as Vertex is 404, identical to a nonexistent id.
- **(v) Handshakes:** `partnership-app-rw` on hosted as `app_rw`, in one rolled-back transaction, gives **117/0**, equal to the local baseline.
- **(vi) Owner human review:** PASS.
- **DB (CFR-1):** 0 of 155 tables changed in every snapshot. Env unchanged. Sending off.
- **Open:** D-P1 stays OPEN (before Gate 9).

**Closeout note:** after publishing, the hosted manifest digest read `14e2e97f8453fb75`, not `db1f78f7a11bbacb`, **with no data change**: all 155 per-table fingerprints and the business-data / whole-world fingerprints are identical. `demo-manifest.ts`'s `days_since_activity` is clock-relative, and all 21 values ticked +1 at 21:02Z. Gate 7 PASS stands. **CFR-1.1** (normalise `days_since_activity` in the hosted manifest comparison) is proposed for an owner decision before Gate 8.

Record: `H1-PRE-PILOT-HARDENING.md` § "Gate 7" and § "Gate 7 closeout note". **Gate 8 NOT begun.**

**2026-09-15 — D-G5-1: HOSTED ACCEPTED / CLOSED.**
- **The deploy:** the owner-approved push of `1c4fb5e` auto-deployed `dpl_CZ4iZ5S4q3c4ZLL1cLfddHqTfsC2` (Preview, READY, the branch alias target). Its `/api/build` reports `app_rw` / bypassRls false / tenantEnforcement true / probe live / sending unarmed.
- **Crawls:** two full signed-in 37-room crawls (4 passes) are **identical room for room**, in order. Owner paths are intact through `DATABASE_URL_OWNER`.
- **Exact D-G5-1 results, the same in every pass:**
  - Today View All "stage vs engagement": **Datacenter exit — phase 1 → Kubernetes managed services → Core banking resilience → Legacy virtualization exit**;
  - Today and the drawer show its exact prefix;
  - `/pipeline` CDW label: **"CDW customer book"**.
- **Also changed:** the Globex account timeline's list label ("Account is on …") now reads "CDW customer book". It is the same tied list pair on a second consumer, now consistent with `/pipeline`; disclosed, not a regression.
- **Database (CFR-1 strict):** 0 of 155 tables changed; posture unchanged.
- **Env:** metadata unchanged. Sending is off.
- **D-P1:** stays OPEN (must fix before Gate 9 / a real pilot).

Record: `H1-PRE-PILOT-HARDENING.md` § "D-G5-1 hosted acceptance". **Gate 7 NOT begun.**

**2026-09-15 — D-G5-1: FIXED LOCALLY** (then hosted-accepted, above).
- **The fix:** deterministic tiebreakers, appended after every existing ranking key.
  - `divergence.ts` "stage vs engagement" had no ORDER BY at all; it is now `o.updated_at asc, o.id asc`.
  - The 4 sibling capped rules in the same function each get a final unique key.
  - `projection.ts` list attribution is now `ap.created_at, ap.name, ap.id`.
- **Tests:**
  - new static guard: red 0/4 before the fix, green 4/4 after;
  - new DB suite `ordering-determinism` (SEEDED_CLONE): red 9/8 before (the payloads varied with the plan under both roles), green 17/0 after. It shows byte-identical ordered payloads across 5 planner configurations × 2 heap layouts × owner/`app_rw`, with eligibility unchanged.
- **Page level:** `app-rw-rehearsal` with the tie fixture gives **38/38 rooms line-identical** owner vs `app_rw` (Today, drawer, View All, `/pipeline` included).
- **Regression:** `tsc` clean; `npm test` 376/376; build OK; **`certify-world --runs 2`: 82/82 clean, 3,588 assertions, 0 failures**, canonical digest `e98b43254f98d5ec` throughout; 0 send rows.
- **Not pushed:** a push auto-deploys the branch Preview. **D-P1 unchanged** (it must be fixed before Gate 9 / a real pilot).

Record: `H1-PRE-PILOT-HARDENING.md` § "D-G5-1". **Gate 7 NOT begun.**

**2026-09-15 — H1B GATE 6: PASS (read-only).**
- **Serving:** `dpl_JD8DtC8HjgKSYtvnR2cF7AmyUwYC`, commit `766cb13`. It is docs-only over the Gate 5 code (no non-doc diff since `89b8c95`) and is the branch alias target.
- **Live `/api/build`:** demo · Private demo · `preview` · `roadmap/pursuitos-vnext` · ref `mejokqxriwyawfhawuxu` · **`app_rw` · bypassRls false · tenantEnforcement true · probe live** · commit matches the deployment · sending unarmed.
- **The probe is real:** it queries `current_user`, `rolsuper`, `rolbypassrls` and `row_security` on the running `getPool()`. It fails closed to `unavailable` with nulls.
- **Routing:** normal `getPool()` → `app_rw`, with `withTenant` setting `app.org_id` transaction-locally. `getOwnerPool()` → `postgres`, used only by login, join, admin, ops, research and the webhook.
- **Smoke:** 9 signed-in rooms all return 200. Owner paths are identical.
- **DB (CFR-1 strict):** 0 of 155 tables changed; all posture values unchanged.
- **Env:** metadata identical to Gate 5. Sending is off.
- **Open defects:** D-G5-1 must be fixed **before Gate 7**; D-P1 blocks **Gate 9 / pilot**.

Record: `H1-PRE-PILOT-HARDENING.md` § "Gate 6". **Gate 7 NOT begun.**

**2026-09-15 — H1B GATE 5: PASS.** The normal vNext Preview runtime now runs as **`app_rw`**.
- **The change:** exactly one Vercel mutation. The branch-scoped Preview `DATABASE_URL` (`m6TuSKisz54kJlsD`) received the `app_rw` pooler string by value-only PATCH; its metadata delta is `updatedAt` only. `DATABASE_URL_OWNER` is untouched and still the owner. Production is untouched.
- **The deployment:** `dpl_6TmAg49o7CZcsbAjmhQR1mSvQFkY` (`0570a4c`), redeployed from `dpl_5xGwSWwy…`.
- **`/api/build`:** role `app_rw` · bypassRls false · tenantEnforcement true · probe live · sending unarmed.
- **Auth and owner paths:** identical, including admin members reading `auth.users` through the owner pool.
- **Live evidence:** 3 `app_rw` backends are serving traffic, and tenant rooms render Vertex data, which requires `withTenant` to have set `app.org_id`.
- **Crawl:** all 37 rooms 200. 33 are line-identical; 4 show order-only differences (Today ×3, `/pipeline` list label). The cause is pre-existing untied ORDER BYs; the row sets are proven equal under both roles (**D-G5-1, must resolve before Gate 7**).
- **Database (CFR-1, strict):** 0 of 155 tables changed; business-data `c9623fb5abe2f9bc` and whole-world `dce27935d88743fb` stable; 0 send rows.
- **Rollback:** ready, not rehearsed (Gate 8).
- `?timeframe=` snapshot defect **D-P1** (must resolve before Gate 9 / a real pilot); not used.

Record: `H1-PRE-PILOT-HARDENING.md` § "Gate 5". **Gate 6 NOT begun.**

**2026-09-15 — H1B GATE 4: PASS AFTER DOCUMENTED RE-BASELINE.** Owner decision: re-baseline (option a). The three render-created rows stay; they are not deleted.
- **The three rows:** Vertex `routines` `morning_brief` and `account_digest` (disabled, no runs), plus the Vertex `pipeline_snapshots` row for 2026-09-15. The Gate 4 BEFORE crawl wrote them through the normal `DATABASE_URL` pool, before `DATABASE_URL_OWNER` existed.
- **Stability proof:** snapshot → a second full signed-in crawl (37 rooms × 2) → snapshot, all on the same UTC day. **0 tables changed**; the fingerprints stayed at business-data `c9623fb5abe2f9bc` / whole-world `dce27935d88743fb`; 41/0.
  - The `routines` rows are byte-identical and were not rewritten (xmin unchanged).
  - The same-day `pipeline_snapshots` row is rewritten with identical values.
- **Baseline of record:** migrations 105, manifest `db1f78f7a11bbacb`, business-data `c9623fb5abe2f9bc`, whole-world `dce27935d88743fb`, security hash `30772757ebd4688c`, `app_rw` LOGIN true / BYPASSRLS false.
- **CFR-1:** the manifest and every per-table fingerprint stay strict. There is a narrow, semantically validated allowance for a new `pipeline_snapshots` row on a later UTC date, and for first-render `routines` catalog defaults for an org with none. Any other delta fails.
- **Posture:** `DATABASE_URL_OWNER` is on Preview + `roadmap/pursuitos-vnext` only; `DATABASE_URL` is unchanged; `/api/build` reports `postgres` / bypassRls true / tenantEnforcement false; sending is off.

Record: `H1-PRE-PILOT-HARDENING.md` § "Gate 4" and § "Gate 4 close-out". **Gate 5 NOT begun.**

**2026-09-15 — H1B GATE 4 (as first run): CHANGE APPLIED AND VERIFIED · ONE CRITERION NOT MET · AWAITING OWNER DECISION** (resolved above by re-baseline).
- **The change:** `DATABASE_URL_OWNER` was added to `pursuitos-demo`, **Preview, branch `roadmap/pursuitos-vnext` only**, through stdin. The env metadata diff shows +1 and nothing else; both `DATABASE_URL` entries are identical. No other project or target was touched.
- **The redeploy:** `dpl_4WcVaMZ4jRwzuAppkcdqb5wDCmmn` (`89b8c95`, Preview, READY). Production is unchanged.
- **`/api/build` before and after:** `postgres`, bypassRls true, tenantEnforcement false, ref `mejokqxriwyawfhawuxu`, sending unarmed. **The normal runtime is still `postgres`.**
- **Owner-only paths** (login, join loader, admin members via `auth.users`, ops role) are identical before and after, now served through the separate owner pool. The webhook (503, secret unset) and research (401, closed) are unchanged.
- **Signed-in crawl:** 37 / 37 rooms equivalent before and after, covering Today, Queue, Pursuit Detail, Pipeline, the partnership and joint rooms, and Admin.
- **Database, read-only:** migrations 105, manifest `db1f78f7a11bbacb`, security hash, `app_rw` (LOGIN true, BYPASSRLS false), 31 protected / 0 unsafe and 0 send rows are all unchanged.
- **Not met:** the business-data fingerprint moved `79321d9130d1dc94` → `c9623fb5abe2f9bc`, and the whole-world fingerprint `de05e204801988d1` → `dce27935d88743fb`. The **BEFORE crawl itself caused it, on the pre-change deployment:** `/routines` seeded 2 disabled catalog rows and `/pipeline` wrote today's snapshot row, both through the normal `DATABASE_URL` pool. It is not caused by the variable, so no rollback; the variable stays in place.
- **Owner decision:** (a) re-baseline (recommended), or (b) an approved delete of those 3 rows.

Record: `H1-PRE-PILOT-HARDENING.md` § "Gate 4". **Gate 5 NOT begun.**

**2026-09-15 — H1B GATE 3: PASS.** This was a probe on the isolated vNext database `mejokqxriwyawfhawuxu`, with no hosted mutation: every `app_rw` transaction was rolled back, and the owner was read-only.
- **Login:** `app_rw.mejokqxriwyawfhawuxu` logs in through the transaction pooler `aws-0-ca-central-1.pooler.supabase.com:6543`, using SCRAM, with the password held in memory and never printed or stored. From the connection itself: `current_user = session_user = app_rw`, BYPASSRLS false, not superuser, member of no role, `row_security` on.
- **Method:** the catalogue-driven check compares `app_rw`'s RLS-filtered read of all 155 tables with the owner's evaluation of each table's own policies, on count plus content hash. It is exact for no context and for the Vertex, Meridian and TD SYNNEX contexts.
  - **No context:** 0 tenant-owned rows. Only the 5 designed org-less team-requirement rows and the 29 global reference tables are visible.
  - **Vertex:** counts equal the owner's explicitly Vertex-scoped counts (opportunities 19, contacts 5, pursuits 13, motions 7, stakeholders via parent 5).
  - **Foreign rows:** hidden on all 81 `org_id` tables.
- **Context leak test:** no context → Vertex (ROLLBACK and COMMIT) → no context → Meridian → no context → TD SYNNEX → no context, plus a second fresh client. Every transaction began with no context, and all 10 ran on the **same pooled backend**. **No leak.**
- **Foreign writes on `pursuits`:** foreign UPDATE and DELETE → 0 rows; an INSERT or re-home into another org → 42501; an own-org same-value UPDATE → 1 row. Everything was rolled back.
- **Escalation:** `SET ROLE` to `postgres`, `service_role`, `supabase_admin` and the rest → all refused (42501).
- **Boundary:** `--catalogue-only` gives 12 / 0 pre and post (31 protected, 0 unsafe).
- **Zero residue:** manifest `db1f78f7a11bbacb`, business-data fingerprint `79321d9130d1dc94`, whole-world fingerprint `de05e204801988d1` and every per-table hash are unchanged. No `app_rw`-owned object, no prepared transaction, 0 send rows.
- **Nothing in Vercel changed — Gate 4 NOT begun.**

Record: `H1-PRE-PILOT-HARDENING.md` § "Gate 3". **Next:** Gate 4, which adds `DATABASE_URL_OWNER` to the Vercel Preview and is owner-approved separately.

**2026-09-15 — H1B GATE 2: PASS.** On the isolated vNext database `mejokqxriwyawfhawuxu` **only**, the one approved mutation was run: semantically `ALTER ROLE app_rw WITH LOGIN PASSWORD <operator secret>`.
- All 13 pre-mutation checks passed (32 / 0), with zero delta against the Gate 1b.1 record: target identity; demo / synthetic; migrations 105, latest 0105; manifest `db1f78f7a11bbacb`; business-data fingerprint `79321d9130d1dc94`; whole-world fingerprint `de05e204801988d1`; `app_rw` LOGIN false and BYPASSRLS false; 0 unsafe protected functions; no runtime CREATE on `public`; sending unarmed.
- The secret was checked by presence only. It was hashed in-process to a SCRAM-SHA-256 verifier and applied through a bound parameter, so the plaintext never reached the server, its logs or any file (0 occurrences in a 323-file scan). The mechanism was proven first on a disposable local PostgreSQL 17 with SCRAM host auth.
- The exact role delta: **`rolcanlogin` false → true**, plus the credential. SUPERUSER, BYPASSRLS, NOINHERIT, CREATEROLE, CREATEDB, REPLICATION, connection limit, expiry and memberships are unchanged, and no other role changed (post-check 45 / 0).
- Catalogue, search path (31 / 31 hardened, 0 unsafe; `--catalogue-only` 12 / 0), policies, grants, triggers, manifest, both fingerprints, business counts and partnership data are all **unchanged**. There are 0 send rows.
- The rollback `ALTER ROLE app_rw NOLOGIN` is ready and not executed; it keeps the credential.
- **`app_rw` has not connected — Gate 3 NOT begun.**

Record: `H1-PRE-PILOT-HARDENING.md` § "Gate 2 (re-run)". **Next (done — see Gate 3 above):** Gate 3, the pooler login proof, which is owner-approved separately.

**2026-09-15 — H1B GATE 1b.1: PASS.** Migration `0105_h1b01_temp_schema_hardening.sql` was applied to the isolated vNext database `mejokqxriwyawfhawuxu` **only**, as the one approved mutation, through `scripts/migrate.ts` in a single transaction.
- All 12 pre-mutation checks passed: target identity; demo / synthetic; migrations 104, latest 0104, only 0105 pending; manifest `db1f78f7a11bbacb`; business-data fingerprint `79321d9130d1dc94`; whole-world fingerprint `0288ae73bb385a1c`; `app_rw` LOGIN false with no credential; sending unarmed.
- Migrations 104 → **105** (latest 0105, nothing pending). Manifest `db1f78f7a11bbacb` and business-data fingerprint `79321d9130d1dc94` **unchanged**; business row counts unchanged. The whole-world fingerprint moves `0288ae73bb385a1c` → **`de05e204801988d1`**, and only the `schema_migrations` tracker changed.
- **31 / 31 hardened, 0 unsafe**, derived from the hosted catalogue: 30 functions `pg_catalog, public, pg_temp`, and `app_current_org()` `pg_catalog, pg_temp`. `search-path-verify --catalogue-only` (read-only, hosted-safe) gives 12/0.
- The security-object delta is exactly one tracker row plus `proconfig` on the 31 protected functions. Bodies, owners, EXECUTE grants, definer posture, RLS / FORCE, policies, table and column grants, triggers, roles and memberships are all identical. No CREATE on `public` for any runtime role.
- Partnership data is unchanged, and there are 0 send rows.
- **`app_rw` is still NOLOGIN — Gate 2 NOT performed.**

Record: `H1-PRE-PILOT-HARDENING.md` § "Gate 1b.1". **Next (done — see Gate 2 above):** the Gate 2 re-run, with `APP_RW_PASSWORD` loaded via hidden input in the launching shell.

**2026-09-15 — H1B-0.1 COMPLETE (local): temporary-schema shadowing closed by migration 0105 (not applied to hosted). Gate 2 remains BLOCKED / NOT EXECUTED.**

The owner decision (D-050) is that temporary-schema shadowing is **not** accepted as residual risk for the `app_rw` boundary.

**Migration `0105_h1b01_temp_schema_hardening.sql`:**
- It pins `search_path = pg_catalog, public, pg_temp` on **31** authorization-sensitive functions (`app_current_org`: `pg_catalog, pg_temp`).
- The protected class was derived from the catalogue: every SECURITY DEFINER function, every function an RLS policy calls, and every trigger function. That found 4 more than the known 27: `app_current_org`, `enforce_verified_evidence`, `economic_fact_assertion_guard` and `stakeholder_assertion_guard`.
- No body, owner, grant or data change.

**Proof:**
- `search-path` **39/0**, as the real `app_rw` login:
  - negative control: 0105's own rollback restores the vulnerable posture, the guard flags 31/31, and all 11 exploits succeed;
  - after 0105: 0 unsafe functions, all 11 exploits fail, the guard catches reintroduction, and the CREATE-on-public and definer EXECUTE assumptions hold.
- Static migration lint in `npm test`.
- `partnership-app-rw` **117/0**.
- Rehearsal: `app-rw-rehearsal` after 0105: **38 / 38 rooms identical** under `app_rw` and the owner (Today, Queue, Pursuit Detail — Slice 1 / 2A / 2B — every partnership room); consent fixture **6 / 6** rendered under both; `/api/build` posture truthful — owner `postgres` / `bypassRls: true` / `tenantEnforcement: false`, app_rw `app_rw` / `false` / `true`.
- Certification: `certify-world --runs 2` **80 / 80 suite runs clean** (40 suites incl. `search-path` 39/0 and `partnership-app-rw` 117/0; 3,554 assertions, 0 failures); canonical digest `e98b43254f98d5ec` before run 1, after run 1 and after run 2 — CERTIFICATION INTEGRITY: PASS; manifest `be0da833990ce436` unchanged; 0 send rows.
- Canonical world unchanged: `e98b43254f98d5ec` / `be0da833990ce436`.

**Next (done — see Gate 1b.1 above):** Gate 1b.1 (owner-approved), which applies 0105 to `mejokqxriwyawfhawuxu`. Then the Gate 2 re-run with the secret loaded.

**2026-09-15 — H1B GATE 2: BLOCKED AT PRECHECK, NOT EXECUTED. `app_rw` is still NOLOGIN; no hosted change.**

All 8 identity and data prechecks passed: `mejokqxriwyawfhawuxu` · `demo`/synthetic · 104 migrations with 0104 latest · manifest `db1f78f7a11bbacb` · business-data fingerprint `79321d9130d1dc94` · LOGIN false. Nobody but the owner can CREATE in `public`.

**Blocker 1: the operator secret is not loaded.** `APP_RW_PASSWORD` is absent; no password was generated.

**Blocker 2: SECURITY DEFINER name resolution is shadowable through `pg_temp`.**
- PUBLIC has `TEMPORARY`, and PostgreSQL searches `pg_temp` first for tables unless it is listed.
- Proven locally as `app_rw`: a non-party's temp `partnerships` table let it read another org's settlement rows (0 → 2) and write a broker line.
- A pinned `search_path = pg_catalog, public, pg_temp` blocks it (proven locally).
- It affects 27 hosted functions: 0104's 18, 8 pre-existing RLS helpers, and the guard.

**Recommended:** hardening migration 0105 (search_path only, no data change), certified locally and applied as its own approved step, before a Gate 2 re-run with the secret loaded.

Record: `H1-PRE-PILOT-HARDENING.md` § "Gate 2 — PRECHECK BLOCKED".

**2026-09-15 — H1B GATE 1b: PASS.** Migration `0104_h1b0_consent_scoped_access.sql` was applied to the isolated vNext database `mejokqxriwyawfhawuxu` **only**, as the one approved mutation, through the repo runner in a single transaction.

**Before:** read-only; identity, `demo`/synthetic, 103 migrations with exactly `{0104}` pending, manifest `db1f78f7a11bbacb`, fingerprint `2678f34d4fc7b0a2`, sending unarmed.

**After:** read-only.
- 104 migrations, latest 0104.
- Manifest `db1f78f7a11bbacb` unchanged. The whole-world fingerprint is now `0288ae73bb385a1c`; `schema_migrations` is the only table whose hash changed, and business data is identical.
- Exactly 19 functions, 8 guard triggers and 4 policy changes appeared, identical to the locally certified catalogue. No RLS, grant, role or membership change.
- All definer functions are owned by `postgres` with a pinned `search_path`. No PUBLIC, anon, authenticated or service_role EXECUTE; `app_rw` can execute exactly the 14 runtime functions.
- Partnership and send state are unchanged.
- **`app_rw` is still NOLOGIN — Gate 2 NOT performed.**

Record: `H1-PRE-PILOT-HARDENING.md` § "Gate 1b".

**2026-09-15 — H1B-0 COMPLETE (local). Gate 5 is no longer blocked by partnership / consent behaviour; Gate 1b needs approval.**

Record: `H1-PRE-PILOT-HARDENING.md` § H1B-0; D-049; migration `0104_h1b0_consent_scoped_access.sql` (**not applied to any hosted database**).

- **Partnership flows now work under `app_rw`.** Consent-scoped SECURITY DEFINER functions, one per consent object, return only authorised columns. There is no broad cross-tenant policy.
- **Consent rows cannot be forged.** An `app_rw`-only guard trigger on eight consent tables prevents it.
- **Audit is now truly best-effort.** It goes through a validated function under a savepoint, so an audit write can never abort the business action.
- **Invite redemption** goes through a narrow function that acts only on the presented code.
- **`/api/build`** reports `database.role`, `database.bypassRls` and `database.tenantEnforcement` live.

**Proof:**
- `partnership-app-rw` **117/0**, as the real `app_rw` login. A guard-dropped negative control fails as expected.
- `app-rw-rehearsal`: **38/38 rooms identical**; consent fixture **6/6** rendered under both roles; posture correct under both.
- Certification: `certify-world --runs 2` **78 / 78 suite runs clean** (39 suites incl. `partnership-app-rw`; 3,476 assertions, 0 failures); canonical digest `e98b43254f98d5ec` before run 1, after run 1 and after run 2 — CERTIFICATION INTEGRITY: PASS; manifest `be0da833990ce436` unchanged; 0 send rows.

**Gate 1 (2026-09-15T02:40Z) — PASS AFTER DOCUMENTED RE-BASELINE.** The owner chose re-baseline, not reseed. The hosted baseline of record is manifest `db1f78f7a11bbacb` and fingerprint `2678f34d4fc7b0a2`, intentional Slice 2A/2B acceptance residue. Every other Gate 1 criterion passed as run. Gate 1b is not begun.

**2026-09-14 — H1B BASELINE: COMPLETELY GREEN.** `certify-world --runs 2` gives **76/76 suite runs clean**: 3,242 assertions, 0 failures. The canonical digest is `e98b43254f98d5ec` before run 1, after run 1 and after run 2, and the manifest `be0da833990ce436` is unchanged.

The last failure (`motion-intel`, pre-existing) was a verifier fixture gap, fixed in the verifier (D-047): it had borrowed a linked motion that another suite committed.

**H1B readiness review** (D-048; nothing executed):
- 1 **MUST_RESOLVE_BEFORE_CUTOVER**, proven empirically as `app_rw`: cross-tenant consent flows. Counterpart audit writes abort every partnership handshake, and consented shared reads lose the counterpart's data.
- 2 **SAFE_TO_VALIDATE_DURING_H1B**: stored digests (Gate 1) and the pooler login (Gate 3).
- 2 **POST_CUTOVER**: global learning tables, and inbound subject matching.

Nine gates are defined, each hosted mutation separately approved, with local work item H1B-0 first. **Gate 1 (read-only preflight) may begin; Gate 5 may not until H1B-0 is done.**

**Earlier the same day — H1A COMPLETE (local). H1B is design only, and H1 is NOT complete until H1B passes hosted certification.** Record: `H1-PRE-PILOT-HARDENING.md`, decisions D-043…D-046.

**Slices.** Slice 1, Slice 2A and **Slice 2B are DEMO CERTIFIED / FROZEN**; Slice 2B passed hosted human review. One account may contain multiple independent pursuits: Today composes one card per PURSUIT, not per account.

**Audit.** 293 application data paths were inventoried. 153 of them were RLS_ONLY or UNSCOPED and reachable, including cross-tenant writes and sends:
- the campaign send chain;
- Pipeline deal writes;
- pursuit route override;
- motion approval;
- evidence-share and broker injection;
- engagement deletes.

152 are fixed with explicit org predicates, and 1 is reclassified as system-by-design. 0 remain.

**Verification:**
- **Broad adversarial verifier `tenant-isolation`: 205/0.** It plants a foreign tenant across 33 record kinds, crawls 38 rooms and API responses of the real build, calls 27 write paths with foreign ids, and runs a negative control in which every room moves.
- **Harness.** 8 SEEDED suites were measured changing the canonical world. They now run on disposable seeded clones, every FRESH/EITHER suite is guarded, and 0 suites are UNSAFE. The whole-world fingerprint gate, run twice: PASS (`e98b43254f98d5ec` at start, after run 1 and after run 2; 74/76 suite runs clean, the 2 exceptions being the pre-existing `motion-intel` fixture gap).
- **Local app_rw rehearsal.** 36/36 rooms are identical under RLS binding and under the owner.
- **Baselines unchanged.** Manifest `be0da833990ce436`; canonical fingerprint `e98b43254f98d5ec`.

No hosted database, Vercel setting, Supabase role or grant, flag, deployment or Production change was made.

**Earlier the same day — SLICE 2B HOSTED REVIEW: the final Today defect was fixed locally** (it was subsequently accepted: DEMO CERTIFIED / FROZEN).

The hosted review passed the Queue and the Pursuit Detail labelling, but failed Today: State D showed two Globex cards.

**Root cause, confirmed with a guarded read-only query of `mejokqxriwyawfhawuxu`.** They are two canonical pursuits:
- the hero MODERNIZATION pursuit, whose route is decided (WWT);
- a separate EXPANSION pursuit, "AI platform expansion", with its own pending CDW route approval.

Grouping already held one card per pursuit, but the two cards named only the account.

**Fix (D-042):**
- Grouping stays by pursuit identity, never by account.
- Where one account has several pursuit cards, each names its pursuit.
- Every reason for one pursuit competes under the existing ranking and folds beneath the winner with its own CTA ("Approve route via CDW → Approve").
- "Decisions to make" again counts underlying reasons (its certified meaning); View all counts cards.

Proven:
- `vnext-attention` 64/0 (+7, on the real world in State D);
- `today-tenant` 51/0;
- `npm test` 362/0; `tsc` 0; build 0;
- Slice 1 62/0; Slice 2A 116/0; team 11/0;
- manifest `be0da833990ce436`.

Against the accepted build (`c0eea5a`), Queue, Pursuit Detail, the drawers and all flag-OFF Today pages are unchanged. With attention on, only Today differs.

Also fixed from the render review: composed cards on mobile clipped long lines past the card edge. The stacked layout used `items-start`; it now uses `items-stretch`, and 0 elements cross a card edge at 390 or 1440.

**Earlier the same day — TENANT HARDENING PASSED: the Slice 2B security gate is closed.**

**The leak.** A pre-existing Today / Queue tenant leak was found during Slice 2B. With the flag OFF, the guest org's certified Today listed 17–18 of Vertex's items and Vertex's whole $8,040,000 open pipeline.

**Root cause.** Several Today and Queue queries named no org and relied on RLS, and RLS is inert while the app connects as the owner (task #67).

**The fix.** Every Today, Queue and drawer query now names the caller's org explicitly in SQL, before any ranking, count or `LIMIT`. The Queue's two resolve actions are also scoped to the caller's org (D-041).

**Proven:**
- `today-tenant` verifier 51/0: zero foreign items for every org, flag OFF and ON, and planted foreign rows change nothing for Vertex;
- negative control: the pre-fix code gives the guest 17 foreign items;
- source guard 4/0;
- `tsc` 0; `npm test` 355/0; build 0;
- Slice 1 62/0; 2A 116/0; 2B 57/0; value-case 126/0; team 11/0; spot checks green;
- manifest `be0da833990ce436`.

For the owning org, the pages are byte-identical to the pre-fix build in five configurations, apart from one declared change in tie order. Security correctness supersedes byte-identical flag-OFF output.

Task #67 (the `app_rw` / RLS cutover) remains the future defence in depth. No role, grant, hosted database, Vercel setting, flag or deployment was touched.

**Slice 1 and Slice 2A are both DEMO CERTIFIED / FROZEN.** Slice 2A passed human product acceptance on the isolated hosted Preview; the twelve steps are recorded in `ACCEPTANCE.md`.

**Slice 2B (Pursuit Attention + Today / Queue coordination) is PREVIEW READY on the local synthetic path only.** It is behind `VNEXT_PURSUIT_ATTENTION_ENABLED`, default OFF, which requires Slice 2A coordination. It is NOT DEMO CERTIFIED: that needs a hosted human review, and no hosted work was done in this pass.

Verified locally:
- `tsc` 0;
- `npm test` 351 / 0 (+25);
- `vnext-attention` 57 / 0 (new);
- `vnext-coordination` 116 / 0;
- Slice 1 62 / 0;
- `demo-team` 11 / 0;
- manifest `be0da833990ce436` unchanged;
- build 0;
- flag-OFF Today, Queue and Pursuit Detail identical to the pre-slice build.

No migration. No hosted database, Vercel setting, flag, deployment or Production system was touched.

**2026-09-14 (later) — the hosted seeding defect is FIXED and the isolated world REPAIRED; Slice 2A hosted verification now has ZERO failures.** Root cause: the in-place reseed cleared `pursuit_team_requirements` and never replays migration 0075, which is the only thing that ever inserted its five global roles, so no pursuit got a team. Fix `6ab3599`: the canonical seed re-establishes those five from one definition (`src/lib/routing/team-requirements.ts`) on both provisioning paths. Locally, a fresh build, an in-place reseed and a repeated in-place reseed are identical (154 tables; team digest `b63845ca021fe143`). `mejokqxriwyawfhawuxu` was reseeded in place (all 11 layers, plan story re-recorded) and now matches that build table for table, apart from the carried operator membership and the migration tracker. Hosted: coordination **112 pass / 0 fail / 4 not run** — the 4 are the as-`app_rw` checks, **environmentally not run** (hosted `app_rw` is NOLOGIN; `postgres` holds it without SET), with their grant/RLS equivalents passing. Slice 1 62/0 · team 11/0 · manifest `be0da833990ce436` unchanged · 0 messages/outbox/email rows. **Slice 2A stays PREVIEW READY, not DEMO CERTIFIED.** The paragraph below is the prior state.

**2026-09-14T16:49Z — Slice 2A schema and the Globex plan layer are INSTALLED on the isolated hosted database `mejokqxriwyawfhawuxu`; hosted verification is PARTIAL.** Migration 0103 applied (1 applied, 102 already tracked); `demo-plan-story.ts` recorded the Globex recommendation (goal route-independent, WWT only in the plan, no decision). Canonical world unchanged: 3 · 14 · 19 · 11 open · $8,040,000 · 14, digest `be0da833990ce436`. Slice 1 verifier 62/0 on hosted. **Coordination verifier NOT green on hosted:** the unmodified harness ran 60 ✓ / 1 ✗ then crashed in section 6; a scratchpad copy skipping only the unrunnable parts gave 103 pass / 2 fail / 11 not run. Both failures are one **pre-existing hosted-world defect — no pursuit team** (the in-place seed truncates `pursuit_team_requirements` and never replays the migration that fills it), so the Globex owner reads "No account executive on the pursuit team yet" instead of the canonical "role proposed, no one confirmed yet". Tenant isolation, disclosure and no-send checks pass; 0 messages / outbox rows. **Slice 2A stays PREVIEW READY (local) — not DEMO CERTIFIED.** No Vercel, flag, deployment or Production change. The earlier sentence below that the isolated database "does not have migration 0103 or the plan layer" is superseded by this paragraph. See `SESSION-HANDOFF.md` § "Slice 2A hosted promotion".

**2026-09-14 — Vertical Slice 1 is DEMO CERTIFIED / FROZEN. Vertical Slice 2A (Pursuit Coordination — Goal → Plan → Motion → Action) is PREVIEW READY on the local synthetic path**, behind `VNEXT_PURSUIT_COORDINATION_ENABLED` (default OFF). Verified locally: `tsc` 0 · `npm test` 313/0 · build 0 · `vnext-coordination` 86/0 · `vnext-context` 62/0 · manifest digest `be0da833990ce436` unchanged · flag-OFF page byte-identical to the pre-slice build · "What matters now" byte-identical with the slice ON. **Not yet visible on the hosted Preview**: the isolated vNext database does not have migration 0103 or the plan layer, and the Preview scope does not arm the flag — both are owner-approved steps (`SESSION-HANDOFF.md` → exact next step). No hosted database, Vercel setting or deployment was touched.

**Lane:** `roadmap/pursuitos-vnext` @ `5ee1dfe` + docs — Slice 1 **PRODUCT SIGNED OFF / PREVIEW READY**, untouched. **2026-09-14T02:59Z: the isolated vNext database `mejokqxriwyawfhawuxu` is INITIALIZED** — 102 migrations, marked `demo` / `is_synthetic=true`, canonical world seeded and reconciled exactly (3 · 14 · 19 · 11 open · $8,040,000 · 14; manifest digest `be0da833990ce436` = certified). It is ready to be wired to the Vercel Preview scope; **nothing on Vercel has been touched.** History: before the owner's credential reset, the initialization had stopped at the target safety gate **twice, by design, for two different reasons**. First from Claude Code Web (no Postgres egress). Then from a laptop, which **resolved the egress blocker** — the project answers on all three endpoints — only to hit a **rejected credential**: `28P01 password authentication failed`, identically from the session pooler, the transaction pooler and the direct host. The target ref is confirmed `mejokqxriwyawfhawuxu` and confirmed **not** the Monday demo. **Nothing has been written to any database.** See `ENVIRONMENT-MAP.md` §10.

States: `NOT STARTED` · `BUILDING` · `PREVIEW READY` · `DEMO CERTIFIED` · `BLOCKED`

---

## Foundation

| Item | Status | Branch / commit | Updated | What remains | Known risks |
|---|---|---|---|---|---|
| vNext branch | **DEMO CERTIFIED** (n/a — infrastructure) | `roadmap/pursuitos-vnext` from `97e975f0` | 2026-09-12 | — | — |
| Known-good demo reference | **DEMO CERTIFIED** | `backup/2026-09-04/tds-live-demo` → `97e975f0` (on origin) | 2026-09-12 | — | Local tag `demo-safe-2026-09-12` was created at the same commit but its **push was refused (HTTP 403)** — this remote rejects tag pushes. The already-pushed `backup/…/tds-live-demo` tag plus the SHA recorded throughout these docs are the durable references. |
| Durable agent memory | **DEMO CERTIFIED** | `docs/vnext/*` | 2026-09-12 | Keep `SESSION-HANDOFF.md` current every session | Goes stale silently if a session forgets to update it |
| Feature-flag scaffolding | **PREVIEW READY** | `src/lib/env/vnext-flags.ts`, `tests/vnext-flags.test.ts` | 2026-09-12 | Nothing — no capability behind any flag yet | None. Default OFF, narrowing-only, 4/4 tests green |
| Preview environment | **BLOCKED** — needs a credential, not a decision | — | 2026-09-12 | One read-only Vercel API call, or one signed-in visit to `/api/build`. Isolation design is **complete and waiting**: `PREVIEW-ISOLATION-PLAN.md` Option 2 | Classification still **UNKNOWN**. Newly proven: **no application-layer mitigation exists** if Preview does share the DB — `VERCEL_ENV` gates nothing, `assertSyntheticDatabase` passes for anything marked synthetic (the demo DB is), 22 files carry server actions. Bounded by: a build performs no DB access. `ENVIRONMENT-MAP.md` §6 B-a…B-e |
| Live serving SHA | **BLOCKED** — every unauthenticated avenue exhausted | — | 2026-09-12 | `/api/build` with `OPS_FINGERPRINT_TOKEN`, **or** an owner signed in visiting `/api/build`, **or** the Vercel API | Branch head is Wave 6D `97e975f0`; last observed serving SHA was Wave 3 `66f72f61`. Seven avenues attempted and closed — recorded in `ENVIRONMENT-MAP.md` §9 so no session repeats the search. Cannot certify a promotion against an unknown baseline |
| **vNext isolated database** | **PREVIEW READY** (database only) — initialized, marked, seeded, reconciled; Slice 2A schema + Globex plan installed; **team layer repaired and reseeded 2026-09-14T21:08Z** | target ref `mejokqxriwyawfhawuxu` | 2026-09-14T21:08Z | Nothing in the database. Next is the Vercel wiring (row below) | 103/103 migrations. Reseeded in place with fix `6ab3599`: 5 canonical team requirements, 45 members, Globex ledger 10, plan owner `ROLE_UNFILLED`; matches a fresh local build table for table. Coordination 112 pass / 0 fail / 4 as-`app_rw` checks environmentally not run (hosted `app_rw` NOLOGIN; `postgres` membership has no SET); grant/RLS equivalents pass. Slice 1 62/0, demo-team 11/0, manifest unchanged, 0 messages | Migrated **102/102** from empty. `environment_identity` = `demo` / `is_synthetic=true` / "pursuitos-vnext — isolated synthetic preview". Seed 10/10 layers, `verify()` 17/17. Reconciled **exactly**: 3 orgs · 14 companies · 19 opportunities · 11 open · $8,040,000 · 14 pursuits; manifest digest `be0da833990ce436` = certified. 0 messages. Identity **proven distinct** from `qifatlqxfuhwrwvpbwsc`. Still unverified: whether it is a Supabase branch or a standalone project. One transient `28P01` on the first probe, then consistent success — `ENVIRONMENT-MAP.md` §10 |
| vNext isolated preview | **NOT STARTED** — no longer blocked upstream; waits on one owner-approved Vercel action | — | 2026-09-14T02:59Z | `PREVIEW-ISOLATION-PLAN.md` Objective C Option 2 step 5: a Preview-scoped `DATABASE_URL` for branch `roadmap/pursuitos-vnext` pointing at the isolated target, plus the Objective D Preview flags; then V-1…V-10 | Nothing built. No Vercel scope has been touched in any session. Owning an isolated database does not by itself isolate Preview — the Preview scope's current `DATABASE_URL` is still UNKNOWN (§6) |

---

## Roadmap capabilities

| Capability | Phase | Status | Branch / commit | Updated | What remains | Known risks |
|---|---|---|---|---|---|---|
| Canonical commercial foundation | P0 | **DEMO CERTIFIED** (pre-existing) | `97e975f0` | 2026-09-03 | — | Substantially already built: orgs, companies, products, sellers, partners, opportunities, motions, campaigns, entity resolution, aliases, provenance |
| Living Pursuit Context — **Vertical Slice 1** | P1 | **DEMO CERTIFIED / FROZEN** (owner, 2026-09-14) | `roadmap/pursuitos-vnext` @ `c4f4196` | 2026-09-14 | Nothing. "What matters now" is frozen absent real pilot feedback — do not redesign, rename or restructure it | Slice 2A re-proved it byte-identical (12,761 bytes, 1,092×792 desktop / 326×1,251 mobile) with the coordination flag ON |
| **Pursuit Coordination — Vertical Slice 2A** | P3 | **DEMO CERTIFIED / FROZEN** (owner, human product acceptance on the isolated hosted Preview, 2026-09-14) | `roadmap/pursuitos-vnext` @ `6ab3599` | 2026-09-14 | Nothing. Do not materially redesign it absent pilot feedback | Goal → Plan → Motion → Action on Pursuit Detail. Migration 0103. The twelve accepted steps are in `ACCEPTANCE.md`. Its UX note (preserved plan content read as current) is addressed by Slice 2B labelling |
| **Today / Queue tenant scoping (hardening)** | P6 / #67 | **DONE (local)** — the Slice 2B security gate; subsumed by H1A | `c0eea5a` | 2026-09-14 | — | D-041. `today-tenant` verifier + source guard |
| **Pursuit Attention + Today / Queue — Vertical Slice 2B** | P3 | **DEMO CERTIFIED / FROZEN** (hosted human review on the isolated Preview, 2026-09-14) | `roadmap/pursuitos-vnext` @ `54ab990` | 2026-09-14 | Nothing. Do not materially redesign it absent pilot feedback | One card per PURSUIT, not per account (Globex modernization → Plan needs review; Globex expansion → its own CDW route decision). Plan review outranks the stale action; the Queue preserves the action once with plan-review context; "Current approved plan / Focus when approved". D-034…D-042, D-046 |
| **H1A — Tenant isolation + certification integrity** | P6 / #67 | **COMPLETE (local)** | `roadmap/pursuitos-vnext` (H1A commit) | 2026-09-14 | Nothing in H1A. H1 completes with H1B | 293 paths audited; 152 fixed + 1 reclassified; `tenant-isolation` 205/0; 0 UNSAFE verifiers; fingerprint gate PASS (`e98b43254f98d5ec` at start, after run 1 and after run 2; 74/76 suite runs clean, the 2 exceptions being the pre-existing `motion-intel` fixture gap); app_rw rehearsal 36/36. D-043, D-044. Reported, not fixed: global learning tables, inbound subject matching, stored digests (`H1-PRE-PILOT-HARDENING.md` § C) |
| **H1B — Least-privilege runtime / RLS cutover** | P6 / #67 | **IN PROGRESS** — Gate 1 PASS (re-baselined) · H1B-0 COMPLETE · Gate 1b PASS · **Gate 2 BLOCKED / NOT EXECUTED** · **H1B-0.1 COMPLETE (local)** · **Gate 1b.1 PASS** (0105 hosted; 31/31 hardened, 0 unsafe) · **Gate 2 PASS** (`app_rw` LOGIN false → true; nothing else changed) · **Gate 3 PASS** (pooler login proven; RLS exact on 155 tables for no context and 3 orgs; no context leak; foreign writes refused; zero residue) · **Gate 4 PASS AFTER DOCUMENTED RE-BASELINE** (branch Preview `DATABASE_URL_OWNER` added; runtime still `postgres`; crawl 37/37 equivalent; one-time render materialization proven stable; CFR-1 adopted) · **Gate 5 PASS** (branch Preview runtime `app_rw`, bypassRls false, tenantEnforcement true; owner paths through `DATABASE_URL_OWNER`; crawl healthy; D-G5-1 ordering defect recorded) · **Gate 6 PASS** (live posture `app_rw` / bypassRls false / tenantEnforcement true / probe live) · **D-G5-1 HOSTED ACCEPTED / CLOSED** (`1c4fb5e` on the `app_rw` Preview; two full crawls identical in order; DB 0/155 changed) · **Gate 7 PASS** (exact-RLS probe as `app_rw` 80/0; crawl identical; hosted handshakes 117/0 rolled back; owner human review PASS) · **Gate 8 PASS** (rollback to the owner and restoration to `app_rw` both proven; the Preview is back on `app_rw`) · **D-G8-1 HOSTED ACCEPTED / CLOSED** (`dcde3b6` on the `app_rw` Preview) | `roadmap/pursuitos-vnext` | 2026-09-15 | Owner decision on the D-G8-2 backlog → fix D-P1 → Gate 9 | D-045, D-048, D-049, D-050. Hosted baseline: migrations 105 · manifest `db1f78f7a11bbacb` · business-data fingerprint `79321d9130d1dc94` · whole-world fingerprint `de05e204801988d1` · `app_rw` LOGIN true (not yet used) |
| · pursuit context narrative (rendered) | P1 | **PREVIEW READY** | `6c5b7a9` `components/pursuit/context-narrative.tsx` | 2026-09-12 | Product sign-off on the refined surface, then GATE D/E | Titled **"What matters now"**, full-width on desktop. GATE C **N-1 fixed** (all 10 ledger rows reachable, override chronology included), **N-2/N-4/N-6 fixed**. Flag OFF verified identical panel-for-panel. Residual: R-1 "What changed" right half empty (cosmetic), R-2 283px void beside Value case. See `GATE-C-PRODUCT-REVIEW.md` § GATE C REFINEMENT |
| · pursuit evidence (direct + supporting) | P1 | **PREVIEW READY** | `620bc12` `read-models/pursuit-evidence.ts` | 2026-09-12 | Consumed by "What matters now" since `99bd5dd` | 18 tests. **Supersedes the plan to swap `getFacts` to pursuit scope** — Globex has 1 linked fact, so the swap would have deleted the best evidence on the screen. See D-020 |
| · fact freshness | P1 | **DEMO CERTIFIED** (pre-existing) | `src/lib/facts/freshness.ts` | — | Compose at pursuit level | Exists per-fact; nothing composes per-pursuit |
| · research coverage | P1 | **DEMO CERTIFIED** (pre-existing) | `src/lib/intel/completeness.ts` | — | Compose at pursuit level | Account-scoped today |
| · context health (pursuit level) | P1 | **PREVIEW READY** | `d1e5685` `read-models/context-health.ts` | 2026-09-12 | Consumed as the one confidence word since `99bd5dd` | Pure function, 13 tests. Composes `factFreshness` + `computeCompleteness`; re-implements neither |
| · pursuit state | P1 | **DEMO CERTIFIED** (pre-existing) | `src/lib/pursuits/lifecycle.ts`, `src/lib/lifecycle/state.ts` | — | Surface as "current state" narrative | — |
| · pursuit memory | P1 | **PREVIEW READY** | `b6b7b33` `read-models/memory.ts` | 2026-09-12 | Consumed by "What changed"; all entries reachable since `1ed0105` | Pure function, 21 tests. Business-time ordering, no materiality filter, ledger never mutated |
| · what's missing (ranked) | P1 | **PREVIEW READY** | `ac572ba` `read-models/missing-context.ts` | 2026-09-12 | Consumed by "Needs attention"; secondaries expandable since `6c5b7a9` | Pure function, 15 tests. Composes the 4 existing gap computations; adds no fifth |
| · pertinence (pursuit + decision scoped) | P2 | **PREVIEW READY** | `1b05b8a` `read-models/pertinence.ts` | 2026-09-12 | Consumed via `pursuit-evidence` ranking since `620bc12` | 18 + 13 tests. Pursuit-scoped, not portfolio-scoped (D-017). Consumes upstream gap rank/source (D-019) |
| · why this pursuit (portfolio-relative) | P2 | **NOT STARTED** | — | 2026-09-12 | Deferred to Slice 3 — needs cross-pursuit inputs | D-017: a different computation from pertinence |
| Pursuit Intelligence | P2 | **NOT STARTED** | — | 2026-09-12 | Slice 3 | Depends on Slice 1 |
| Next Move / coordination | P3 | **SUPERSEDED** by Slice 2A | — | 2026-09-14 | — | The P3 amendment replaced isolated next-best-action with Goal → Plan → Motion → Action (D-025). `VNEXT_NEXT_BEST_ACTION_ENABLED` stays reserved and unimplemented |
| · pursuit goal | P3 | **PREVIEW READY** | `pursuit_goals` (0103) | 2026-09-14 | A UI for goal replacement (the governed `replace_pursuit_goal` path exists and is verified) | The commercial outcome only — route-, motion- and action-independent; append-only replacement via `supersedes_goal_id` (D-033). Not the org-level `goals` table (D-026) |
| · pursuit plan + revisions | P3 | **PREVIEW READY** | `pursuit_plans`, `pursuit_plan_revisions` (0103), `read-models/pursuit-plan.ts`, `coordination/plan-store.ts` | 2026-09-14 | Worker-driven review recording; plan closure | Append-only by grant, proven as `app_rw` (42501) |
| · course correction | P3 | **PREVIEW READY** | `assessPlanReview` + `PLAN_REVIEW_REQUIRED` | 2026-09-14 | Automatic recording on material events (today: detected on read, recorded on request) | Fingerprint comparison, never a rewrite (D-028) |
| AI Control Plane | P4 | **NOT STARTED** | — | 2026-09-12 | Slice 4, thin backend only | D-011: no new room |
| Pursuit Runtime | P5 | **BUILDING** (partial, pre-existing) | `governed_action_invocations`, `GOVERNED_ACTION_ENABLED` | — | Run ledger, cost tracking | Governed actions + append-only ledgers already exist |
| Intercompany Governance | P6 | **DEMO CERTIFIED** (pre-existing) | disclosure ladder, grants, contributions | 2026-09-03 | — | Server-side withholding is load-bearing for the demo; do not touch |
| Pursuit Analysis / Dynamic Surfaces | P7 | **BUILDING** (partial, pre-existing) | `src/lib/search/registry.ts`, `src/lib/interpret/catalog.ts` | — | ANALYZE verb, cohort engine, dynamic surfaces | D-010: cannot invent permissions/metrics/writes |
| Learning System | P8 | **BUILDING** (partial, pre-existing) | outcome bridge, experiments, attribution | — | Prediction snapshots, evaluation | Slice 5; depends on 2 and 4 |
| Ecosystem Intelligence | P9 | **NOT STARTED** | — | 2026-09-12 | — | — |
| Attribution & Settlement | P10 | **BUILDING** (partial, pre-existing) | settlement ledger, contribution tracking | — | Reconciliation, incentives | Symmetric settlement ledger already ships |

---

## Validation

| Check | Session 0 | 1–4 | 5A | 5B-1 | 5B-2 | 6A+6B |
|---|---|---|---|---|---|---|
| `npx tsc --noEmit` | exit 0 | exit 0 | exit 0 | exit 0 | exit 0 | **exit 0** |
| `npm test` | 149 / 0 | 220 / 0 | 220 / 0 | 233 / 0 | 251 / 0 | **271 pass / 0 fail** |
| `npm run build` | exit 0 | exit 0 | exit 0 | exit 0 | exit 0 | **exit 0** |
| `vnext-context` verifier | — | — | 42 / 0 | 47 / 0 | 55 / 0 | **55 passed / 0 failed** |
| SEEDED spot-check | — | — | green | green | green | **interpret 255 · lifecycle-query 80 · value-case 126 · stakeholder-intel 43** |

### GATE C refinement validation (`1ed0105`, `6c5b7a9`)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm test` | **290 pass / 0 fail** (from 271; +19 tests) |
| `npm run build` | exit 0 |
| `vnext-context` verifier | **62 passed / 0 failed** (from 55; new section 6) |
| Flag-OFF desktop / mobile height | 3,827px / 7,870px — **unchanged**, panel geometry identical panel-for-panel |
| Flag-ON desktop / mobile height | 3,861px / 7,221px |
| Composed surface | 538×1,068 → **1,092×792** |
| Desktop void | 785px → **283px** (beside the surface: 593px → **0**) |
| History reachable, flag ON | 3 of 10 → **10 of 10** |
| Horizontal overflow @1440 / @390 | none / none |

### Vertical Slice 2A validation (2026-09-14, local synthetic, Globex)

Local Postgres 17.11 + pgvector 0.8.6 (Homebrew) on `127.0.0.1:5433`, canonical world rebuilt from scratch with the new 11th layer. No hosted database contacted.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm test` | **313 pass / 0 fail** (from 290; +23: 22 plan tests + 1 flag test) |
| `npm run build` | exit 0 |
| `vnext-coordination` verifier (new, SEEDED) | **86 passed / 0 failed** — all writes rolled back, world unchanged afterwards |
| `vnext-context` verifier (Slice 1) | **62 passed / 0 failed** — Globex ledger still 10 rows |
| Manifest digest | `be0da833990ce436` — **unchanged** (= certified) |
| SEEDED spot-check | append-only 11/0 · stakeholder-intel 43/0 · value-case 126/0 |
| Flag-OFF, pre-slice build (`a04f0c8`) vs this build | same raw size (234,511 bytes); **full body byte-identical** after normalizing only per-build asset names, build id, per-request CSP nonce, server-action id hashes and the request-time timestamp existing team gap actions stamp; panel geometry identical panel-for-panel (3,827px desktop / 7,916px mobile, 11 panels) |
| "What matters now", Slice-1-only vs 2A ON | outerHTML **byte-identical** at 1440 and 390 |
| Flag-ON | "Pursuit plan" at 1,092×547 directly beneath "What matters now"; 10 panels; no horizontal overflow @1440 / @390 |
| Screenshots | `docs/vnext/review/slice-2a/` |

**Defects found and fixed before commit** (all caught by the new harness or the render review, none shipped): 0103 first draft left `app_rw` full DML on the new tables because of 0058's default privileges (D-031); the two plan skills appeared in the Federation panel's registry list and the seed's invocation became its "Last action" — both visible flag-OFF — fixed by keeping them in `COORDINATION_SKILLS` and seeding through the store; a `plan && …` child that left a `null` in the flag-OFF flight payload (5 bytes, no markup) — fixed with a ternary; a raw ISO date and a two-column grid that did not form.

### Slice 2A Goal ↔ Plan boundary refinement (2026-09-14, D-033)

The goal is now the durable commercial outcome only. Globex: "Exit legacy virtualization before renewal and close the $920K opportunity" — previously "…with WWT". The route, motion, action and owner live in plan revisions. 0103 was amended in place (never applied to any hosted/shared database): an append-only `supersedes_goal_id` + `supersession_reason` on the new goal row replaces the mutable forward pointer, plus `GOAL_REPLACED` and the governed USER-only `replace_pursuit_goal` skill (no UI). The local world was rebuilt from scratch.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm test` | **316 pass / 0 fail** (+3: route WWT↔CDW, motion/action, 0103 supersession schema; Globex goal test rewritten) |
| `vnext-coordination` verifier | **116 passed / 0 failed** (from 86): WWT → CDW → WWT keeps the same goal row and changes only plan history; motion change and action adjustment keep the goal; replacement keeps the old goal byte-identical and SUPERSEDED, forks refused (23505), non-human/unexplained supersession refused (23514), `app_rw` cannot rewrite objective or pointer (42501), another org cannot replace |
| `vnext-context` verifier (Slice 1) | 62 passed / 0 failed — Globex ledger still 10 rows |
| Manifest digest | `be0da833990ce436` — unchanged |
| SEEDED spot-check | append-only 11/0 · stakeholder-intel 43/0 · value-case 126/0 |
| `npm run build` | exit 0 |
| Flag-OFF, pre-slice build vs refined build | same raw size (234,511 bytes); full body byte-identical under the same normalization as before; zero plan markers |
| "What matters now", Slice-1-only vs refined 2A ON | outerHTML byte-identical at 1440 and 390 (1,092×792 / 326×1,251) |
| Flag-ON goal area | shows "Exit legacy virtualization before renewal and close the $920K opportunity"; "opportunity with WWT" absent; "via WWT" present only in the plan's Next move; plan panel geometry unchanged (1,092×547) |

**Found while testing the boundary, fixed:** when a person approves the *recommended* route, the route read-model deliberately reports `selected = null`. The plan loader took that as "no route", which left the plan unable to name an approved recommendation. It now resolves the choice from `selectedKey`. Globex (an override) was unaffected.

### Today / Queue tenant hardening validation (2026-09-14, local synthetic)

| Check | Result |
|---|---|
| Negative control: pre-fix code (`8261ef3`), guest org Meridian, flag OFF | **17 of 17** Today items are Vertex's. The open pipeline shows **$8,040,000 over 11 opportunities**, and the guest owns 0. (18 items earlier in the session; one aged out of the 14-day change window) |
| `today-tenant` verifier (new, SEEDED) | **51 passed / 0 failed**. All three orgs: every read inside `READ ONLY`, zero foreign Today items flag OFF and ON, own-only pipeline, counts, queue, lineage and drawer. It plants 10 guest-org clones of real Vertex rows, and **Vertex's full Today + Queue projection stays identical**: cards, ranks, urgency, other items, badge, counts, pipeline, activity, leaderboard, drawer, queue, lineage, attention. The guest's own rows render. A guest cannot resolve a Vertex queue item. 0 send rows; world unchanged |
| `tests/today-tenant-scope.test.ts` | **4 / 0**. Every Today and Queue query carries an org predicate or a declared org-owned parent. The pages run no SQL. The org comes from `withTenant`. The filters sit before `LIMIT` |
| `tsc` / `npm test` / build | exit 0 / **355 / 0** (+4) / exit 0 |
| Slice 1 · Slice 2A · Slice 2B | 62 / 0 · 116 / 0 · 57 / 0 |
| value-case (drawer consumer) · demo-team · append-only · stakeholder-intel · team-motion | 126 / 0 · 11 / 0 · 11 / 0 · 43 / 0 · 22 / 0 |
| Manifest | `be0da833990ce436`, unchanged |
| Owning-org render, pre-fix build vs fix, same env and DB, five configurations × 7 pages (Today, view-all, Today drawer, Queue, Pursuit Detail, Pipeline drawer, Accounts drawer) | Byte-identical, or markup-identical for the Queue, whose payload order varies per request. One declared exception: flag-OFF `/?today=all`, proven **reorder-only**. Equal-materiality economic-buyer cards now follow a declared, deterministic tie order; the cards are the same byte for byte and the page length is identical (D-041). Checked on a freshly rebuilt world, with ids resolved per database |

### Vertical Slice 2B validation (2026-09-14, local synthetic, Globex)

This is a disposable local Postgres 17 on `127.0.0.1:5433`, rebuilt from scratch. States B, C and D were rendered from template copies of that world (`pursuit_state_b/c/d`), each advanced through the real governed skills. On those copies only, the approved action's due date was moved into this week so that State B shows "due". No hosted database was contacted.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm test` | **351 pass / 0 fail** (from 326; +24 attention tests, +1 flag test) |
| `vnext-attention` verifier (new, SEEDED) | **57 passed / 0 failed**. Every Today and Queue read ran inside `READ ONLY` transactions; all writes were rolled back; the world was unchanged afterwards |
| `vnext-coordination` (Slice 2A) | **116 passed / 0 failed** |
| `vnext-context` (Slice 1) | **62 passed / 0 failed** |
| `demo-team` | 11 / 0 · team digest `b63845ca021fe143` |
| SEEDED spot-check | append-only 11/0 · stakeholder-intel 43/0 · value-case 126/0 · team-motion 22/0 |
| Manifest digest | `be0da833990ce436`, unchanged |
| `npm run build` | exit 0 |
| Flag-OFF vs pre-slice build (`b677acf`), same env, same DB | **Today (`/` and `/?today=all`) and Pursuit Detail are byte-identical** after normalizing only build assets, build id, nonce, action-id hashes, action-ref numbers and request stamps. This holds in three configurations: Slice 1 + 2A ON on the seeded world; Slice 1 + 2A ON on State C (plan needs review); and no vNext flags. **Queue:** the rendered markup (scripts removed) is identical in all three. Its raw Flight payload is not comparable, because the baseline differs from itself between two requests (React streams server-action chunks in per-request order) |
| Today, attention ON | 11 pursuit cards instead of 34–36 item cards. Globex is card 6 in A, card 11 in B, and **card 1 in C and D**. No horizontal overflow at 1440 or 390 |
| Screenshots | `docs/vnext/review/slice-2b/` |

**Defects found and fixed before commit.** Both were caught by the render comparison, and neither shipped:
- An `attention && …` child in the Today card, and an `approvedPlanFrame && …` slot in the plan surface, each serialized a `"$undefined"` into the flag-OFF Flight payload. Both were restructured so the flag-OFF branch is the original JSX verbatim.
- Trailing-period stripping turned "Globex Manufacturing Inc." into "Inc".

**Found, pre-existing, not fixed:**
- The certified Today card collapses to a sliver at 390px ("S…", "A…", with the CTA overlapping). Composed cards stack under the flag instead; flag-OFF is untouched.
- Several `getTodayQueue` reads have no `org_id` predicate, so the guest org's certified Today shows 18 of Vertex's items while RLS is inert (task #67). The composed Today drops them (D-038).
- Some existing Today item ids embed `Date.now()`, so they are unstable across reads.

### Hosted team-layer repair (2026-09-14T21:08Z, fix `6ab3599`)

| Check | Result |
|---|---|
| Root cause reproduced locally | pre-fix `demo-db.ts` in place → 0 requirements / 0 members / 0 `TEAM_CHANGED` (= the hosted state) |
| `tsc --noEmit` / `npm test` | exit 0 / **326 pass, 0 fail** (+10 in `tests/team-requirements.test.ts`) |
| Local fresh · in-place #1 · in-place #2 | each: demo-team 11/0 (digest `b63845ca021fe143`), coordination **116/0**, Slice 1 62/0, manifest `be0da833990ce436`, append-only 11/0, stakeholder-intel 43/0, value-case 126/0, team-motion 22/0; whole-world snapshots identical across all three |
| Hosted gate (before the write, and at the end) | `mejokqxriwyawfhawuxu` · `demo` · `is_synthetic true`; not `qifatlqxfuhwrwvpbwsc` |
| Hosted in-place reseed | 11/11 layers ok; `verify()` all ok, including canonical team requirements (5) and the Globex hero team (5 roles) |
| Hosted `demo-team` | **11 passed / 0 failed**; digest = local |
| Hosted `vnext-coordination` | repo harness: 96 ✓ / 0 ✗, then it aborts at the first `set local role app_rw`. Copy with only those scenarios skipped: **112 pass / 0 fail / 4 not run** |
| 4 not run | as-`app_rw` checks only — **environmentally not run** (`app_rw` NOLOGIN; `postgres` holds it with ADMIN, no SET, no INHERIT). Grant/RLS equivalents pass |
| Hosted `vnext-context` (Slice 1) | **62 passed / 0 failed** |
| Hosted manifest | `be0da833990ce436` before and after |
| Send | 0 `messages` / `action_outbox` / `email_events` / `sending_identities` |

### Slice 2A hosted installation (2026-09-14T16:49Z, isolated `mejokqxriwyawfhawuxu`)

Schema and data readiness only — no Vercel, flag or deployment. Slice 2A is **not** DEMO CERTIFIED.

| Check | Result |
|---|---|
| Target gate (before any write, and at the end) | `mejokqxriwyawfhawuxu` · `demo` · `is_synthetic true`; not `qifatlqxfuhwrwvpbwsc` |
| `migrate.ts` | 0103 applied — 1 applied, 102 already tracked, exit 0 (dry-run first showed exactly that one file) |
| `demo-plan-story.ts` | Globex recommendation recorded, exit 0. Goal route-free ("…close the $920K opportunity"), WWT only in the plan's motion, plan linked to goal, 0 decisions |
| `vnext-coordination` (repo harness) | **FAIL** — 60 ✓ / 1 ✗, then fatal in section 6 |
| `vnext-coordination` (scratchpad copy, only unrunnable parts skipped) | **103 pass / 2 fail / 11 not run.** Both failures are the hosted no-team defect (owner line; Globex ledger 9 ≠ 10). Not run: section 6 (7, needs a team member), as-`app_rw` (4, `postgres` cannot `SET ROLE app_rw` here) |
| `vnext-context` (Slice 1) | **62 passed / 0 failed** |
| Manifest digest | `be0da833990ce436` before and after — unchanged (= certified) |
| Canonical facts | 3 · 14 · 19 · 11 open · $8,040,000 · 14 |
| Send | `messages` / `action_outbox` / `email_events` / `sending_identities` = 0 throughout |
| `tsc --noEmit` / `npm test` (local) | exit 0 / 316 pass, 0 fail |

### Chunk 6B rendered evidence (local synthetic, Globex pursuit)

| | flag OFF | flag ON |
|---|---|---|
| Rendered `Panel` surfaces | 11 | **9** |
| "Why now" / "Facts behind this" / "What changed" panel titles | 1 / 1 / 1 | **0 / 0 / 0** |
| "This pursuit" panel | 0 | **1** |
| Anchors `#whynow` `#evidence` `#activity` | all present | **all present** |
| Page bytes | 235,042 | 217,010 |
| Horizontal overflow @1440 and @390 | none | **none** |

**Flag-OFF regression proven by render**, not assumed: the pre-6B commit and the
post-6B commit with the flag off produce byte-identical bodies (231,410 bytes);
the only differences are per-build Turbopack chunk filenames in `<head>`.

**Zero pre-existing failures at any point.** The 71 added tests are 4 flag tests
(Session 0) plus 67 read-model tests (chunks 1–4: 13 + 21 + 15 + 18). Any future
failure is attributable and must not be dismissed as pre-existing.

Not run in Session 0 (require a database; no roadmap code was written that could
affect them): the 33 verifier suites. Run them before GATE B.

---

## Open documentation debt

| Item | Note |
|---|---|
| `.env.example` incomplete | Missing `PURSUITOS_ENV`, `OPS_FINGERPRINT_TOKEN`, `DATABASE_URL_OWNER`, `BASIC_AUTH_*`, and the shipped feature-flag variables. The vNext block was added in Session 0; the rest was deliberately left to keep the diff reviewable. |
| `audit/DEMO-ITINERARY.md` ambiguity | Says the demo runs "under `app_rw` + FORCE RLS". True of the **local** demo; **not** true of hosted `demo.pursuitos.io`, which runs as `postgres`/`BYPASSRLS`. Not wrong, but reads as a stronger claim about the hosted demo than the evidence supports. Recorded in `ENVIRONMENT-MAP.md` §4. |
| **Synthetic-lineage defect (NEW, found by the chunk-5A harness)** | Two `change_ledger` rows in the canonical synthetic world carry `data_environment = 'PRODUCTION'` — `PARTNER_OVERRIDE` and `OVERRIDE_RECORDED`, on the Globex hero pursuit the demo's §2 beat turns on. Cause: `recordChange()` defaults `dataEnvironment` to `'PRODUCTION'` (`src/lib/pursuits/ledger.ts`) and the two override call sites omit it, so those entries are not labelable as synthetic. **Not fixed** — it is a seed-path change two days before the demo. Fix after Monday by passing `dataEnvironment` at `src/lib/routing/override.ts` and `src/lib/pursuits/overrides.ts`. |
| ~~Pertinence task-fit ignores gap source~~ | **RESOLVED in 5B-1** (`1b05b8a`). Gap `rank` and `source` now travel onto `PertinenceCandidate`; linkage uses the upstream rank instead of `gapKind` alone, and `TASK_FIT` matches on `GapSource`. All six task contexts now reorder, where four did before. See **D-019**. |
| ~~**In-place reseed drops the pursuit-team layer (2026-09-14T16:49Z)**~~ **FIXED `6ab3599`; `mejokqxriwyawfhawuxu` reseeded 21:08Z** — the canonical seed re-establishes the five global requirements from `src/lib/routing/team-requirements.ts` on both paths; `demo-team` verifier + `verify()` now cover the team layer. Other databases seeded in place before the fix keep the defect until reseeded (Monday demo: UNVERIFIED, not queried). Original note: | `scripts/demo-db.ts` in-place mode truncates `pursuit_team_requirements` (it carries `org_id`), but its only rows are the five global roles migration 0075 inserts, and in-place mode never replays migrations. So `assembleTeam` creates nothing: the isolated hosted world has 0 team members, 0 `TEAM_CHANGED` rows, and a Globex ledger of 9, not 10. `verify()` and the manifest do not cover team tables. **Not fixed.** Fix: preserve `org_id is null` rows of that table in the in-place truncate, then reseed the isolated DB. See `SESSION-HANDOFF.md` → exact next step. |
| **`team-motion-verify` can commit into the canonical world (NEW, 2026-09-14)** | During one local run it wrote a route selection plus partner-account-manager and account-executive invite/accept onto the Globex hero, taking the ledger from 10 to 17 rows. That moved the route from WWT to CDW and staled the seeded Slice 2A recommendation, so `vnext-attention` then correctly refused to approve it. It picks "a canonical routed pursuit" by a whatever-is-first read (see `verify-classes.ts`), so it does not always hit Globex: on a fresh rebuild it left Globex untouched. **Not fixed** (outside the tenant pass). Until it is, run it last, and rebuild the world before any certification run. |
| Task #67 outstanding → **H1B** | RLS fully built, fully inert on the app path. H1A made every audited path explicitly tenant-scoped; the runtime cutover is H1B — design in `H1-PRE-PILOT-HARDENING.md` § H1B (the previously cited `audit/TASK-67-RLS-RUNTIME-CUTOVER-PLAN.md` does not exist). |
| ~~GATE C findings N-1 … N-6~~ | **N-1, N-2, N-4 and N-6 RESOLVED** in `1ed0105` + `6c5b7a9`. N-5 is explained rather than fixed (see R-1). N-3 stands as a *review-coverage* note, not a product defect: every evidence row on the Globex pursuit is VERIFIED, so the five-state vocabulary is only observable in Needs attention — review a thinner pursuit to see it. New residuals R-1…R-3 are cosmetic and recorded in `GATE-C-PRODUCT-REVIEW.md` § GATE C REFINEMENT. |
