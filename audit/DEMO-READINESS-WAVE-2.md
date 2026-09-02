# PursuitOS — Overnight Demo Readiness (Wave 2)

**Branch** `claude/activateos-platform-review-xzkgmd`
**Started from** `41e66dd` — *Wave 1: lock the visual system onto one set of tokens and primitives*
**Purpose** Make the TD SYNNEX journey read as one coherent, intentional product. Not a redesign.

> **One correction to the brief.** Wave 1 is locked at **`41e66dd`**, not `34dcc8e` — `34dcc8e` is
> the commit Wave 1 started *from*. This wave builds on `41e66dd` and every Wave 1 contract
> (type, radius, button, field, badge, absence, money, detector) is intact and still enforced.

---

## 1. The certified journey

Run against a local production build on the reseeded synthetic demo database, at 1440 **and** 1280.

```
Today → Mapping → Pursuit Detail → Sponsor/Partner toggle → Trust
      → Pipeline Attention → Portfolio → All → Goals → Routines → Ask → Insights
```

| Check | Result |
|---|---|
| Every stop renders, HTTP 200, has a page title | **12 / 12** |
| Page errors / console errors | **none** |
| Horizontal overflow (1440 and 1280) | **none** |
| Malformed money (`$$`, `$6250k`, `$0k`, `$NaN`, 7-digit raw) | **none** |
| Dead links (`#`, empty, `/undefined`) | **none** |
| Demo state identifiable on every stop | **12 / 12** |
| Disclosure controls open (Trust, Mapping, Pursuit, Pipeline) | **4 / 4** |
| Sponsor ⇄ Partner toggle switches, and switches back | **yes** |
| **Confidential figure withheld from partner view** | **verified** |
| `tsc --noEmit` · `npm test` · `next build` · visual-system detector | clean · **149/149** · exit 0 · clean |

The disclosure assertion is the one that matters. The sponsor view carries
`CDW category spend $1,288,000`; the partner view does not. That was checked by
reading the rendered DOM in both states, not by trusting the control's label.

Screenshots: `audit/wave2/01-today.png` … `13-skills.png`, plus
`04-pursuit-partner-view.png` (the toggle mid-demo).

---

## 2. What changed, room by room

### Today — command centre
The decision card carried three field names spelled out in full on **every** row —
"Operational urgency … Commercial priority … Governed by …" — so six rows repeated the same
three labels eighteen times and the values had to be read out of them. It also never rendered
`item.reason`, the one field a reader cannot reconstruct from the rest of the row.

Now: **headline → why now → status → action**. The band pill is self-describing; urgency earns a
chip only when elevated ("normal" on every row is not information); what runs when you act moved
into *Why is this here?* beside the other ranking facts.

The CTA was filled with the row's **class hue** — blue, red, violet or green depending on the kind
of item — four colours for one action. Now one primary grammar.

**A rule the queue enforces on itself:** a reason that appears on more than half the rows is the
decision class restated once per card, so the queue suppresses it. Six route approvals all read
"Recommended route is awaiting your approval", which the chip, the title and the button had each
already said. This is a display rule, not a filter — nothing leaves the queue, ordering is
untouched, and the full reason stays in the disclosure. *(Caught by inspecting my own first
attempt: I had removed three repeated labels and added one repeated sentence.)*

Also removed: a `scale-[0.92] opacity-75` transform used to "demote" the At-a-glance strip. A
blur is not a hierarchy device; position and label rank already do that job.

### Mapping — the ecosystem story
The overlap counts are the focal point, so the things competing with them stepped back: the
attribution-scope paragraph, the matrix legend and the CSV-roadmap note are now disclosures. The
partner-scope header was `text-copy font-semibold`, a label doing a title's job; it is a title now.
No functionality added.

### Pursuit Detail — demo hero room
- The hero repeated *"One governed commercial Pursuit connecting intent, evidence, route, team and
  execution"* on **every** pursuit, above the thesis that says what this one is actually about. The
  page is that sentence; it is gone, and the thesis got the room.
