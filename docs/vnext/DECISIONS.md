# PursuitOS vNext — Decisions

Durable architecture, product and UX decisions for the vNext lane. Append, don't
rewrite: a superseded decision stays, marked `SUPERSEDED`, with the reason.

**Last updated:** 2026-09-14 (Slice 2A — D-024…D-033)

---

## D-001 · Preserve the existing product

**Decision.** vNext is an additive evolution of PursuitOS. There is no "vNext app",
no parallel product, and no rewrite.

**Why.** The existing application is a certified, demo-ready product with mature
substrate for much of P0–P2. Rebuilding would discard working governance, disclosure
and demo-integrity machinery that took many waves to get right, and would trade a
known-good product for an unknown one.

**Consequence.** Every slice lands underneath surfaces users already know. A change
that requires a new room needs an explicit exception recorded here.

---

## D-002 · Progressive enhancement over rebuild

**Decision.** New primitives are consumed by existing surfaces, not exposed as new
ones. Today, Pipeline, Pursuit Detail, Approvals, Activity, Partner View and
command/search get smarter; they do not get replaced.

**Why.** The value is in the app becoming more intelligent, not in there being more
app. Users measure improvement by better decisions, not by more screens.

---

## D-003 · Complexity underneath, clarity on top

**Decision.** The architecture may become significantly more complex. The interface
must become **no more complex — and ideally simpler.**

**Consequence.** A slice that adds a panel must justify why it could not instead
deepen, replace or merge an existing one. Pursuit Detail already composes 18
surfaces; adding a nineteenth is a failure mode, not progress.

---

## D-004 · Recommendation ≠ decision

**Decision.** A recommendation is never silently promoted to a decision, and a human
decision never overwrites the recommendation that preceded it. Both are preserved
and both remain visible.

**Why.** This is already a load-bearing product invariant — the Globex demo beat
turns on "Recommended CDW vs Selected WWT (human override — recommendation
preserved)". It is also what makes the learning system (P8) possible at all: you
cannot learn from overrides you have overwritten.

**Consequence.** Any new recommendation surface (next-best action, pertinence
ranking) must persist the recommendation independently of the human choice.

---

## D-005 · Generated narrative never replaces canonical evidence

**Decision.** LLM-generated prose may *summarise* or *sequence* canonical evidence.
It may never *be* the evidence, and it may never assert something the canonical
record does not support.

**Consequence.** Every explanatory surface cites its source records. If there is no
evidence, the honest output is an explicit UNKNOWN — not a fluent sentence. The
existing `WhyNowView.unknowns[]` is the pattern to follow: the product already says
"No verified timing anchor" rather than inventing one.

---

## D-006 · State ≠ memory

**Decision.** Pursuit **State** is what PursuitOS currently believes. Pursuit
**Memory** is the full chronological record of how that belief came to be. They are
two distinct read-models over one append-only ledger, and neither substitutes for
the other.

**Why.** The audit found these conflated: `getPursuitTimeline` filters by
`isTimelineWorthy(materiality)`, so LOW-materiality events never appear. That is
correct for an executive attention feed ("What Changed") and wrong for a memory,
which must be complete. Additionally it orders by `recorded_at` (when PursuitOS
wrote the row) rather than `occurred_at` (when the change happened in the business)
— and `change_ledger` carries both deliberately, with the pursuit index already on
`(pursuit_id, occurred_at desc)`.

**Consequence.** Memory reads by business time and does not filter by materiality;
What-Changed keeps its current filtering. Three read-models over one ledger, not one
compromise.

---

## D-007 · LLM reasoning is separated from deterministic authorization, calculation and mutation

**Decision.** Models may interpret, rank, summarise and explain. They may not
authorize, compute a reported metric, or perform a mutation. Authorization,
arithmetic and writes are deterministic code.

**Why.** A number a user acts on must be reproducible, and a permission decision
must be auditable. Neither property survives being delegated to a model.

**Consequence.** Scoring stays in `src/lib/scoring` and `src/lib/pursuits/scoring.ts`.
Materiality stays a server-side policy authority
(`read-models/materiality.ts`) — "the UI never decides `delta > 5 = material` on its
own", and neither does a model.

---

## D-008 · New consequential writes trend toward governed domain actions

**Decision.** Any new write with commercial or cross-company consequence is
implemented as a governed domain action — approval-gated, audited, and recorded in
the ledger — rather than as a direct mutation from a surface.

