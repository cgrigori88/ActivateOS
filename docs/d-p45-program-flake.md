# D-P45-PROGRAM-FLAKE — `verify-run` concurrency determinism

**Status: DETERMINISTIC CORRECTION ACCEPTED / CLOSED.** Certification-infrastructure defect,
classification **A — assertion/test defect**. No P45 product defect was found and no production
source was changed.

> **A flaky certification test is made deterministic by fixing the test, the harness or the underlying
> defect — never by retrying until green and never by suppressing the suite.**

**Everything between here and the CLOSED section below is the ORIGINAL DISCOVERY BRIEF, retained as
history.** Its "What is NOT known" list was answered in full by the investigation it authorised — in
particular the failing assertion names WERE captured, and the claim there that `verify-run` "prints
totals only" is **wrong** and is corrected in the closeout. Read the CLOSED section for the findings.

## The question

> Why does `p45-program` intermittently fail through `verify-run`'s clone path while direct verifier
> execution passes?

## What is known

Observed while running R10 of the P7 Slice 12 completion gate.

- `certify-world` reports **51 suites consistently clean** and `p45-program` **intermittently failing**.
- The failure **count varies between runs** — 2, 5, 5, 2, 2 observed — rather than a stable set.
- It fails on the **previously certified `6dccdf7`** as well: a detached worktree at that commit
  produced `76 passed, 2 failed` on the fifth run, after four clean runs.
- Driving `scripts/p45-program-verify.ts` directly against a clone, with the seeded-clone guard off,
  passed **8 of 8**.
- Replicating `certify-world`'s `runOne` invocation reproduced the failure on the first attempt.
- **Certification protected-state integrity was PASS in every run** — `d43fe13b1f194132` start = end.
  Nothing drifted; only assertions inside the suite failed.
- `p45-program` is a `SEEDED_CLONE` suite that commits fixtures and explicitly exercises concurrency
  ("concurrent resumes produce one effect and one transition").

## What is NOT known, and must not be asserted

- **The names of the failing assertions.** `verify-run` prints totals only; the verifier refuses an
  unmarked clone; and when driven directly with the guard off it did not fail. The failing assertions
  were never captured.
- **Whether the failure rate differs between `6dccdf7` and `3449c56`.** The observed rate was higher at
  `3449c56`, but the samples are small and machine load varied between them. **Pre-existence is proven;
  rate equality is not.**
- **Root cause.** Assertion nondeterminism, harness isolation, startup readiness, transaction timing and
  genuine P45 behaviour are all still open.
- **Whether machine load is causal.** Plausible, unproven.
- **Whether P45 has a real concurrency defect.** Not established either way.

## Required investigation — discovery only

1. **Instrument the certification runner only as far as needed to preserve individual failing assertion
   names and their evidence** instead of totals-only output. Do **not** change the assertions or their
   pass/fail semantics in order to obtain names.
2. **Reproduce through the exact failing `verify-run` clone path**, not a convenient substitute.
3. **Capture:** assertion names · concurrency timings relevant to them · clone identity · database
   identity · process exit and output · resource/load observations where measurable · and which class
   the failure belongs to (assertion nondeterminism, harness isolation, startup readiness, transaction
   timing, or genuine P45 behaviour).
4. **Run a controlled sample at both `6dccdf7` and `3449c56`**, same runner, same machine posture, same
   methodology. The purpose is **not** a statistical claim of identical rates; it is to determine
   whether any **repeatable commit-specific behavioural difference** exists.

## Stop conditions

- **Same named assertions failing nondeterministically at both commits under equivalent conditions** →
  classify as pre-existing certification flakiness and propose the **smallest deterministic test
  correction**.
- **A repeatable new failure mode at `3449c56` that is absent at `6dccdf7`** → **STOP and return the
  evidence**, even though Slice 12 is already closed.
- **Evidence of a real P45 concurrency defect rather than test infrastructure** → **STOP before
  modifying P45** and return a product-defect ruling request.

## Constraints

No P45 production code changes during discovery. No weakening of the verifier. No P45 activation.
No Slice 11 resumption. Return the characterization before any corrective implementation.

---

# CLOSED — DETERMINISTIC CORRECTION ACCEPTED

