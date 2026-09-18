# P7 Slice 5 — natural-language intent compilation: contract and plan

**Status:** **RULED AND AUTHORIZED** (rulings in §L, which supersede every recommendation above them).
Implementation may proceed.
**Builds on:** Slice 1 (`cade340`) · Slice 2 (`a6dabbb`) · Slice 3 (`7ac8c7f`) · Slice 4 (`a1dad9f`) —
all HOSTED ACCEPTED.

The purpose: **let a model translate natural-language intent into the already-certified deterministic
P7 grammar, without letting the model become authoritative for data, permissions, metrics, scope,
routing or actions.** The model is a **proposal compiler, not an executor.**

```
user utterance → LLM proposes typed intent → deterministic validation → canonical P7 operation
                                                   → existing certified execution path
```

**Model output is untrusted input.** It gains no authority from being machine-generated; it is exactly
as trusted as a query string, and is validated by the same kind of closed-vocabulary validator.

> **THE CRITICAL INVARIANT: removing the LLM must not change the meaning, permissions or execution
> semantics of any canonical P7 operation.**

That invariant is not a claim to be argued — it is the *shape of the code*. Everything downstream of
the proposal already exists, is already certified, and cannot tell whether a model, a form, a script
or a hand-written JSON file produced the proposal it is given.

---

## A. What the model may emit

> **A closed typed envelope whose payload must validate into an ALREADY-CERTIFIED request type. The
> model never authors a plan; it SELECTS among code-defined ones.**

```ts
/** What the MODEL emits. Deliberately minimal, and deliberately not the thing that executes. */
type ModelOutput =
  | { operation: "SHOW_ME";  view: ViewKey }                       // a fixed plan, by key
  | { operation: "ANALYZE";  view: ViewKey }                       // a fixed cohort plan, by key
  | { operation: "EXPLAIN";  subject: ContextRef }                 // §F — never a raw id
  | { operation: "GO_TO";    subject: ContextRef; surface: SurfaceKey }
  | { operation: "NEEDS_CLARIFICATION"; missing: ClarificationKey } // §D — a registry key, not prose
  | { operation: "UNSUPPORTED" };

/** What the COMPILER produces after validation. The model cannot forge this; it never emits it. */
interface IntentProposal {
  proposalVersion: 1;
  operation: "SHOW_ME" | "ANALYZE" | "EXPLAIN" | "GO_TO";
  request: { view: ViewKey } | { subjectId: string } | GoToRequest;   // certified shapes only
  provenance: { compilerVersion: string; vocabularyDigest: string; modelId: string };  // §I
}
```

**The decisive choice is `view: ViewKey`.** Letting the model emit a `PursuitQuery` would be
caller-supplied plan ingestion — the attack surface Slice 1 deliberately deferred and Slice 3 ruling 5
closed. By selecting among `PLANS`, the model *cannot* express an arbitrary filter, an unregistered
metric, a caller-defined cohort, a historical `asOf` or a cross-org comparison: those are not "rejected
by validation", they are **unrepresentable in what the model is allowed to say**.

The model may never emit SQL, a path, a URL, a table name, a column name, an organization identifier,
or a free-text label. None of them appear in the type.

**No `confidence` field**, ever. A confidence score invites a threshold, and a threshold is a place
where a system quietly decides to act on something it does not understand.

---

## B. The vocabulary the model sees

> **Derived from the canonical registries at runtime. Never prose that can drift.**

```ts
export function compilerVocabulary(): {
  operations: OperationSchema[];          // the shapes in §A, generated from the types
  views: { key: ViewKey; label: string }[];          // from PLANS
  fields: { ref: FieldRef; label: string }[];        // from FIELDS
  metrics: { key: string; label: string }[];         // from METRICS
  aggregates: { key: string; label: string }[];      // from AGGREGATES
  surfaces: SurfaceKey[];                            // from DESTINATIONS
};
```

