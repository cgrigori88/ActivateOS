# PursuitOS vNext — Session Handoff

> **Read this file first.** It is written so a brand-new Claude Code Web session can
> resume with no prior chat context. **Every work session must update it before
> stopping.**

---

## Where things stand

| | |
|---|---|
| **Date/time** | 2026-09-12T02:47Z (Saturday) |
| **Repository** | `cgrigori88/ActivateOS` — working dir `/home/user/ActivateOS` |
| **Current branch** | `roadmap/pursuitos-vnext` |
| **Current commit** | `4bc27a467d4064f86a2999910e75b7a60f8169bd` — "vNext Session 0: safe, resumable development lane (GATE A)" |
| **Known-good demo commit** | **`97e975f0d9895c54bfc49cdcc24924d6ac58e796`** (Wave 6D) |
| **Environment worked in** | Claude Code Web cloud container. Local build + local validation only. No hosted environment was contacted except two unauthenticated read-only HTTP probes of `demo.pursuitos.io` on 2026-09-07. |
| **Preview URL** | **UNVERIFIED** — see "Preview" below |
| **Preview data safety** | **UNKNOWN** — see "Preview" below |
| **Session completed** | GATE A (Foundation). Session 0 only. |

### The demo baseline, with evidence

- Branch `claude/activateos-platform-review-xzkgmd` → `97e975f0` (Vercel production
  branch for `PursuitOS-demo`, via dashboard Branch Tracking).
- Same commit is also the head of `ui-wave-6d` and is tagged
  **`backup/2026-09-04/tds-live-demo`** — an annotated tag **already on origin**,
  which is the durable immutable reference.
- Local tag `demo-safe-2026-09-12` was created at the same commit. **Its push was
  refused (HTTP 403)** — this remote rejects tag pushes, as it did on 2026-09-04.
  It therefore exists locally only and will not survive container loss. No matter:
  the pushed `backup/…/tds-live-demo` tag plus the SHA recorded throughout these
  docs are the durable references.
- Working tree was **clean** at session start and is clean now.

---

## Files changed this session

| File | Change |
|---|---|
| `docs/vnext/ROADMAP.md` | new — canonical P0–P10, thesis, loop, additive-not-rebuild |
| `docs/vnext/BUILD-PLAN.md` | new — what already exists, slice order, gates A–E, cutoff |
| `docs/vnext/STATUS.md` | new — per-capability status board |
| `docs/vnext/DECISIONS.md` | new — D-001 … D-015 |
| `docs/vnext/SESSION-HANDOFF.md` | new — this file |
| `docs/vnext/ACCEPTANCE.md` | new — functional + UX acceptance |
| `docs/vnext/ENVIRONMENT-MAP.md` | new — verified facts only; no secrets |
| `docs/vnext/DEMO-PROMOTION-GATE.md` | new — P-1…P-18, default NO |
| `docs/vnext/SLICE-1-LIVING-PURSUIT-CONTEXT.md` | new — full Slice 1 plan |
| `src/lib/env/vnext-flags.ts` | new — 7 staging flags, default OFF, narrowing-only |
| `tests/vnext-flags.test.ts` | new — 4 tests pinning default-OFF and narrowing |
| `.env.example` | modified — appended a commented vNext flag block (names only) |

**No application behaviour changed.** `vnext-flags.ts` is referenced by nothing but
its own test.

## Tests run

| Check | Baseline (before changes) | After |
|---|---|---|
| `npx tsc --noEmit` | exit 0 | **exit 0** |
| `npm test` | 149/149 pass | **153/153 pass** |
| `npm run build` | exit 0 | **exit 0** |

**Zero pre-existing failures**, so any future failure is attributable.

**Not run:** the 33 verifier suites (need a database; no roadmap code was written
that could affect them). Run before GATE B.

---

## Preview

**Status: UNVERIFIED. Data safety: UNKNOWN.**

The branch is pushed, so Vercel has most likely created a Preview deployment — but
this container has no Vercel credential, there is no `vercel.json` in the repo, and
the preview URL cannot be constructed reliably without the team scope slug. It was
**not** guessed.

**The important part:** the 2026-09-07 read-only Vercel verification recorded
`DATABASE_URL` scoped to **both Production and Preview** on `PursuitOS-demo`. If
that is still true, **a preview deployment writes to the same Supabase database that
serves Monday's demo.** That has not been re-verified, so it is recorded as UNKNOWN
rather than as UNSAFE_SHARED_WRITE — but treat it as unsafe in practice.

