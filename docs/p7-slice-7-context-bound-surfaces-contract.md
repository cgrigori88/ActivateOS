# P7 Slice 7 — context-bound Dynamic Surfaces: contract and plan

**Status:** **HOSTED ACCEPTED / CLOSED** (serving `1afcef1`, migrations 113, **106/0 hosted** with a live
model, 0 of 160 fingerprints moved). *A generated surface may bind to an already-governed context
object. It may not discover, manufacture or inherit identity or authority from another component.*
The rulings as returned are recorded verbatim in §R.
**Builds on:** Slices 1–6 and D-HIST-2, all HOSTED ACCEPTED / CLOSED.

> **A generated surface may bind to an already-governed context object. It may not discover,
> manufacture or inherit an object from another component's result.**

The architectural risk under test is **governed object identity inside a generated surface** — not
component-to-component dataflow, which stays deferred and is shown in §M to be *unrepresentable*.

---

## A. The first vertical

Exactly two unique components, both bound to **the same** pre-existing recipient-governed manifest slot:

```
recipient-safe ContextManifest
  → SurfaceSpec { layout, [ EXPLAIN {fromContext:n}, GO_TO {fromContext:n, surface:"canonical"} ] }
  → two INDEPENDENT certified bindings to the same slot
  → deterministic governed outputs
```

What it deliberately does **not** demonstrate: `SHOW ME` result → pick a row → `EXPLAIN` that row.
That is component-to-component binding and remains deferred.

---

## B. The Slice 5 ContextManifest is reused **unchanged** — the plumbing already exists

This is the finding that shapes the slice. Slice 6 already threads the full Slice 5 context contract
through the surface compiler; it is simply never exercised, because neither `SHOW_ME` nor `ANALYZE`
takes a `ContextRef`.

| Requirement | Already present |
|---|---|
| manifest reaches the surface compiler | `compileSurface({ spec, manifest, boundContextDigest, … })` |
| per-component binding | each `bind` is compiled by `compileIntent`, which resolves `{fromContext:n}` against that manifest and digest |
| built **before** the model call | the route builds `buildContextManifest(base.result.rows)` *then* calls `proposeSurface` |
| digest carried on the result | `SurfaceProvenance.contextDigest` |
| caller-stated binding | the route already accepts `?ctx=` and passes it as `boundContextDigest` |
| ids never reach the model | `toPrompt()` exposes labels and a count only |

So Slice 7 adds **no second context model, no new transport and no new digest contract**. Adding the
two components lights up a path that is already wired and already certified at the `compileIntent`
level (Slice 5), and already fails the whole spec on any non-compiling component (Slice 6).

**Empty context is already handled:** `compileIntent` returns `NEEDS_CLARIFICATION(subject)` when the
manifest is empty, and `compileSurface` rejects the whole spec on any non-`ok` component. A surface
that names a slot which does not exist therefore cannot half-exist.

---

## C. Context is established before composition

The manifest is built from a governed read for the current principal, before the model is called. The
model may **select among** recipient-safe slots. It may not add a slot, discover another pursuit,
derive an identifier, ask `SHOW ME` to populate context, consume another component's output, or turn
a displayed label into authority.

> **Context may flow into components. Component results may not flow back into context.**

Structurally: `assembleSurface` iterates `validated.components` and pushes one entry built from `c`
alone; nothing is threaded between iterations, and the manifest is an input to compilation that
execution never rewrites.

---

## D. Manifest binding, and the digest relationship

Already true, inherited from Slice 5 and proven there:

| Property | Mechanism |
|---|---|
| reorder changes binding | the manifest digest covers **ordered** slots *and* their canonical ids |
| slot identity change changes binding | same — substituting an id changes the digest |
| stale digest refuses | `resolveContextRef` returns null on digest mismatch → component fails → whole spec fails |
| out-of-range / negative / non-integer refuses | `resolveContextRef` returns null |
| a raw id cannot substitute for a slot | `ContextRef` has only `fromContext`; unknown keys are rejected |

**The digest relationship (decision R-A).** Today `surfaceSpecDigest` is computed over the layout and
the ordered **compiled** requests. For a context-bound component the compiled request is
`{ subjectId: <canonical id> }`, so the spec digest is *already* identity-sensitive: two manifests with
identical labels but different canonical objects produce **different** spec digests. §N's requirement
is therefore satisfied without changing anything.

