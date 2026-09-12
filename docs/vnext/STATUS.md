# PursuitOS vNext — Status

**Last updated:** 2026-09-12T07:55Z
**Lane:** `roadmap/pursuitos-vnext` @ `620bc12` (Slice 1 chunks 1–5A, 5B-1, 5B-2 complete)

States: `NOT STARTED` · `BUILDING` · `PREVIEW READY` · `DEMO CERTIFIED` · `BLOCKED`

---

## Foundation

| Item | Status | Branch / commit | Updated | What remains | Known risks |
|---|---|---|---|---|---|
| vNext branch | **DEMO CERTIFIED** (n/a — infrastructure) | `roadmap/pursuitos-vnext` from `97e975f0` | 2026-09-12 | — | — |
| Known-good demo reference | **DEMO CERTIFIED** | `backup/2026-09-04/tds-live-demo` → `97e975f0` (on origin) | 2026-09-12 | — | Local tag `demo-safe-2026-09-12` was created at the same commit but its **push was refused (HTTP 403)** — this remote rejects tag pushes. The already-pushed `backup/…/tds-live-demo` tag plus the SHA recorded throughout these docs are the durable references. |
| Durable agent memory | **DEMO CERTIFIED** | `docs/vnext/*` | 2026-09-12 | Keep `SESSION-HANDOFF.md` current every session | Goes stale silently if a session forgets to update it |
| Feature-flag scaffolding | **PREVIEW READY** | `src/lib/env/vnext-flags.ts`, `tests/vnext-flags.test.ts` | 2026-09-12 | Nothing — no capability behind any flag yet | None. Default OFF, narrowing-only, 4/4 tests green |
| Preview environment | **BLOCKED** | — | 2026-09-12 | Verify what `DATABASE_URL` the Preview scope carries | **Preview may share the hosted demo database.** Classified UNKNOWN. No preview writes until resolved. `ENVIRONMENT-MAP.md` §6 |
| Live serving SHA | **BLOCKED** | — | 2026-09-12 | `/api/build` with `OPS_FINGERPRINT_TOKEN`, or Vercel API | Branch head is Wave 6D `97e975f0`; last observed serving SHA was Wave 3 `66f72f61`. Cannot certify a promotion against an unknown baseline |

---

## Roadmap capabilities

| Capability | Phase | Status | Branch / commit | Updated | What remains | Known risks |
|---|---|---|---|---|---|---|
| Canonical commercial foundation | P0 | **DEMO CERTIFIED** (pre-existing) | `97e975f0` | 2026-09-03 | — | Substantially already built: orgs, companies, products, sellers, partners, opportunities, motions, campaigns, entity resolution, aliases, provenance |
| Living Pursuit Context — **Vertical Slice 1** | P1 | **BUILDING** | `roadmap/pursuitos-vnext` @ `77f72ef` | 2026-09-12 | Chunks 1–4 (read-models), 5A (loaders + verifier), 5B-1 (gap semantics), 5B-2 (evidence composition) done. Chunk 6 remains: the narrative surface — the first rendered change | Chunk 5 is the first change to what the demo shows — see `SLICE-1-LIVING-PURSUIT-CONTEXT.md` §regression risk |
| · pursuit evidence (direct + supporting) | P1 | **BUILDING** | `620bc12` `read-models/pursuit-evidence.ts` | 2026-09-12 | Consumer (chunk 6) | 18 tests. **Supersedes the plan to swap `getFacts` to pursuit scope** — Globex has 1 linked fact, so the swap would have deleted the best evidence on the screen. See D-020 |
| · fact freshness | P1 | **DEMO CERTIFIED** (pre-existing) | `src/lib/facts/freshness.ts` | — | Compose at pursuit level | Exists per-fact; nothing composes per-pursuit |
| · research coverage | P1 | **DEMO CERTIFIED** (pre-existing) | `src/lib/intel/completeness.ts` | — | Compose at pursuit level | Account-scoped today |
| · context health (pursuit level) | P1 | **BUILDING** | `d1e5685` `read-models/context-health.ts` | 2026-09-12 | Consumer (chunk 5B) | Pure function, 13 tests. Composes `factFreshness` + `computeCompleteness`; re-implements neither |
| · pursuit state | P1 | **DEMO CERTIFIED** (pre-existing) | `src/lib/pursuits/lifecycle.ts`, `src/lib/lifecycle/state.ts` | — | Surface as "current state" narrative | — |
| · pursuit memory | P1 | **BUILDING** | `b6b7b33` `read-models/memory.ts` | 2026-09-12 | Consumer (chunk 5B) | Pure function, 21 tests. Business-time ordering, no materiality filter, ledger never mutated |
| · what's missing (ranked) | P1 | **BUILDING** | `ac572ba` `read-models/missing-context.ts` | 2026-09-12 | Consumer (chunk 5B) | Pure function, 15 tests. Composes the 4 existing gap computations; adds no fifth |
| · pertinence (pursuit + decision scoped) | P2 | **BUILDING** | `1b05b8a` `read-models/pertinence.ts` | 2026-09-12 | Consumer (chunk 5B-2) | 18 + 13 tests. Pursuit-scoped, not portfolio-scoped (D-017). Consumes upstream gap rank/source (D-019) |
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

| Check | Session 0 | 1–4 | 5A | 5B-1 | 5B-2 |
|---|---|---|---|---|---|
| `npx tsc --noEmit` | exit 0 | exit 0 | exit 0 | exit 0 | **exit 0** |
| `npm test` | 149 / 0 | 220 / 0 | 220 / 0 | 233 / 0 | **251 pass / 0 fail** |
| `npm run build` | exit 0 | exit 0 | exit 0 | exit 0 | **exit 0** |
| `vnext-context` verifier | — | — | 42 / 0 | 47 / 0 | **55 passed / 0 failed** |
| SEEDED spot-check | — | — | green | green | **interpret 255 · lifecycle-query 80 · value-case 126 · stakeholder-intel 43** |

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
