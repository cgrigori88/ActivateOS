# D-UNIT-SUMMARY-PHANTOM-FAIL

**Status: OPEN / UNCHARACTERIZED / NON-BLOCKING.**

Not resolved. There is no cause, and a run that did not reproduce is not a diagnosis.

## What happened

During the Slice-2 regression, one invocation of the unit suite reported a failure in its summary
while every individual test reported success.

```
$ npm test                       # tsx --test tests/*.test.ts
# pass 928
# fail 1
```

Exit code was non-zero (the summary line was captured through
`npm test 2>&1 | grep -E "^# (pass|fail)"`). No `not ok` line appeared in the output, no test file
named a failure, and no assertion text was printed.

## What was checked immediately afterwards

* Re-ran the full suite: `# tests 929 · # suites 0 · # pass 929 · # fail 0 · # cancelled 0`.
* Counted `^ok ` lines in the full output: **929**, matching the reported total.
* Grepped the full output for `not ok`: **no matches**.
* Grepped for `error:`, `failureType`, `code: 'ERR`: **no matches**.
* Ran **every test file individually** (`npx tsx --test tests/<file>`) and checked each summary:
  **no file reported `# fail` other than 0**.

Three subsequent full runs were clean, as was every run during the completion pass.

## Why it is recorded rather than dismissed

The counts in the anomalous run were internally inconsistent — `pass 928` with 929 passing
subtests — which is the part that is not explainable by a flaky assertion. A flaky test would have
printed a `not ok` line naming itself. Something reported a failure that no test claimed.

Plausible but **unverified** directions, none of which were confirmed and none of which should be
repeated as a cause: a file-level failure in Node's test runner counted in the summary but not
emitted as a subtest; a worker or teardown error after the last assertion; contention with a
concurrently running verifier holding the local PostgreSQL cluster.

## What it is not

**It is NOT D-P6IG-GOVERNANCE-FLAKE.** That defect is in the hosted governance suite and has a known
surface. This is the local unit runner, a different process, a different suite, and a different
symptom. Conflating them would make both harder to characterize.

## How to apply

If it reproduces: **STOP at the first reproduction**. Preserve the complete stdout and stderr, the
exit code, and the full summary block **before** re-running — the evidence is the inconsistency
between the summary and the subtests, and a clean re-run destroys the only copy of it. Do not retry
first.
