# P7 — Pursuit Experience & Analysis: architecture contract

**Status:** DESIGN / CONTRACT ONLY. No implementation is authorized by this document.
**Date:** 2026-09-17 · **Written against:** schema 112, P6-IG HOSTED ACCEPTED / CLOSED (`b5710b0`), P6→P7 transition hardening (`aec7e6e`).

This contract exists so that a later implementation can be judged **without relying on anyone's
intent**. Every rule below is written to be checkable against code: a named module boundary, a
registry lookup that must fail closed, an object that must cross a boundary, or a test that must
exist. Where a rule cannot be made mechanically checkable, it is marked **[JUDGEMENT]** and listed in
§16 for ruling.

The governing sentence: **P7 owns presentation, query composition and explanation. It owns no truth.**

---

## 1. Purpose and non-goals

### 1.1 What P7 owns

- The **interaction grammar** — GO TO, SHOW ME, EXPLAIN, ANALYZE (§2).
- The **canonical query model** — turning a request into a declarative, validated plan (§3).
- The **semantic metric registry** — named, versioned, deterministic definitions (§4).
- The **cohort/query engine** — comparison sets, filters, aggregations (§5).
- **Dynamic Pursuit Surfaces** — governed projections, reusable and pinnable (§6).
- The **headless capability layer** all interfaces call (§10).
- **Presentation state and query definitions** — the only things P7 may persist (§11).

### 1.2 What P7 does not own, and who does

| Concern | Owner | P7's only permitted relationship |
|---|---|---|
| Pertinence ranking, weights, standings, Why-here differentials | **P2** (`read-models/portfolio-pertinence.ts`) | display, query, explain — **never recompute, never an alternate formula** |
| Pursuit identity, lifecycle, canonical facts, evidence, snapshots | **P4 / canonical domain** | read through canonical read-models |
| Consequential action, runs, steps, approvals, capability grants | **P5** (`lib/runtime/runtime.ts`, `federation/skills.ts` `dispatchSkill`) | **propose and invoke**; never execute, never write |
| Tenancy, participation, grants, derivation authority, disclosure | **P6** (`federation/derivation.ts`, `federation/disclosure.ts`, `federation/grants.ts`, RLS) | **submit to**; never re-decide, never cache a decision |
| Authentication and the application principal | the gate (`src/proxy.ts`) | consume; never infer |

### 1.3 Non-goals (explicit)

P7 does **not** introduce: a local data model; local permissions; local disclosure policy; local
metrics; local authority; local state mutation; local write behaviour; any path around P5; any path
around P6. P7 does not introduce a probability score, win-likelihood, health score, or any ranking
that competes with P2. P7 does not add cross-organization ranking (§5.5).

**A generated interface is not a product surface with its own rules. It is a rendering of governed
canonical results.**

---

## 2. Interaction grammar

Four operations. Each is defined by what it may **read**, **derive**, **render** and **trigger**.

| Operation | Reads | Derives | Renders | Triggers |
|---|---|---|---|---|
| **GO TO** | canonical object identity + the caller's authorized set | nothing | a location (route/surface reference) | nothing |
| **SHOW ME** | canonical fields + registered metrics, post-governance | registered metrics only | a governed projection | nothing |
| **EXPLAIN** | the *already-governed result* of a prior SHOW ME / ANALYZE + its provenance | nothing new | prose over disclosed evidence | nothing |
| **ANALYZE** | canonical facts + registered metrics across a **cohort** | registered metrics and declared operators over them | tables, comparisons, distributions | nothing |

**None of the four may trigger a consequential action.** An action is a separate, explicit object
(§9). A surface may *offer* an action; offering is presentation, invoking is P5.

### 2.1 Category change: when a request stops being P7

A request changes category the moment its effect outlives the response. The test is mechanical:

> **If satisfying the request requires any write to canonical business state, or any external
> effect, it is no longer GO TO / SHOW ME / EXPLAIN / ANALYZE. It is an action and must enter P5.**

Worked boundaries:

- *"Analyze which pursuits are stalling"* → ANALYZE. Read-only.
- *"…and flag them for review"* → the flag is canonical state → **P5** via an `ActionProposal`.
- *"Explain why this ranks first"* → EXPLAIN over P2 outputs. Read-only.
- *"Pin this view"* → persists a **surface definition**, not business truth → P7-owned persistence
  (§11), still not P5, because nothing canonical changes.
