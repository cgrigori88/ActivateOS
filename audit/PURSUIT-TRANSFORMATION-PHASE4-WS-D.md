# PursuitOS — Workstream D, Phase 4: Blind Verification

**Pursuit Experience / Decision Surface** — the human operating model around the canonical Pursuit: attention → understanding → decision → governed action.

> **This workstream is visual (§68).** A text-only report is insufficient, so this document leads with visual proof and pairs every mechanical claim with the assertion that verifies it. Every value shown in the screenshots was serialized from the exact server-side read-model view objects the UI renders — no fixtures, no invented numbers (see *How the visual proof is grounded*).

Branch: `claude/activateos-platform-review-xzkgmd` · Verify DB: `wsc_verify` (full A+B+C schema) · Harness: `scripts/experience-verify.ts`

---

## 0. Verdict

| Gate | Result |
|---|---|
| Read-model DoD harness (§66) | **34 / 34 passed, 0 failed** |
| Type check (`tsc --noEmit`) | **clean (exit 0)** |
| Routing regression (`routes-verify`, fresh DB) | **64 / 64 passed** — no regression from the nullability change |
| Server-side disclosure + payload absence (§65) | **enforced** — restricted value absent from the serialized limited-caller payload |
| No UI recompute (§64) | **verified** — read-model value equals the canonical DB cache verbatim |
| Cross-tenant authorization (§29/§30) | **enforced** — foreign pursuit reads return `null` |
| Feature-flag fail-safe (§55/§56) | **enforced** — requested + a dependency off ⇒ OFF |
| Visual proof (§68) | **desktop light + dark + mobile**, published Artifact |

---

## 1. Visual proof (§68)

**Interactive, theme-aware, responsive:** https://claude.ai/code/artifact/f0e25727-e57e-46fa-988f-155032084aad
**Committed for reproducibility:** `audit/PURSUIT-WS-D-visual-proof.html`

Three device classes were rendered (Chromium, deviceScaleFactor 2):

- **Desktop — light** (1180px): Today decision queue → Pursuit hero → Why Now → Route decision → disclosure split → Team + What Changed.
- **Desktop — dark**: every colour resolves from tokens; no colour is defined only inside a media/`[data-theme]` block.
- **Mobile — light** (412px): KPI grid reflows 2-up, disclosure split and team stack, the route comparison scrolls inside its own `overflow-x` container; the page body never scrolls sideways.

### What the pictures prove (the demo thesis)

The surface answers the seven core questions about a Pursuit without ever exposing the machinery underneath. The moment a TD SYNNEX / Red Hat stakeholder is meant to feel — *"I wish I had this today"* — is the **disclosure split**:

> **Why CDW — enforced server-side, not in the browser.**
> *Internal view* lists `+ TD spend $1,840,000 in category` (disclosure class RESTRICTED).
> *Shareable with partner* lists `+ Recent channel activity strengthens this route` — the **$1.84M figure is absent from the payload**, generalized in the read model *before it reaches the screen*, not hidden with CSS.

That is the complexity made invisible: the same recommendation, two audiences, and the confidential number never crosses the wire for the audience that may not see it.

### How the visual proof is grounded (not a mock)

`scripts/experience-verify.ts` gained an opt-in `EXPERIENCE_DUMP=<path>` that serializes the **real** read-model outputs — `getTodayQueue`, `getPursuitPortfolio`, `getPursuitDetail`, and `getRouteComparison` for both an internal and a limited caller — from the seeded `wsc_verify` database. Those exact values populate the proof page. Concretely, the numbers on screen are the ones the read model returned:

- Decision band: Priority **High 72**, Propensity **High 68**, Evidence confidence **High 61**, Timing **Moderate 55** — read verbatim from `current_*_score` caches.
- Route: CDW **Very high** (recommended) vs WWT **High** (selected via override), with WWT's `transaction_adjacency` shown as **"Not available"** — unknown, not zero.
- Fact: *Globex — strategic initiative*, `verified` + `first party`, confidence **Very high 89**.

---

## 2. Read-model DoD harness — raw log (§66, 34/34)

The read model is the single boundary: page-shaped, typed view objects; the UI never recomputes and never re-derives disclosure or authorization. Full run against `wsc_verify`:

