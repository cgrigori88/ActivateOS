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

## 16B. Standing certification invariant — evidence before assertion (adopted after Slice 3)

> **No semantic assertion may execute against missing, undefined, partially parsed or structurally
> invalid evidence.**

Before any downstream `PASS` is possible, a hosted-gate parser must first prove:

1. the **expected artifact/field exists**;
2. the **expected cardinality** is present;
3. the **parsed type/shape** is valid;
4. the parser **did not silently default** an absent value.

**A missing expected field is FAIL / INVALID — never a value that can satisfy a negative assertion.**

**Why this is a separate invariant from §16A.** §16A is about asserting on the wrong *thing*. This is
about asserting on *nothing at all* and being told it passed. In the P7 Slice 3 hosted gate, a parser
stripped React's `<!-- -->` text-node separators to spaces, splitting `pursuit.open_pipeline_usd@1`
into `pursuit.open_pipeline_usd @ 1`. The aggregate regex then matched nothing, every parsed field
came back `undefined`, and **eleven checks passed vacuously** — including
*"the WITHHELD response exposes no `basis.members`"*, which was satisfied by `undefined === undefined`
on a surface that had never been read. The run reported 30/12 and the twelve visible failures were the
only reason the eleven invisible ones were ever found.

The asymmetry is the danger: a negative assertion (`x === undefined`, `!bytes.includes(secret)`) is
**satisfied by absence**. So absence must be disqualified before it can be mistaken for proof. A gate
whose parser missed must fail loudly, not report clean.

**How to apply.**
- Extract at least one **positive** value (a number, a count, an identifier) and assert it is present
  and well-formed *before* trusting any negative assertion built on the same parse.
- Treat a parse miss as **INVALID**, a distinct outcome from FAIL — the same class rule CFR-1.2
  established for transport failure, where INVALID ≠ PASS.
- **Route/inventory existence must be proven from structured build or runtime metadata, never from
  source-text matching.** Adopted with Slice 4, which reads the App Router's own emitted route
  inventory. **The exact filename is implementation-specific evidence, not an architectural
  contract** — it may change with the framework, and a gate that pins it is pinning a build detail. If
  the expected structured inventory is **missing, unreadable, or its schema cannot be validated**, the
  result is **INVALID/FAIL — never PASS, and never "the destination is absent."** Keep a sanity control
  proving a known-present entry exists *before* testing the registered ones, so a manifest that loaded
  but means something else cannot quietly answer "no" to every question.
- **Prefer structured evidence over parsing rendered prose or HTML wherever a governed structured
  output already exists.** P7 produces `GovernedResultSet`, `Explanation` and `AggregateResult` as
  structured values; a gate that can assert against those, or against a JSON boundary, should never be
  re-deriving them from a rendered page. Parse HTML only to prove a property *of the rendered surface
  itself* — that a withheld value is absent from the bytes a recipient receives — and then parse it
  defensively, per the rules above.

---

## 16C. Standing certification invariant — security assertions are atomic (adopted after Slice 4)

> **A gate must not combine multiple security properties into one boolean assertion when those
> properties can fail independently.**

Four things are routinely conflated in a single `&&`, and they are not the same claim:

| Property | What it actually asserts |
|---|---|
| **caller-supplied input echoed by transport/router state** | the bytes contain something *the caller put there* |
| **canonical object identity resolved by the application** | the application decided this id is the subject |
| **governed disclosure of object existence** | the recipient may know the object exists |
| **governed disclosure of object metadata** | the recipient may know this *about* the object |

**Each must have its own evidence and its own named assertion.**

**Why.** In the Slice 4 hosted gate, one compound check read *"neither resolves, and neither exposes the
requested id, a path or a label."* It failed — correctly, but uselessly: the clause that failed was
the id clause, and the id was in the bytes because Next's router state **echoes the URL the caller
supplied**. Nothing was disclosed. A compound assertion names no clause, so a genuine failure and a
false alarm arrive looking identical, and the only way to tell them apart is to take the check apart.
Split into five, the same run reported the discriminator directly: the id is present when supplied
(`true`) and absent when not (`false`), which is the actual proof that it is echo and not disclosure.

