# Global UI System Normalization

Presentation only. No data, domain model, scoring, canonical logic, routing, disclosure, RLS,
federation, Ask resolver semantics, Value Case arithmetic, lifecycle derivation, stakeholder logic,
outcome or feature-flag behaviour was changed — proved in §10 by running the full functional battery
with and without this change on identical demo state.

The Apple/macOS direction is preserved. The material system (glass, concentric radii, per-theme
surfaces, shadow ramp) was already good; what had drifted was whether the pages consumed it.

---

## 1. Problems found — measured, not asserted

| Symptom | Before | After |
|---|---|---|
| Arbitrary font sizes `text-[Npx]` | **377** across **20 distinct sizes**, seven of them half-pixel | **0** |
| Named type-scale usages | 291 | **665** |
| Distinct grey text levels | **9** (`text-neutral-*`, 1,567 uses) | 4 named ink roles |
| Metric figure declared inline | **9** call sites copy-pasting the component's internals, **+1** inventing its own | **0** |
| Metric colour | `nth-child(7n+N)` — **7 hues cycling by DOM position** | 5 semantic intents, neutral by default |
| Card tints offered | 7 decorative hues, 4 never used, **2 values pages passed that silently did nothing** | 4, all semantic |
| Kicker/eyebrow above a heading | 11 | **0** |
| Coloured rails wider than 1px | 3px (Today), 2–4px (Pipeline, width also encoding materiality), 2px (divergences) | **0** |
| Ordered series drawn as categorical | Pipeline stage chart, 5 hues for 5 ordered stages | single hue, length carries the comparison |
| `::selection`, `caret-color`, scrollbar thumb | browser defaults | themed |

### The single largest contributor

```css
.pos-bento:not([data-tone]):…:nth-child(7n + 3) .pos-bento-fig { color: var(--color-cat-3); }
```

Every summary figure took a hue **from its position in the DOM**, with a matching diagonal tile
wash. Moving a tile changed its colour while its meaning stayed identical, and a row of six numbers
rendered as six unrelated instruments. The stated intent was that "a summary row is a set of
different measures and identical dark numbers throw that away" — but position is not meaning, and
this was the strongest single source of the assembled-by-committee feel.

### The scale was wrong, not just the pages

`12.5px` (63 uses) and `12px` (44) were the **most common sizes in the product and had no token**,
while `13px` held the name `body`. A page reaching for 12.5px was making a reasonable choice with
nothing to reach for. Fixing the pages without fixing the scale would have re-drifted.

---

## 2. Typography scale — 8 steps, 6 roles

| Role (§3) | Token | Size |
|---|---|---|
| Page title | `hero` | 30 |
| Section heading | `section` | 19 |
| Primary metric | `display` | 26 |
| Primary body | `copy` | 13 |
| Secondary label | `body` | 12 — the dense workhorse: rows, cards, chips |
| | `label` | 11 — uppercase micro-labels |
| Metadata / evidence | `micro` | 10 |
| (reading lead) | `title` | 15 |

Snap applied, chosen so nothing grows into a neighbouring role: `8·9·9.5·10·10.5 → micro` ·
`11·11.5 → label` · `12·12.5 → body` · `13·13.5·14·14.5 → copy` · `15 → title` ·
`17·18·19 → section` · `22·26 → display` · `30·32·34 → hero`.

Half-pixel sizes are gone. Nobody designs on a 0.5px grid across 192 instances on purpose.

---

## 3. Ink ramp — 4 roles, not 9 levels

```
ink        a statement the operator is meant to read and act on
ink-soft   supporting prose that must stay comfortably legible
ink-muted  labels naming a field — present, quiet, ≥4.5:1
ink-faint  metadata and provenance: findable, never competing
```

Shipped as utilities rather than left to `text-neutral-500 dark:text-neutral-400` pairs, because
**the pair is where the drift came from**: nine levels appeared precisely because each surface
picked its own light/dark combination by eye. Both themes are tuned independently so a role means
the same *loudness* in each rather than the same swatch — on a near-black ground a mid-grey reads
far quieter than the same step does on white, so dark's muted and faint sit higher on the ramp.

