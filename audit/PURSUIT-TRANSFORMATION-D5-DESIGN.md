# PursuitOS — Workstream D.5: Real Application Integration + Visual-System Correction

**Phase 1 (Deep Mapping) + Phase 2 (Technical Design). Halting for sign-off before Phase 3.**
Workstream E stays closed until D.5 is signed off.

---

## Phase 1 — Deep Mapping (ground truth, from the booted app)

I booted the **real** Next.js 16 application locally — `next dev`, connected as the non-owner role **`app_rw`** with real RLS active, against a seeded demo tenant — and drove the actual routes. Findings:

### What is already correct (contrary to the concern in the notes)
1. **The real `/pursuits` and `/pursuits/[id]` routes already render inside the canonical dark-navy rail shell.** They go through `app/layout.tsx` → `<Shell>`, the same rail, identity, and light canvas as every other screen. The visual "departure" in the earlier review was **the standalone proof HTML** (a top-nav mock I built only because I hadn't booted the app) — *not* the application. There is no second shell and no parallel frontend to tear out.
2. The pages already consume the **server-side read models** (`getPursuitPortfolio`, `getPursuitDetail`) via `withTenant` + `callerFor`. No client-side score recomputation exists.
3. The app **boots and serves** the routes: `/pursuits` → 200, `/pursuits/[id]` → 200, rendered server-side as `app_rw` under RLS driven by the `app.org_id` GUC.
4. Decision band, structured Why Now (missing-stays-missing), route path, route metrics, override ("Selected: WWT — overriding the recommendation"), dimension compare with "Not available", team readiness-held, and What-Changed all render from real data.

### The real gaps (what D.5 must actually fix)
| # | Gap | Evidence |
|---|---|---|
| G1 | **Disclosure split not rendered.** The internal-vs-shareable route reasons — the `$1,840,000` centerpiece — exist in the read model (`reasonsInternal` / `reasonsShareable`) but the page never renders them. The demo's strongest moment is currently invisible. | `grep 1840000` on the served vendor payload → absent |
| G2 | **Today decision queue not wired.** `getTodayQueue` exists but no surface renders it; `/today` is 404 and Today = `/` home. | route probe |
| G3 | **Cards are hand-styled, not mapped to the design system.** Pages use raw `border bg-white dark:bg-slate-900` instead of the canonical `glass` / `Card` / `Bento` materials and semantic tokens. This is the real "visual correction." | `[id]/page.tsx` markup |
| G4 | **Band vocabulary mismatch.** Read model emits `moderate` + `unknown`; the design system's `BandBadge` speaks `very_high/high/medium/low`. Needs one reconciliation layer. | `parts.tsx` vs `ui.tsx` |
| G5 | **Route decision is a chip row, not a signature commercial-path component.** | baseline screenshot |
| G6 | **Mobile is naive stacking**, not the decision-first order in §L. | responsive read |
| G7 | **No real-app visual proof, no E2E, no runtime disclosure/cross-tenant assertions at the HTTP layer.** | — |

### Boot mechanics established (reproducible)
- The harness DB stubs the 0058 RLS mechanism faithfully (`app_current_org()`, `is_org_member(org) = org = app_current_org()`, `app_rw`, per-table policies). The **only** missing boot-path object was `resolve_user_org(uuid)` (migration 0059) — additive; I will fold it into the demo-DB builder.
- Demo boot env: `DATABASE_URL=…app_rw…@127.0.0.1:5433/<demo>`, Supabase vars empty (→ `authConfigured()` false → sole-org fallback), flags on. Sole org = first-created tenant = the vendor operator.

---

## Phase 2 — Technical Design

**Principle:** refinement, not rebuild. Keep the product model, the shell, the read-model boundary, and every server-side guarantee. Map the Pursuit surface onto the existing design system and add the two missing surfaces (disclosure split, Today queue).

### A. Reproducible demo tenant (`scripts/demo-db.ts` + `supabase/verify` additions)
- Build a stable **`pursuit_demo`** database: harness schema + `resolve_user_org` + the WS-D seed (vendor tenant created first; a **guest** partner tenant created second for the disclosure/cross-tenant runtime tests).
- Add `alter role app_rw login` for local only (documented as demo-only).
- Deterministic; committed so the demo is reproducible after a container reset.

### B. Band reconciliation (`src/components/pursuit/parts.tsx`)
- One adapter mapping read-model `Band` (`very_high/high/moderate/low/unknown`) → design tokens, with `moderate→medium` and a first-class **`unknown`** treatment (neutral, "Unknown", never rendered as low/zero). Reuse `--color-band-*` tokens; no new hexes.

### C. Componentize the Pursuit grammar (`src/components/pursuit/*`)
Extract page-local markup into reusable, token-driven components, styled with `glass`/`Card`/`Bento`:
`PursuitHeader, PursuitDecisionBand, PursuitMetric, WhyNowPanel/Item, FactCard, UnknownState, ContradictionNotice, RoutePath, RouteDecision, RouteCandidateComparison, RecommendationChange, DisclosureSplit, TeamLifecycle, MaterialChangeTimeline, TodayDecisionItem, SyntheticDisclosure, EvidenceReference.`
Decision band becomes a **Bento scorecard** (matching the Partners "Scorecard" row in the reference). Cards become `glass rounded-card`.

### D. Disclosure split (G1 — the centerpiece)
- New `DisclosureSplit` renders `reasonsInternal` (RESTRICTED, incl. the `$1.84M`) beside `reasonsShareable` (generalized). The read model already omits the confidential value from the shareable payload **before serialization** — the component only displays what it is given.

### E. Today decision queue (G2)
- Flag-gated section on `/` (Today = home): when `pursuitExperienceEnabled()`, surface `getTodayQueue()` as materiality-ordered `TodayDecisionItem`s **above** the existing Today content — preserving, not replacing, the current operating home.

### F. Route path (G5) + Mobile order (G6)
- `RoutePath` as a signature commercial-path component (Vendor → Distributor → Reseller → Customer), N-hop tolerant, showing recommended/selected/alternatives + confidence.
- Mobile: reorder to identity → decision required → Why Now → unknowns/contradictions → recommended action → route → team → facts → what changed; secondary comparison progressively disclosed.

### G. Verification (G7) — all against the booted app
1. **Real-app screenshots** replace the static proof: `/` (Today), `/pursuits`, `/pursuits/[id]`, route comparison, **internal** vs **partner-safe** disclosure — desktop light+dark and mobile light+dark.
2. **Responsive QA** at 1440/1280/1024/768/430/390 — no horizontal overflow, tables scroll, touch targets.
3. **Runtime disclosure (HTTP payload, not DOM):** boot resolving to the vendor tenant → served HTML contains the internal reason; boot resolving to the guest tenant → `grep 1840000` on the served bytes returns nothing.
4. **Cross-tenant:** direct-URL the other tenant's Pursuit → not-found; portfolio excludes it.
5. **Feature-flag matrix** on the booted app: all-off → current product intact + Pursuit routes 404; demo-tenant-only enablement.
6. **E2E (Playwright against localhost):** the hero flow (Today → Globex → Why Now → Facts → route compare → CDW recommended / WWT selected / override → disclosure-safe view → team → what changed), plus the limited-user "confidential figure absent" assertion.

### Non-goals / preserved
No conceptual rollback; no obsolete IA restored; disclosure/authorization stay server-side; `moderate/unknown` semantics preserved; the static proof HTML is demoted to an engineering fixture, not the UI proof.

### Honest "done" ladder (§S)
D.5 will report separately: architecture-verified · harness-verified (34/34) · **authenticated-app-verified** · demo-tenant-runtime-verified. It will **not** claim production-deploy-verified.

---

## Files in play (anticipated)
- New: `src/components/pursuit/{header,decision-band,why-now,route,disclosure,team,timeline,facts,today-item}.tsx`, `scripts/demo-db.ts`, `scripts/e2e-pursuit.mjs`, `audit/PURSUIT-TRANSFORMATION-PHASE4-D5.md`.
- Edited: `src/app/pursuits/page.tsx`, `src/app/pursuits/[id]/page.tsx`, `src/app/page.tsx` (Today section), `src/components/pursuit/parts.tsx`, `src/lib/pursuits/read-models/today.ts` (only if the Today surface needs a field it doesn't yet expose), `supabase/verify` builder.
- Untouched: read-model disclosure/authorization logic, the shell, all non-Pursuit screens.

**HALT — awaiting D.5 Phase 3 go-ahead.**