The same trap appeared in Slice 3 with a foreign organization's id. Echo is not disclosure — but
*proving* that requires its own control, and a compound assertion has nowhere to put one.

**How to apply.** One property, one `check()`, one name, one piece of evidence. When a property's
meaning depends on a control (echo vs. disclosure), assert the control explicitly rather than folding
it into the same boolean. Prefer a failing gate that says *which* thing broke over a shorter one.

---

## 16D. Standing certification invariant — assert within the region that owns the property (adopted after Slice 5)

> **Security assertions must be scoped to the semantic region that owns the asserted property.**
> Application-shell and navigation content must not satisfy or fail an assertion about governed
> result content. **Prefer structured result-region evidence over whole-document substring scans.**

**Why.** The Stage B1 gate reported 69/6, and all six failures were one assertion scanning the whole
HTML document for `/admin` while claiming to test *"no arbitrary route is emitted"* by a hostile
prompt. `/admin` is the **app shell's own navigation link** — present on every page including benign
ones, and never inside the result region. The model had emitted nothing; the chrome had.

A whole-document scan answers a different question from the one its name states. It can fail on
chrome (a false alarm that costs a cycle) and, worse, it can **pass** on chrome — if the string
happens to be absent from the shell, the assertion reports success without ever having looked at the
region that could actually carry a violation.

This is the third member of a family: §16A (asserting on the wrong *kind* of thing), §16B (asserting
on *nothing*), §16C (asserting on *several things at once*). This one is asserting in the wrong
*place*.

**How to apply.**
- Extract the region that owns the property — `<main>`, a named section, a parsed structure — and
  assert inside it. Prefer a governed structured value over rendered markup wherever one exists.
- When the property genuinely concerns the whole document (a withheld amount must appear in **no**
  byte), say so explicitly and keep it separate from region-scoped claims.
- Assert the **control** alongside: that the shell content which would otherwise confound the check
  is present in the document and absent from the region. Without that control, "the region is clean"
  and "the extractor returned nothing" look identical (§16B).

---

---

## 16E. Standing distinction — a clock-conditioned write is not a clock-derived observation (adopted after Slice 6)

> **Clock-derived observation is not the same as a clock-conditioned write. A persistent mutation may
> not be waived as "clock-derived" merely because the date or time determined WHEN it occurred.**

CFR-1.2 and the manifest ruling established that a digest can move because a value was *recomputed*
against a later clock while the world is unchanged — `days_since_activity`, a pertinence delta in the
third decimal. Those are **observations**: nothing was written, and replaying the same inputs at the
same instant reproduces the same bytes.

During Slice 6 certification `pipeline_snapshots` moved 3 → 4 rows across a UTC date boundary. That is
a different thing entirely: **a row was committed**. The clock chose *which* row; a page render chose
*whether* there was one at all. Same canonical source state, different persistent state, decided by
whether anybody looked (measured — see `docs/d-hist-1-read-path-write-discovery.md`).

**How to apply.** When a fingerprint moves, establish which of the two it is before classifying it:

- **Observation** — no row changed; a derived value was recomputed from unchanged canonical inputs
  against a later clock. Permitted, and recomputable from those inputs plus the observation time.
- **Clock-conditioned write** — rows changed. It must be explained by naming the *writer* and the
  *trigger*, never by naming the clock. "It's just the date rolling over" explains the timing and
  nothing else.

A movement that cannot be attributed to a named writer on a named path is not classified yet.

---

## 16F. Standing deployment invariant — serving state, not repository state, governs migration safety (adopted during D-HIST-2)

> **Serving state, not repository state, governs migration safety.**

Before applying a hosted migration whose schema is incompatible with the currently deployed
application:

1. **prove the compatible application commit is actually serving**;
2. **prove the route affected by the migration resolves under that serving commit**;
3. only then apply the migration.

**A pushed-but-undeployed commit does not satisfy this prerequisite.** Neither does a successful `git
push`, a build request, or a webhook acknowledgement.

> **Hosted acceptance must identify and verify the actual serving commit independently of branch
> HEAD.**

