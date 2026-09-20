# P7 Slice 14 — Governed external read adapter (MCP)

**Status: LOCAL IMPLEMENTATION COMPLETE — awaiting hosted authorization.** No schema, no migration,
no alias movement, no P45, no hosted action. Certified Preview runtime remains `d59eb21`, schema 114.
**Sections 0–I below are the original design and discovery, retained as history;** what was actually
built is recorded in the implementation section at the end.

> **An external adapter may authenticate a caller, resolve that caller into PursuitOS's trusted
> execution context, submit a closed governed experience request, and serialize the canonical result.
> It may not become a second semantic or authorization layer.**

## 0. The headline finding: the adapter already exists, and it already is a second semantic layer

The brief said not to assume MCP infrastructure exists. It does — and considerably more of it than a
greenfield slice would assume:

| Component | Location |
|---|---|
| MCP server, JSON-RPC 2.0 over POST, protocol `2025-06-18` | `src/app/api/mcp/route.ts` (169 lines) |
| Tool registry — **10 tools (8 read, 2 write)** | `src/lib/agents/mcp-tools.ts` (393 lines) |
| Org-scoped API keys | `api_keys` (migration 0040) |
| Key resolution, SECURITY DEFINER | `resolve_api_key()` (migration 0062) → `resolveKey()` |
| Rate limiting | `@/lib/security/rate-limit`, applied in the route |
| Key administration UI | `src/app/admin/agent-keys.tsx` |
| Scope → governed role | `keyRole(scope)`: `read` → `viewer`, else `operator` |
| **Two** WRITE tools, already live | `draft_touch`, `request_warm_intro` → `dispatchSkill`, behind existing gates |

