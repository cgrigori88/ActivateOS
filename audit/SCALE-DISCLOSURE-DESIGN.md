# Scale-Native Progressive Disclosure — Design Specification (review before build)

**Design only. No code has been written.** This specifies a scale-native interaction model for
**Today**, **Pipeline**, a reusable **contextual intelligence drawer**, and a unified
**Search/⌘K**, for production scale (thousands of accounts, hundreds of simultaneous pursuits,
many vendors/partners, 1:1 and 1:many ecosystems). It halts for your review.

**Design principle:** *simple by default, complete on demand.* No capability is removed;
complexity is progressively disclosed.

## Invariants preserved (non-negotiable — this design is presentation + read-model only)
Domain primitives, scoring model, federation substrate, the disclosure engine and its
server-side projections/payloads, data models/migrations, governed-action semantics, RLS/FORCE
RLS, recommendation ≠ decision, preserved UNKNOWN states, canonical cross-room reconciliation,
the demo dataset, and every A→E/R1 regression invariant are **unchanged**. Everything below adds
**filters, aggregations, view modes, and retrieval** over the *existing* canonical read-models.
No new domain primitive, taxonomy, room, scoring concept, or data model is introduced.

---

## 0. Graph mapping (what the data already supports — grounding, not assumption)

| Capability needed | Backed by (existing columns/read-models) |
|---|---|
| Today materiality cut | `getTodayQueue` items carry `decisionClass`, `operationalUrgency`, `commercialPriority`; `materiality.ts` (`isMaterial`, `todaySort`) |
| Revenue exposure | `opportunities.amount_usd` + weighted (stage probability); `pursuits.expected_value_weighted` |
| Ecosystem scope | `sellers(org_id, partner_id, vendor_id, territory)`, `partners(org_id, partner_type)`, `organizations` (vendor), `revenue_motions.partner_id`, `opportunities` (partner via motion), actor/`org_members` (personal) |
| Pipeline conditions | my Phase-3 attention model (silent-days from `updated_at`, momentum verdict, stage), `meddpicc`, `momentum` |
| Drawer intelligence | `getAccountIntel` (Phase 3c-2) — HUNT/WHY-NOW/THROUGH-WHOM/WHAT-NEXT already assembled from canonical objects |
| Unified search | `/api/palette` (accounts, campaigns, motions, partners, pursuits, org-scoped) — extend, don't replace |

**Scope is a narrowing filter *inside* the tenant's already-RLS-scoped set — never a widener.**
Every scoped query keeps `app.org_id` + explicit `org_id` filters; a partner/vendor/territory/
seller scope only sub-selects the org's own pursuits/opps by that dimension. It can never reveal
another tenant's data, and federation drawers still render the viewer's permitted projection only.

---

## 1. Persistent ecosystem scope selector

A single control in the app header/rail, persistent across rooms. Answers *"whose ecosystem am I
operating on right now?"* and narrows Today, Pipeline, Accounts, Insights consistently.