**Recommended replay identity:** the **pair** `(surfaceSpecDigest, contextDigest)`, held separately
rather than folded into one hash — see §R-A for the alternative and its cost.

---

## E. Authority is live at execution, never cached

Manifest construction is **not** authorization. Every `EXPLAIN` and `GO_TO` execution traverses its
existing certified boundary — `executePursuitQuery(explainPlanFor(id))` and `resolveGoTo(request)` —
under the current `ExecutionPrincipal`, with P6 deciding afresh.

Nothing about authorization is stored in the `SurfaceSpec`, and possession of a slot confers nothing.

> **Context identifies a candidate object; current governance decides whether anything may be
> disclosed or done with it.**

---

## F. Mid-flight governance change — the whole-surface failure contract

The new case Slice 6 never had: the spec **compiles**, then governance changes before execution.

**Recommended contract (decision R-B).** Two outcomes and no third:

1. **Every context-bound component's target is available** → the surface renders in full.
2. **Any context-bound component's target is unavailable** → **the entire surface fails**, with one
   deterministic recipient-facing result, identical whatever the cause.

The single failure wording must not distinguish *revoked* · *became undisclosable* · *disappeared* ·
*never existed* — the indistinguishability Slice 4 ruling 7 already established for `NOT_AVAILABLE`.

**No surviving GO TO beside a failed EXPLAIN. No surviving EXPLAIN beside a failed GO TO. No
placeholder naming which component failed. No gap where a card would have been.**

**The distinction that must be preserved** — the same one Slice 6 drew at compile time:

| Situation | Outcome |
|---|---|
| target not available (`NOT_AVAILABLE`, no governed row) | **whole surface fails** |
| target available, but a *value* is withheld — a WITHHELD statement in an explanation, a governed cell suppressed | **renders normally**; that is governance working, already certified in Slice 2 |
| target available, destination unusable (`UNAVAILABLE_TARGET`) | **whole surface fails** (recommended — see §R-B; existence is authorized here, so acknowledging would be safe, but uniformity avoids reasoning per-absence) |

**Execution ordering note.** Components are executed and the all-or-nothing decision is taken at the
`SurfaceResult` boundary, *below the renderer*. Results are discarded server-side; nothing partial
reaches the recipient. The alternative — pre-checking the slot once, then executing — would duplicate
authority logic outside the certified boundaries and is rejected.

---

## G. EXISTENCE / WITHHELD, and the structural side channels

Preserved: `UNKNOWN` = no known authorized item · `WITHHELD` only where existence itself is
authorized · existence-undisclosable ⇒ **omission, no recipient-facing assertion at all**.

Dynamic Surface structure must create no new existence channel. Analysed:

| Structure | Risk | Why it is closed |
|---|---|---|
| component count | a card present ⇒ the object exists | whole-surface failure: the recipient sees **no cards at all**, not one |
| title | registry-owned (`Explanation`, `Go to`) — constant, never object-derived | Slice 6 ruling 6 |
| card shell / empty space | an empty shell ⇒ something was there | no shell is emitted on failure; the surface is replaced wholesale |
| loading state | a spinner that resolves to nothing ⇒ existence | the page is server-rendered; there is no per-component client state |
| unavailable state | "this component is unavailable" ⇒ existence | forbidden: one surface-level result only |
| navigation affordance | a link ⇒ the target exists | GO TO emits a path only on success, and on failure there is no surface |

---

## H. The EXPLAIN component

Calls the certified single-object EXPLAIN boundary. It may not create templates, introduce model
prose, perform arithmetic, use hidden values, or become multi-row EXPLAIN — `explainPlanFor` pins
`subject.ids` to exactly one, and validation refuses an explanation without exactly one subject.

The Dynamic Surface layer owns **placement and registered presentation only**.

## I. The GO TO component

Calls the certified GO TO boundary. It may not build a URL, accept a path or fragment, redirect
anywhere, or infer a destination from prose. The destination comes only from `DESTINATIONS` via
`pathFor()`, and the label stays governed by Slice 4 ruling 4. **Composition grants no routing
authority.**

## J. Component registry