**Why this is explicit now.** During D-HIST-2, three commits — `e5f123f`, `b6ccd69` and `25e6c7e` —
were pushed and **never deployed**, because the Vercel account had silently exhausted its daily
deployment quota. The branch tip and the serving commit had diverged by three commits with no signal
on push, and the newest Preview deployment was still `f7b40b1`.

Had the migration been applied on the strength of the push, `/pipeline` would have broken on the live
Preview for the length of the quota window: migration 0113 makes `source` `NOT NULL` with **no
default**, by design, while the *serving* code still contained the render-path writer that omits it.
Every render would have attempted a NOT NULL–violating insert. The repository was correct and the
deployment was not, and only the deployment decides what runs.

**How to apply.** Read the serving commit from the deployment itself — `/api/build`, or the equivalent
runtime fingerprint — and compare it to the commit the gate intends to certify. Where migration order
matters, deploy first, verify serving, then migrate: the reverse order is only safe when the deploy
can follow immediately, which is exactly the assumption a quota, an outage or a failed build breaks.

## 17. What this contract forbids, in one list

For review convenience — every prohibition above, collected:

no P7 data model · no P7 permissions · no P7 disclosure policy · no P7 metrics outside the registry ·
no P7 authority · no P7 state mutation · no P7 write path · no bypass of P5 · no bypass of P6 ·
no alternate pertinence, probability or shadow ranking · no cross-organization ranking ·
no cached governance decision · no result persisted as truth · no hidden evidence in a prompt ·
no model-authoritative permission, disclosure, metric, policy or approval · no silent fallback ·
no partial render on governance failure · no guessed plan · no invented number.

### §16G — the organization under test must be derived, not chosen

> **Org/tenant assertions must derive the organization from the governed principal/context actually
> under test. A convenient organization with equivalent feature state is not evidence for another
> principal.**

From the P7 Slice 7 hosted gate: tenant entitlement and `dynamicSurfaces` were asserted against
*TD SYNNEX (demo)* while the governed context came entirely from *Vertex Systems*. Every assertion
passed, because all three organizations carry identical feature state — so the check was green while
proving nothing it claimed. Derive the principal's organization from the governed context itself (join
the observed object ids back to `organizations`); where a posture should hold everywhere, assert it
across *every* row rather than one convenient name.

### §16H — result-region extraction is TOOLING, not a rule to remember

The §16D lesson recurred in Slices 4, 7 and 8 — each time as an assertion that treated
caller-controlled text as application disclosure. A prose rule has now failed three times, so it
becomes tooling instead:

> **Future P7 disclosure gates use a shared semantic-result-region extraction and assertion helper.**
> **Whole-document scans are used only where the property genuinely belongs to the whole document.**
> **Caller-controlled query/URL echo, app-shell navigation and compile-input text must not participate
> in result-disclosure assertions.**

The helper owns: locating the result region, stripping HTML comments before tags (React's `<!-- -->`
text separators), masking instants, and exposing the region, the app-shell control and the caller echo
as *separate* values so an assertion must choose one deliberately.

**Prior closed slices are NOT refactored to adopt it.** Their gates passed on evidence that was
correct at the time; rewriting them would risk re-certifying by editing rather than by proving.

### §16I — Git state, build state, alias state and serving state are distinct

§16F said "prove the serving commit". Slice 12 showed that sentence was not specific enough, by
failing it twice in opposite directions on the same branch in the same day.

> **A push does not prove serving state.** A push may trigger a build, and that build may or may not
> become reachable through the certified hostname.
>
> **A successful build does not prove serving state.** A deployment can be `Ready`, carry the right
> commit, and own no alias.
>
> **Alias movement is itself a hosted deployment-state change.** Moving an alias changes what every
> user receives, with no commit, no build and no migration.
>
> **A manually pinned alias may stop following later branch builds.** Once pinned by hand, a branch
> hostname can stay attached to that deployment across subsequent Git-triggered builds.
>
> **Before a staged gate, establish whether the certified hostname is automatically branch-managed or
> manually pinned.** That state — not the project's history — decides whether a push can become a
> serving transition.
>
> **Independently verify the serving SHA after every push, build or alias transition** that the
> certification depends on.