### 1.1 Scope model
```
Scope = { kind, id? }
  kind ∈ { ALL, ORG, PARTNER, VENDOR, TERRITORY, SELLER, PERSONAL }
```
| kind | Canonical filter (added to existing queries) | Availability |
|---|---|---|
| ALL ecosystem | none (org's full RLS-scoped set) | always |
| Organization | the viewer org itself (default in 1:1) | always |
| Partner | `revenue_motions.partner_id = :id` / `opportunities` via motion / `pursuit_route_participants` | when the org has partners |
| Vendor | `sellers.vendor_id = :id` (join through route/seller) | when seller.vendor_id present |
| Territory | `sellers.territory = :id` | when seller.territory present |
| Seller | `sellers.id = :id` (route/team seller) | when sellers present |
| Personal | current actor as owner/assignee (`org_members`, motion owner, action assignee) | always |

Options are **derived from data** — a scope kind with no rows is hidden (fail-closed, no empty
promises). Selecting a scope with zero results shows an explicit empty state, never fabricated rows.

### 1.2 Persistence & state
- URL param `scope=<kind>[:<id>]` (shareable, bookmarkable) + a cookie (`pos:scope`) so it
  persists across navigation. Absent/invalid ⇒ `ALL` (fail-safe).
- Changing scope is a client navigation that re-renders the current room with the filter applied.
- The selector shows the active scope label and a count badge (e.g. "CDW · 34 pursuits").

### 1.3 Wireframe
```
┌ header ─────────────────────────────────────────────────────────────────┐
│  ⌘K Search…            [ Ecosystem: All ▾ ]           Demo environment    │
│                          ├ All ecosystem                                  │
│                          ├ Organization · Vertex Systems                  │
│                          ├ Partner ▸  CDW · WWT                           │
│                          ├ Vendor ▸   (from sellers.vendor_id)            │
│                          ├ Territory ▸ West · East …                      │
│                          ├ Seller ▸    CDW Rep · WWT Rep …                │
│                          └ Personal · me                                  │
└───────────────────────────────────────────────────────────────────────────┘
```

### 1.4 State transitions
```
[ALL] --select partner CDW--> [PARTNER:cdw]   (URL scope=partner:cdw, cookie set, room refilters)
[PARTNER:cdw] --clear--> [ALL]
any --invalid/stale id--> [ALL]  (fail-safe)
scope with 0 rows --> room shows "No <entity> in this scope" (explicit), never invented data
```

---

## 2. Today — executive command center

Transform the long feed into a decision command center: **default surfaces only the highest-
materiality decisions/interventions**, a **revenue-exposure summary**, and **major conditions**,
with explicit **View all** to the complete queue.

### 2.1 Information hierarchy (default view, top → bottom)
1. **Exposure band** (new, summary): total open pipeline in scope · weighted · # decisions
   required · # material conditions (disagreements) · won-this-period. One calm row of figures.
2. **Decisions that move revenue** — top **N (default 5–7)** highest-materiality items from
   `getTodayQueue` (already materiality-ordered), each with revenue-at-stake. `View all (N) →`.
3. **Where your systems disagree** — top **N (default 3–5)** conditions (already built), with
   `View all →`.
4. Secondary (progressive): Top opportunities · Pending approvals · Recent activity (collapsed
   into a compact "At a glance" strip; expandable).

### 2.2 Wireframe — default
```
Today                                                   [ Ecosystem: All ▾ ]
What needs your decision, and where the next revenue is.

┌ EXPOSURE (in scope) ───────────────────────────────────────────────────┐
│  $6.25M open · $2.61M weighted · 6 decisions · 3 conditions · 1 won      │
└─────────────────────────────────────────────────────────────────────────┘

DECISIONS THAT MOVE REVENUE — ranked by materiality              View all (18) →
┌ ● Approve WWT route brief — Globex        $920k   High      [ Approve → ] │
│ ● Recommended route changed — Umbrella    $920k   High      [ Open →    ] │
│ ● Intervene: silent 34d — Umbrella        $920k   High      [ Open →    ] │
│ … (top 5–7 only)                                                          │
└───────────────────────────────────────────────────────────────────────────┘

WHERE YOUR SYSTEMS DISAGREE                                       View all (6) →
│ ▎Umbrella — late-stage, silent 34 days — record & deal parted ways        │
│ ▎Hooli — untouched 26 days, renewal window closing                        │
└───────────────────────────────────────────────────────────────────────────┘

At a glance  ▸  10 scored accounts · 19 verified evidence · 2 pending approvals
```
Clicking any row opens the **contextual intelligence drawer** (§4), not a full navigation.

### 2.3 View-all state
`View all` sets `?today=all` (or routes to `/queue` for the dated worklist). The full queue renders
as a compact, virtualized list (same items, no truncation). A "Back to command center" returns to
default. `View all` on disagreements expands the card in place.

### 2.4 State transitions
```
[command-center] --View all decisions--> [full-queue ?today=all]
[command-center] --click row--> [drawer open]  (Today stays mounted underneath)
[scope change]   --> re-query exposure + top-N + conditions for the new scope
```

### 2.5 Data (read-model additions only — no schema change)
- `getTodayQueue(db, caller, { scope, limit })` — add optional `scope` filter + `limit` (default
  cut) + return `total` for the "View all (N)". Materiality order unchanged.
- `getTodayExposure(db, { scope })` — one aggregate query over `opportunities` (+ weighted) and
  `getTodayQueue` counts. Pure read.

---

## 3. Pipeline — Attention / Portfolio / All

Replace the default exhaustive card stack with three progressive views behind a segmented control
(`?view=attention|portfolio|all`, default **attention**). The existing **aggregate intelligence**
(roll-up bentos, stage bars, "AI learned signal") stays at the top of all three.

### 3.1 Attention (default) — "what needs intervention now"
Only intervention-worthy pursuits: my Phase-3 attention model (silent/at-risk/stalling/late-stage-
silent) OR material change OR route reconsideration, **materiality-ordered**. The Phase-3 card
(accent rail + attention line + next intervention + Manage disclosure) is reused **unchanged**.
A count + `See all N in All →`.

### 3.2 Portfolio — "where is my commercial exposure concentrated"
A compact **aggregation matrix** (pivot) over the canonical opportunities — *no new data*:
- **Rows:** pick one of Partner / Vendor / Territory / Solution (taxonomy node) — a small selector.
- **Columns:** Condition (At-risk / Stalling / Healthy) **or** Stage.
- **Cell:** weighted $ + count; shaded by materiality. Click a cell → Attention view filtered to
  that slice (or the drawer for a single-pursuit cell).
- Honors the ecosystem scope (§1). This is how a 1:many ecosystem operator slices hundreds of
  pursuits by partner/vendor/territory/solution × condition on one screen.

```
Portfolio — weighted exposure ($k)         rows: [ Partner ▾ ]  cols: [ Condition ▾ ]
                 At-risk   Stalling   Healthy    Total
  CDW             580        108        340       1,028
  WWT             552         38        224         814
  (direct)          0          0        210         210
  Total          1,132       146        774       2,052
  click a cell → Attention filtered to CDW · At-risk
```

### 3.3 All — "the exhaustive dataset, compact"
The full opportunity set as a **dense compact table** (name · account · stage rail · amount ·
weighted · momentum · close · route), virtualized/paginated, sortable, filterable by the existing
Stage/Quote/Closing filters + scope. No cards; maximum density for scanning thousands.

### 3.4 Information hierarchy
```
[aggregate intelligence bentos + stage bars]          (all three views)
[ Attention · Portfolio · All ]  segmented            (view switch)
  Attention → materiality-ranked intervention cards (Phase-3 card)
  Portfolio → pivot matrix (rows × condition/stage, weighted $)
  All       → dense compact virtualized table
```

### 3.5 State transitions
```
[attention] --seg: Portfolio--> [portfolio]   (?view=portfolio)
[portfolio] --click cell CDW/At-risk--> [attention ?partner=cdw&qual=risk]
[all] --sort/filter--> same view, re-query
[any] --click row/card--> [drawer open]
[scope change] --> all three re-query within scope
```

### 3.6 Data (read-model additions only)
- `getPipelinePortfolio(db, { scope, rowDim, colDim })` — one grouped aggregate over the canonical
  `opportunities` join (partner via motion, seller.vendor_id/territory, taxonomy node) → weighted
  sums + counts. Pure read; reuses `probOf` weighting already in the page.
- Attention/All reuse the current opportunity query; add `scope` + a materiality predicate for
  Attention, pagination for All.

---

## 4. Contextual intelligence drawer (reusable)

Clicking an account/pursuit from **Today** or **Pipeline** opens a right-side **drawer** (overlay)
with **What's happening / Why it matters / Why now / Through whom / What next** — *without forcing
navigation*. Full Pursuit Detail remains available via a deep link in the drawer.

### 4.1 Content (reuses `getAccountIntel`, extended to accept a pursuitId)
| Section | Source (canonical, unchanged) |
|---|---|
| **What's happening** | current stage/opportunity + the attention condition (silent-days, momentum) |
| **Why it matters** | revenue at stake (amount/weighted), materiality |
| **Why now** | why_now trigger, **timing anchor or UNKNOWN preserved**, convergence, missing evidence |
| **Through whom** | recommended route vs human selection (**rec ≠ decision preserved**), partners, mapping overlap |
| **What next** | recommended motion, governed next action, human decision |

Disclosure is preserved: the drawer renders the **viewer's permitted projection** (participant vs
sponsor) exactly as Pursuit Detail does — no sponsor-confidential figure leaks into a participant
drawer.

