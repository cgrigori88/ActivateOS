# Intelligence Wave — Lifecycle · Value Case · Ask (P2 Design)

**Design and reconciliation only. Nothing in this document is implemented.**

The wave extends the loop from *where to hunt → why now → through whom → who matters → what should
happen → what happened* into **why now with lifecycle precision → what is economically at stake →
what evidence would strengthen the decision → ask the graph directly.**

Doctrine applied throughout: **reuse before extend; extend before invent.** The audit below found
that the canonical fact graph already models far more of P2A and P2B than expected — and that the
Ask surface already exists **twice**, which is the single most important finding in this document.

---

## 0. Repository audit — what actually exists

### 0.1 The fact graph is the answer to most of this wave

`facts` is not a thin table. It already carries, per row:

| Need this wave has | Column already present |
|---|---|
| a date value | `date_value`, `object_type ∈ {DATE, DATETIME}` |
| a **window** rather than a point | `valid_from` / `valid_until` |
| a money value or range | `money_amount`, `money_currency`, `object_type ∈ {MONEY, RANGE, PERCENTAGE, NUMBER}` |
| VERIFIED vs STALE vs CONFLICTING | `status ∈ {CURRENT, DISPUTED, STALE, SUPERSEDED, EXPIRED, REJECTED}` |
| VERIFIED vs CUSTOMER-CONFIRMED vs INFERRED vs ASSUMED | `provenance_class ∈ {FIRST_PARTY, SECOND_PARTY, THIRD_PARTY_VERIFIED, THIRD_PARTY_UNVERIFIED, INFERRED, CUSTOMER_DECLARED, HUMAN_ASSERTED}` |
| decay / staleness | `half_life_days`, `freshness_policy='DECAYING'`, `confidence`, `as_of`, `observed_last_at` |
| independence for convergence | `family` |
| history without destruction | `supersedes` / `superseded_by` |
| citations | `fact_evidence` join table |
| conflicting values | `fact_contradictions` (with `basis`, `status='open'`) |
| human review of a proposal | `fact_candidates` → `fact_reviews` → promotion |
| tenancy | `org_id` + forced RLS (`facts_rw`) |
| demo isolation | `data_environment`, `is_simulated` |

`facts.predicate_key` is a **foreign key** to a `fact_predicates` registry, which itself declares
`object_type`, `default_half_life_days`, `allowed_provenance_classes`, `contradiction_strategy`,
`family`, and — critically — `supports_timing` / `supports_propensity` / `supports_solution_fit`.

**Registered predicates today (14).** Nine already declare `supports_timing = true`:

```
renewal_date            DATE      trigger    timing ✔   contradiction: COMPETING_VALUE
contract_expires        DATE      trigger    timing ✔   contradiction: COMPETING_VALUE
compliance_deadline     DATE      trigger    timing ✔
migrating_from          ENTITY_REF trigger   timing ✔   half-life 270d
platform_evaluation_active ENUM   trigger    timing ✔   half-life 120d
funding_event           MONEY     trigger    timing ✔
acquisition_completed   ENTITY_REF trigger   timing ✔
leadership_change       STRING    trigger    timing ✔
budget_reduction_target PERCENTAGE trigger   timing ✔   half-life 180d
technology_in_use / strategic_initiative / headcount_growth_direction /
is_hiring_for_role_category / partner_relationship_exists      (timing ✘)
```

**`renewal_date` and `contract_expires` already exist as first-class canonical predicates.** P2A is
therefore not a new data model — it is a *reading* of an existing one, plus a handful of additional
registry rows.

### 0.2 Timing is already a canonical scored dimension

`scoring.ts` defines `timing` as one of seven dimensions written by `writeScoreSnapshot` into
`pursuits.current_timing_score`, with per-contribution `evidenceReference` + `referenceKind` +
`featureObservedAt` (as-of leakage prevention). `facts/score-impact.ts` routes any fact whose
predicate has `supportsTiming` into the timing dimension.