Assembled by reading `registry.ts` and `plans.ts` — **a suite proves the vocabulary equals the registry
contents**, so a metric added or renamed cannot leave a stale hand-written list behind. This is the
same rule that made P7 import `PURSUIT_STATUSES` rather than restate it.

**The vocabulary contains no data.** Keys and labels only — no account names, no organization names,
no row values, no counts. Intent compilation does not need them (§G), and a suite proves the assembled
prompt contains none.

---

## C. An unknown field, metric, view or surface

> **Hard deterministic rejection. No best-effort substitution, no nearest match, no "did you mean".**

The validator refuses exactly as `validatePlan` already refuses an unregistered metric: it names the
offending identifier and stops. The outcome is `UNSUPPORTED` — a **non-executing** state. A model that
invents `pursuit.win_probability` does not get `pursuit.open_pipeline_usd` instead; the system says it
cannot do that. *A guess here would be the compiler deciding what the user meant, which is precisely
the authority the model must not have.*

---

## D. Ambiguity

> **An explicit non-executing state: `NEEDS_CLARIFICATION`. The model must not silently choose a
> broader scope, a different object, a different metric, or a more permissive operation.**

When more than one registered operation or view fits, the correct output is `NEEDS_CLARIFICATION` —
never the larger one. "Show me pipeline" does not become the all-pursuits cohort because that is the
bigger answer.

**The clarification must not itself disclose.** *"Did you mean Acme or Initech?"* would leak object
existence through a question. So the model emits a **registry key** (`missing: "view" | "subject" |
"operation"`), and the recipient-facing question is composed **deterministically from the registry
vocabulary** — it may name registered operations, views and fields, and may never name an object
instance, an organization, or anything read from the database (§K decision 7).

---

## E. Organization and principal

> **No. Never. Not expressible.**

The principal and organization remain entirely transport-credential-derived — `withTenant` from the
session, or an `ExecutionPrincipal` minted by the trusted resolver. There is **no organization field in
`ModelOutput`, in `IntentProposal`, or in any certified request type** they validate into: the same
structural rule as Slice 3 ruling 4 and Slice 4 ruling 1. There is nothing to reject later because
there is nothing to say.

Org-like text in the user's utterance is **descriptive query content only**. Since Slice 5's model
cannot emit a filter at all, "show me Acme's pipeline" cannot become an org selection — at most it
becomes `NEEDS_CLARIFICATION` or `UNSUPPORTED`.

---

## F. Object identity — the model never handles an id

> **The model emits a CONTEXT REFERENCE, not a UUID. A hallucinated id is not rejected; it is
> unrepresentable.**

```ts
type ContextRef = { fromContext: number };   // an index into ids the TRANSPORT already supplied
```

The transport passes the canonical ids already present in the interaction — the subject of the current
page, or an id the user themselves typed — as an ordered allowlist. The model may point at one by
index; the compiler substitutes the actual id. So:

- the model cannot mint an id, and therefore **cannot be used as an existence oracle** — the probing
  channel Slice 4 §J closed, reopened here if the model could emit arbitrary UUIDs;
- an index outside the allowlist is a deterministic `UNSUPPORTED`;
- an empty allowlist means EXPLAIN and GO_TO are simply not available for that utterance.

**Slice 5 introduces no search, no fuzzy matching and no hidden lookup.** Object discovery is a future
capability with its own contract; the compiler must not invent it. If the user says *"explain the Acme
pursuit"* and no id is in context, the answer is `NEEDS_CLARIFICATION`, not a search.

---

## G. What may enter the prompt

**Permitted:** the user's utterance · the registry-derived vocabulary (§B) · the operation schema ·
the count of context ids and the current view key.

**Forbidden:** governed cell values · row data · account, company or organization names · metric
values · counts of authorized objects · omission metadata · anything read from the database ·
anything a `GovernedResultSet` carries.

> **Intent compilation requires no canonical data.** This is a property, not an aspiration: the
> compiler decides *which registered operation the user is asking for*, and that question is answerable
> from the utterance and the vocabulary alone. A suite proves the assembled prompt contains no governed
> value, which also means **no disclosure decision is ever delegated to prompt construction.**

