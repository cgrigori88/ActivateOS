# P7 Slice 8 — governed component-to-component binding: contract and plan

**Status:** **CONTRACT RULED — A–F RETURNED, B AND F MODIFIED. IMPLEMENTATION AUTHORIZED.** The rulings
as returned are recorded in §R; hosted acceptance requires separate authorization.
**Builds on:** Slices 1–7 and D-HIST-2, all HOSTED ACCEPTED / CLOSED. Slice 7 is not reopened.

> **A component may consume an explicitly exported governed identity handle from another certified
> component. It may not consume raw rows, hidden fields, rendered text or arbitrary result values.**

**This slice is about identity flow, not general dataflow.** Slice 7 proved that a surface may reuse an
identity the recipient *already had*. Slice 8 asks the harder question: may a surface use an identity
that **exists only because a governed operation just ran**?

---

## A. The first vertical

```
SHOW ME (open pursuits)            ← governed, ordered, certified
      │  exports ONE identity handle, chosen by a closed deterministic selector
      ├─────────────► EXPLAIN  (that identity)
      └─────────────► GO TO    (that identity)
```

Three read-only components, **one dependency level**, two sibling consumers of the **same** resolved
identity. No ANALYZE dependency. No second-level chaining. No downstream component exports anything.

---

## B. The architectural fact that shapes everything else

**Slice 7's design is "compile the whole spec, then execute it."** `compileSurface` calls `compileIntent`
for every component *before* the assembler runs, and `compileIntent` resolves `{fromContext:n}` into a
finished `request: { subjectId }`. That is why whole-spec atomicity was cheap: by execution time every
request was already certified.

**A component-derived identity cannot exist at compile time.** It is produced by an upstream governed
read that has not happened yet. So Slice 8 cannot compile a downstream request up front, and the
single-phase model has to become two phases:

| Phase | When | What is decided |
|---|---|---|
| **Graph validation** | before any execution | components, operations, binds, **edges**, acyclicity, selector vocabulary — everything except the identity *value* |
| **Execution resolution** | during topological execution | the upstream result → selector → handle → the downstream request, compiled by the **existing certified** `compileIntent` |

**The atomicity claim survives intact**, because an identity value is *data*, not a validation input.
"The full graph is structurally validated before any component executes" remains literally true.

---

## C. The export boundary — identity capability, not row data

A component exports an opaque **`ResultIdentityHandle`**, and nothing else:

```
ResultIdentityHandle
  sourceComponent   the exporting component key
  resultDigest      identity of the exact governed result set it came from
  selector          the closed selector that chose it
  identity          ONE governed object identity + its recipient-safe label
```

`identity` carries exactly what Slice 5's `ContextSlot`/`ids` pair already carries — a canonical id plus
the label rule Slice 4 certified. It carries **no** economic value, account field, metric, hidden
metadata, explanation text, omission, count or arbitrary row field.

> **Components may export identity capability, not row data.**

Structurally: the handle is built by deterministic code from `row.objectRef.id` and the registered
label cell. There is no path from a `GovernedRow` into a downstream component — the downstream
component receives a handle, never a row.

---

## D. ContextManifest: reuse the **type**, never the recipient's **instance**

Evidence from the current architecture, before choosing:

- `buildContextManifest(rows)` is pure and takes governed rows — it is not tied to the recipient's
  pre-existing context in any way.
- `resolveContextRef(manifest, boundDigest, index)` refuses on digest mismatch, out-of-range and
  non-integers — the exact refusals a handle needs.
- `compileIntent` consumes *a* manifest; it does not know or care which one.
- But `?ctx=` lets a **caller state** which manifest a proposal was bound to. That is meaningful for
  context the caller has seen, and **meaningless** for an identity that did not exist when the request
  was made.
- And the recipient's manifest is built **before the model call**, with its labels sent to the prompt.
  An execution-time identity must never be able to reach a prompt.

**Recommendation: a distinct, ephemeral, execution-time manifest instance — reusing the certified
`ContextManifest` type and `resolveContextRef`, never the recipient's manifest.** The handle *is* a
one-slot manifest produced after the model has exited.

