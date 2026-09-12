# GATE C — Product Review Package

**Prepared:** 2026-09-12
**Lane:** `roadmap/pursuitos-vnext` @ `e0365d4`
**Purpose:** let a human judge the first visible vNext PursuitOS experience before
any further roadmap development is authorized.

> **The GATE C question, verbatim from `ACCEPTANCE.md` U-9 / D-003:**
> *Is Pursuit Detail now simpler to read, or merely differently arranged?*
> If it is only differently arranged, the slice has not landed.

This document is **preparation, not a recommendation.** It records what the two
states actually contain, measured from the rendered DOM, and lists what is open.
No redesign is proposed here.

---

## Review conditions

| | |
|---|---|
| Environment | **local synthetic only** — PostgreSQL 16.13 on `127.0.0.1:5432`, database `pursuit_demo` |
| `environment_identity` | `demo`, `is_synthetic = true` |
| Hosted databases contacted | **none** |
| Pursuit | Globex Manufacturing Inc. — `98b1f890-04ac-4461-adaa-f6379acba39a`, `MODERNIZATION`, status `DETECTED` |
| Canonical reconciliation | 3 orgs · 14 companies · 19 opportunities · **11 open** · **$8,040,000** · 14 pursuits — exact match |
| Flag | `VNEXT_PURSUIT_INTELLIGENCE_ENABLED` (with `VNEXT_CONTEXT_HEALTH_ENABLED`, `VNEXT_PURSUIT_STATE_ENABLED`, `VNEXT_PURSUIT_MEMORY_ENABLED`) |
| Build | one `next build` (exit 0), served twice — the vNext flags are server-only and read at runtime, so both states come from identical compiled output |
| Content manipulation | **none.** No seed edit, no fixture, no expanded-by-default disclosure. Both captures are the real seeded default state. |

Reproducibility check: the flag-OFF page measured **235,042 bytes** and the
flag-ON page **217,010 bytes**, byte-for-byte identical to the chunk-6B session's
figures.

---

## 1. FLAG OFF — what the reader has to assemble

Today the same story is told by three panels that are **not adjacent**. Measured
geometry at 1440×1000 (content column spans x=304…1,396):

| Panel | `x` | Width | `y` | Height |
|---|---|---|---|---|
| **Why now** | 304 | 538px (left column) | 532 | 523px |
| **Facts behind this** | 304 | **1,092px (full width)** | 1,071 | 419px |
| **What changed** | 304 | 538px (left column) | **2,767** | 275px |

The three fragments span **532 → 3,042 = 2,510px of scroll**. Interleaved
between them, in reading order: Value case (`y` 532, right column), Route
decision (`y` 1,505, full width), Why CDW (`y` 1,893, full width), Pursuit team
and Stakeholders (`y` 2,286). The reader assembles the narrative by scrolling
past four panels that answer different questions.

Note the widths: the three fragments do not share a layout idiom. Why Now is a
half-width card, Facts behind this is a full-width band, What Changed is a
half-width card paired with Outcome & attribution.

### What each fragment says

**Why now** — subtitle *"Assembled from the fact & signal graph — traceable"*.
Five icon rows:

- ⚡ Business Trigger · Globex · "Creates a defined commercial window." · ↳ traceable to source
- ▣ Technology condition · **Not yet established**
- ◷ Timing anchor · **Not yet established**
- ⌁ Signal Convergence · "1 independent families"
- ↗ Route Relevance · "Relevant delivery capability; Existing customer relationship"

then *WHAT WE DON'T KNOW YET · No verified timing anchor.*
then *LIFECYCLE TIMING · Renewal · verified · 2026-11-27 · in 76d*

**Facts behind this** — subtitle *"Trusted intelligence"*. **Seven** facts,
account-scoped, ordered by confidence, every one labelled `verified`:

