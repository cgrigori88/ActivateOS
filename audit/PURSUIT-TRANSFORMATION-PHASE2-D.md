# Workstream D — Pursuit Experience / Decision Surface · Phase 2 Technical Design

**Foreman-Architect Phase 2 (Technical Design). No code until sign-off.** Grounded in a full
map of the existing front end (Next.js 16 App Router, React 19, Tailwind v4 `@theme`, server
components + `withTenant`). Design mode per `/impeccable`: **Operate** — the operator's success
is completing a commercial decision; scanability, consistency, and the real field scene outrank
expression, and brand lives in precise details on the Pursuit hero. impeccable's build/verify
pipeline (context.mjs, craft-floor, batched screenshot QA on desktop+mobile) runs in Phase 3.

**Objective:** make everything A/B/C built feel **obvious, credible, fast, and actionable** to a
human operator, organized around the canonical **Pursuit** — not legacy tables. The mental model:
*What changed? What deserves attention? Why now? What do we know? How confident? Who should
pursue it, through what route? What's next? What needs my decision?*

## 0. What exists (reuse) vs. net-new

| Exists — reuse | Where |
|---|---|
| App shell / rail / ⌘K palette / room-pair tabs / badges | `src/components/shell.tsx`, `command-palette.tsx`, `room-tabs.tsx`, `layout.tsx` |
| Design kit | `src/components/ui.tsx` (Button, Card, Bento, BandBadge, StatusBadge, DimensionBars, EvidenceLine, MiniBar, CountChip, NextStep, PageHeader, CompletenessGrid) |
| Design tokens | `src/app/globals.css` `@theme` — accent, band very-high/high/medium/low, positive/negative, categorical ramp, radius + type scales, glass materials; blanket normalization auto-styles additive markup |
| The decision-surface **template** | `src/app/accounts/[id]/page.tsx` (score dims + why-now + evidence + partner-fit + motion + timeline via `withTenant` + loaders) |
| Tenant scoping / RLS | `withTenant` / `withTenantOrg` (`src/lib/db/tenant.ts`) |
| Feature-flag convention (env reader, default OFF) | `src/lib/{pursuits,facts,routing}/flags.ts` |
| CSP/nonce, responsive (mobile drawer, 44px targets, reduced-motion) | `src/proxy.ts`, `globals.css` |

| Net-new for D |
|---|
| **A canonical read-model layer** — page-shaped views over A/B/C that enforce authorization + disclosure server-side (none exists today). |
| **The entire Pursuit-entity UI** — no `/pursuits` route exists; every UI "pursuit" today is the *joint* co-sell entity. |
| **First UI consumption of a feature flag** — `PURSUIT_EXPERIENCE_ENABLED` gating nav + routes. |
| Pursuit-shaped components (decision band, structured Why Now, route-comparison, team-lifecycle, what-changed timeline). |

## 1. Information architecture & navigation (§1)

Primary product nav (reframed around the Pursuit): **Today · Pursuits · Ecosystem · Campaigns ·
Pipeline · Insights · Ask**. Support/admin (kept out of the primary loop): Sources, Reviews,
Provider health, Trust, Skills, Routines, Settings/Admin. Implemented additively in `shell.tsx`'s
`NAV` (a new "Pursuits" item + "Ecosystem" reframing Partners/Joint), **gated by
`pursuitExperienceEnabled()`** so the current rail is untouched when the flag is off. Engineering/
DB concepts never appear as primary nav. `Accounts` becomes a lens *inside* Pursuits (an account
shows its multiple Pursuits), not a competing top-level object.

## 2. Today — the operating queue (§2/§28/§32)

Today stops being a KPI homepage and becomes *"what needs me now."* Card groups: **Decisions**
(route awaiting approval, Fact needing review, seller/team decline, reroute required, Motion
awaiting approval) · **Material changes** (new strong trigger, confidence jump, timing moved,
route changed, customer replied, opportunity created) · **Next Best Actions** · **Highest-value
Pursuits** (priority = commercial value × propensity × timing × confidence × readiness × material
change — not raw score). Attention is tiered **Critical · Needs decision · Material change ·
Recommended action · FYI** (§28) — the system earns attention rather than dumping 40 alerts. Read
model: `getTodayQueue(db, orgId)`. Extends the existing `rankNextActions` / divergence pattern.

## 3. Pursuits portfolio (§3)

The canonical portfolio. An account may hold **multiple Pursuits**. Columns: Account · Pursuit ·
Solution/Category · Priority · Purchase Propensity · Evidence Confidence · Timing · Recommended
Route · Route Confidence · Activation Readiness · Stage · Expected Value · Last Material Change ·
Next Best Action. Filters: priority, propensity, confidence, timing, solution, partner, seller,
route status, team readiness, stage, industry, territory, change recency. Optimized to answer
*"what should I work next?"* — not to maximize columns. Read model: `getPursuitPortfolio`. Reuses
`data-table` (band-colored row edges via `:has([data-band])`), `CountChip`, `SortHeader`.