### 4.2 Interaction & state
- Trigger: row/card click on Today or Pipeline. URL gains `?drawer=<pursuitId>` (or `acct:<id>`),
  so it is **deep-linkable and SSR-rendered** (works without hydration; the panel is a server
  component; the open/close chrome is a thin client shell). Esc / click-scrim / ✕ closes
  (`?drawer` removed). Underlying room stays mounted (no context loss).
- Footer: **Open full Pursuit →** (`/pursuits/<id>`), and quick governed actions surface as the
  same audited `dispatchSkill`-backed controls (no new mutation path).

### 4.3 Wireframe
```
Pipeline …                                        ┌ DRAWER ───────────────────┐
┌ Umbrella — proposal · $920k · at-risk ───────┐  │ Umbrella Health Systems ✕ │
│ Late-stage, silent 34 days … Next: re-engage │  │ What's happening          │
│ [ Manage ▾ ]                                 │  │  proposal · silent 34d    │
└───────────────────────────────────────────────┘  │ Why it matters $920k High │
  (click card) ───────────────────────────────────▶│ Why now  timing 66 …      │
                                                    │ Through whom  CDW rec …   │
                                                    │ What next  Re-engage EB   │
                                                    │ Open full Pursuit →       │
                                                    └───────────────────────────┘
```