| # | Fact | Confidence |
|---|---|---|
| 1 | Joint time-and-motion study — productivity impact | 95 |
| 2 | Globex Manufacturing Inc. — renewal date | 92 |
| 3 | CFO office, Q3 review — avoided cost | 90 |
| 4 | **Globex Manufacturing Inc. — strategic initiative** | 89 |
| 5 | Vendor spend estimate — infrastructure cost | 50 |
| 6 | Incident model from public outage history — downtime risk cost | 50 |
| 7 | Partner services estimate (WWT) — migration cost | 50 |

Row 4 is **the only fact actually linked to this pursuit**. Nothing on screen
says so; it sits fourth, indistinguishable from six account facts.

**What changed** — subtitle *"Material events only"*. Three HIGH/MEDIUM events:
Route override (Executive direction), Recommended route → Partner-led,
Pursuit detected.

### The three things the reader must infer unaided

1. **Which facts are about *this pursuit*.** Nothing distinguishes the one linked
   fact from the six account facts.
2. **Whether timing is known.** The same panel says "Timing anchor — Not yet
   established" *and* "No verified timing anchor" *and* "Renewal — verified —
   2026-11-27 · in 76d", with no sentence reconciling them.
3. **How the three panels relate.** They are three answers to one question,
   2,510px apart.

---

## 2. FLAG ON — what the composed surface presents

One panel, **"This pursuit"**, subtitle *"Why it matters, what we know, and what
still needs attention"*. Desktop box **538 × 1,068px at x=304**; all four
movements contiguous.

| Movement | `y` | Content as rendered |
|---|---|---|
| **Why this matters** | 532 | "Creates a defined commercial window." · "1 independent families" · "Relevant delivery capability; Existing customer relationship" · *No identity context researched yet*. Confidence word **"Partly evidenced"**, right-aligned on the heading. |
| **What we know** | 745 | `CONFIRMED FOR THIS PURSUIT` → 1 row. `RELEVANT ACCOUNT CONTEXT` → 3 rows. Then *"3 more items of supporting context available."* |
| **What changed** | 1,086 | 3 entries, then *"Earlier history (7 more) ▸"* |
| **Needs attention** | below | 1 primary issue + *"10 other unresolved items."* + the timing note + `LIFECYCLE TIMING` row |

Architecture terminology is gone: the flag-OFF subtitle *"Assembled from the fact
& signal graph — traceable"* names an internal structure (an `ACCEPTANCE.md` U-12
problem in the shipped product). The replacement subtitle names the reader's
questions instead.

---

## 3. Evidence model — what is confirmed vs what is account context

The distinction is carried by two group headings, in product language. On this
pursuit, from real seeded data:

### Confirmed for this pursuit (1)

| Label | Predicate · provenance | State |
|---|---|---|
| Globex Manufacturing Inc. | strategic initiative · First-party | **Verified** |

### Relevant account context (3 of 6 shown)

| Label | Predicate · provenance | State |
|---|---|---|
| Globex Manufacturing Inc. | renewal date · Customer-declared | **Verified** |
| Joint time-and-motion study | productivity impact · First-party | **Verified** |
| CFO office, Q3 review | avoided cost · Customer-declared | **Verified** |

Then: *"3 more items of supporting context available."*

### Reconciliation against the read-model

The `vnext-context` verifier accounts for all seven account facts exactly once:

```
EXCLUDED SUMMARY — 7 account fact(s) considered
direct 1 · supporting 6 · below band 0 · beyond limit 0 · rejected 0 · not disclosable 0
```

So the composition finds **1 direct + 6 supporting**; the surface shows 4 rows
(`evidenceBudget` default 4 — `pursuit-context.ts:278`) and discloses the other 3
as a count. Nothing is dropped silently and nothing is withheld on this pursuit.

**Nothing was written to `pursuit_facts`.** Supporting context stays
account-scoped in the database and is only *grouped* differently in the view;
Slice 1 is read-only (`ACCEPTANCE.md` S1-6).