## 4. Pursuit detail — the hero surface (§4-15)

The strongest screen in the product. Structure:

1. **Header** — account · Pursuit thesis · solution/category · lifecycle · expected value · last
   material change.
2. **Commercial decision band** — Pursuit Priority · Purchase Propensity · Evidence Confidence ·
   Timing · Route · Activation Readiness. **No false-precision win probability** (§4/§48) — bands +
   directional scores, each with a **"Why?"** affordance (§29).
3. **Why Now** (§5) — the first narrative surface, synthesized from the structured B/C snapshot and
   **traceable**: Business Trigger · Technology Condition · Timing Anchor · Signal Convergence ·
   Route Relevance · Contradictory Evidence, each expanding to source refs. Polished prose is
   *rendered from* the structured snapshot, never authored freehand. Carries **What Changed** +
   **View supporting context**. Read model: `getPursuitWhyNow`.
4. **Confidence, understandable** (§6/§7) — not "83" but Strong (✓ first-party, ✓ two independent
   corroborators, ✓ recent) / Missing (○ renewal date unverified). **Contradictions surfaced**, not
   averaged away ("Conflicting evidence detected" + explanation).
5. **Route Decision card** (§8/§9/§10) — the recommended **path** (Vendor → Distributor → Reseller →
   Customer), Route Score · Route Confidence · Suitability · Readiness (all distinct), **Why CDW?**
   (structured reasons), **Alternatives** (WWT 82 · Insight 74 · Direct 63) with **Compare routes**
   and **Why not WWT?**. **Recommended vs Selected** shown explicitly with override reason (§9) —
   never imply the system recommended the overridden choice. **Route change timeline** (§10): "new
   distributor-derived signal → recommended route WWT → CDW" expandable to the score delta. Read
   model: `getRouteComparison`.
6. **Pursuit Team card** (§11/§12) — actual roles + acceptance state + readiness + what's missing
   ("Partner Architect not yet accepted"); seller recommendation with fit + reasons + alternatives;
   assignment is a deliberate action. Read model: `getPursuitTeam`.
7. **What Changed timeline** (§13) — material Change-Ledger events + interactions (Fact promoted,
   propensity up, route changed, seller accepted, customer replied, opportunity created); background
   processing noise excluded. Read model: `getPursuitTimeline`.
8. **Evidence drawer** (§14/§15) — progressive disclosure: commercial conclusion → why → exact
   evidence/source provenance. Facts render **distinctly** by state: Verified · Disputed · Stale ·
   Hypothesis/thesis — never all equally authoritative.

Follows the account-detail template (one `withTenant` region + read models), but reads the new
pursuit read-models instead of inline SQL.

## 5. Ask — first-class decision support (§16/§17)

Ask operates over **governed Pursuit context** (respecting disclosure class + tenant auth), citing
internal supporting objects: *why ranked highly, why now, what changed this week, why CDW not WWT,
what's missing, which seller, strongest risks, which Pursuits to focus on, where distributor data
changed the route.* Commands (*approve this route, assign the recommended seller, create a Motion,
request a warm intro*) resolve **only to governed Skills** with explicit side-effect class (C's
`ROUTING_SKILLS` registry) — **freeform chat never mutates state directly** (§17). Extends the
existing read-only Ask loop (`src/lib/agents/ask.ts`) by adding pursuit-context tools and a
command→Skill resolver; the write path stays gated behind the Skill's side-effect + consent checks.

## 6. Ecosystem, Campaigns, Pipeline, Insights (§18-22)

- **Ecosystem** (§18/§19) reframes Partners/Joint: partners · sellers · relationships · coverage ·
  capabilities · shared Pursuits · warm-intro paths. A partner profile emphasizes **actionable
  relationship truth** — "where can this partner create advantage now?" (strongest relationships,
  active Pursuits, uncovered opportunities, seller-coverage gaps, capabilities, warm-intro paths) —
  not a static PRM directory. Only metrics backed by real data.
- **Campaigns** (§20) stay execution-focused: a campaign operates on **Pursuits** (may contain
  several); the campaign is a means of activation, not the strategic truth.
- **Pipeline** (§21) distinguishes **Pursuit** from **CRM Opportunity**, with the funnel Detected →
  Qualified → Activated → Customer Engaged → Opportunity → Pipeline → Won — measuring opportunity
  *creation*, not just imported pipeline.