**Operating rule until resolved:**
- **No writes from preview.** Read-only viewing only.
- Do not create a database, do not change a credential, do not change env scoping.
- Develop against the **local synthetic path** (`scripts/seed-demo-world.ts` →
  local Postgres `pursuit_demo`), which is already isolated and already guarded by
  `assertSyntheticDatabase`.

Resolution commands are in `ENVIRONMENT-MAP.md` §6.

---

## Blockers

| # | Blocker | Impact | Unblock |
|---|---|---|---|
| B-1 | **Preview data access UNKNOWN** | No preview writes; Slice 1 is read-only so it is unaffected, but Slice 2+ is blocked | `ENVIRONMENT-MAP.md` §6 — one Vercel API call, read-only |
| B-2 | **Live serving SHA unresolved** | Cannot certify any promotion | `/api/build` with `OPS_FINGERPRINT_TOKEN`, or the Vercel API. Branch head is Wave 6D `97e975f0`; last observed serving SHA was Wave 3 `66f72f61` |
| B-3 | Tag pushes refused (403) | Cosmetic — durable references exist | None needed |

Neither B-1 nor B-2 blocks starting Slice 1 chunks 1–4, which are pure functions
referenced by nothing.

---

## DO NOT TOUCH

- `app.pursuitos.io` — production. Out of scope entirely.
- `demo.pursuitos.io` — Monday's demo.
- Branch `claude/activateos-platform-review-xzkgmd` — **the Vercel production
  branch.** Never push to it, never merge into it, without an explicit instruction
  naming that action. Green tests are not approval.
- Any Vercel environment variable, deployment, alias, domain, or build setting.
- Any Supabase role, grant, RLS policy, schema object, migration, or credential.
- The hosted demo database (`qifatlqxfuhwrwvpbwsc`). No writes, no reseed.
- DNS, secrets, `main`.
- Disclosure/grant layer, governed-action semantics, append-only ledgers
  (`change_ledger`, `governed_action_invocations`, `pursuit_overrides`),
  recommendation-vs-decision semantics, `externalSendingArmed()`.

---

## Exact next action

**Nothing. Session 0 is complete and STOPPED by instruction.**

Vertical Slice 1 must not begin until the repository owner explicitly approves it.

When approved, the next action is **Slice 1 chunk 1**: create
`src/lib/pursuits/read-models/context-health.ts` composing the existing
`src/lib/facts/freshness.ts` with the existing `src/lib/intel/completeness.ts` at
pursuit level, weighted by `pursuit_facts.relevance_type`, plus unit tests. It is
referenced by nothing and changes no rendered output. Full plan:
`docs/vnext/SLICE-1-LIVING-PURSUIT-CONTEXT.md`.

---

## Run these first in the next session

```sh
cd /home/user/ActivateOS

# 1. Confirm you are in the right lane and nothing drifted.
git fetch --all --tags
git checkout roadmap/pursuitos-vnext
git log --oneline -1                      # expect 4bc27a4 or later
git status --porcelain                    # expect clean
git rev-parse origin/claude/activateos-platform-review-xzkgmd   # expect 97e975f0…  (unchanged)

# 2. Read the durable memory. Start here, not with the code.
cat docs/vnext/SESSION-HANDOFF.md
cat docs/vnext/STATUS.md
cat docs/vnext/BUILD-PLAN.md              # "What already exists" prevents rebuilding shipped code

# 3. Re-establish the validation baseline before changing anything.
npm install
npx tsc --noEmit                          # expect exit 0
npm test                                  # expect 153/153
npm run build                             # expect exit 0
```

### Container-loss notes

This is a cloud sandbox and may disappear at any time.

- `node_modules` is **not** committed — `npm install` is always step one.
- The container may be **re-cloned mid-session** onto a stale branch. Always
  `git fetch --all --tags` and verify SHAs against `git ls-remote` rather than
  trusting the local checkout.
- A local-only tag (`demo-safe-2026-09-12`) will be gone. Use
  `backup/2026-09-04/tds-live-demo` or the SHA `97e975f0`.
- Anything not pushed is lost. Commit and push early.

### Before you stop, next session

1. Update **this file**: date, branch, commit, files changed, tests run, completed
   work, in-progress work, exact next action, blockers.
2. Update `STATUS.md` for every capability you touched.
3. Append to `DECISIONS.md` any durable decision you made.
4. Commit and push.