---

## 4. The Globex timing case

This is the case worth the most review attention, because it is where the surface
could most easily lie.

**The underlying situation.** Globex holds a `renewal_date` fact — customer-declared,
verified, confidence 92 — **on the account**. Nobody has confirmed it *for this
pursuit*. The pursuit therefore has a genuine timing gap while the account holds
something that would answer it.

**How flag OFF represents it.** Three statements in one panel, unreconciled:

- `◷ Timing anchor — Not yet established`
- `WHAT WE DON'T KNOW YET · No verified timing anchor.`
- `LIFECYCLE TIMING · Renewal · verified · 2026-11-27 · in 76d`

No sentence explains how a verified renewal date and an unestablished timing
anchor coexist. The reader reconciles it or misreads it.

**How flag ON represents it.** Three coordinated elements:

1. The primary attention item is **"No economic buyer identified"** — *not*
   timing. Timing ranks second under the 5B-1 gap ranking, so it does not take
   the primary slot.
2. A **section-level** note, driven by the condition rather than by rank:
   > *"Customer-declared timing exists on the account — not yet confirmed for this pursuit"*
3. Immediately beneath it, the lifecycle row it qualifies:
   > `LIFECYCLE TIMING` · Renewal · `verified` · 2026-11-27 · in 76d

Expanded, that row reads: *"Why: customer declared evidence supports this date.
customer declared · status current · observed 2026-09-12 · 0 cited sources ·
derived from canonical facts; no date is inferred beyond its evidence."*

**What the surface does and does not claim.** It does not say pursuit timing is
verified. It says the *account* holds customer-declared timing and that it is not
yet confirmed here — which is exactly the record. The caveat is emitted whenever
a `WHY_NOW` gap coexists with account-held timing (`pursuit-context.ts:341-344`),
not when timing happens to rank first; that is `ACCEPTANCE.md` U-15, and it was
the correction made after the 6A render.

**The residual risk, unchanged from the chunk-7 log.** The green `verified` chip
sits ~40px below the caveat. Both statements are true and the adjacency is now
*explained*, where flag OFF leaves it unexplained — but a reader skimming chips
rather than sentences can still read "timing: verified".

---

## 5. Density

Measured from the rendered DOM in both states, same build, same data.

| Measure | FLAG OFF | FLAG ON | Δ |
|---|---|---|---|
| **Top-level panels** | **11** | **9** | **−2** |
| Nested `<section>` (narrative movements) | 0 | 4 | +4 |
| Raw `<section>` count | 11 | 13 | +2 |
| **Page bytes** | **235,042** | **217,010** | **−18,032 (−7.7%)** |
| Desktop document height @1440 | 3,827px | 3,855px | **+28px** |
| Top-row column imbalance @1440 | 48px | **593px** | +545px (see N-6) |
| Mobile document height @390 | 7,870px | 7,171px | −699px (−8.9%) |
| Visible text, default state | 7,121 chars | 7,018 chars | −103 (−1.4%) |
| Visible text, every disclosure open | 11,841 chars | 11,814 chars | −27 (−0.2%) |
| **Default evidence rows** | **7** (all, account-scoped, by confidence) | **4** (1 confirmed + 3 account context) | −3 |
| **Default attention items** | **1** line, inside Why now | **1** primary + 10 as a count | 0 |
| Default change entries | 3 (material only) | 3 (memory, no materiality filter) | 0 |
| `<details>` on page | 18 | 19 | +1 |

### Panels removed and retained

| FLAG OFF (11) | FLAG ON (9) |
|---|---|
| *(hero)* | *(hero)* |
| **Why now** | **This pursuit** ← absorbs all three |
| **Facts behind this** | — |
| **What changed** | — |
| Value case | Value case |
| Route decision | Route decision |
| Why CDW | Why CDW |
| Pursuit team | Pursuit team |
| Stakeholders | Stakeholders |
| Outcome & attribution | Outcome & attribution |
| Federation | Federation |