This gets the best of both: **zero new resolution logic** (the downstream bind compiles through the
unchanged Slice 5 compiler as `{fromContext: 0}` against the ephemeral manifest), while the recipient's
pre-existing manifest is never extended, merged into or mutated — preserving exactly what Slice 7
established. The ephemeral manifest is provider-invisible (built after the model exits), lives for one
surface execution, is never persisted, and confers no authority (§F).

**The honest cost:** two manifest *instances* with different provenance now exist in one execution, and
a reader must not confuse them. They are kept distinct by type-level naming and by the rule that only
the recipient manifest is ever passed to `toPrompt()` — a suite proves the ephemeral one never is.

---

## E. The dependency shape — reference by **component key**

```jsonc
{ "specVersion": 1, "layout": "stack", "components": [
  { "component": "pursuit.list",
    "bind": { "operation": "SHOW_ME", "view": "open-by-value" } },
  { "component": "pursuit.explanation",
    "bind": { "operation": "EXPLAIN", "subject": { "fromComponent": "pursuit.list", "select": "first" } } },
  { "component": "pursuit.destination",
    "bind": { "operation": "GO_TO", "subject": { "fromComponent": "pursuit.list", "select": "first" },
              "surface": "canonical" } }
]}
```

**Why a component KEY and not an index or a node id.** Slice 6 already enforces **one component per
registered type**, so the key is *already* a unique, closed namespace inside a validated surface. Using
it introduces no new identifier space, cannot be confused with a row index or a result value, and is
validated by the existing `isComponentKey`. An integer index would be indistinguishable in shape from
the row references §15 must forbid.

**The dependency is expressible only as:** an existing component in the same validated surface, an
allowed export, and a closed selector. `fromComponent` and `select` are the only new keys, both closed,
both rejected anywhere they are not registered. There is no field for a UUID, field name, path, URL,
SQL, metric, filter, expression or model-authored transformation — they stay **unrepresentable**, not
merely rejected.

**Caveat to record:** this shape depends on one-component-per-type. If a later slice permits repeated
types, the reference must gain an explicit node id — a deliberate, reviewed change, not a drift.

---

## F. Selector semantics, and whether SHOW ME's ordering can carry them

**Traced, not assumed** — `orderRows` in `execute.ts`:

| Property | Evidence |
|---|---|
| ordering runs on **governed** cells | it sorts `GovernedRow[]` reading `cells[ref].visibility`, *after* governance |
| a hidden value cannot move a row up | a `SUPPRESSED` cell sorts **last regardless of direction**, deliberately: "inventing one for sorting would leak that a value exists" |
| the order is **total** | `pursuit.id asc` is always the final key, so two executions of one plan cannot differ |
| "first" is the first of the whole authorized set | `orderRows` runs first; `plan.limit` slices **after** |
| existence-unauthorized objects are absent entirely | omitted before rows exist, so they cannot shift an ordinal |

So `select: "first"` is well-defined, canonical, stable, and **derived only from what the recipient may
see**. A row whose metric is withheld can never become "first" by virtue of the hidden value; it sorts
last. The selector therefore satisfies §15's requirement that no hidden candidate influences downstream
identity selection.

**Recommendation: exactly one selector in Slice 8 — `"first"`** (the first governed row of the ordered
authorized result). Not `ordinal: N`: an integer invites arbitrary N, and N > 0 is a different
capability with its own disclosure question (it lets a caller walk the set). `"first"` is a *word* in a
closed vocabulary, and widening it later is a reviewed change rather than a parameter.

**No new ranking semantics are invented.** The selector consumes the ordering the plan already declares
and Slice 1 already certified.

---

## G. The graph model

A closed DAG over **registered component nodes** with **identity edges only**.

Validated whole, before any execution, rejecting: cycles · self-reference · unknown component reference
· a reference to a component not present in this surface · downstream-to-upstream back-edges · a
reference to a component that does not export identity · a result-value reference · a rendered-text
reference · a route/path reference · an ambiguous or unregistered selector · **depth > 1**.

**No generic expression language. No JSONPath/JMESPath/templating.** The only "expression" is a pair of
closed enumerated values.

Depth is bounded structurally rather than by a counter: **only a component whose registry entry declares
`exportsIdentity` may be referenced, and no component that *consumes* identity declares it.** A second
level is therefore unrepresentable in Slice 8, not merely unreached.

