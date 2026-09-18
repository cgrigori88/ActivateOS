# P7 Slice 6 — Dynamic Pursuit Surfaces: contract and plan

**Status:** **PLAN ONLY — NOT AUTHORIZED FOR IMPLEMENTATION.** Decisions requiring a ruling are in §M.
**Builds on:** Slices 1–5, all HOSTED ACCEPTED / CLOSED (`cade340` · `a6dabbb` · `7ac8c7f` ·
`a1dad9f` · `a6257bc`).

> **THE INVARIANT: generated interfaces may compose PursuitOS. They may not redefine PursuitOS.**

```
user intent → model proposes SurfaceSpec → deterministic SurfaceSpec validation
            → registered P7 primitives → existing governed executions → deterministic assembly
```

**The model authors composition, not truth.** It may decide which registered components appear, how
they are arranged, which already-certified operations they bind to, and approved presentation
configuration. It may decide **nothing** about permissions, disclosure, principal or organization,
metrics, aggregate formulas, canonical field definitions, query semantics, write behaviour, action
authority or routing authority.

---

## 0. The existing flag, traced before anything was designed

`dynamic_surfaces` already exists and is **already fully wired**. No new flag is proposed, and its
dependency is not weakened.

```ts
// src/lib/env/vnext-flags.ts
export function vnextCapabilities(tenant: TenantFeatureView): VNextCapabilityView {
  const controlPlane = vnextEnvEnabled("control_plane");
  if (!tenant.experience) return { ...OFF, controlPlane };        // ← tenant gate, all-off early return
  …
  const pursuitIntelligence = vnextEnvEnabled("pursuit_intelligence") && pursuitState && pursuitMemory;
  const dynamicSurfaces     = vnextEnvEnabled("dynamic_surfaces") && pursuitIntelligence;
}
```

**The exact conjunction, expanded.** `dynamicSurfaces` is true only when **all nine** hold:

| Layer | Requirement |
|---|---|
| tenant (`org_features`) | `pursuits` ∧ `facts` ∧ `routing` ∧ `pursuit_experience` — this is `tenant.experience`, and without it the function returns all-off before any env var is read |
| deployment (env) | `VNEXT_DYNAMIC_SURFACES_ENABLED` ∧ `VNEXT_PURSUIT_INTELLIGENCE_ENABLED` ∧ `VNEXT_PURSUIT_STATE_ENABLED` ∧ `VNEXT_PURSUIT_MEMORY_ENABLED` |

`vnextEnvEnabled` uses the same closed TRUE set as every other master — `true`, `1`, `on`, `yes`,
trimmed and case-insensitive — and defaults **OFF** (`?? ""`). There are **no** current call sites for
`dynamicSurfaces` beyond the capability view itself: it is declared, reserved, and unused.

**Answering the ruling's question — is tenant-level Pursuit Experience entitlement independently
required?** **Yes, and it already is**, twice over and by two different mechanisms:

1. `vnextCapabilities` returns all-off unless `tenant.experience`, which is the conjunction of four
   `org_features` columns; and
2. every component executes through `executePursuitQuery`, which independently calls
   `experienceEnabledFor(db, orgId)` inside the governed path — the check Slice 1 ruling 1 established
   and that a hosted gate has proven denies even with the env master on.

**So the full Slice 6 conjunction is the flag conjunction AND P7's own gates**, and when the spec is
model-authored, Slice 5's as well:

```
tenant.experience  ∧  VNEXT_DYNAMIC_SURFACES_ENABLED  ∧  VNEXT_PURSUIT_INTELLIGENCE_ENABLED
                   ∧  VNEXT_PURSUIT_STATE_ENABLED     ∧  VNEXT_PURSUIT_MEMORY_ENABLED
                   ∧  pursuitExperienceEnabled()      ∧  experienceEnabledFor(db, orgId)
                   ∧  [ model-authored only: PURSUIT_INTENT_ENABLED ∧ scoped credential ]
```

**One honest observation, returned for ruling (§M decision 1).** The declared reason for the
intelligence dependency is *"dynamic surfaces require intelligence, since they compose its outputs."*
The first vertical composes **P7** outputs, not pursuit-intelligence outputs — so the dependency is
stricter than this slice strictly needs. It is **kept unchanged**: weakening a declared dependency to
make a slice easier to certify is exactly the move the ruling forbids, and the flag's meaning is a
product decision rather than a certification convenience.

---

## A. What a SurfaceSpec is

> **A versioned, closed, declarative value — and its component bindings are *already-certified
> Slice 5 proposals*. Composition introduces no new grammar.**

