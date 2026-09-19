# P7 Slice 13 — Headless / interface-independent Pursuit Experience

**Status: LOCAL IMPLEMENTATION COMPLETE — awaiting hosted authorization.** No schema, no migration,
no alias movement, no P45, no hosted action. The certified Preview runtime remains `3449c56`.

**Sections 0–6 and "Decisions requiring ruling" below are the ORIGINAL DESIGN BRIEF, retained as
history** — they were written before implementation and say "no implementation" because that was
true when written. The rulings and what was actually built are recorded in the final section.

> **P7 owns governed experience semantics independent of interface. An adapter may transport or
> render those semantics; it may not redefine truth, authority, metrics, selectors, state transitions
> or write behavior.**

## 0. The headline finding

**Slice 13 is almost entirely already true.** Slices 6–10 moved execution below React on purpose, and
the evidence is mechanical rather than aspirational:

| Probe | Result |
|---|---|
| Files under `src/lib/` importing React | **0** |
| `SurfaceResult`'s own header | *"The HEADLESS result. No React, no HTML, no framework type (ruling 11)."* |
| Production callers of `compileSurface`/`assembleSurface` | **`page.tsx` only**, two call sites |
| Suites already driving `assembleSurface` with no React | `tests/p7-slice6`, `tests/p7-slice12` |
| Principal propagation | `assembleSurface(validated, principal)` → `dynamicSurfacesEnabled(principal)` and `runCompiledIntent(intent, principal)` — end to end |

`ExecutionPrincipal` already exists as a **branded, unforgeable** type, and its header anticipated
this slice before it was scheduled:

> *"a FUTURE API/MCP transport — which must add a resolver here that derives the org from its own
> authenticated credential … It is not written yet, because Slice 1 ships no such transport and
> speculative infrastructure is worse than none."*

**So this slice should be a formalization plus a very small extraction, not a feature.** What follows
is written to keep it that size.

## 1. What is already headless, and what is still route-coupled

**Already headless, unchanged, and not to be re-invented:**

- `SurfaceSpec` — the closed, untrusted pre-execution request shape.
- `compileSurface(...)` → `ValidatedSurfaceSpec` — deterministic validation, registry-closed.
- `assembleSurface(validated, principal)` → `SurfaceOutcome` — capability gate, governed execution,
  whole-surface atomicity, identity binding, action affordances as **data** (`offered: boolean`).
- `SurfaceResult` / `SurfaceComponentResult` / `SurfaceProvenance` — the semantic output.
- `SurfaceOutcome` — the complete typed disposition union.
- `ExecutionPrincipal` — trusted execution context, unforgeable by construction.
- `buildContextManifest(rows: GovernedRow[])` — context derived only from already-governed rows.

**Still route-coupled — and this is the entire gap:** a ~20-line orchestration sequence living inside
React components in `src/app/experience/pursuits/page.tsx`, duplicated at two call sites:

```
resolve base plan → executePursuitQuery → buildContextManifest → compileSurface → assembleSurface
```

`SurfaceView` runs it with a live manifest; `OpenPinView` runs it with `EMPTY_MANIFEST`. Neither
sequence contains governance, metrics, selectors or disclosure logic — it is orchestration only. That
is the smallest missing boundary, and nothing else in the stack is coupled to the interface.

## 2. What "headless" means here

> **Headless means the governed experience can be executed and consumed without React, HTML, browser
> routing or page rendering.**

It does **not** mean unauthenticated, ungoverned, public, caller-authored principal,
transport-independent authority, or agent autonomy.

> **Removing the UI removes presentation only, never governance.**

## 3. The adapter rule

> **An interface adapter is not a second PursuitOS.**

An adapter may authenticate through its own trusted boundary, obtain or construct the certified
request, call the canonical executor, and serialize the result. It may **not** query canonical truth,
compute metrics, perform P2 ranking, resolve hidden identity, reinterpret `WITHHELD`, authorize
actions, bypass P6, or introduce write semantics.

> **Never: rendered text → parse → identity or action.**
> **Always: governed semantic result → adapter → HTML / JSON / MCP / collaboration surface.**

