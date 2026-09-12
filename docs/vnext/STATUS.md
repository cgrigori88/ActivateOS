# PursuitOS vNext — Status

**Last updated:** 2026-09-12T14:30Z
**Lane:** `roadmap/pursuitos-vnext` @ `c4f4196` — Slice 1 **PRODUCT SIGNED OFF / PREVIEW READY**. The 2026-09-12 preview-isolation session **stopped by design**: no credential exists here to verify or establish safe isolation, so no preview was created. See `PREVIEW-ISOLATION-PLAN.md`.

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
| vNext isolated preview | **NOT STARTED** (blocked upstream) | — | 2026-09-12 | Owner resolves preview data safety, then `PREVIEW-ISOLATION-PLAN.md` Objective C Option 2 (5 steps, 4 of them existing tooling) | Nothing built. Objective F fired: do not create a preview against unknown/shared writable data |

---

## Roadmap capabilities

| Capability | Phase | Status | Branch / commit | Updated | What remains | Known risks |
|---|---|---|---|---|---|---|
| Canonical commercial foundation | P0 | **DEMO CERTIFIED** (pre-existing) | `97e975f0` | 2026-09-03 | — | Substantially already built: orgs, companies, products, sellers, partners, opportunities, motions, campaigns, entity resolution, aliases, provenance |
| Living Pursuit Context — **Vertical Slice 1** | P1 | **PREVIEW READY** — product signed off | `roadmap/pursuitos-vnext` @ `c4f4196` | 2026-09-12 | Nothing in the slice. Next state is DEMO CERTIFIED, which is a separate owner decision (`DEMO-PROMOTION-GATE.md`) | Read-only, flag-gated, flag OFF verified identical panel-for-panel. Cannot be reviewed on a hosted preview until preview isolation is resolved |
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
| Next Move / coordination | P3 | **NOT STARTED** | — | 2026-09-12 | Slice 2 | Depends on Slice 1 |
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
| Task #67 outstanding | `audit/TASK-67-RLS-RUNTIME-CUTOVER-PLAN.md`. RLS fully built, fully inert on the app path. Not a vNext dependency, but it is the highest-value hardening item. |
| ~~GATE C findings N-1 … N-6~~ | **N-1, N-2, N-4 and N-6 RESOLVED** in `1ed0105` + `6c5b7a9`. N-5 is explained rather than fixed (see R-1). N-3 stands as a *review-coverage* note, not a product defect: every evidence row on the Globex pursuit is VERIFIED, so the five-state vocabulary is only observable in Needs attention — review a thinner pursuit to see it. New residuals R-1…R-3 are cosmetic and recorded in `GATE-C-PRODUCT-REVIEW.md` § GATE C REFINEMENT. |