Extend the existing registry from two entries to **four** certified types — `SHOW_ME`, `ANALYZE`,
`EXPLAIN`, `GO_TO`. Preserved unchanged: **one component per registered type**, `MAX_COMPONENTS = 4`,
no generic component type, no arbitrary component parameters.

**The first vertical uses only EXPLAIN + GO TO**, even though the registry knows all four.

## K. The model boundary

The same single quarantined module. For `?compose=` the model receives the utterance, the registered
component and layout vocabularies, and the recipient-safe manifest representation. It receives **no**
canonical id, hidden context field, component result, P6 denial reason, governed value or resolved
path. It still runs **before** execution. **No result-to-model loop.**

## L. The hand-authored path, and the headless result

`?surface=` remains the deterministic certification ingress and traverses the identical path:
*SurfaceSpec validation → Slice 5 proposal compilation → current governance → component execution →
SurfaceResult*. **Origin is invisible to execution; provenance may distinguish it.**

Context-bound failure is represented **in `SurfaceResult`**, before React. The renderer never decides
whether a target exists, whether a component should disappear, or whether a governed failure becomes
a placeholder.

## M. Component-to-component binding is already unrepresentable

`ComponentSpec` accepts exactly `{ component, bind }` — any other key rejects the whole spec. `bind`
is a `ModelProposal` whose keys are closed per operation, and `ContextRef` is `{ fromContext: number }`
resolved **only** against the pre-existing manifest. There is no field for a component index, a
component result, a row, a rendered value, or another component's path.

Nothing needs closing. A suite proof asserts it stays that way.

## N. Replay identity

> same validated `SurfaceSpec` + same **bound** `ContextManifest` + same principal + same
> canonical/governance state → same governed `SurfaceResult`.

A different manifest with the same visible labels but different canonical identities **does not**
qualify: the manifest digest covers ordered slots *and* ids, and — for context-bound components — the
spec digest carries the resolved identity too. **Model removability holds:** a captured spec replayed
through `?surface=` against the same bound manifest produces the same result.

---

## O. Smallest implementation plan

```
surface/registry.ts    + two ComponentDefs (EXPLAIN, GO_TO). No other field.
surface/schema.ts      + the surface-level failure outcome on SurfaceResult (§F)
surface/assemble.ts    all-or-nothing decision at the SurfaceResult boundary
intent/model.ts        the surface prompt/schema learns `subject` and `surface` (same quarantined module)
page.tsx               presentation only: render an Explanation and a NavigationTarget inside a card
tests/p7-slice7.test.ts + scripts/p7-slice1-verify.ts   the §P threat model
```

**No database schema. No new flag. No new route. No new context model. No P5/P6 change.**

## P. Threat proofs the implementation gate must make

model cannot invent a context slot · cannot emit a UUID · cannot retarget a valid spec by manifest
reordering · stale digest executes nothing · unauthorized and nonexistent remain
recipient-indistinguishable · governance lost between manifest creation and execution produces **no
partial surface** · EXPLAIN cannot feed GO TO · GO TO cannot feed EXPLAIN · SHOW ME/ANALYZE cannot
create context · arbitrary route/path impossible · context-bound components remain certified reads ·
removing the model leaves execution unchanged.

Gate quality per §16A–F, with negative controls for: a partial surface surviving a failed component,
a stale digest resolving, a raw id substituting for a slot, and a second provider-reaching module.

## Q. Scope — unchanged exclusions

No actions/P5 · no pinning or persistence · no component-to-component binding · no arbitrary filters ·
no new metrics or aggregates · no cross-org ranking or surfaces · no model-authored prose · no
historical `asOf` · no result-to-model loops · no multi-row EXPLAIN · no generic object discovery ·
no new schema.

---

## R. Rulings (returned and recorded)

### R-A — SurfaceSpec ↔ ContextManifest digest relationship — **APPROVED: change nothing**

`surfaceSpecDigest` hashes the **compiled** component requests; context-bound compiled requests
therefore incorporate the resolved canonical identity. `contextDigest` independently binds the ordered
manifest. **Replay identity is the pair `surfaceSpecDigest + contextDigest`.** The Slice 6 digest is
not redefined around raw `{fromContext:n}` for conceptual tidiness, and the digest is **not renamed**
in Slice 7.

