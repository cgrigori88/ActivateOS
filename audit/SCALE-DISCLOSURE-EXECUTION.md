# Scale-Native Progressive Disclosure — Execution Report

Implementation of `audit/SCALE-DISCLOSURE-DESIGN.md` (approved v2, 8 refinements). Six bounded
phases, each committed after the existing regression suites passed and the surface was verified on
the **production build** (`next build && next start`) in light/dark/mobile. Principle held
throughout: *simple by default, complete on demand.* No domain primitive, scoring model, data model,
disclosure rule, federation semantic, or governed-action semantic was changed — everything added is
filters, aggregations, view modes, retrieval, and presentation over the **existing** canonical
read-models.

**Environment:** the local Design Partner Demonstration Environment — the real Next application on
production architecture (`app_rw` + FORCE RLS, governed actions), `pursuit_demo` @ `127.0.0.1:5433`,
synthetic/DEMO data, external actions approval-gated. **No production target, credential, or flag
was touched.**

---

## What shipped, phase by phase

| Phase | Surface | Commit |
|---|---|---|
| 1 | Ecosystem scope selector + URL/cookie persistence + quiet scope chip | `f777f5d` |
| 2 | Today executive command center (exposure band, top-N, why-here, scope) | `1e34e10` |
| 3 | Pipeline Attention / Portfolio / All (ecosystem-native pivots, drill-in) | `b21014c` |
| 4 | Contextual intelligence drawer (reusable, disclosure-safe) | `5593b6c` |
| 5 | Unified ⌘K resolver — GO TO / SHOW ME / EXPLAIN (evidence-bound) | `781ba66` |
| 6 | Scale/virtualization hardening + final verification | this commit |

---

## Before → after, by surface

| Surface | Before | After |
|---|---|---|
| **Today** | A long single feed: decision queue, then KPI chips, next-best-actions, approvals, top opps, activity — all always rendered. | An executive command center: a one-row **revenue-exposure band** (open · weighted · decisions · conditions · won-90d), the **top-N materiality-ranked decisions** each with a **"Why is this here?"** factor breakdown and its account named, the top **conditions**, and **View all**. Secondary content steps back. Every surface honors the active ecosystem scope. |
| **Pipeline** | One exhaustive card stack (board) + a review table. | Three progressive views behind a segmented control: **Attention** (intervention-worthy only, materiality-ordered), **Portfolio** (ecosystem-native pivot — Partner/Vendor/Territory/Seller × Condition/Stage/Partner, weighted-$ cells that drill into the reconciled records), **All** (one dense, sortable, filterable, windowed table). **Review** (deal registration) preserved. Scope narrows all. |
| **Scope** | none | A persistent rail selector (data-derived options; empty kinds hidden), a quiet contextual chip ("CDW · 7 accounts · 4 active motions"), URL `?scope=` + cookie, shareable/deep-linkable, re-authorized server-side; **narrowing-only** — a foreign/bogus id fails safe to ALL, never widens. |
| **Drawer** | Navigating away to `/accounts/[id]`. | A right-side **contextual intelligence drawer** (`?drawer=`) opened from Today/Pipeline rows — HUNT / WHY-NOW / THROUGH-WHOM / WHAT-NEXT over a dimmed room, preserving filters/sort/scope/scroll; server-rendered, so **nothing is serialized while it's closed**. |
| **⌘K** | Substring entity search + room jump. | **Three explicit intent classes**: GO TO (entity nav), SHOW ME (allowlisted structured query over canonical data, with an interpreted read-back), EXPLAIN (evidence-bound explanation of a route/timing/condition, grounded and cited). Honest failure ("No matching records" / "not supported yet"). |

---

## Screenshot index (production build)