**Consequence.** Slices that only read (Slice 1) need no new governance. Slices that
act (Slice 2 onward) must route through the existing governed-action machinery
(`GOVERNED_ACTION_ENABLED`, `governed_action_invocations`, which is append-only).

---

## D-009 · Private, shared and derived context must remain distinguishable

**Decision.** For every piece of context the system holds, it must remain
answerable: is this ours alone, was it shared with us, or did we derive it? The
distinction is never flattened.

**Why.** It is the basis of the intercompany trust boundary (P6) and of the
disclosure behaviour the demo depends on — the Sponsor⇄Partner toggle removes a
confidential figure **at the server**, "absent from this payload, not hidden in the
browser". Flattening provenance would make that guarantee unenforceable.

**Consequence.** New context primitives carry provenance from the start.
`facts.provenance_class` and the contribution model are the existing precedent.

---

## D-010 · Dynamic Pursuit Surfaces cannot invent permissions, metrics or write logic

**Decision.** A dynamic surface composes canonical data, existing metrics and
existing governed actions. It never defines its own data model, permission rule,
metric definition, state mutation or write path.

**Why.** A surface that can define its own permissions is a permission bypass with a
friendly name. A surface that can define its own metric produces numbers that do not
reconcile with the rest of the product.

**Consequence.** The dynamic-surface layer is a *query and composition* layer over
registered, named primitives — the existing intent registry (`src/lib/search/registry.ts`,
`intents.ts`) and interpreter catalog (`src/lib/interpret/catalog.ts`) are the
precedent to extend, not replace.

---

## D-011 · AI Control Plane and Pursuit Runtime start as thin backend primitives

**Decision.** P4 and P5 land first as backend registries, ledgers and observability
— **not** as major user-facing navigation. No "Control Plane" room.

**Why.** Operator tooling that arrives before the capability it governs is dead
weight, and a new top-level room contradicts D-003.

**Consequence.** `VNEXT_CONTROL_PLANE_ENABLED` is deliberately independent of the
tenant `experience` gate in `src/lib/env/vnext-flags.ts`, because it exposes no
tenant surface. Existing `/skills`, `/ops` and `/admin` are the surfaces to deepen
if operator visibility is needed.

---

## D-012 · Architecture terminology is never user-facing

**Decision.** Users never see "Context Health Engine", "Pursuit State Engine",
"Pertinence Engine" or similar. Internal names stay internal.

**Consequence.** The Slice 1 surface reads as *Why this matters · Current state ·
What changed · What's missing · Next move*, in the product's existing plain-language
voice.

---

## D-013 · vNext flags are a separate, narrowing staging layer — not a second flag system

**Decision.** vNext roadmap flags live in `src/lib/env/vnext-flags.ts` as
**env-only** gates. They do not get `org_features` columns until the capability
behind them is real.

**Why.** The shipped system is `envEnabled(flag) && org_features.<flag>` — env
master plus per-org opt-in, fail-closed and audited. That is the right shape for a
*shipped* capability being piloted by one tenant. It is the wrong shape for an
*unbuilt* capability, because adding `org_features` columns would mean migrating the
demo database for features that do not exist.

Env-only is also exactly the granularity the requirement needs: the preview
deployment arms them, demo and production set none of them and are dark by omission.

**The safety property, and how it is enforced structurally.** A vNext flag can only
ever **narrow**. It can hide a surface; it can never reveal one, widen a scope,
satisfy a permission check, or stand in for the tenant gate. This is enforced by
type signature, not convention: `vnextCapabilities(tenant: TenantFeatureView)` takes
the already-resolved tenant gate as a parameter and ANDs against it, so a caller
cannot reach a vNext capability without first having called
`tenantFeatures(db, orgId)`. There is no exported reader that grants a user-facing
capability from a vNext flag alone.

**Graduation path.** When a capability becomes real it gains an `org_features`
column, moves under the tenant system, and its vNext flag is retired.

**Naming.** `VNEXT_<CAPABILITY>_ENABLED` — the `VNEXT_` prefix marks the staging
lane; the `_ENABLED` suffix matches the existing `PURSUITS_ENABLED` family so the
whole flag surface greps as one thing.

---

## D-014 · Session 0 develops against the local synthetic path, not preview

**Decision.** Slice development uses the local synthetic database
(`scripts/seed-demo-world.ts` against local Postgres `pursuit_demo`). Preview
deployments are for **read-only visual review** until preview write-safety is
verified.