**Recorded semantic clarification:**

> `surfaceSpecDigest` is a **post-compilation execution-identity digest**, not a hash of the raw
> submitted `SurfaceSpec`.

Consequences, intentional:

- two manifests with identical recipient-visible labels but different canonical identities produce
  **different execution identity**;
- manifest reorder/replacement is **additionally** bound by `contextDigest`;
- `SHOW_ME`/`ANALYZE` remain identity-**independent** where no object binding exists;
- `EXPLAIN`/`GO_TO` become identity-**sensitive** after context resolution.

**The asymmetry is intentional.**

**Disclosure constraint (load-bearing).** Canonical ids may participate **internally** in deterministic
compilation and digest computation, but the recipient-facing surface and provenance must still not
expose those ids merely because the digest was computed from them. **No raw resolved identifier is
newly serialized into recipient-visible provenance.**

### R-B — whole-surface failure semantics — **APPROVED, including both sub-decisions**

If **either** context-bound component cannot produce its certified available result, **the entire
surface fails** — one deterministic recipient-facing outcome covering all of: *revoked* · *became
undisclosable* · *disappeared* · *never existed* · **`UNAVAILABLE_TARGET`**.

The more informative standalone GO TO `UNAVAILABLE_TARGET` distinction is **not** preserved inside a
composed surface. **That is an intentional information reduction, not a governance violation.**

The recipient must not learn: which component failed · whether the target once existed · whether
governance changed · whether navigation specifically was unavailable. **No surviving sibling · no
placeholder · no empty card · no gap · no component-specific error · no component count difference.**

**Available target with withheld values is preserved unchanged:** target available + value legitimately
`WITHHELD` does **not** fail the surface; the component renders under its already-certified withheld
semantics. **The atomic rule is about target/component availability, not ordinary governed withholding
inside an otherwise valid component.**

**R-B2 — execute, then discard: APPROVED.** No new preflight layer duplicating P6/P7 target authority.
Each component calls its already-certified boundary under the current `ExecutionPrincipal`; the
headless assembler then returns either the complete valid `SurfaceResult` or the single whole-surface
unavailable result.

> **Transport invariant (load-bearing): no component result may be emitted, streamed, flushed,
> serialized to the recipient, or otherwise become recipient-observable until whole-surface success has
> been determined.**

Execute-then-discard is acceptable **because these components are read-only**. It does **not** authorize
partial streaming followed by retraction. **React must receive an already-finalized headless outcome.**

### R-C — Slice 5 ContextManifest reuse — **APPROVED UNCHANGED**

Reuse the certified `ContextManifest` structure, slot ordering, digest semantics, `boundContextDigest`,
`{fromContext:n}`, recipient-safe manifest representation and canonical resolution boundary. **No second
context abstraction · no new transport shape · no new context digest · no UUID exposure.** That Slice 6
already threaded this through `compileSurface()` is **accepted as the intended substrate**, not dead
code requiring redesign. Slice 7 simply begins exercising the existing path.

### R-D — required extensions — **APPROVED; not architectural widening**

1. **Component registry** — add exactly `EXPLAIN` and `GO_TO` to the closed registry, preserving
   `SHOW_ME`, `ANALYZE`, **one component per registered type** and `MAX_COMPONENTS = 4`. **No generic
   component.**
2. **`SurfaceResult`** — the smallest internal/headless discriminated failure outcome needed for atomic
   failure: an execution/result type, **not** a persisted or schema concept, closed and deterministic
   (`AVAILABLE` versus `NOT_AVAILABLE` in substance). **Internal P6/P7 denial reasons are not exposed
   through it.**
3. **The existing quarantined model module** — extend the surface prompt and strict output schema only
   enough for `EXPLAIN`/`GO_TO` binds to carry the already-certified Slice 5 subject/surface proposal
   shape. **No free-form subject · no raw id · no path · no arbitrary route · no second provider module.**
4. **Renderer** — deterministic presentation for the already-certified EXPLAIN result and GO TO target,
   consuming **headless results only**. The renderer may not reinterpret availability or governance, and
   may not independently hide or show a component.

**No database schema change. No `SurfaceSpec` schema change.**

---

## S. Invariants recorded by ruling