- *"Analyze and then notify the partner"* → the analysis is P7; the notification is P5 **and** is
  subject to P6 onward-sharing rules on whatever it would carry.

**Ambiguity fails closed.** A request that could be read as either is treated as an action proposal
requiring explicit confirmation — never silently executed as analysis, never silently executed as an
action.

---

## 3. Canonical query model

### 3.1 The pipeline, and the direction of authority

```
natural language  →  PursuitQuery (plan)  →  governance resolution  →  computation  →  presentation
   [LLM allowed]        [deterministic]        [deterministic, P6]     [deterministic]   [LLM allowed]
                              ▲                                                              │
                              └────────── the plan is the source of truth ────────────────────┘
                                          (the rendered UI never is)
```

**The generated UI is never the source of truth.** A surface is re-derived from its plan on every
read. Nothing is trusted because it appears on screen, and no value returns from the client to be
treated as fact.

### 3.2 `PursuitQuery` — the canonical representation (answers **A**)

A `PursuitQuery` is a **versioned, serializable, declarative JSON plan**. It is the only thing that
executes. It contains no SQL, no table names, no column names, no free text that reaches a database.

```
PursuitQuery v1 {
  queryVersion: 1
  subject:     { class: ObjectClass, ids?: CanonicalId[] }   // closed enum of canonical classes
  scope:       Scope                                          // the EXISTING scope model (lib/scope)
  filters:     Filter[]                                       // closed enum of dimensions + operators
  metrics:     MetricRef[]                                    // { id, version } from the registry ONLY
  cohort?:     CohortSpec                                     // §5
  projection:  FieldRef[]                                     // closed enum of canonical fields
  ordering?:   OrderRef[]                                     // registered metrics or canonical keys
  limit?:      number
  asOf:        null                                           // null = transaction time (§7.4)
  explain?:    boolean
}
```

**Every identifier in a plan must resolve in a registry.** Object classes, fields, filter dimensions,
operators, metrics and actions each come from a closed, code-defined vocabulary. An unresolved
identifier is a **hard failure**, never a guess and never a pass-through. This mirrors the accepted
P6 rule that an unmapped input to `mayDerive` denies rather than falling through to a catch-all.

### 3.3 Where natural language stops (answers **B**)

Natural language may produce **only** a candidate `PursuitQuery`, and it is untrusted until validated:

1. **Parse** — an LLM proposes a plan (or a deterministic parser does, for known phrasings).
2. **Validate** — deterministic. Every identifier must exist in a registry; the plan must type-check;
   unknown, ambiguous or extra fields are rejected. *A plan that does not validate is never executed
   and is never "best-effort" repaired into something adjacent.*
3. **Govern** — §7. The validated plan is resolved against P6 for this principal.
4. **Compute** — deterministic execution of registered metrics and canonical loaders.
5. **Present** — rendering; an LLM may write prose *over the governed result only*.

After step 1, **no model output influences what is fetched, what is permitted, or what is computed.**
A model may not widen `scope`, add an object class, relax a filter, or reach a field that validation
did not admit. Scope may only be **narrowed** by a plan relative to the caller's authorized set;
widening is meaningless because the authorized set is resolved in step 3, not declared in step 1.

---

## 4. Semantic metric contract

### 4.1 Three categories, never conflated

| Category | Defined by | Computed by | May be labelled a metric? | Provenance shown |
|---|---|---|---|---|
| **Canonical metric** | code, in the registry, versioned | deterministic function over canonical inputs | **yes** | definition id + version + inputs |
| **Derived analysis** | a plan composing canonical metrics with declared operators | deterministic | as a *derived result*, named by its composition | the composition + its operands |
| **Presentation-only calculation** | formatting (percent, rounding, sort order, bucket labels) | rendering layer | **no** | none — it must never look canonical |

A number that is none of these may not be displayed at all.

### 4.2 How a metric becomes canonical (answers **D**)

A metric is canonical **iff** it exists in the code-defined registry with all of:

```
MetricDefinition {
  id:          "p2.pertinence" | "pipeline.open_value" | …   // stable, namespaced
  version:     integer                                        // immutable once shipped
  inputs:      CanonicalInputRef[]                            // declared canonical sources
  informationClasses: InformationClass[]                      // the P6 classes the inputs belong to
  compute:     (governedInputs) => value                      // deterministic, no I/O of its own
  determinism: "DETERMINISTIC"                                // §12; no other value exists today
  provenance:  { owner, definitionText, introducedIn }        // human-readable canonical definition
  disclosure:  how the result is classified for §7
}
```

