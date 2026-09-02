# UI Redesign — Wave 2: Core Commercial Operating Experience

**Starting SHA:** `9110250` (contains Wave 1 `41e66dd` → demo Wave 2 `f0bbcaf` → certified TD SYNNEX Wave 3 `66f72f6`)
**Scope:** IA, hierarchy, density, progressive disclosure and interaction design across eight rooms.
**Not in scope:** the visual system. Wave 1's tokens and components are the design authority; nothing here forks or duplicates them.
**Deployment:** none. See "Branch and deployment" below — there is a decision waiting for you.

---

## What was actually wrong

The product was not ugly. It was *unranked*. Nearly every defect below is the same failure in a different room: **two or three things saying one thing, all at the same volume, so the reader cannot tell which one is the answer.**

That shows up three ways:

1. **Duplicate truth.** Today rendered the same two draft motions as a ranked action, as a detail card, and as a counter — three tellings of two facts.
2. **Inverted weight.** Partner Detail set eight blank instruments at 26px above the one sentence that said whether the relationship was working, at 12px.
3. **Unstated exits.** Mapping produced a number and stopped; the way onward existed but only announced itself on hover.

A single visual system, correctly applied, cannot fix any of these — which is why Wave 1 finished clean and the product still read as a set of feature-rich screens.

---

## Room by room

### Today (§4) — one queue, not three

**Was:** eight sibling blocks at equal weight. "Decisions that move revenue" (ranked, 4 cards), "Next best actions" (ranked, numbered), "Pending approvals" (the same drafts again), plus an "Awaiting approval" counter. Two ranked worklists competing to be authoritative, and one fact told three times. All four decision cards carried an identical `DECISION REQUIRED · High · HIGH URGENCY · Approve →` stack.

**Now:**
- The decision queue is the only ranked worklist. "Pending approvals" is gone; its query went with it, so nothing is fetched that isn't rendered. Those drafts still reach the reader — as a ranked item and as a count.
- What remains — "Also queued", "Top opportunities", "Recent activity" — is one row of visibly secondary cards: standing context, not a worklist.
- The elevated-urgency chip is hoisted. When every visible row shares an urgency, it is a property of the queue, not of any row in it, so it is stated once above the list and dropped from the rows. This reuses the display rule the queue already applied to repeated reasons. The moment the queue is mixed, the chips return.
- The class chip was a fixed 92px box narrower than "Decision required", so the most common label in the queue wrapped on every row. Now a minimum, nowrap.

**Measured:** 1990px → 1620px at 1440. Nothing removed but duplication.

### Pursuit Detail (§10) — a persistent summary

**Was:** the longest surface in the product — 3239px of continuous scroll across ten equal panels. Past ~250px the reader lost the account, the thesis and the amount at stake. By the disclosure moment at ~1300px — the point of the whole page — the confidential figure appeared with nothing to be confidential *about*.

**Now:**
- **`PursuitRail`** — a sticky summary carrying who, what, how much, what state, plus five section jumps (Overview · Economics · Evidence · Route & team · Activity). Every value is a compression of the hero directly below it, from the same view object, so the two cannot drift.
- **Deliberately not tabs.** Those anchors already serve deep links from Today, the Brief and ⌘K; tabbing would break all of them and put evidence one click further away than it is now. §15's test is whether the reader loses access to what they were about to verify — hiding evidence behind a tab fails it. Sections stay on the page; the rail navigates them.
- The five-dimension route-candidate matrix moved behind progressive disclosure. It is how you *check* the recommendation, not how you read it — and permanently open it put ~250px of table between the decision and the disclosure moment explaining it. The insight line above already states what the comparison concludes.
- `Panel` gained an `id`; every anchor's scroll margin now clears the rail.

**Measured:** 3239px → 3054px, and the disclosure moment sits above more of the page than it did.

### Partner Detail (§9) — hierarchy inverted back