### Mid-flight governance

> **Manifest membership is identity binding, not durable authorization.**

A `ContextManifest` may identify the candidate object used by the compiled request; **current P6/P7
governance at component execution still determines what can be returned.** Therefore *manifest valid at
T1* does **not** imply *component authorized at T2*. **The `SurfaceSpec` contains no cached
authorization decision.**

### Context flow

> **Context may flow into components. Component results may not flow back into context.**

Slice 7 structurally rejects any shape attempting to reference a component index, a component result, a
component row, a component-produced label, a component-produced path, generated context, or another
component's identity. **The only object-bearing reference source is the pre-existing ContextManifest.**

### The first vertical

Exactly **EXPLAIN + GO TO**, bound independently to the **same** pre-existing context slot. No
`SHOW_ME → EXPLAIN` flow, no `SHOW_ME → GO_TO` flow, no result-selected row, no generated context.
**This slice proves governed identity reuse, not component dataflow.**

---

## T. Required local proofs before hosted acceptance

Same context slot feeds EXPLAIN and GO_TO independently · raw UUID unrepresentable · out-of-range /
negative / non-integer slot refuses **before execution** · stale `boundContextDigest` refuses **before
execution** · manifest reorder or identity replacement cannot silently retarget a replay · two manifests
with the same visible labels but different canonical identities produce different execution identity ·
governance loss after manifest creation yields **one** whole-surface failure · **no sibling survives** ·
**no partial bytes or component markup become recipient-visible before atomic success** · available
target + certified `WITHHELD` semantics still render normally · standalone `UNAVAILABLE_TARGET` inside a
surface collapses to whole-surface unavailable · EXPLAIN uses only the certified deterministic
explanation boundary · GO_TO uses only the certified destination registry · the model never sees a
resolved UUID, path or result · hand-authored and model-authored equivalent spec+manifest produce the
same governed `SurfaceResult` · no component-to-component reference is structurally representable · no
write, schema, P5 or P6 change.

**Negative controls required for:** bypassing context-digest binding · leaking one sibling before the
other fails · treating manifest possession as authorization · exposing a component-specific failure
reason · accepting a component-result reference as context.

**Canonical code is restored before the recorded run.** Hosted acceptance requires separate
authorization.

---

## U. Implementation status — LOCALLY IMPLEMENTED AND PROVEN (hosted acceptance NOT authorized)

**What changed.** Four registry entries instead of two; one new pure module
(`surface/availability.ts`); the assembler's atomic decision; the surface prompt/schema widened by the
already-certified Slice 5 subject/surface shape; renderer presentation for an explanation. **171 lines
added, 34 removed, mostly comment.** No database schema change, no `SurfaceSpec` change, no new flag,
no new route, no new context model, no P5/P6 change, no second provider module.

| Module | Change |
|---|---|
| `surface/registry.ts` | `pursuit.explanation` (EXPLAIN), `pursuit.destination` (GO_TO); `CONTEXT_BOUND_OPERATIONS` |
| `surface/availability.ts` | **new, pure** — `componentAvailability` and the whole-set `surfaceAvailability` reducer |
| `surface/assemble.ts` | execute all → one atomic decision → complete result or `NOT_AVAILABLE` |
| `surface/schema.ts` | the bare `{ ok: false; error: "NOT_AVAILABLE" }` variant |
| `surface/compile.ts` | version stamp; the execution-identity digest documented (no behaviour change) |
| `intent/model.ts` | the **same** quarantined module: surface prompt + strict schema widened |
| `page.tsx` | one failure sentence; explanation presentation |

**Two ruled shapes adopted over my own first draft.** The assembler executes every component and then
decides **once over the whole set**, which is ruling B2's own wording and makes the atomic rule a pure
total function rather than a loop invariant — so the dangerous states are constructed directly in the
suite instead of being simulated against a database that would have to be sabotaged to produce them.
And the rule is keyed on the certified **operation**, never the component key, so a component added
later inherits atomicity rather than escaping it by being named something else.

