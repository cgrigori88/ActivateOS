# PursuitOS vNext — Session Handoff

> **Read this file first.** It is written so a brand-new Claude Code Web session can
> resume with no prior chat context. **Every work session must update it before
> stopping.**

---

## Where things stand

| | |
|---|---|
| **Date/time** | 2026-09-12T05:30Z (Saturday) |
| **Repository** | `cgrigori88/ActivateOS` — working dir `/home/user/ActivateOS` |
| **Current branch** | `roadmap/pursuitos-vnext` |
| **Current commit** | `0f86079` — "feat(vnext): connect living pursuit context loaders" (+ a docs commit on top) |
| **Known-good demo commit** | **`97e975f0d9895c54bfc49cdcc24924d6ac58e796`** (Wave 6D) |
| **Session completed** | Vertical Slice 1, **chunk 5A** (loaders + verifier). Chunks 5B–8 NOT STARTED. |
| **Preview URL** | **UNVERIFIED** — unchanged from Session 0 |
| **Preview data safety** | **UNKNOWN** — unchanged from Session 0 |

### Demo baseline, unchanged and re-verified this session

- Production branch `claude/activateos-platform-review-xzkgmd` → `97e975f0`.
- Also the head of `ui-wave-6d`, and tagged `backup/2026-09-04/tds-live-demo`
  (annotated, already on origin — the durable immutable reference).
- Working tree clean at session start and at session end.

---

## Commits produced

| Chunk | SHA | Title |
|---|---|---|
| 1 | `d1e5685` | feat(vnext): add pursuit context health read model |
| 2 | `b6b7b33` | feat(vnext): add chronological pursuit memory read model |
| 3 | `ac572ba` | feat(vnext): compose ranked missing-context read model |
| 4 | `77f72ef` | feat(vnext): add pursuit pertinence read model |
| — | `a13c2fa` | docs(vnext): record chunks 1–4 as built |
| **5A** | **`0f86079`** | **feat(vnext): connect living pursuit context loaders** |

## Chunk 5A files

| File | Change |
|---|---|
| `src/lib/pursuits/read-models/context-loaders.ts` | **new** — four thin loaders + convenience wrappers |
| `scripts/vnext-context-verify.ts` | **new** — 42-assertion read-only integration harness |
| `scripts/verify-classes.ts` | modified — registry entry `vnext-context` (SEEDED) |
| `src/lib/intel/company-intel.ts` | modified — **one word**: `export function familiesFromSignalTypes`. Zero runtime effect. |

Nothing imports `context-loaders`; there is still no rendered consumer.

## Chunk 1–4 files — and nothing else touched

| File | Lines |
|---|---|
| `src/lib/pursuits/read-models/context-health.ts` | 427 |
| `src/lib/pursuits/read-models/memory.ts` | 269 |
| `src/lib/pursuits/read-models/missing-context.ts` | 378 |
| `src/lib/pursuits/read-models/pertinence.ts` | 329 |
| `tests/vnext-context-health.test.ts` | 193 |
| `tests/vnext-pursuit-memory.test.ts` | 245 |
| `tests/vnext-missing-context.test.ts` | 266 |
| `tests/vnext-pertinence.test.ts` | 250 |

**8 files added. 0 pre-existing files modified.** Verified with
`git diff --stat bfca1d7..HEAD` — every line is an insertion in a new file.

The four modules are **not** exported from `read-models/index.ts`, which is the
boundary the UI consumes. Nothing outside `src/lib/pursuits/read-models/` imports
them. They are unreachable from any rendered path.

## Tests and build

| Check | Session 0 baseline | After 1–4 | After 5A |
|---|---|---|---|
| `npx tsc --noEmit` | exit 0 | exit 0 | **exit 0** |
| `npm test` | 149 / 0 | 220 / 0 | **220 pass / 0 fail** |
| `npm run build` | exit 0 | exit 0 | **exit 0** |
| `vnext-context` verifier | — | — | **42 passed / 0 failed** |
| SEEDED spot-check | — | — | **interpret 255 · lifecycle-query 80 · value-case 126 · stakeholder-intel 43** |