- The Sponsor ⇄ Partner panel opened with a four-line paragraph *about* the toggle. The toggle is
  the explanation — flip it and the confidential line disappears. The mechanism moved to
  *How this works*, below the thing it describes.
- The audience control was a **fifth** hand-rolled segmented control, with its own track, its own
  radius arithmetic and a selected colour that changed with the audience. It now wears the one
  segmented grammar, so switching audience reads like switching any other view.
- Provenance and governance footnotes → disclosure: stakeholder coverage methodology, "what
  confirming does", value-case interval arithmetic.
- Layout: Facts was `lg:order-3` colliding with the value case, leaving a hole in the right column.
  Facts is now full width and two-up; *What changed* and *Outcome* pair as one band.
- **Result: 3408px → 2988px (−12%)** with nothing removed.

**Nothing hidden that must not be:** UNKNOWN states, contradictions, "Readiness held", missing
stakeholder roles, the disclosure status and the next action all stayed on the surface. The
UNKNOWN explanations that say *how to establish* a missing fact were deliberately left in place.

### Trust — visual proof point
Opened on four counters, **three of them 0** in a young tenant — which makes an architecture that
*is* enforced look like one nobody uses. A guarantee does not get weaker because no one has
exercised it yet.

Now six guarantees stated as mechanisms (`Assurance`): tenant isolation · governed sharing · human
approval · auditability · revocable access · grounded AI. Where a live figure exists it sits under
the mechanism it evidences. **No certification is claimed** and no wording was strengthened beyond
what the running system enforces.

Four walls of prose became four compact cards with accordions. **Nothing was deleted** — residency,
retention, the subprocessor list with regions, and the GDPR Art. 15/17/20 mechanics are all still
there. Procurement still never needs a meeting; it now chooses which section to open.
**1000px — one viewport.**

### Pipeline
Qualification-vs-outcome and stage distribution were two full-width cards stacked, pushing the
Attention list — the thing an operator came for — another ~220px down. Side by side they cost one
row, and Attention starts ~200px higher. Renewal radar, roll-up, base-vs-joint split and all four
views are unchanged. IA untouched.

### Goals — one demo-quality synthetic goal
`scripts/demo-goal.ts` seeds **$5M Virtualization Co-Sell Pipeline — Q4 2026** through existing
primitives only (`goals` from migration 0026, `revenue_motions.goal_id`). No schema change.

**No actual is written.** `pipeline_usd` is derived by `listGoals` as the sum of
`estimated_value_usd` over linked motions, so attainment is whatever the record says:

| | |
|---|---|
| Target | **$5M** |
| Actual (computed) | **$1.25M** |
| Attainment | **25%** |
| CDW | $1M · 4 motions |
| WWT | $250K · 1 motion |

Motions are linked by the goal's own definition — every partner-attributed motion in the org —
rather than a hand-picked list chosen to make the total look better. The room now also renders
**Contributing partners** (added to the read model, not the schema), which is the difference
between a number on a slide and a number you can act on.

The eight-field creation form moved behind a fold: setting a goal is rare, reading how the live
ones are tracking is daily.

> **Demo talking point, not a defect.** The goal reads $1.25M while *Revenue & pipeline targets*
> lower on the same page reads $3.67M joint. These are two different canonical measures —
> **motion-level commitment** vs **opportunity-level pipeline** — and each section states its own
> basis. If asked, that distinction is the answer: a goal rolls up from the objects you chose to
> link to it, not from everything.

### Routines
State reads as state (Running / Paused chip) instead of being spelled out on the control that
changes it; the toggle was a hand-styled green fill and is now the button contract. Schedule and
delivery — hour picker, weekday, recipient — moved behind *Schedule & delivery*. What the routine
does, its cadence, its state and the human control stay on the surface. No automation work.

