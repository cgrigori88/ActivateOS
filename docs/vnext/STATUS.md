# PursuitOS vNext — Status

**Last updated:** 2026-09-14 (Vertical Slice 2A session)

**2026-09-14 — Vertical Slice 1 is DEMO CERTIFIED / FROZEN. Vertical Slice 2A (Pursuit Coordination — Goal → Plan → Motion → Action) is PREVIEW READY on the local synthetic path**, behind `VNEXT_PURSUIT_COORDINATION_ENABLED` (default OFF). Verified locally: `tsc` 0 · `npm test` 313/0 · build 0 · `vnext-coordination` 86/0 · `vnext-context` 62/0 · manifest digest `be0da833990ce436` unchanged · flag-OFF page byte-identical to the pre-slice build · "What matters now" byte-identical with the slice ON. **Not yet visible on the hosted Preview**: the isolated vNext database does not have migration 0103 or the plan layer, and the Preview scope does not arm the flag — both are owner-approved steps (`SESSION-HANDOFF.md` → exact next step). No hosted database, Vercel setting or deployment was touched.

**Lane:** `roadmap/pursuitos-vnext` @ `5ee1dfe` + docs — Slice 1 **PRODUCT SIGNED OFF / PREVIEW READY**, untouched. **2026-09-14T02:59Z: the isolated vNext database `mejokqxriwyawfhawuxu` is INITIALIZED** — 102 migrations, marked `demo` / `is_synthetic=true`, canonical world seeded and reconciled exactly (3 · 14 · 19 · 11 open · $8,040,000 · 14; manifest digest `be0da833990ce436` = certified). It is ready to be wired to the Vercel Preview scope; **nothing on Vercel has been touched.** History: before the owner's credential reset, the initialization had stopped at the target safety gate **twice, by design, for two different reasons**. First from Claude Code Web (no Postgres egress). Then from a laptop, which **resolved the egress blocker** — the project answers on all three endpoints — only to hit a **rejected credential**: `28P01 password authentication failed`, identically from the session pooler, the transaction pooler and the direct host. The target ref is confirmed `mejokqxriwyawfhawuxu` and confirmed **not** the Monday demo. **Nothing has been written to any database.** See `ENVIRONMENT-MAP.md` §10.

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
| **vNext isolated database** | **PREVIEW READY** (database only) — initialized, marked, seeded, reconciled | target ref `mejokqxriwyawfhawuxu` | 2026-09-14T02:59Z | Nothing in the database. Next is the Vercel wiring (row below) | Migrated **102/102** from empty. `environment_identity` = `demo` / `is_synthetic=true` / "pursuitos-vnext — isolated synthetic preview". Seed 10/10 layers, `verify()` 17/17. Reconciled **exactly**: 3 orgs · 14 companies · 19 opportunities · 11 open · $8,040,000 · 14 pursuits; manifest digest `be0da833990ce436` = certified. 0 messages. Identity **proven distinct** from `qifatlqxfuhwrwvpbwsc`. Still unverified: whether it is a Supabase branch or a standalone project. One transient `28P01` on the first probe, then consistent success — `ENVIRONMENT-MAP.md` §10 |
| vNext isolated preview | **NOT STARTED** — no longer blocked upstream; waits on one owner-approved Vercel action | — | 2026-09-14T02:59Z | `PREVIEW-ISOLATION-PLAN.md` Objective C Option 2 step 5: a Preview-scoped `DATABASE_URL` for branch `roadmap/pursuitos-vnext` pointing at the isolated target, plus the Objective D Preview flags; then V-1…V-10 | Nothing built. No Vercel scope has been touched in any session. Owning an isolated database does not by itself isolate Preview — the Preview scope's current `DATABASE_URL` is still UNKNOWN (§6) |

---

## Roadmap capabilities

| Capability | Phase | Status | Branch / commit | Updated | What remains | Known risks |
|---|---|---|---|---|---|---|
| Canonical commercial foundation | P0 | **DEMO CERTIFIED** (pre-existing) | `97e975f0` | 2026-09-03 | — | Substantially already built: orgs, companies, products, sellers, partners, opportunities, motions, campaigns, entity resolution, aliases, provenance |
| Living Pursuit Context — **Vertical Slice 1** | P1 | **DEMO CERTIFIED / FROZEN** (owner, 2026-09-14) | `roadmap/pursuitos-vnext` @ `c4f4196` | 2026-09-14 | Nothing. "What matters now" is frozen absent real pilot feedback — do not redesign, rename or restructure it | Slice 2A re-proved it byte-identical (12,761 bytes, 1,092×792 desktop / 326×1,251 mobile) with the coordination flag ON |
| **Pursuit Coordination — Vertical Slice 2A** | P3 | **PREVIEW READY** (local synthetic) | `roadmap/pursuitos-vnext` (this session) | 2026-09-14 | Hosted Preview: apply 0103 + run `demo-plan-story.ts` on `mejokqxriwyawfhawuxu`, arm the flag on the Preview scope (owner-approved). Then product review | Goal → Plan → Motion → Action on Pursuit Detail. Migration 0103 (3 tables, additive). Two INTERNAL_WRITE skills; no send path. Deferred: Today integration, goal editing, plan closure on WON/LOST (see `SESSION-HANDOFF.md`) |
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
| Next Move / coordination | P3 | **SUPERSEDED** by Slice 2A | — | 2026-09-14 | — | The P3 amendment replaced isolated next-best-action with Goal → Plan → Motion → Action (D-025). `VNEXT_NEXT_BEST_ACTION_ENABLED` stays reserved and unimplemented |
| · pursuit goal | P3 | **PREVIEW READY** | `pursuit_goals` (0103) | 2026-09-14 | A UI for goal replacement (the governed `replace_pursuit_goal` path exists and is verified) | The commercial outcome only — route-, motion- and action-independent; append-only replacement via `supersedes_goal_id` (D-033). Not the org-level `goals` table (D-026) |
| · pursuit plan + revisions | P3 | **PREVIEW READY** | `pursuit_plans`, `pursuit_plan_revisions` (0103), `read-models/pursuit-plan.ts`, `coordination/plan-store.ts` | 2026-09-14 | Worker-driven review recording; plan closure | Append-only by grant, proven as `app_rw` (42501) |
| · course correction | P3 | **PREVIEW READY** | `assessPlanReview` + `PLAN_REVIEW_REQUIRED` | 2026-09-14 | Automatic recording on material events (today: detected on read, recorded on request) | Fingerprint comparison, never a rewrite (D-028) |
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