**Classification: A — assertion/test defect.** The product safety invariant never failed.

## What the defect actually was

> The original test equated **concurrently-created requests** with **requests that had observed the
> same generation**. Under scheduler and connection pressure a later request could legitimately
> observe the next generation and advance it. **The product invariant held; the test premise did not.**

`resumeRun` fixes the generation a request was issued against when its **first statement** — an
unlocked `observeGeneration` SELECT — returns, which is after connection acquisition and scheduler
entry. `runtime.ts` states the consequence explicitly: *"A request ISSUED AFTER the advance observes
the new generation and proceeds normally."* That behaviour was already certified by the assertion
immediately below the failing ones.

**The proof it was a legitimate continuation and not a lost race:** the second dispatcher reported
`seq=2`. A request that observed generation *G* intends to advance **step 1**. Advancing **step 2**
proves it observed the post-advance state. In every failing run `invocations per step` was
`seq1=1 seq2=1 seq3=0` — **no step ever executed twice, and no consequential effect was ever
duplicated.**

## The repair

**Scenario A — natural public concurrency, no barrier. Scheduler-dependent by design.** It certifies
that arbitrary natural concurrency is safe whether one or several sequential generations are
observed. Its criteria: no duplicate step dispatch; at most one invocation and one effect per step;
each dispatcher aligned with the generation it actually observed; stale-loser correctness; terminal-
observer correctness; no skipped step. **Artificial coverage of its multi-generation branch is not
required** — frequency of that branch is a scheduling accident, not a certification target.

**Scenario B — the load-bearing deterministic proof.**

> A set of resumes **proven** to have observed the same generation may advance that generation
> **exactly once**, and the same burst **may not drain the next generation**.

A verifier-only `Proxy` over the `PoolClient` the test already supplies pauses each participant after
its own generation observation and before it serializes. No production seam was added: `resumeRun`
already takes the client as a parameter. The barrier is count-based and in-process; its timeout is a
deadlock fail-safe only, never synchronisation and never a correctness criterion. The Proxy verifies
the intercepted statement really is the generation observation, so a refactor that moves the seam
fails loudly instead of pausing at an unrelated query.

Observed five-racer evidence, recorded as the direct proof of the property the old assertions assumed:

```
all five captured identical G   ·   barrier released only after all five arrived
one advanced G                  ·   four returned stale with invocationId null
one invocation / one effect / one completion transition for G
G+1 remained PENDING            ·   a fresh post-race resume then executed G+1 normally
```

The fresh continuation is a **separate phase** that does not share the barrier, so a duplicate
same-generation request stays distinguishable from legitimate next-generation work.

## Evidence

| | |
|---|---|
| **Before** | **6 of 40 failing at each runtime**, identical failure signature at `6dccdf7` and `3449c56`; apparent commit skew reversed under alternating order |
| **After** | **0 of 70** primary repeated runs — 30 direct canonical marked-clone, 20 verify-run path (at load 12–21, *above* the range where the flake appeared), 10+10 dual-runtime repaired controls |
| `certify-world` | **52 clean, 0 with failures — three consecutive runs**, no retry, no suppression |
| Protected state | `d43fe13b1f194132` start = end, every run |
| Regression | p45-program 100/100 · unit 814/814 · tsc clean · build clean |

**What is NOT claimed.** 0/70 does not prove a mathematical zero failure probability. The certified
statement is narrower and stronger: **the known scheduler-dependent premise defect was removed, and
the relevant concurrency properties are now established deterministically by construction** rather
than by hoping the scheduler cooperates.

## Diagnostic history, corrected

`verify-run` was **not** totals-only. The failing assertion names were already present in its MATRIX
`reason` column; an over-narrow diagnostic grep omitted that row, and I carried that mistaken
characterisation for longer than I should have. The genuine, separate weakness is that `runSuite`
discarded a failing suite's stdout. `VERIFY_DUMP_ON_FAIL` corrects it opt-in: default behaviour
unchanged, pass/fail semantics unchanged, no retry introduced.

## Files changed

`scripts/p45-program-verify.ts` and `scripts/verify-run.ts`. **No `src/`, no migration, no schema, no
`PG_POOL_MAX`, no timeout-as-pass, no retry, no suppression.** Standing lesson recorded as **§16J**.
