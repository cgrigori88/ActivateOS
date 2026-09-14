# PursuitOS vNext — Session Handoff

> **Read this file first.** It is written so a brand-new Claude Code Web session can
> resume with no prior chat context. **Every work session must update it before
> stopping.**

---

## Where things stand

| | |
|---|---|
| **Date/time** | 2026-09-14T02:59Z (Sunday evening local; the demo is Monday) |
| **Repository** | `cgrigori88/ActivateOS` — this session ran **locally on the owner's Mac** at `/Users/cgrigori/Documents/ActivateOS/pursuitos-vnext`, not in Claude Code Web (B-4) |
| **Current branch** | `roadmap/pursuitos-vnext` |
| **Current commit** | `5ee1dfe` + this session's docs commit on top |
| **Known-good demo commit** | **`97e975f0d9895c54bfc49cdcc24924d6ac58e796`** (Wave 6D) |
| **Session completed** | **VNEXT DATABASE INITIALIZATION, attempt 3 (local) — COMPLETED.** With the owner's fresh credential the gate passed (ref `mejokqxriwyawfhawuxu`, not the demo, authenticated). Then: 102 migrations applied → marked `demo` / `is_synthetic=true` → read back → canonical world seeded (10/10 layers, `verify()` 17/17) → **reconciled exactly**, manifest digest `be0da833990ce436` = certified. No product code, no Vercel, no flags. Slice 1 untouched. |
| **Preview URL** | **UNVERIFIED** — unchanged |
| **Preview data safety** | **UNKNOWN** — unchanged. No Vercel scope was touched |
| **vNext isolated database** | **READY FOR VERCEL PREVIEW.** Ref `mejokqxriwyawfhawuxu`: migrated 102/102, `environment_identity` = `demo` / `is_synthetic=true` / "pursuitos-vnext — isolated synthetic preview", canonical world seeded and reconciled, zero messages of any kind (`ENVIRONMENT-MAP.md` §10) |
| **Live serving SHA** | **UNRESOLVED** — all seven unauthenticated avenues exhausted and recorded (`ENVIRONMENT-MAP.md` §9) |

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
| 5A | `0f86079` | feat(vnext): connect living pursuit context loaders |
| — | `9744335`, `20ee049` | docs(vnext): chunk 5A record + handoff correction |
| 5B-1 | `1b05b8a` | fix(vnext): preserve gap semantics in pursuit pertinence |
| — | `494d166` | docs(vnext): chunk 5B-1 record + D-019 |
| 5B-2 | `620bc12` | feat(vnext): compose pursuit evidence context |
| — | `b3abac9` | docs(vnext): chunk 5B-2 record + D-020 |
| 6A | `ed3416c` | feat(vnext): add composed pursuit brief (unrendered) |
| 6B | `99bd5dd` | feat(vnext): gate pursuit brief on pursuit detail |
| — | `e0365d4` | docs(vnext): record the first rendered vNext surface |
| GATE C | `a4a3314` | docs(vnext): GATE C product review package |
| — | `284c4dc` | docs(vnext): always deliver review screenshots in-conversation |
| refine | `1ed0105` | fix(vnext): restore complete pursuit history access |
| refine | `6c5b7a9` | refactor(vnext): refine pursuit context experience |
| — | `c4f4196` | docs(vnext): record the GATE C refinement |
| preview | `714433b` | docs(vnext): plan isolated vNext preview, record blockers as exhausted |
| vNext DB #1 | `072bd56` | docs(vnext): record the isolated vNext target and its egress blocker |
| vNext DB #2 | `5ee1dfe` | docs(vnext): record the vNext target credential blocker |
| **vNext DB #3** | **(this session)** | **docs(vnext): record the initialized isolated vNext database** — documentation only; the database work itself leaves no commit |

## Chunks 6A + 6B files

| File | Change |
|---|---|
| `src/lib/pursuits/read-models/pursuit-context.ts` | **new** — the composed narrative view-model |
| `src/components/pursuit/context-narrative.tsx` | **new** — `PursuitContextNarrative` |
| `src/app/pursuits/[id]/page.tsx` | flag-gated three-for-one swap; context loaded only when armed |
| `tests/vnext-pursuit-context.test.ts` | **new** — 20 tests |

**Renamed to avoid a collision:** `read-models/brief.ts` already owns
`PursuitBrief` (the exportable document behind the Brief button on the same
page). The new surface is Pursuit **Context** in code.

**Visible surface count: 11 → 9.** "Why now", "Facts behind this" and "What
changed" all disappear; one "This pursuit" panel replaces them. `#whynow`,
`#evidence` and `#activity` all still resolve — they are deep-linked from six
call sites.

**Flag-OFF regression proven by render:** the pre-6B and post-6B commits produce
**byte-identical bodies (231,410)** with the flag off. Only per-build Turbopack
chunk filenames differ. Flag-off also issues no extra queries.

**The Globex nuance was strengthened after seeing it render.** 6A attached the
timing caveat to the top gap; on real data the economic-buyer gap outranks
timing, so it stayed silent. It is now section-level and reads "Customer-declared
timing exists on the account — not yet confirmed for this pursuit". This became
`ACCEPTANCE.md` U-15.

