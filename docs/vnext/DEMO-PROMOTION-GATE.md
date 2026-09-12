# PursuitOS vNext — Demo Promotion Gate

**Last updated:** 2026-09-12T02:47Z
**Demo date:** Monday 2026-09-14
**Default promotion decision for this weekend: NO.**

---

## The rule

> **Completion does not imply deployment.**

Finishing a feature is an engineering event. Promoting it to the demo is a business
decision, and it is not mine to make. Promotion requires **explicit approval from
the repository owner**, given after review, against the criteria below.

A feature can be complete, tested, green and genuinely good, and the correct answer
can still be "not this weekend". That is not a failure — it is the gate working.

## What promotion means here

Promotion = merging vNext work into `claude/activateos-platform-review-xzkgmd`
(the production branch of the `PursuitOS-demo` Vercel project) and letting it
deploy to `demo.pursuitos.io`.

**Nothing else counts as promotion.** Pushing `roadmap/pursuitos-vnext` is not
promotion. A preview deployment is not promotion.

---

## Promotion criteria

Every line must **clearly** pass. Ambiguity is a fail. Unverified is a fail.

| # | Criterion | Status |
|---|---|---|
| P-1 | **Functionality complete.** Not "mostly working". No known missing behaviour in the promoted scope. | ☐ |
| P-2 | **Preview reviewed** by the owner, on the actual preview deployment. | ☐ |
| P-3 | **Desktop UX reviewed** at the presentation viewport (~1600×1000). | ☐ |
| P-4 | **Responsive/mobile UX reviewed** at phone width. No horizontal body scroll. | ☐ |
| P-5 | **Demo itinerary still works.** Every beat of `audit/DEMO-ITINERARY.md` walked end to end, including the Sponsor⇄Partner disclosure moment. | ☐ |
| P-6 | **Numbers reconcile.** 11 open opportunities · $8,040,000 open · $3,361,500 weighted · $1,850,000 motion value · 14 pursuits · 3 orgs · 14 companies. Confirmed via `scripts/demo-manifest.ts` digest and `seed-demo-world.ts` `verify()`. | ☐ |
| P-7 | **No known regression.** All 33 verifier suites green, `typecheck` clean, `npm test` green, `next build` succeeds. Pre-existing failures listed separately and unchanged. | ☐ |
| P-8 | **Migrations safe.** Additive only. No column drop, no type narrowing, no data deletion, no overwriting backfill. Reviewed statement by statement. | ☐ |
| P-9 | **Database target verified.** The deployment's `database.projectRef` confirmed via `/api/build` to be `qifatlqxfuhwrwvpbwsc`, and `environment_identity` still reads `environment=demo`, `is_synthetic=true`. | ☐ |
| P-10 | **Disclosure/security unchanged.** Server-side withholding intact; confidential values absent from the partner payload, not hidden client-side. No new surface widens a scope. | ☐ |
| P-11 | **Synthetic-cannot-send invariant preserved.** No code path can send externally without the existing approval gate. | ☐ |
| P-12 | **Autosend OFF preserved.** `OUTREACH_AUTOSEND` unset (or any value other than exactly `on`), so `externalSendingArmed()` is false. | ☐ |
| P-13 | **Rollback path verified** — actually rehearsed, not merely described. See §Rollback. | ☐ |
| P-14 | **Demo smoke test passes** on the promoted deployment, after deploy, before the demo. | ☐ |
| P-15 | **Sufficient cleanup/certification time remains before Monday.** If promotion would land with less than a clear day of margin, the answer is NO regardless of the other fourteen lines. | ☐ |

### Additional gates specific to this weekend

| # | Criterion | Status |
|---|---|---|
| P-16 | **Live serving SHA established.** The 2026-09-12 reconciliation ended **UNRESOLVED**: the production branch head is `97e975f0` (Wave 6D) but the last observed serving SHA was `66f72f61` (Wave 3). **You cannot certify a promotion against an unknown baseline.** Resolve via `/api/build` with `OPS_FINGERPRINT_TOKEN`, or the Vercel API, before any promotion decision. | ☐ **BLOCKING** |
| P-17 | **Flag state deliberate.** Every `VNEXT_*` variable's intended value on the production scope is explicitly stated and matches what is set. Remember: Vercel applies env changes only to new deployments. | ☐ |
| P-18 | **Preview write-safety resolved**, if any promoted capability writes. Currently **UNKNOWN** — see `ENVIRONMENT-MAP.md` §6. Read-only capabilities may proceed without this. | ☐ |

---

## Weekend gates

Promotion is GATE E. It cannot be reached without A–D.

### GATE A — Foundation ✅ PASSED 2026-09-12
Safe vNext branch, preview path assessed, durable handoff documentation, flag
scaffolding. **No roadmap feature implementation before this passes.**

### GATE B — Vertical Slice ☐
One existing synthetic pursuit works end to end through the first
context/state/memory slice. Behind flags, visible in preview, demo untouched.

### GATE C — Product ☐
Multiple pursuits work **and the UX is clearly better, not merely more
feature-rich**. If the room got denser, this gate fails (`ACCEPTANCE.md` §density test).

### GATE D — Architecture ☐
Thin Control Plane / domain-action / evaluation foundations established **without
destabilising the app**. Backend primitives only; no new user-facing navigation.

### GATE E — Promotion ☐
Explicit decision whether anything is safe **and worthwhile** to promote.
**Default: NO.**

---

## The cutoff principle

> **If a meaningful user-facing roadmap feature is not effectively complete by
> Saturday night, assume it will NOT ship to Monday's demo.**

Sunday 2026-09-13 is reserved for review, cleanup, regression testing, UX
refinement, certification and rollback validation. **Sunday is not build time.**

A feature finished Sunday afternoon has not been regression-tested against a demo
that is 24 hours away. The expected value of shipping it is negative.

---

## Rollback

Rehearse this before promoting, not after something breaks.

**If the promoted work is flag-gated and OFF by default (the expected case):**

1. Confirm the `VNEXT_*` variables are unset on the production scope.
2. Nothing else to do — the code is inert. This is why flags exist.

**If a flag was armed on production and must be disarmed:**

1. Unset the variable in Vercel → `PursuitOS-demo` → Environment Variables (Production).
2. **Redeploy.** Env changes bind at build time; the running deployment will not
   change until a new build completes.
3. Confirm via `/api/build` that the expected commit is serving.

**If the code itself must come out:**

1. Promote the last known-good deployment in the Vercel dashboard — fastest path,
   no build wait, and it restores a deployment that was already certified.
2. Or `git revert` the merge commit on
   `claude/activateos-platform-review-xzkgmd` and push, then wait for the build.
3. Confirm via `/api/build`.

**Known-good reference:** commit `97e975f0d9895c54bfc49cdcc24924d6ac58e796`
(Wave 6D), tagged `demo-safe-2026-09-12` and `backup/2026-09-04/tds-live-demo`,
also the head of branch `ui-wave-6d`.

**No rollback step deletes data.** If a rollback would require data cleanup, the
migration was not additive and P-8 should have failed.

---

## Who decides

The repository owner. Not the agent, not a passing test suite, not the fact that
work is finished.

If you are an agent reading this in a later session: **do not promote, merge to the
production branch, or push to `claude/activateos-platform-review-xzkgmd` without an
explicit instruction naming that action.** Green tests are not approval.