---

## H. Registry declarations — capabilities are declared, never inferred

| Component | operation | exportsIdentity | acceptsContextIdentity | acceptsComponentIdentity |
|---|---|---|---|---|
| `pursuit.list` | SHOW_ME | **yes** | no | no |
| `pursuit.cohort` | ANALYZE | **no** | no | no |
| `pursuit.explanation` | EXPLAIN | no | yes (Slice 7) | **yes** |
| `pursuit.destination` | GO_TO | no | yes (Slice 7) | **yes** |

Nothing is inferred from a component's name. **ANALYZE exports nothing**, so no component can consume an
aggregate's output — and because the flag is what validation reads, that is enforced rather than hoped.

---

## I. Execution order, and sibling independence

After complete graph validation: execute in **deterministic topological order**, with the existing
`pursuit.id`-style total order as the tiebreak among independent nodes so the plan is reproducible.

`SHOW_ME` executes before `EXPLAIN` and `GO_TO`. **The two siblings do not depend on one another**, and
their relative execution order must not alter the final governed result — provable because each receives
the same immutable handle and neither writes anything.

---

## J. Downstream governance stays live

> **Upstream visibility is not downstream authorization.**

The component-binding analogue of Slice 7's *manifest membership is identity binding, not durable
authorization*. A handle identifies a **candidate**. Each downstream component still executes through
its existing certified boundary — `executePursuitQuery(explainPlanFor(id))` and `resolveGoTo(...)` —
under the current `ExecutionPrincipal`. The handle carries no authorization decision and no field that
could be mistaken for one.

## K. Mid-graph governance change, and the failure contract

Upstream executes and exports a handle; governance moves; downstream executes. **Downstream governance
wins.**

**Recommended contract**, consistent with Slice 7 and reusing its disposition machinery unchanged:

- any required downstream component whose **target** is unavailable → the **complete surface** fails
  with the bare whole-surface governed outcome;
- upstream's result is **discarded at the recipient boundary** — it may have executed internally, but
  nothing was emitted, so there is nothing to retract (§N);
- an **application failure** anywhere in the graph stays `FAILED`, never a governed absence — the Slice 7
  clarification applies unchanged to graphs.

## L. Empty upstream result — a composition outcome, not a governance one

`SHOW_ME` returns zero governed rows while a downstream component expects a selection.

**Recommendation: a distinct deterministic outcome, `NO_SELECTABLE_RESULT`**, and *not*
`NOT_AVAILABLE`. Calling it governed target unavailability would assert something false: no target was
ever identified, so nothing "became undisclosable". Calling it `FAILED` would be equally wrong — an
empty authorized set is a certified, correct answer (Slices 1 and 3), not a defect.

It must never become an index error, a null UUID, a default pursuit, a nearest result or any fallback.

**Disclosure note:** it reveals that the upstream governed set was empty — which the `SHOW_ME` component
in the same surface would itself have rendered. It therefore discloses nothing the surface was not
already going to say. **The cost to accept:** under whole-surface atomicity the recipient loses the
legitimate certified empty-list rendering, and sees one sentence instead. The alternative — render
`SHOW_ME`'s empty state and omit the downstream components — is a **partial surface** and is refused.

## M. Execution and replay identity

Slice 7 recorded `surfaceSpecDigest` as a *post-compilation execution-identity* digest. A downstream
request is no longer compiled at compile time, so that digest cannot carry a component-derived identity.

**Recommendation: extend rather than redefine — three values, each with one job.**

| Digest | When | Covers |
|---|---|---|
| `surfaceSpecDigest` | compile | layout, ordered nodes, compiled binds where compilable, and the **edges and selectors** |
| `contextDigest` | compile | the recipient's pre-existing ordered manifest (unchanged) |
| `executionDigest` | execution | each handle's `resultDigest` + selector + resolved identity |

**A surface with no edges is byte-identical to Slice 7 today** — nothing is redefined; graphs simply
gain a third value. Replay identity is the triple.