The architecture already forces this: an ACTION component emits `capability`, `subjectId` and
`offered` as structured data, so no adapter has any reason to read a label. Slice 10's render binding
remains the integrity mechanism for invocation, and invocation is out of scope here.

## 4. Scope of the first vertical

Read-only, one organization, the already-certified pair: **SHOW ME open pursuits + ANALYZE open
pipeline**. No action component, no P45, no component-derived action, no persistence requirement, no
model requirement. Executed through both the existing web experience and the proposed canonical
boundary, compared **semantically** — never by rendered-HTML equality.

## 5. Out of scope, explicitly

No public REST, GraphQL, MCP server, SDK, Slack/Teams integration or external-agent callback. No
action-capable headless exposure. No writes. Slice 13 establishes only the internal canonical
execution contract those adapters will later call, which keeps transport and authentication questions
separate from P7 semantic authority.

Persisted pins (Slice 12) must eventually resolve into **the same** canonical executor — the
architecture must not grow a parallel path for them — but pins are not the first vertical.

## 6. Threat model the eventual implementation must be able to prove

No React dependency in canonical execution · no browser URL required · no caller-built
`ExecutionPrincipal` · no caller-built org authority · no arbitrary `ContextManifest` · identical
semantic result across web and headless for the same request, principal and state · hidden cells stay
hidden · suppressed rows do not reappear · P2 metrics and ranking stay canonical · explanation and
navigation semantics stay canonical · the model is optional and removable · adapters cannot query
canonical data · an adapter cannot turn `NOT_AVAILABLE` into hidden detail · no writes in the first
vertical · no second semantic result model diverging from `SurfaceResult`.

---

# Decisions requiring ruling

## A. Canonical headless input

`ValidatedSurfaceSpec` is **wrong** and the reason is already recorded in Slice 12: it carries a
`CompiledIntent` per component, and for `EXPLAIN`/`GO_TO` that holds a **resolved canonical
`subjectId`**. It is a post-authorization artefact, not a request.

`SurfaceSpec` alone is insufficient: the orchestrator must also know which registered plan the
recipient context is built from, and that must not be inferable from the spec.

**Proposed** — one small closed type, not a workflow language:

```ts
interface PursuitExperienceRequest {
  requestVersion: 1;
  spec: SurfaceSpec;                                             // untrusted, deterministically validated
  context: { kind: "NONE" } | { kind: "VIEW"; view: ViewKey };   // names a plan; never carries context
  source: "HAND_AUTHORED" | "MODEL";
  modelId: string | null;
  promptTemplateVersion: string | null;
}
```

`context` names **which registered plan** the server should derive context from. It never carries
context. **Ruling needed:** accept this, or restrict the first vertical to `{ kind: "NONE" }` and add
the `VIEW` form only when a context-bound headless case is actually required.

## B. Principal / trusted execution context

Use the existing branded `ExecutionPrincipal`. **Proposed:** the headless boundary **requires** one,
rather than accepting `undefined` and falling back to `withTenant`.

The web path's `undefined` fallback is correct *for the web*, because the ambient session is the
authority. A headless executor that inherited an ambient session would be exactly the confusion this
slice exists to prevent — so the fallback must not be reachable there.

> **The request describes what operation is requested. The trusted execution boundary establishes who
> is asking and what they may do.**

That needs one new resolver in `principal.ts` for trusted server-side contexts, minted like the
existing ones and never from request data. **Ruling needed:** require the principal at the headless
boundary (recommended), and confirm the new resolver stays internal with no external transport in
this slice.

## C. Is `SurfaceResult` already the canonical output?

**Yes.** Recommendation: adopt it unchanged and **create no second semantic result model**. Any
future transport shape is an adapter *over* it. `SurfaceProvenance` already carries
`specVersion`, `surfaceSpecDigest`, `componentRegistryDigest`, `vocabularyDigest`, `contextDigest`,
`compilerVersion`, `executionDigest`, `source`, `modelId`, `promptTemplateVersion` — which covers §16
versioning and §17 provenance without new fields. **Ruling needed:** confirm no new output type.

## D. Context construction