## Chunk 5B-2 files

| File | Change |
|---|---|
| `src/lib/pursuits/read-models/pursuit-evidence.ts` | **new** — direct vs supporting evidence composition |
| `src/lib/pursuits/read-models/context-loaders.ts` | `loadPursuitEvidence` / `loadPursuitEvidenceInput`, reusing `deriveRelevance()` |
| `src/lib/pursuits/read-models/pertinence.ts` | `relevanceInferred` on the candidate — wording only, no score change |
| `scripts/vnext-context-verify.ts` | 8 new assertions + the evidence report |
| `tests/vnext-pursuit-evidence.test.ts` | **new** — 18 tests |

**The original 5B-2 plan is superseded, and the reasoning is preserved** in the
Slice 1 AS-BUILT section. The swap to pursuit-scoped facts would have deleted
the best evidence on the screen: Globex has 7 account facts, 1 linked, and the
6 unlinked include the `renewal_date` that answers the pursuit's own
second-ranked gap. See **D-020**.

**Seeded Globex result:** 1 direct (`strategic_initiative`, SOLUTION_FIT) and
6 supporting, led by `renewal_date` at 67 as an inferred TIMING_ANCHOR. All 7
account facts accounted for exactly once; 0 rejected, 0 withheld, 0 below band.

**UI recommendation from the real data: `DIRECT_PLUS_SUPPORTING`.** Direct-only
would leave a single `strategic_initiative` fact with no timing and no economics
— materially weaker than today's account-scoped panel.

## Chunk 5B-1 files

| File | Change |
|---|---|
| `src/lib/pursuits/read-models/pertinence.ts` | `gapRank` / `gapSource` / `whyItMatters` on the candidate; GAP linkage uses the upstream rank; `TASK_FIT` matches `GapSource` |
| `src/lib/pursuits/read-models/context-loaders.ts` | carries `rank`, `source`, `whyItMatters` from `ContextGap` |
| `scripts/vnext-context-verify.ts` | 5 new assertions + all six task contexts reported |
| `tests/vnext-gap-pertinence.test.ts` | **new** — 13 tests |

**Semantic fields preserved:** `gapRank` (upstream importance), `gapSource`
(producing domain), `whyItMatters` (upstream explanation), `gapKind` (four-state).

**Ranking design:** substitution, not addition. Upstream rank
(`KIND_WEIGHT + SOURCE_WEIGHT + blocking`) **replaces** `LINKAGE_BY_GAP[kind]` at
the same 0.30 linkage weight, because both encode the same question at different
resolutions. Nothing is summed on top, so gap kind is never counted twice —
pinned by a test asserting two gaps with equal rank but different kind score
identically. Normalised against the fixed 0..100 scale, never against the other
candidates, so no score depends on its neighbours (which would break D-018).

**Disclosure invariance evidence:** two tests add a *top-ranked* inaccessible gap
(rank 100 / rank 95) to a guest's candidate set and assert the visible items,
scores and order are byte-identical to the set without it — once under GENERAL,
once under a task that would have boosted it. The verifier re-proves it against
the real world by comparing a guest ranking to an independently ranked
guest-visible subset.

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

| Check | Session 0 | 1–4 | 5A | 5B-1 | 5B-2 | 6A+6B |
|---|---|---|---|---|---|---|
| `npx tsc --noEmit` | exit 0 | exit 0 | exit 0 | exit 0 | exit 0 | **exit 0** |
| `npm test` | 149 / 0 | 220 / 0 | 220 / 0 | 233 / 0 | 251 / 0 | **271 pass / 0 fail** |
| `npm run build` | exit 0 | exit 0 | exit 0 | exit 0 | exit 0 | **exit 0** |
| `vnext-context` verifier | — | — | 42 / 0 | 47 / 0 | 55 / 0 | **55 passed / 0 failed** |
| SEEDED spot-check | — | — | green | green | green | **interpret 255 · lifecycle-query 80 · value-case 126 · stakeholder-intel 43** |

### Chunk 5B-1 measured effect (Globex pursuit, local synthetic world)

| | before | after |
|---|---|---|
| GENERAL top 5 | five coverage gaps tied at 69 | economic buyer 69 · timing anchor 67 · decision process 62 · paper process 62 · value driver 60 |
| task contexts that reorder | 4 of 6 | **6 of 6** |
| VALIDATE_TIMING leader | "No economic buyer identified" (69) | **"No verified timing anchor" (79)** |

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
| B-4 | ~~**No Postgres egress from Claude Code Web**~~ — **CLEARED 2026-09-14T02:44Z** for this work, by running locally. Still true *of Claude Code Web*: do not attempt hosted-database work from there | — | Run the §10 sequence locally, as this session did |
| B-5 | ~~**The `DEMO_TARGET_URL` credential is rejected by `mejokqxriwyawfhawuxu`**~~ — **CLEARED 2026-09-14T02:59Z.** The owner supplied a fresh credential; it authenticated (after one transient `28P01` on the very first probe) and the database was initialized | — | Done |

Neither B-1 nor B-2 blocked chunks 1–4 or 5A, and neither blocks 5B (still no
writes). B-2 must be resolved before GATE E. **With B-5 cleared, B-1 is now the
blocker that matters: the isolated database exists, but the Vercel Preview scope
has not been pointed at it, and what it points at today is still UNKNOWN.**

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