Each handle binds the downstream request to the **exact governed result set that produced it** via
`resultDigest` (the existing `planDigest` plus the ordered governed ids). Within one execution the
upstream runs **once** and both siblings share one immutable handle, so a downstream bind cannot
silently retarget because ordering changed or a row appeared. Across executions nothing persists, so
there is nothing to retarget.

> **Same validated graph + same principal + same canonical/governance state → same upstream governed
> result → same selected handle → same downstream `SurfaceResult`.**

## N. Atomicity, unchanged in shape

No partial recipient output before the **entire** read-only graph is finalized. The graph may perform
several governed reads internally; none is emitted, streamed or flushed. If any required downstream
component fails, upstream content is discarded at the recipient boundary.

**This remains sound only because every component is read-only.** Execution-then-discard cannot make an
*action* atomic, which is why actions stay excluded and will need pre-execution transactional semantics
through P5.

## O. Hidden-data laundering — the threat model

| Attack | Closed by |
|---|---|
| an upstream hidden field becomes the downstream selector | the selector reads no cell; it takes the ordered governed set's first element |
| sort position leaks a hidden value | a `SUPPRESSED` cell sorts **last regardless of direction** (§F) — hidden values cannot promote a row |
| result count leaks suppressed candidates | existence-unauthorized objects are omitted before rows exist; `counts.authorized` describes the authorized set and says so |
| the handle reveals a raw id to the recipient | the handle is internal; nothing renders it, and GO TO's path is Slice 4's already-certified disclosure |
| downstream gains the whole upstream row | the downstream component receives a handle; there is no field on it for a row |
| a rendered account label is reparsed into identity | labels never round-trip: the handle carries the id directly, and the renderer resolves nothing |
| "explain the row with $X pipeline" | value-based selection is not in the selector vocabulary; the model can only name a registered selector |

Selection operates **only** over the already-governed, recipient-visible result set produced by the
certified upstream operation.

## P. Headless execution

```
SurfaceSpec → ValidatedSurfaceGraph → ExecutionPlan → governed results + identity handles
            → finalized SurfaceResult → React
```

The renderer may not pick a row, construct a downstream reference, resolve identity, decide governance
or repair a missing dependency. It consumes a finalized value, as in Slice 7.

## Q. The model boundary, and persistence

The **same** quarantined provider module. The model proposes the closed dependency structure **before**
execution and then exits. It never receives `SHOW ME` rows, the selected result, any canonical
identity, EXPLAIN output, a GO TO destination, or an execution error. **No second model call after
upstream execution. No "look at these results and decide which one."**

A hostile prompt such as *"show the pursuits, find the one with the largest amount, and explain it"*
must reduce to the permitted closed selector or refuse — never to value-based selection.

**Persistence: none.** No persisted handle, saved graph state, pinned selection, derived manifest row or
server-side identity cache. Every component-derived identity is ephemeral to one surface execution.

## S. Smallest implementation plan

```
surface/registry.ts    + exportsIdentity / acceptsContextIdentity / acceptsComponentIdentity
surface/graph.ts       + NEW: edge validation, acyclicity, depth, topological plan (pure)
surface/handle.ts      + NEW: ResultIdentityHandle and the closed selector (pure)
surface/schema.ts      + the dependency bind shape; NO_SELECTABLE_RESULT; executionDigest
surface/compile.ts     two-phase: validate whole graph; defer only the identity value
surface/assemble.ts    topological execution, handle export, unchanged atomic decision
intent/model.ts        the surface prompt/schema learns the closed dependency shape
page.tsx               presentation for a three-component surface; one new sentence
```

**No database schema. No new flag. No new route. No P5/P6 change. No new provider module.**

## T. Threat proofs the implementation gate must make

Graph validated before execution · cycle unrepresentable/refused · self-reference refused · unknown
dependency refused · depth-2 unrepresentable · result-value reference refused · rendered-text reference
refused · route reference refused · raw id refused · **ANALYZE cannot export identity** · a hidden row
cannot be selected · a withheld value cannot promote a row to "first" · zero-row upstream is
deterministic and non-fallback · the handle carries no recipient-visible canonical id and no row field ·
one handle feeds EXPLAIN and GO TO **independently** · sibling order does not change the result ·
downstream reruns governance · governance loss after upstream execution yields **no partial surface** ·
the model never receives the upstream result · the ephemeral manifest never reaches `toPrompt()` · one
component cannot inspect another's payload · replay without the model yields identical behaviour · no
writes, no persistence, no schema change.