**A latent dark-mode bug fell out of this.** The central panel-heading rule pinned
`color: neutral-900` with no dark override, so 91 headings resolved to the darkest ink on a
near-black ground; they were legible only where a Tailwind `dark:` utility happened to win. Now
`var(--ink)`, with an explicit dark block.

---

## 4. Card / metric taxonomy

| Component | Job |
|---|---|
| `Metric` (`Bento` retained as an alias) | the ONE top-level summary tile, every room |
| `SummaryBand` | the standardized metric row: tile width, gutter, min-height |
| `Card` | the primary content surface |
| `Panel` | Pursuit-side surface with a title + hint |
| `SectionHeading` | one heading treatment inside a page |
| `Disclosure` | the one progressive-detail control |
| table / list row | dense repetition — deliberately not a card |

`Metric` settles container height, radius, padding, label position, figure size, secondary
annotation, border and shadow in one place. Pages had written the summary row three different ways
(`flex flex-wrap gap-2`, `grid grid-cols-2 gap-3 sm:grid-cols-4`, `grid ... lg:grid-cols-6`) for the
same job; `SummaryBand` owns it, with `align-items: stretch` and a `min-height` so a tile with a
sub-annotation and one without are the same height.

One defect this pass introduced and fixed in the same round: `justify-between` inside the tile
pushed each label to its own bottom edge, so labels on a mixed row sat on different baselines. Now
natural flow — every label sits directly under its figure.

---

## 5. Colour semantics

Five intents, and **`neutral` is the default because most numbers are just numbers**:

```
positive  risk  warning  info  neutral
```

A metric earns a hue only when its **value** carries state to react to. Restraint is the system:
on Today, `decisions to make` is info and `conditions` is warning and `won · 90d` is positive, while
`open pipeline` and `weighted` stay neutral — they are facts, not states.

Card tints were seven decorative hues; four were never used, and two values pages **did** pass
(`sky`, `green`) were absent from the map, so those cards silently rendered untinted while their
author believed otherwise. A palette nobody can predict is not a system. What survives is what the
pages meant — AI-proposed, pending, informational, verified — mapped onto the same tokens the
metrics use, so there is one palette in the product rather than two. **Fixing this made `sky` and
`green` render for the first time.**

---

## 6. Spacing and geometry

- Concentric radii unchanged: `inner 8 · control 10 · input 12 · card 18 · panel 22`.
- Card padding `p-5`; metric tile `p-4`; summary gutter 10px (8px under 640px).
- Summary tile min-height 92px (82px mobile), `minmax(148px, 1fr)` auto-fit.
- Page header margin 24px; heading-to-hint 6px; more space above a heading than below it.
- Purpose-line measure capped at **62ch** (was 78): a purpose line orients, it does not teach.

---

## 7. Page patterns (§9)

| Pattern | Rooms | Structure |
|---|---|---|
| **Command** | Today, Queue | title + purpose · `SummaryBand` · decision list (dot + class chip + governed action) · secondary panels |
| **Portfolio** | Pipeline, Motions, Partners | title + purpose · `SummaryBand` · view tabs · filter chips · dense rows |
| **Object detail** | Pursuit, Account, Partner | back-link · identity header · state strip · anchored `Panel` sections |
| **Intelligence** | Insights, Ask | title + purpose · `SummaryBand` · finding surfaces, each with its caveats in `Disclosure` |

---

## 8. Copy density (§4) and orphan text (§5)

**23 purpose lines** cut to one clause. Sample:

> *"S.M.A.R.T. targets — Specific, Measurable, Achievable, Relevant, Time-bound. Progress is computed from the motions and campaigns linked to each goal, so it never drifts from reality."*
> → **"Targets with progress computed from the linked motions and campaigns."**