### Ask
Already correct: the deterministic-first architecture is untouched, and parser detail (intent key,
slots, catalog version, latency, discarded interpretation) was **already** behind *Why this answer*.
Wave 1 had moved the commercial figure off the mono face, which on that page means "verbatim
machine token" — an amount is neither. No further change; nothing was done to imply the live model
interpreter is validated.

### Insights
One flat stack in which a 4-deal observation, a set of hand-declared weights and a
"not enough data yet" panel all carried identical visual weight — which is how a small sample turns
into a claim. Now three named bands: **Observed outcomes** ("counts, not conclusions") ·
**Declared assumptions** ("numbers a human chose; they stay declared until outcomes replace them") ·
**What raises an account** ("deterministic rules, not a model"). The six attention-trigger switches
were six primary-blue fills down the right edge, reading as six things to do; they are secondary —
they toggle rules that are already running.

### Skills (optional, §12)
One positioning skill through the existing primitive: *Virtualization renewal positioning* —
"Lead with modernization risk and renewal timing. Do not position migration as cost reduction
alone… Require partner acceptance before partner-led customer outreach." Institutional commercial
knowledge, not prompt engineering.

---

## 3. Cross-cutting normalization (§1)

The measurable one: **93 section labels across 21 files**, all the same treatment, written inline
with **four different bottom margins** — none, `mb-1`, `mb-2`, `mb-3`. Visually identical blocks sat
at four different distances from their own content. That is the kind of inconsistency nobody can
name and everybody feels.

The page now has exactly two heading levels below `PageHeader`:

- **`SectionHeading`** — a real section with a name you would say out loud, plus a one-clause hint.
- **`BlockLabel`** — the minor label over a list or stat block. One margin.

`Assurance` was added for a job nothing covered (a guarantee stated as a mechanism). Both live in
`components/ui.tsx` — the same library, not a parallel one.

---

## 4. Safety — every §13 rule held

Not touched: production · `app.pursuitos.io` · tenancy and RLS semantics · federation · disclosure ·
UNKNOWN semantics. External sending and autosend remain off; no worker, sending or outreach was
configured. No partner or customer fact was invented, no outcome evidence fabricated, and no schema
primitive was added for presentation.

Demo-only writes (local synthetic database, guarded by `assertSyntheticDatabase`, which asks the
database rather than the environment): one goal row, five `goal_id` foreign keys, one skill row.
All idempotent, all clearly labelled as demo, all through existing primitives. Re-running the seed
changes nothing.

`.env.local` was held aside during builds — `next build` bakes `NEXT_PUBLIC_*`, and a build made
with Supabase credentials present gates every room behind `/login`. It is restored and gitignored.

---

## 5. Known caveats for the morning

1. **Trust shows `0 entries recorded` under Auditability and `0 providers registered`.** True for a
   freshly reseeded demo tenant. Deliberately not padded. The mechanisms above them do not depend on
   the counts.
2. **Insights samples are tiny** — 8 closed deals, calibration `Observed` all `—`, `n=0`. The room
   now says so structurally rather than in fine print. Do not read the funnel as performance.
3. **Goal vs targets figures differ by design** — see the Goals note above. Worth pre-empting.
4. **The demo tenant carries no AI runs**, so *AI & models* on Trust shows the empty state.
5. **Interaction coverage is bounded.** Certified: the Sponsor⇄Partner toggle (both directions, with
   a DOM-level confidentiality assertion), four disclosures, all four Pipeline views, and every
   journey stop at two widths. **Not exercised:** ⌘K, account drawers, form submissions, and the
   governed mutations (Approve route, Confirm team member) — those write, and this pass did not
   drive writes through the UI.
6. **Rooms outside scope were left alone** per the brief — Admin, Intake, Contacts, Queue, Review,
   Campaigns, Partners received only the cross-cutting heading normalization.

---

## 6. Status

Journey **certified**. Committed and pushed. **Halting for review.**