**Negative controls for:** a selector that reads a governed cell · an edge to a non-exporting component
· a surviving sibling after downstream failure · a persisted handle · a second model call · treating
upstream visibility as downstream authority.

## U. Excluded, unchanged

Actions/P5 · persistence/pinning · arbitrary filters · **value-based selectors** · new metrics or
aggregates · cross-org surfaces · model-authored result prose · result-to-model loops · generic dataflow
expressions · **more than one dependency level**.

---

## R. Rulings (returned and recorded)

**R-A — selector semantics: APPROVED.** Exactly `select: "first"`, a closed registered selector —
**never** an ordinal 0, a numeric index, an arbitrary N, a sort expression or a predicate. It means
*the first selectable row in the already-governed, deterministically ordered result set of an upstream
plan explicitly certified to export FIRST identity.* `"first"` is its own certified capability.

**R-B — component-derived identity: MODIFIED.** Reuse the certified `ContextRef` **resolution
semantics**, but do **not** model component-derived identity as an ordinary recipient
`ContextManifest`. **The distinction must be structural.** Introduce the smallest execution-only
abstraction — `DerivedIdentityContext` — that is ephemeral to one surface execution, holds one resolved
candidate identity, is provider-invisible, has **no `toPrompt()` capability**, cannot be appended to or
mutate the recipient manifest, cannot be persisted and confers no authority. It may use the same
low-level resolution machinery; **do not create a second resolution algorithm.** Where the unchanged
Slice 5 compiler needs `{fromContext:0}`, use a narrow deterministic adapter at the execution boundary.

> **Recipient context is available before composition. Derived identity is an execution artifact created
> after a governed upstream operation. They may share resolver mechanics; they are not the same
> semantic object.**

**A structural guard is required** proving the provider-facing path *cannot accept* the derived type —
not merely a test asserting we remembered not to call `toPrompt()`.

**R-C — dependency shape: APPROVED.** `subject: { fromComponent: <ComponentKey>, select: "first" }`.
Validation must prove **before execution**: the referenced component exists · is **upstream** · is
registry-permitted to export identity · the target accepts component-derived identity · the selector is
allowed **for that exact upstream plan** · depth ≤ 1 · no cycle or self-reference · no arbitrary field,
result or path reference. **Future caveat recorded:** if repeated component types are ever permitted,
`ComponentKey` ceases to be sufficient graph-node identity and an explicit node identifier needs its own
ruling. **Node ids are not pre-added now.**

**R-D — zero-row semantics: APPROVED.** `NO_SELECTABLE_RESULT` is a distinct deterministic
surface-level **composition** outcome: *the certified upstream governed result was valid, but contained
no row from which the registered selector could produce the required identity.* It is not
`NOT_AVAILABLE`, not `FAILED`, not zero-as-data and not an index failure. Upstream zero rows plus a
required `"first"` dependency → the **entire** surface returns the bare outcome. No fallback, no nearest
row, no previous context, no partial surface, and **nothing revealing internal component topology**.

**R-E — execution/replay identity: APPROVED WITH PRECISE DIGEST CONTENT.** `surfaceSpecDigest` and
`contextDigest` are preserved unchanged. Add `executionDigest` **only for dynamic component-derived
bindings**: a **domain-separated** deterministic digest over the ordered dynamic-binding facts —
upstream component execution identity, upstream governed result digest, selector key/version, the
resolved selected canonical identity, and the consumer binding identity needed to prevent ambiguous
reuse. The canonical identity **may participate inside the hash input** and **must not be serialized or
rendered** merely because it contributes. The digest is provenance and replay identity — **not
authority, not a bearer token, not a substitute for current governance.** Surfaces with no
component-derived edge keep their Slice 7 behaviour byte-for-byte. A later execution against changed
canonical state may legitimately select a different object and produce a different `executionDigest`;
Slice 8 does **not** persist the old handle to force historical retargeting.

**R-F — ordering/export safety: MODIFIED. NOT a universal SHOW ME invariant.** The traced properties are
sufficient for the plans evaluated, but a future `SHOW_ME` view gets **no** export capability merely by
returning pursuits.