```ts
type LayoutKey    = "stack" | "grid";          // closed, presentation only (§E)
type ComponentKey = "pursuit.list" | "pursuit.cohort";   // closed registry (§B)

interface ComponentSpec {
  component: ComponentKey;
  /** EXACTLY the Slice 5 ModelProposal payload for the operation this component is backed by. */
  bind: ModelProposal;
}

interface SurfaceSpec {
  specVersion: 1;
  layout: LayoutKey;
  components: ComponentSpec[];      // 1..MAX_COMPONENTS, closed cardinality
}
```

**The decisive choice: `bind` is a `ModelProposal`.** A component does not describe a query — it names
an operation the deterministic compiler already validates. Composition is therefore *layout + an
ordered list of proposals*, and `compileSurface()` is `validate(layout) + components.map(compileIntent)`.
Everything Slice 5 made unrepresentable stays unrepresentable, for free: no SQL, no table or column
name, no raw URL, no model-supplied UUID, no filter, no metric definition, no `asOf`, no organization,
no permission, no authority, no executable code. **There is no second grammar to audit.**

---

## B. The Surface Component Registry

> **Tiny, closed, and backed only by already-certified P7 primitives.**

```ts
interface ComponentDef {
  key: ComponentKey;
  /** The certified operation this component is allowed to bind. */
  operation: IntentOperation;
  /** Registry-owned title (§F). Never model prose. */
  title: string;
}
export const COMPONENTS: Record<ComponentKey, ComponentDef> = {
  "pursuit.list":   { key: "pursuit.list",   operation: "SHOW_ME", title: "Pursuits" },
  "pursuit.cohort": { key: "pursuit.cohort", operation: "ANALYZE", title: "Cohort total" },
};
```

Slice 6 registers **two**. `EXPLAIN` and `GO_TO` components are deliberately deferred (§L). A component
is added by a reviewed code change, never because a model asked for one, and a component whose
`operation` does not match its binding is a hard validation failure.

---

## C. Where execution happens

> **Surface components consume governed P7 outputs. They do not become new readers.**

The surface renderer issues **no query of its own**. Each component's binding compiles to a
`CompiledIntent` and executes through `runCompiledIntent` — the Slice 5 function that already
delegates to `executePursuitQuery` and `resolveGoTo`. So Slice 6 adds **no new read path**, and every
P6 decision is made exactly where it is made today.

This is the same discipline as Slice 4's GO TO (no dedicated loader) and Slice 3's ANALYZE (delegate
to the registered metric): the new layer composes, and the composition cannot widen anything because
it holds no database handle.

---

## D. Does the model see result data?

> **No. The SurfaceSpec is proposed BEFORE any execution, exactly as Slice 5 proposes an intent.**

The model receives: the user's intent, the component vocabulary, the layout vocabulary, the certified
operation vocabulary, and the recipient-safe `ContextManifest` where a binding needs it. It receives
**no** `GovernedResultSet`, no aggregate value, no explanation, no row, no count.

This is not merely conservative — proposing after execution would create a **new result-to-model
disclosure channel** that Slices 1–5 do not have, and it would have to answer what a model may infer
from a withheld aggregate or a suppressed cell before it could be certified. Slice 6 does not open it.
*The contract does not recommend otherwise.*

---

## E. Layout

A closed vocabulary — `stack` and `grid` for the first slice — carrying **presentation only**. Layout
cannot alter data scope, filtering, metric semantics, authorization or disclosure, and this is
structural rather than promised: layout is not an input to `compileIntent` and never reaches
`executePursuitQuery`. A proof asserts that permuting layout and component order leaves every
component's governed output byte-identical.

No sizes, no spans, no per-component style object, no CSS: a configuration field is a place to smuggle
one, and the first slice offers none.

---

## F. Labels and titles

| Text | Owner |
|---|---|
| component title | **registry** (`ComponentDef.title`) |
| what the component ran | **deterministic template** — Slice 5's `interpretedAs`, composed from registry metadata |
| everything else | **nothing** — there is no model-authored text on the surface |

Slice 6 keeps Slice 5's rule exactly: **no model-authored prose anywhere near a governed result.** A
`SurfaceSpec` has no `title`, `caption`, `description` or `summary` field, so arbitrary prose cannot
sit beside a governed number even by accident.

---

## G. Object references

Unchanged from Slice 5 (ruling 2): `{ fromContext: n }` against an immutable, digested
`ContextManifest` built **before** the model call from rows this principal's own governed execution
returned. **The model gains no UUID access because its output is now a surface specification.** The
first vertical's two components take no context reference at all (§L), so the question does not even
arise until the slice that adds `EXPLAIN`/`GO_TO` components.

---

## H. When a component is unavailable

> **WHOLE-SPEC ATOMICITY: if any component fails deterministic validation, the entire SurfaceSpec is
> rejected and NO component executes.**