## STANDING INSTRUCTION — deliver review screenshots in-conversation

For **every** review/gate phase (GATE C and any later gate, promotion
certification, or visual review), do not merely commit the screenshots and cite
their paths. **Send the image files into the conversation** so the reviewer can
see them without leaving the session. Committing them as well is correct — the
repo is the archive, the conversation is the review surface.

Practical constraints learned on 2026-09-12:

- The file uploader **rejects very tall images with HTTP 400.** A 2×
  full-page mobile capture (780×15,740) fails; the 2× desktop full pages
  (2880×7,654) succeed. When a capture is rejected, re-render the same state at
  `deviceScaleFactor: 1` (or crop to the changed region) for delivery, keep the
  2× version in the repo, and say plainly which is which.
- Verify the re-render is the same state before sending — compare page bytes and
  `document.documentElement.scrollHeight` against the committed capture.
- Lead with the element-scoped capture of the surface under review; send the
  full-page pairs after it, and caption each with what to look at.

## GATE C review package (2026-09-12, docs only)

`docs/vnext/GATE-C-PRODUCT-REVIEW.md` — flag OFF vs flag ON on the seeded Globex
pursuit, measured from the rendered DOM. Screenshots: `docs/vnext/review/gate-c/`
(`desktop-off`, `desktop-on`, `mobile-off`, `mobile-on`, `desktop-on-full-context`).

**Zero product-code change.** `tsc` 0 · `npm test` 271/0 · `build` 0 ·
verifier 55/0 · flag-OFF 235,042 bytes and flag-ON 217,010 bytes, both identical
to the 6B session.

### Six findings — none fixed, per instruction