- **Scope** (selector, chip, scoped, adverse): `audit/scope-shots/`
- **Today** (command center, why-here open, view-all, scoped, dark, mobile): `audit/today-shots/`
- **Pipeline** (attention, portfolio ×2, all, scoped ×2, dark ×2, mobile): `audit/pipeline-shots/`
- **Drawer** (pipeline all, today, attention dark, mobile): `audit/drawer-shots/`
- **⌘K** (go-to, show-me, explain, unsupported, explain dark): `audit/palette-shots/`
- **All at scale** (310 synthetic rows, windowed; deleted after capture): `audit/scale-shots/`

---

## Invariants preserved

**Regression suites (all green, re-run after every phase and finally):**

| Suite | Result |
|---|---|
| isolation (RLS / FORCE RLS / cross-tenant) | 12 / 12 |
| disclosure (sponsor vs participant projection) | 21 / 21 |
| closed-loop (outcome label vs sponsor-only magnitude) | 18 / 18 |
| governed-mutation (single mutation authority) | 13 / 13 |
| federation (multi-org readiness/visibility) | 19 / 19 |
| tenant-flags (per-org, fail-closed, RLS) | 13 / 13 |

**Demo journey preserved:** the canonical 8-step journey still runs — every room 200s, and the
hero **Sponsor ⇄ Partner disclosure** on the Globex pursuit still shows the `$1.84M` figure in
Sponsor view and removes it server-side in Partner view. The scope/command-center/views/drawer/⌘K
work sits **on top of** the existing story.

---

## Regressions discovered — reconciliation / disclosure / hydration / performance / navigation

- **Reconciliation:** none broken. One *gap* found and fixed as canonical wiring, not a workaround:
  the demo's opportunities carried **no partner attribution** (no `motion_id`), so Pipeline routes,
  the Portfolio Partner pivot, and the co-sell roll-up read empty. Linking each open opportunity to
  its account's partner-bearing motion (existing objects; `demo-stories` Layer 9) made routes read
  the same as the pursuit/mapping story (Umbrella/Cyberdyne/Hooli via CDW, Globex via WWT) and lit
  the co-sell roll-up (0% → 59%). No new business object.
- **Disclosure:** no leak. The drawer body is server-rendered only when `?drawer=` is present —
  verified that with the param the intel renders and **without it none of the confidential fields
  appear in the payload** (R7). ⌘K EXPLAIN withholds `TRANSACTION_CONFIDENTIAL`/`RESTRICTED`/`PII`
  reasons from the search surface. The Sponsor⇄Partner server-side projection is unchanged.
- **Hydration:** the scale-disclosure interactions (scope menu, ⌘K three modes, All-table
  sort/filter/show-more, Manage/why-here disclosures) hydrate on the **production build** as
  required; native `<details>` and server-rendered drawers work without hydration. The standing
  requirement stands: run on `next build && next start`, never `next dev`.
- **Performance:** the All table renders 310 rows in ~1.3 s and stays responsive via a 100-row
  window + "show more" + client sort/filter. Exposure and Portfolio are single grouped aggregates;
  the palette is debounced and limit-capped. **Additive index recommendation (design §6, NOT
  applied — flagged for separate approval):** before real production scale, verify/add indexes on
  `opportunities(org_id, stage, updated_at)`, `revenue_motions(org_id, partner_id)`,
  `sellers(vendor_id, territory)`. An index migration is additive and changes no data model.
- **Navigation:** scope, view, drawer, and filters all live in the URL and survive open/close and
  plain rail navigations (cookie-backed); `scroll={false}` preserves position; two build-time issues
  were fixed during Phase 1 (a `useSearchParams` CSR-bailout on `/_not-found`, and a redundant
  `router.refresh()` that dropped the address-bar `?scope=`).

## Intentionally NOT changed
Domain primitives · scoring · data models/migrations · disclosure engine/projections · federation
substrate · governed-action mutation path · RLS/FORCE RLS · recommendation ≠ decision · preserved
UNKNOWN states · canonical reconciliation · the regression harnesses · production/credentials/flags/
sending/commissioning.