**Evidence.** `tests/p7-slice7.test.ts` **43/43** · unit **679/679** · `p7-slice1` **66/66** (seeded
clone) · `tsc` clean · `next build` clean · `certify-world` **52 suites clean, no drift**
(`c9004670ffda112f` before and after). All five ruled negative controls bite, including one **on the
checker itself**: the structural no-leak assertion is re-run against an in-memory mutation that adds
`detail: c.component` to the failure return, and fails — so it is not passing vacuously.

**One Slice 6 assertion was superseded, in one direction only.** It asserted a two-component registry
and that no EXPLAIN or GO TO component existed. Ruling D reverses that clause; what it was protecting
is kept and strengthened — the registry is closed, every entry's key matches its slot, each component
binds exactly one certified operation, and **no operation is registered twice**.

**Three defects of my own, caught and fixed before the recorded run** — none tuned away:

- a duplicate-component assertion expecting the wrong guard: two EXPLAINs on the **same** slot compile
  to byte-equal requests and are caught by canonical **identity**, not by the one-per-type rule. Both
  guards exist and are distinct, and the test now proves that rather than conflating them;
- **§16D again** — a whole-file scan asserting the route "renders no provenance" failed on
  `promptTemplateVersion`, which appears only as a compile **input**. The property belongs to the
  rendering region, so it is now asserted there, plus an explicit position check on the input;
- a test helper whose destructured default referenced its own initializer (`TS7022`) — invisible to a
  targeted `tsc` run and caught only by the full build.

**Not done, and deliberately:** no hosted deployment, no Preview change, no `?compose=` live-model run,
no Production contact. **Hosted acceptance requires separate authorization.**

---

## V. Hosted acceptance — 106/0 on `1afcef1`

**Posture.** Preview/demo only · serving commit proven `1afcef1` from the running deployment (full SHA
agrees) · ref `mejokqxriwyawfhawuxu` · `app_rw` · `bypassRls false` · `tenantEnforcement true` · sending
disarmed · `PURSUIT_INTENT_ENABLED=true` · scoped credential present · **global Anthropic credential
absent** · `INTERPRETER_ENABLED=false` · migrations **113 → 113** · **no Production contact**.

**The load-bearing results.**

- **H3 — manifest possession is not authority.** A bounded reversible governance change moved one
  pursuit out of the governed cohort; the **same bound spec no longer reached the same object**, and a
  pinned stale context executed nothing. Restored exactly.
- **H4 — atomicity, proven non-vacuously.** The identical first component was rendered **alone and
  successfully** first, so it was a genuine survivor candidate; with an unbindable sibling, **zero**
  components rendered — no title, path, statement, placeholder, gap or count.
- **H5 — no partial transport**, asserted on raw response **bytes**: no component markup, no
  serialized payload, no canonical path, no streaming boundary requiring retraction.
- **H12 — manifest, world, business and security hashes all identical** to the accepted post-0113
  baseline; **0 of 160 fingerprints moved**; policies, RLS, grants, functions and triggers identical.

**Two properties established rather than assumed.** The ContextManifest is drawn from exactly one
organization (**11/11 own-org**), so within a request the manifest and its components share **one**
governance evaluation — a slot cannot outlive its authority mid-request. Consequently a governed
**value-absence** inside a context-bound surface is **unreachable in this product configuration**: the
bounded fixture (a foreign-owned opportunity on an own pursuit) was correctly neutralised by RLS before
governance had to decide, leaving the derived metric unchanged. That branch rests on the unit proof,
not on a manufactured configuration.

**Five gate defects of my own, all caught and fixed before the recorded run** — the most serious being
that I asserted the capability posture of an organization that was **not the principal's**: the manifest
belongs to *Vertex Systems*, while I had keyed on *TD SYNNEX (demo)*, which owns zero pursuits. It
passed, but proved nothing it claimed. The principal's org is now derived from the governed context.
The others: a whole-file scan conflating a compile **input** with rendered output; two assertions
treating **caller echo in the URL** as application disclosure; and an H6 regex looking for the wrong
certified absence text.

**Recorded with this closure:**

> **Read-only composed surfaces may establish atomic recipient output after execution. Action-bearing
> surfaces will require pre-execution transactional/authorization semantics through P5.**

**Not begun, pending separate authorization:** component-to-component binding · actions/P5 surfaces ·
pinning/persistence · arbitrary filters · new metrics/aggregates · cross-org surfaces · model-authored
result prose · result-to-model loops.