### Local synthetic database — how it was established

PostgreSQL 16.13 from `/usr/lib/postgresql/16/bin`, `initdb` as the `postgres`
user (it refuses to run as root) under `/var/lib/postgresql/vnext/pgdata`, port
5433. **`pgvector` is required** — `0001_core_schema.sql` does
`create extension vector` — and is not installed by default:
`apt-get install -y postgresql-16-pgvector`, then restart the server.

```sh
export DEMO_PGHOST=127.0.0.1 DEMO_PGPORT=5433 DEMO_DB_NAME=pursuit_demo
export DEMO_ADMIN_URL="postgresql://postgres:postgres@127.0.0.1:5433/postgres"
export DEMO_URL="postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo"
npx tsx scripts/seed-demo-world.ts            # all 10 layers + verify()
export DATABASE_URL_VERIFY="$DEMO_URL"
npx tsx scripts/vnext-context-verify.ts       # 42/42
```

The seeded world reconciled exactly against the certified canonical facts:
3 orgs · 14 companies · 19 opportunities · **11 open** · **$8,040,000** ·
14 pursuits · `environment_identity` = `demo` / `is_synthetic=true`.

**No hosted database was contacted at any point.**

71 tests added in total: 4 flag tests (Session 0) + 67 read-model tests
(13 + 21 + 15 + 18). **Zero pre-existing failures at any point**, so any future
failure is attributable and must not be dismissed as pre-existing.

No snapshot was updated and no test was weakened. One expectation of mine was
wrong during chunk 4 — a settled primary trigger scores 78 (`high`), not
`very_high`, because `unresolved` contributes nothing to it. The arithmetic was
verified by hand and the *test* corrected, not the implementation.

---

## Architectural discoveries

**0. (chunk 5A) Two real findings the integration harness surfaced.**

*A world defect, reported not fixed.* Two `change_ledger` rows in the wholly
synthetic canonical world carry `data_environment = 'PRODUCTION'` —
`PARTNER_OVERRIDE` and `OVERRIDE_RECORDED`, on the **Globex hero pursuit the
demo's §2 beat turns on**. Cause: `recordChange()` defaults `dataEnvironment` to
`'PRODUCTION'` (`src/lib/pursuits/ledger.ts`) and the two override call sites
(`src/lib/routing/override.ts`, `src/lib/pursuits/overrides.ts`) omit it, so
those entries are not labelable as synthetic. **Left alone** — a seed-path change
two days before the demo is not worth it. Fix after Monday by passing
`dataEnvironment` at the two call sites.

*Pertinence task-fit ignores gap source.* `"No verified timing anchor"` ranks
second in missing-context (72) but `VALIDATE_TIMING` does not lift it, because
`TASK_FIT` matches relevance types and refTypes while a WHY_NOW gap's `refType`
is the generic `"pursuit"`. Relatedly, all same-kind gaps **tie** in pertinence:
a GAP's linkage comes from `gapKind` alone, so missing-context's carefully ranked
order (economic buyer 80, timing anchor 72) is discarded and the GENERAL top-5 is
five coverage gaps at 69. Chunk 4 was **not** redesigned — this is composition
work for 5B: pertinence should consume the gap's `rank` and `source`.

**1. The house four-state conclusion vocabulary.** Three domains already express
a four-way judgement separating verified / inferred / degraded / absent:
`ValueCaseState` (STRONG · INCOMPLETE · CONFLICTING · NOT_ESTABLISHED),
`CoverageState` (VERIFIED · INFERRED · UNVERIFIED · MISSING), and lifecycle dates
(VERIFIED_DATE · INFERRED_WINDOW · STALE_DATE · CONFLICTING_DATE). This is a
deliberate pattern. Chunks 1 and 3 adopt the same shape instead of inventing a
fourth and fifth. **Chunk 6 must preserve it in the UI** — rendering all four as
"missing" discards a distinction the product has maintained in three places.

