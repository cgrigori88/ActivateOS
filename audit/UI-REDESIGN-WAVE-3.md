# UI Redesign — Wave 3: Goals → Motions → Pursuits → Pipeline

**Starting SHA:** `c34a16a93bfd0297ccc46a7843683bb5dced0e39` (`ui-wave-2`)
**Branch:** `ui-wave-3`
**Ending SHA:** recorded at the end of this document.
**Scope:** IA and presentation only. No schema, migration, RLS, tenant, federation, disclosure, scoring, lifecycle, governed-mutation, value, stakeholder, Ask, event/outcome, auth or sending change. No deployment.

---

## The problem

Goals, Motions and Pipeline were three application modules that happened to be adjacent in a sidebar. Nothing on any of the three screens told a reader that the motions on one are the thing producing the opportunities on another, or that both exist to move the number on a third. The relationships were in the database the whole time — `revenue_motions.goal_id`, `opportunities.motion_id` — and the interface used neither.

The result was three rooms that each read as a competent dashboard and together read as nothing. The success test in the brief — *"here is the goal, here is the motion, here are the pursuits, here is the pipeline, here is where it breaks down"* — could not be answered by clicking.

---

## The model, and what makes each edge real

One shared read model (`src/lib/goals/chain.ts`) walks the spine so the three rooms cannot derive it differently and disagree on screen. It defines no domain concept, writes nothing, and computes no score.

| Edge | Mechanism | Honest? |
|---|---|---|
| Goal → Motion | `revenue_motions.goal_id` | **Direct.** A motion states its goal. Linked. |
| Motion → Pipeline | `opportunities.motion_id` | **Direct.** An opportunity states the motion that produced it. Linked. |
| Motion → Pursuit | `revenue_motions.pursuit_id` | **The real edge — and it is NULL on every motion in this tenant.** |
| Motion → Pursuit (fallback) | `revenue_motions.company_id = pursuits.account_id` | **Account-level only.** Not provenance. |

That last row is the one that matters for §6's *"if a relationship does not exist, do not fake a link."* There is no motion→pursuit foreign key set anywhere in the demo world, so the product cannot claim "the pursuit this motion created". It can honestly say the two concern the same account, and that is exactly what the link is labelled: **"pursuit on this account →"**, with a title attribute stating *"Related by account, not by motion provenance."* `pursuit_id` is still preferred whenever it is set, so the link upgrades itself the moment the data does.

**Rendered spine** (`src/components/operating-model.tsx`) — present on Goals, Goal Detail, Motions and Pipeline. The current level is marked; a step with no real destination renders as plain text rather than a link that lies. It is also where the product's vocabulary for its own model is now defined (§7), so the same concept cannot be a *target* here and an *objective* there.

---

## Room by room

### Goals (§3)

**Was:** a configuration surface. Four KPI tiles above a single goal — "1 active goals", "0 behind pace", "0 at target", "1 all goals" — two of which counted the same goal twice and two of which read zero, spending 200px of the first viewport restating the thing directly beneath it. The goal card showed a percentage and a partner split but nothing that was *carrying* the number, so a reader could see 25% and had nowhere to go. Directly beneath sat a four-field "set a target" form.

**Now:**
- KPI band removed. Where the counts still say something — how many are behind pace — they sit on the filter row as a clause, beside the filters that act on them.
- The goal card gained **"Carried by"**: motions, opportunities produced, open pipeline, and the blockers holding the rest up, each linking to where you act.
- Both target-authoring forms are behind disclosure. Setting a target is quarterly; reading attainment is daily.
- The goal name links to a new detail room.

### Goal Detail (§3) — new route `/goals/[id]`

The room that answers *"why are we ahead or behind?"*, in the order the question is asked: target and pace → **what is holding it up** → the motions carrying it, each with the opportunities and open pipeline it has produced and a link to the pursuit on its account → contributing partners.

It is a presentation over `listGoals` and `goalChain` — the same functions the index uses, so the two rooms cannot disagree about a number.

### Motions (§4)

**Was:** the funnel already existed and was rendered as one line of running text — `10 evaluated → 8 qualify → 8 route-viable → 7 timing verified → 1 team ready → 1 execution-ready` — at body size with equal weight on every stage. The single most important fact in the room, that six of seven accounts fall out at team readiness, was invisible. Blockers lived entirely behind the Constraints tab: the overview said "8 blocked" and offered a button.

**Now:**
- **The funnel is a funnel.** Same stages, counts, links and read model; the bar is scaled to the first stage so the drop is the shape, per-stage deltas are marked, and the largest fall-off is named in words: *"Largest fall-off: 6 accounts between timing verified and team ready."*
- **Blockers moved onto the overview** — top three causes with their exposure, from the identical `aggregateConstraints` call the Constraints tab uses, so the two surfaces cannot disagree. The tab keeps the full breakdown.
- The goal it serves is named and linked.
- Four tabs kept. They are genuinely four densities of one surface and nothing was removed.

### Pipeline (§5)

**Was:** roughly a thousand pixels of aggregate reporting between the page title and the Attention/Portfolio/All switcher. On a 1000px viewport an operator could not see a single pipeline row — or even the control that chooses which rows to see — without scrolling.

**Now:**
- **The three analytical blocks** (qualification-vs-outcome, stage mix, base/joint roll-up) are behind one `Pipeline analytics` disclosure. Nothing removed, no figure changed, one click restores the previous layout exactly.
- **Renewal radar** shows the three nearest rows — it is already sorted by how close the clock is — with the rest one click away.
- The empty "reg'd deals" tile appears only when it has something to report.
- Attention remains the default; Portfolio, All and Review are untouched in behaviour.

**Measured:** the view switcher moved from y≈1027 to y≈733; the first Attention card from y≈1100 to y≈780.

