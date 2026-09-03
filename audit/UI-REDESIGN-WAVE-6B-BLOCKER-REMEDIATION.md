# Wave 6B — Release-Blocker Remediation

**Starting SHA:** `c7580ff31a69f7ba57729b2d40a1c10e247e6f0f` (`ui-wave-6`)
**Branch:** `ui-wave-6b`
**Final SHA:** this commit — the tip of `ui-wave-6b` (`git rev-parse ui-wave-6b`).
**Scope:** verifier/fixture repair, one governed-action application fix, and the test-environment contract. **Presentation frozen** — no room in the §1 list was redesigned. No feature added. No constraint weakened. No deployment configuration touched. Not deployed.

## FINAL STATUS

# LOCAL NO-GO

**Remaining blocker — one, precisely bounded:**

**16 assertions across 3 SEEDED suites cannot yet be adjudicated as code-vs-data, because the canonical demo world's build recipe is incomplete.** Detail and proof in §8 below. Every other class is green, and there are **zero fatal verifiers**.

Live-environment certification remains separately out of reach (§10) and is unchanged by this wave.

---

> **Reconstruction note.** The original Wave 6B commit was lost when this container was
> reclaimed before it had been pushed. This document and every code change under it were
> replayed mechanically from the persisted session transcript — 22 recorded file operations,
> all of which applied cleanly with no ambiguity. **Every verification total below was
> re-measured on the replayed tree; none was carried over.** Where a re-measured number
> differs from the original run, the difference is stated at the number rather than
> reconciled away.

## §2 The exact failure matrix — before

Produced by the new runner (`scripts/verify-run.ts --class ALL`) against the supported local environments, at `c7580ff`:

| suite | class | executed | passed | failed | fatal | exact reason |
|---|---|---|---|---|---|---|
| **pursuit** | FRESH | 0 | 0 | 0 | **YES** | `insert or update on table "pursuit_evidence" violates foreign key constraint "pursuit_evidence_ref_fk"` |
| **routes** | FRESH | 64 | 63 | 1 | no | `team assembled from required roles — created=0` |
| **experience** | FRESH | 34 | 33 | 1 | no | `restricted raw value present for internal caller` |
| **facts** | FRESH | 0 | 0 | 0 | **YES** | `signal <id> references evidence <id> that is not verified` |
| **governance** | FRESH | 0 | 0 | 0 | **YES** | `current transaction is aborted, commands ignored until end of transaction block` |
| interpret | SEEDED | 255 | 255 | 0 | no | — |
| lifecycle-query | SEEDED | 80 | 80 | 0 | no | — |
| **lifecycle-acceptance** | SEEDED | 0 | 0 | 0 | **YES** | `TypeError: Cannot read properties of undefined (reading 'id')` |
| value-case | SEEDED | 126 | 126 | 0 | no | — |
| stakeholder-intel | SEEDED | 43 | 41 | 2 | no | ⌘K economic-buyer UNKNOWN; coverage decomposition |
| partner-intel | SEEDED | 17 | 17 | 0 | no | — |
| **outcome-bridge** | SEEDED | 0 | 0 | 0 | **YES** | `TypeError: Cannot read properties of undefined (reading 'id')` |
| motion-intel | SEEDED | 19 | 17 | 2 | no | brief motion-context; EXPLAIN execution-readiness |
| closed-loop | SEEDED | 18 | 18 | 0 | no | — |
| 18 × EITHER suites | EITHER | 260 | 260 | 0 | no | — |
| migrations-only | DEPLOYMENT_ONLY | — | — | — | — | targets a separately provisioned migrations-only instance |

**Baseline: 919 passed, 6 failed, 5 fatal.**

### The three fatal verifiers Wave 6 named, by name

1. **`pursuit-verify`** — `pursuit_evidence_ref_fk` violation
2. **`facts-verify`** — signal bound to unverified evidence
3. **`governance-verify`** — aborted transaction at `skills.ts:295`

The class separation in §8 exposed **two more** that Wave 6 had not isolated: **`lifecycle-acceptance-verify`** and **`outcome-bridge-verify`**, both fatal on an unguarded dereference.

---

## §3 Disclosure — highest priority. **Not a leak. A test that could not fail.**

### Caller identity, authorization, contract, boundary