**Orphan analytical text put into surfaces.** Motions Overview carried two dense paragraphs sitting
directly on the page background — the clearest instance in the product. They are now one context
surface stating the headline fact in a clause, with every qualifier in `Disclosure`:

> `LIFECYCLE CONTEXT` · 5 accounts · material date inside 90 days · 1 contradicted · *See the deals →*
> ▸ What this does and does not mean

**Uncertainty was never moved behind disclosure.** UNKNOWN counts, contradictions, "not yet
defensible", the unapplied-clause notice and the Ask outcome meanings all stay on the surface.
Progressive disclosure applies to provenance and product explanation, never to doubt.

---

## 9. Exact components normalized

**Tokens** — `globals.css`: type scale (6→8 tokens, values corrected), ink ramp (new), intent
palette (new), `::selection` / `caret-color` / scrollbar thumb (new), positional-rainbow rules
(**removed**), tile wash rebound to intent, panel-heading rule widened + dark override, `.pos-summary`
and `.pos-metric-fig` (new).

**Components** — `Metric`/`Bento`, `SummaryBand`, `SectionHeading`, `Disclosure`, `Card` (tones),
`PageHeader`, `MiniBar` (`series` prop), `StatChip`, `CountChip`, `Panel` (eyebrow → hint),
`TodayDecisionCard` (rail → dot), `DisclosureTheater`, `CompletenessGrid`.

**Rooms** — Today, Motions, Pipeline, Insights, Ask, Partners, Accounts, Pursuits, Queue, Mapping,
Admin, Sources, Intake, Analytics, Ops, Joint, Goals, Review, Trust, Contacts, Campaigns, Upcoming,
Provider-health, Routines, Skills, Login, Join.

`60 files changed, 910 insertions(+), 593 deletions(-)`

---

## 10. Proof no functionality was removed

Full functional battery run **twice on identical demo state** — once with the normalization, once
with it stashed:

```
WITH normalization: 867 assertions passed, 0 failed
BASELINE (stashed): 867 assertions passed, 0 failed
```

Identical. Plus **130 unit tests**, 28 verify suites, clean production build, and the Impeccable
mechanical detector returning `[]` on every changed surface.

Two detector findings were investigated and were false positives — `text-neutral-600` and
`bg-green-700` in one className string that a ternary makes mutually exclusive. They did expose a
real issue: those three stage-advance buttons hand-wrote their own padding, height and text size
instead of using the canonical `buttonClass`, and filled the "closed won" button solid green so one
option in a row of equals looked like the recommendation. Now `ghost` geometry with outcome carried
by ink.

Five verify suites need a provisioned `wsb_verify` database. It exists on the local instance but is
empty (0 relations), so those suites cannot run — pre-existing and unrelated, identical on the
stashed tree.

---

## 11. Desktop / mobile / light / dark

42 full-page captures in `audit/ui-normalization/after/` — 14 rooms × {desktop light, desktop dark,
mobile 390px}. Verified: summary tiles wrap 2-across on mobile at equal heights; the stage chart
reads as one ordered series in both themes; ink roles hold contrast on both grounds; no information
becomes unreadable and nothing collapses into arbitrary wrapping.

---

## 12. Deliberately not done

- **Pursuit Detail was not structurally redesigned** (§11). Section spacing, typography, summary
  cards, text density and repeated labels were normalized; the ~4,500px structure and every
  deep-link anchor (`#value`, `#stakeholders`, `#whynow`, `#team`, `#brief`) are untouched, so the
  certified TD SYNNEX demo path still works exactly as documented.
- **Number formatting was left alone.** Pipeline renders `$6250k` where Ask renders `$6.25M`. That
  is a real inconsistency, but the formatter is shared with non-presentational callers and this pass
  is scoped to presentation. Recorded for the next pass.
- **`Bento` was not renamed at its 16 call sites.** `Metric` is the name; `Bento` is an alias, so no
  room needed editing to gain the new system.
- The rail's overflow fade at short viewports is unchanged — a designed affordance, not drift.
