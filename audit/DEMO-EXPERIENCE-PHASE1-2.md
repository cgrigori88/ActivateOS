# Design Partner Demo Experience & Product Polish — Phase 1 + Phase 2

**Bounded workstream. Design only — no code written. Halt for sign-off before Phase 3.**
Scope guardrails held: no change to architecture, security/RLS, disclosure model, data model,
navigation taxonomy (Ecosystem → Outreach → Intelligence → Execution → Revenue), or any
locked A→E/R1 invariant. Visual direction locked (Apple/macOS light-first). No production
commissioning, credentials, live flags, or external sending are touched by this workstream.

Grounded in a room-by-room review of the running demo (screens committed in
`audit/demo-screens/`). Objective: an extraordinary **10–15 minute** experience that makes
PursuitOS feel like a **commercial decision & execution operating system across company
boundaries** — not a CRM dashboard.

---

# PHASE 1 — Deep UX / Product Mapping (observations only, nothing changed)

## 1.1 Room-by-room audit

Legend: **Signature** = uniquely PursuitOS today · **Generic** = resembles CRM/RevOps · **Empty** = dead/weak state now.

### Today — `today.desktop-light.png`  · **Signature (command center)**
- **Strong:** Decision queue ordered by *material commercial impact, not arrival* (governed-action items with effect + "Governed by"); "Where your systems disagree" is populated and genuinely differentiated (stage-vs-engagement conflicts, named accounts); At-a-glance (scored accounts, verified evidence); Top opportunities ranked by propensity band.
- **Weak / so-what gaps:** "Where your systems disagree" sits **below** the queue as a plain list — it is first-class intelligence rendered as a secondary table. **Pending approvals** and **Recent activity** are empty ("All clear", "Outcome events land here"). Every queue row repeats a **`demo` pill** although a "Demo environment" badge already exists (duplicate).
- Answers: What changed ✓ · Why it matters ✓ · What to do ✓ (per row) — but the *revenue-at-stake* framing of each decision is not quantified inline.

### Pursuits — `pursuits.desktop-light.png`  · **Signature (dimension model)**
- **Strong:** Portfolio grouped by account; the six semantic dimensions (priority/propensity/evidence/timing/route/readiness) as a compact right-aligned strip; "Next: Review pursuit".
- **Weak:** The **second Globex pursuit shows Unknown ×5** — reads as broken/unscored beside the fully-scored hero. Only one account group pre-enrichment; grouping now spans 8 pursuits but the list is flat (no "why this one first"). No portfolio-level "where is revenue concentrated".

### Pursuit Detail — `pursuit-hero.desktop-light.png` / `…-dark.png`  · **Signature — the product's strongest expression**
- **Strong (preserve):** decision-first IA — thesis → metric band → Why Now (traceable, **unknowns explicitly preserved**: "No verified timing anchor") → Facts → Route decision (**recommended CDW vs human-override WWT, "recommendation preserved"**, dimension compare) → **Why-CDW disclosure split** (internal "$1.84M via TD SYNNEX" vs generalized shareable — "confidential figures are absent from this payload, not hidden in the browser") → Team + readiness → What changed → **Federation** (participants, shared context, governed actions with effect classes, outcome trail).
- **Refine, don't redesign:** the page is long; the disclosure split and federation panel — the two most *differentiating* moments — sit far down. Metric band `?` affordances and some label density can relax. The confidential-vs-shareable split deserves to read as **the** hero moment, not a mid-page panel.

### Accounts — `accounts.desktop-light.png`  · **Generic (strategically)**
- **Strong operationally:** band bento (very-high/high/medium/low), score, industry, open-opps, pipeline $, evidence — reconciled with the seed.
- **Weak strategically:** it is a *scored table*, the RevOps default. **Partners = "unmapped" ×7** (noise + missing channel story). No compelling-event, signal-convergence, partner-route, opportunity-adjacency, or next-best-motion columns. The dominant question should be **"Where should we hunt, why now, and through whom?"** — currently it answers only "who scores high."

### Partners — `partners.desktop-light.png`  · **Empty / Generic**
- **Weak:** 2 partners (CDW, WWT), **all scorecards zero** (0 book accounts, 0 joint rooms, $0 settled, "not connected"). This is the **channel/federation thesis room** and it reads as an empty partner directory. Joint pursuits tab, settled revenue, route influence — all unpopulated.

### Mapping — `mapping (scratch)`  · **Empty**
- **Weak:** "No partner lists yet." The **Crossbeam-style overlap matrix** (a signature channel capability) shows nothing. No populated overlap → no "shared accounts, scored by propensity" story.

### Campaigns — `campaigns.desktop-light.png`  · **OK (safe demo)**
- 3 **composed, approved-but-unsent** campaigns (correct safe-demo posture). Workflow visible; nothing sent (the safety boundary is honestly represented).