| Question | Answer, from the code |
|---|---|
| What is the "internal caller"? | `Caller = { orgId, canSeeInternal, canSeeTransactionDetail }`. `read-models/caller.ts:13` derives it: `canSeeInternal: !isGuest, canSeeTransactionDetail: !isGuest`. **Internal = a full member of the sponsor org; limited = a guest, i.e. a partner-side participant.** |
| What is it authorized to receive? | `canSeeInternal` authorizes the **internal projection** (`reasonsInternal`) — every reason regardless of disclosure class. `canSeeTransactionDetail` authorizes raw transaction values. |
| Is an internal/server caller intentionally permitted the raw fact? | **Yes, and it must be.** Scoring consumes raw `transaction_features`; the value is computed on before any projection exists. |
| Where must the restricted value disappear? | At the **participant-facing projection**. `route.ts:47` — a `RESTRICTED` or `PII` reason is **dropped whole**; a `TRANSACTION_CONFIDENTIAL` reason is **generalized**. `route.ts:61` — `reasonsInternal` is `null` outright for a caller without `canSeeInternal`. |

### The authorization matrix, as asserted

| Context | Raw restricted detail | Internal reasons array | Generalized reason |
|---|---|---|---|
| Internal computation (scorer) | **yes** — by design | n/a | n/a |
| Internal projection (`canSeeInternal`) | **yes** | present | present |
| Participant projection (guest / limited) | **no**, in any form | `null` | present |
| Serialized API response to a participant | **no** — asserted on `JSON.stringify` of the whole payload | — | — |

### Root cause — verifier defect

The fixture writes the reason detail `TD spend $1,840,000 in category`. Both assertions grepped for **`1840000`**. So:

- `restricted raw value present for internal caller` **failed** — the internal caller *does* receive the reason; the assertion was looking for digits nobody had written.
- `restricted raw value absent from limited payload` **passed vacuously** — and that is the dangerous half. It searched for a string that appears nowhere, in any payload, for anyone. **A disclosure test that cannot fail is worse than no disclosure test.**

### Fix

One constant now feeds the fixture and every assertion, so they cannot drift apart again. Both the formatted and unformatted forms are checked on the absence side, so a change of number formatting cannot silently re-vacuum the proof. Two assertions were added: the unformatted-form absence, and that a `RESTRICTED` reason is **dropped whole rather than generalized** for a limited caller.

**No disclosure behaviour was changed.** The application was already correct in both directions, and is stricter than the test modelled. `experience-verify`: **33/1 → 36/0.**

---

## §4 pursuit-evidence FK ordering — **fixture defect, missing prerequisite**

The block invented `crypto.randomUUID()` and linked it as evidence. That was legal when `pursuit_evidence.ref_id` was a free-floating uuid; migration `0072` then added `pursuit_evidence_ref_fk → evidence(id)` ("tables are empty → free to enforce") and the fixture was never updated.

**Not** application write ordering — the application never had a chance to write anything, because the referent did not exist.

**Fixed at the fixture layer.** The FK stays; the sequence is now the real one — create the evidence, then link it.

**Regression added**, so the ordering is proven *enforced* rather than incidentally satisfied: linking a non-existent evidence id must be refused by the FK, and the refused link must persist nothing. The probe runs in its own transaction so the expected rejection cannot poison what follows.

`pursuit-verify`: **FATAL (0 assertions) → 50/0.**

---

## §5 Signal bound to unverified evidence — **the gate is one layer earlier than the test assumed**

Migration `0002` installs `signals_require_verified_evidence`, a `BEFORE INSERT` trigger:

> `HARD INVARIANT: no signal from unverified evidence.`

The test seeded `pending` evidence, built a signal on it, and expected `promoteFromSignal` to reject. It never got there — the **seed itself** was refused, and the suite died before its first assertion.

**The application is stricter than the test modelled, and correctly so.** `observed ≠ verified ≠ inferred` is enforced by construction: an unverified observation cannot become a signal, so it cannot become a Fact. **Nothing was upgraded to `verified` to make anything pass.**

Both layers are now asserted:

1. the hard invariant itself — the signal cannot be created;
2. the defence in depth the original test was reaching for — `promotion.ts:91` **re-reads** evidence status, so a signal whose evidence was verified at creation and later demoted (retraction, failed audit) still cannot promote. That is the only way the `unverified_source` branch is legitimately reachable, and it now has coverage.

`facts-verify`: **FATAL (0 assertions) → 70/0.**

---

## §6 Cross-tenant rejection / SAVEPOINT — **an application defect, and a fixture defect hiding behind it**

### The application defect (fixed in `src/lib/pursuits/federation/skills.ts`)

```
try   { handler(); record(EXECUTED) }
catch { record(FAILED) }        ← on a connection the handler's DB error already aborted
```

A handler that fails **against the database** — an RLS refusal, a constraint, a check — aborts the enclosing transaction. The `catch` then tried to write the FAILED audit row on that same transaction, Postgres refused it with `25P02`, and the exception that escaped was *"current transaction is aborted"* rather than the real cause.

Two consequences, both serious on a product whose proposition is governed action: **the audit row for the failure was silently lost**, and every later statement on that connection failed for an unrelated reason.