| # | Finding | Severity |
|---|---|---|
| **N-1** | **`Earlier history (7 more)` reveals NO events** — only "…continues below in the activity record", and that record was one of the three panels this surface replaced. **7 of 10 `change_ledger` rows are unreachable with the flag on, including `PARTNER_OVERRIDE` / `OVERRIDE_RECORDED` (the demo's §2 beat), `ROUTE_RECOMMENDATION_CHANGED` and `PURSUIT_CREATED`.** Verified by opening every `<details>` and probing text: "Route override", "partner override", "Partner-led", "Pursuit detected", "Recommended route" are all absent flag-ON and present flag-OFF. The override *decision* survives in the Route decision panel; the *chronology* does not. | **Promotion blocker** |
| **N-6** | The merge makes the left column 1,068px against a 475px neighbour → **593px void** beside the new panel just below the fold (48px imbalance before). "Outcome & attribution" is orphaned. This is why the desktop page did not get shorter (3,827 → 3,855px). | High — composition |
| N-2 | "3 more items of supporting context available." and "10 other unresolved items." are plain text — no link, no disclosure. | Medium |
| N-3 | All four evidence rows on this pursuit read `Verified`, so the five-state vocabulary is not observable on evidence rows here. Review a thinner pursuit too. | Medium — review coverage |
| N-4 | Pre-existing copy defects now in the panel's first three lines: "1 independent families" (`read-models/detail.ts:95`) and a semicolon-joined route fragment. Present in **both** states — not a slice regression. | Low |
| N-5 | Desktop page not shorter (+28px). Mobile −8.9%. | Informational |

Also corrected: the 6B mobile screenshots were **viewport-only** (`fullPage` was
set for desktop only), so they showed the hero, not the changed surface — which
is why both were byte-identical at 334,356 bytes. The GATE C captures use
`fullPage` at both widths. The 6B *overflow* claim is unaffected; it was measured
from `document.documentElement.scrollWidth`, not from the image.

Also confirmed: `#whynow` → `y` 532, `#evidence` → 745, `#activity` → 1,086 —
all three land on the right movement, so U-13 holds structurally. N-1 is about
the **content** the anchor promised, not the anchor.

## GATE C refinement (2026-09-12) — what changed

Two commits, deliberately split: **`1ed0105`** correctness, **`6c5b7a9`**
experience. Full measured record in `GATE-C-PRODUCT-REVIEW.md`
§ "GATE C REFINEMENT".

| # | Objective | Outcome |
|---|---|---|
| 1 | Earlier History blocker | **FIXED.** `whatChanged.earlier` carries the remaining memory entries and the disclosure renders them. Globex: **10 of 10** ledger rows reachable, override chronology included. `hiddenCount` is now *defined* as `earlier.length`, so count and content cannot drift again. |
| 2 | Desktop composition | **FIXED.** Surface spans both columns: 538×1,068 → **1,092×792**. Void beside it **593px → 0**; total desktop void 785px → 283px. Value case + Outcome & attribution now pair (`lg:order-3`), which also fixed the 6B orphan. |
| 3 | Title + deterministic copy | **DONE.** "This pursuit" → **"What matters now"**. Copy translated in the view-model from canonical *structure*, not prose. See **D-022**. |
| 4 | Supporting-evidence state language | **DONE.** Account rows read **"Verified on account"**; direct rows keep "Verified". Underlying state untouched, nothing written to `pursuit_facts`. Lifecycle block moved under the timing caveat and relabelled "Account lifecycle timing". |
| 5 | Needs attention | **DONE.** Still one primary by default; "10 other unresolved items." became a real disclosure carrying the ranked gaps, each with its own state chip. |

**Key code shapes now in place**

- `ContextChangeLine` = `{ id, changeType, text, meta, canonicalReason, at, materiality, byPerson }` — rendered words plus the ledger's own reason.
- `whatChanged.earlier` and `needsAttention.others` — the two lists that make the disclosures real.
- `stateLabelFor(state, origin)` — the only place a scope-qualified chip label is chosen.
- `changeCopy()` reads `afterState.role` / `assertion_state` and `beforeState.assertion_state`. When the payload is **withheld** (guest callers) it falls through to the canonical reason — a guest gets plainer copy, never an invented detail. Pinned by test.
- `PursuitContextNarrative` takes a `lifecycleSlot` node so the component owns placement while the route owns the data.

**Residual, all cosmetic** — R-1 "What changed" leaves its right half empty at
full width (keeping the chronology vertical is the right call, so this is a
composition question); R-2 283px void beside Value case (structural: an odd
number of half-width panels); R-3 mobile +50px, +0.7%, in exchange for two
working affordances. R-4 restates N-3: every evidence row on Globex is VERIFIED,
so the five-state vocabulary is only observable in Needs attention — **review a
thinner or staler pursuit to see it**.

## Preview isolation session (2026-09-12T14:30Z) — what happened

**No product code changed. No preview created. No hosted configuration touched.**
Documentation only, plus one accuracy correction to `STATUS.md`.

### Why it stopped

Every credential the two blockers need is absent here. Checked by variable
**name** only — no value was read, and none is recorded anywhere:

`VERCEL_TOKEN` · `VERCEL_API_TOKEN` · `VERCEL_OIDC_TOKEN` · `VERCEL_TEAM_ID` ·
`OPS_FINGERPRINT_TOKEN` · `SUPABASE_ACCESS_TOKEN` · `SUPABASE_SERVICE_ROLE_KEY` ·
`DATABASE_URL` · `BASIC_AUTH_*` — **all unset.** No Vercel CLI, no Supabase CLI,
no `~/.vercel` state. Only a GitHub token.

So Objective F fired: *do not create a preview connected to unknown or shared
writable data.* Nothing did.

### What was nevertheless established (new, verified)

| # | Finding | Why it matters |
|---|---|---|
| B-a | **`VERCEL_ENV` has no behavioural gate** — one hit in `src/`, in `buildInfo()`, reporting only | The app cannot tell Preview from Production at runtime |
| B-b | **`assertSyntheticDatabase` does not protect the demo DB** — it refuses only `is_synthetic=false`, and the demo DB is marked `is_synthetic=true`, so it **passes** | Its threat model is "operator reseeds production", not "preview writes to demo" |
| B-c | **22 files declare `"use server"`** | Real write paths; no read-only mode exists |
| B-d | **A Vercel build performs no DB access** — 47 routes compile `ƒ` (dynamic); the only prerendered route is `/icon.svg` | **Bounds the risk.** A preview nobody opens has touched nothing |
| B-e | **Zero deployment config in the repo** — no `vercel.json`, no `.vercelignore`, no `.github/` | Branch tracking and env scoping stay dashboard-only |

Together: the classification stays **UNKNOWN**, but if it turns out Preview
shares `DATABASE_URL`, **there is no application-layer mitigation.**

Seven avenues to the live serving SHA were attempted and all are closed —
`/api/build` 404 unauthenticated (3/3, verified), no deployment id in response
headers, `builtAt` server-only, Next build IDs random per build, CSS
fingerprinting already invalidated, GitHub MCP has no deployments endpoint, no
Vercel credential. Recorded in `ENVIRONMENT-MAP.md` §9 **so no future session
repeats the search.**

### Deliverables

- **`PREVIEW-ISOLATION-PLAN.md`** (new) — Objective C isolation design in the
  stated preference order (Option 2 recommended: 5 steps, 4 of them existing
  tooling, 1 additive Vercel env var), Objective D flag plan, Objective E
  continuous workflow, a 10-point validation checklist to run when isolation
  exists, and the one open question below.
- `ENVIRONMENT-MAP.md` §6 sharpened, new §9.
- `DEMO-PROMOTION-GATE.md` — GATE B and GATE C marked **PASSED**, with the
  caveat that **P-2 is still open**: the review happened on local synthetic
  renders, not on a hosted preview.

### One open question worth a dashboard glance

**Have Preview deployments already been built for `roadmap/pursuitos-vnext`?**
The branch took ~18 pushes this weekend. If the Vercel GitHub integration runs
with defaults, each produced a preview build against whatever `DATABASE_URL` the
Preview scope carries. Unverifiable from here. Bounded by B-d (a build touches
nothing), all `VNEXT_*` defaulting OFF, and Slice 1 being read-only — so the
plausible worst case is *reads* from an opened preview URL. One glance answers
it: **Vercel → `PursuitOS-demo` → Deployments, filter Preview.**

## vNext database initialization session (2026-09-14T02:16Z) — what happened

**No product code changed. No database was written to. No hosted configuration
was touched. The Monday demo project was never contacted.** Documentation only.

### What was asked, and how far it got

| Step | Outcome |
|---|---|
| Pre-flight — clean tree, HEAD/origin, read the four docs | **DONE.** Tree clean, `714433b`, 0 ahead / 0 behind `origin/roadmap/pursuitos-vnext`. Monday demo ref reconfirmed `qifatlqxfuhwrwvpbwsc` |
| `DEMO_TARGET_URL` presence check | **PRESENT.** Checked with `test -n` only. **The value was never read, printed, logged, or recorded anywhere** |
| Inspect `environment-identity.ts`, `seed-demo-world.ts`, `demo-db.ts`, `migrate.ts`, `demo-manifest.ts` | **DONE.** Exact invocations derived from the code — recorded in `ENVIRONMENT-MAP.md` §10 |
| **TARGET SAFETY GATE** | **PASSED on identity, FAILED on proof-of-marker.** Ref is `mejokqxriwyawfhawuxu` ≠ `qifatlqxfuhwrwvpbwsc`. But the database's own marker is **UNREADABLE** |
| Step 2 — mark synthetic | **NOT RUN.** The gate says: if identity cannot be proven, STOP |
| Step 3 — seed | **NOT RUN** |
| Steps 4-5 — verification | **NOT RUN** — nothing to verify |

### Why it stopped — proven, not inferred

This environment has **no Postgres egress at all**:

| Probe | Result |
|---|---|
| DNS `aws-0-ca-central-1.pooler.supabase.com` | resolves (`15.156.180.136`, `15.156.188.226`) |
| TCP **:5432** | TIMEOUT |
| TCP **:6543** | TIMEOUT |
| HTTPS `api.supabase.com` | `connect_rejected` — egress proxy, organization policy |

DNS resolving while both Postgres ports black-hole is a port policy, not a bad
credential — an auth failure returns a distinct error and none was ever reached.
**The credential was therefore never validated either way.** The network policy
is the environment's and was **not** worked around; two probes that would have
tunnelled around it were correctly denied and not retried.

### The finding worth carrying forward

**The canonical seed path has no HTTPS fallback.** `scripts/db-remote.ts` runs
SQL over the Supabase Management API "anywhere HTTPS works", but it executes
plain SQL files only and needs `SUPABASE_ACCESS_TOKEN` (unset here);
`scripts/generate-seed-sql.ts` emits only the knowledge-base ontology. The demo
world is built by ten TypeScript layer scripts calling application code over a
live `pg` pool. **Migrations could travel over HTTPS; the world cannot.** So the
vNext database must be initialized from a context with direct Postgres egress —
a laptop, a CI runner, or a cloud environment whose network policy permits 5432.

### And the trap that would have cost a session

`seed-demo-world.ts` orchestrates the layers by `execFileSync`, and the three
database variables are genuinely distinct: `demo-db.ts` reads `DEMO_TARGET_URL`,
the nine layer scripts read `DEMO_URL`, `verify()` reads `DEMO_URL ?? DATABASE_URL`.
Setting **only** `DEMO_TARGET_URL` would seed the hosted target at layer 1 and let
layers 2-10 silently fall back to `127.0.0.1:5433` — printing `ok` the whole way.
All three must name the same target. Recorded in `ENVIRONMENT-MAP.md` §10.

### Deliverables

- `ENVIRONMENT-MAP.md` — §3 row for the vNext isolated target, new **§10**
  (identity, egress evidence, the exact five-command sequence, the trap), risk #7.
- `STATUS.md` — new **vNext isolated database = BLOCKED** row.
- `PREVIEW-ISOLATION-PLAN.md` — Option 1 upgraded to PARTIALLY ANSWERED; the
  missing `migrate.ts` step added to Option 2.

## vNext database initialization, attempt 2 — LOCAL (2026-09-14T02:44Z)

**Run on the owner's Mac precisely because Claude Code Web has no Postgres
egress.** That worked. **No product code changed. No database was written to. No
hosted configuration was touched. The Monday demo project was never addressed.**

### What was asked, and how far it got

| Step | Outcome |
|---|---|
| Pre-flight — clean tree, branch, fetch, read the four docs | **DONE.** Clean, `roadmap/pursuitos-vnext` @ `072bd56`, 0 ahead / 0 behind origin. Both refs reconfirmed from the docs |
| `DEMO_TARGET_URL` presence check | **PRESENT.** Checked with a `-n` test only. **The value was never printed, logged, written to a file, or recorded anywhere** |
| Derive the required database variables **from the code, not the prompt** | **DONE — the docs' three are confirmed correct.** `migrate.ts` → `getPool()` → `DATABASE_URL`; `environment-identity.ts` → `getOwnerPool()`, which falls back to `getPool()` because `DATABASE_URL_OWNER` is unset, → `DATABASE_URL`; `demo-db.ts` → `DEMO_TARGET_URL`; the nine layer scripts → `DEMO_URL`; `seed-demo-world.ts` `verify()` and `demo-manifest.ts` → `DEMO_URL ?? DATABASE_URL`. So: **`DATABASE_URL`, `DEMO_TARGET_URL`, `DEMO_URL`** |
| **STEP 1 — connection + identity safety gate** | **PASSED on identity. FAILED on connection.** `scripts/environment-identity.ts` printed `target : project mejokqxriwyawfhawuxu` — the required ref, and **not** `qifatlqxfuhwrwvpbwsc` — then `CANNOT READ` |
| Steps 2-5 — migrate, mark synthetic, seed, reconcile | **NOT RUN.** The gate says: if identity cannot be proven, STOP without writing |

### Why it stopped — a credential, proven at three endpoints

| Probe (every one against `mejokqxriwyawfhawuxu`) | Result |
|---|---|
| Session pooler `:5432`, user `postgres.<ref>` | **`28P01` password authentication failed** |
| Transaction pooler `:6543`, user `postgres.<ref>` | **`28P01`** |
| Direct `db.<ref>.supabase.co:5432`, user `postgres` | **`28P01`** |

**This is a fact about the password, not about the network or the string.** All
three completed TCP and TLS and returned a *Postgres* error; the direct host does
not traverse Supavisor at all, so the pooled-username convention is not
implicated; and Supavisor answers `Tenant or user not found` for an unknown ref,
which it did not — the project resolved. The connection string's own structure
was cleared separately, **without reading it**: WHATWG `URL` and
`pg-connection-string` (the parser `pg` actually uses) agree on host, port, user
and database; the password round-trips byte-identically through both; and the
component lengths account for the whole string exactly, so nothing was truncated
at a `#` or `?`.

### What is now settled that was not before

- **Where this work runs is settled.** A laptop reaches the target fine. B-4 is
  a property of Claude Code Web, not of the task.
- **The three-variable trap was respected and is now confirmed from the code**,
  not from prior notes. Every command bound all three to the same value.
- **The gate is doing its job, twice over.** `environment-identity.ts --set`
  refuses an `unreadable` identity, and `assertSyntheticDatabase` refuses an
  unmarked or unreadable target. Neither was reached, because the read-only gate
  stopped first — which is the intended order.

### What was NOT done, deliberately

The demo project `qifatlqxfuhwrwvpbwsc` was **not contacted, queried, or
modified** — including not being queried to prove it was untouched. The proof is
by construction and is recorded below under *Monday demo zero-change*.

### Monday demo zero-change — the evidence

- Every command in this session bound `DATABASE_URL` / `DEMO_TARGET_URL` /
  `DEMO_URL` to one value, whose parsed identity is `postgres.mejokqxriwyawfhawuxu`
  @ `aws-0-ca-central-1.pooler.supabase.com`. The demo ref appears in **no**
  command, no variable, and no probe.
- The three raw probes named their host and user explicitly, all
  `mejokqxriwyawfhawuxu`. On Supabase the pooler hostname is regional and shared;
  **the project is selected by the ref in the username**, which was never the
  demo's.
- No `DATABASE_URL` was inherited: it was **unset** in this shell before the
  session, as were `DEMO_URL`, `DATABASE_URL_OWNER`, `DEMO_ADMIN_URL`,
  `DEMO_PGHOST`, `DEMO_PGPORT` and `DEMO_DB_NAME` — so no fallback existed
  either to the demo or to `127.0.0.1:5433`.
- **Zero writes were issued to any database.** The only statements executed were
  `select` in the identity read and `select current_user, current_database()` in
  the probe, and all of them failed at authentication before reaching a server-side
  query.
- No Vercel, Supabase dashboard, or DNS surface was touched.

### Send safety — verified by code and environment, nothing sent

- `externalSendingArmed()` (`src/lib/env/environment.ts:131`) returns
  `process.env.OUTREACH_AUTOSEND === "on"`, and **`OUTREACH_AUTOSEND` is unset**
  in this shell — so sending is disarmed by the invariant, not by convention.
- **`RESEND_API_KEY` is unset**, so `apiKey()` in `src/lib/comms/resend.ts`
  throws before any request is constructed; `send.ts:162` persists such a message
  as *failed* rather than sending it. **No real outreach provider credential is
  present, required, or used.**
- Nothing in this session executed a send path at all: the only code run was the
  read-only identity script and a raw `pg` probe.

## vNext database initialization, attempt 3 — LOCAL, COMPLETED (2026-09-14T02:59Z)

**The isolated vNext database is initialized, marked synthetic, seeded, and
reconciled exactly.** Run on the owner's Mac after the owner replaced
`DEMO_TARGET_URL` with a fresh credential. **No product code changed. No Vercel
surface touched. No feature flag changed. No deployment. No deferred defect
fixed. The Monday demo project was never addressed.**

| Step | Outcome |
|---|---|
| Pre-flight | Clean tree, `5ee1dfe`, 0 ahead / 0 behind origin; production branch still `97e975f0`. By name only: `DEMO_TARGET_URL` set; `DATABASE_URL`, `DEMO_URL`, `DATABASE_URL_OWNER`, `DEMO_ADMIN_URL`, `DEMO_PGHOST/PORT`, `DEMO_DB_NAME`, `OUTREACH_AUTOSEND`, `RESEND_API_KEY` unset. No `.env*` but `.env.example`; no local Postgres listener — so nothing to fall back to |
| **Gate** — ref / not-demo / auth | `postgres.mejokqxriwyawfhawuxu` @ the ca-central-1 session pooler; the demo ref appears nowhere in the string; **authenticated** (one transient `28P01` first — below) |
| Pre-write state | **Empty** — 0 `public` tables, no `schema_migrations`, no `environment_identity` |
| 1 · migrate | **102 applied, 0 already tracked**, exit 0 |
| 2 · mark | `environment="demo" is_synthetic=true label="pursuitos-vnext — isolated synthetic preview"` |
| 3 · read back | `demo` · `true` · established `2026-09-14T02:56:52Z` |
| 4 · seed | all three vars bound to the same target · **10/10 layers ok** · `verify()` **17/17** · "canonical demo world built and verified." · exit 0 |
| 5 · reconcile | **3 · 14 · 19 · 11 open · $8,040,000 · 14** (14/14 `DEMO`) — exact. Manifest digest **`be0da833990ce436`** = certified `audit/canonical-demo-world.json` |
| Final re-verify | project `mejokqxriwyawfhawuxu` · `demo` · `is_synthetic true` · sending unarmed |

### The transient `28P01`, and why it did not stop the session

The first raw probe failed `28P01`; the repository's own identity read, seconds
later with the same string, reached the database. **No write was issued while
the two disagreed.** The disagreement was resolved by evidence, not by retrying
until green: no `.env` redirect, no local listener, and `getPool()` passes
`DATABASE_URL` straight to `pg`, so both reads used the same string and host.
Then four consecutive raw probes and one through the app's TLS-verifying pool
all authenticated, as did every later command. The likely cause — the new
password not yet on every Supavisor node — is **unverified**, and recorded as
such in `ENVIRONMENT-MAP.md` §10.

### Send safety

`messages` 0 rows (0 outbound / queued / sent / with a provider id),
`email_events` 0, `sending_identities` 0. `OUTREACH_AUTOSEND` and
`RESEND_API_KEY` unset in the shell that ran every step, so
`externalSendingArmed()` is false and `apiKey()` throws before any request.

### Monday demo zero-change — by construction, not by contact

- Every command bound `DATABASE_URL` / `DEMO_TARGET_URL` / `DEMO_URL` to one
  value whose parsed user is `postgres.mejokqxriwyawfhawuxu`; on Supabase the
  pooler host is shared and **the project is selected by the ref in the
  username**. The demo ref occurs in no command, variable, or probe.
- No fallback existed: every other database variable was unset, no `.env` file
  supplies one, no local Postgres was listening.
- `qifatlqxfuhwrwvpbwsc` was **not contacted, queried, or modified** — including
  not to prove it was unchanged, per instruction.
- No Vercel, Supabase dashboard, DNS, or production-branch surface was touched.

### Secret handling

The value of `DEMO_TARGET_URL` was never printed, echoed, logged, persisted, or
documented. No `env`/`printenv`. Every command's output was piped through a
scratchpad filter that strips the URL and its password; **it never had to
redact anything.** No repository file contains it.

## Exact next action — the Vercel Preview wiring (NOT executed; owner-approved only)

`PREVIEW-ISOLATION-PLAN.md` Objective C Option 2 **step 5**. It is the first
change to hosted configuration in this whole effort, so it needs the owner's
explicit go-ahead.

1. **Read first (read-only, answers B-1 / §6):** Vercel → `PursuitOS-demo`
   (`prj_mMYSZIaIQPwkqRrhKPcV7HbhdpXc`) → Settings → Environment Variables →
   look at **which environments** the existing `DATABASE_URL` is scoped to.
   Do not reveal or edit its value.
2. **Add, don't edit:** a **new** `DATABASE_URL` entry, environment **Preview
   only**, Git branch **`roadmap/pursuitos-vnext`**, value = the isolated
   target's connection string (the one proven here), marked Sensitive. The
   existing Production (and any existing Preview) entry stays untouched.
3. On the same Preview + branch scope, the Objective D variables:
   `VNEXT_CONTEXT_HEALTH_ENABLED` · `VNEXT_PURSUIT_STATE_ENABLED` ·
   `VNEXT_PURSUIT_MEMORY_ENABLED` · `VNEXT_PURSUIT_INTELLIGENCE_ENABLED` = `1`;
   `PURSUITS_ENABLED` · `FACTS_ENABLED` · `ROUTING_ENABLED` ·
   `PURSUIT_EXPERIENCE_ENABLED` · `FEDERATION_ENABLED` = `1`;
   `PURSUITOS_ENV` = `demo`; `OPS_FINGERPRINT_TOKEN` set.
   **Leave `OUTREACH_AUTOSEND` and `RESEND_API_KEY` absent.** No Production-scope
   change of any kind.
4. Redeploy the `roadmap/pursuitos-vnext` head (env binds at build time), then
   run V-1…V-10 — above all **V-4**: `/api/build` must report
   `database.projectRef = mejokqxriwyawfhawuxu`, not `qifatlqxfuhwrwvpbwsc`.

Open consideration, not decided here: serverless functions on the **session**
pooler (`:5432`) hold connections per instance; Supabase generally steers
serverless to the transaction pooler (`:6543`). Watch for connection exhaustion
on the first preview.

## Superseded next action — database password reset (DONE 2026-09-14T02:59Z)

**Reset the database password on `mejokqxriwyawfhawuxu` and re-run the sequence.**
Nothing else about it is unknown — not the commands, not the variables, not where
to run them. Only the credential is wrong.

1. Supabase dashboard → project **`mejokqxriwyawfhawuxu`** → Settings → Database
   → **Reset database password**. If that project turns out to be a Supabase
   *branch*, take the branch's own credentials — a parent-project password would
   fail exactly like this.
2. Re-export `DEMO_TARGET_URL` with the new password in the shell that will run
   the work, **locally, not in Claude Code Web** (B-4).
3. Run `ENVIRONMENT-MAP.md` §10 from step 0, unchanged. Step 0 is the proof: it
   must print `environment` and `is_synthetic` instead of `CANNOT READ`. Do not
   run step 2 (`--set demo`) until it does.
4. Reconcile against the canonical facts: 3 orgs · 14 companies · 19
   opportunities · 11 open · $8,040,000 · 14 pursuits.

Then, and only then, `PREVIEW-ISOLATION-PLAN.md` Objective C Option 2 step 5 (the
one additive Vercel env var, `DATABASE_URL` scoped to **Preview only**, pointing
at the isolated target) and Objective D's flag plan. **An isolated database does
not by itself isolate Preview.**

Still open and unchanged: the live serving SHA (`ENVIRONMENT-MAP.md` §9) and the
Vercel Preview `DATABASE_URL` classification (§6). Until both are resolved, the
local synthetic render loop remains the review mechanism; it produced every
GATE C measurement.

## Superseded next action (kept for context)

**A decision, not code: product sign-off on the refined surface.** — *Done.
Slice 1 is signed off.*

Slice 1 is functionally complete and at PREVIEW READY behind
`VNEXT_PURSUIT_INTELLIGENCE_ENABLED`. Nothing is deployed and the demo is
untouched. Screenshots for the sign-off are in
`docs/vnext/review/gate-c-refined/` (same filenames and dimensions as
`gate-c/`, for direct comparison).

Monday is unaffected: the flag defaults OFF, and flag-OFF was verified
**panel-for-panel identical** to the pre-refinement page — 11 panels at the same
x/w/y/h, 3,827px desktop, 7,870px mobile, anchors at 532/1,071/2,767.

### The next step is a decision, not code

**GATE C — product review.** Look at the rendered surface and answer one
question: *is Pursuit Detail now simpler to read, or merely differently
arranged?* If it is only differently arranged, the slice has not landed
(`ACCEPTANCE.md` U-9, D-003).

Screenshots from this session (local synthetic, Globex pursuit, flag ON and OFF,
1440×1000 and 390×844) are in the session scratchpad. Regenerate with:

```sh
# seed + serve locally, then screenshot — see "Local synthetic database" above
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo \
PURSUITS_ENABLED=1 FACTS_ENABLED=1 ROUTING_ENABLED=1 PURSUIT_EXPERIENCE_ENABLED=1 \
FEDERATION_ENABLED=1 PURSUITOS_ENV=local VNEXT_PURSUIT_INTELLIGENCE_ENABLED=1 \
VNEXT_CONTEXT_HEALTH_ENABLED=1 VNEXT_PURSUIT_STATE_ENABLED=1 VNEXT_PURSUIT_MEMORY_ENABLED=1 \
npx next start -p 3106
```

### If GATE C passes — recommended chunk 7 scope

Three small corrections the rendered surface exposed, none of them new capability:

1. **The lifecycle/timing proximity.** `LifecycleBento` reads "Renewal verified
   … in 76d" directly beneath a narrative saying pursuit timing is unconfirmed.
   Both are true; the adjacency invites conflation. Smallest fix is a label
   clarifying the renewal is the *account's* lifecycle event.
2. **"Why this matters" appears twice** on the page with the flag on — as the
   narrative heading and as an inline label in `StakeholderPanel`. Rename one.
3. **`BUILD_VALUE_CASE` still does not lift economic facts** (they derive to
   `SUPPORTING_CONTEXT` with `refType` "fact"; matching on `family = 'economic'`
   would fix it). It did **not** harm the 6B experience — the economic facts
   surface anyway under account context — so it stays deferred.

### Do NOT do next

Next-best action, cross-pursuit prioritisation, Today/Pipeline changes, dynamic
surfaces, the synthetic PRODUCTION-lineage fix, or any deployment. Slice 2
begins only after GATE C.

---

## Run these first in the next session

```sh
# Locally: cd /Users/cgrigori/Documents/ActivateOS/pursuitos-vnext
# In Claude Code Web: cd /home/user/ActivateOS
# Hosted-database work must run LOCALLY — see B-4.

# 1. Confirm the lane and that nothing drifted.
git fetch --all --tags
git checkout roadmap/pursuitos-vnext
git log --oneline -11                     # newest: docs, 620bc12, 494d166, 1b05b8a, 20ee049, 9744335, 0f86079, a13c2fa, 77f72ef …
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
npm test                                  # expect 271/271

# 4. Re-establish the local synthetic DB before touching the loaders
#    (see "Local synthetic database" above — pgvector is required).
#    Then: npx tsx scripts/vnext-context-verify.ts   # expect 55/55
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