### Motions — (empty) / Queue — `queue (scratch)`  · **Empty**
- Both execution rooms are empty ("Nothing pending", "motions appear when a motion goes active"). The **intelligence → governed execution → dated worklist** arc is not demonstrable from these rooms yet.

### Pipeline — `pipeline.desktop-light.png` / `…-dark.png`  · **Signature buried under Generic chrome**
- **Strong:** roll-up bentos ($5.89M pipeline, weighted, won), open-by-stage bars, **"AI learned signal · qualification vs outcome"**, MEDDPICC health, momentum, weighted-vs-declared.
- **Weak / CRM-like:** every deal card repeats the same **5-segment stage rail**, a **MEDDPICC 0** chip, an identical **"Risk: no economic buyer · no champion · no technical buyer"** line, and a full **closed-won / closed-lost** control row — on *every* card. This is repeated chrome and visual noise; hierarchy is flat (the $1.45M deal looks like the $210k deal). The PursuitOS-specific signal (real-vs-recorded stage, route/partner influence, evidence health, intervention, outcome learning) is present in aggregate but **not surfaced per row**.

### Analytics (outreach) — `analytics.desktop-light.png`  · **Empty (honest)**
- Funnel reads 0 because **no external send occurred** — the safety boundary. Truthful, but in a demo it looks unfinished. Should present as a *deliberate* "nothing sent — approval-gated" state, not a blank funnel.

### Insights — `insights.desktop-light.png`  · **Signature (under-exposed)**
- **Strong & differentiated:** win-rate + closed deals; **stage-probability calibration (declared vs observed, ±15 divergence → human review)**; conversation outcomes; **source predictive value** ("what sat behind the outcomes"); **named Attention triggers** (Renewal window, Stale deal, Late-stage silent, Joint-room-without-pipeline, Motion stalled, **CRM disagrees with the platform**) each toggleable with "Shows up in: …". This is a top-3 differentiator and it is **not in the demo path**.

### Sources — `sources.desktop-light.png` / Trust  · **Empty**
- "Sources register automatically as evidence flows in." — empty. The **provenance/trust ladder** (every source earns its trust) is a signature idea with no demo content.

## 1.2 Cross-cutting findings (the ten requested lenses)

1. **Uniquely-PursuitOS rooms:** Pursuit Detail (disclosure + route + override), Today "systems disagree", Insights (calibration + named triggers), Pipeline aggregate intelligence, federated Pursuit views.
2. **Generic/CRM-like rooms:** Accounts (scored table), Partners (directory), Pipeline *cards* (opportunity board chrome), Contacts.
3. **Duplicate information:** per-row `demo` pill vs the environment badge; "unmapped" ×7 on Accounts; MEDDPICC/risk/close controls repeated on every Pipeline card; stage shown as both a pill and a 5-segment rail per card.
4. **Weak hierarchy:** Pipeline (all cards equal weight); Pursuits (hero not visually distinguished from the "Unknown ×5" pursuit); Today (disagreement equal to at-a-glance stats).
5. **Excessive badges/pills/borders:** Pipeline cards, Today rows, Accounts partner cell.
6. **Overly dense layouts:** Pipeline card interior (stage rail + MEDDPICC + risk + close row + quote all stacked).
7. **Dead/empty states:** Partners, Mapping, Motions, Queue, Sources, Trust, Analytics funnel, Today "Pending approvals"/"Recent activity".
8. **"So what should I do?" failures:** Accounts (scores, no next action), Partners (metrics, no play), Sources (list, no consequence), Pipeline cards (data, but the *intervention* is not the CTA).
9. **Where the federated/channel thesis should be visible but isn't:** Accounts (through-whom), Partners (joint book), Mapping (overlap), a global signal that a Pursuit is multi-org (only Pursuit Detail shows it).
10. **Narrative opportunities:** the rooms hold a full story (Today → disagreement → Pursuit → Why Now → route → partner fit → decision → governed action → federated execution → pipeline → outcome → learning) but no *guided thread* connects them; several links in that chain live in empty rooms.

---

# PHASE 2 — Design (proposal; no code until sign-off)

## 2.1 Target demonstration journey (the locked storyline, mapped to rooms)

