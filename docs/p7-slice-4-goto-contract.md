# P7 Slice 4 — deterministic GO TO / canonical navigation: contract and plan

**Status:** **RULED AND AUTHORIZED** (rulings in §L, which supersede every recommendation above them).
Implementation may proceed.
**Builds on:** Slice 1 (`cade340`), Slice 2 (`a6dabbb`), Slice 3 (`7ac8c7f`) — all HOSTED ACCEPTED.
**Excluded:** LLM / natural-language aliases · fuzzy matching · search · pinning · actions · exports ·
historical `asOf` · arbitrary caller-defined routes · Dynamic Pursuit Surfaces · new schema · new flag.

The purpose: **prove PursuitOS can resolve a canonical, governed object reference into a deterministic
navigation target without creating authority, disclosure, routing truth, or a second object model.**

---

## A. The canonical object-reference type

> **`ObjectRef` already exists. Slice 4 does not invent a second one.**

`GovernedRow.objectRef` is `{ class: ObjectClass; id: string }` — the shape every governed result
already emits. GO TO accepts exactly that, and nothing else:

```ts
interface GoToRequest {
  requestVersion: 1;
  ref: { class: ObjectClass; id: string };   // class from OBJECT_CLASSES; id a canonical uuid
  surface: SurfaceKey;                        // a REGISTERED destination key — §K decision 1
}
```

What this type **cannot express**, structurally — the same discipline as Slice 3's missing
organization field (ruling 4): a pathname · a URL · a template · a query string · a fragment · a slug ·
a route parameter · an organization · a scope · a display label. There is nothing to sanitize, because
there is nothing to accept.

`class` is a key of the closed `OBJECT_CLASSES` registry. `id` must match the canonical UUID pattern
**before** any database work, exactly as `subject.ids` does today. An unregistered class or a malformed
id is a hard validation failure, not a query.

**Why reuse rather than define.** A second reference type is a second object model. The moment
navigation can name something the governed result set cannot, GO TO has become an independent way to
talk about objects — and any invariant proven about `GovernedRow` stops covering it.

---

## B. Where route knowledge is registered

> **One code-defined navigation registry. No component, no template and no model ever writes a route
> string.**

Today the repo contradicts this: `/pursuits/${id}` is composed at **fifteen** call sites, with
hand-written fragments (`#value`, `#team`, `#route`, `#whynow`) appended ad hoc. Each is a place where
a route can drift, and where a link can be built for an object the caller never proved it may see.

Slice 4 adds to the **existing** `registry.ts` (never a second registry — the Slice 3 rule):

```ts
export interface DestinationDef {
  class: ObjectClass;
  surface: SurfaceKey;
  /** A code-defined pattern with exactly ONE substitution: the canonical id. */
  pathTemplate: `/${string}:id${string}`;
  /** Refs that must be present AND existence-AUTHORIZED in the governed row (mirrors template.requires). */
  requires: FieldRef[];
  /** Presentation only. Carries no semantics and no authority. */
  label: string;
}
export const DESTINATIONS: Record<string, DestinationDef>;   // key: `${class}@${surface}`
export function pathFor(target: NavigationTarget): string;   // the ONE place a path is formed
```

**The route is presentation metadata, not authority.** `/pursuits/<id>` grants nothing: the detail page
enforces its own governance when it renders, exactly as it does today. What Slice 4 changes is that a
*link to it* is no longer produced for an object whose visibility was never established.

**A destination may name a route P7 does not own.** That is correct — P7 owns presentation, not routing
truth — and it creates one obligation: a structural test binding every registered `pathTemplate` to an
App Router route file that actually exists, so the registry cannot rot into 404s (§J proof 11, §K
decision 6).

---

## C. Unauthorized versus nonexistent

> **Indistinguishable, and the transport must not reintroduce the distinction.**

The resolver returns **one** failure for both: `NOT_AVAILABLE`. There is no `FORBIDDEN`, no
`NOT_FOUND`, and no internal reason code that a caller could branch on — the same rule that kept
Slice 2's `?explain=<uuid>` safe, and the same reason Slice 3 refuses to publish a reason beside a
withheld aggregate.

This binds the transport too, and it is where such systems normally leak:

| Channel | Rule |
|---|---|
| HTTP status | one status for both cases. **403 vs 404 is a disclosure.** |
| response bytes | byte-identical for both (instant masked) |
| latency class | no authorization-dependent extra round trip after the governed read |
| logs reaching the recipient | none — operation metadata stays server-side |

Slice 2 already proved this shape hosted: an unauthorized subject and a nonexistent one returned the
same status, the same structure and the same recipient-visible bytes.

---

## D. GO TO resolves **after** authorization — and creates no new read path

> **A target must never be returned for an object whose existence is undisclosable.**

```
resolved principal
  → registered ObjectRef (validated: class in registry, id canonical)
  → scope (resolveScope — unchanged)
  → P6 eligibility / disclosure (can_see_pursuit, RLS, mayDerive, resolveDisclosure)
  → GOVERNED ROW EXISTS?  ── no ──▶ NOT_AVAILABLE
  → NavigationTarget formed from the governed row
  → transport-specific navigation
```

The load-bearing decision: **GO TO issues no query of its own.** It runs the existing
`executePursuitQuery` with a fixed, code-defined plan naming exactly that one id — precisely how
`explainPlanFor` works — projecting the minimum the destination `requires`. So:

- there is no second read path to govern, audit or keep in sync;
- **the existence of a governed row IS the authorization**, evaluated by P6 and nothing else;
- `navigate.ts` is pure and synchronous, holds no database handle, and imports only the registry and
  types — the same structural guard that makes `explain.ts` and `analyze.ts` unable to widen anything.

A redirect, a link, or any transport action happens **only** after `ok: true`. Nothing is emitted
speculatively and corrected later.

---

## E. What the headless boundary returns

> **A canonical destination descriptor. Never an HTTP redirect, a `Response`, or a framework call.**

```ts
interface NavigationTarget {
  ref: { class: ObjectClass; id: string };
  surface: SurfaceKey;
  path: string;        // produced by pathFor(), the single path-forming function
  label: string;       // §G — governed, never raw
}
type GoToOutcome =
  | { ok: true; target: NavigationTarget }
  | { ok: false; error: "NOT_AVAILABLE" }            // unauthorized OR nonexistent — indistinguishable
  | { ok: false; error: "UNAVAILABLE_TARGET" }       // existence authorized, destination not openable (§I)
  | { ok: false; error: "INVALID_REQUEST"; detail: string };   // malformed, pre-database
```

Web renders it as a link or a post-authorization redirect; an API returns the descriptor; MCP returns
the descriptor. **No transport re-checks authorization** — structurally, none of them can: they receive
a value, not a query, and they hold no database handle. That is what makes "future transport adapters
do not duplicate authorization logic" a provable property rather than a convention.

`INVALID_REQUEST` carries a detail because it describes the *caller's own malformed input* and reveals
nothing about stored state. `NOT_AVAILABLE` carries none, ever.

---

## F. Caller-supplied URLs, pathnames and route parameters

> **No. Recommended, and structurally enforced.**

The caller supplies `{ class, id, surface }` from closed vocabularies. A pathname, URL, template,
fragment, slug or route parameter is **not accepted, not sanitized and not normalized** — an unknown
request key is rejected outright, as Slice 1's validator already rejects unknown plan keys.

This closes open redirect by construction: there is no input from which a URL is built. The only
variable part of any emitted path is a UUID that already passed validation, substituted into a
code-defined template by one function.

---

## G. Can navigation metadata leak hidden state?

Yes — and this is the real risk of the slice. The target is small, but every field on it is a channel.

| Field | Ruling |
|---|---|
| **`label`** | Built **only** from cells that survived disclosure for *this* principal. If the governed row discloses `pursuit.account_name`, the label may use it; otherwise the label is the destination's class-generic text ("Pursuit"). Never the raw object. §K decision 4. |
| **`path`** | Contains **only the canonical id the caller already named**. **No slugs** — `/pursuits/acme-q3-expansion` would disclose the account name in the URL, to the browser history, the referrer header and every log between here and there. |
| **breadcrumbs** | **None in Slice 4.** A breadcrumb naming a parent account, org or partner discloses hierarchy the principal may not be entitled to. |
| **counts** | **None.** No "3 related", no sibling counts — the Slice 3 rule: a count is a disclosure. |
| **org / partner names** | Never, unless the same value is an already-disclosed governed cell in the same row. |
| **target-specific metadata** | **None.** The descriptor carries `ref`, `surface`, `path`, `label` and nothing else. New fields are a contract change. |
| **existence via shape** | A formed target and a `NOT_AVAILABLE` differ — that is the point — but *unauthorized* and *nonexistent* must be identical to each other (§C). |