The canonical ids themselves are **not** sent (§F): the model sees only how many exist.

---

## H. Where natural language stops

```
utterance → [ MODEL ] → ModelOutput → deterministic validation → IntentProposal
          → principal resolution → P6 governance → computation / navigation / explanation → render
```

**The model stops at `ModelOutput`.** It does not see the result, the row set, the explanation, the
aggregate or the failure reason. Two consequences, both deliberate:

- **No generated prose about governed data** in Slice 5 (§K decision 3). The surface renders
  deterministically, exactly as Slices 1–4 render today. Letting the model phrase an answer would
  require an entire disclosure story for generated text, which is its own contract.
- **Failure reasons never return to the model** — the rule Slice 2 set for reason codes and Slice 4
  extended to navigation. A retry loop fed by `NOT_AVAILABLE` versus `UNSUPPORTED` is a probe.

---

## I. Provenance and versioning

> **Recorded by the compiler, never claimed by the model.**

The model emits only `operation` + payload. The compiler stamps `provenance`:

| Field | Meaning |
|---|---|
| `compilerVersion` | the prompt template's content digest — changes when the instructions change |
| `vocabularyDigest` | a digest of the exact registry-derived vocabulary presented |
| `modelId` | the model identifier the deployment called |

Enough to reproduce *which compiler produced a proposal*, and **never consulted by any authorization
or disclosure decision** — a suite proves no governance path reads it. Because the model cannot write
these fields, it cannot forge its own provenance.

**Slice 5 persists nothing** (no schema): provenance travels with the response and is not stored.

---

## J. Syntactically valid, semantically dangerous

The deterministic validators and the existing registry/governance must reject these. In most cases the
rejection is structural — the dangerous thing cannot be *said*:

| Model attempts | What stops it | Where |
|---|---|---|
| hidden org selection (`{orgId: …}`) | no organization field exists in any type | §E, structural |
| an arbitrary route (`{path: "/admin"}`) | `GO_TO` carries class + context ref + registered surface | Slice 4 ruling 1 |
| an unknown metric | closed registry; hard rejection, no substitution | §C |
| a new aggregate or a caller-defined cohort | the model selects a `ViewKey`; it cannot author a plan | §A |
| cross-org ranking or comparison | no comparison operation exists in the registry | Slice 3 ruling 2 |
| a historical query (`asOf`) | not in any payload; fixed plans pin `asOf: null` | Slice 1 ruling 3 |
| multi-row EXPLAIN | an explanation requires exactly one subject | Slice 2 ruling 3 |
| a hallucinated pursuit id | ids are unrepresentable — only a context index | §F |
| a write, an action, a P5 dispatch | no such operation is in the closed operation set | §A |

**Prompt injection, stated honestly.** The utterance is untrusted text, and text that instructs the
model is still text. Injection cannot: exceed the principal's authority (governance is downstream and
credential-derived), reach an unregistered identifier (closed vocabulary), name an object not already
in context (§F), or produce a write (no such operation). What injection **can** do is cause a
*different permitted read* to run than the user intended — the user sees a governed view they did not
ask for. For a read-only slice whose every outcome is already governed for that principal, that is the
honest, bounded residual risk, and it is named rather than papered over (§K decision 8).

---

## Safety properties to prove