**What actually happened, recorded because the sequence is the argument.** Slice 12's runtime was
committed to an auto-deploying branch, so three subsequent *documentation* pushes carried it into
Preview while the schema was still at 113 — new application, old schema, the exact inversion §16F
exists to prevent. The corrective sequence pinned the branch alias by hand to the last pre-Slice-12
deployment, applied 0114 while that old application was serving, proved old-app/new-schema health,
and then moved the alias forward. That pinning fixed the ordering **and** silently disabled the
branch-follow behaviour: the later completion commit built successfully and never became reachable,
so the focused gate required one more explicit alias transition to serve `3449c56`.

The lesson is not "avoid manual aliases". It is that the fix for one of these four states is a change
to another, and a gate that reasons about only one of them is reasoning about the wrong thing.

### §16J — a concurrency test must deterministically establish the race premise it relies on

> **"Requests were created concurrently" does not prove "requests observed the same generation."**

`p45-program` launched N resumes with `Promise.allSettled` and called them same-generation racers. It
never established that. `resumeRun` fixes the generation a request was issued against when its first
statement — an unlocked `observeGeneration` SELECT — returns, which happens after connection
acquisition and scheduler entry. Under load a later racer legitimately began after the winner had
committed, observed the NEW generation and advanced the next step. **The product invariant held; the
test premise did not**, and the suite failed roughly 15% of runs on unmodified code.

When semantics depend on an observed generation, version or state:

> **Identify the exact point at which that observation becomes fixed.**
> **Establish the required shared observation deterministically if the assertion depends on it.**
> **Only then assert the race consequence.**
> **Distinguish legitimate later-generation work from stale same-generation duplication.**
> **Never use sleeps, Promise creation order, machine load, connection-pool starvation or retries as
> proof of concurrency state.**

**The harness must prove the precondition before asserting the semantic consequence.** That is the
concurrency analogue of §16B (asserting on nothing) and §16D/§16H (asserting on the wrong region):
the same failure — an assertion whose subject was never actually established — wearing a different
costume.

The repair split one conflated test into two honest ones. **Scenario A** is ordinary public
concurrency with no barrier: scheduler-dependent by design, asserting only what is true under any
scheduling — no duplicate step dispatch, at most one invocation and one effect per step, each
dispatcher aligned with the generation it actually observed, stale losers carrying nothing, terminal
observers not misclassified, no step skipped. **Scenario B** is the deterministic proof, and it is
where the guarantee lives: a Proxy over the `PoolClient` the verifier already supplies pauses every
participant after its own observation and before it serializes, so *all N observed G* is proven
before *G advances at most once* is asserted.

**The seam must fail loudly, not silently.** The Proxy verifies the intercepted statement really is
the generation observation; if a later refactor moves it, the test reports a harness-seam failure
rather than pausing at an unrelated query and quietly proving nothing.

**A diagnostic note recorded because the wrong version of it was believed for a while.** `verify-run`
was **not** totals-only — the failing assertion names were already in its MATRIX `reason` column, and
an over-narrow grep omitted that row. The genuine, separate weakness is that `runSuite` discarded a
failing suite's stdout; `VERIFY_DUMP_ON_FAIL` corrects that opt-in, leaving default behaviour and
pass/fail semantics unchanged and introducing no retry.

### §16K — an equivalence test must hold the security substrate constant

> **The trusted execution boundary establishes both WHO is asking and the governed substrate on
> which execution occurs. An identity object alone does not determine governed semantics.**

Slice 13 asserted that web and headless execution produce the same governed result. The first attempt
compared a direct run connected as the database **owner** against the deployed web path running as
**`app_rw`** — two intentionally different security contexts. It returned 12 governed rows against 11,
and I recorded that as *"two independent layers, same refusal"*.

That framing was wrong, and the way it was wrong is the lesson: it conflated **no field values
disclosed** with **the same semantic object**. RLS removed the row before P6 ever saw it on one path;
P6 admitted the row and suppressed every value on the other. Neither disclosed a value — and the two
results were still different, because **row membership is part of the semantic contract**.