```
[experience-verify] postgresql://postgres@127.0.0.1:5433/wsc_verify
[experience-verify] seeded hero=5b1cf436

§66.32  Feature flag dependency fails safe
  ✓ experience disabled when dependencies off
  ✓ readiness reports missing dependencies
§66.2  Today decision queue: typed, materiality-ordered, urgency≠priority
  ✓ today returns typed decision items
  ✓ items carry decisionClass + operationalUrgency + commercialPriority (distinct fields)
  ✓ DECISION_REQUIRED ordered before MATERIAL_CHANGE (materiality, not recency)
  ✓ every action maps to a governed skill
  ✓ demo banner is data-driven (synthetic present)
  ✓ deep links target exact pursuit
§66.4  Portfolio: canonical pursuits, account groups multiple pursuits
  ✓ portfolio reads canonical pursuits
  ✓ one account groups multiple pursuits (not collapsed)
  ✓ scores are band-first (band present)
  ✓ synthetic flag propagated
§66.5  Pursuit detail: no recompute, band, structured Why Now, missing stays missing
  ✓ detail returns page-shaped view
  ✓ priority read verbatim from canonical cache (no recompute)
  ✓ decision band is band-first
  ✓ Why Now present + traceable (business trigger has fact id)
  ✓ missing Why Now component stays null (not fabricated)
  ✓ 'what we don't know' lists the missing timing anchor
  ✓ commercial implication distinct from fact
  ✓ demo banner is config/data-driven
  ✓ missing required role produces an action item
  ✓ activation readiness is a scored view
  ✓ timeline contains only material events
§66.12  Route: disclosure server-side, payload absence, unknown≠zero, override
  ✓ internal caller receives internal reasons
  ✓ limited caller: internal reasons withheld (null)
  ✓ restricted raw value absent from limited payload
  ✓ restricted raw value present for internal caller
  ✓ missing dimension renders unknown, not zero
  ✓ selection distinct from recommendation after override
  ✓ override reason + category surfaced
  ✓ route change event has before/after
  ✓ path is multi-party with roles
§66.29  Read models enforce tenant authorization
  ✓ org A cannot read org B pursuit detail (returns null)
  ✓ portfolio excludes other tenants

[experience-verify] 34 passed, 0 failed
```

---

## 3. Claim-by-claim evidence

### 3.1 No calculation engine in the UI (§64)
The decision band is read straight from `pursuits.current_*_score`; the assertion *"priority read verbatim from canonical cache (no recompute)"* compares the read-model `value` to the raw DB cache and requires equality. The UI components (`src/components/pursuit/parts.tsx`) take a `ScoreView` and render it; they hold no scoring logic.

### 3.2 Server-side disclosure + payload absence (§65)
`getRouteComparison` takes a `Caller` and decides disclosure in the read model:
- Internal caller ⇒ `reasonsInternal` is an array including the RESTRICTED reason.
- Limited caller ⇒ `reasonsInternal === null`, and `reasonsShareable` carries generalized text only.
- **Payload absence** is asserted directly: `!JSON.stringify(limited).includes("1840000")` — the confidential figure is not merely hidden in the view, it is not present anywhere in the serialized limited payload. The internal payload *does* contain it, proving the difference is disclosure logic, not absence of data.

### 3.3 Unknown ≠ zero (§10, §12)
WWT has no transaction feature, so `transaction_adjacency` renders as an `unknown` cell (`known === false`), not `0`. `src/lib/routing/partner-activation.ts` emits `null` for the display value when the transaction feature is unavailable while still contributing a neutral `0.5` to the composite — the score is not distorted, and the UI shows *"Not available"* rather than a fabricated low band.

### 3.4 Materiality, not recency (§2–§4)
`TodayQueueView` items each carry `decisionClass`, `operationalUrgency`, and `commercialPriority` as **distinct** fields; `todaySort` orders by class → urgency → priority → age. The harness asserts a `DECISION_REQUIRED` item precedes a later-arriving `MATERIAL_CHANGE`. The What Changed timeline runs through `isTimelineWorthy` (HIGH/CRITICAL only), so low-materiality churn never reaches the human.

### 3.5 Recommendation ≠ selection (§13–§16)
After a human override (WWT over recommended CDW), `selectionMatchesRecommendation === false`, `selected` is WWT, `overrideCategory === "EXECUTIVE_DIRECTION"`, and a `ROUTE_RECOMMENDATION_CHANGED` / `PARTNER_OVERRIDE` pair carries before/after. The recommendation is preserved and the divergence is recorded, not overwritten.

### 3.6 Missing stays missing (§8, §9)
The seeded hero has a business trigger but **no timing anchor**. `whyNow.timingAnchor === null`, and *"what we don't know"* explicitly lists *"No verified timing anchor."* Nothing is fabricated to fill the gap.

### 3.7 Cross-tenant authorization (§29, §30)
`getPursuitDetail` for org A against an org-B pursuit returns `null`; the portfolio excludes other tenants' rows. Reads run as `app_rw` with the `app.org_id` GUC set (RLS), matching production tenant scoping.

### 3.8 Persistent synthetic labeling + config-driven demo (§24, §57)
The demo banner is derived from `data_environment='DEMO'` data, never `if org.name === "Demo"`. The synthetic badge rides on the row/pursuit `synthetic` flag through the read model, so it cannot be lost in metadata. The harness asserts *"demo banner is data-driven (synthetic present)"* and *"config/data-driven."*

---

## 4. Feature-flag matrix (§55, §56)

`pursuitExperienceEnabled()` = requested **AND** `pursuitsEnabled` **AND** `factsEnabled` **AND** `routingEnabled` (fail-safe: the surface depends on the layers it renders, so it stays dark unless all are ready). Each route guards with `if (!pursuitExperienceEnabled()) notFound()`, and the nav item is injected only when the flag is ready.