Registration is a **code change**, reviewed, versioned and tested — not a runtime insert, not a user
action, and not something a model can do. **No generated surface or LLM may invent a metric formula
ad hoc and present it as canonical.** A plan referencing `{id, version}` that is not in the registry
fails validation (§3.3 step 2).

Changing a formula requires a **new version**. Pinned surfaces referencing v1 keep computing v1 until
their definition is explicitly migrated, so a metric change cannot silently rewrite history a person
already saw. **[JUDGEMENT]** whether old versions are retained indefinitely or deprecated on a stated
policy — §16.

### 4.3 How P2 pertinence enters without being reimplemented

P2 is registered as a canonical metric family whose `compute` **delegates to the existing P2
modules** (`read-models/portfolio-pertinence.ts` and its loaders). P7 holds:

- no weights (`PORTFOLIO_SIGNAL_WEIGHT` stays in P2),
- no basis policy (`BASIS_EVIDENCE_WEIGHT`, `NEUTRAL_STANDING`, momentum half-life stay in P2),
- no tie-break rules (Today's ordering stays in P2/read-models),
- no alternate pertinence, probability or shadow ranking — **prohibited outright**.

P7 may: display a standing or Δ, order a cohort by the P2 metric, explain a P2 Why-here string, and
show `#N of M` **exactly as P2 computed it**. If P7 needs a pertinence-shaped number P2 does not
expose, the answer is a P2 change, not a P7 metric. A P7 metric whose definition text restates a P2
concept is a contract violation even if the arithmetic differs.

### 4.4 Proving a surface invented nothing (answers **E**)

Four mechanisms, each checkable without reading intent:

1. **Validation is the only door.** A plan executes only if every metric resolves to a registered
   `{id, version}`; an unregistered reference fails before governance, so an invented metric cannot
   reach computation. Test: submit a plan naming `made.up.metric@1` → rejected.
2. **Every displayed number carries provenance.** A rendered metric value is accompanied by its
   definition id and version, sourced from the registry entry that computed it. A number without that
   lineage cannot be produced by the presentation layer, because the layer receives values only inside
   a `GovernedResultSet` cell, and a cell has a provenance field.
3. **Permissions are never values a surface holds.** A surface carries no permission, eligibility or
   disclosure decision; §7 resolves each per read. There is therefore no field in which an invented
   permission could live. Test: assert no `PinnedSurface` or `GovernedResultSet` schema admits a
   permission, role or grant.
4. **Source guards.** A P7 module may not import a writer, a raw `unsafe_` reader, or define an
   arithmetic metric outside the registry module — the same structural-guard technique already used
   to prove the approval closure imports no cross-org content module.

Together these make the question mechanical: *if a number is on screen, name its registry entry; if a
capability is offered, name the P5/P6 call that reported it eligible.* Anything that cannot answer is
a defect.

---

## 5. Cohort / query engine

### 5.1 Allowed dimensions

Filters and cohort dimensions come from a closed registry, each mapped to a canonical field and an
information class: organization-owned pursuit attributes (stage, status, class, lifecycle dates),
account/company attributes, participation facts, scope membership (the existing `Scope` kinds:
`ALL | PARTNER | VENDOR | TERRITORY | SELLER | PERSONAL`), and registered metric values.

Free-text search over canonical text fields is a **dimension like any other** — it narrows within the
authorized set and can never reach a row the principal could not already read.

### 5.2 Operators

Comparison (`=`, `≠`, `<`, `≤`, `>`, `≥`, `in`), set membership, presence/absence, and aggregation
(`count`, `sum`, `avg`, `min`, `max`, `percentile`) — each declared per dimension. Aggregations are
permitted only over fields whose information class the principal may derive (§7).

### 5.3 Scope narrowing changes the comparison set, never the facts

Narrowing a scope changes **which rows are in the cohort**. It must not change any canonical value of
a row that remains. This is the accepted P2 behaviour (narrowing recomputes the cohort while absolute
canonical magnitudes stay identical) and P7 inherits it verbatim: *the comparison set is a P7 concern;
the facts are canonical.* A cohort computation that mutates, re-derives or re-weights a canonical fact
is a violation.

### 5.4 Disclosure filtering happens **before** comparison

For cross-object and cross-organization-adjacent comparisons, each candidate row is resolved through
P6 **first**; only rows and fields that survive enter the cohort. Consequences that must hold:

- a row the principal may not see **cannot influence** a rank, percentile, average or count;
- a suppressed value cannot be inferred from an aggregate (§5.6);
- "N of M" counts describe the **authorized** set, and the surface must say so.

### 5.5 No cross-organization ranking

P6's restriction stands unchanged. P7 may query several surfaces and may show one organization's data
beside another's **where a live grant already authorizes that disclosure**, but it may not construct a
ranking, league table, percentile or comparative standing **across organizations**. Ability to query
is not authority to compare. Cross-org aggregate reporting is out of scope for P7 and would require
its own governance ruling.

### 5.6 Counting and differencing

The existing floor applies: `CROSS_ORG_COUNT_FLOOR = 5`, counts below it are suppressed, and a count
that varies with recipient-specific filtering is suppressed (the accepted differencing control). P7
adds no new aggregate that could reconstruct a suppressed value by subtraction; any new aggregate must
be shown safe under the same differencing control before it ships.

---

## 6. Dynamic Pursuit Surface contract

### 6.1 Definition

> A **Dynamic Pursuit Surface** is a named, governed **projection**: a `PursuitQuery` plus a
> presentation configuration. It is re-executed and re-governed on every read. It is not an
> application, not a data model, and not a record of anything.

### 6.2 A surface may contain

canonical fields (by registered `FieldRef`); canonical object references (ids that resolve to real
objects); registered semantic metrics (`{id, version}`); governed analytical results (computed from
the above); and **offers** of registered governed actions (§9).

### 6.3 A surface may not

persist any canonical fact as independent truth; hold a value that is not re-derivable from its plan;
carry a computed permission, a disclosure decision, or a cached governance verdict; embed SQL, table
or column names; define a metric; or hold state that other surfaces read as authoritative.

### 6.4 Reuse and pinning (answers **C**)

Pinning persists **the definition only**:

```
PinnedSurface {
  id, ownerPrincipal, orgId
  name                          // human label (may be LLM-suggested, human-editable)
  query: PursuitQuery           // the plan, with metric {id, version} pins
  presentation: PresentationConfig   // layout, columns, chart type, grouping, sort
  createdAt, updatedAt
}
```

**Not persisted:** result rows, computed metric values, counts, rankings, explanation prose, or any
disclosure decision. A pinned surface is a **saved question, never a saved answer.**

This is what makes revocation work (answers **I**): because nothing is stored but the question, the
next read re-resolves participation, grants, `mayDerive` and disclosure at that moment. After a grant
is revoked, a participant window closes, or a pursuit becomes terminal, the same pinned surface simply
returns less — or refuses — with no special revocation logic and no cache to invalidate. **A pinned
surface can never be used to preserve access after P6 revocation**, because it never held the data.

If a pinned surface's plan becomes invalid (a metric version retired, an object deleted, a field
withdrawn), it fails visibly with a stated reason. It must not silently fall back to a similar plan.