**Proposed rule:** context is only ever **derived server-side**, by executing a registered plan under
the same `ExecutionPrincipal`, and passing the resulting `GovernedRow[]` to `buildContextManifest`.
A serialized `ContextManifest` is **never** accepted from a caller.

This is already structurally enforced — `ContextManifest` carries `origin: "RECIPIENT"`, and
`toPrompt()` throws at runtime if it is anything else — so the rule is a restatement, not new
machinery. **Ruling needed:** confirm, and confirm `{ kind: "NONE" }` maps to `EMPTY_MANIFEST`
exactly as `OpenPinView` already does.

## E. Semantic parity definition

**Proposed:** web and headless execution are equivalent when, under the same principal, canonical
state, governance state and certified request, the resulting `SurfaceOutcome`s are equal on:

- outcome discriminant (`ok`, or the exact error member);
- `layout`, and the ordered component list by `component` key and `kind`;
- per READ component: governed object membership and order, per-cell disclosure state
  (`EXACT`/`WITHHELD`/existence), metric values and their versions, explanation statements, navigation
  target semantics;
- per ACTION component: `capability`, `subjectId`, `offered`;
- provenance: `surfaceSpecDigest`, `contextDigest`, `executionDigest`, `compilerVersion`, `source`.

**Explicitly not semantic:** HTML, React structure, label formatting, key order, whitespace, transport
envelopes. **Ruling needed:** confirm this list, particularly that provenance digests are *in* scope —
they are the cheapest possible parity oracle and should not drift silently.

## F. Typed error / disposition contract

`SurfaceOutcome` is already the contract: `CAPABILITY_DENIED` · `INVALID { detail }` ·
`NOT_AVAILABLE` · `FAILED` · `NO_SELECTABLE_RESULT`. The Slice 7 rule stands — infrastructure,
provider and programming failures must never collapse into governed `NOT_AVAILABLE`.

**One genuine decision.** `INVALID` carries a `detail` string. The web route deliberately discards it
and renders one sentence. A headless boundary that returns `detail` to an internal caller is useful;
an adapter that forwards it to a recipient would leak internal compile reasons that the UI has never
disclosed.

Two options, and this needs ruling rather than my discretion:

1. **Return the full typed outcome including `detail`**, and make "an adapter must not transport
   `INVALID.detail` to an untrusted recipient" an explicit adapter rule.
2. **Strip `detail` at the headless boundary**, so the leak is structurally impossible and internal
   debugging uses provenance and logs instead.

I lean to **(2)** — it matches this engagement's pattern of making the forbidden thing unrepresentable
rather than asking a future adapter author to remember a rule — but it costs internal diagnostics, so
it is your call.

## G. Already headless vs still coupled

Answered in §1. Summary: **everything below the route is headless already**; the gap is one
orchestration sequence duplicated across two React call sites, containing no governance.

## H. Smallest first implementation

**Proposed:** one new module — approximately:

```ts
export async function executeExperience(
  request: PursuitExperienceRequest,
  principal: ExecutionPrincipal,
): Promise<SurfaceOutcome>
```

It resolves context per (D), calls the existing `compileSurface`, calls the existing
`assembleSurface(validated, principal)`, and returns the existing `SurfaceOutcome`. **No new
governance, no new semantics, no new result type, no new registry.**

Then `page.tsx`'s two call sites become callers of it, so the web path and the headless path are
*the same path* rather than two paths asserted to agree. That is what makes the parity proof in (E)
meaningful rather than circular.

Estimated net: one small module plus a call-site change in `page.tsx`. **Ruling needed:** whether to
refactor the two existing call sites onto the new boundary in the same slice (recommended — otherwise
parity is being asserted between two implementations instead of proven by construction), or to add the
boundary alongside them and prove equivalence between two paths.

---

**Nothing here is implemented. Awaiting rulings on A–H.**

---

# RULINGS A–H — RECORDED, AND AS IMPLEMENTED

