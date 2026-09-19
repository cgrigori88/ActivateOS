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