### Read this honestly

The panel count went down and the fragments became adjacent. **Total information
volume did not meaningfully change** — 1.4% less visible text by default, 0.2%
less with everything open — and **the desktop page did not get shorter** (+28px).
The reason is N-6: the merge makes one column 1,068px tall against a 475px
neighbour, so the height the left column gains is not recovered anywhere. The
mobile page, being single-column, did shorten — by 8.9%.

So the case for "simpler" rests on **adjacency and reading order**, not on less
content, a shorter page, or a tidier desktop composition. That is the judgement
GATE C has to make.

---

## 6. Progressive disclosure

### Visible by default, inside "This pursuit"

- Panel title and subtitle
- One confidence word — **"Partly evidenced"**
- 4 "why this matters" clauses, including the honest unknown *"No identity context researched yet"*
- 4 evidence rows in two labelled groups, each with a state chip
- 3 change entries with date and actor
- 1 primary attention item, with `state` chip, why-it-matters and how-to-resolve
- The timing note
- The `LIFECYCLE TIMING` summary row

### Behind a disclosure

| Control | Reveals |
|---|---|
| `Earlier history (7 more) ▸` | **See finding N-1 — it reveals no events.** |
| `Renewal · verified · 2026-11-27 · in 76d ▸` | Why the date is believed, provenance class, status, observation date, cited-source count |

### Shown as a count, with no way to reveal it

| Text | Hides |
|---|---|
| *"3 more items of supporting context available."* | 3 supporting facts |
| *"10 other unresolved items."* | 10 ranked gaps |