> **Differing membership under differing substrates proves nothing about interface parity, in either
> direction.** A comparison whose two sides differ in a variable the property is sensitive to is not a
> test of that property.

**The corollary is a product rule, not only a testing one.** If a substrate can change the answer,
then a caller who can choose the substrate can choose the answer — so the substrate must be
established by the trusted boundary and not by ambient process configuration. Slice 13's canonical
executor therefore refuses to run unless the pool is the certified application role, and does so
before context resolution, any governed read, compilation or assembly.

**Two supporting rules learned the same day:**

- **Certification caches are keyed by identity, never by a process-global flag.** `certified = true`
  lets one legal pool bless every later one; a `WeakSet` keyed on the pool answers *"has THIS pool
  been certified"*, and the entry dies with the pool it describes.
- **A conventional guarantee is not a structural one.** Five verifiers already pinned
  `DATABASE_URL = app_rw` with the comment *"exactly like the app"*, and the deployed runtime was
  `app_rw` — but nothing refused a differently configured process. The convention existed precisely
  to prevent the mistake I made by ignoring it, which is the clearest possible argument for making it
  structural.

### §16L — a cardinality bound is not a membership definition

> **A presentation or cardinality limit may constrain the rows a caller receives. It may never
> silently constrain the semantic member set an aggregate is computed over.**

Slice 3 defined a cohort as `{subjectClass, scope, filters}` — *the question* — and ruled that an
aggregate is computed only when **every** member of that cohort has a disclosable contribution. The
implementation then handed `analyze()` the rows a renderer was about to receive: candidates were
governed in full, ordered by `updated_at`, sliced to `plan.limit`, and the slice became the
membership. Measured on a 212-member cohort before the correction: `basis.members` reported **200**,
omissions outside the slice vanished from the result, and — the part that makes this a rule rather
than an inaccuracy — **a member whose contribution governance had refused could be pushed out of the
slice by newer, unrelated, fully disclosable rows, and the same semantic request then returned
DISCLOSED where it had returned WITHHELD**, with nothing about that member changed.

> **Withhold-whole is a governance rule, and a rule that a row count can defeat is not a rule.**

The correction is a type, not a comment. Only a completed governance pass can produce the object
`analyze()` accepts: the brand is a module-private symbol, the seal **validates** rather than stamps
(it refuses unless the governed members are exactly the candidate set), and membership is held by
object identity in a module-private `WeakSet`, because a spread would otherwise carry a brand onto a
clone with different members. There is no overload that takes a result set, so the defect cannot be
reintroduced by a caller reaching for the nearest argument to hand.

**The corollary for evidence.** A tenant whose cohort sits far below the limit cannot discriminate
this defect at all — the pre-correction code returns the identical figure. Hosted acceptance for
Slice 14 therefore states plainly that the 11-member Preview cohort proves membership *equals* the
complete cohort and proves nothing about truncation; the discriminating evidence came from seeded
212- and 2,011-member substrates. **An invariant about scale is not evidenced at a scale where both
implementations agree.**

**Three supporting rules, all learned inside this gate:**

- **Name a statement by what distinguishes it, not by the table it reads.** An assertion that one
  added statement was "the derivation-grant query against `context_grants`" passed the wrong way:
  two different loaders read that table — the always-issued allow-list read and the boundary-crossing
  grant read. The assertion now keys on the columns only the decision read selects (`purpose_code`,
  `retention_class`). The same correction applied to a structural scan that counted three
  `context_grants` queries and demanded `order by` of all three; the set-building read needs no
  ordering, and demanding it would have asserted the wrong property of the right query.
- **A fingerprint truncated before the part an assertion inspects cannot support that assertion.**
  Statement text captured at 70 characters ended before its `FROM` clause, so a check naming the
  table could never match. It failed loudly, which is the only reason it was cheap; a negative
  assertion built on the same truncation would have passed vacuously.
- **Prefer enumeration over provocation when the behaviour being controlled for is unspecified.**
  The historical unordered `limit 1` is reproduced as a negative control by asking the decision core
  for its verdict on *each* qualifying grant alone — the choice set the query was free to return —
  rather than by asserting which row today's heap happens to yield. Pinning that row would pin the
  defect.

