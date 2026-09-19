# D-P45-PROGRAM-FLAKE — `verify-run` concurrency determinism

**Status: OPEN — discovery not yet started.** This is a certification-infrastructure investigation.
It is not a reopening of Slice 11 or Slice 12, and it is not a claim that P45 has a product defect.

> **A flaky certification test is made deterministic by fixing the test, the harness or the underlying
> defect — never by retrying until green and never by suppressing the suite.**

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