**Why.** Preview data access is classified **UNKNOWN**, and the available evidence
suggests Preview may share `DATABASE_URL` with Production — i.e. the hosted database
that serves Monday's demo. See `ENVIRONMENT-MAP.md` §6.

**Consequence.** No preview writes. No new database. No credential changes. The
local path is already isolated, already seeded, and already guarded by
`assertSyntheticDatabase`.

---

## D-015 · Completion does not imply deployment

**Decision.** Finishing a feature is not a decision to ship it. Promotion to the
demo requires explicit human approval against `DEMO-PROMOTION-GATE.md`, and the
default answer this weekend is **NO**.

**Why.** There is a demo on Monday 2026-09-14. A feature completed late and promoted
untested is strictly worse than no feature.

---

## D-016 · Slice 1 read-models are pure functions over typed inputs; loaders land with their consumer

**Decision.** `context-health.ts`, `memory.ts`, `missing-context.ts` and
`pertinence.ts` export pure composition functions taking explicit typed inputs.
They perform no database access. The SQL loaders that feed them are written in
chunk 5, alongside the first consumer and the integration verifier.

**Why.** Chunks 1–4 were required to be independently reviewable and to have no
rendered consumer. A loader with no consumer and no integration test is code
nobody has executed against a real schema — it would look finished and be
unverified. Pure functions with declared inputs can be exhaustively tested with
no database at all, which is what actually happened: 67 tests, no fixtures, no
container.

The input types are shaped as direct projections of the canonical tables
(`facts` ⋈ `pursuit_facts`, `change_ledger`), so the loaders are mechanical
rather than interpretive. Nothing is reinterpreted between SQL and composition.

**Consequence.** Chunk 5 adds the loaders *and* their verifier together. A loader
must never merge without an integration test that runs it against a real schema.

---

## D-017 · Pertinence is pursuit- and decision-relative; portfolio-relative pertinence is a different question

**Decision.** `pertinence.ts` answers "within this pursuit, and for the decision
this caller is making, what should they look at next?" It ranks facts, remembered
events and open gaps against each other on one list.

It does **not** answer "why this pursuit rather than another one". That is a
portfolio ranking question, it needs cross-pursuit inputs this module
deliberately does not take, and it belongs to Slice 3.

**Why.** The Slice 1 plan described this module as "Why this pursuit? — pertinence
relative to the portfolio". Building it revealed those are two different
computations with different inputs and different consumers. Conflating them
would have produced a module that did neither well, and would have pulled
cross-pursuit data into a pursuit-scoped slice.

**Consequence.** The Slice 1 narrative's "Why this matters" is assembled from
context health, the top gap and the top pertinent items — all pursuit-scoped.
A genuine portfolio-relative "why this pursuit" is deferred to Slice 3 and is
noted as such in `BUILD-PLAN.md`.

---

## D-018 · Disclosure filters before ranking, never penalises within it

**Decision.** Anywhere a read-model ranks or counts, items the caller may not see
are removed **before** the computation and contribute nothing — not a lowered
score, not a displaced neighbour, not a reason string. Only an aggregate count is
disclosed.

**Why.** A restricted item that merely scores lower still shifts the positions of
the visible items around it. Its existence, and something about its properties,
becomes inferable from the ordering. That is a leak by arithmetic, and it is
invisible to a test that only checks "the secret string is absent".

**Consequence.** `rankPertinence` filters first and is tested by comparing the
complete visible ranking with and without a restricted item present, asserting
the scores and order are identical. `composeMissingContext` applies the same rule
and additionally refuses to report un-entitled information as the caller's own
knowledge gap — a boundary is not a hole.

---

## D-019 · Composition must preserve upstream meaning

**Decision.**

> A downstream intelligence layer may re-rank information for a task, but it must
> not silently discard the importance, source, state, confidence, provenance, or
> other decision-relevant semantics established by an upstream canonical or
> read-model layer.

**Why.** Chunk 5A's harness caught exactly this failure. `composeMissingContext`
ranked the Globex pursuit's gaps carefully — economic buyer 80, timing anchor 72,
qualification 56, value drivers 50 — and the conversion into
`PertinenceCandidate` kept only `gapKind`. All eleven MISSING gaps then tied on
linkage, the two most important gaps vanished from the top five, and the timing
task could not see a timing gap. The information was not wrong anywhere; it was
*dropped in transit*.