| # | Beat | Room | The line the operator says |
|---|---|---|---|
| 1 | **Prioritized by impact** | Today | "It's not a task list by date — it's ranked by what moves revenue." |
| 2 | **Systems disagree with reality** | Today → card | "Three deals say one thing; the live record says another." |
| 3 | **Open the Pursuit** | Pursuit Detail | "One governed object connecting intent, evidence, route, team, execution." |
| 4 | **Why Now + preserved unknowns** | Pursuit Detail | "Traceable to a fact — and it tells me what it still doesn't know." |
| 5 | **Route intelligence** | Pursuit Detail | "Which partner path actually improves this pursuit." |
| 6 | **Human override ≠ model corruption** | Pursuit Detail | "I overrode to WWT — the recommendation is preserved, not overwritten." |
| 7 | **Server-side disclosure** | Pursuit Detail (hero moment) | "Same Pursuit, three organizations, three correct views — decided server-side." |
| 8 | **Governed execution, no autonomous send** | Pursuit Detail → action | "Intelligence becomes an approved action — nothing sends itself." |
| 9 | **Federated pipeline/outcome** | Pipeline | "The deal, the route influence, the real-vs-recorded truth." |
| 10 | **Learning loop** | Insights | "Outcomes recalibrate the model; assumptions stay declared until data earns the change." |

**Hero interaction (the thing they remember):** the **Disclosure Split live toggle** on Pursuit Detail — one control flips the same Pursuit between **Sponsor view** (confidential "$1.84M via TD SYNNEX" present) and **Partner view** (generalized, figure gone) with a caption "removed at the server, not hidden in the browser." It makes cross-org trust *visceral* in three seconds.

## 2.2 Per-room design (refine, not redesign)

**Today (command center).**
- Promote **"Where your systems disagree"** to a first-class card *beside/above* At-a-glance, with a small severity accent rail (semantic, not new palette) and a per-row "revenue at stake $" and one-click "Open Pursuit". Keep the Decision queue dominant.
- Replace per-row `demo` pills with the single environment badge (already present).
- Fill **Pending approvals** and **Recent activity** from the (enriched) governed-action + outcome log so the command center is never empty.

**Pursuit Detail (strongest — refine).**
- Elevate the **Disclosure Split** into the hero moment with the live Sponsor/Partner toggle (§2.1). Keep everything else in place.
- Add a compact **"multi-org" ribbon** at the top when the Pursuit has participants (so federation reads before the reader scrolls to the bottom panel).
- Relax metric-band chrome (quieter `?` affordances; lighter dividers). Do **not** move sections.

**Pipeline (de-CRM).**
- One **stage rail per card** (remove the duplicate stage pill). Move MEDDPICC/risk/close controls behind **progressive disclosure** (expand-on-click), so the resting card shows: name, account, **real-vs-recorded stage delta**, **route/partner influence**, **evidence health**, **momentum**, and the **next intervention as the CTA**.
- Introduce **hierarchy**: size/emphasis by weighted value or materiality; the at-risk dormant late-stage deal gets a quiet amber rail, not a repeated red sentence.
- Keep the roll-up bentos and "AI learned signal".

**Accounts (from scored table → "where to hunt, why now, through whom").**
- Keep table/list mode. Add an intelligence layer as **optional columns + an expandable row**: compelling event (why now), signal convergence, **partner route (through whom)**, opportunity adjacency, next-best motion, latest material change. Collapse "unmapped" noise into a single quiet state.
- Add a lightweight **"hunt" default sort**: propensity × timing × convergence, so the top row answers "hunt here first, because…".

**Partners + Mapping (make the channel thesis real).**
- Populate partner scorecards (joint book, joint rooms, settled/influenced revenue, route influence, win-rate) from seeded joint data.
- Populate **Mapping** with two partner lists + an overlap matrix scored by propensity, so the "shared accounts, through whom" story is demonstrable. This is *data*, not new UI.

**Insights (bring the learning loop into the path).**
- No redesign — add one entry point from Today/Pipeline ("what recalibrated") so beat #10 lands. Keep calibration + named triggers as-is (they're strong).

**Analytics (honest empty → deliberate state).**
- Replace the blank funnel with a labeled **"Approval-gated — nothing sent"** state that shows composed/approved touches and says external send is off by design. Turns a weak empty into a *safety* talking point.

**Sources/Trust.**
- Seed a few registered sources with verification outcomes + trust so the provenance ladder shows the "every source earns its trust" idea during the evidence beat.

## 2.3 Information hierarchy changes (summary)
- Today: disagreement intelligence promoted; per-row revenue-at-stake; drop duplicate pills.
- Pipeline: resting card = decision signals; CRM mechanics behind progressive disclosure; visual weight by materiality.
- Accounts: intelligence columns + hunt sort; through-whom made explicit.
- Pursuit Detail: disclosure split becomes the hero; multi-org ribbon up top.
- Global: fewer pills/borders; semantic accent rails instead of repeated sentences; empty rooms filled by demo data, not new chrome.

## 2.4 Demo data requirements (8–12 coherent stories, all reconciling across rooms)

Extend the synthetic world *only for storytelling*; every record must reconcile (a Pursuit on Today ties to Accounts, Pipeline, Mapping, partner relationships, activity, outcome). Proposed 10 stories, each carrying a required variation:

| # | Account (synthetic) | Story / variation | Rooms it lights |
|---|---|---|---|
| 1 | Globex (hero) | renewal/modernization trigger · human override · disclosure | Today, Pursuit, Pipeline, Partners, Insights |
| 2 | Umbrella Health | strong opportunity / **wrong route** (recommended path underperforms) | Accounts, Pipeline, Partners |
| 3 | Stark Industries | **partner-led expansion** (distributor sources) | Partners, Mapping, Pursuit |
| 4 | Wayne Enterprises | **direct-vs-channel conflict** (both claim the deal) | Today (disagree), Mapping, Partners |
| 5 | Hooli Cloud | **dormant late-stage** opportunity (negotiation, silent 30d+) | Today (disagree), Pipeline |
| 6 | Initech (expansion) | **eventual win** + attribution (co-sell influenced) | Pipeline, Insights, Partners |
| 7 | Soylent Foods | **strong propensity / weak timing** (hunt-later) | Accounts, Pursuits |
| 8 | Acme Robotics | **competitive displacement** (incumbent removal) | Accounts, Pursuit, Sources |
| 9 | (new) Cyberdyne | **multi-partner overlap** (two partners, one account) | Mapping, Partners |
| 10 | (new) Tyrell Corp | **no-decision / loss** (closed-lost, learning) | Pipeline, Insights |

Plus: 2 partner account-lists + overlap (Mapping), partner joint book + one settled statement (Partners), 3–4 registered sources with trust (Sources), and Today "recent activity" fed by the outcomes above. All `DEMO`/`is_simulated`, visibly labeled.

## 2.5 Demo choreography — 6–8 wow moments

1. **Impact-ranked Today** — reorder proof: "not by date, by revenue impact."
2. **Systems disagree** — click a conflict → the record and the deal have parted ways.
3. **Why Now with preserved unknowns** — trace to a fact; "it tells me what it doesn't know."
4. **Route intelligence** — which partner path improves the pursuit (CDW vs WWT vs direct).
5. **Override preserves the model** — recommendation vs decision, side by side.
6. **Disclosure Split live toggle (HERO)** — same Pursuit, sponsor vs partner, figure removed *at the server*.
7. **Governed execution** — approve an action; "nothing sends itself" (autosend off).
8. **Learning loop** — Insights recalibrates from the outcome; declared assumptions stay declared.

## 2.6 Proposed code changes (EXACT list — for sign-off; none done yet)

Component/layout refinements (presentational; no architecture/data-model/disclosure change):
1. `src/app/(...)/today` — promote "systems disagree" to a first-class card; add revenue-at-stake per row; remove per-row `demo` pill (keep env badge); wire Pending approvals + Recent activity to existing read-models.
2. `src/app/pursuits/[id]/page.tsx` + the disclosure component — add the **Sponsor/Partner live toggle** over the existing `applyDisclosure` output (view-only; the server already produces both projections); add a top **multi-org ribbon**; relax metric-band chrome. **No change to disclosure logic or payloads.**
3. `src/app/pipeline/page.tsx` (+ card component) — single stage rail; progressive-disclosure for MEDDPICC/risk/close; surface real-vs-recorded delta, route influence, evidence health, momentum, next-intervention CTA; materiality-weighted emphasis.
4. `src/app/accounts/page.tsx` (+ row) — intelligence columns + expandable row (compelling event, convergence, partner route, adjacency, next-best motion, material change); hunt-sort; collapse "unmapped".
5. `src/app/analytics/page.tsx` — deliberate "approval-gated, nothing sent" state.
6. Shared: a small **semantic accent-rail** utility + pill reduction pass (reuse existing tokens; no new palette).

Demo data (additive scripts, `DEMO`/synthetic only):
7. Extend `scripts/demo-enrich.ts` (or a sibling `demo-stories.ts`) for the 10 reconciled stories, partner joint book + settlement, Mapping lists + overlap, registered Sources, Today activity.

Docs/screens:
8. Refresh `audit/demo-screens/*` after changes; update the commissioning report's demo section.

## 2.7 Explicitly NOT changing
- Navigation taxonomy (Ecosystem → Outreach → Intelligence → Execution → Revenue) and the rooms under it; no top-nav shell, no parallel nav.
- Architecture, RLS/tenant isolation, the disclosure engine and its server-side projections/payloads, the governed-action boundary, the data model, migrations, and every A→E/R1 invariant.
- Visual direction (Apple/macOS light-first), the six semantic dimension colors, and the material/bento language — these are *extended*, not replaced.
- No heavy black outlines, generic white-card grids, arbitrary colors, or dashboard-grid styling.
- Production commissioning, credentials, live flags, external sending — untouched.

---

## Halt
Phase 1 mapping and Phase 2 design are complete. **No code has been written.** Awaiting your
sign-off (and any edits to the journey, the 10 stories, the wow-moment set, or the exact
code-change list) before Phase 3 implementation.