---

## 7. Governance resolution

### 7.1 Where P6 executes — exactly (answers **F**)

Between validation and computation, in one place, on the server:

```
validated PursuitQuery
   │
   ├─ 1. principal        the gate's stamp (proxy `x-pursuitos-principal`); no principal → no tenant (P6→P7 invariant)
   ├─ 2. organization     withTenant / withTenantOrg → set_config('app.org_id'), RLS binds under app_rw
   ├─ 3. eligibility      RLS + can_see_pursuit (effective participation window, SQL clock)
   ├─ 4. scope            resolveScope(db, orgId, scope) — narrows within the authorized set only
   ├─ 5. derivation       mayDerive(db, viewerOrg, input, purpose) per canonical input class
   ├─ 6. disclosure       resolveDisclosure(item, buildFederationViewer(...)) per field
   └─ 7. classification   each surviving cell carries { visibility, ownerOrgId, provenance }
   ↓
GovernedResultSet   ← the ONLY thing computation, analysis, presentation or an LLM ever sees
```

**No step may be skipped, reordered, memoized across requests, or performed by a model.** There is no
"trusted" internal path that reads canonical rows and hands them to presentation.

### 7.2 The firewall in front of the model

**Hidden evidence must never enter a recipient-facing LLM prompt.** Mechanically: prompts are built
**only** from a `GovernedResultSet`, whose suppressed cells carry no value — the raw value is dropped
at resolution, not hidden at render. The raw readers stay behind the accepted `unsafe_` prefix, no
recipient-facing path may reference them (the existing source guard), and that guard extends to the
prompt-construction module.