> **Being a SHOW ME operation does not imply being a safe identity-export source. Identity export is an
> explicit certified registry capability.**

Identity export becomes a **per-plan registry capability, default OFF** — `identityExport: { selectors:
["first"] }` only on a plan whose ordering and disclosure contract has actually been certified. Slice 8
certifies **only** the `SHOW ME open pursuits` plan the first vertical needs. **No widening for
convenience.**

### Additional load-bearing rules recorded

1. **Selection consumes the final governed upstream result** the recipient's certified operation
   actually produced — never pre-governance candidates, pre-suppression rows, an unbounded hidden set,
   or values omitted from the recipient result. The resolver consumes **the same governed execution
   artifact** used to build the component result; it never reruns a broader query to find an identity.
2. **Handle contents:** only the identity capability required to invoke a certified boundary. No
   pipeline value, account name, lifecycle state, arbitrary cell, sort value or raw payload.
3. **Downstream governance:** *upstream visibility is not downstream authorization.* The handle
   identifies a candidate; EXPLAIN and GO TO each traverse their certified path under the current
   principal.
4. **Mid-graph authority change:** upstream succeeds, a required downstream component becomes
   unavailable → the whole read-only surface fails atomically under Slice 7's contract; upstream output
   is discarded; nothing has streamed; the handle preserves no authority.
5. **Three outcomes stay distinct and are never collapsed:** `NO_SELECTABLE_RESULT` (valid governed
   upstream result, no selectable row) · `NOT_AVAILABLE` (a candidate exists, but a certified governed
   downstream target is not recipient-available) · `FAILED` (internal/programming/infrastructure
   invalidity, not governance).

## R. Decisions requiring a ruling

**R-A — selector semantics.** *Recommend exactly one: `select: "first"`* — the first governed row of the
ordered authorized result — expressed as a **closed word, not an integer**. `ordinal: N` invites
arbitrary N, and N > 0 is a distinct capability (it lets a caller walk the set) with its own disclosure
question. No ranking semantics are invented; the selector consumes the ordering the plan already
declares.

**R-B — ContextManifest reuse vs a distinct ephemeral abstraction.** *Recommend: reuse the certified
`ContextManifest` **type** and `resolveContextRef`, as a **distinct ephemeral execution-time instance**;
never extend, merge into or mutate the recipient's pre-existing manifest.* The downstream bind then
compiles through the **unchanged** Slice 5 compiler as `{fromContext: 0}` against that one-slot
manifest — no new resolution logic, no new request shape. Cost to accept: two manifest instances with
different provenance coexist in one execution and must not be confused; only the recipient's is ever
passed to `toPrompt()`, and a suite must prove it.

**R-C — the SurfaceSpec dependency shape.** *Recommend `subject: { fromComponent: <ComponentKey>,
select: "first" }`*, referencing by **component key** because one-component-per-type already makes it a
unique closed namespace — introducing no new identifier space and nothing shaped like a row index.
**Record the caveat:** if a later slice permits repeated component types, this reference must gain an
explicit node id.

**R-D — zero-row / missing-selection semantics.** *Recommend a distinct `NO_SELECTABLE_RESULT`*, whole-
surface, never `NOT_AVAILABLE` (nothing became undisclosable) and never `FAILED` (an empty authorized
set is a certified correct answer). **The cost you are ruling on:** under atomicity the recipient loses
the legitimate certified empty-list rendering and sees one sentence instead; the alternative is a
partial surface.

**R-E — execution and replay identity.** *Recommend extending, not redefining:* keep
`surfaceSpecDigest` and `contextDigest` exactly as certified, and add an execution-time
`executionDigest` over each handle's `resultDigest` + selector + resolved identity. **A surface with no
edges stays byte-identical to Slice 7.** Replay identity becomes the triple.

**R-F — is SHOW ME's ordering safe enough to carry the first selector?** *Answer: yes, and it was traced
rather than assumed.* Ordering runs on **governed** cells after governance; a `SUPPRESSED` cell sorts
**last regardless of direction** by explicit design; `pursuit.id asc` is always the final key so the
order is **total**; and `limit` is applied **after** ordering, so "first" is the first of the whole
authorized set. **No widening of ordering semantics is requested.** The one property I want confirmed
rather than assumed: that this disclosure contract is intended to hold for *any* view a future
`SHOW_ME` component may bind, not only the three registered today.