**Was:** twelve instrument tiles in two rows of six, all at display scale. On this partnership eight read `—`, `$0` or `0`, because a partnership that has not settled a joint deal *has* no joint win rate. Eight oversized blanks led the room; the activation narrative scrolled past at body size.

**Now:** a metric with a value keeps its tile; a metric without one is stated as what it is — not established yet, and which ones. Every figure is unchanged and nothing is hidden. An unestablished measure is a real finding; it just isn't a number, and a 26px `—` claims otherwise. Tiles sit on a fixed six-column track so removing the empty ones doesn't make the survivors louder.

**Measured:** twelve tiles → three, plus two honest sentences.

### Partners (§8) — the summary was bigger than what it summarized

**Was:** five aggregate tiles above two partner cards. "2 partners" counted the two cards beneath it; three of the other four read 0 or $0. The card's most valuable line — the activation chain, where overlap meets acceptance — was the smallest text on it.

**Now:** the count moved to the page subtitle, where a count belongs. The band keeps only genuinely portfolio-level totals, and only while they carry a value; at real ecosystem scale it fills back out on its own. The activation chain and the list/motion tally swapped places and weights.

### Accounts (§5) — the workhorse gets the room

**Was:** five 70px filter tiles spanning the width above a ten-row table, so the *controls* outweighed the rows. Every account name was link-blue, beside a second differently-styled link to a different place — ten identical "open the room" affordances, and a reader choosing between two ways to open the same account. The table wore its own surface recipe (`rounded-xl`, literal white/neutral border) one step off the glass every other room uses. The search placeholder was clipped mid-word.

**Now:** `CountChip` gained a `compact` mode — same counts, links, active state and tone vocabulary, one line instead of a band. One row does one thing: it opens the intelligence pane, and the pane's heading is the labelled way into the full room. Shared glass surface, shared button grammar, placeholder that fits.

### Account Drawer (§6) — a duplicate, and a lost thread