`facts/why-now.ts` assembles the structured **WHY NOW** object, which already has a
`timing_anchor` slot populated from `pursuit_facts.relevance_type = 'TIMING_ANCHOR'` on a `CURRENT`
fact, carrying `fact_id`, `predicate`, and `date`.

**Conclusion: no parallel timing score is needed or wanted.** The directive holds — existing timing
semantics can represent lifecycle truth.

### 0.3 Three economic truths already exist (and a fourth would be a mistake)

| Truth | Location | Meaning |
|---|---|---|
| Platform expected value | `pursuits.expected_value_weighted` (+ `expected_value_currency`) | the platform's own weighted value |
| CRM/opportunity amount | `opportunities.amount_usd` | the seller-entered deal size |
| Qualitative economic impact | `opportunity_meddpicc` element `metrics` ("Quantified economic impact the buyer will measure") — status ∈ unknown/gap/weak/strong + notes | a *judgement*, not a number |

There is **no** ROI/BVA/value-case table, no benefit or cost model, and no economic fact instances.
`money_amount` exists on `facts` but no registered predicate uses it except `funding_event`.

### 0.4 The Ask surface exists **twice** — the wave's biggest reconciliation debt

| | Deterministic ⌘K | LLM Ask |
|---|---|---|
| Entry | `/api/palette` (GET) | `/ask` room — **its own item in the left rail** |
| Engine | `classifyIntent` → `parseX` regex → SQL resolver | `askTheRecord` → Anthropic (`claude-haiku-4-5`), ≤6 tool rounds over `MCP_TOOLS` read subset |
| Authenticated principal | ✔ `withTenant` | ✔ `withTenant` |
| RLS | ✔ | ✔ |
| **Ecosystem scope** | ✔ reads `SCOPE_COOKIE`, resolves `companyIds`, passes to every resolver | **✘ takes no scope parameter at all** |
| Disclosure filtering | ✔ resolvers filter server-side (e.g. route reasons exclude `TRANSACTION_CONFIDENTIAL`/`RESTRICTED`/`PII`) | partial — inherits whatever each MCP tool returns |
| Citations | ✔ `Explanation.grounding[]` | prose only; no structured citation |
| Determinism | ✔ | ✘ |

`askTheRecord` is well-built for what it is (read-only tools, writes excluded, "never invent"
system prompt, tenant BYO-key). But **it does not honor the ecosystem scope that every other
surface honors** — a live invariant gap, not a future risk.

Meanwhile the deterministic parser layer is growing by accretion: three bespoke regex parsers
(`parseShowMe`, `parseMotionShowMe`, `parseStakeholderShowMe`) dispatched through a hand-ordered
`if / else if / else` chain inside the palette route, where **precedence is expressed by source
order**. Two more capabilities means five parsers and a five-branch chain in which a lifecycle query
and a value query can silently shadow each other.

### 0.5 Other reusable substrate found

- **Disclosure engine** — `buildExplanation(reasons, audience: "internal" | "shareable")` already
  generalizes or drops lines per audience; `disclosure_class ∈ {PUBLIC, INTERNAL, PARTNER_SHARED,
  TRANSACTION_CONFIDENTIAL, PII, RESTRICTED}`. The Brief's confidential-line mechanism (P1C) sits on
  top of it.