### Vertical Slice 2A validation (2026-09-14, local synthetic, Globex)

Local Postgres 17.11 + pgvector 0.8.6 (Homebrew) on `127.0.0.1:5433`, canonical world rebuilt from scratch with the new 11th layer. No hosted database contacted.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm test` | **313 pass / 0 fail** (from 290; +23: 22 plan tests + 1 flag test) |
| `npm run build` | exit 0 |
| `vnext-coordination` verifier (new, SEEDED) | **86 passed / 0 failed** — all writes rolled back, world unchanged afterwards |
| `vnext-context` verifier (Slice 1) | **62 passed / 0 failed** — Globex ledger still 10 rows |
| Manifest digest | `be0da833990ce436` — **unchanged** (= certified) |
| SEEDED spot-check | append-only 11/0 · stakeholder-intel 43/0 · value-case 126/0 |
| Flag-OFF, pre-slice build (`a04f0c8`) vs this build | same raw size (234,511 bytes); **full body byte-identical** after normalizing only per-build asset names, build id, per-request CSP nonce, server-action id hashes and the request-time timestamp existing team gap actions stamp; panel geometry identical panel-for-panel (3,827px desktop / 7,916px mobile, 11 panels) |
| "What matters now", Slice-1-only vs 2A ON | outerHTML **byte-identical** at 1440 and 390 |
| Flag-ON | "Pursuit plan" at 1,092×547 directly beneath "What matters now"; 10 panels; no horizontal overflow @1440 / @390 |
| Screenshots | `docs/vnext/review/slice-2a/` |

**Defects found and fixed before commit** (all caught by the new harness or the render review, none shipped): 0103 first draft left `app_rw` full DML on the new tables because of 0058's default privileges (D-031); the two plan skills appeared in the Federation panel's registry list and the seed's invocation became its "Last action" — both visible flag-OFF — fixed by keeping them in `COORDINATION_SKILLS` and seeding through the store; a `plan && …` child that left a `null` in the flag-OFF flight payload (5 bytes, no markup) — fixed with a ternary; a raw ISO date and a two-column grid that did not form.

### Slice 2A Goal ↔ Plan boundary refinement (2026-09-14, D-033)

The goal is now the durable commercial outcome only. Globex: "Exit legacy virtualization before renewal and close the $920K opportunity" — previously "…with WWT". The route, motion, action and owner live in plan revisions. 0103 was amended in place (never applied to any hosted/shared database): an append-only `supersedes_goal_id` + `supersession_reason` on the new goal row replaces the mutable forward pointer, plus `GOAL_REPLACED` and the governed USER-only `replace_pursuit_goal` skill (no UI). The local world was rebuilt from scratch.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm test` | **316 pass / 0 fail** (+3: route WWT↔CDW, motion/action, 0103 supersession schema; Globex goal test rewritten) |
| `vnext-coordination` verifier | **116 passed / 0 failed** (from 86): WWT → CDW → WWT keeps the same goal row and changes only plan history; motion change and action adjustment keep the goal; replacement keeps the old goal byte-identical and SUPERSEDED, forks refused (23505), non-human/unexplained supersession refused (23514), `app_rw` cannot rewrite objective or pointer (42501), another org cannot replace |
| `vnext-context` verifier (Slice 1) | 62 passed / 0 failed — Globex ledger still 10 rows |
| Manifest digest | `be0da833990ce436` — unchanged |
| SEEDED spot-check | append-only 11/0 · stakeholder-intel 43/0 · value-case 126/0 |
| `npm run build` | exit 0 |
| Flag-OFF, pre-slice build vs refined build | same raw size (234,511 bytes); full body byte-identical under the same normalization as before; zero plan markers |
| "What matters now", Slice-1-only vs refined 2A ON | outerHTML byte-identical at 1440 and 390 (1,092×792 / 326×1,251) |
| Flag-ON goal area | shows "Exit legacy virtualization before renewal and close the $920K opportunity"; "opportunity with WWT" absent; "via WWT" present only in the plan's Next move; plan panel geometry unchanged (1,092×547) |

**Found while testing the boundary, fixed:** when a person approves the *recommended* route, the route read-model deliberately reports `selected = null`. The plan loader took that as "no route", which left the plan unable to name an approved recommendation. It now resolves the choice from `selectedKey`. Globex (an override) was unaffected.

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