The five sections (Hunt / Why Now / What It's Worth / Through Whom / What Next) are preserved exactly.

- **"Motion" and "Governed action" printed the same sentence on consecutive lines.** They arrive from different sources and on a routed pursuit coincide. Two labels over one fact reads as a bug. When they agree the governed name survives, because it says what will actually run.
- **"Open in Pursuits →" always went to the index**, dropping the account you were reading about and handing you a list to find it again. It now deep-links when a pursuit exists, and says "Browse pursuits" when one doesn't.
- The 104px label column could not hold "Priority · propensity"; every wrap knocked the pane's rhythm out by half a row.

### Mapping (§7) — overlap is an input

**Was:** three control clusters at three alignments and three vertical positions, all choosing what the matrix shows. And the matrix produced a number and stopped: a cell has always linked into the shared accounts and onward to a target list or drafted motions, but the only thing that said so was a hover state and a clause in the fourth sentence of a collapsed legend.

**Now:** one left-aligned control strip, reading in the order you'd say it. The exit is stated in the open where the matrix ends — *"A count here is a starting point, not a result — open a cell…"*. No new wiring; the same link, announced. Matrix on the shared surface; the bespoke green primary (the only green button in the product) now wears the primary treatment.

### Trust (§12/§13) — a control surface, not a brochure

Five of the six guarantees now carry the way to the control that enforces them: the trust ladder, the approval queue, the tenant's ledger, revocation, the verified record.

**Tenant isolation deliberately carries none.** It is a property of every query, with no switch to walk to; inventing a destination would be the one dishonest link on a page about trust.

**§13, the isolation claim, verified rather than asserted.** "Postgres row-level security, forced on every table" was checked against the running database: **151 of 151 public tables have RLS both ENABLED and FORCED**, and no table carrying an `org_id` is exempt. FORCE is the load-bearing half — without it the table owner silently bypasses the predicate. The wording is a literal statement about this schema. If that stops being true, the wording has to change.

---

## One systemic fix (§17)

**The browser's disclosure triangle, in thirty places.** Roughly thirty `<summary>` elements had never suppressed the UA marker, so a raw black ▶ rendered *inside* controls styled as buttons and links — `▶ ☰ Columns` on Accounts, `▶ Organize matrix` on Mapping, a triangle inside Mapping's filled primary button. Meanwhile the few that did suppress it drew their own indicator, so the same affordance appeared in three shapes depending on the file.

Fixed once in `globals.css`: kill the UA marker, generate the product's own indicator for every summary not already drawing one. The opt-out is a signal the codebase already carried — a summary setting `list-none` is exactly one whose author took over the marker, and every such call site pairs it with a glyph or chevron. Verified: zero double-marker cases.

**No files were edited to get this.** Thirty inconsistencies, one rule.

Also systemic: `StatusBadge` gained `whitespace-nowrap` — two-word statuses ("closed won", "opportunity advanced") were breaking inside the pill wherever a column was narrow, so the badge stopped reading as one token and row height jumped per status.

---

## Verification

### Build and static checks
| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `next build` | clean |
| `visual-system-check` (12 rules, 354 files) | clean |

### Screenshot QA (§20) — generated **and inspected**
13 rooms at 1440; Today / Pursuit / Mapping / Accounts / Partner Detail at 1280; Pursuit and Today at 1728. All HTTP 200, **zero JS/console errors, zero horizontal overflow** at any width (the harness probes `scrollWidth - clientWidth` per page).

Inspection caught two defects I had introduced and then fixed: the surviving Partner-index tile stretching to full page width under flex, and the same stretch on Partner Detail's execution row. Both are why the brief says generation is not inspection.

### Regression (§21/§22)
| Suite | Result |
|---|---|
| **`disclosure-verify` (P0)** | **21 passed, 0 failed** |
| `isolation-verify` | 12 passed, 0 failed |
| `federation-verify` | 19 passed, 0 failed |
| `scope-verify` | 17 passed, 0 failed |
| `governed-mutation-verify` | 13 passed, 0 failed |
| `pursuit-verify`, `routes-verify`, `experience-verify`, `governance-verify` | **fail — pre-existing, not this wave** |

**On those four failures, stated plainly.** They abort on `null value in column "slug" of relation "taxonomy_nodes"` while inserting their own fixture — script/schema drift from a migration that made `slug` NOT NULL after the scripts were written. I did not assume this: I stashed the entire Wave 2 diff and re-ran them, and they fail identically without it. This diff is thirteen `.tsx`/`.css` files with no data-layer, SQL or schema change. **Worth fixing, but it is a separate piece of work and I have not touched it.**

The demo world was rebuilt from scratch for this pass (102 migrations + all eight story scripts) so QA ran against the canonical synthetic tenant, not an empty one.

---

## Branch and deployment — a decision for you

**Nothing is deployed.** §23 is respected.

There is a conflict I could not resolve on my own, so I have left it for you:

- My standing instruction is to develop on **`claude/activateos-platform-review-xzkgmd`**.
- That branch is the Vercel **Production** branch for `demo.pursuitos.io` and `pursuitos.io`. Pushing there **auto-deploys**, which would violate §23 and overwrite the frozen, certified TD SYNNEX demo.

So this work is committed to a local branch **`ui-wave-2`**, cut from `9110250`, and **not pushed anywhere**. Pushing to a non-designated branch needs your say-so, and pushing to the designated one needs you to accept a production deploy. Tell me which and I'll do it.

---

## What I did not do

- **No visual-system changes.** No new tokens, no forked components. `CountChip` gained a mode, `Assurance` and `Panel` gained a prop, `PursuitRail` is a new composition over existing tokens in an existing file — no parallel library.
- **No fabricated values.** Every figure on every screen is the canonical one. Where a value doesn't exist, the room now says so in words instead of rendering a large dash.
- **Mapping's `0 campaigns` tile is left standing.** One empty tile among six is legitimate instrumentation; the dashed empty-state border already marks it. Applying the Partner Detail rule there would have been the rule over the judgement.
- **The four drifted verify scripts are not fixed.** Out of scope for a UI wave, and I would rather report them than quietly patch a data-layer script inside a presentation commit.