| # | Test |
|---|---|
| 1 | model output cannot alter the principal or organization |
| 2 | unknown registry identifiers fail deterministically, with no substitution |
| 3 | invalid model output causes **no database execution** |
| 4 | ambiguous intent causes no execution, and its clarification names no object |
| 5 | prompt injection in the utterance cannot bypass the typed schema or the validator |
| 6 | different wording producing the same canonical proposal yields the same execution |
| 7 | two different model outputs validating to the same request produce identical downstream behaviour |
| 8 | model output cannot construct a route or URL directly |
| 9 | model output cannot create a metric or an aggregate |
| 10 | model output cannot introduce a write or an action |
| 11 | no hidden canonical data is required for intent compilation (the prompt carries none) |
| 12 | **execution remains correct when the model is replaced by a hand-authored valid proposal** |
| 13 | a hallucinated or out-of-range context reference is unrepresentable or deterministically refused |
| 14 | the vocabulary equals the registry contents — no drift, no duplicated prose |
| 15 | provenance is compiler-stamped, model-inforgeable, and read by no governance path |
| 16 | `NEEDS_CLARIFICATION` and `UNSUPPORTED` are non-executing and recipient-indistinguishable from each other where P6 requires it |

Proof 12 is the load-bearing one, and it is structural: **the entire certified suite runs on
hand-authored proposals.** The deterministic path has no model in it to remove.

---

## First vertical

Six utterances, no search, nothing added to make the demo feel magical:

| Utterance | Proposal |
|---|---|
| "show me open pursuits by pipeline" | `SHOW_ME { view: "open-by-value" }` |
| "go to this pursuit" *(id in context)* | `GO_TO { subject: {fromContext: 0}, surface: "canonical" }` |
| "explain this one" *(id in context)* | `EXPLAIN { subject: {fromContext: 0} }` |
| "what's our total open pipeline?" | `ANALYZE { view: "open-pipeline-cohort" }` |
| "show me pipeline" | `NEEDS_CLARIFICATION { missing: "view" }` |
| "which partner is most likely to win?" | `UNSUPPORTED` |

```
src/lib/experience/intent/schema.ts      ModelOutput, IntentProposal, IntentOutcome (types only)
src/lib/experience/intent/vocabulary.ts  compilerVocabulary(), derived from the registries
src/lib/experience/intent/validate.ts    PURE: ModelOutput + context → IntentProposal | UNSUPPORTED | NEEDS_CLARIFICATION
src/lib/experience/intent/compile.ts     the ONLY module that calls a model; returns ModelOutput or nothing
src/lib/experience/intent/run.ts         IntentProposal → the existing certified boundaries
src/app/experience/pursuits/page.tsx     transport (§K decision 6)
tests/p7-slice5.test.ts                  proofs 1–16, all on hand-authored proposals
scripts/p7-slice1-verify.ts              + governed-fixture proofs 1, 3, 12
```

No new table, no migration, no new `org_features` column, no P5/P6 change, no new metric, field,
aggregate, view or surface.

---

## K. Architectural decisions requiring a ruling

1. **Does the model select a `ViewKey`, or author a validated `PursuitQuery`?** *Recommend: select a
   key.* Arbitrary filters, unregistered metrics, caller-defined cohorts, `asOf` and cross-org
   comparison then become **unrepresentable** rather than rejected. The cost: the first vertical can
   only express what a fixed plan already expresses, so "show me open pursuits for Acme" is
   `UNSUPPORTED` until a filter-authorization contract exists.
2. **Object identity: context reference, or a canonical id from an allowlist?** *Recommend: a context
   reference (`{fromContext: n}`)* — the model never handles a UUID, so a hallucinated id cannot be
   expressed at all and the model cannot become an existence oracle. The alternative (model emits a
   UUID that must be in an allowlist) is simpler to implement and reintroduces a shape where the
   validator, not the type, is the only thing standing between a guess and a lookup.
3. **May the model phrase the answer?** *Recommend: no* for Slice 5 — the surface renders
   deterministically and the model never sees a result. Generated prose about governed data needs its
   own disclosure contract, and its own rules for what a sentence may imply about what it omits.
4. **Two-layer envelope?** *Recommend: yes* — the model emits `operation` + payload; the compiler
   stamps `IntentProposal.provenance`. The model then cannot forge its own provenance. The cost is two
   types where one would do.
5. **May the certified suite depend on a live model?** *Recommend: no.* The deterministic gate runs
   entirely on hand-authored proposals; model behaviour is measured in a separate, non-blocking
   evaluation that can never turn certification green or red. This is what makes proof 12 structural.