- **Insights** (§22) becomes portfolio/learning intelligence (which triggers yield qualified
  Pursuits, which routes activate fastest, where overrides concentrate). **Scaffold only what real
  data supports; never manufacture benchmarks** (§53).

## 7. Trust, disclosure & synthetic labeling (§23/§24/§25)

Persistent trust labels wherever they apply — **Verified · Disputed · Synthetic · First-party ·
External · Human-asserted**. Synthetic distributor inputs carry a **persistent visible** badge
("Synthetic distributor signal / illustrative transaction-derived intelligence") — never a hidden
metadata field only (§24). Route explanations render **disclosure-safe**: the shareable view
generalizes confidential transaction detail ("recent adjacent-category channel activity"), the
internal view retains permitted detail — filtering happens **server-side** in the read model
(C's `route-why-now` internal/shareable split), never "fetch everything, hide in the frontend"
(§25/§39).

## 8. Decision affordances (§26/§27)

Decision cards carry explicit actions — Approve / Override / Request Review; Assign / Choose
Alternative / Invite; Accept / Reject / Edit / Unsure — never buried in generic edit forms.
**Friction is proportional to impact** (§27): low-risk internal actions one-click; cross-tenant
invitation, customer communication, partner introduction, external launch **visibly confirm
scope/recipient/action**. D designs these affordances; **E implements the execution** (§45) — D
exposes Launch Motion / Request Intro / Send Outreach as controlled affordances/stubs mapping to
Skills.

## 9. Read models & API boundaries — the architectural core (§37/§38/§39)

New `src/lib/pursuits/read-models/`: `getTodayQueue` · `getPursuitPortfolio` · `getPursuitDetail`
· `getPursuitWhyNow` · `getRouteComparison` · `getPursuitTeam` · `getPursuitTimeline`. Each takes
`(db, orgId, …)` under `withTenant`, returns a **page-shaped view**, and **enforces authorization +
disclosure server-side**. The UI **never recomputes** Pursuit scores, Fact confidence, route/seller
ranking, or readiness (§37/§43) — those come from A/B/C services. Confidential route reasons are
policy-filtered before they leave the server (§39). This establishes the read-model convention the
codebase lacks today.

## 10. Design system (§34/§35/§36)

Reuse `ui.tsx` + `globals.css` tokens; add pursuit semantic tokens: **priority · confidence ·
propensity · readiness · fact-state · route-state · decision-state · synthetic · risk · success ·
warning** (extending the existing band/positive/negative ramp — no one-off hexes). **Status is never
color alone** (§35): color + icon + text label (+ shape/badge) for Very High, Disputed, Synthetic,
Critical, Declined. Page hierarchy is strictly **decision → context → explanation → evidence**
(§36) — not 40 metrics for the user to triage. New components live in `src/components/pursuit/*`
(DecisionBand, WhyNowPanel, ConfidenceExplain, RouteCompare, TeamLifecycle, WhatChanged,
TrustLabel, ScoreWhy) built from the existing kit.

## 11. URLs, deep links, states (§40-44)

Stable-id URLs: `/pursuits`, `/pursuits/:id`, `/pursuits/:id/route`, `/pursuits/:id/evidence`,
`/ecosystem/partners/:id`. **Deep links** from Today items / Ask answers / What-Changed events land
on the exact Pursuit / route comparison / review item (§41). **Empty states** state the gap ("No
verified timing anchor yet", "No partner route selected") and **never fabricate** (§42). **Failure
states** degrade gracefully ("Distributor intelligence temporarily unavailable — route uses
relationship + capability context only"), never crashing detail or showing stale-as-fresh (§43).
**Freshness** shown where it matters ("Updated 18 min ago", "Last transaction refresh Aug 27",
§44).

## 12. Responsive & accessibility (§30/§35)

CSS-responsive (reuse the mobile drawer, 44px targets, horizontal-scroll affordances, reduced-
motion). Mobile: Today works well; Pursuit detail collapses intelligently (decision band →
stacked; tables → cards); decision actions stay usable; Ask is mobile-native. Keyboard + a11y
basics (focus rings, aria on decision controls, status not color-alone).

## 13. Feature flags & rollback (§48)

New `src/lib/pursuits/experience-flags.ts` → `pursuitExperienceEnabled()` reading
`PURSUIT_EXPERIENCE_ENABLED` (default OFF). Gates the new nav items, routes, palette entries, and
badges. **OFF preserves the exact current UX** (rollback = unset). `PURSUITS_ENABLED` /
`FACTS_ENABLED` / `ROUTING_ENABLED` stay OFF for production tenants; the demo tenant opts in via
config. CSP: any new inline `<script>` takes the `x-nonce`; inline styles are already allowed;
mirror `maxDuration=60` on AI-backed Pursuit actions.

## 14. File targets

Routes: `src/app/pursuits/page.tsx`, `src/app/pursuits/[id]/page.tsx`,
`src/app/pursuits/[id]/route/page.tsx`, `src/app/pursuits/[id]/evidence/page.tsx`, Ecosystem
reframing under `src/app/ecosystem/*` (reusing partners/joint loaders). Read models:
`src/lib/pursuits/read-models/*.ts`. Flag: `src/lib/pursuits/experience-flags.ts`. Components:
`src/components/pursuit/*`. Wiring: `shell.tsx` NAV, `command-palette.tsx` ROOMS, `layout.tsx`
badges (all additive, flag-gated). Ask: extend `src/lib/agents/ask.ts` + a command→Skill resolver.

## 15. Demo fixtures & flow (§31/§32/§33)

Seed **3–4 hero Pursuits**: **A** clear (strong evidence, clear route) · **B** distributor flip
(WWT→CDW after synthetic distributor signal) · **C** uncertain (high potential, conflicting/
insufficient evidence) · **D** partner decline/reroute. Today surfaces exactly: 1 route changed,
1 decision awaiting approval, 1 new high-confidence trigger, 1 team member declined. Minimal-click
demo path: **Today → Pursuit → Why Now → Route → What Changed → Approve/Override → Team → Next** —
no dependence on admin pages.

## 16. Tests, performance, accessibility (§46/§47)

- **Read-model tests** (blind harness, `app_rw` + GUC): each read model returns the correct
  page-shape, enforces disclosure (shareable hides confidential; internal retains), enforces tenant
  authorization (cross-tenant returns nothing), and **does not recompute** canonical scores (values
  equal the domain services').
- **UI smoke** via the pre-installed Chromium/Playwright against a seeded demo tenant: the hero flow
  end-to-end; mobile Today + Pursuit detail; empty/failure/freshness states; flag-OFF renders the
  legacy UX unchanged.
- **impeccable audit/critique** (a11y, responsive, craft floor) run in Phase 3 with screenshots.
- Performance: server components + batched read-model queries; `maxDuration` on AI actions;
  reduced-motion honored.

## 17. Definition of Done (§47) — wired to the harness + smoke

All 46 criteria: Today decision queue + materiality priority · portfolio reads canonical Pursuits ·
account→multiple Pursuits · detail shows canonical current state · Why Now structured + traceable +
missing-stays-missing · confidence explanation · contradictions visible · Fact states distinct ·
route winner + alternatives + "Why CDW?"/"Why not WWT?" · score/confidence/readiness distinct ·
recommendation vs selection + override rationale + route history + distributor flip · synthetic
label persists · shareable hides / internal retains · seller candidates + assignment state · team
lifecycle + missing-role lowers readiness · decline/reroute renders · What Changed uses material
ledger · evidence drill-down to sources · Ask governed + auth + disclosure · decisions map to
Skills · cross-tenant action shows consent · empty states don't fabricate · provider failure
degrades · freshness visible · mobile Today + detail + desktop · keyboard/a11y basics · **server-
side policy filtering verified · UI does not recompute canonical scores** · flag-OFF preserves UX ·
hero demo flow end-to-end · **build/types/tests green**.

## 18. Boundaries & standing constraints

- **D owns understanding + decision UX; E owns execution + feedback** (§45). Launch/Intro/Outreach
  are controlled affordances/stubs here.
- **Do not begin** Pipeline execution, real email, CRM integration, production distributor
  connectivity, Slack/Teams, or full activation — those are D/E/G/H/I boundaries the directive draws.
- **Production stays dark** (§48): `PURSUITS_ENABLED` / `FACTS_ENABLED` / `ROUTING_ENABLED` /
  `PURSUIT_EXPERIENCE_ENABLED` OFF for production tenants; no production enablement.
- **The final pre-demo release gate remains separate** (§49): Workstream I must still run, in the
  real deployment environment, remote-HEAD verification, full app boot, real DB migrations, RLS
  regression, the feature-flag matrix, demo-tenant isolation, seed + read-model validation, UI + Ask
  smoke, provider-failure and rollback tests. The isolated harnesses do not replace that.

---

## HALT — awaiting Phase 2 (Workstream D) design sign-off

On approval I will run impeccable's build pipeline and execute Phase 3 (atomic implementation:
read models → flag + nav → portfolio → Pursuit hero → Why Now → route/team → Ask → Ecosystem/
Pipeline framing → demo fixtures), then Phase 4 verification (read-model harness + Chromium UI
smoke + impeccable audit), and return a Workstream D Phase 4 Verification Report before any
production enablement.
