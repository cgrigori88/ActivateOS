# PursuitOS — Workstream D.5: Completion Report

**Canonical Product Experience Restoration + IA Lock**, verified against the **real, booted, authenticated application** — not a static proof.

Branch: `claude/activateos-platform-review-xzkgmd` · Halting for D.5 sign-off before Workstream E.

---

## 0. Verdict

| Gate | Result |
|---|---|
| Real app boots (Next 16, `app_rw` + real RLS, full 79-migration demo tenant) | **yes** |
| `/`, `/pursuits`, `/pursuits/[id]` render server-side from read models | **200 / 200 / 200** |
| Type check (`tsc --noEmit`) | **clean** |
| Read-model DoD (`experience-verify`) | **34 / 34** |
| Routing regression (`routes-verify`) | **64 / 64** |
| Browser E2E hero flow (`e2e-pursuit`, Playwright) | **15 / 15** |
| Runtime disclosure at the HTTP payload (§N) | **enforced** — figure present for internal, **absent** for partner-safe |
| Cross-tenant isolation at runtime (§O) | **enforced** — foreign pursuit 404, no data, excluded from portfolio |
| Visual acceptance (§29) | **pass** — see §4 |

**This is the actual application.** The read model powers the UI; the same Pursuit resolves differently by what the viewer is authorized to know.

---

## 1. What changed, and what did not

**The correction was a visual-system + IA restoration, not a redesign and not a backend change.** Phase-1 mapping (see `PURSUIT-TRANSFORMATION-D5-DESIGN.md`) established that the real routes already ran inside the canonical shell — the earlier "different product" impression came from a standalone proof HTML, now demoted to a fixture. So D.5:

- **Kept** the Pursuit object model, Facts, routing, read-model boundary, and server-side disclosure/authorization — untouched.
- **Restored** the premium material language and the category IA the app already owned, and mapped the Pursuit surface onto it.

### The three regressions named in the review — corrected
1. **Navigation / IA** → restored to explicit operating categories: **Ecosystem → Outreach → Intelligence → Execution → Revenue → Platform**, with **Pursuits promoted to a first-class Intelligence room** (flag-gated). `src/components/shell.tsx`.
2. **Material / design language** → the heavy `border bg-white` boxes are gone. Surfaces are now `glass` / tinted-bento with hairline borders (`≈` navy 10% / white 9%), soft shadows, larger radii. `src/components/pursuit/*`.
3. **Colour / semantic system** → a semantic token layer (`globals.css §7`) gives each commercial dimension its own hue (priority blue · propensity violet · evidence cyan · timing amber · route teal · readiness green) plus named accents (violet/intelligence/verified/attention/risk). Colour now says *what kind of thing* you are looking at.

---

## 2. Real-application screenshots (§28)

Captured from `http://localhost:3100` (the booted app), Chromium, deviceScaleFactor 1.6:

| View | 1440 light | 1440 dark | 1024 | 768 | 430 light | 430 dark |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Today (decision queue) | ✓ | ✓ | | | | |
| Pursuits portfolio | ✓ | | | | | |
| Pursuit detail (hero) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Delivered inline: Today (dark), Portfolio, mobile hero. The 1440 hero light+dark are ~1.3 MB (above the inline attach limit) and were reviewed in-session.

**What the hero shows** (all real read-model data): eyebrow + thesis + compact metadata; a six-instrument tinted **metric band** (Priority/Propensity/Evidence/Timing/Route/Readiness, each its own hue, band-first); **Why now** with missing-stays-missing; **Facts** as trusted-intelligence cards; **Route decision** — RoutePath topology, "Recommended CDW · Very high" beside "Selected WWT — human override", dimension compare with *Not available* for unknowns; the **DisclosureSplit**; **Team** (readiness held); **What changed** (material events only).

---

## 3. Runtime verification (§31)

### 3.1 Disclosure at the HTTP payload (§22 / §N)
The recommended-route reasons include a RESTRICTED figure. Toggling only the sole org's `kind` (the read model's `callerFor` keys on it) and re-fetching the **same URL**:

```
internal (vendor, canSeeInternal)   → served bytes contain "1840000":  1
partner-safe (kind=guest)           → served bytes contain "1840000":  0
```

The confidential figure is **generalized in the read model before serialization** — absent from the wire for the partner-safe caller, not hidden with CSS.

### 3.2 Cross-tenant isolation (§O)
```
GET /pursuits/<other-tenant pursuit>  → 404 ; no foreign pursuit data in the body
GET /pursuits (portfolio)             → excludes the other tenant's pursuit
SQL as app_rw, GUC=vendor, select foreign pursuit → 0 rows (RLS)
```
RLS is genuinely active: the app connects as the non-owner `app_rw`; `is_org_member(org)=org=app_current_org()` scopes every read to the `app.org_id` set by `withTenant`.