### 7.3 Zero safe-declassification transforms

Unchanged. `SAFE_DECLASSIFICATION_TRANSFORMS` remains empty, so any analysis with a hidden input is
`NOT_DISCLOSABLE`. A P7 aggregate, summary or narrative over partly-hidden inputs is therefore
**not disclosable** — it is not "generalized" into existence by passing through a model.

### 7.4 One clock

D-P6-1 stands: the governance instant is PostgreSQL transaction time, compared in SQL, never through
a JavaScript `Date`. `asOf` in a plan is `null` for every live query. A deliberate historical as-of
query would be a separate, explicitly-ruled capability — **[JUDGEMENT]**, §16.

### 7.5 Safe failure

Every refusal carries **operation metadata only** — never a withheld value, never a hint of its
magnitude, never the existence of a specific hidden row beyond what the count policy already permits.
This is the accepted P6-IG deny-reason discipline, and P7's explanation layer inherits it.

---

## 8. Explanation contract

### 8.1 Provenance requirement

Every EXPLAIN output must be traceable to (a) recipient-authorized canonical inputs and (b) governed
derived results. An explanation is a **function of a `GovernedResultSet` and nothing else**. If a
claim cannot be traced to a disclosed input or a registered metric, it may not be stated.

### 8.2 Three kinds of content, visibly distinct

| Kind | Example | Rule |
|---|---|---|
| **Fact** | "Stage: evaluated. Close date: 2026-11-30." | canonical, disclosed, attributable to an object |
| **Derived calculation** | "100th percentile of 8 on stage-weighted open value (Δ 0.043)." | registered metric `{id, version}`, cohort stated |
| **Generated prose** | "This is ahead because context needs attention." | narration **over** the two above |

The model **may narrate evidence; it may not create evidence.** A sentence introducing a quantity,
comparison or causal claim not present in the governed inputs is a defect, not a style issue.

### 8.3 Reuse of P2's own explanations

Where P2 already produces a Why-here string, P7 **shows P2's string**. P7 does not re-narrate a
pertinence differential in its own words with its own arithmetic.

---

## 9. Action boundary

### 9.1 The object that crosses P7 → P5 (answers **H**)

```
ActionProposal {
  skillId:        registered governed skill id        // from the skill registry, never free text
  actorRef:       the principal's governed actor      // resolved server-side, never client-supplied
  subject:        CanonicalObjectRef[]                // ids of canonical objects
  args:           validated against the skill's declared input schema
  idempotencyKey: string
  origin:         { surfaceId?, queryHash, interface: "web" | "mcp" | "api" | "agent" }
}
```

An `ActionProposal` is **inert**. It authorizes nothing, and constructing one is not permission to
execute one.

### 9.2 The execution path, unchanged

```
P7 surface/interface → ActionProposal → withTenant → dispatchSkill (federation/skills.ts)
                                        → P5 runtime (lib/runtime/runtime.ts)
                                        → capability grant + permission check
                                        → approval policy (lib/runtime/approvals.ts)
                                        → execution + ledger
```

**No P7 API, component, generated surface, MCP endpoint or agent may write canonical state directly.**
Checkable rules: no module under the P7 tree may import a writer, open a transaction that issues
INSERT/UPDATE/DELETE against business tables, or call anything but `dispatchSkill` and the runtime's
public entry points. This is enforceable by a source guard of the kind already used for `unsafe_`
readers, and §15 slices require one.

### 9.3 What a surface may render

A surface may render an action **offer** — label, target object, and whether the principal is eligible
— where eligibility is reported by P5/P6, not computed by P7. An ineligible action is shown as
unavailable with a recipient-safe reason, or not shown; it is never shown as available and refused on
click, and never hidden in a way that implies the object does not exist.

---

## 10. Headless / interface-independent model (answers **G**)

### 10.1 One capability layer

```
                    ┌──────────────── interfaces (transport only) ────────────────┐
  web (RSC)         MCP tools            HTTP API           Slack / Teams / agents
        └──────────────┴────────┬───────────┴───────────────────┘
                                ▼
                 P7 capability layer  (server-side, single implementation)
        parse → validate → GOVERN (§7) → compute → GovernedResultSet → present
                                ▼
        canonical read-models · metric registry · P5 dispatch · P6 governance
```