---

## Demo-data assumptions

- **No synthetic goal was created.** §3's condition was already satisfied: the canonical world contains one active goal, `$5M Virtualization Co-Sell Pipeline — Q4 2026`, with five motions linked by `goal_id`, seeded earlier by `scripts/demo-goal.ts` through existing primitives. **No actual is written** — progress derives from the linked motions.
- Chain verified in the database before any UI was built: goal → 5 motions → 4 opportunities → $3.67M open.
- 0 motions carry `pursuit_id`; 7 share an account with a pursuit. This is why the pursuit link is labelled account-level.

## Reconciliation (§10)

Three money figures appear across the three rooms. All three are correct, none was altered, and each is labelled by scope:

| Figure | Measure | Where |
|---|---|---|
| **$1.25M** | motion-level — sum of `estimated_value_usd` on goal-linked motions | Goal progress |
| **$3.67M** | opportunity-level — open amount on opportunities naming those motions | Goal "Carried by" / Goal Detail |
| **$6.25M** | opportunity-level, **whole book** — every open opportunity | Pipeline |

The first two differ because they count different objects at different stages; Goal Detail carries a *"Why the two totals differ"* disclosure saying so. The third differs from the second because it is not scoped to one goal; the Pipeline spine now says **"across every motion"** so a reader arriving from a goal is not left comparing two different scopes as if they were the same measure. **No fact was changed to make anything reconcile.**

---

## Cross-link verification (§6)

Verified against the running production build, not by reading source:

- All four spine hrefs (`/goals`, `/motions`, `/pursuits`, `/pipeline`) present in the served HTML of **all four** rooms.
- Goal → Motion: `/goals/e1a9dcf5…` present on `/motions`. ✓
- Motion → Pursuit: **all five** per-motion pursuit links on Goal Detail resolve **200**. ✓
- Every link target resolves 200, including `/goals/[id]` and `/pipeline?view=portfolio`.

---

## Screenshot QA (§11) — generated **and inspected**

12 captures: 10 rooms at 1440 (Goals, Goal Detail, Motions, Motion blockers, Motion pursuits, Pipeline Attention / Portfolio / All / Review, and a Motion→Pursuit navigation state), plus Pipeline Attention and Motions at 1280.

**All HTTP 200. Zero JS/console errors. Zero horizontal overflow at either width** (the harness probes `scrollWidth − clientWidth` per page).

Defects found by inspection and repaired before reporting:
- Pipeline's view switcher still sat below the fold after the analytics move → renewal radar trimmed to its three nearest rows.
- Pipeline's spine reported the whole book against a goal's slice without saying so → label corrected to "across every motion".

Checked for and not found in the ship state: giant empty cards, repeated metrics, unclear funnel progression, broken cross-links, KPI overload. Motions retains some trailing whitespace at 1440 with a single hypothesis in scope; it is far smaller than the ~500px void before this wave, and it fills with real content as hypotheses are added.

---

## Tests

| Suite | Result |
|---|---|
| `tsc --noEmit` | clean |
| `next build` | clean |
| `visual-system-check` (12 rules, 357 files) | clean |
| `disclosure-verify` | **21 passed, 0 failed** |
| `isolation-verify` | 12 passed, 0 failed |
| `federation-verify` | 19 passed, 0 failed |
| `scope-verify` | 17 passed, 0 failed |
| `governed-mutation-verify` | 13 passed, 0 failed |
| `outcomes-verify` | 18 passed, 0 failed |
| `tenant-flags-verify` | 13 passed, 0 failed |
| **Total** | **113 passed, 0 failed** |

### Known pre-existing failures — signature confirmed unchanged (§12)

Re-run only to confirm they still fail for the same reason. **Not repaired in this wave.**

| Script | Signature | Same as Wave 2? |
|---|---|---|
| `pursuit-verify` | `null value in column "slug" of relation "taxonomy_nodes"` | yes |
| `routes-verify` | `null value in column "slug" of relation "taxonomy_nodes"` | yes |
| `experience-verify` | `null value in column "slug" of relation "taxonomy_nodes"` | yes |
| `governance-verify` | `current transaction is aborted` (`exec_parse_message`) | yes — a downstream symptom of the same fixture failure, and the same signature it showed in Wave 2 |

All four are scripts inserting their own fixtures against a schema that later made `taxonomy_nodes.slug` NOT NULL. This wave touches no data-layer file.

---

## Deferred

- **`taxonomy_nodes.slug` fixture drift** in the four verifier scripts. A data-layer fix, deliberately out of scope for a presentation wave.
- **`revenue_motions.pursuit_id` is unset across the demo world.** The UI already prefers it and degrades honestly, but until it is populated the Motion → Pursuit edge is account-level. Populating it is a seed/domain change, not a UI one.
- **Motions' four-tab model** was simplified visually, not structurally. Collapsing Constraints and Pursuits into the overview would change what "Manage" means and risks behaviour, which this wave's boundary forbids.

---

## Success test

> *Here is the business goal. Here is the motion we are using to achieve it. Here are the specific pursuits created by that motion. Here is the pipeline those pursuits are producing. Here is where the commercial system is breaking down.*

Answerable by clicking, with one honest correction the data forces: the pursuits are **on the accounts those motions run on**, not provably *created by* them, because no motion in this tenant carries a `pursuit_id`. The interface says which it is rather than overstating the link.

Where it breaks down is stated in three places and agrees in all three: **1 active motion with no opportunity yet, $250K held up** (Goals), **6 accounts lost between timing verified and team ready** with route decision, team staffing and participant acceptance named and priced (Motions), and **$1.1M at risk / $1.5M stalling** by partner (Pipeline Portfolio).