---

## H. Scope

> **Naming an object does not broaden scope. A GO TO request is a question, not a grant.**

The fixed GO TO plan carries no organization field (Slice 3 ruling 4 — a cross-org reference cannot be
*represented*) and runs under the principal's ordinary scope resolution. `ALL_SCOPE` means "everything
this principal may see", never "all rows". An object outside the resolved scope produces no governed
row and therefore `NOT_AVAILABLE` — identical to nonexistent.

Naming an id is the same act as Slice 2's `?explain=<uuid>`, already ruled: *a caller may name an
object; naming it does not confer visibility, derivation authority or disclosure authority.*

---

## I. An object the principal may know exists but may not open

> **Defined explicitly, so the router never decides it by accident.**

Two states, mirroring the existence/value split that Slice 2 already established:

1. **Existence UNAUTHORIZED** → `NOT_AVAILABLE`. No target, no label, no path, no acknowledgement.
   Indistinguishable from nonexistent. *Nothing is built, so there is nothing to redact.*
2. **Existence AUTHORIZED, destination not openable** → `UNAVAILABLE_TARGET`. The principal already
   sees this object in their governed set, so acknowledging it discloses nothing new; the surface says
   the destination is not available in **operation-level language naming no reason code and no hidden
   attribute** — the identical shape Slice 2 uses for a denied derivation.

A destination is "not openable" when its `requires` refs are absent or existence-unauthorized in the
governed row — the same mechanism as `template.requires`, not a new authority.

**Honest limitation:** for the first vertical, `pursuit@canonical` requires only `pursuit.id`, which is
present in every governed row. So state 2 is **representable and tested against constructed governed
input, but not producible by the shipped registry.** It is defined now rather than later precisely
because an undefined state is the one a router resolves by accident. §K decision 2.

---

## J. Later natural-language GO TO composes as a *proposer*

```
natural language → PROPOSED ObjectRef → [ this deterministic resolver ] → NavigationTarget
```

The model may propose *which object*. It may never produce a path, form a target, decide visibility, or
observe why a resolution failed. Two rules make the composition safe, and both are already precedent:

- **The resolver stays authoritative.** A proposed id the principal may not see returns
  `NOT_AVAILABLE`, indistinguishable from nonexistent — so a model cannot be used as an existence
  oracle, and neither can a caller driving one.