**The division of authority this implies.**

| Layer | Authoritative for |
|---|---|
| Upstream (gap / canonical read-model) | gap kind and state · source and domain · declared importance / rank · explanation · provenance |
| Downstream (pertinence) | task-relative relevance · user- and scope-relative relevance · recency · pursuit linkage · unresolved state · corroboration |

**This is not a licence to duplicate business logic.** Preserving upstream
meaning means *carrying* it, never recomputing a parallel version of it. If a
downstream layer needs a number the upstream layer already produced, it takes
that number.

**And carrying is not the same as adding.** Where the upstream value and a
downstream signal answer the *same* question, the richer one **replaces** the
coarser one — it is never summed on top, which would count one business signal
twice and make the arithmetic indefensible. Where they answer *different*
questions (upstream importance vs task fit), they are separate contributions.

**Test for a violation:** can a reader answer "why did this rank here?" from the
exposed contributions alone? If the answer requires knowing something the
upstream layer decided and the downstream layer silently re-derived, the
composition is wrong.

---

## D-020 · Direct pursuit evidence and pertinent account context are not equivalent

**Decision.**

> Direct pursuit evidence and pertinent account context are not equivalent.
> PursuitOS should privilege facts explicitly linked to a Pursuit while retaining
> authorized account-level context that is materially relevant to that Pursuit.
> The UI must preserve that distinction without forcing users to understand the
> underlying data model.

**Why this is not theoretical.** The original chunk 5B-2 plan was to replace
account-scoped facts on Pursuit Detail with pursuit-scoped facts. The seeded
Globex pursuit has exactly **one** linked fact, while its account holds a
`renewal_date` at 0.92 confidence (`CUSTOMER_DECLARED`) and five economic
drivers. Making that swap would have deleted the most useful evidence on the
screen — including the timing anchor whose absence is the pursuit's
second-ranked gap. The plan was superseded before it was built.

**The pipeline this implies.** Not `account facts → show them all`, and not
`pursuit facts → show only those`, but:

```
account context → authorization → pertinence → supporting pursuit context
```

**The Pursuit remains the organizing object.** This is not permission to revert
to account scope. Supporting context is *derived for this pursuit*, ranked by
this pursuit's decision needs, and always labelled as inferred.

**The distinction is structural, not a flag.** `PursuitEvidenceView` returns
`direct` and `supporting` as separate arrays. A single array with an
`isLinked` boolean would work until the first downstream consumer forgot to read
it — and the failure would be silent and unfalsifiable.

**Why it matters beyond this screen.** "The system considered this pertinent" and
"this fact was explicitly linked to the pursuit" are different claims. Conflating
them would poison any later attempt to learn which linkages turned out to be
right (P8), because the training signal would no longer distinguish a human
assertion from a machine guess.

**Consequence — no false linkage.** Ranking well never writes `pursuit_facts`.
Relevance for supporting context is derived with the same canonical
`deriveRelevance()` the linker uses, so a supporting fact is typed exactly as it
*would* be if linked, and the derived value travels as ranking input only.

Wording is part of this. A reason string that says "linked to this pursuit"
about an unlinked fact asserts a linkage nobody made — caught by the verifier
and corrected to "would bear on this pursuit … inferred, not linked".

---

## D-021 · One composed surface may replace several, but only where it reduces what the reader assembles

**Decision.** Chunk 6B replaces the Why Now, Facts and What Changed panels with
one "This pursuit" narrative when `VNEXT_PURSUIT_INTELLIGENCE_ENABLED` is armed.
Rendered panels go from 11 to 9 on the canonical Globex pursuit.

**Why those three and not others.** They were three fragments of a single story —
why this is live, what supports it, what moved — and the reader had to assemble
it. Panels that answer genuinely different questions (Route decision, Value case,
Stakeholders, Federation) are untouched, because merging those would hide
distinct decisions rather than unify one story.

**The naming collision this exposed.** `read-models/brief.ts` already owns
`PursuitBrief`, the exportable disclosure-aware document behind the Brief button
on the same page. The new surface is therefore Pursuit **Context** in code, even
though the product concept the user names is a brief. Two things with one name in
one route is a trap that outlives whoever created it.

**Anchors are part of the contract.** `#whynow`, `#evidence` and `#activity` are
deep-linked from six call sites. The collapsed panel carries all three, so no
existing navigation breaks. See `ACCEPTANCE.md` U-13.