---

## 5. Unified Search / ⌘K — retrieval surface + NL architecture

Upgrade the existing palette into one retrieval surface across **accounts, pursuits, partners,
vendors, opportunities, motions, evidence, signals, actions**, and architect it so future natural-
language queries resolve against canonical data **without inventing facts**.

### 5.1 Entity coverage (extend `/api/palette`, keep org-scoping)
Add lookups for **pursuits, opportunities, vendors (sellers.vendor_id), evidence, signals,
motion/governed actions** to the current 5 (accounts, campaigns, motions, partners, pursuits). Each
returns a typed hit `{ entityType, id, label, sub, href, scopeHint }`, grouped. All stay under
`withTenant` + explicit `org_id` (search never widens visibility).

### 5.2 Structured-query layer (the NL-ready architecture)
The palette resolves against a **structured query object** — a deterministic contract the UI emits
today from typed filters and a future NL parser can emit tomorrow:
```
Query = {
  entity: 'pursuit'|'opportunity'|'account'|'partner'|…,
  filters: [{ field, op, value }],     // field/op from a strict ALLOWLIST per entity
  scope?: Scope,                        // the ecosystem scope (§1)
}
```
- **Resolver = pure SQL over canonical read-models under RLS.** It only *filters existing facts*;
  it cannot synthesize a value. An unmatched term returns **"no matching records"**, never a
  fabricated row or figure. This is the anti-hallucination guarantee, enforced structurally.
- **Allowlist** (examples): pursuit.{stage, partner, amount, timing, band, days_silent},
  opportunity.{stage, amount, close_within, condition}, account.{band, propensity, partner,
  renewal_within}. Ops: `=,>,<,>=,<=,in,within`. Anything outside the allowlist is rejected, not
  guessed.
- **Worked examples → structured query (resolvable against canonical data):**
  - *"late-stage CDW pursuits over $500K"* → `{ entity: pursuit, filters:[ stage in
    (proposal,negotiation), partner = CDW, amount > 500000 ] }`
  - *"renewals in 90 days with weak partner coverage"* → `{ entity: opportunity, filters:[
    renewal_within = 90d, partner_coverage = weak ] }` (partner_coverage derives from existing
    partner_relationships strength — no new fact).
- **UI architecture:** the palette input has two lanes — instant room/entity substring match
  (today), and a **structured-filter builder** (chips: entity ▸ field ▸ op ▸ value) that emits the
  Query object to the resolver. A future NL box sits **in front of** the same resolver: NL → Query
  (parser proposes) → resolver (reads canonical facts only). The parser never reaches the database;
  only the allowlisted resolver does. No parser output is trusted as fact.

### 5.3 Wireframe
```
┌ ⌘K ─────────────────────────────────────────────────────────────────────┐
│  late-stage CDW pursuits over $500K                                       │
│  ─ interpreted as ─  entity: Pursuit · stage∈{proposal,negotiation} ·     │
│                       partner=CDW · amount>$500k · scope: All             │
│  RESULTS (canonical, 3)                                                    │
│   ▸ Globex — Exit legacy virtualization   proposal · $920k · CDW→WWT       │
│   ▸ Umbrella — Datacenter exit phase 1    proposal · $920k · CDW           │
│   … (no invented rows; empty ⇒ "no matching records")                     │
│  ROOMS  Today · Pipeline · Accounts …    ENTITIES  accounts · partners …   │
└───────────────────────────────────────────────────────────────────────────┘
```