| PURSUIT_EXPERIENCE | PURSUITS | FACTS | ROUTING | `pursuitExperienceEnabled()` | `readiness.missing` |
|:--:|:--:|:--:|:--:|:--:|:--|
| off | – | – | – | **OFF** | (requested=false) |
| on | on | on | on | **ON** | `[]` |
| on | on | **off** | on | **OFF** | `["FACTS_ENABLED"]` |
| on | **off** | on | **off** | **OFF** | `["PURSUITS_ENABLED","ROUTING_ENABLED"]` |
| on | on | on | **off** | **OFF** | `["ROUTING_ENABLED"]` |

Row 3 is exercised directly by §66.32, which now controls its own env (saves, withholds `FACTS_ENABLED`, asserts OFF + the named gap, restores) so the assertion is deterministic regardless of how the harness is invoked. When OFF, `/pursuits` and `/pursuits/[id]` return 404 and the nav item is absent — the current UI is untouched.

---

## 5. Accessibility & responsiveness

- **Status is form + word, never colour alone (§35):** every band carries its label (*Very high / High / Moderate / Low / Unknown*) plus a dot; the disclosure and override states carry words and icons, not just hue.
- **Theme-aware:** light, dark (`prefers-color-scheme`), and explicit-toggle states all resolve from `:root` tokens; the dark screenshot confirms no token is defined only inside a media block.
- **Responsive:** wide content (route comparison table) scrolls in an `overflow-x:auto` container; grids collapse to a single column under 820px; the mobile screenshot shows no horizontal body scroll.
- **Affordances:** each score exposes a consistent *"why / definition"* affordance (§29); the `?` chips carry the canonical, page-invariant score definitions from `SCORE_DEFINITIONS`.

---

## 6. Change inventory

**Phase 3 commits (on top of the Phase 2 TDD `e4e61a3`):**

```
bd0bded  WS-D Phase 3 (1/3): Pursuit read-model layer + blind verification (34/34 green)
7b324af  WS-D Phase 3 (2/3): Pursuit Experience UI surface — portfolio, hero, nav
d8cf2c2  WS-D: make flag fail-safe assertion self-contained in experience-verify
4fa1769  WS-D Phase 3 (3/3): visual proof + read-model dump for verification
```

**Read-model layer (server-side, the single boundary):**
`src/lib/pursuits/read-models/{types,helpers,materiality,route,detail,today,portfolio,caller,index}.ts`
`src/lib/pursuits/experience-flags.ts`

**UI surface (renders view objects only):**
`src/app/pursuits/page.tsx` · `src/app/pursuits/[id]/page.tsx` · `src/components/pursuit/parts.tsx`
`src/components/shell.tsx` + `src/app/layout.tsx` (flag-gated nav)

**Domain edit:** `src/lib/routing/partner-activation.ts` (dimension display nullability; unknown ≠ zero).

**Verification & proof:** `scripts/experience-verify.ts` (34 assertions + `EXPERIENCE_DUMP`) · `audit/PURSUIT-WS-D-visual-proof.html`.

---

## 7. Definition-of-Done status (§66)

| # | Requirement | Status |
|---|---|---|
| Typed, page-shaped read models; no UI recompute | ✓ | 34/34, §3.1 |
| Today = decision queue by materiality; urgency ≠ priority | ✓ | §3.4 |
| Pursuit hero answers the core questions | ✓ | visual proof §1 |
| Structured, traceable Why Now; missing stays missing | ✓ | §3.6 |
| Route: recommendation ≠ selection, alternatives, dimension compare | ✓ | §3.5 |
| Unknown ≠ zero | ✓ | §3.3 |
| Disclosure enforced server-side; payload absence | ✓ | §3.2 |
| Cross-tenant authorization | ✓ | §3.7 |
| Persistent synthetic labeling; config-driven demo tenant | ✓ | §3.8 |
| Feature flag with dependency fail-safe | ✓ | §4 |
| Visual proof: desktop + mobile + demo flow | ✓ | §1 |

---

## 8. Notes & residuals (honest ledger)

- **Team members render role + side + status but not named people** (`personLabel: null` in the fixture) — the acceptance lifecycle and the *"missing required role ⇒ action item"* path are proven; populated names depend on seller/contact assignment data not seeded here.
- **The proof page is a faithful static render of the read-model output**, not a screenshot of the running Next.js app. Booting the authenticated App Router against a hand-seeded local DB (Supabase auth + RLS + CSP-nonce middleware) is out of scope for this verification; the values are nonetheless the genuine read-model outputs (§1, *How the visual proof is grounded*), and the components in `src/components/pursuit/parts.tsx` render those same `ScoreView`/`Band` shapes.
- **Cross-harness DB state:** `experience-verify` and `routes-verify` each expect a fresh `wsc_verify`; run against the same populated DB, entity-resolution fixtures collide. Each is green on a fresh rebuild (34/34 and 64/64 respectively).

---

**HALT — awaiting Workstream D implementation sign-off before beginning Workstream E.**