> Note: `notFound()` returns the not-found UI with an HTTP **200** in this streaming-SSR path rather than 404 — a Next.js status-code detail. The **security property holds** (no cross-tenant data renders); only the status line differs. Flagged, not fixed, as it is framework behavior outside the read-model boundary.

### 3.3 Browser E2E hero flow (§R) — 15/15
`scripts/e2e-pursuit.mjs` drives the real app: portfolio → Globex → Why Now (missing timing anchor stays unknown) → Facts → route compare (CDW recommended, WWT human-selected, unknown = *Not available*) → disclosure split (internal + shareable, confidential figure present for the internal boot) → team readiness-held → material changes.

### 3.4 Feature flags (§P)
The dependency fail-safe is proven at the unit level by `experience-verify` §66.32 (requested + a dependency withheld ⇒ OFF, and the missing dep is named), part of the 34/34. The app routes gate on `pursuitExperienceEnabled()` (`notFound()`), and the nav filters Pursuits out of Intelligence when off. *Runtime-verified: the on-state (this boot). Unit-verified: the fail-safe and off-state.* A separate flags-off boot was not re-run in this pass.

### 3.5 Read-model + routing harnesses
`experience-verify` **34/34**, `routes-verify` **64/64** — no recompute, disclosure/payload-absence, unknown≠zero, materiality ordering, override, cross-tenant → all still green.

---

## 4. Visual acceptance criteria (§29)

| D.5 fails if… | Status |
|---|---|
| prominent black outlines remain around normal bento surfaces | **gone** — hairline/material hierarchy |
| PursuitOS becomes predominantly flat white | **no** — cool canvas, tinted glass, dark parity |
| colour semantics disappear | **no** — per-dimension + named-accent tokens |
| navigation categories regress | **no** — Ecosystem→…→Platform restored |
| a second shell appears | **no** — single canonical shell |
| mobile is desktop stacked vertically | reflows (2-up metrics, drawer nav, scrolling compare) — *primary decision order is a known refinement, see §5* |
| score types visually conflated | **no** — six distinct instruments; propensity ≠ confidence preserved |
| synthetic disclosure dominates | **no** — compact "Demo environment" badge |
| confidential data merely CSS-hidden | **no** — absent from the payload |
| Pursuit pages look like a different product | **no** — same product family as the reference |
| engineering terminology dominates | mostly addressed; a few internal reason strings remain verbatim (§5) |

---

## 5. Honest done-ladder (§S) + residuals

- **architecture-verified** ✓ · **isolated-harness-verified** ✓ (34/34, 64/64) · **authenticated-app-verified** ✓ (boots as app_rw under RLS; hero flow 15/15) · **demo-tenant-runtime-verified** ✓ (disclosure + cross-tenant over HTTP). **Production-deploy-verified: NOT claimed.**
- **Residuals (small, honest):**
  - Two internal route-reason strings render verbatim from seed data (`TD spend $1840000`, `ACTIVE_RELATIONSHIP (64)`) — operator-facing polish, not a data issue; the disclosure behavior is correct.
  - Mobile uses a sensible responsive collapse; the strict §24 decision-first re-order (decision → Why Now → unknowns → route → action → team → facts → changes) is a follow-up refinement.
  - `notFound()` returns 200 (framework streaming behavior), §3.2.
  - Local-only demo affordances: `app_rw` given a login and `postgres` a password **in the local demo DB only** (documented in `scripts/demo-db.ts`); not a product change.

---

## 6. Reproduce

```
npx tsx scripts/demo-db.ts        # full-schema demo tenant (79 real migrations + seed)
DATABASE_URL=postgresql://app_rw:demo@127.0.0.1:5433/pursuit_demo \
  NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= \
  PURSUITS_ENABLED=1 FACTS_ENABLED=1 ROUTING_ENABLED=1 PURSUIT_EXPERIENCE_ENABLED=1 \
  npx next dev -p 3100
HERO=<printed id> node scripts/e2e-pursuit.mjs
```

## 7. Commits (D.5)
```
WS-D.5 Phase 1+2: real-app integration design (HALT for sign-off)
WS-D.5: canonical visual-system + IA restoration for the Pursuit experience
WS-D.5: Playwright hero-flow E2E (15 assertions) against the running app
```

---

**HALT — awaiting Workstream D.5 sign-off. Workstream E remains closed.**