### 5.4 State transitions
```
[closed] --⌘K--> [open, empty]
[typing <2 chars] --> rooms only
[typing >=2] --> debounced /api/palette (entities) + instant rooms
[structured chips complete] --> resolver returns canonical hits (or "no matching records")
[Enter on hit] --> navigate OR open drawer (for account/pursuit hits)
[Esc] --> closed
```

---

## 6. Scale considerations (thousands of accounts / hundreds of pursuits)
- Today default cut (top-N) + `View all` avoids rendering the whole queue; exposure is one
  aggregate query. Pipeline **All** is virtualized/paginated; **Portfolio** is a single grouped
  aggregate (bounded rows). Palette is debounced, `limit`-capped, rate-limited (already).
- All new queries filter on indexed columns (`org_id`, `company_id`, `partner_id`, `stage`,
  `updated_at`). Recommend (design note) verifying/adding indexes on `opportunities(org_id, stage,
  updated_at)`, `revenue_motions(org_id, partner_id)`, `sellers(vendor_id, territory)` before
  production scale — **an index migration is additive and does not change the data model**; flagged
  for a separate approval, not part of this UI change.
- Drawer lazily loads its intel on open (one `getAccountIntel`/pursuit call).

---

## 7. Exact proposed code changes (for review — nothing implemented)

**New (presentational / read-model):**
1. `src/components/scope/scope-selector.tsx` (client shell) + `src/lib/scope/scope.ts` (parse/serialize `Scope`, derive available kinds from data). URL `scope=` + cookie.
2. `src/components/intel/intel-drawer.tsx` (thin client open/close shell) wrapping a server-rendered `IntelBody` that reuses the Phase-3c-2 `AccountIntelPane` content; `?drawer=` param.
3. `src/lib/pursuits/read-models/today.ts` → add `getTodayExposure` + `scope`/`limit`/`total` to `getTodayQueue` (additive signature).
4. `src/lib/opportunities/portfolio.ts` → `getPipelinePortfolio(scope,row,col)` grouped aggregate (reuses existing weighting).
5. `src/lib/search/query.ts` → the structured `Query` type + a canonical **resolver** (allowlisted fields/ops → SQL under `withTenant`). `src/app/api/palette/route.ts` extended with the new entity lookups + resolver endpoint; `src/lib/accounts/intel.ts` extended to accept a `pursuitId`.

**Edited (view logic only):**
6. `src/app/page.tsx` (Today) → exposure band + top-N cut + `View all` + row-click opens drawer + honor scope.
7. `src/app/pipeline/page.tsx` → `Attention | Portfolio | All` segmented (`?view=`); Attention reuses the Phase-3 card; Portfolio renders the matrix; All renders the dense table; honor scope + drawer.
8. `src/components/command-palette.tsx` → structured-filter lane + interpreted-query line + drawer-open on entity hits.
9. `src/components/shell.tsx` → mount the persistent scope selector in the header.

**No changes to:** any migration/table, scoring, disclosure engine, federation substrate, governed-
action semantics, RLS policies, recommendation/override logic, UNKNOWN handling, demo seed, or the
regression harnesses. (An optional additive index migration in §6 is called out separately.)

---

## 8. Explicitly NOT changing
Domain primitives · taxonomy · scoring concepts · navigation rooms/IA · data models/migrations ·
disclosure projections/payloads · federation · governed-action mutation path (`dispatchSkill`) ·
RLS/FORCE RLS · recommendation ≠ decision · preserved UNKNOWN · canonical reconciliation · demo
dataset · A→E/R1 regression invariants · production/credentials/flags/sending/commissioning.

---

## Halt
Interaction model, information hierarchy, state transitions, wireframes, and the exact proposed
code-change list are specified above. **No implementation performed.** Awaiting your review and any
edits to the scope model, the Today top-N cut, the Portfolio pivot dimensions, the drawer contract,
or the structured-query allowlist before Phase 3 build.