This is the safe answer to the disclosure trap the ruling names. The dangerous design is *generate the
full surface, then remove the panels the principal may not see* — because the **gap itself** discloses
that something exists. Slice 6 never builds a surface it then edits: validation is total and precedes
all execution, which is the same "never built, so there is nothing to redact" shape as Slice 2's
omitted statements and Slice 3's cohort membership.

Two cases must not be confused:

- **A component that cannot be validated** (unknown key, unknown view, mismatched operation, an
  unresolvable context reference) → **the whole spec is rejected.** Nothing runs. The recipient sees
  one deterministic refusal, identical whatever the cause.
- **A component that validates and whose governed execution withholds** — an empty authorized cohort,
  a WITHHELD aggregate, an explanation with a WITHHELD statement → **renders normally, in its already
  certified form.** That is not unavailability; that is governance working, and Slices 2–3 already
  certified exactly what those surfaces say.

**Per-component degradation is explicitly deferred.** It is the right design once components can bind
context references, and it needs its own disclosure analysis: whether a missing panel reveals hidden
existence depends on whether its absence is distinguishable from a spec the model never proposed.

---

## I. Reproducibility

```ts
interface SurfaceProvenance {
  specVersion: 1;
  surfaceSpecDigest: string;     // sha256 of the VALIDATED spec (layout + ordered bindings)
  componentRegistryDigest: string;
  vocabularyDigest: string;      // Slice 5's, unchanged
  contextDigest: string;         // Slice 5's, unchanged
  compilerVersion: string;
  source: "HAND_AUTHORED" | "MODEL";
  modelId: string | null;        // null unless a model actually ran (Slice 5's honesty rule)
  promptTemplateVersion: string | null;
}
```

Same validated spec + same principal + same canonical state → the same governed surface, modulo the
clock-derived values CFR-1.2 already classifies. Provenance is **recorded, never rendered** — the
Stage B1 shape, unchanged.

---

## J. Persistence

> **Nothing. Slice 6 persists no SurfaceSpec, no digest and no render.**

The surface is **ephemeral and regenerated from canonical state**. The response carries its validated
spec and provenance so the render is replayable within the request, and nothing reaches the database.
Pinning remains a later slice with its own contract — *a saved question is safe; a saved answer is
not*, the reasoning recorded in Slice 3 §A.

---

## K. Headless

```
ValidatedSurfaceSpec → assembleSurface(principal) → SurfaceResult
```

```ts
interface SurfaceResult {
  spec: SurfaceSpec;
  layout: LayoutKey;
  components: {
    component: ComponentKey;
    title: string;                 // registry-owned
    interpretedAs: string;         // deterministic, registry-composed
    outcome: IntentExecution;      // the ALREADY-GOVERNED Slice 1–4 output
  }[];
  provenance: SurfaceProvenance;
}
```

No React, no HTML, no framework type. The web renderer consumes `SurfaceResult`; an API, MCP, Slack or
Teams adapter consumes the same value and **reproduces no composition or governance logic** — the
property Slice 4 §E made structural and that holds here for the same reason: an adapter receives a
value, not a query, and holds no database handle.

---

## L. The smallest first vertical

**Agreed with the stated preference, and for a reason worth stating:** one ephemeral surface with
exactly two components — `pursuit.list` (SHOW ME, `open-by-value`) and `pursuit.cohort` (ANALYZE,
`open-pipeline-cohort`) — over the same already-certified single-organization governed world.