Each interface may only: accept a request, map it to a `PursuitQuery` or `ActionProposal`, call the
capability layer, and render the `GovernedResultSet` in its own idiom. **No interface may contain a
filter, a permission check, a metric, a disclosure decision or a write.** The browser is one client,
not the boundary.

### 10.2 Identical execution, provable

The same plan executed through web, MCP and API must produce the same `GovernedResultSet` for the same
principal, scope and instant. This is testable: run one plan through each transport in one test and
compare, excluding presentation. §15 requires that test in the slice that introduces the second
transport.

### 10.3 Principal per interface

Each transport must establish a principal by its own authenticated means (web: the gate's stamp; MCP:
the existing API-key → org resolution; future agents: their own credential). **Possession of an
interface is never authority** (§14). A transport that cannot establish a principal gets no tenant —
the P6→P7 invariant, unchanged.

---

## 11. Persistence model

### 11.1 Everything P7 proposes to persist

| Object | Category | Canonical? | Notes |
|---|---|---|---|
| `PinnedSurface` (plan + presentation config + name) | **query/surface definition** | no | §6.4; no results, no facts |
| Surface layout, column widths, collapsed sections | **presentation state** | no | per principal; browser storage is acceptable |
| Default scope, preferred view | **user preference** | no | existing scope cookie already does this |
| Query execution telemetry (duration, plan hash, row count) | **audit/runtime state** | no | no business values |
| Analysis results | **analysis artifact** | **not persisted by default** | ephemeral; see 11.3 |
| Metric definitions | **code** | n/a | registry is source, not a table (§4.2) |

### 11.2 Why this is not a shadow data model

No entry above is readable as a business fact. None is used by any other part of the system as truth.
A `PinnedSurface` deleted tomorrow changes no canonical state and no governance decision. If an
implementation ever needs to store *a value* rather than *a question*, that is a canonical-artifact
change and belongs to the owning domain — not to P7.

### 11.3 Analysis artifacts

If an analysis result must outlive its request (an exported report, an attached memo), the artifact
belongs to the existing canonical artifact that owns that behaviour — evidence, a brief, a snapshot.
P7 does not invent a parallel store. **[JUDGEMENT]**: whether any such export exists in P7 at all, or
is deferred — §16.

### 11.4 No schema work is authorized by this document

Naming `PinnedSurface` here is a **proposal**, not a schema. No migration may be written until the
slice that needs it is separately approved, and §15 deliberately places pinning **after** the
architecture is proven without it.

---

## 12. Determinism and the model boundary (answers **J**)

### 12.1 An LLM may

- interpret a natural-language request into a **candidate** `PursuitQuery` (untrusted, then validated);
- write **prose** in EXPLAIN over a `GovernedResultSet`;
- suggest a surface **name** or a presentation arrangement;
- suggest which registered metric answers a question — a **selection from the registry**, never a definition.

### 12.2 An LLM may not be authoritative for

permissions · disclosure · metric computation where a canonical deterministic definition exists ·
policy · write authorization · approval requirements · canonical state transitions · cohort membership ·
counts, ranks or aggregates · the decision that a value may be shown.

### 12.3 The structural rule

**Every operation must remain correct if the model is removed.** Concretely: for any request, a
deterministic plan exists that produces the identical `GovernedResultSet`; the model only proposes
which plan and narrates the outcome. Operations that cannot satisfy this — anything whose *result*
depends on a model — are prohibited in P7. This makes "did the model decide something it shouldn't"
a testable question: replay the plan without the model and compare.

---

## 13. Failure semantics

All fail closed; none silently degrades into invented content.