- **Research coverage** — `intel/completeness.ts` scores coverage per category, strictly separated
  from propensity ("missing data is not low intent; a high-propensity / low-completeness account is
  a research target"). Its `timing` category already names providers `sec_edgar`, `installed_base`,
  `renewals`. **This is the existing seed of "what would strengthen this".**
- **Divergence engine** — `context/divergence.ts` emits typed disagreements including a
  `renewal_uncovered` kind.
- **Installed base** — `technology_installations (company_id, node_id, product_id, status ∈
  installed/removed/suspected, evidence_id, observed_at)`. **No version, no lifecycle dates.**
- **Calibration** — `insights/calibration.ts` + `funnel.ts`, and `pursuit_outcomes` / `attribution`
  for the outcome half.
- **AI client** — `ai/client.ts` with two-tier routing, `completeStructured` **schema-validated
  output** (`zodOutputFormat`) and a `ModelRefusalError` path. Free-form text never leaves an agent.

### 0.6 Gaps that are real work

1. **No EOL/EOS/support-lifecycle predicates**, no product version on installed base.
2. **The renewal radar does not read the canonical fact.** `context/divergence.ts` reads
   `population_members.attributes->>'renewal_date'` — an *import JSON blob*. So a renewal date can
   exist in two places with no reconciliation. This must converge on the fact graph.
3. **No horizon read-model** — nothing answers "what changes in the next 90 days" across a portfolio.
4. **The demo world has one fact** (`strategic_initiative`). Every P2A/P2B demo and acceptance test
   needs seeded lifecycle and economic facts through the promotion path.
5. **MEDDPICC `economic_buyer` / `champion` now duplicate P1C stakeholder assertions.** Two places
   claim the same truth with different vocabularies and different governance. P2B touches MEDDPICC's
   neighbourhood and must reconcile rather than deepen this.

---

## 1. P2A — Renewal / Lifecycle Intelligence

**Framing: an extension of WHY NOW, not a contract-management product.** PursuitOS does not become
a system of record for contracts; it reasons about lifecycle *evidence* it already models.

### Current substrate → what already works
Canonical `renewal_date` / `contract_expires` / `compliance_deadline` predicates with
`supports_timing`; `date_value` + `valid_from`/`valid_until`; `status` and `provenance_class`;
`fact_contradictions` for competing dates; `half_life_days` decay; the WHY NOW `timing_anchor`;
the `timing` scoring dimension with evidence lineage; `fact_candidates` → `fact_reviews` promotion
for human confirmation.

### What is missing
- Lifecycle predicates beyond contract dates: `end_of_life_date`, `end_of_support_date`,
  `support_lifecycle_phase`, `installed_version`, `subscription_term_end`, `migration_deadline`.
- A **date-state read model** that renders the five required states honestly.
- A **horizon read model** ("what changes in the next N days") over the scoped portfolio.
- Convergence of the import-attribute renewal radar onto the fact graph.

### Authoritative source of truth
`facts` filtered to lifecycle predicates, joined to `fact_evidence` for citation and
`fact_contradictions` for conflict. Nothing else. `population_members.attributes.renewal_date`
becomes an **ingestion input** that promotes into a fact (provenance `THIRD_PARTY_UNVERIFIED` or
`SECOND_PARTY` for partner-supplied lists), never a display source.

### The five date states — derived, not stored

| State | Derivation (all from existing columns) |
|---|---|
| **VERIFIED DATE** | `status='CURRENT'` ∧ `provenance_class ∈ {FIRST_PARTY, CUSTOMER_DECLARED, THIRD_PARTY_VERIFIED, HUMAN_ASSERTED}` ∧ `date_value` present ∧ not past half-life |
| **INFERRED WINDOW** | `date_value` null but `valid_from`/`valid_until` present, **or** `provenance_class='INFERRED'`. Renders as a *range*, never a day. |
| **STALE DATE** | `status='STALE'`, or age beyond `half_life_days` under `freshness_policy='DECAYING'` |
| **CONFLICTING DATE** | an open row in `fact_contradictions` touching this fact, or ≥2 `CURRENT` facts of the same predicate+subject with different `date_value` |
| **UNKNOWN** | no lifecycle fact at all — the default, and always a legitimate answer |

**The false-precision rule:** a third-party or inferred lifecycle signal may only ever produce an
**INFERRED WINDOW**. Promotion to VERIFIED DATE requires a first-party/customer-declared source or a
governed human confirmation. This is enforced at the predicate registry via
`allowed_provenance_classes`, not by convention.

### Read-model changes (no new score)
New `src/lib/lifecycle/` (pure reads):
- `getAccountLifecycle(db, orgId, companyId)` → typed lifecycle events with state, date-or-window,
  citations, contradiction refs.
- `getLifecycleHorizon(db, orgId, {days, companyIds})` → **the signature interaction.** Material
  lifecycle-triggered Pursuits entering a decision window, ordered by materiality (exposure × state
  confidence), *not* chronology. Returns `UNKNOWN`-state accounts separately, never padded in.
- `lifecycleConstraint(view)` → reuses the **existing** `ConstraintView` (P1AB) so a lifecycle gap
  speaks the same language as every other constraint. No new stored blocker.
- Extend `getPursuitWhyNow`'s `timing_anchor` rendering to carry state + window, rather than
  implying a point date.

### Write / governance requirements
Two governed skills through `dispatchSkill` (there is no new mutation authority):
- `confirm_lifecycle_date` — promote an inferred window / third-party date to a verified date with
  evidence. Human-only (an agent may propose, mirroring P1C).
- `dispute_lifecycle_date` — open a `fact_contradictions` row rather than overwrite.
Both append to `change_ledger` (a new `LIFECYCLE_DATE_CONFIRMED` change type). No date is ever
edited in place; supersession is the mechanism.

### Schema requirements — small and additive
- **Rows, not tables:** ~6 new `fact_predicates` rows (EOL, EOS, support phase, subscription term
  end, migration deadline, installed version) with `supports_timing`, half-lives, and
  `allowed_provenance_classes` that make the false-precision rule structural.
- **One optional column:** `technology_installations.version text` — only if the installed-base
  provider actually supplies it; otherwise defer.
- One `change_ledger` change-type value.
- **No new table.**

### Disclosure
Lifecycle dates are commercially sensitive. Default `INTERNAL`. A partner projection may show
*"renewal window in Q3"* (generalized) where the internal view shows the date — reusing
`buildExplanation`'s existing internal/shareable split. Customer-facing: out of scope this wave.

### UNKNOWN semantics
UNKNOWN is the default and is displayed as such. A pursuit with no lifecycle fact keeps
`current_timing_score = NULL` and its existing `TIMING_UNKNOWN` motion constraint. **Lifecycle never
manufactures a timing score.**

### UX placement (no new room)
- **Accounts** — WHY NOW gains a lifecycle line with its state chip; a `renewal in 87 days
  (verified)` or `EOL window H2 2026 (inferred)` beside the existing evidence.
- **Pursuit Detail** — the Why Now panel's timing anchor renders state + window + citation; a
  conflicting date shows both values and the governed *dispute/confirm* action.
- **Today** — material windows only, above a value floor, exactly like the P1C stakeholder gap.
- **Motions** — lifecycle joins the **informational overlay** tier built in P1C
  (`INFORMATIONAL — NEVER GATES`); it does *not* become a funnel gate.
- **Pipeline** — a filter + drawer line. No dashboard.
- **Brief** — Why Now gains the window and its state; *what not to claim* gains
  "the renewal date is inferred, not confirmed".
- **⌘K** — "Which Pursuits renew in the next 90 days?"

### Default-visible vs progressive disclosure
Default: one line per pursuit — *state · window · exposure*. Expanded: the competing values, each
source with its provenance, the age against half-life, and the governed confirm/dispute action.

### Signature wow interaction
> **"What changes in the next 90 days?"**
> → 6 Pursuits entering a decision window · $4.1M exposure
> → 2 verified dates · 3 inferred windows · **1 conflicting** (two sources disagree by 4 months)
> → 11 accounts UNKNOWN — *lifecycle evidence not gathered*

The UNKNOWN line is the honesty proof: the answer states its own blind spot.

### Demo story
Seed through the promotion path (never direct insert): Globex a **verified** renewal (customer-
declared) 87 days out; Umbrella an **inferred window** from a third-party source; Stark a
**conflicting** date (two sources 4 months apart, an open contradiction); Hooli a **stale** date past
its half-life; Cyberdyne **UNKNOWN**. Nothing uniformly complete.

### Scale behavior
Horizon query is a single indexed scan (`facts_expiry` on `valid_until`, `facts_asof` on
`(org_id, company_id, as_of)`). Materiality-ordered with a cap and an honest remainder line — the
P1AB pattern. Never a calendar grid.

### Tests
Five-state derivation · false-precision (third-party cannot become VERIFIED) · contradiction
surfaces both values and picks neither · staleness from half-life · UNKNOWN stays UNKNOWN and does
not fabricate a timing score · horizon respects scope narrowing · lifecycle never gates the funnel ·
partner projection generalizes the date · confirm/dispute are governed and append-only · the import
attribute no longer renders as an independent truth.

### Risks
1. **False precision** — the central risk; mitigated structurally via `allowed_provenance_classes`.
2. **Renewal-radar double truth** — must be converged in the same slice, or the product shows two
   renewal dates.
3. **Demo emptiness** — the fact graph is nearly empty; seeding is real work, not a footnote.

---

## 2. P2B — Business Value / Value Case

**Not an ROI calculator.** A Value Case belongs to the Pursuit and is a *defensibility* statement
before it is a number.

### Current substrate → what already works
`facts` can hold MONEY / RANGE / PERCENTAGE / NUMBER with currency and evidence; `provenance_class`
maps **exactly** onto the required ladder; `fact_evidence` gives citations; the disclosure engine
gives audience projections; `expected_value_weighted` and `opportunities.amount_usd` give two
existing value anchors; MEDDPICC `metrics` gives the qualitative judgement; `completeness.ts` gives
the information-gap seed.

### Required distinction → direct mapping (no new vocabulary)

| Required | `facts.provenance_class` |
|---|---|
| VERIFIED | `THIRD_PARTY_VERIFIED` / `FIRST_PARTY` |
| CUSTOMER-CONFIRMED | `CUSTOMER_DECLARED` |
| INFERRED | `INFERRED` |
| ASSUMED | `HUMAN_ASSERTED` |
| UNKNOWN | no fact present |

### What is missing
- Economic predicates: `annual_infrastructure_operating_cost`, `licenses_in_use`,
  `incident_cost_per_year`, `fte_hours_on_task`, `downtime_cost_per_hour`, and a small set of
  category-specific drivers.
- A **value composition** — which drivers constitute the case for a given solution category, and the
  arithmetic that turns them into a **range**.
- A **defensibility** read model and an **information-value** ranking ("what would most improve it").

### Authoritative source of truth
The Pursuit's **computed Value Case read model**, derived from economic facts on the account +
the solution category's composition. It is **not** a new stored number and does not replace
`expected_value_weighted` (platform value) or `amount_usd` (CRM value). The Value Case answers a
different question — *what is economically at stake for the customer* — and the three must be shown
as three truths, exactly as P1B did for partner presence-vs-activation.

### Does this need a new table? — **No, for v1**

| Candidate | Verdict |
|---|---|
| Value inputs | **Reuse `facts`** — MONEY/NUMBER predicates carry value, provenance, citation, staleness, contradiction and RLS already |
| Value composition (drivers + arithmetic per category) | **Code-level definition** in v1, keyed by `taxonomy_node`. It is model configuration, not tenant data. Promote to a table only when tenants must author their own |
| The computed case | **Read model** — recomputed from facts, never stored |
| Human assumptions | `facts` with `provenance_class='HUMAN_ASSERTED'` via a governed skill |

**Recommendation: no new primitive.** If a later slice needs tenant-authored compositions, that is a
deliberate follow-on with its own review.

### Write / governance
One governed skill: `assert_value_input` (mirrors P1C's `assert_stakeholder_role` exactly) —
records a driver value with provenance and evidence; agents may propose `INFERRED`, only a human may
assert `CUSTOMER_DECLARED`; supersession preserves history in `change_ledger`. **A value input may
never be created by a UI write path.**

### The defensibility model — and its honesty limit
Defensibility is reported as a **band** (`weak` / `moderate` / `strong`) derived from: share of
drivers present, their provenance ladder, their staleness, and whether any driver is contradicted.

> **Explicit constraint the user set, honored:** the "if obtained, uncertainty materially decreases"
> line must **not** claim a quantified confidence improvement. v1 states *which missing driver has
> the largest effect on the output range* — which is computable exactly (recompute the range with
> the driver at its plausible bounds and compare width). That is a **range-width sensitivity**, an
> arithmetic fact, not a probability claim. Any language implying calibrated confidence gain is
> forbidden until outcome calibration supports it.

### Signature wow interaction
> **"What would strengthen this value case?"**
> Current value case **$1.2M – $1.6M** potential impact · defensibility **moderate**
> Known: licenses in use *(customer-confirmed)* · incident volume *(verified)*
> Assumed: blended FTE rate *(assumed)*
> **Biggest missing input: verified annual infrastructure operating cost**
> — it is the widest term in the range; supplying it narrows the range from **$400k to ~$150k**
> Missing everything else: UNKNOWN — the case cannot be stated more precisely than this.

### Three projections (reusing the disclosure engine)
- **Internal** — full drivers, provenance, range, sensitivity.
- **Partner-shareable** — generalized: band and directional magnitude, no confidential figures.
  Reuses the P1C rule that a confidential figure is *absent* from the payload, not hidden client-side.
- **Customer-ready** — **RECOMMEND DEFERRING.** It is adjacent to external sending (do-not-touch),
  and a customer-facing economic claim needs a claims/legal review this wave has no mandate for.
  Design the projection boundary now; ship internal + partner only.

### UNKNOWN semantics
If the composition cannot be computed defensibly, the product says so: *"A defensible value case
cannot be stated — 3 of 5 drivers are unknown."* **No number is displayed.** A range is never
narrowed by inventing a driver.

### UX placement
Pursuit Detail (a Value Case panel beside Stakeholders) · Accounts (value-case status line) ·
Brief (*what is economically at stake* + *what not to claim* for assumed drivers) · Pipeline
(filter/drawer only) · Today (only when a value gap blocks a material decision) · Insights
(deferred — no reporting expansion this wave).

### Demo story
Globex: 3 of 5 drivers known (one customer-confirmed, one verified, one assumed) → a stated range
with moderate defensibility and a named biggest-missing driver. Umbrella: 1 of 5 → **no number**,
explicitly. Stark: 0 → UNKNOWN. Never a complete case.

### Tests
Provenance ladder preserved · no number when indefensible · range never narrows without a driver ·
sensitivity is arithmetic (recomputable), not a confidence claim · partner payload omits confidential
figures server-side · governed assertion only · Value Case never overwrites expected value or
opportunity amount · three truths render as three · UNKNOWN stays UNKNOWN.

### Risks
1. **Fabricated economics** — the existential risk; mitigated by refusing to print a number.
2. **A fourth economic truth** — mitigated by rendering it explicitly alongside the other two.
3. **MEDDPICC overlap** — `metrics` becomes the qualitative sibling of the Value Case, and
   `economic_buyer`/`champion` already duplicate P1C. Reconcile in this slice: MEDDPICC elements
   should *read* the canonical assertion rather than hold a parallel judgement.

---

## 3. P2C — Ask / Natural-Language Intelligence

**The job is reconciliation, not a new capability.** Two ask paths exist; this phase makes them one
governed layer.

### Target architecture — one resolver, three tiers

```
question
  │
  ├─ Tier 1  INTENT REGISTRY (deterministic)        ← the authority
  │     declared intents: slots, resolver, precedence, example utterances
  │     matched by declarative slot patterns, not an if/else chain
  │
  ├─ Tier 2  LLM SLOT-FILLER (optional, only if Tier 1 misses)
  │     translates the utterance into a registered intent + typed slots
  │     via completeStructured (schema-validated) — it CANNOT answer
  │
  └─ Tier 3  UNSUPPORTED / UNKNOWN
        an honest refusal, never free-form invention
```

**The canonical resolver always answers.** The LLM's only permitted output is
`{ intentKey, slots }` validated against the registry's schema — it never produces prose that
reaches the user as an answer, never sees raw tables, and never invents a record. Every answer is
produced by the same deterministic resolver whether the slots came from a regex or a model.

### Concretely
- **New:** `src/lib/search/registry.ts` — an intent registry replacing the palette route's
  hand-ordered `if/else`. Each entry declares `key`, `slots` (zod), `precedence`, `resolver`,
  `examples`. Registering P2A/P2B intents becomes a data change, not another branch.
- **Refactor (no behavior change):** the three existing parsers become three registry entries.
- **Fix:** `askTheRecord` gains the ecosystem scope it is missing today, and its answers carry
  structured citations like `Explanation.grounding`.
- **Merge:** the `/ask` room becomes a *rendering* of the same resolver — not a second engine. Keep
  the room (users know it); remove the second brain behind it.

### Which queries stay deterministic vs need interpretation

| Deterministic today or trivially (Tier 1) | Needs Tier 2 translation |
|---|---|
| Which Pursuits renew in the next 90 days? | What changed since Friday? *(relative time + change classification)* |
| Which WWT Pursuits lack an economic buyer? *(already P1C)* | Which accounts have strong value but weak route coverage? *(two-model join phrased freely)* |
| Show high-value opportunities with weak timing evidence | Where are CRM stage and observed engagement inconsistent? *(exists as divergence; needs mapping)* |
| Where does CDW have presence but poor activation? *(P1B)* | What would strengthen the Value Case for Umbrella? *(entity + capability routing)* |
| Why is Globex not execution-ready? *(P1A)* | |
| Which Motion has the most constrained revenue? *(P1AB aggregate)* | |

Most named questions are already **within reach of Tier 1** given P2A/P2B read models. That argues
for building the registry first and the LLM tier last — possibly not at all this wave.

### Governance inheritance (non-negotiable)
Every answer, whichever tier filled the slots, inherits: authenticated principal · ecosystem scope ·
RLS · **server-side** disclosure filtering · canonical read models · evidence/provenance · UNKNOWN
semantics · recommendation-vs-decision · attribution semantics. Disclosure happens **before**
generation: the LLM is handed only what the caller may already see.

### Failure mode
`Unsupported` (the shape isn't registered) or `UNKNOWN` (registered, but the record has no answer) —
never invention. Both already exist in the palette's `note` channel.

### Tests
Registry precedence is declared and deterministic (no source-order dependence) · every intent
honors scope narrowing · LLM slot-filling cannot emit an unregistered intent · a schema-invalid
model output degrades to `Unsupported` · `/ask` answers equal ⌘K answers for the same question ·
scope gap closed · citations present on every answer · no write tool is reachable.

### Risks
1. **A second brain persists** — the whole point; merging is the deliverable.
2. **Registry designed too early** — mitigated by refactoring *existing* intents first (behavior-
   preserving) and only then adding P2A/P2B entries.
3. **LLM cost/latency on a keystroke path** — Tier 2 must be opt-in per-invocation, never on the ⌘K
   typing path.

---

## 4. Cross-capability reinforcement

The three compose into one chain of **information value** — the wave's real thesis:

```
lifecycle: renewal in 87 days (VERIFIED, customer-declared)
   ↓ strengthens WHY NOW — timing anchor with state, not a guess
value case: $1.2M–$1.6M at stake, defensibility moderate
   ↓ widest term: annual infrastructure operating cost (UNKNOWN)
stakeholder (P1C): economic buyer unverified
   ↓
Ask: "What should I learn next?"
   → Verify the annual infrastructure operating cost (narrows the range ~$250k)
   → Verify the economic buyer (no verified buying authority on a dated window)
```

Each capability contributes a *gap*, and the system ranks gaps by **what they would change** — not
another recommendation list. The shared `ConstraintView` language (P1AB) already carries all three.

---

## 5. Sequencing recommendation — I am challenging the order

The directional order was **P2A → P2B → P2C**. The dependency analysis supports P2A first and P2B
second, but shows a **small enabling slice of P2C belongs first**:

### Recommended: **P2C-0 → P2A → P2B → P2C-1**

**P2C-0 — Resolver consolidation (small, ~15% of a window).** No new capability.
- Intent registry replacing the `if/else` chain; the three existing parsers migrate unchanged.
- **Fix `askTheRecord`'s missing ecosystem scope** — a live invariant gap today, independent of this wave.
- Structured citations on ask answers.

*Why first:* P2A and P2B each add query intents. Adding them to the current accretion produces five
bespoke parsers and a five-branch precedence chain where lifecycle and value queries can shadow each
other. Refactoring *before* is cheap and behavior-preserving; refactoring *after* means migrating
five intents instead of three. And the scope gap should not survive another wave regardless.

**P2A — Lifecycle** (the bulk of a window). Predicate rows, the five-state read model, the horizon
interaction, WHY NOW/Today/Motion-overlay/Brief/⌘K integration, renewal-radar convergence, demo fact
seeding, tests.

**P2B — Value Case** (its own full window). Economic predicates, composition, defensibility,
sensitivity, governed `assert_value_input`, internal + partner projections, MEDDPICC reconciliation.

**P2C-1 — LLM slot-filling tier** (optional, last). Only if Tier 1 leaves genuinely valuable
questions unreachable. On current evidence, most target questions are Tier-1 reachable once P2A/P2B
ship — **so this may be deferrable indefinitely**, which is the better outcome.

### What realistically fits in one bounded window
**P2C-0 + P2A.** That is one coherent window with a real wow ("what changes in the next 90 days?")
and a resolver that is ready for what follows.

**P2B does not fit in the same window as P2A** and should not be compressed into one: it carries the
three-economic-truths reconciliation, a governed assertion path, two disclosure projections, the
sensitivity model, and MEDDPICC reconciliation. Attempting both produces a shallow value case — the
one feature where shallowness is dangerous, because a fabricated number is worse than no number.

### Explicit deferral / narrowing recommendations
1. **Defer the customer-ready Value Case projection** out of this wave (adjacent to external
   sending; needs a claims review). Design the boundary, ship internal + partner.
2. **Defer P2C-1 (LLM tier)** until Tier 1 is proven insufficient. Ship P2C-0 only.
3. **Narrow P2A's installed-base lifecycle** (EOL/EOS by product version) to predicates + read model
   only; do not add a version column unless a provider actually supplies versions.
4. **Do not expand Insights** this wave (explicitly out of scope) — calibration of lifecycle and
   value accuracy is a later, outcome-driven slice.

### Hard dependencies
- P2B's "biggest missing input" reuses P2A's fact-state ladder → **P2A before P2B**.
- Both add ⌘K intents → **P2C-0 before both** (soft but strongly advised).
- Neither depends on P2C-1.
- P2B touches MEDDPICC, which already duplicates P1C stakeholder truth → that reconciliation must be
  in P2B's scope, not deferred again.

---

## 6. Invariants preserved (design-level commitments)

Canonical single truth · governed mutation only via `dispatchSkill` · append-only history ·
server-side disclosure · RLS + ecosystem scope on every read · **UNKNOWN is valid and displayed** ·
recommendation ≠ decision · outcome/attribution semantics untouched · progressive disclosure ·
materiality before chronology · no card walls · no new room · no nav redesign · no generic CRM or
copilot UI · no vanity analytics · demo `outcome_learning` posture unchanged.

**Not touched:** external send · broad Pursuit creation · CRM migration · MDF · executive reporting ·
fit-v2 · relationship consolidation · production commissioning · stakeholder role vocabulary.

**HALTED FOR REVIEW — no implementation performed.**