**Copy is chosen in the view-model, not the component.** The five state phrasings
live in one declared table. Keeping the choosing out of the component is what
stops the vocabulary collapsing in a later style pass. See U-14.

---

## D-022 · Product copy is translated deterministically in the view-model, from structure

**Decision.** Canonical records carry operational strings — enum fragments,
counts with a hard-coded plural, semicolon-joined label lists, prose written for
an audit trail. A read-model that feeds a user-facing surface translates them
into product language itself, by **declared table lookup and inspection of the
canonical structured payload**. Not by an LLM, not by a template filled from free
text, and not by regex over the canonical prose.

**Why not an LLM.** This copy states what the record says. A generated sentence
can assert a causality or a certainty the record does not carry, and there is no
cheap way to test that it did not — which is D-005 and D-007 applied to wording
rather than to numbers.

**Why not prose parsing.** The ledger's `reason` for a stakeholder assertion is
`champion — verified (supersedes champion — inferred)`. Parsing that string for
role, state and supersession would work until someone reworded the audit
message. The same facts are in `afterState.role`, `afterState.assertion_state`
and `beforeState.assertion_state`, which are schema-constrained. Read the
structure; the prose is a fallback, not a source.

**Three properties every translation must hold.**

1. **Degrade, never guess.** A change type, role or state the table has not seen
   produces the canonical string, tidied. Slightly clumsy copy is an acceptable
   outcome; an invented detail is not.
2. **Disclosure survives.** `buildPursuitMemory` withholds `before_state` /
   `after_state` from a caller without internal visibility, so the structured
   path is simply unavailable for a guest and the fallback runs. A guest sees
   plainer words and never a payload they may not read. This falls out of the
   design rather than needing a second code path — pinned by test.
3. **The canonical value travels.** Every rendered line keeps the source string
   (`canonicalReason`). The rendered words are a presentation of the record, and
   the record stays inspectable next to them.

**Where it lives.** In the view-model, never the component — the same rule U-14
already established for state labels, for the same reason: a component that
picks its own words is where a carefully built vocabulary quietly collapses in a
later style pass. The one thing the component may still do is `humanizeText`,
which only title-cases embedded `UPPER_SNAKE` tokens and chooses no word.

---

## D-023 · A composed surface takes the width its content needs, and the grid is rebalanced around it

**Decision.** When one surface absorbs several, its footprint in the page grid is
part of the merge, not a detail to inherit from whichever panel it replaced. The
Pursuit Context surface spans both desktop columns and lays its evidence beside
its open questions; at narrow widths that grid collapses into the same semantic
order.

**Why.** Inherited as a half-width card, the merged surface stood 1,068px tall
beside a 475px Value case — 593px of dead space immediately below the fold, in
the most valuable region of the page — and the page came out 28px *longer* than
before the merge. The narrative was right and the geometry was wrong, and the
panel-count metric (11 → 9) could not see it.

**Consequence, and the part that is easy to miss.** Changing one panel's span
changes the row structure for its neighbours. Absorbing "What changed" left
"Outcome & attribution" without a row partner, and making the composed surface
full width left "Value case" without one too. Those two now pair. The rule:
after a merge, account for **every** half-width panel in the affected rows, not
just the one that changed — a merge that fixes its own void by creating two
smaller ones has not finished.

Panels are repositioned by `lg:order` only. No panel outside the merge has its
content, design or behaviour altered, and the flag-OFF layout keeps its original
ordering exactly — proven by comparing panel geometry, panel for panel, before
and after.

---

## D-024 · Pursuit Coordination is Goal → Plan → Motion → Action, composed over what already exists

**Decision.** Slice 2A adds exactly three things — a pursuit goal, a pursuit plan
identity, and the plan's append-only revision history — and composes everything else
from existing primitives:

| Concept | Existing primitive reused | New? |
|---|---|---|
| Motion | `revenue_motions` | no |
| Action | `motion_actions` (the Queue) | no |
| Approval | `dispatchSkill` → `governed_action_invocations` | no — two new skills on it |
| Override | `pursuit_overrides` (`field = 'plan'` added) | no |
| History | `change_ledger` (`PLAN_DECIDED`, `PLAN_REVIEW_REQUIRED` added) | no |
| Owner | `pursuit_team_members` roles | no |
| Focus + why | Slice 1 missing-context / evidence semantics | no |
| Goal | `pursuit_goals` | **yes** |
| Plan | `pursuit_plans` + `pursuit_plan_revisions` | **yes** |