**2. Pertinence and "why this pursuit" are different computations.** Ranking
*within* a pursuit for the decision at hand needs only pursuit-scoped inputs.
"Why this pursuit rather than another" needs cross-pursuit inputs that do not
belong in a pursuit-scoped slice. The former shipped; the latter is deferred to
Slice 3. See **D-017**. Chunk 6's "Why this matters" must not imply it answers
the portfolio question.

**3. Disclosure must filter before ranking, not penalise within it.** An
un-entitled item that merely scores lower still shifts the positions of visible
items around it, so its existence becomes inferable from the ordering — a leak by
arithmetic that a "the secret string is absent" test would not catch. See
**D-018**. Both ranking modules filter first and disclose only an aggregate count.

## Existing primitives reused — nothing re-implemented

| Primitive | Where | Used by |
|---|---|---|
| `factFreshness()`, predicate-specific policy | `src/lib/facts/freshness.ts` | context-health |
| `computeCompleteness()`, `COVERAGE_CATEGORIES` | `src/lib/intel/completeness.ts` | context-health |
| `bandOf()`, `Caller` | `read-models/helpers.ts` | context-health, pertinence |
| `Band`, `ScoreReason`, `TrustLabel`, `DisclosureClass` | `read-models/types.ts` | all four |
| `ELEMENTS`, `Meddpicc` | `src/lib/opportunities/meddpicc.ts` | missing-context |
| `StakeholderCoverage`, `CoverageState` | `src/lib/stakeholders/coverage.ts` | missing-context |
| `ValueCaseState` | `src/lib/value/case.ts` | missing-context |
| `WhyNowView` (`unknowns[]`, `contradictions[]`) | `read-models/types.ts` | missing-context |
| `change_ledger` column semantics | migration `0065` | memory |
| `pursuit_facts.relevance_type` | migrations `0066` + `0072` | context-health, pertinence |

## Discrepancies between the prior audit and the implementation

Two suspected schema/implementation disagreements were checked. **Neither is
real** — both were resolved by later migrations, and I verified rather than
reporting a false defect:

- `pursuit_facts.relevance_type` — `0066` allows four values, `deriveRelevance()`
  returns nine. **`0072` widens the constraint** to all nine.
- `change_ledger.change_type` — `FACT_LINKED_TO_PURSUIT` is absent from `0065`'s
  CHECK. **`0073`/`0079`/`0084` extend it.**

Both confirm that LOW-materiality linkage events genuinely exist in the ledger,
which is exactly the connective tissue `getPursuitTimeline` filters out and
Pursuit Memory retains. The Session 0 audit finding stands.

No other discrepancy was found. The Session 0 "what already exists" inventory was
accurate.

---

## Blockers

| # | Blocker | Impact | Unblock |
|---|---|---|---|
| B-1 | **Preview data access UNKNOWN** | Slice 1 is read-only, so unaffected. Blocks Slice 2+. | `ENVIRONMENT-MAP.md` §6 — one read-only Vercel API call |
| B-2 | **Live serving SHA unresolved** | Cannot certify any promotion | `/api/build` with `OPS_FINGERPRINT_TOKEN`, or the Vercel API |
| B-3 | Tag pushes refused (403) | Cosmetic — durable references exist | None needed |

Neither B-1 nor B-2 blocked chunks 1–4 or 5A, and neither blocks 5B (still no
writes). B-2 must be resolved before GATE E.

---

## DO NOT TOUCH

- `app.pursuitos.io` — production. Out of scope entirely.
- `demo.pursuitos.io` — Monday's demo.
- Branch `claude/activateos-platform-review-xzkgmd` — **the Vercel production
  branch.** Never push to it, never merge into it, without an explicit
  instruction naming that action. Green tests are not approval.