- **Failure reasons never reach the model.** Feeding `NOT_AVAILABLE` vs `UNAVAILABLE_TARGET` back into
  a proposer turns the pair into a probe. The model sees success or nothing, exactly as the recipient
  does (Slice 2's reason-code rule, applied to a new consumer).

---

## Required threat proofs

| # | Test | Answers |
|---|---|---|
| 1 | arbitrary pathname input cannot bypass the registry | §A, §F |
| 2 | the caller cannot select another organization | §H |
| 3 | naming an unauthorized pursuit does not reveal whether it exists | §C |
| 4 | hidden target metadata does not appear in response bytes | §G |
| 5 | a malformed id fails before query execution | §A |
| 6 | route strings carry no authority — a valid path for an invisible object is never emitted | §B, §D |
| 7 | changing only hidden target data does not alter recipient-visible navigation output | §G |
| 8 | the same ref + same principal yields the same `NavigationTarget`, byte-identical | §D |
| 9 | no redirect or link is emitted before governance succeeds | §D |
| 10 | transport adapters duplicate no authorization logic (structural: no db handle, no P6 import) | §E |
| 11 | every registered `pathTemplate` resolves to an App Router route that exists | §B |
| 12 | an unregistered `class` or `surface` hard-fails before any database work | §A, §B |
| 13 | `UNAVAILABLE_TARGET` exposes no reason code and no hidden attribute | §I |
| 14 | a governed-fixture proof: a participant's visible-but-foreign pursuit resolves consistently | §D, §I |

Proofs 2, 3, 7 and 14 run against the seeded clone with a foreign-owned pursuit and a participating
viewer — the fixture shape Slices 2 and 3 already proved out. Per §16B of the parent contract, every
gate parser must prove its evidence exists and is well-formed before any negative assertion counts.

---

## Smallest implementation vertical

**One class · one reference type · one registered destination · one headless resolver · web consumes
it.** No aliases, no fuzzy matching, no search, no model.

```
src/lib/experience/types.ts       + GoToRequest, NavigationTarget, GoToOutcome, SurfaceKey
src/lib/experience/registry.ts    + DESTINATIONS: pursuit@canonical + pathFor()   (same registry)
src/lib/experience/navigate.ts    NEW: pure (GovernedRow, DestinationDef) => NavigationTarget
src/lib/experience/plans.ts       + goToPlanFor(ref): the fixed one-object plan
src/lib/experience/execute.ts     + resolveGoTo(request, principal?) — reuses executePursuitQuery
src/app/experience/pursuits/page.tsx  web transport consumes the resolver (transport only)
tests/p7-slice4.test.ts           proofs 1, 4–13 (no database)
scripts/p7-slice1-verify.ts       + governed-fixture proofs 2, 3, 7, 14
```

No new table, no migration, no new flag, no P5/P6 change, no new route (§K decision 3).

---

## K. Architectural decisions requiring a ruling

1. **Does the request carry an explicit `surface`?** *Recommend: yes* — required, closed vocabulary of
   exactly one value (`"canonical"`). A second destination then becomes a registry change, not a
   request-shape change. The alternative (class → one implicit destination) is smaller now and a
   breaking change later. **Also ruled here: no fragments.** Today's `#value` / `#team` / `#whynow`
   anchors are sub-surfaces; registering them is registering a second surface vocabulary, and Slice 4
   should not.
2. **Define `UNAVAILABLE_TARGET` now, or defer it?** *Recommend: define now*, as a representable state
   the first vertical cannot actually produce (§I), tested against constructed governed input. The
   alternative leaves "visible but not openable" to whatever the router happens to do.
3. **Web transport shape.** *Recommend: no new route* — a `?goto=<uuid>` parameter on the existing
   `/experience/pursuits` renders either a link to the canonical target or the not-available surface.
   The alternative is a redirect route (`/experience/pursuits/go`), which is more useful and adds a
   redirect surface plus a second place where indistinguishability must hold.
4. **Label policy.** *Recommend: governed-cell label when disclosed, class-generic fallback otherwise.*
   The alternative — always class-generic ("Pursuit") — leaks nothing at all but produces a navigation
   affordance a human cannot use. This is the slice's main disclosure/utility trade.
5. **Does GO TO reuse `executePursuitQuery` with a fixed plan?** *Recommend: yes* — no new read path,
   existence of a governed row **is** the authorization. The alternative (a dedicated lightweight
   loader) is faster and creates a second governed read to keep in sync forever.
6. **May P7 register destinations for routes it does not own?** *Recommend: yes, with a structural test
   binding every `pathTemplate` to a real App Router route* (proof 11). This is also the moment to rule
   whether the fifteen existing hand-built `/pursuits/${id}` call sites must migrate to `pathFor()` —
   *recommend: not in Slice 4* (it would touch non-P7 surfaces), recorded as follow-up.
7. **Failure taxonomy at the boundary.** *Recommend: `NOT_AVAILABLE` is a single value for both
   unauthorized and nonexistent*, with the distinction never crossing the boundary even to trusted
   internal callers — the moment one caller may branch on it, it is a probe.

---

## L. Ruling record (authoritative — supersedes any recommendation above it)

**Preserved above all:** *GO TO resolves authority before navigation. A route is presentation metadata,
never authority.*

1. **`surface` — APPROVED.** `GoToRequest` carries a closed-registry `surface: "canonical"`. Slice 4
   supports **exactly one** surface. **No fragments or sub-surface anchors.** A future second
   destination requires an explicit registry addition, never a reinterpretation of `"canonical"`. **No
   arbitrary URL, pathname, fragment or route parameter may enter the canonical request.**
2. **`UNAVAILABLE_TARGET` — DEFINE IT NOW.** Semantics: *the governed object's existence is authorized,
   but the requested registered surface has no usable destination.* It may be created **only after**
   governance has established that the recipient may know the object exists. It must contain **no**
   hidden target path, hidden label, alternate route, org metadata, or diagnostic reason revealing
   undisclosed state. For `pursuit@canonical` the first vertical is expected not to produce it
   naturally: keep a **constructed-unit proof of its semantics** rather than manufacturing hosted
   conditions to reach it. **Never conflated with `NOT_AVAILABLE`.**
3. **Web transport — APPROVED.** `/experience/pursuits?goto=<uuid>`. **No new redirect endpoint in
   Slice 4.** The UUID names a requested object only. The transport renders exactly one of: a governed
   `NavigationTarget`; `UNAVAILABLE_TARGET` (existence authorized, destination unavailable); or a
   recipient-safe `NOT_AVAILABLE`. **No redirect is issued before deterministic governance resolution
   succeeds.**
4. **Label policy — APPROVED.** A governed label is used **only if** the corresponding registered cell
   survived disclosure; for this slice that cell is `pursuit.account_name`. Otherwise the fixed
   class-generic fallback **"Pursuit"**. **Never a second read solely to obtain a label.** Never
   suppressed or raw account data. **Changing hidden label data must not change recipient-visible
   navigation bytes.**
5. **Governed read path — APPROVED.** GO TO reuses `executePursuitQuery` with a fixed registered plan.
   **No dedicated navigation loader.** Preserved order: *principal → fixed `PursuitQuery` → existing
   governance/disclosure → governed row → `NavigationTarget`.* **The existence of the governed row is
   the authorization basis**, and route resolution happens only after it.
6. **Navigation registry.** P7 **may** register canonical destinations for application routes it does
   not own; the registry owns **mapping**, not the destination route's business logic. Every registered
   `pathTemplate` must be proven to correspond to a real App Router destination **using structured
   route/build metadata or an equivalent semantic mechanism — not brittle grep/source-string
   assertions.** The fifteen existing hand-built `/pursuits/${id}` call sites are **out of scope and
   must not be migrated now**; consolidation is recorded separately, and their existence **does not
   authorize bypassing the P7 registry inside GO TO**.
7. **Failure taxonomy.** At the canonical P7 GO TO boundary, an **unauthorized** object and a
   **nonexistent** object both resolve to exactly `NOT_AVAILABLE`, and the distinction **must not cross
   that boundary**. A caller must not be able to branch on a reason code, a status difference, a target
   shape, a label, metadata or response bytes. Lower-level trusted diagnostics may retain an internal
   classification **only if it already exists** and cannot affect recipient-visible behaviour or
   product control flow — **no internal distinction may be added merely for Slice 4**.
   `UNAVAILABLE_TARGET` remains separately representable because object existence has *already* been
   authorized.

**Required implementation proofs** (in addition to §J): malformed object ids fail **before DB query
construction** · arbitrary URLs/pathnames/fragments are **unrepresentable** · an unknown object class
or surface **hard-fails at registry validation** · caller-controlled org input cannot affect the
resolved principal · unauthorized and nonexistent references are **byte-identical at the P7 boundary
and at the web transport** · no navigation target is constructed before governance succeeds ·
suppressed label data produces the generic fallback and does not leak in bytes · changing only hidden
target metadata does not change output · same principal + same canonical reference yields the same
`NavigationTarget` · `pathTemplate` receives **only canonical governed identifiers** · route existence
is validated **structurally** · no navigation resolver performs its own DB read · **no P7 write** · **no
model**.

**Slice 4 remains:** pursuit only · `"canonical"` surface only · deterministic · LLM-free · read-only ·
no search · no fuzzy matching · no aliases · no fragments · no pinning · no actions · no export · no
historical queries · no Dynamic Pursuit Surfaces · no new schema · no P5/P6 changes.

---

## What this plan does not authorize

No LLM · no natural-language aliases · no fuzzy matching · no search · no pinning · no actions · no
exports · no historical `asOf` · no arbitrary caller-defined routes · no Dynamic Pursuit Surfaces · no
new canonical state · no second object model · no second registry · no slugs · no breadcrumbs · no
counts · no schema change · no new flag.