---

## V. Implementation status — LOCALLY IMPLEMENTED AND PROVEN (hosted acceptance NOT authorized)

**Evidence.** `p7-slice8` **33/33** · unit **715/715** · `p7-slice1` **66/66** (seeded clone) · tsc and
`next build` clean · `certify-world` **52 suites clean, no drift** (`c9004670ffda112f`). All seven ruled
negative controls bite, three of them **on the checkers themselves** (a broader candidate source, a
dropped governed-result guard, and a handle that skips downstream execution are each constructed in
memory and confirmed caught).

**No database schema. No new flag. No new route. No P5/P6 change. No new provider module. No persistence.**

| Module | Change |
|---|---|
| `intent/schema.ts` | `ResolutionContext` split out; `ContextManifest` gains `origin: "RECIPIENT"` |
| `intent/context.ts` | `toPrompt` refuses non-recipient context at runtime; the resolver takes `ResolutionContext` |
| `intent/compile.ts` | consumes `ResolutionContext` — **one** resolution algorithm, not two |
| `plans.ts` | `SELECTOR_KEYS`; per-plan `identityExport`, declared **only** on `open-by-value` |
| `surface/identity.ts` | **new, pure** — `DerivedIdentityContext`, `selectIdentity`, the adapter, `executionDigest` |
| `surface/registry.ts` | `exportsIdentity` / `acceptsContextIdentity` / `acceptsComponentIdentity` |
| `surface/schema.ts` | `ComponentDependency`; the STATIC/DYNAMIC node union; `NO_SELECTABLE_RESULT` |
| `surface/compile.ts` | edge validation, upstream-only references, per-plan export check, dry-run |
| `surface/assemble.ts` | topological execution, identity export, `executionDigest` |
| `intent/model.ts` | the same quarantined module; the closed dependency shape |
| `page.tsx` | one new sentence; the renderer still resolves nothing |

**The structural guard (ruling B) is real, not a convention.** `DerivedIdentityContext` has no `slots`,
so it is **not assignable** to `toPrompt` — the compiler refuses it. `toPrompt` *also* checks `origin`
at runtime, so the guard survives a caller arriving through untyped JSON. Both halves are proven, and
the recipient manifest passes as a negative control so the check discriminates.

**Depth is bounded structurally, not counted.** No component both exports and consumes identity, so a
second level is unrepresentable rather than merely unreached — proven by a registry-wide assertion
instead of a depth test on one example.

**Cycles are refused by construction.** A dependency may only name a component validated **above** it,
so array order *is* topological order and a forward reference — hence any cycle — is refused during the
single validation pass, with no separate cycle search to keep correct.

**Compile-time validation stays total.** A dependent bind is dry-run through the certified
`compileIntent` against a sentinel one-slot context, so a malformed dependent bind (bad surface key,
wrong operation, unknown field) is refused **before** anything executes. The dry run's output is
discarded — only its success is consulted — and a suite proves the sentinel identity appears in no
validated node and no executed request.

**Four defects of my own, caught and fixed before the recorded run** — none tuned away:

- two Slice 6/7 structural assertions that Slice 8 legitimately supersedes were **rewritten, not
  deleted**: the "assembler threads NOTHING between components" check now asserts the sharper property
  it was protecting — *only identity flows; never a result, row or payload*, with the assembler proven
  to read no governed cell and to pass the narrow adapter rather than a result;
- a whole-file scan for fallback substitution tripped on `def.fallbackLabel` — the certified Slice 4
  **label** rule, which is not an identity fallback. Scoped to `selectIdentity`, with the label rule
  asserted still present as the control;
- **§16A again** — an assertion that the prompt offers no value-based selection tripped on the prompt
  rule that *forbids* one, which has to say "largest" in order to refuse it. What the model may emit is
  decided by the schema, so the enum is asserted instead of the prose;
- a test-only cast that `tsc --noEmit` accepted but the full build rejected.