- Any Vercel environment variable, deployment, alias, domain, or build setting.
- Any Supabase role, grant, RLS policy, schema object, migration, or credential.
- The hosted demo database (`qifatlqxfuhwrwvpbwsc`). No writes, no reseed.
- DNS, secrets, `main`.
- Disclosure/grant layer, governed-action semantics, append-only ledgers
  (`change_ledger`, `governed_action_invocations`, `pursuit_overrides`),
  recommendation-vs-decision semantics, `externalSendingArmed()`.

---

## Exact next action

**Nothing. Chunks 1–4 are complete and this session STOPPED by instruction.**

Chunk 5 must not begin without explicit approval, because it is the first change
to what the demo shows and it lands on the itinerary's §2 hero screen.

When approved, chunk 5 is:

1. Write the SQL loaders for the four read-models — mechanical projections of
   `facts ⋈ pursuit_facts` and `change_ledger` onto the input types the modules
   already declare (D-016: a loader merges only with an integration test).
2. Switch `getFacts(db, r.account_id)` in `read-models/detail.ts` to pursuit-scope
   via `pursuit_facts`, ordered by relevance then freshness — **behind
   `VNEXT_CONTEXT_HEALTH_ENABLED`**, so flag OFF is byte-identical to today.
3. Add `scripts/vnext-context-verify.ts` (EITHER class) and register it in
   `scripts/verify-classes.ts`.

Requires a local synthetic database (`scripts/seed-demo-world.ts` against local
Postgres `pursuit_demo`). **Still no writes to any hosted database.**

---

## Run these first in the next session

```sh
cd /home/user/ActivateOS

# 1. Confirm the lane and that nothing drifted.
git fetch --all --tags
git checkout roadmap/pursuitos-vnext
git log --oneline -7                      # expect docs, 0f86079, a13c2fa, 77f72ef, ac572ba, b6b7b33, d1e5685
git status --porcelain                    # expect clean
git rev-parse origin/claude/activateos-platform-review-xzkgmd   # expect 97e975f0…  (unchanged)

# 2. Read the durable memory. Start here, not with the code.
cat docs/vnext/SESSION-HANDOFF.md
cat docs/vnext/STATUS.md
cat docs/vnext/DECISIONS.md               # D-016/017/018 explain the chunk 1–4 shape
sed -n '/^# AS-BUILT/,$p' docs/vnext/SLICE-1-LIVING-PURSUIT-CONTEXT.md

# 3. Re-establish the baseline before changing anything.
npm install
npx tsc --noEmit                          # expect exit 0
npm test                                  # expect 220/220

# 4. Re-establish the local synthetic DB before touching the loaders
#    (see "Local synthetic database" above — pgvector is required).
#    Then: npx tsx scripts/vnext-context-verify.ts   # expect 42/42
npm run build                             # expect exit 0
```

### Container-loss notes

This is a cloud sandbox and may disappear at any time.

- `node_modules` is **not** committed — `npm install` is always step one.
- The container may be **re-cloned mid-session** onto a stale branch. Always
  `git fetch --all --tags` and verify SHAs against `git ls-remote` rather than
  trusting the local checkout. This has already happened twice in this project.
- A local-only tag (`demo-safe-2026-09-12`) will be gone. Use
  `backup/2026-09-04/tds-live-demo` or the SHA `97e975f0`.
- Anything not pushed is lost. Commit and push early.

### Before you stop, next session

1. Update **this file**: date, branch, commit, files changed, tests run,
   completed work, in-progress work, exact next action, blockers.
2. Update `STATUS.md` for every capability you touched.
3. Append to `DECISIONS.md` any durable decision you made.
4. Append to the **AS-BUILT** section of `SLICE-1-LIVING-PURSUIT-CONTEXT.md` if
   the implementation diverged from the plan.
5. Commit and push.