**Why.** The prompt's stop condition — "the proposed model would require replacing
existing motion/approval primitives" — was checked first and does not fire. A plan
*references* a motion and *stages* an action; it does not model either.

## D-025 · The flag is `VNEXT_PURSUIT_COORDINATION_ENABLED`; `next_best_action` stays reserved

**Decision.** The P3 surface ships behind a new flag, `pursuit_coordination`, which
requires `pursuit_intelligence` (a plan's focus and why are composed from Slice 1 and
cannot render without it). `VNEXT_NEXT_BEST_ACTION_ENABLED` is left exactly as it was
— never implemented, now marked reserved.

**Why not reuse `next_best_action`.** The roadmap amendment replaced the isolated
next-best-action idea with a plan. Giving the old name a new meaning would make any
deployment that already names the variable change behaviour silently.

## D-026 · A pursuit goal is not an org goal

**Decision.** `pursuit_goals` is a new table, not a `pursuit_id` column on `goals`.

**Why.** `goals` (0026) is an org-level S.M.A.R.T. portfolio target whose progress is
computed from linked motions, which the /goals room lists — and which the certified
demo manifest counts. A pursuit's goal ("close the $920K opportunity" — the outcome, never the route; D-033) is a
different object, owned differently, with a different lifecycle. Overloading `goals`
would put pursuit goals into the portfolio room and move the certified digest.

## D-027 · Plan history is append-only revisions; only human decisions and review triggers reach the ledger

**Decision.** Every recommendation and every decision is its own
`pursuit_plan_revisions` row. A DECISION references the RECOMMENDATION it answers
(`responds_to_revision_id`) and carries its own copy of the content, so a revision is
self-contained. Revisions are INSERT-only for `app_rw`. `change_ledger` receives
`PLAN_DECIDED` (a person decided) and `PLAN_REVIEW_REQUIRED` (the system found an
approved plan stale) — **not** a row for each system recommendation.

**Why the ledger asymmetry.** A recommendation is a proposal, not a change to the
pursuit; its history is the revision table. And writing one would have put "Pursuit plan
recommended" at the top of the frozen Slice 1 "What changed" for Globex, altering a
certified surface for an event nobody acted on. Verified: seeding the Globex plan leaves
its ledger at 10 rows.

**P8 consequence.** Recommendation, recommendation time (`created_at`), evidence basis
(`basis`), human decision, override (`adjustments` + `pursuit_overrides`), action selected
(`content.nextAction`, same `key` across revisions) and what actually happened
(`motion_actions.status`, ledger, outcomes) are separate, joinable, append-only facts.

## D-028 · Course correction is a fingerprint comparison; evidence makes a plan reviewable, never rewrites it

**Decision.** A recommendation carries a deterministic fingerprint of the normalized
inputs it was computed from (focus gap, milestone statuses, route decision, motion,
owner assignment, opportunity stage, pursuit status — nothing time-varying). The plan in
force is CURRENT while the live fingerprint matches, and REVIEW_NEEDED when it does not,
with reasons produced by a structural diff of the inputs. Reading the page computes this
and writes nothing. Recording an updated recommendation appends a revision with a
`review_trigger` (the plan it responds to, the reasons, the ledger events since) and a
`PLAN_REVIEW_REQUIRED` event. The approved plan stays in force until a person decides.

**And a stale recommendation cannot be approved.** `decidePlan` recomputes the live
fingerprint and refuses to put a recommendation in force against a pursuit that has
moved since it was made. Declining is always allowed.

## D-029 · Milestone status is computed from canonical domains; dependencies are declared policy

**Decision.** Each milestone resolves from one canonical domain (route decision,
stakeholder assertion state, Why-Now timing anchor, MEDDPICC element state, value-case
state, opportunity stage) — never typed, the rule `goals.ts` already follows. Dependencies
("decision and paper process" waits on the economic buyer; closed-won waits on
everything) are declared in one table with their rationale, and are planning policy, not
commercial facts. A milestone whose domain is withheld or not established is
NOT_ESTABLISHED or omitted — never OPEN work the reader failed to do.

## D-030 · The motion is named only through a canonical link; approval stages the action onto an active motion only

**Decision.** The plan's motion is the `revenue_motions` row that names the pursuit, or
the motion this pursuit's opportunity is attributed to (`opportunities.motion_id`) —
labelled as such. Never an account/category inference. On Globex, the WWT Virtualization
motion carries `pursuit_id = null` and is reached through the opportunity.

