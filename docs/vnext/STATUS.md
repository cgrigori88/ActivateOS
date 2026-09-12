# PursuitOS vNext — Status

**Last updated:** 2026-09-12T02:47Z
**Lane:** `roadmap/pursuitos-vnext` @ `4bc27a4` (pushed to origin)

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
| Living Pursuit Context — **Vertical Slice 1** | P1 | **NOT STARTED** | — | 2026-09-12 | Full plan written; awaiting explicit approval to build | See `SLICE-1-LIVING-PURSUIT-CONTEXT.md` §regression risk |
| · pursuit-scoped facts on detail | P1 | **NOT STARTED** | — | 2026-09-12 | Switch `getFacts` from account-scope to `facts/pursuit-link.ts` | Changes what the Facts panel shows in the demo — flag-gated |
| · fact freshness | P1 | **DEMO CERTIFIED** (pre-existing) | `src/lib/facts/freshness.ts` | — | Compose at pursuit level | Exists per-fact; nothing composes per-pursuit |
| · research coverage | P1 | **DEMO CERTIFIED** (pre-existing) | `src/lib/intel/completeness.ts` | — | Compose at pursuit level | Account-scoped today |
| · context health (pursuit level) | P1 | **NOT STARTED** | — | 2026-09-12 | New composition over the two above | Must not re-implement either |
| · pursuit state | P1 | **DEMO CERTIFIED** (pre-existing) | `src/lib/pursuits/lifecycle.ts`, `src/lib/lifecycle/state.ts` | — | Surface as "current state" narrative | — |
| · pursuit memory | P1 | **NOT STARTED** | — | 2026-09-12 | New read-model: business time, unfiltered | `getPursuitTimeline` currently orders by `recorded_at` and filters by materiality — memory needs neither |
| · why this / why now / what's missing | P1/P2 | **BUILDING** (partial, pre-existing) | `getPursuitWhyNow` | — | "Why this pursuit" absent; "what's missing" scattered across 4 computations | `WhyNowView.unknowns[]` already ships an embryonic version |
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

## Validation baseline (established Session 0, before any change)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **exit 0** — clean |
| `npm test` | **149/149 pass**, 0 fail |
| `npm run build` | **exit 0** — succeeds |
| `tests/vnext-flags.test.ts` (new) | **4/4 pass** |

**Zero pre-existing failures.** Any future failure is therefore attributable and
must not be dismissed as pre-existing.

Not run in Session 0 (require a database; no roadmap code was written that could
affect them): the 33 verifier suites. Run them before GATE B.

---

## Open documentation debt

| Item | Note |
|---|---|
| `.env.example` incomplete | Missing `PURSUITOS_ENV`, `OPS_FINGERPRINT_TOKEN`, `DATABASE_URL_OWNER`, `BASIC_AUTH_*`, and the shipped feature-flag variables. The vNext block was added in Session 0; the rest was deliberately left to keep the diff reviewable. |
| `audit/DEMO-ITINERARY.md` ambiguity | Says the demo runs "under `app_rw` + FORCE RLS". True of the **local** demo; **not** true of hosted `demo.pursuitos.io`, which runs as `postgres`/`BYPASSRLS`. Not wrong, but reads as a stronger claim about the hosted demo than the evidence supports. Recorded in `ENVIRONMENT-MAP.md` §4. |
| Task #67 outstanding | `audit/TASK-67-RLS-RUNTIME-CUTOVER-PLAN.md`. RLS fully built, fully inert on the app path. Not a vNext dependency, but it is the highest-value hardening item. |