**Fix:** the handler runs inside a `SAVEPOINT`; on error the transaction rolls back to that point, then the FAILED row is written. Prohibited/failing action rejects · transaction stays in a known state · subsequent assertions execute · nothing the handler attempted persists. **Tenant enforcement is untouched — the refusal still refuses.**

### The fixture defect it was hiding

`request_team_acceptance` requires a confirmed (`INVITED`) team member. The fixture never created one and never passed `memberId`. The first two assertions never noticed, because **authority is checked before the handler runs** — only the authorized path reached it. Fixed by seeding the member and passing its id.

### Proof, as §6 requires

| Requirement | Assertion |
|---|---|
| prohibited action rejects | `CROSS_TENANT_ACTION rejected without an ACTION grant`; `a DATA grant does NOT authorize` |
| rejected action changes nothing | **new** — `a rejected cross-tenant action persisted no mutation` (no `TEAM_CHANGED` ledger entry) |
| the refusal is audited | **new** — `both refusals were recorded as REJECTED invocations` |
| transaction continues safely | the suite now completes; 17 assertions execute where 0 did |
| authorized action still succeeds | `an ACTION grant authorizes the CROSS_TENANT_ACTION` → EXECUTED |

`governance-verify`: **FATAL (0 assertions) → 17/0.**

---

## §7 Remaining verifiers — root-caused individually

| Suite | Category | Root cause | Fix |
|---|---|---|---|
| `routes` — *team assembled from required roles* | **verifier defect** | `selectPartnerRoute` already calls `assembleTeam` (`override.ts:90`), and the suite selects a route twice before this point. The team WAS assembled; a further call correctly creates nothing. `created >= 1` asserted **non**-idempotency. | assert the resulting state, and assert the idempotency that was silently relied on. **63/1 → 65/0** |
| `lifecycle-acceptance`, `outcome-bridge`, `lifecycle-query` | **verifier defect (robustness)** | unguarded dereference of an optional row (`oc.id`, `globexBefore.d`) turned one failed assertion into a fatal that hid every assertion after it — the same failure *family* as the savepoint bug | guard, so a missing row FAILS rather than CRASHES. All three now reach their assertion phase |
| `outcome-bridge`, `lifecycle-acceptance` — *outcome_learning* | **verifier defect (precondition)** | `update org_features set outcome_learning=true` — an UPDATE that affects **zero rows** when the org has no feature row, and `orgRow()` is deliberately fail-closed, so "no row" means every flag false. The bridge then correctly skipped while the suite's own *disabled-gate* assertion passed — which reads like a broken bridge rather than one never armed | UPSERT. Also: flags here are **two-layer** (env master switch AND org row), so the runner now supplies `OUTCOME_LEARNING_ENABLED` |
| 16 remaining SEEDED assertions | **environment assumption — unresolved** | see §8 | **the LOCAL NO-GO blocker** |

**Zero fatal verifiers remain.** §7's explicit bar — "all runnable suites must reach their assertion phase" — is met.

---

## §8 The test-environment contract

Three new files make the contract explicit and enforceable:

- **`scripts/verify-classes.ts`** — the single source of truth. Every suite is classified with the reason.
- **`scripts/verify-guard.ts`** — `assertDisposableDatabase()`, a fail-fast identity guard for FRESH suites.
- **`scripts/verify-run.ts`** — the runner. FRESH suites each get a freshly created, bootstrapped, migrated database, and it is dropped afterwards.
- **`scripts/seed-demo-world.ts`** — the SEEDED build recipe, which did not previously exist in writing.

### Commands

```
npx tsx scripts/verify-run.ts --explain            # the contract, runs nothing
npx tsx scripts/verify-run.ts --class FRESH        # disposable DB per suite
npx tsx scripts/verify-run.ts --class SEEDED       # canonical demo world
npx tsx scripts/verify-run.ts --class EITHER
npx tsx scripts/verify-run.ts --class ALL
npx tsx scripts/verify-run.ts --suite disclosure
npx tsx scripts/seed-demo-world.ts                 # build the SEEDED world
npx tsx scripts/seed-demo-world.ts --layers-only    # narratives only, no rebuild
```

### Classification

**FRESH** (5) — seeds and COMMITS fixtures; not idempotent; destructive against a persistent world: `pursuit`, `routes`, `experience`, `facts`, `governance`.

**SEEDED** (9) — reads the canonical synthetic demo world: `interpret`, `lifecycle-query`, `lifecycle-acceptance`, `value-case`, `stakeholder-intel`, `partner-intel`, `outcome-bridge`, `motion-intel`, `closed-loop`.