Approval (APPROVED/ADJUSTED) stages the next action as a pending `motion_actions` step on
that motion **only if the motion is active**; otherwise the action stays with the plan,
unqueued, and the surface says so. No approval sends, calls a provider, or touches the
outbox.

## D-031 · New history tables must REVOKE the 0058 default privileges explicitly

**Decision.** Migration 0103 revokes UPDATE/DELETE from `app_rw` on its three tables and
re-grants only forward lifecycle columns.

**Why this is recorded.** 0058 runs `alter default privileges … grant select, insert,
update, delete on tables to app_rw`, so a new table's `grant select, insert` alone leaves
it fully mutable. The first draft of 0103 did exactly that; the Slice 2A harness caught
it (six failed privilege checks) before commit. Any future append-only table needs the
explicit REVOKE that 0094 and 0103 carry.

## D-032 · The owner is a pursuit-team role, and "unassigned" is a first-class answer

**Decision.** A next action's owner is resolved from `pursuit_team_members` by the role a
declared table assigns to the focus's source (account executive for coverage,
qualification and timing gaps; solution architect for value; specialist for research).
Three honest states: a named PERSON, a ROLE_UNFILLED (the role exists only as a
recommendation — "Unassigned — Account executive role proposed, no one confirmed yet"),
or UNASSIGNED. On Globex every team role is still RECOMMENDED with no person, so the
owner reads Unassigned. A person can assign an owner when adjusting.

---

## D-033 · Pursuit Goals express durable commercial outcomes; Plans express how the ecosystem intends to achieve them

**Decision.**

> **Pursuit Goals express durable commercial outcomes; Plans express how the
> ecosystem intends to achieve them.**

A goal states WHAT the pursuit is for — "Exit legacy virtualization before renewal and
close the $920K opportunity". It never encodes the selected partner or route, the
motion, the action, the owner, or any other tactical choice. Those are plan state: they
live in `pursuit_plan_revisions`, where changing them is a recommendation and a human
decision with history — never a change of objective.

**What this corrected.** Slice 2A as first built composed the Globex goal as "…close the
$920K opportunity **with WWT**", and cited the route in the goal's basis. So the goal's
meaning depended on a route decision. A WWT → CDW switch would have implied the
commercial objective had changed, when only the way of achieving it had — the hierarchy
GOAL → PLAN → MOTION → ACTION was not semantically true. 0103 had not been applied to any
hosted or shared database, so 0103 itself was amended instead of adding a cleanup
migration.

**How it holds, structurally.**
- `draftGoal` reads only the pursuit thesis and the open opportunity. It has no input
  through which a route, motion, action or owner could enter. Pinned by test: WWT, CDW
  and undecided produce identical goals.
- A plan revision carries no copy of the goal (the old `goalObjective` field is gone).
  The plan *implements* a goal through `pursuit_plans.goal_id`. It does not restate it,
  so plan revisions cannot drift from, or rewrite, what the goal says.
- A route, motion or action change moves the plan's fingerprint, so the approved plan
  becomes reviewable ("Route is now CDW."). The goal row, id and objective are
  untouched, and no review reason may mention the objective.
- Goal confirmation is still tied to a person approving a plan that implements it. It
  is not tied to any particular route or motion.

**Replacement, when the objective genuinely changes.** Minimal and append-only; there is
no goal-revision system:
- The NEW goal row carries `supersedes_goal_id` and `supersession_reason`, set once at
  insert and never updatable.
- The replaced goal keeps its objective, basis and origin byte for byte; only its
  status moves to SUPERSEDED.
- Only a HUMAN_AUTHORED goal with a reason may supersede (CHECK), and a goal can be
  superseded at most once (unique index), so history is a line, never a fork.
- The plan that implemented the old goal is SUPERSEDED with every revision intact, and
  the next recommendation starts a new plan for the new goal.
- Replacement runs only through the governed, USER-only `replace_pursuit_goal` skill,
  and writes `GOAL_REPLACED` to the ledger.
- The old forward pointer (`superseded_by` on the old row) was removed. It would have
  required writing onto the historical row.

**Deliberately not done.** No UI for goal replacement: the semantics exist and are
verified, but no surface complexity was added. The system never replaces a goal itself.
If the opportunity amount later changes, the goal still says what a person confirmed;
proposing a replacement is future work.