6. **Gating and whether a model is called at all in the certified deployment.** *Recommend:* a new
   **environment master** `PURSUIT_INTENT_ENABLED`, default **OFF**, layered on the existing
   `pursuit_experience` org entitlement — **no new `org_features` column**, since that would be schema.
   Also recommend that the first hosted acceptance run with the master **OFF for the model** and prove
   the deterministic path on hand-authored proposals, so Slice 5 can be certified before any model call
   exists in Preview. Ruling needed on whether that is acceptable or whether hosted acceptance must
   include a live model call.
7. **Who composes the clarification text?** *Recommend: deterministic code, from the registry
   vocabulary* — the model emits only a `missing` key. A model-authored question is free text derived
   from an utterance, and free text next to a governed surface is the one place a disclosure could
   re-enter through the back door.
8. **Prompt-injection posture.** *Recommend: accept the named residual* — injection can change **which
   permitted read runs**, never what the principal may see, and Slice 5 is read-only with every outcome
   already governed. Ruling needed on whether that residual is acceptable without an additional
   confirmation step, and whether the rendered surface must always state **which canonical operation
   actually ran** so a substituted intent is visible to the user.

---

**Post-review addenda (recorded with the Stage A authorization).**

- **`?propose=` is ACCEPTED and is NOT a separately privileged path.** A `ModelProposal` is untrusted
  regardless of who authored it, and a hand-authored one gains no authority a model-authored one lacks:
  both traverse the identical *parse → validate → compile → canonical operation → governed execution*
  boundary. `PURSUIT_INTENT_ENABLED` gates **calling the model**, not deterministic compilation and not
  the already-certified P7 operations — so `?propose=` with the master OFF is not a feature-flag bypass.
- **Provenance records proposal ORIGIN.** `IntentProvenance.source` is a closed value — `HAND_AUTHORED`
  or `MODEL` — owned by the compiler; neither a caller nor a model may set or override it, and the
  closed proposal schema refuses any attempt to supply it. For Stage A, `source` is stamped
  deterministically as hand-authored and the model/provider fields are **null rather than fabricated**:
  recording a provider that was never called would make provenance a story instead of a record. The
  compiler/schema/context/vocabulary versions and digests are stamped regardless. **This is provenance
  only and is never an authority distinction.**

## L. Ruling record (authoritative — supersedes any recommendation above it)

> **THE GOVERNING INVARIANT: the model proposes intent. PursuitOS determines meaning and execution.**
>
> `user utterance → model proposal → deterministic compiler → canonical certified P7 operation →
> existing governed execution`. **Model output is untrusted input.**

1. **Model selects a `ViewKey` — APPROVED.** The model may **not** author a `PursuitQuery`; it selects
   from a closed registry of code-defined `ViewKey`s whose canonical plans already exist. It therefore
   cannot express arbitrary filters, arbitrary metrics, caller-defined cohorts, historical `asOf`,
   cross-org comparison, unregistered projection or new routing behaviour. If a requested capability
   cannot be represented by an existing `ViewKey`, the answer is `UNSUPPORTED` or
   `NEEDS_CLARIFICATION` — **never an approximation with a broader or different view.**
2. **Governed context references — APPROVED.** The model emits `{ fromContext: n }` and never a
   canonical UUID. **Before the model call**, deterministic code builds an **immutable
   `ContextManifest`** from already recipient-authorized context; each slot exposes only recipient-safe
   metadata required for interpretation, and the manifest carries a **stable digest/version**. The
   compiler resolves `{fromContext:n}` **only against the exact manifest associated with that
   proposal**. Rejected: out-of-range indexes · stale or mismatched context digest · model-authored
   UUIDs · arbitrary identifiers · references to entries not in the supplied manifest. **The model must
   not become an object-existence probe.**