**A · Canonical input — APPROVED with a closed request type.** `PursuitExperienceRequest`:
`requestVersion`, `spec` (untrusted), `contextSource`, `source`, `modelId`, `promptTemplateVersion`,
`boundContextDigest`. It cannot carry a `ContextManifest`, a canonical subject id,
`ValidatedSurfaceSpec`, `CompiledIntent`, `ExecutionPrincipal`, org/user/role, a `SurfaceResult`, or
arbitrary query/SQL — a field that does not exist cannot be checked incorrectly. `contextSource` is
closed: `{ kind: "NONE" }` or `{ kind: "PLAN"; planKey: ViewKey }`, a **registered** key and nothing
else.

*One addition beyond the draft, and why:* `boundContextDigest` carries the existing `?ctx=`
precondition. Dropping it would have silently removed Slice 7's staleness refusal, so it is kept and
documented as an **optimistic-concurrency precondition only** — a digest names no object, discloses
nothing and grants nothing.

**B · Principal — APPROVED, resolver outside the executor.** `executeExperience(request, principal)`
requires a branded `ExecutionPrincipal`; the parameter is not optional, the executor calls no
`withTenant` and never unwraps the principal to re-derive authority. The web layer resolves its own
via a new `webSessionPrincipal()`, which derives the org from the authenticated session exactly as
before — so authority is unchanged, but the web path now *states* its identity instead of relying on
the executor to go looking for one. No speculative API/MCP resolver was created.

**C · Output — APPROVED with the required hardening.** `SurfaceResult` remains the sole semantic
result model; a structural test fails if an `APIResult`/`MCPResult`/`HeadlessSurfaceResult` ever
appears.

**D · Context — APPROVED.** `NONE` → `EMPTY_MANIFEST`. `PLAN` → the registered plan executes through
`executePursuitQuery` under the **same principal**, and `buildContextManifest` is built from the
governed rows. A serialized manifest is never accepted. An unregistered key is refused **before** any
governed read.

**E · Parity — APPROVED for read semantics; action parity deferred.** Proven by construction rather
than by comparison: the web adapter calls the same executor, and no longer compiles or assembles
anything itself.

**F · `INVALID` — RULED: strip structurally.** `SurfaceOutcome`'s `INVALID` member no longer carries
`detail`. The compiler's detail still exists on the internal `SurfaceCompileOutcome`, so diagnostics
survive; the recipient contract simply cannot express it. The five dispositions stay distinct and an
infrastructure failure is never relabelled as governed unavailability.

**G · Current architecture — RECORDED.** Already headless: query execution, context primitives,
compilation, governance, metrics, explanation, navigation, assembly, identity execution, persisted
execution below its access boundary, `SurfaceResult`. Only the orchestration sequence was
route-coupled; it has been extracted, not redesigned.

**H · Smallest implementation — APPROVED, both call sites refactored.** One executor module; two web
call-site refactors; the `INVALID` hardening; tests.

## One tension returned rather than resolved silently

The ruling allowed refusing ACTION-bearing specs at the new boundary *if required* to keep the first
vertical read-only, while also forbidding any break to the certified Slice 9/10 web action surfaces.
Those surfaces already flow through the orchestration being extracted, so **refusing would break
certified product behaviour**. It is not required: read-only-ness is held by the certified vertical
and by there being no external transport at all. The executor therefore does **not** refuse actions,
and nothing advertises it as an action interface. An action-capable headless interface needs its own
ruling.

## Evidence

Direct/headless execution against an isolated scratch clone, **no React, route, browser or provider
credential — 22/0**:

```
12 governed rows · 72 cells · 6 SUPPRESSED, every one with a null value
ANALYZE aggregate correctly WITHHELD, value null
zero writes to any canonical, action, runtime or P7 table
NONE contextDigest 4f53cda18c2baa0c  ·  PLAN contextDigest cb75c38500b4ae9d (context really derived)
unregistered plan key → INVALID, keys exactly ["ok","error"] — no detail field exists to leak
```

`p7-slice13` 20/20 · unit **834/834** · tsc clean · build clean · ordering-determinism 46/46 ·
seeded-clone 66/66 · **certify-world 52 clean**, protected state `d43fe13b1f194132` start = end.

Three pre-existing structural tests (slices 6, 7, 12) asserted on page source whose subject moved
into the executor. Each property still holds and was **followed to its new home** — with the
executor-side assertion added so the guarantee is not weakened — rather than deleted.