**And the load-bearing problem — stated more precisely than my first pass.** No tool references P7
machinery: no `executeExperience`, no `executePursuitQuery`, no `PLANS`, no `mayDerive`, no
`resolveDisclosure`. But *not traversing P7* is not the same as *ungoverned*: six of the eight reads
route through **certified P6-IG federation machinery** (consent ladders, joint rooms, settlement).
The accurate problem is narrower — **two tools compute P7-overlapping business concepts with their own
SQL**. They predate P7 (task #76), so this is an inheritance, not a regression. See D-S14 below for
the full ten-tool inventory and classification.

**Measured, not inferred.** Same clone, same organization, same `app_rw` substrate (§16K), both paths:

```
P7 governed ANALYZE, open-pipeline cohort   →  visibility EXACT · value 6,250,000
MCP tool `pipeline_summary`, same org       →  openCount 11 · totalUsd 8,040,000 · weightedUsd 3,361,500
                                               plus every opportunity name and amount
```

Neither number is wrong in isolation. They answer **different questions with the same words**: P7 sums
the registered `pursuit.open_pipeline_usd` metric across a *governed pursuit cohort*; the MCP tool sums
`opportunities.amount_usd` where the stage is not closed. An agent asking "what is my open pipeline"
gets a different answer depending on which interface it asks — which is exactly the second semantic
layer the governing sentence forbids.

**On disclosure — see D-S14 §D, which corrects a near-miss.** P7 was observed `WITHHELD` in Preview
under the OWNER substrate while MCP returned a number, which looks like a governance defect and is
not one: owner is not a legitimate P7 substrate, and under the deployed `app_rw` P7 discloses
6,250,000. The MCP path has no field-level disclosure machinery at all, but **no divergence has been
observed under a legitimate substrate**.

## Decisions requiring ruling

### A. Existing infrastructure — inventory above. **No external-identity blocker exists.**

Authentication, org binding, rate limiting, key administration and a tool registry are all present and
in production use. Slice 14 is therefore **not** blocked on external identity, and should not be
recorded as such.

### B. First tool / request shape — **one named bounded tool (approach A), not a request grammar**

Compared as ruled:

| | Named bounded tools | One `pursuit_experience` envelope |
|---|---|---|
| Authority surface | smallest; each tool is a certified capability | grows with the grammar |
| Schema stability | stable per tool | every new operation changes one schema |
| Model usability | high — the tool name *is* the intent | needs the model to compose a grammar |
| Accidental expansion | structurally hard | one permissive field widens everything |
| Versioning | per tool | one version for unrelated semantics |
| Preserving P7 semantics | adapter builds the request | invites exposing the internal AST |

**Recommendation: one named tool for the first vertical**, in PursuitOS's own vocabulary — e.g.
`open_pursuit_portfolio` — whose input schema is `{}` or a small closed selection, and which the
adapter translates into the canonical `PursuitExperienceRequest` internally. The envelope approach is
probably right *eventually*, but choosing it now builds the generic framework §21 forbids before a
second transport has demonstrated the seam.

**It must not expose** `SurfaceSpec`, compiler internals, `ContextManifest`, plan-registry keys, metric
implementation details or raw capability IDs. External callers do not program P7's AST.

### C. External authentication → `ExecutionPrincipal`

**The slot already exists and has never been filled.** `principal.ts` declares
`PrincipalSource = "web-session" | "api-credential" | "test-fixture"`, and its header anticipated this
transport by name. The path is therefore short and entirely within existing machinery:

```
Authorization: Bearer pos_…  →  sha256  →  resolve_api_key()  (SECURITY DEFINER, readable under app_rw)
                             →  { orgId, keyId, scope }       →  mint(orgId, "api-credential")
```

The request carries no principal, org, user, role, DB role, GUC or RLS posture — it cannot, because
`ExecutionPrincipal` is branded and `mint` is module-private.

### D. Multi-org selection — **already solved by the product, not a new decision**

API keys are **org-scoped**. The key *is* the org binding, so there is no "first membership", no
"most recently used", and no caller-supplied `orgId`. Selection and authorization are the same act:
issuing the key. A caller holding two keys selects an org by choosing a credential.

### E. Runtime placement — **inside the existing Next runtime, where it already is**

`/api/mcp` is already a route in the app, so it already uses `getPool()` and therefore the same
`app_rw` substrate. **Slice 13's `assertCanonicalSubstrate` already protects it** the moment it calls
`executeExperience` — no new substrate reasoning is required, and a separate process would have to
re-establish authentication, principal, substrate and tenant enforcement for no benefit. Isolation
from browser/session routes is by construction: the route authenticates by bearer key and never reads
a session cookie.

### F. `SurfaceResult` → MCP serialization

The thinnest possible mapping, and **presentation only**: component titles, `interpretedAs`, rows with
their disclosure state, aggregate value *or* its withheld marker, and the provenance versions. It may
format, label, structure and omit transport-inappropriate internals. It may **not** recompute metrics,
change membership, reinterpret `WITHHELD`, turn `NOT_AVAILABLE` into explanatory detail, enrich from
canonical tables, or call a model to improve the result.

**A withheld cell must serialize as withheld** — never as `null`, `0`, or an absent key that a model
would read as zero.

### G. Error / disposition mapping

| Canonical | MCP |
|---|---|
| no/!invalid bearer key | JSON-RPC auth error — **distinct from "not authorized"** |
| malformed tool arguments | JSON-RPC invalid params |
| `INVALID` | invalid request — no compiler detail |
| `CAPABILITY_DENIED` | capability not enabled for this tenant |
| `NOT_AVAILABLE` | governed unavailability — no reason, no count, no component |
| `NO_SELECTABLE_RESULT` | its own distinct value |
| `WITHHELD` cells/aggregate | carried **inside** a successful result, never an error |
| `FAILED` | internal error — no DB posture, role or connection detail |

**Not authenticated must never collapse into not authorized or unavailable**, and tenant existence
must not be inferable from the difference.

### H. Action reachability — structurally absent, with one honest caveat

Proposed structural rules: the new tool's registry entry is READ-only; the adapter imports no
`dispatchSkill` and no P45 entry point; the external request schema cannot express an ACTION
component; and the serializer has no action-affordance type.

**The caveat, stated rather than buried:** `draft_touch` — an existing, pre-P7 write tool reaching
`dispatchSkill` — is already live in this same route. Slice 14 **adds** no action reach, but it does
not remove what is already there. Whether that tool should continue to exist beside a governed read
adapter is a separate ruling, not something this slice should quietly decide.

### I. Rate / abuse / observability — mostly inherited

**Inherited:** per-key rate limiting already applied in the route; P7's own `limit: 50` per plan and
its closed registries bound result size; the substrate guard bounds authority.
**Genuinely missing:** a per-org (not just per-key) bound, and a query timeout for the governed read.
**Minimum observability:** transport, key id, org, tool name, disposition, latency and failure class —
**never** hidden result fields, full `SurfaceResult`, model prompts, or secrets. Read-only external
requests must not become canonical business mutations merely to be logged.

### J. Smallest first implementation

1. An `apiCredentialPrincipal(orgId)` resolver in `principal.ts` — mints `source: "api-credential"`.
2. One READ tool whose `run` builds the canonical `PursuitExperienceRequest` and calls
   `executeExperience(request, principal)`.
3. One thin serializer, `SurfaceResult` → MCP content.
4. Tests, including the structural proof that the adapter reaches no action path.

No new transport framework, no base class, no plugin registry, no second result model.

## The blocker that does exist — and it is not authentication

**The pre-existing MCP tools are a second semantic layer, and they demonstrably answer the same
business question differently from the product's governed surface (8.04M vs 6.25M).** Adding a
correctly-governed P7 tool beside them would leave two contradictory answers reachable through the
same interface, which is a worse outcome than either alone.

That needs its own ruling before implementation, and the options are genuinely different in kind:
migrate the existing tools onto P7, deprecate them, scope them to non-P7 domains, or accept the
divergence explicitly and document which tool is authoritative for what. **I am not choosing that
here**, because it is a product decision about existing certified behaviour rather than a design
detail of this slice.

## Threat model for an agent-facing surface (§12)

Read-only scope makes most of this tractable. **Recipient-visible business text is data, never
authority** — an account name, an explanation statement or an opportunity title that contains
instructions is still just a string in a governed result. The adapter must not feed result text back
into tool arguments, must not let returned content select the next tool, and must not resolve identity
from rendered text (§ Slice 5/7/8). The first vertical should require **no externally supplied
canonical IDs at all**, which removes the entire class of "model asks for a hidden id" attacks; the
proposed portfolio tool satisfies that.

## Not authorized by this contract

No implementation. No REST/GraphQL, no Slack/Teams, no external agents beyond the existing MCP
surface, no pins over MCP, no action exposure, no P45, no generic adapter framework.

---

# D-S14-LEGACY-MCP-SEMANTICS — discovery

**Discovery only. No product change.** Slice 14 remains **DESIGN SUBSTANTIALLY COMPLETE /
IMPLEMENTATION BLOCKED ON LEGACY MCP SEMANTIC CONVERGENCE.**

## A · Inventory — **ten tools, not six; two write tools, not one**

My first pass said six tools with one write. That was wrong: a truncated listing. The real surface:

| Tool | Scope | Advertised to read keys | Reaches | Machinery |
|---|---|---|---|---|
| `pipeline_summary` | read | yes | — | **1 direct query** on `opportunities` + `loadStageWeights` |
| `account_brief` | read | yes | — | **5 direct queries**: companies, propensity_scores, opportunities, account_digests, evidence |
| `overlap_status` | read | yes | — | `overlapLadder` — certified P6-IG |
| `joint_pursuits` | read | yes | — | `listJointPursuits`, `pursuitEvents` — certified P6-IG |
| `partner_context` | read | yes | — | `listPartnerships`, `listInitiatives`, `listEvidenceShares`, `settlementStatement` + 3 queries |
| `initiative_status` | read | yes | — | `listInitiatives` — certified P6-IG |
| `deal_context` | read | yes | — | `dealTimeline`, `accountDivergences` + 1 query |
| `org_skills` | read | yes | — | `listSkills`, `sharedInSkills` |
| **`draft_touch`** | **write** | **yes** | `dispatchSkill` → `draft_campaign_touch` | governed |
| **`request_warm_intro`** | **write** | **yes** | `dispatchSkill` → `request_warm_intro` | governed |

**A correction to my own earlier framing.** I reported that these tools "reference no P7 machinery",
which is true, and it invited the reading that they are *ungoverned*. Most are not: six of the eight
reads route through **certified P6-IG federation machinery** — consent ladders, joint rooms,
settlement — which has its own hosted certification. The accurate statement is narrower and more
useful: **they do not traverse P7, and two of them compute P7-overlapping business concepts with
their own SQL.**

## B · Classification of the eight read tools

- **A — overlaps a canonical P7 concept:** `pipeline_summary`.
- **B — partially overlaps:** `account_brief` (its `openOpportunities` block overlaps P7's pursuit
  portfolio; propensity, digests and evidence are legacy concepts P7 does not model).
- **C — no current P7 equivalent:** `overlap_status`, `joint_pursuits`, `partner_context`,
  `initiative_status`, `deal_context`, `org_skills`. These are intercompany-governance and
  account-context surfaces. **P7 owns pursuit experience, not consent ladders**, and inventing P7
  equivalents for them would be scope invention, not convergence.

**So the convergence problem is two tools, not ten.**

## C · Controlled comparison — `pipeline_summary` vs canonical P7

Same organization, same world, substrate held constant (§16K):

```
P7 governed cohort (deployed app_rw)  →  6,250,000  ·  SUM of pursuit.open_pipeline_usd@1 over 11 cohort members
MCP pipeline_summary (same org)       →  8,040,000  ·  sum of opportunities.amount_usd over 11 open opportunities
                                          weightedUsd 3,361,500 (stage weights — no P7 equivalent)
```

Both report **eleven** items, so this is not a membership difference. It is a **metric-definition**
difference: a registered per-pursuit metric over a governed *pursuit* cohort, versus a raw sum of
*opportunity* amounts. Two answers to "what is my open pipeline", reachable through one product.

## D · Disclosure analysis — **the STOP condition is NOT met, and I nearly reported that it was**

Measuring in the Preview world under the **owner** substrate produced this:

```
P7 open-pipeline cohort  →  WITHHELD, value null
MCP pipeline_summary     →  8,040,000
```

which reads exactly like the ruled STOP condition. **It is not one**, and the reason matters:

- The owner substrate admits a twelfth cohort member whose contribution is not disclosable, and the
  aggregate's own contract is *"computed only when EVERY member's contribution is disclosable to you;
  otherwise the whole aggregate is withheld"*. **The withholding was induced by the substrate.**
- **Owner is not a legitimate P7 execution substrate** — Slice 13 established exactly that, and
  `executeExperience` now refuses it.
- Measured under the **deployed `app_rw`** substrate, P7 **discloses** 6,250,000 over 11 members.

**Classification: mechanism absent, no divergence observed under a legitimate substrate.** The MCP
path has no field-level disclosure machinery at all, so it *could not* withhold if governance
required it — but no case has been observed where it discloses something canonical governance
withholds for a legitimate principal and substrate.

> **A methodological refinement to §16K, learned here.** "Hold the substrate constant" is not
> sufficient — constant *at an illegitimate value* can manufacture a divergence that does not exist
> operationally. The substrate must be held constant **at the certified one**.

## E · `pipeline_summary` disposition — **SCOPE AS DISTINCT** (recommended), or REPLACE

**MIGRATE IN PLACE is not available.** The existing response cannot truthfully carry canonical
semantics: `totalUsd` would silently change meaning, `opportunities[]` is opportunity-shaped where P7
is pursuit-shaped, and **`weightedUsd` has no P7 source at all** — stage weighting is a legacy concept
P7 does not model.

**SCOPE AS DISTINCT is the honest reading.** Opportunity-level, stage-weighted pipeline is a genuine
product concept with an editable-weights UI. What creates the collision is the *naming*: a tool called
`pipeline_summary` described as *"Open pipeline for this tenant"* is indistinguishable from the
canonical question. Renaming and rewording it to name the opportunity-level, stage-weighted concept
removes the ambiguity without destroying functionality, after which a canonical P7 tool can be added
with no contradiction.

**REPLACE** is the alternative if the product decides opportunity-level pipeline should not be
externally exposed at all. That is a product call, not a design detail, and I am not making it.

## F · `draft_touch` scope isolation — proven, with one real weakness

```
tools/list is NOT scope-filtered — both WRITE tools are advertised to every key
read scope → governed role "viewer"        write scope → "operator"
a read-scoped key attempting draft_touch  →  REJECTED, "insufficient permission (needs operator)"
consequential effect: NONE (campaign_touches 0 → 0)
the rejection IS recorded as a REJECTED invocation row
```

**Enforcement point:** `dispatchSkill`'s `ROLE_RANK` comparison — *not* the MCP route, which performs
no scope check of its own. **No authority breach:** a read key cannot cause the effect. **Two real
weaknesses:** the write tools are *advertised* to read-scoped keys, which invites an agent to try; and
a rejected attempt is a durable audit write reachable by any valid key.

## G · API key → `ExecutionPrincipal` — feasible, with no invented identity

After authentication the trusted record is `{ orgId, keyId, scope }` — organization, not person.
`ExecutionPrincipal` is `{ orgId, source }`, and `PrincipalSource` **already declares an unused
`"api-credential"` slot**. The shapes match exactly: **no human user needs to be synthesized**, and no
type extension is required. (Slice 12 pins need a *user*, which is precisely why pins stay out of the
first vertical.)

## H · Compatibility / usage evidence — **no consumers exist**

```
Preview api_keys: 0 rows, 0 with last_used_at
local canonical world: 0 rows
```

**Nothing is using this surface.** No external contract can break, so convergence carries no
compatibility cost and needs no deprecation window — which removes the risk that would otherwise have
forced a product-versioning ruling.

## I · Smallest convergence plan — one authoritative answer per concept

1. **Rename/reword `pipeline_summary`** to name the opportunity-level, stage-weighted concept, so no
   tool claims to answer "open pipeline" except the canonical one. (Or retire it — product call.)
2. **Add one governed read tool** whose `run` builds a canonical `PursuitExperienceRequest` and calls
   `executeExperience(request, apiCredentialPrincipal(orgId))`.
3. **Split the registry** — a governed read registry with no `dispatchSkill`/P45 import, beside the
   legacy/operator registry the route already dispatches by scope.
4. **Filter `tools/list` by key scope**, so a read key is not advertised write tools.
5. **`account_brief`** is class B: leave it, and record that its `openOpportunities` block is
   opportunity-shaped legacy data, not a P7 pursuit portfolio. Converging it is a later question.
6. Per-org rate accounting and an external execution timeout, as ruled.

No new semantic engine, no direct SQL in the governed tool, no adapter framework, no arbitrary
`SurfaceSpec` input, no schema change.

---

# IMPLEMENTATION — local, awaiting hosted authorization

> **P7 is authoritative for concepts P7 owns. Other certified domains may remain authoritative for
> concepts P7 does not own. Interface choice may not select between competing definitions of the same
> concept.**

## The tool registry, before and after

| Before | After | Why |
|---|---|---|
| `pipeline_summary` — opportunity amounts + stage weights | **`opportunity_pipeline_summary`** — unchanged semantics, explicit name | it answers a real but *different* question |
| — | **`pipeline_summary`** — governed P7 canonical open pipeline | one default answer to the generic concept |
| `account_brief` | `account_brief` — description now says `openOpportunities` is **not** the canonical metric | class B, left in place |
| six P6-IG reads | unchanged | class C — P7 does not own consent ladders |
| `draft_touch`, `request_warm_intro` | unchanged behaviour, now `scope: "operator"` | existing capability preserved |

## What was built

**`src/lib/agents/mcp-governed.ts`** — the governed registry. Its handler signature is
`run(orgId: string)`: **no pool, no client**. "This handler issues no SQL" is enforced by the type
rather than asked for in a comment, and it imports no `dispatchSkill` and no P45 entry point — read-only
external reachability cannot become action reachability because there is nothing to call.

**`apiCredentialPrincipal(orgId)`** in `principal.ts` — fills the `"api-credential"` `PrincipalSource`
that has been declared and unused since Slice 1. **No human user is synthesized**: an API key is an
org-bound service credential and `ExecutionPrincipal` is org-scoped, so the shapes already matched.

**Scope enforced at the transport.** `tools/list` is filtered by key scope, and — the part that
matters — `tools/call` refuses an out-of-scope tool **before** `dispatchSkill` is reached. Previously
the only barrier was `dispatchSkill`'s role rank: it correctly refused the *effect*, but the call was
accepted, dispatched and **recorded as a rejected attempt**, so a read key could produce durable audit
state by naming a write tool. `dispatchSkill`'s own check is untouched, as defense in depth.

An out-of-scope call is refused **identically to an unknown tool**. Refusing differently from the
listing would itself disclose that the tool exists.

**A per-organization rate bound** beside the per-key one, because keys are org-scoped and an
organization may hold several — a per-key ceiling multiplies with credentials issued. The limiter's
own honestly-stated weakness still applies: counters are per-instance.

## Evidence

**Unit 18/18 · behavioural 17/17**, the latter on a genuine `app_rw` substrate — §16K held at the
**certified** value, per the refinement below.

```
canonical pipeline_summary      → DISCLOSED 6,250,000 · cohort.open_pipeline_usd@1
opportunity_pipeline_summary    → openCount 11 · totalUsd 8,040,000 · weightedUsd 3,361,500
DISCRIMINATION: the two return materially different figures, as they should
neither silently returns the other's definition; the canonical result carries no weightedUsd,
  no openCount and no opportunities[]
PARITY: MCP and the canonical executor agree on metric identity, value and disclosure state
read-key list: no write tool · direct call of either write tool refused before dispatch
operator capability preserved · zero mutation, including zero rejected-action audit rows
```

**Serialization carries governed state, not a number.** A `WITHHELD` aggregate serializes with **no
`value` key at all** — not `0`, not `null`, not an absent field indistinguishable from missing data —
because the consumer is usually a language model and "0" would read as "nothing is in the pipeline".
All five canonical dispositions survive distinctly.

**Regression:** p7-slice14 18/18 · p7-slice13 27/27 · unit **859/859** · tsc clean · build clean ·
ordering-determinism 46/46 · seeded-clone 66/66 · p45-program 100/100 · **certify-world 52/52**,
protected digest `d43fe13b1f194132` unchanged.

Two certification suites — `lifecycle-query` and `tenant-isolation` — referenced the renamed tool and
broke. They exercise the **opportunity-level** implementation, whose semantics are unchanged, so they
follow the rename; neither assertion was weakened.

## §16K refinement (recorded here, not as a new standing section)

> **An equivalence test must hold the security substrate constant at the CERTIFIED/legal substrate,
> not merely at an arbitrary equal value.**

Holding it constant at an *illegitimate* value manufactured a divergence that did not exist
operationally — see D-S14 §D, where an owner-substrate comparison made P7 look as though it withheld
a figure the legacy tool disclosed.

## Two things recorded precisely

**Disclosure:** *no same-substrate disclosure divergence was observed.* The legacy direct-query path
lacks P7's disclosure machinery, but the owner-based `WITHHELD` comparison was invalid because
owner/BYPASSRLS is not a legal P7 substrate. **The legacy path is not a confirmed data leak**, and
equivalent disclosure machinery is **not** claimed to exist. Classification: *mechanism absent; no
divergent legitimate-substrate fixture observed.*

**Consumers:** *no active API-key consumers exist in the certified Preview or canonical world* — zero
keys, zero `last_used_at`. **Production has not been queried and remains untouched**, so this must not
be read as "no consumers exist anywhere". Active Production usage must be separately established
before any Production promotion if compatibility matters.

## STOP — execution timeout has no seam

§14 required a finite external execution bound that **actually bounds work**, and forbade
`Promise.race` theatre. There is no seam to use:

- `statement_timeout` appears **nowhere** in `src/` or `scripts/`;
- the application pool sets no statement or query timeout;
- there is no `pg_cancel_backend`, no client `.cancel()`, and no abort plumbing — the only
  `AbortSignal.timeout` uses bound **outbound HTTP**, not database work;
- `withTenantOrg` owns the transaction, and the adapter never sees the client.

**The smallest design that would actually bound the work:** a transaction-local
`set local statement_timeout` issued inside the tenant helper, opt-in per call site so existing
behaviour is unchanged where no bound is passed. That touches shared tenant infrastructure used by
every governed read, so it is a separate ruling rather than something to smuggle into Slice 14.
**No timeout was implemented, and none is claimed.**

---

# D-S14-EXECUTION-BOUND — seam analysis

**Discovery only. Nothing implemented.** `9e5e9d4` unchanged, certified runtime `d59eb21`.

## A · Every database transaction reachable from one canonical `pipeline_summary`

```
MCP pipeline_summary  →  apiCredentialPrincipal(orgId)  →  fixed PursuitExperienceRequest
  → executeExperience
      1. assertCanonicalSubstrate(getPool())   pool.query(POSTURE_SQL)   — memoized per pool
      2. resolveExperienceContext {kind:"NONE"}                          — NO database
      3. compileSurface                                                  — pure, NO database
      4. assembleSurface
           a. dynamicSurfacesEnabled(principal) → withTenantOrg          — TRANSACTION 1
           b. role read                                                  — ACTION-only; not reached
           c. runCompiledIntent → executePursuitQuery → withTenantOrg    — TRANSACTION 2
```

**Measured, not assumed.** Counting pool `acquire` events (every `withTenant*` checks out a client and
wraps it in one `BEGIN…COMMIT`, so a checkout *is* a tenant transaction):

```
tenant transactions per call: 2   (40 checkouts over 20 calls, exactly)
```

*(`pg_stat_database.xact_commit` was tried first and read ~0 — its flush lag is larger than an 11 ms
call, so it silently under-reports. The checkout event has no such delay.)*

Statements inside transaction 2: `begin` · `set_config(app.org_id)` · `experienceEnabledFor` ·
`resolveScope` · `loadCandidates` · `transaction_timestamp()` · `commit`. Transaction 1 is
`begin` · `set_config` · one `org_features` read · `commit`. **A bound placed on only the first query
would miss the governed read entirely** — this is why the policy must cover both.

## B · Tenant-helper transaction semantics

```ts
const db = await getPool().connect();
await db.query("begin");
await db.query(`select set_config('app.org_id', $1, true)`, [orgId]);   // is_local = true
const result = await fn(db);                                            // same client throughout
await db.query("commit");                                               // catch → rollback; finally → release
```

`BEGIN` precedes the GUC; the GUC is transaction-local; the callback receives that same checked-out
client and every statement inside runs on it; `COMMIT`/`ROLLBACK` ends it and the client is released.

**Therefore a `select set_config('statement_timeout', $1, true)` issued immediately after the org GUC
would govern every statement in that transaction and be discarded at commit or rollback.** It is the
right primitive.

## C · How a trusted limit reaches *both* transactions — recommendation

The bound is **not request semantics**, so it must not appear in MCP arguments,
`PursuitExperienceRequest`, `SurfaceSpec`, `ContextManifest` or any model/compiler input. It belongs
to the trusted execution boundary, beside the principal.

| | Option 1 — explicit policy parameter | Option 2 — AsyncLocalStorage scope |
|---|---|---|
| Blast radius | 7 optional params across 6 files | 2–3 files |
| Explicitness | total — visible at every hop | ambient |
| Cross-request leakage | impossible (no shared state) | relies on ALS correctness |
| Covers future components | **no — a new loader that forgets the param silently escapes** | yes, automatically |
| Testability | direct | needs isolation tests |

**Recommended: Option 1, plus a structural inventory test.** Explicit propagation matches the
codebase's grain and makes leakage impossible by construction. Its one real weakness — *silent escape*
when a future governed read opens a transaction without threading the policy — is exactly the failure
mode this codebase already closes with inventory tests (see the Slice 12 access-path inventory). A
test that enumerates every `withTenant`/`withTenantOrg` call site reachable from `executeExperience`
and asserts each accepts and forwards the policy converts a silent escape into a failing build.

I record the counter-argument rather than hiding it: Option 2 covers future paths automatically, and
a resource bound can only ever *narrow*, so it is not the authority-shaped ambient state P7 fought
over `ExecutionPrincipal`. If churn is judged unacceptable, Option 2 is defensible — but it needs its
own isolation proof.

## D · Exact files and signatures Option 1 would change

All additions are **optional parameters**; every existing caller behaves identically.

```
src/lib/db/tenant.ts                          withTenantOrg(orgId, fn, opts?: { statementTimeoutMs })
                                              withTenant(fn, opts?)
src/lib/experience/execute.ts                 executePursuitQuery(candidate, principal?, policy?)
                                              resolveGoTo(candidate, principal?, policy?)
src/lib/experience/intent/run.ts              runCompiledIntent(intent, principal?, policy?)
src/lib/experience/surface/assemble.ts        dynamicSurfacesEnabled(principal?, policy?)
                                              assembleSurface(validated, principal?, policy?)
src/lib/experience/surface/execute-experience.ts  executeExperience(request, principal, policy?)
src/lib/agents/mcp-governed.ts                supplies the policy (the only production caller that does)
```

Validation belongs in `tenant.ts`: the value is clamped to a fixed internal range, and a
zero/negative/absent value means *no bound*, exactly as today. It is set with the repository's
parameterized `set_config($1, true)` pattern — never string interpolation — and the pool is never
configured globally.

## E · Is a per-statement bound sufficient here? **Yes for this tool — and it is not a deadline**

`statement_timeout` bounds each statement, not the request. For this **fixed** vertical that is
enough, because the work is closed:

- the tool takes **no arguments**, so a caller cannot widen the query;
- the plan is registry-closed with `limit: 50`;
- the statement count is fixed and small — **2 transactions, ~11 statements total**;
- worst case is therefore bounded by `statements × timeout`, not unbounded.

**I will not call that a wall-clock deadline, because it is not one.** A hard per-request deadline
would additionally need server-side cancellation, which does not exist here.

Worth recording: the MCP route sets no `maxDuration`, so the **platform function timeout already
bounds the HTTP response** — but it terminates the *response*, not the database work, which is
precisely why a DB-level bound is still required.

## F · Proposed value — from measurement

```
canonical pipeline_summary, warm pool, 11-pursuit seeded org:
  samples (ms): 9, 10, 10, 11, 11, 11, 11   ·   median 11 ms   ·   max 11 ms
  2 tenant transactions per call
```

**Proposed external statement timeout: 5,000 ms** — roughly 450× the observed median, leaving
substantial headroom for hosted network latency, a colder pool and a larger tenant, while still
bounding a pathological statement far below the platform function timeout. It is a resource-control
number, not a product constant, and belongs beside the rate limits rather than in P7 semantics.

## G · Timeout failure semantics — already correct, and it should stay that way

PostgreSQL raises `57014 query_canceled` — *"canceling statement due to statement timeout"*. Then:

1. `withTenantOrg`'s `catch` issues `ROLLBACK` and rethrows; `finally` releases the client.
2. The error propagates out of `executeExperience` — it is **not** converted into a governed outcome,
   which is right: a resource refusal is not `WITHHELD`, not `NOT_AVAILABLE`, not `INVALID`, and
   certainly not a zero pipeline.
3. The MCP governed branch already catches it and returns `{ status: "FAILED" }` with no message.

So no partial `SurfaceResult` is emitted and no SQL, role or stack reaches the caller. **The only
addition needed is internal diagnostic classification** — recognising `57014` so a timeout is
distinguishable in logs from an unexpected defect, without that distinction reaching the recipient.

## H · Pool/session leakage test design

```
1. run a bounded transaction with a deliberately tiny timeout against a slow statement
      → expect 57014, ROLLBACK, client released, no durable mutation
2. immediately run an ORDINARY unbounded tenant transaction on the SAME pool
      → expect normal success under the default policy
3. assert the second transaction's `current_setting('statement_timeout')` is the server default
```

Step 2 is the discriminatory one: it fails if the transaction-local setting leaked to the next
borrower. Plus a mutation check across both, proving a timeout produces no canonical, action or P45
state.

## I · Org rate-limit mechanics (reported, not redesigned)

```
key bucket:  `mcp-key:${key.keyId}`   60 / 60s
org bucket:  `mcp-org:${key.orgId}`  240 / 60s
```

`key.orgId` comes from `resolve_api_key()` — the credential record — and never from request input;
the route reads `const orgId = key.orgId` and no caller field can influence it. **Both bounds apply**,
key first then org. State is the existing **in-memory, per-instance** limiter, whose own header states
the limitation honestly: on serverless the effective ceiling is `limit × concurrent instances`. No
defect found in the trace; not redesigned.

## D-S14-EXECUTION-BOUND — completed whole-request graph

The earlier trace began at `executeExperience` and estimated ~11 statements. **Measured end to end,
with authentication included, the real figure is 44 — and the count scales with result rows.** That
revision changes the timeout arithmetic materially, so it is reported before anything is built.

### A · Every statement in one warm external request — 44, measured

```
 1.  select org_id, key_id, scope from public.resolve_api_key($1)   ← AUTH, pool-level, UNBOUNDED
 2–5.  TRANSACTION 1  begin · set_config(app.org_id) · org_features read · commit
 6–44. TRANSACTION 2  begin · set_config(app.org_id) · org_features read · loadCandidates
                      · then THREE statements PER ROW × 11 rows = 33
                      · transaction_timestamp() · commit
```

The per-row triple is `pursuits org check` · `context_grants scope` · `opportunities amount` — the
governance and metric computation for each pursuit.

**Counting method:** every statement is tagged on the client returned by the pool's `acquire` event.
A first attempt wrapped `pool.query` *as well* and double-counted, because pg's `Pool.query` checks
out a client internally; and a first run reported `CAPABILITY_NOT_ENABLED` because the capability
conjunction was not armed in the child, so the vertical short-circuited before the governed query.
Both were measurement defects, corrected.

**The closed formula:** `1 (auth) + 4 (tx1) + 6 + 3 × rows (tx2)` → **`11 + 3 × rows`**, plus one
cold-start posture query. The plan's `limit: 50` closes it: **worst case 162 statements.**

### B · Unbounded externally-triggerable statements today

| Statement | Where | Bounded today? |
|---|---|---|
| `resolve_api_key($1)` | `resolveKey`, `pool.query` | **No.** Preceded only by the IP limiter (120/60s) — the key/org limiters run *after* it |
| `POSTURE_SQL` | `assertCanonicalSubstrate`, `pool.query` | **No.** Once per pool — cold start, new instance, recreated pool |
| all 42 tenant statements | two `withTenantOrg` transactions | **No** |

A bearer that does not begin with `pos_` is rejected **before** any database work; an invalid key that
*does* carry the prefix still reaches `resolve_api_key`.

### C · One shared primitive is justified — two call sites, identical need

`resolve_api_key` and `POSTURE_SQL` are each a single statement issued on the *pool*, so neither is
inside a transaction and neither can carry a transaction-local GUC. Both need the same thing: check
out one client, `BEGIN`, set the local bound, run, `COMMIT`, release. That is the ruling's own test
for extracting `withStatementBound(pool, timeoutMs, fn)` — **multiple** pre-tenant statements needing
the same mechanism, not abstraction for its own sake.

`withTenantOrg` does **not** need to be refactored onto it: it already owns a transaction and need only
add one more `set_config` when a policy is present.

### D · Propagation graph

```
POST /api/mcp
  ip rate limit                                  (no DB)
  EXTERNAL_READ_POLICY = { statementTimeoutMs }  server-owned constant, never caller input
  resolveKey(pool, bearer, policy)               → withStatementBound
  key + org rate limits                          (no DB)
  governed.run(orgId, policy)
    executeExperience(request, principal, policy)
      assertCanonicalSubstrate(pool, policy)     → withStatementBound (uncached path only)
      assembleSurface(validated, principal, policy)
        dynamicSurfacesEnabled(principal, policy) → withTenantOrg(…, policy)
        runCompiledIntent(intent, principal, policy)
          executePursuitQuery(plan, principal, policy) → withTenantOrg(…, policy)
```

### E · Files and signatures

```
src/lib/db/execution-policy.ts   NEW — ExecutionPolicy { statementTimeoutMs?: number }, clamped
src/lib/db/tenant.ts             withStatementBound(pool, ms, fn)  NEW
                                 withTenantOrg(orgId, fn, policy?) · withTenant(fn, policy?)
src/lib/env/db-posture.ts        assertCanonicalSubstrate(pool, policy?)
src/lib/agents/mcp-tools.ts      resolveKey(pool, bearer, policy?)
src/lib/agents/mcp-governed.ts   GovernedToolDef.run(orgId, policy?) — supplies the constant
src/app/api/mcp/route.ts         owns the constant; passes it to resolveKey and run
src/lib/experience/execute.ts    executePursuitQuery(…, policy?) · resolveGoTo(…, policy?)
src/lib/experience/intent/run.ts runCompiledIntent(…, policy?)
src/lib/experience/surface/assemble.ts  dynamicSurfacesEnabled(…, policy?) · assembleSurface(…, policy?)
src/lib/experience/surface/execute-experience.ts  executeExperience(…, policy?)
```

`ExecutionPolicy` lives under `src/lib/db/` so `tenant.ts` and `db-posture.ts` can use it without
importing from `experience/` — the wrong direction. All parameters optional; web callers unchanged.

### F · The finite bound, stated exactly

> **`11 + 3 × rows` statements, `rows ≤ 50` by the registry-closed plan, plus one cold posture query
> and one authentication query — a maximum of 162 externally-triggerable statements per request, each
> individually bounded by a PostgreSQL `statement_timeout`.**

It is **not** a request deadline. Worst-case database *work* is `162 × timeout`.

### G · The 5,000 ms value should be revised **down**

5,000 ms was accepted before the statement count was known. The arithmetic now:

| Per-statement bound | Worst-case DB work | Headroom vs observed |
|---|---|---|
| 5,000 ms | **810 s** | 20,000× per statement |
| 1,000 ms | 162 s | 4,000× |
| **500 ms** | **81 s** | **2,000× per statement; ~45× the whole warm request** |

Observed: 44 statements in ~11 ms — roughly **0.25 ms per statement**. Hosted adds pooler round-trip
latency per statement (tens of ms), so 500 ms still leaves well over an order of magnitude.

**Recommended: 500 ms.** The pool holds `max: 5` connections, so bounding how long one external
request can occupy a connection is the point; 5,000 ms would let a single pathological request hold
one for over a minute per statement.

**A finding I am not proposing to fix here:** the three-statements-per-row pattern is an N+1 in the
governed read path. It predates Slice 14 and is why a per-statement bound multiplies. Reducing it is a
P7 performance change, out of scope for this slice, and it is the reason a per-request deadline would
be strictly better than a per-statement bound if one ever becomes available.

### G (cont.) · Two further facts found while checking the arithmetic

`src/db/client.ts:92` — the pool is `max: 5` (`PG_POOL_MAX`), **and it already sets
`connectionTimeoutMillis: 5_000`**. That existing 5,000 ms bounds *checking a connection out*, which
is a different thing from bounding a statement. Giving the statement bound the same number would put
two unrelated limits at one value in every log and trace; that alone argues for a distinct figure.

The comment at `client.ts:74` also notes each serverless instance builds its own pool, so `max: 5`
is per instance — connection-hold time is the scarce resource, which is what a per-statement bound
is actually protecting.

---

## D-S14-EXECUTION-BOUND — IMPLEMENTED

### The invariant, phrased exactly

> **Every workload-bearing PostgreSQL statement reachable from the governed external
> `pipeline_summary` request is subject to the trusted per-statement PostgreSQL execution bound.**

Not *every* statement. A transaction must execute `begin` and a transaction-local
`set_config('statement_timeout', …)` **before that bound exists at all**. Those are fixed control
statements — identical on every call, carrying no caller-shaped work — and claiming they are bounded
would be false. Measured: **11 control statements, 38 workload-bearing**, and every one of the 38 ran
under an established bound.

### The arithmetic changed when the bound was added, and the earlier figure was wrong

The seam analysis reported `11 + 3 × rows` (max 162). That was measured **before** the bound existed
and it counted the tool without authentication. Re-measured on a real `app_rw` substrate with the
policy in force:

| | per request | at `rows = 50` |
|---|---|---|
| **Total statements** | `16 + 3 × rows` = **49** at 11 rows | **166** |
| — workload-bearing (what the bound covers) | `5 + 3 × rows` = **38** | **155** |
| — control (`begin`/`commit` ×3, `app.org_id` ×2, `statement_timeout` ×3) | **11** | 11 |
| Cold substrate certification, when uncached | +4 (1 workload-bearing) | +4 |

Three bounded transactions per request: authentication, capability, governed query.

**Worst-case sequential bounded database work: 155 × 500 ms ≈ 77.5 s** (≈78 s including a cold
posture read). That is an upper-bound reasoning aid — **not** an SLA, **not** a request timeout and
**not** a latency prediction. Measured normal execution is **11 ms**. The bound exists to stop one
statement from holding one of the pool's five connections indefinitely.

### Evidence — 47 checks, 0 failures, on an isolated `app_rw` scratch clone

**§13 A–D — the primitive.** A 5 s statement under a 500 ms bound was cancelled at **510 ms** with
PostgreSQL `57014`. The same connection (`max: 1`, so provably the same one) then served the next
query — which *is* the rollback proof, since an un-rolled-back transaction answers `25P02`.
`statement_timeout` was back to the server default, and an ordinary transaction on that connection
carried the default. Concurrency was sequenced with **advisory locks and verified through `pg_locks`**
— the bounded transaction was observed *actually waiting* before the assertion was made, rather than
inferred from a sleep: the concurrent ordinary transaction kept its own default. No connection was
destroyed to recover, and a new bounded transaction worked immediately afterwards.

Two negative controls bite: an unbounded 1 s statement on the same pool **completes** (1002 ms), and
the same slow fixture without a policy runs to **5003 ms**. The bound, not the environment, is what
stops the work.

**§14 — authentication.** A null bearer and a wrong-prefix bearer each cost **zero** database
statements. A syntactically valid unknown key runs exactly four — `begin`, `set_config`, `resolve`,
`commit` — and yields no principal. A valid key resolves through the same four. A deliberately slow
resolver (the function replaced **in the scratch database only**, then restored — no product SQL
touched, no bypass added) is cancelled at **503 ms** with no principal established.

**§15 — substrate.** An owner pool is refused, and refused *again* — a failed posture never enters the
WeakSet. The `app_rw` pool certifies through a bounded transaction, and a second certification issues
**no statement at all**, so the fast path is intact. For the timeout case `pg_roles` was shadowed for
one probe connection via `search_path` in the connection options: the posture read was cancelled at
508 ms, refused *because the statement was cancelled* rather than because posture was wrong, and that
pool stayed uncertified. A fresh pool then certified normally.

**§16 — the whole request.** 49 statements, 38 workload-bearing, **0 unbounded**, 0 executed outside a
transaction, and the canonical answer unchanged: `DISCLOSED 6,250,000`. Semantic discrimination
re-run separately, 17/0 — canonical 6,250,000 vs opportunity 8,040,000, MCP/web parity intact, scope
still refused before dispatch, zero mutations.

### The inventory test is load-bearing — proven by mutation

Three mutations were applied and each was caught:

| mutation | caught by |
|---|---|
| drop `policy` from the governed query's `withTenantOrg` | inventory · transactions passed the policy |
| add a **new** unbounded `withTenantOrg` to the assembly path | inventory · transactions passed the policy |
| let a caller-supplied `timeout` reach the policy | inventory · transport elects the policy **and** no caller input reaches the bound |

The sweep parses call sites with a depth-zero argument splitter rather than matching strings, and
carries an anti-vacuity guard asserting it found at least six transactions — the failure mode where
an extractor silently matches nothing and every assertion passes by looking at zero call sites.

### One §16A repeat, caught in my own instrument

The "no ambient state" scan matched `execution-policy.ts` — on its own prose explaining that
`AsyncLocalStorage` was **rejected**. The file was failing for documenting the ruling it obeys.
Scoped to stripped code, with a control asserting the prose still exists.

### Not fixed, and deliberately so

The governed query issues **three statements per result row**. It predates Slice 14 and is why the
finite graph grows to 166 at the row limit. It is **existing P7 performance debt** — not a Slice 14
semantic defect, not a governance defect, and not a reason to redesign the query during this slice.
A later performance task may reduce the count without changing canonical semantics.

### Rate bounds — unchanged, and honestly stated

IP 120/60 s before any credential database work; key 60/60 s; org 240/60 s; the org comes only from
the trusted API-key record. Counters remain **in-memory and per-instance** (see `rate-limit.ts`), so
these narrow abuse rather than eliminating it. That is a real limitation of the serverless deployment
and is not claimed to be a distributed rate limit. No limiter was redesigned here.

### Regression

`tsc` clean · `next build` clean · unit **873/873** · `certify-world` **52 suites clean, 0 failures**,
world digest `d43fe13b1f194132` identical before and after · Slice 14 behavioural **17/0** ·
D-S14 bound evidence **47/0**.

Eleven unit assertions across Slices 6–13 pinned call text like `runCompiledIntent(intent, principal)`
and broke on the added parameter. Each was updated to match the callee and ordering it was actually
asserting; none was weakened. The Slice 13 assertion that `assertCanonicalSubstrate` "takes no options
at all" was the one that needed real care — it guarded against a caller selecting the substrate, so it
now pins the parameter list exactly and additionally asserts that `ExecutionPolicy` carries a timeout
and nothing that could name a role, pool or connection.

---

# P7 SLICE 14 — HOSTED ACCEPTED / CLOSED

**Serving commit `e55499b` · hosted schema 114 · 173 assertions, 0 failures.**

Preview/demo · `app_rw` · `bypassRls` false · tenant enforcement true · live probe · external sending
disarmed · P45 inactive · **Production `qifatlqxfuhwrwvpbwsc` never addressed by any process in this
gate** · **no deployment, no redeploy and no alias movement performed by the gate or its closeout**.

## The evidence, exactly as observed

| Phase | Result |
|---|---|
| **R1** — what the certified hostname serves, posture, substrate facts, pre-gate world baseline | **23 / 0** |
| **Hosted H1–H7, H9–H11** — registry convergence, credential→principal, read/operator separation, canonical semantics, opportunity discrimination, MCP/web parity, the trusted bound, rate bounds, phase-accounted mutation | **116 / 0** |
| **H8** — a genuine governed WITHHELD end to end, on an isolated certified `app_rw` clone | **14 / 0** |
| **H13** — final state against the R1 baseline | **20 / 0** |
| **Total** | **173 assertions / 0 failures** |

**Final durable delta: `audit_log` +2 — one `agent_key.minted`, one `agent_key.revoked`, both
explicitly accounted API-key lifecycle records.** No temporary API key remains (`api_keys` is empty,
as it was pre-gate, and no key by the gate's naming convention exists in any state). P45 remains
inactive and zero across `pursuit_runs`, `pursuit_run_steps` and `pursuit_run_approvals`. Protected
business and security state is unchanged: `pursuits`, `opportunities`, `campaigns`,
`campaign_touches`, `context_grants`, `organizations`, `org_members` and
`pinned_surface_definitions` are byte-identical to the pre-gate fingerprint, and `audit_log` is the
only table of 161 that differs.

## What the gate proved that the earlier passes could not

Two corrections landed after the first gate was written — `d977b56` (cohort completeness) and
`e55499b` (batched fact acquisition) — so the gate was extended rather than re-pointed.

- **Membership is the complete governed cohort, in the code that is serving.** `analyze()` accepts
  only a sealed cohort, the executor seals from every governed candidate *before* ordering and
  *before* the limit, and the rendered basis (11) equals this organization's whole open-pursuit set.
- **The cohort here cannot discriminate truncation, and that is stated rather than implied.** Eleven
  members against a `plan.limit` of 200 means the pre-correction code would have returned the same
  figure. The discriminating evidence — 212 members reporting `basis.members` 200, and a
  non-derivable member pushed out of the page turning WITHHELD into DISCLOSED — was produced on
  seeded `app_rw` substrates (§16L).
- **The statement graph was measured on the deployed runtime, not inferred.** `pg_stat_statements`
  attributed to `app_rw` isolates the serving process from the gate's own owner queries, which run as
  `postgres`. One canonical `pipeline_summary` cost **19, 19, 19** statements across three
  measurements, with a **0**-statement quiet-window control proving the counter attributes traffic
  rather than drifting. The same 19 was measured locally at 11, 212 and 2,011 members.
  **Independence of N is not measured hosted and is not claimed** — this tenant has one cohort size.
- **A governed WITHHELD survives batching.** On an isolated certified `app_rw` clone, one ACTIVE
  participation on a foreign pursuit turns DISCLOSED into WITHHELD, serialized by the deployed
  adapter with no `value`, no `currency` and no member count; removing the participation restores the
  original figure exactly. The boundary crossing costs **one** extra statement — the cohort-wide
  derivation-grant read — where per-row acquisition cost four per member: **the cheaper graph
  produced the stricter answer.**

## Invariants this slice closes on

1. **The semantic cohort is the complete governed cohort, never the presentation page.**
2. **Presentation cardinality cannot redefine aggregate membership.**
3. **An aggregate is disclosed only when every member of the stated governed cohort has a disclosable
   contribution.**
4. **Multiple live qualifying derivation grants compose by union; each independently confers only what
   it permits.** First-by-id selection when several grants independently permit is **deterministic
   diagnostic selection only — a citation, not a precedence rule**: removing the named grant changes
   the citation and not the decision.
5. **Batching changes fact acquisition, not governance meaning.**
6. **The canonical external read has a PostgreSQL statement-count ceiling independent of cohort
   cardinality, and every workload-bearing statement is additionally protected by the trusted 500 ms
   statement timeout.**
7. **Application-side governance evaluation remains O(N).** No constant CPU, memory, pool-wait or
   request wall-clock guarantee is implied or claimed.
8. **External transport creates no alternate identity, authority, disclosure or business-semantic
   layer.**

## Defects

| Defect | Disposition |
|---|---|
| **D-P7-COHORT-COMPLETENESS** | **HOSTED ACCEPTED / CLOSED** — see §16L and `docs/d-p7-cohort-completeness.md` |
| **D-S14-EXECUTION-BOUND** | **HOSTED ACCEPTED / CLOSED** — trusted per-statement bound plus the bounded statement graph, measured hosted |
| **D-P6-DERIVATION-MULTIGRANT** | **ACCEPTED / CLOSED** — union rule, permanent coverage in `dp6-multigrant`; see `docs/d-p6-derivation-multigrant.md` |
| **D-P6IG-GOVERNANCE-FLAKE** | **OPEN / UNCHARACTERIZED** — not closed by this slice |

**D-P6IG-GOVERNANCE-FLAKE, recorded without erasing what was observed.** One run of
`p6ig-governance` on `0f5f40e` reported **91 passed, 1 failed** on a seeded clone. Every subsequent
run has been clean — nine consecutive **92 / 0** runs during the Slice 14 work, plus **92 / 0** again
at closeout — and `certify-world` is **52 suites clean, 0 failures**. **The failing assertion's name
was never captured**, so the root cause, the trigger and the failure rate are all unknown. It is a
separate historical intermittent, it is not a Slice 14 regression, and a clean re-run does not close
it.

## Permanent coverage added at closeout

`scripts/dp6-multigrant-verify.ts`, registered as the SEEDED_CLONE suite **`dp6-multigrant`**
(**38 / 0**):

- the **historical unordered `limit 1`** kept verbatim as a negative control, with the bite taken by
  enumeration — the decision core's verdict on each qualifying grant *alone* is one ALLOW and one
  DENY, which is precisely the choice set an unordered query was free to return, while the union rule
  allows. Which row the control actually returns is deliberately not asserted;
- **two-path discrimination** across eleven grant shapes: the one-row `mayDerive` and the cohort
  loader must reach the same decision, same named grant, same retention and same refusal reason,
  under a real `app_rw` session, with an anti-vacuity check that the cases produced both ALLOW and
  DENY;
- **first-by-id is a citation, not precedence**: both loaders order by `id`, the named grant is the
  lowest id and is stable across repeated evaluation, and deleting it leaves the decision ALLOW while
  changing the citation.

## Closeout regression

`tsc` clean · unit **902 / 902** · `dp6-multigrant` **38 / 0** · `p6ig-governance` **92 / 0** ·
`federation` **19 / 0** · `certify-world` **52 suites clean, 0 failures** (run at `e55499b` during the
slice). **The hosted gate was not repeated for the closeout, because the closeout changes no
production or runtime code**: the certified Preview hostname still serves `e55499b`, and no
deployment or alias move occurred.