3. **No model-authored answer prose in Slice 5.** The planning model **never receives the governed
   execution result**. The existing deterministic P7 surfaces render it. Slice 5 compiles intent only.
4. **Two-layer envelope — APPROVED.** `ModelProposal` is authored by the model and treated as
   untrusted; `CompiledIntent` is produced **only** by deterministic application code after validation.
   Compiler-stamped provenance may include the proposal schema version, compiler version,
   model/provider identifier, prompt/template version, `ContextManifest` digest, selected `ViewKey` and
   canonical operation. **The model cannot supply or override any provenance field.**
5. **Certification and the model — TWO STAGES.** The deterministic certification suite runs **entirely
   on hand-authored `ModelProposal` fixtures** and proves compiler semantics independently of any
   provider; **a live model response must never make deterministic certification PASS or FAIL by virtue
   of wording or nondeterminism.** Slice 5 is **not fully HOSTED ACCEPTED until the deployed Preview
   model path has been exercised**:
   - **Stage A — deterministic compiler acceptance** (`PURSUIT_INTENT_ENABLED=OFF`): proposal parsing,
     context binding, compiler behaviour and execution against hand-authored proposals.
   - **Stage B — live-model integration acceptance** (master enabled in Preview only): a bounded gate
     proving the real model is invoked · only the allowed registry/context vocabulary enters the prompt ·
     returned content is treated as `ModelProposal` only · malformed or unknown output is rejected
     without execution · no model output bypasses deterministic validation · a successful proposal
     compiles to a canonical operation and then uses the already-certified execution path.
     **It tests the boundary, not model intelligence** — no probabilistically exact wording or
     per-utterance proposal is required.
6. **Gating.** Add `PURSUIT_INTENT_ENABLED` as an **environment master, default OFF**. It gates
   **calling the intent model**, not the underlying deterministic P7 capabilities. The existing
   `pursuit_experience` tenant entitlement still applies. **No new `org_features` column.** **Not
   coupled to `dynamic_surfaces`.** Turning intent OFF must leave the previously certified
   deterministic P7 grammar unchanged.
7. **Clarification text is deterministic only.** The model may return `NEEDS_CLARIFICATION` and a
   **closed missing/ambiguity key**; application code renders the corresponding **registered** question.
   The model may not author clarification prose, and clarification copy must **never enumerate hidden
   objects or imply undisclosed alternatives**.
8. **Prompt-injection residual — ACCEPTED EXPLICITLY.** *Prompt injection may cause a different
   already-permitted read operation to be proposed than the user intended. It may not increase
   authority or create a capability.* **No confirmation step is required for Slice 5**, because every
   executable outcome is read-only and already governed. **But every successful execution must visibly
   render a deterministic canonical operation disclosure** — e.g. *"Interpreted as: Analyze open
   pipeline for this governed pursuit set"* — composed **from canonical registry metadata, never from
   model prose**, so the user can tell which operation actually executed. It must **not** display hidden
   implementation details, ids or governance reasons merely to satisfy this. **Any future action or
   write capability invalidates this no-confirmation ruling** and must enter the P5 action/approval
   contract.

**Required negative proofs** (in addition to §"Safety properties to prove"): the model cannot emit an
organization or principal · cannot emit a UUID · cannot emit a URL or path · an unknown `ViewKey`
rejects **before DB execution** · an out-of-range or stale `ContextRef` rejects **before DB execution** ·
context order or digest mismatch cannot retarget a reference · prompt text cannot define a new
`ViewKey` · prompt injection cannot introduce a field, metric, filter, cohort, route or action ·
malformed structured output executes nothing · `NEEDS_CLARIFICATION` executes nothing · `UNSUPPORTED`
executes nothing · identical compiled intents produce identical downstream behaviour regardless of
model wording · hand-authored and model-produced proposals compiling to the same `CompiledIntent`
execute identically · compiler-stamped provenance cannot be forged from `ModelProposal` fields · **the
operation shown to the user exactly matches the canonical operation actually executed.**