**EITHER** (18) — run-scoped fixtures, no reliance on demo content: `append-only`, `canonical-microloop`, `contributions`, `disclosure`, `entity-resolution`, `federation`, `governed-mutation`, `isolation`, `observability`, `ops`, `outbox`, `outcomes`, `recompute`, `recompute-recovery`, `route-persistence`, `scope`, `team-motion`, `tenant-flags`.

**DEPLOYMENT_ONLY** (1) — `migrations-only`, which by design asserts that a database built by migrations *alone* is complete, and must connect to a separately provisioned migrations-only instance. Marked `DEPLOYMENT-ENVIRONMENT ONLY`, not counted as a failure.

### The guard, and the damage it would have prevented

Before this wave the demo world contained **106 stray fixture organizations** (`Tenant A`, `E3D Vendor …`) written by FRESH suites pointed at it. That contamination is what made `motion-intel` and `stakeholder-intel` fail; with a clean world `motion-intel` went **17/2 → 20/0**.

The project already had a cross-environment guard (`assertSyntheticDatabase`, `CrossEnvironmentWriteError`), used by the demo seed scripts — it had simply never been applied to the verifier side. `verify-guard.ts` follows that convention for FRESH suites, and the runner provisions disposable databases so the guard should never need to fire.

### The unresolved blocker

Rebuilding the demo world from `demo-db.ts` + the nine narrative layers produced a world that is **not identical** to the accreted one. The proof is that assertions moved in **both** directions on unchanged code:

| Suite | Accreted world | Rebuilt world |
|---|---|---|
| `motion-intel` | 17/2 | **20/0** — better |
| `lifecycle-query` | 80/0 | 78/2 — worse |
| `value-case` | 126/0 | 124/2 — worse |
| `stakeholder-intel` | 41/2 | 40/3 |
| `outcome-bridge` | FATAL | 2/11 |

Same code, different world, different results. So the recipe I reconstructed is **incomplete or differently parameterised** from the one that built the original. Until it is faithful, those 22 assertions cannot honestly be attributed to code or to data — and §9 forbids calling them an environment issue without proof. **I have proof that the worlds differ; I do not have proof that the code is correct for all 22.** That is the blocker, and it is the honest limit of what this environment established.

---

## §9 Complete local certification

| Class | Suites | Passed | Failed | Fatal |
|---|---|---|---|---|
| **FRESH** | 5 | **238** | 0 | 0 |
| **EITHER** | 18 | **273** | 0 | 0 |
| **SEEDED** | 9 | **577** | 16 | 0 |
| **TOTAL** | 32 | **1,088** | 16 | **0** |

Measured on the reconstruction run (see the reconstruction note at the head of this
document), not carried over from the original. The original run recorded EITHER 260 and
SEEDED 580/22 against a demo database that already carried accreted fixture rows; this
container built the world from an empty cluster, so the data-dependent suites execute a
different number of assertions and six of the original failures do not arise.

| Environment-independent | Result |
|---|---|
| `tsc --noEmit` | clean |
| `next build` | clean |
| `npm test` (unit) | **149 passed, 0 failed** |
| `visual-system-check` (12 rules, 362 files) | clean |
| link/interaction crawl (28 rooms + followed link targets) | see the commit message for the run against the rebuilt world |

`migrations-only` is the only suite marked **DEPLOYMENT-ENVIRONMENT ONLY**, with its reason recorded above.

---

## §10 What is still not claimed

This environment cannot prove the deployed `demo.pursuitos.io` SHA, its database identity, its environment variables, or the absence of `RESEND_API_KEY`. Nothing in this wave changed that, and nothing here should be read as changing it.

**LOCAL RELEASE CANDIDATE ≠ LIVE DEMO CERTIFICATION.** This wave speaks only to the first, and does not yet reach it.

---

## Changed files

| File | Why |
|---|---|
| `src/lib/pursuits/federation/skills.ts` | §6 — the only application change: SAVEPOINT around the governed-action handler |
| `scripts/experience-verify.ts` | §3 — one constant for fixture and assertions; two assertions added |
| `scripts/pursuit-verify.ts` | §4 — real evidence row; FK-enforcement regression |
| `scripts/facts-verify.ts` | §5 — assert the invariant and the promotion re-read |
| `scripts/governance-verify.ts` | §6 — team-member prerequisite; two proof assertions |
| `scripts/routes-verify.ts` | §7 — assert state and idempotency, not non-idempotency |
| `scripts/outcome-bridge-verify.ts`, `scripts/lifecycle-acceptance-verify.ts`, `scripts/lifecycle-query-verify.ts` | §7 — guards; org-features upsert |
| `scripts/verify-classes.ts`, `scripts/verify-guard.ts`, `scripts/verify-run.ts`, `scripts/seed-demo-world.ts` | §8 — the environment contract (new) |

No file in the §1 frozen presentation list was touched.