| Condition | Behaviour |
|---|---|
| **Unknown intent** | say it was not understood; offer registered capabilities. Never guess a plan. |
| **Unauthorized object** | the object is absent from the authorized set — indistinguishable from non-existence, per existing tenancy behaviour. No "you lack permission for pursuit X". |
| **Partially disclosable data** | render what is disclosed, mark the rest suppressed, keep counts truthful; never interpolate a hidden value, never average around it silently. |
| **Unsupported derivation** (`mayDerive` denies) | refuse that element with the operation-metadata reason; the rest of the surface still renders. |
| **Ambiguous metric** | refuse and list candidate registered metrics. Never pick one silently, never synthesize. |
| **Unavailable action** | shown unavailable with a safe reason, or omitted; never offered then refused. |
| **Approval required** | stated before invocation; the proposal enters P5 and returns "awaiting approval" as a real state, not a simulated success. |
| **Stale / missing context** | refuse with what is missing; never fill from a prior request or another principal's view. |
| **Conflicting canonical evidence** | present the conflict with both provenances; never resolve it by preference, recency or model judgement. Resolution is a domain concern. |
| **Governance unavailable** (DB, grant lookup fails) | the whole surface fails. **No partial render.** The D-P2-2 lesson: a swallowed failure that renders "no data" is worse than an error, because it looks like an answer. |

---

## 14. Threat model / invariant table

Each row: the attack, the mechanism that prevents it, and how an implementation is proven not to have
broken it.

| # | Attempt | Prevented by | Proof obligation |
|---|---|---|---|
| 1 | Expose hidden intercompany evidence through a surface | §7.1 resolution before computation; suppressed cells carry no value | a fixture with an `ORG_PRIVATE` field: assert the value is absent from the response **bytes**, not merely unrendered |
| 2 | Infer a hidden value through a generated metric | §4.2 registry-only metrics; §5.6 floor + differencing control | a metric proposed over a hidden input must refuse; differencing negative control repeated per new aggregate |
| 3 | Bypass P5 with a generated action | §9.2 `dispatchSkill`-only path | source guard: no P7 module imports a writer or issues a business-table mutation |
| 4 | Create a shadow metric | §4.2 code-defined registry; validation rejects unknown `{id, version}` | test: a plan naming an unregistered metric fails validation; a prose answer containing a number with no metric provenance fails review |
| 5 | Persist a shadow canonical fact | §11.1 enumerated persistence; §6.3 | schema guard: any new table in a P7 slice must be justified against §11 before migration |
| 6 | Broaden scope through natural-language ambiguity | §3.3 validation; scope resolved server-side from the authorized set | test: a plan requesting a scope outside the principal's authorized set resolves to the authorized set, never beyond |
| 7 | Use a pinned surface to preserve access after revocation | §6.4 definitions only; re-governed per read | test: pin, revoke the grant, re-read → the data is gone with no special-case code |
| 8 | Disclose hidden evidence through explanation text | §7.2 prompts built only from `GovernedResultSet`; §8.1 provenance | source guard: the prompt builder cannot reach `unsafe_` readers; test asserting a suppressed value never appears in prose |
| 9 | Treat interface possession as authority | §10.3; the P6→P7 principal invariant | test per transport: no principal → no tenant, no data |

---

## 15. Proposed implementation slices

No code is authorized by this document. The sequence is chosen so the **architecture is exercised
before any speculative infrastructure exists**.

- **Slice 1 — the spine, read-only, one object class.** `PursuitQuery` v1, the registry, validation,
  §7 governance resolution, `GovernedResultSet`, and **SHOW ME** + **GO TO** over pursuits, rendered
  by one existing-style server component. **No LLM in the fetch path** (plans built by a deterministic
  parser or supplied directly), no pinning, no actions, no new tables. Proves: plan → govern →
  compute → present, and threat rows 1, 6, 9.
- **Slice 2 — EXPLAIN over governed results.** Provenance-tagged output; P2's own Why-here strings
  reused. **[JUDGEMENT]** whether prose is deterministic templates first and LLM after (§16).
  Proves rows 4 and 8.
- **Slice 3 — ANALYZE + cohorts.** Registered aggregations, scope narrowing, the count floor and the
  differencing control. Proves rows 2 and 5.
- **Slice 4 — headless parity.** The same plans through MCP/API; the identical-execution test (§10.2).
  Proves row 9 per transport.
- **Slice 5 — action offers.** `ActionProposal` → `dispatchSkill` → P5, including "approval required"
  as a real state. Proves row 3.
- **Slice 6 — pinning.** Only now, with `PinnedSurface` as definition-only persistence and the
  revocation test as its acceptance gate. Proves row 7.
- **Slice 7 — LLM intent parsing**, if not already admitted in Slice 1, with the replay-without-model
  equivalence test (§12.3).

The smallest first vertical slice is **Slice 1**: it touches every architectural seam — plan,
registry, governance, computation, presentation — and needs no new table, no model, and no change to
P5 or P6.

---

## 16. Architectural decisions requiring a ruling