Neither is a link or a disclosure. This is inconsistent with U-2 ("detail is one
deliberate interaction away") — see finding **N-2**.

---

## 7. Open UX questions

These are the questions this review exists to answer. They are **not** proposals.

### Q1 — Is "This pursuit" the right panel title?

What the data says: the panel absorbed "Why now", "Facts behind this" and "What
changed", so no inherited title fits. "This pursuit" is a container label rather
than a claim, and its subtitle carries the meaning ("Why it matters, what we
know, and what still needs attention"). The competing consideration is that every
other panel on the page is also about this pursuit, so the title does not
distinguish itself by content — and at 1440px it renders at the same size and
weight as the four movement headings beneath it, so the panel title does not
visually dominate its own contents.

### Q2 — Should "Needs attention" show one primary issue or multiple by default?

What the data says: it currently shows **exactly one**, and that is structural,
not a tunable budget — `primary` is `gaps[0]` (`pursuit-context.ts:337, 345`),
with the remainder collapsed into the sentence *"10 other unresolved items."*
On this pursuit that hides ten ranked gaps behind an unclickable count. The
argument for one is `ACCEPTANCE.md` U-4 (one decision dominates each state); the
argument for more is that ten unresolved items is a lot of pursuit reality to
represent as a number, especially with no affordance to see them.

### Q3 — The three UX issues already logged from the 6B render

| # | Issue | Status in this review |
|---|---|---|
| 1 | **Lifecycle/timing proximity.** The `verified` renewal chip sits directly beneath a narrative saying pursuit timing is unconfirmed. | **Confirmed visually.** See §4. Note it is *better* than flag OFF, which shows the same juxtaposition inside one panel with no explanatory sentence. |
| 2 | **"Why this matters" appears twice.** | **Confirmed, and the count was understated — it appears 4×:** once as the narrative `<h3>`, and three times as `<b>Why this matters:</b>` inline labels inside the Stakeholders panel. |
| 3 | **`BUILD_VALUE_CASE` does not lift economic facts.** | **Confirmed as not materially harmful.** All five economic facts still reach the page; three surface under "Relevant account context" (productivity impact, avoided cost) and the Value case panel is untouched. Ranking nicety, not a correctness problem. |

---

## 8. New findings from this review pass

Not in scope to fix — recorded because GATE C is the review that is supposed to
catch them.

### N-1 — "Earlier history (7 more)" reveals nothing  ·  **significant**

Expanding the disclosure produces only this sentence:

> *"The full history for this pursuit continues below in the activity record."*

No events are rendered. And there is no activity record below: the
`MaterialChangeTimeline` panel **was** the activity record, and it is one of the
three panels this surface replaced. The `#activity` anchor is preserved — it
resolves to the "What changed" movement at `y` 1,086, *above* the sentence
pointing "below".

**Consequence, verified by opening every `<details>` on the page and probing the
resulting text:**

| Probe | FLAG OFF | FLAG ON |
|---|---|---|
| `Route override` | found | **absent** |
| `partner override` | found | **absent** |
| `Partner-led` | found | **absent** |
| `Pursuit detected` | found | **absent** |
| `Recommended route` | found | **absent** |
| `Executive direction` | 2× | 1× |
| `exec relationship` | 2× | 1× |

The pursuit has exactly 10 `change_ledger` rows. The narrative shows the 3
newest and makes the other **7 unreachable**, including `PARTNER_OVERRIDE` and
`OVERRIDE_RECORDED` — the demo's §2 beat — plus `ROUTE_RECOMMENDATION_CHANGED`
and `PURSUIT_CREATED`.

The override **decision** is still on the page: the surviving Route decision
panel accounts for `Executive direction` / `exec relationship`. What is lost is
the **chronology** — that a person overrode the route, when, and why, as an event.

Note also *why* the three newest entries are stakeholder rows: Pursuit Memory
orders strictly by `occurred_at` with **no materiality filter** (`S1-3`, by
design), and four `STAKEHOLDER_ROLE_ASSERTED` rows at `03:32:55` are four seconds
newer than the three HIGH-materiality events at `03:32:51`. So three MEDIUM
stakeholder assertions displace every HIGH event from the default view.

**This is a flag-ON-only defect. Monday is unaffected** — the flag defaults OFF
and nothing is deployed. But Slice 1 should not be promoted while it stands.

### N-2 — Two counts with no affordance

*"3 more items of supporting context available."* and *"10 other unresolved
items."* are plain text — not links, not disclosures. `Earlier history (7 more) ▸`
at least presents an affordance (which then fails, per N-1).

### N-3 — Every evidence chip on this pursuit reads "Verified"

All four evidence rows carry the same green `Verified` chip. The five-state
vocabulary is exercised only in Needs attention (`Not identified yet`). A
reviewer therefore **cannot see the state vocabulary working on evidence rows**
from this pursuit alone — the distinction that `ACCEPTANCE.md` U-14 exists to
protect is not observable here. Reviewing a thinner or staler pursuit alongside
this one would show it.

### N-4 — Pre-existing copy defects, now in the first three lines

Both appear in **both** flag states, so neither is a slice regression — but the
new surface promotes them from mid-panel to the opening lines of the page's
primary narrative:

| Text | Source |
|---|---|
| "1 independent families" | `src/lib/pursuits/read-models/detail.ts:95` (pluralization) |
| "Relevant delivery capability; Existing customer relationship" | semicolon-joined fragment, same view-model |

### N-5 — The desktop page did not get shorter

3,827px → 3,855px. See §5, and N-6 for the reason.

### N-6 — The composed panel unbalances the bento, leaving a 593px void

Measured panel geometry, top row, at 1440×1000:

| State | Left column | Right column | Column imbalance |
|---|---|---|---|
| FLAG OFF | Why now — `y` 532 → 1,055 | Value case — `y` 532 → 1,007 | **48px** |
| FLAG ON | **This pursuit — `y` 532 → 1,600** | Value case — `y` 532 → 1,007 | **593px** |

Absorbing three panels into one makes the left cell 1,068px tall against a
475px neighbour, so the right column is **empty from `y` 1,007 to `y` 1,600** —
593px of blank space starting just below the fold, in the most valuable region
of the page. Under flag OFF that same region was filled, because the full-width
"Facts behind this" band began at `y` 1,071.

Two knock-on effects:

- **The narrative is a 538 × 1,068px strip** — roughly 1:2 — where the content it
  replaced had the full 1,092px width available for its evidence table.
- **"Outcome & attribution" is orphaned.** It previously sat beside "What changed"
  in a balanced 2-up row (both at `y` 2,767). With What Changed gone it sits
  alone at 538px wide with an empty 538px column beside it (`y` 2,878 → 3,070).

This is the mechanical reason the page did not get shorter: the tallest column
got taller. It is a layout consequence of the merge, not a defect in the
narrative itself, and it is the most likely thing to change a reviewer's answer
to the U-9 question.

---

## 9. Validation — did preparing this package change behavior?

| Check | Result |
|---|---|
| `git status --porcelain` at start | clean |
| `HEAD` vs `origin/roadmap/pursuitos-vnext` | identical — `e0365d4` |
| `npx tsc --noEmit` | **exit 0** |
| `npm test` | **271 pass / 0 fail** |
| `npm run build` | **exit 0** |
| `vnext-context` verifier | **55 passed / 0 failed** |
| Canonical demo numbers | 11 open · $8,040,000 · 14 pursuits — reconciled |
| Flag-OFF page bytes | 235,042 — identical to the 6B session |
| Flag-ON page bytes | 217,010 — identical to the 6B session |
| Horizontal overflow @1440 and @390, both states | **none** |
| Product-code changes made | **zero** |

No product code was changed to produce this package. Capture scripts live in the
session scratchpad, not in the repository. `playwright-core` — already a declared
devDependency — was used with the pre-installed Chromium at
`/opt/pw-browsers/chromium-1194`; `package.json` and `package-lock.json` are
untouched.

### Correction to the chunk-6B mobile evidence

The 6B session's mobile screenshots were captured **viewport-only** (`fullPage`
was set for desktop only), so they showed the hero and not the surface that
changed — which is why both mobile files were byte-identical at 334,356 bytes.
The captures in this package use `fullPage` at both widths. The 6B *overflow*
claim is unaffected: it was measured from `document.documentElement.scrollWidth`,
not from the image.

---

## Screenshots

`docs/vnext/review/gate-c/`

| File | What | Dimensions |
|---|---|---|
| `desktop-off.png` | A — flag OFF, existing Pursuit Detail | 1440×1000 viewport, full page (3,827px) |
| `desktop-on.png` | B — flag ON, vNext Pursuit Detail | 1440×1000 viewport, full page (3,855px) |
| `mobile-off.png` | C — flag OFF | 390×844 viewport, full page (7,870px) |
| `mobile-on.png` | D — flag ON | 390×844 viewport, full page (7,171px) |
| `desktop-on-full-context.png` | The "This pursuit" panel unclipped | element-scoped, 538×1,068px |

All at `deviceScaleFactor: 2`. Both states are the real seeded default — no
disclosure was pre-opened and no content was altered for the capture.

---

## What GATE C has to decide

Not decided here. The reviewer's call:

1. **The U-9 question.** Simpler to read, or differently arranged? §5 gives the
   honest numbers: fewer panels and contiguous movements, but the same
   information volume, no shorter on desktop, and a 593px void beside the new
   panel (N-6).
2. **Q1** — panel title.
3. **Q2** — one attention item or several.
4. **Whether N-1 blocks promotion.** Slice 1 is functionally complete behind the
   flag, but with the flag on, 7 of 10 ledger events — the demo's §2 override
   among them — are unreachable.
5. **Whether N-6 is acceptable or needs the layout revisited.** This is a
   composition question the panel-count metric cannot answer, and the two
   full-page desktop captures are the evidence for it.