**Slice 5 remains:** pursuit only · read-only · no model-authored result prose · no arbitrary query
authoring · no fuzzy search · no hidden object lookup · no actions · no pinning · no exports · no
historical queries · no Dynamic Pursuit Surfaces · no schema · no P5/P6 changes.

---

---

## M. Stage B provider discovery — FINDING: STOPPED, awaiting a ruling

Stage A is **HOSTED ACCEPTED / CLOSED**. Stage B was authorized subject to a provider-discovery step
that must STOP rather than introduce provider infrastructure. It stopped. The finding:

**The provider abstraction EXISTS and is mature — nothing new would need to be introduced.**

| Question | Finding |
|---|---|
| Existing provider/client | `src/lib/ai/client.ts`, wrapping `@anthropic-ai/sdk` `^0.116.0` |
| Exact abstraction already used | `completeStructured` / `completeStructuredMeta` — the seam `intent/model.ts` already calls |
| Structured output | **Supported**: `messages.parse` with `output_config: { format: zodOutputFormat(schema) }` |
| Model identifiers | tier `cheap` = `claude-haiku-4-5` (what Slice 5 requests) · tier `frontier` = `claude-opus-5` |
| Required env var NAMES | `ANTHROPIC_API_KEY`, else `ANTHROPIC_AUTH_TOKEN` (the SDK's documented resolution order) |
| Already a deployed model surface? | **Yes** — `/ask` and `/api/palette` reach it through `lib/interpret`, gated by `INTERPRETER_ENABLED` (default `on`) |

**The blocker is the credential, not the infrastructure.**

> **No Anthropic credential exists in ANY Vercel environment on this project.**

Measured, with a validated control so the negative is not vacuous (§16B): `vercel env ls` exited 0 and
returned 52 lines; `DATABASE_URL` matched **3** entries (the control), `ANTHROPIC` matched **0** in any
environment, `PURSUIT_INTENT_ENABLED` **0** (consistent with Stage A's OFF proof), `INTERPRETER_ENABLED`
**0** (so it runs at its `on` default). A deployed serverless runtime also has no `ant auth login` OAuth
profile, which is the SDK's only other credential source.

**Therefore Stage B cannot begin without provisioning `ANTHROPIC_API_KEY` scoped to Preview** — the
owner's key, added to the owner's Vercel project. That is a credential-provisioning and environment
change, and it is theirs to make: this session neither holds such a key nor has authorization to add
one. Stopped here and returned for ruling, as §0 of the Stage B authorization requires.

**Two observations worth a decision at the same time.**

1. **`/ask` and `/api/palette` already attempt live model calls in Preview and fail closed.**
   `INTERPRETER_ENABLED` defaults to `on` and is unset, so the interpreter tier is live wherever those
   surfaces are reached; with no credential the call raises and the interpreter's catch returns a
   rejection, while the palette's deterministic-registry-first design means the failure degrades
   silently rather than erroring. Nothing is broken and nothing leaks — but it means **adding a Preview
   key switches that surface on too**, not only Slice 5's. Worth ruling on deliberately rather than
   discovering later.
2. **Temperature is not exposed by the existing seam.** `completeStructuredMeta` passes `model`,
   `max_tokens`, `system`, `messages` and `output_config` — no `temperature`. Stage B prefers
   temperature 0 where supported, so this needs a small **additive** parameter on the shared client
   (defaulting to today's behaviour, so no existing caller changes). Flagged rather than done, because
   it touches a module other features depend on.

## What this plan does not authorize

No Dynamic Pursuit Surfaces · no new fields · no new metrics · no new aggregates · no arbitrary
filters · no aliases that broaden identity resolution · no fuzzy object matching · no search · no
historical `asOf` · no cross-org comparison or ranking · no multi-row EXPLAIN · no pinning · no export ·
no actions · no P5 execution · no writes · no new schema · no new P5/P6 primitives · no model-authored
prose about governed data · no model-supplied organization, principal, route or identifier.