1. **Metric version retention.** Keep every shipped metric version indefinitely, or deprecate on a
   stated policy with forced migration of pinned surfaces? (§4.2)
2. **Historical `asOf` queries.** Permit a deliberate as-of query at all in P7, or hold `asOf: null`
   as an absolute for now? D-P6-1 permits a deliberate historical query but never as an authorization
   clock. (§7.4)
3. **Pinned-surface visibility.** Personal only, or shareable within the organization? Sharing makes a
   surface definition a *recipient-facing artifact* and pulls onward-sharing questions into P7. My
   recommendation: **personal only** in Slice 6.
4. **Does Slice 1 admit an LLM at all?** My recommendation: **no** — prove the deterministic spine
   first, add intent parsing in Slice 7 with the equivalence test.
5. **EXPLAIN prose mechanism.** Deterministic templates first (safer, auditable) versus LLM narration
   from the start. Recommendation: templates in Slice 2, LLM narration as a later, separately gated
   step.
6. **Analysis export.** Does P7 export/attach analysis artifacts at all, or is that deferred entirely
   to the owning canonical artifact? (§11.3) Recommendation: **defer**.
7. **Feature flag and capability DAG position.** P7 presumably needs its own env + tenant flag. Where
   does it sit relative to the accepted DAG (`pursuitAttention → pursuitCoordination →
   pursuitIntelligence → pursuitState + pursuitMemory`)? The accepted rule is that a flag is not added
   to satisfy a gate, so this must be decided deliberately.
8. **Which transports are in scope for P7 as defined** — web + MCP/API only, with Slack/Teams/agents
   explicitly future? Recommendation: **yes**, name them future so no interface-specific logic is
   written speculatively.
9. **Aggregate safety review process.** Every new aggregate must pass the differencing control (§5.6).
   Is that a per-slice gate or a standing checklist item?
10. **Cross-organization comparison.** Confirm the stated position: P7 may *display* authorized
    cross-org data but may never *rank or percentile across organizations* (§5.5). This is the rule
    most likely to be pushed on later by a plausible-sounding feature request.

---

## 16A. Standing test invariant (adopted after Slices 1–2)

> **Certification assertions must target semantic structure or observable behaviour — never
> incidental prose, comments, formatting, source-string spelling or exact call-site text.**

This is not style advice. Across P6-IG and P7 Slices 1–2, **eight** assertions failed while the
product was correct, every one because the check matched *text* rather than *structure*:

| What the assertion matched | What it actually caught |
|---|---|
| registry **prose** for "pertinence" | the metric's own *"not a pertinence signal"* denial |
| `next.config.mjs` **text** for `Vary: Cookie` | the config file agreeing with itself while the wire disagreed |
| the route's **exact call text** | a legitimate Slice 2 change to the same call |
| a bare word **"projection"** | the page's own prose, *"a governed projection over…"* |
| an operator **regex** for arithmetic | string concatenation inside a provenance sentence |
| `/\bjoin\b/` | JavaScript's `Array.prototype.join` |
| an **undecoded** apostrophe | correct output rendered as `&#x27;` |
| a **one-hop** redirect expectation | a correct two-hop chain through trailing-slash normalization |

Each cost a cycle and, worse, each was a moment where a *green* run would have meant nothing. A
check that can fail for a reason unrelated to the property it names can also **pass** for one.

**How to apply.** Assert on: registered keys and their values; response **bytes**; parsed structure;
a function's arity or signature; observed HTTP behaviour; digests of normalized output. Do not assert
on: a sentence, a comment, a variable name, a literal call-site expression, or a regex over source
that a refactor would change. Where only source structure is available — a guard proving a module
does not import a writer — strip comments first and match a *shape* (`fwd.delete(X)` before
`fwd.set(X)`), not a spelling.

---

## 17. What this contract forbids, in one list

For review convenience — every prohibition above, collected:

no P7 data model · no P7 permissions · no P7 disclosure policy · no P7 metrics outside the registry ·
no P7 authority · no P7 state mutation · no P7 write path · no bypass of P5 · no bypass of P6 ·
no alternate pertinence, probability or shadow ranking · no cross-organization ranking ·
no cached governance decision · no result persisted as truth · no hidden evidence in a prompt ·
no model-authoritative permission, disclosure, metric, policy or approval · no silent fallback ·
no partial render on governance failure · no guessed plan · no invented number.