It exercises everything Slice 6 is actually about: closed component registry, binding to certified
operations, layout vocabulary, ordering independence, whole-spec atomicity, registry-owned titles,
spec digest and provenance, and headless assembly. It introduces **no** context-reference binding, so
composition and `ContextManifest` resolution are proven separately rather than together — and the one
genuinely new risk in a context-bound component (*one component's reference resolving against another
component's result*) does not exist yet because no component produces a manifest.

Adding `EXPLAIN`/`GO_TO` components would exercise no additional *composition* architecture while
adding a disclosure surface that needs §H's deferred per-component analysis first.

```
src/lib/experience/surface/schema.ts      SurfaceSpec, ComponentSpec, SurfaceResult, SurfaceProvenance
src/lib/experience/surface/registry.ts    COMPONENTS (2), LAYOUTS (2), MAX_COMPONENTS, digests
src/lib/experience/surface/compile.ts     PURE: unknown → ValidatedSurfaceSpec | rejection (delegates to compileIntent)
src/lib/experience/surface/assemble.ts    ValidatedSurfaceSpec → SurfaceResult (delegates to runCompiledIntent)
src/lib/experience/intent/model.ts        + ONE prompt/schema for SurfaceSpec — the SAME quarantined boundary
src/app/experience/pursuits/page.tsx      transport: ?surface=<spec> and ?compose=<utterance>
tests/p7-slice6.test.ts                   the threat model, on hand-authored specs
scripts/p7-slice1-verify.ts               + governed-fixture proofs
```

No new flag, no schema, no migration, no new route, no P5/P6 change, and **exactly one module may
still call a model** — the standing guard adopted in Slice 5 stays true.

---

## Required threat proofs

| # | Test |
|---|---|
| 1 | the model cannot invent a component type |
| 2 | the model cannot invent a metric or aggregate |
| 3 | the model cannot inject an arbitrary query |
| 4 | the model cannot select an organization or principal |
| 5 | the model cannot insert a UUID |
| 6 | the model cannot construct an arbitrary route |
| 7 | filters cannot be smuggled through layout or component configuration |
| 8 | component order and layout cannot alter execution semantics |
| 9 | one component cannot consume another's hidden or raw data |
| 10 | suppressed data cannot leak through component count, titles, empty placeholders or layout gaps |
| 11 | a rejected component cannot silently downgrade to a broader component |
| 12 | **no component executes before the full SurfaceSpec passes validation** |
| 13 | the same validated spec produces the same registered execution graph |
| 14 | removing the model and replaying the spec produces the same surface |
| 15 | no Dynamic Surface creates canonical business state |
| 16 | the full flag conjunction denies — including each env master individually, and the tenant entitlement |

Gate quality per §16A–D: semantic and observable assertions; evidence existence and shape before any
semantic PASS; atomic security assertions; **assertions scoped to the component's own result region**,
with the app-shell control asserted explicitly. Negative controls must show the suite fails when
component-registry validation, authority isolation, or spec binding is deliberately broken.

---

## M. Architectural decisions requiring a ruling

1. **Keep the `pursuitIntelligence` dependency the first vertical does not use?** *Recommend: yes,
   unchanged.* The declared meaning of the flag is that dynamic surfaces compose intelligence outputs;
   this vertical composes P7 outputs, so the gate is stricter than needed. Weakening it would be
   exactly the certification convenience the ruling forbids — but it does mean Slice 6 cannot be
   demonstrated without three intelligence masters on, and that is a product decision, not mine.
2. **`bind` is a Slice 5 `ModelProposal`.** *Recommend: yes.* Composition then introduces no new
   grammar and inherits every Slice 5 impossibility. The cost: a component can only ever bind what
   Slice 5 can express, so a future component needing something else forces a Slice 5 change first —
   which is arguably the correct coupling, but it is a coupling.
3. **Whole-spec atomicity vs per-component degradation (§H).** *Recommend: whole-spec atomicity* for
   Slice 6 — no partial surface is ever built, so no gap can disclose. The cost is brittleness: one
   bad component loses the whole surface. Per-component degradation is deferred to the slice that adds
   context-bound components, where it needs its own disclosure analysis.
4. **Component cardinality and repetition.** *Recommend: `MAX_COMPONENTS = 4`, repetition allowed.*
   A cap bounds fan-out (each component is a governed execution) and repetition is harmless because
   every component executes independently from canonical state. Ruling needed on whether repetition
   should instead be refused as probable model error.
5. **Transport shape.** *Recommend: `?surface=<spec>` (hand-authored, the Stage-A-equivalent proof
   path) and `?compose=<utterance>` (model-authored), on the existing route* — no new route, matching
   Slices 4 and 5. The hand-authored path is what makes the deterministic assembler certifiable with
   the model master off.
6. **Does the surface disclose its own composition?** *Recommend: yes* — each component renders its
   registry title and its deterministic `interpretedAs`, so a user can see **which certified
   operations were composed**, exactly as Slice 5 ruling 8 requires for a single operation. Ruling
   needed on whether the *spec digest* should also be shown (recommend **no** — it is provenance, and
   Stage A certified provenance is recorded rather than rendered).
7. **Where the model call lives.** *Recommend: the same quarantined `intent/model.ts`*, with a second
   prompt and schema, so "exactly one module may reach a provider" remains literally true and the
   existing structural guard keeps covering it. The alternative — a `surface/model.ts` — reads more
   cleanly and weakens a guard that has already caught things.

---

## What this plan does not authorize

No actions or P5 execution · no writes · no pinning · no persistence · no exports · no historical
`asOf` · no arbitrary filters · no new metrics · no new aggregates · no cross-org ranking · no
multi-row EXPLAIN · no new schema · no P5/P6 changes · no new flag · no model-authored prose · no
model-supplied identifier, route, organization or authority · no component added because a model asked
for one · no surface that is built and then redacted.