### §16M — a membership assertion must control for the presentation window

> **"Does X appear on this surface?" is not a question about X until the assertion has established
> that the surface was willing to show X at all.**

§16L ruled that a cardinality bound may not define an aggregate's *members*. This is its mirror
image on the evidence side, and it was learned the hard way during the P3 Slice 2C-A hosted
activation gate. Today's default surface renders `TODAY_TOP_DECISIONS = 4` cards. The gate asserted
that a newly-approved **v2** plan action appeared on `/`, it did not, and the failure read exactly
like the defect the gate existed to find: *Today is blind to schema-2 plans.*

It was not. The fixture pursuit carried no expected value, so it lost the ranking to twelve other
open pursuits and never entered the four-card window. **The absence was about rank and said nothing
whatever about schema.**

The first correction was also wrong, and is recorded because the shape of the error matters more
than the error: the hypothesis became *"Today is not a plan-action surface"* — which a single
control immediately refuted, because the canonical **v1** action was plainly there. A wrong
hypothesis that happens to predict the observed absence is the most expensive kind, and the only
thing that caught it was putting v1 and v2 to the identical test.

The proof that settled it released ranking through the product's own surface — `?today=all`, cap 50 —
where the v2 action appears as the **same `ACTION_DUE` item** the v1 plan produces, on the activated
deployment *and* on the certified rollback deployment, beside the v1 action. The execution layer
resolves through `stagedByActionKey`, which is version-dispatched by construction.

**The rules:**

- **A negative on a ranked, truncated or paginated surface is not evidence until the assertion has
  released the bound** — through the product's own unbounded surface where one exists, never by
  reaching past the product into the loader.
- **Carry a positive control of the other version, shape or class through the identical path.** Had
  the v1 control been in the original assertion, neither wrong conclusion would have survived one run.
- **When a correction produces a new hypothesis, test the hypothesis, not the conclusion you want.**

### §16N — a gate assertion must reach the gate

> **A refusal only certifies the brake that produced it. A guard that fires earlier proves the
> earlier guard.**

The same gate had to prove that a deployment with `PLAN_CONTENT_V2_WRITES_ENABLED` off refuses to
*decide* a pending schema-2 recommendation. Two attempts failed to prove it, each for a different
reason, and neither failure was in the product:

- **Sweeping every discovered Server Action id is not isolation.** Invoking all of them against the
  rollback deployment did produce the intended refusal — and also invoked the *recommend* action,
  which correctly wrote a **v1** recommendation, and a third action that refused on argument shape.
  The world-fingerprint assertion then reported a table moving that the brake had not moved. The
  evidence was reconstructable from the immutable dispatch audit, but an assertion whose blast radius
  exceeds the behaviour under test cannot support a claim about that behaviour.
- **A brake that is never reached is not a brake that was proved.** The retry reused an
  already-decided fixture. An unchanged world correctly returns UNCHANGED (D-028), so no pending
  recommendation existed and the refusal came back *"This recommendation is no longer awaiting a
  decision"* — an ordinary lifecycle guard, structurally **before** the write gate. Accepting that
  refusal would have certified the wrong mechanism with a green check.

The proof that held used a fixture recommended and **never decided**, and exactly one invocation of
the decide action — identified by its position in the route's Server Action list, which is stable
across two builds of the same source tree, and confirmed by dispatch. The refusal named the gate
itself; one dispatch row was appended; across the whole database **no other table moved**; the
pending v2 recommendation survived un-downconverted and still decidable.

> **The write brake prevents prohibited business-state mutation. It does not — and must not —
> suppress the immutable audit evidence that the invocation was attempted.**

**Addendum to §16H (hosted-harness tooling, not rules to remember).** Two properties of hosted
Server Action crawling that no prose rule will reliably recall: **action ids are salted per build**,
so a harness must discover the serving deployment's own ids and confirm each by observable effect
rather than reuse a local or previously-recorded id; and **an HTTP 303 from sign-in does not prove
an authenticated session** — a throttled login returns the same status with no cookie, so hosted
crawls must positively assert authenticated state before asserting anything else.
