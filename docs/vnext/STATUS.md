# PursuitOS vNext — Status

**Last updated:** 2026-09-12T04:05Z
**Lane:** `roadmap/pursuitos-vnext` @ `77f72ef` (Slice 1 chunks 1–4 complete)

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
| Living Pursuit Context — **Vertical Slice 1** | P1 | **BUILDING** | `roadmap/pursuitos-vnext` @ `77f72ef` | 2026-09-12 | Chunks 1–4 done (read-models). Chunks 5–8 remain: pursuit-scoped facts, narrative surface, integration verifier, regression evidence | Chunk 5 is the first change to what the demo shows — see `SLICE-1-LIVING-PURSUIT-CONTEXT.md` §regression risk |
| · pursuit-scoped facts on detail | P1 | **NOT STARTED** | — | 2026-09-12 | Switch `getFacts` from account-scope to `facts/pursuit-link.ts` | Changes what the Facts panel shows in the demo — flag-gated |
| · fact freshness | P1 | **DEMO CERTIFIED** (pre-existing) | `src/lib/facts/freshness.ts` | — | Compose at pursuit level | Exists per-fact; nothing composes per-pursuit |
| · research coverage | P1 | **DEMO CERTIFIED** (pre-existing) | `src/lib/intel/completeness.ts` | — | Compose at pursuit level | Account-scoped today |
| · context health (pursuit level) | P1 | **BUILDING** | `d1e5685` `read-models/context-health.ts` | 2026-09-12 | SQL loader (chunk 5) | Pure function, 13 tests. Composes `factFreshness` + `computeCompleteness`; re-implements neither |
| · pursuit state | P1 | **DEMO CERTIFIED** (pre-existing) | `src/lib/pursuits/lifecycle.ts`, `src/lib/lifecycle/state.ts` | — | Surface as "current state" narrative | — |
| · pursuit memory | P1 | **BUILDING** | `b6b7b33` `read-models/memory.ts` | 2026-09-12 | SQL loader (chunk 5) | Pure function, 21 tests. Business-time ordering, no materiality filter, ledger never mutated |
| · what's missing (ranked) | P1 | **BUILDING** | `ac572ba` `read-models/missing-context.ts` | 2026-09-12 | SQL loader (chunk 5) | Pure function, 15 tests. Composes the 4 existing gap computations; adds no fifth |
| · pertinence (pursuit + decision scoped) | P2 | **BUILDING** | `77f72ef` `read-models/pertinence.ts` | 2026-09-12 | SQL loader (chunk 5) | Pure function, 18 tests. **Pursuit-scoped, not portfolio-scoped** — see D-017 |
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

| Check | Session 0 baseline | After Slice 1 chunks 1–4 |
|---|---|---|
| `npx tsc --noEmit` | exit 0 | **exit 0** |
| `npm test` | 149 pass / 0 fail | **220 pass / 0 fail** |
| `npm run build` | exit 0 | **exit 0** |

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
| Task #67 outstanding | `audit/TASK-67-RLS-RUNTIME-CUTOVER-PLAN.md`. RLS fully built, fully inert on the app path. Not a vNext dependency, but it is the highest-value hardening item. |
