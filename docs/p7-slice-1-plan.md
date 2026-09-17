# P7 Slice 1 — implementation plan (NO CODE AUTHORIZED)

**Status:** **RULED AND AUTHORIZED** (ruling recorded in §11). Implementation of §1–§7 is authorized;
no schema, no migration, no change to P5/P6.
**Contract:** `docs/p7-pursuit-experience-analysis-contract.md` (accepted at `2b3d49d`).
**Constraints in force:** read-only · one canonical object class · one deterministic query path ·
closed registry · no new tables · no schema · **no LLM** · no pinning · no actions · `asOf = null`
only · no cross-org ranking · no P5/P6 change unless a genuine missing primitive is demonstrated.

---

## 0. Required flag trace (ruling 5), performed before proposing anything

### 0.1 What `pursuitExperience` actually is

**Two readers exist, with different semantics. This matters and the plan depends on it.**

| Reader | File | Consults | Semantics |
|---|---|---|---|
| `pursuitExperienceEnabled()` | `src/lib/pursuits/experience-flags.ts:38` | **environment only** | `PURSUIT_EXPERIENCE_ENABLED` **and** `PURSUITS_ENABLED` **and** `FACTS_ENABLED` **and** `ROUTING_ENABLED`. Fails safe: reports OFF unless every dependency layer is on. |
| `experienceEnabledFor(db, orgId)` | `src/lib/pursuits/tenant-flags.ts:68` → `tenantFeatures()` | **environment master AND the org row** | `base(pursuits) && base(facts) && base(routing) && base(pursuit_experience)`, where `base(flag) = envEnabled(flag) && org_features[flag]`. |

Established call sites of the env-only reader: `src/app/layout.tsx:177` (shell prop),
`src/app/page.tsx:72`, `src/app/pursuits/page.tsx:23` (`notFound()` fast deny),
`src/app/pursuits/[id]/page.tsx:52`, and five guards in `src/app/pursuits/[id]/actions.ts`.

**Finding:** `pursuitExperience` does correctly represent "access to the Pursuit experience layer",
and it already gates exactly the surface class Slice 1 belongs to. **No new flag is needed, and none
is proposed.** Two precisions the plan adopts rather than glossing over:

1. The existing app routes use the **env-only** reader. It is a deployment master, not a tenant
   decision. Slice 1 therefore uses **both**: `pursuitExperienceEnabled()` as the fast deny before
   any database work, and `experienceEnabledFor(db, orgId)` **inside** the governed path once the org
   is resolved. Using only the env master would let an org without the feature read a P7 surface.
2. `pursuitExperience` is **not** an umbrella. It does not grant attention, coordination,
   intelligence, federation or governed action, and Slice 1 exposes nothing that requires them (§2.3).

### 0.2 A reserved capability already exists for the later slices

`src/lib/env/vnext-flags.ts:126` declares `dynamicSurfaces` — *"Task-specific composed views over
canonical data"* — composed at line 164 as `vnextEnvEnabled("dynamic_surfaces") && pursuitIntelligence`.

It is **declared and unit-tested but wired to nothing**: the only references outside the flag module
are in `tests/vnext-flags.test.ts`. That is the correct future gate for **generated / composed**
surfaces (contract slices 6–7), and its dependency on `pursuitIntelligence` already matches the
ruling that P7 operations inherit the capability of the function they expose.

**Slice 1 does not use it**, because Slice 1 renders a **fixed, code-defined projection**, not a
generated surface. Claiming `dynamic_surfaces` now would drag in `pursuitIntelligence` for a surface
that exposes none of it — the precise "flag added to satisfy a gate" failure the standing rule forbids.

### 0.3 Capability inheritance for Slice 1

| What Slice 1 exposes | Capability required |
|---|---|
| canonical pursuit fields (identity, stage, status, timing, account) | `pursuitExperience` (env master + org row) |
| one canonical metric over the pursuit's own open opportunities | `pursuitExperience` — no attention, no intelligence |
| **P2 pertinence** | **not exposed in Slice 1** (would require `pursuitAttention`) |
| **coordination / plan / motion data** | **not exposed** (would require `pursuitCoordination`) |
| **cross-org derived content** | **not exposed** (federation path; P6 still runs on everything) |

Excluding P2 from Slice 1 is deliberate: it keeps the first vertical inside one capability while still
exercising the metric registry end to end.

---

## 1. The exact object class

**`pursuit`** — one class, nothing else.

Chosen because it is the canonical spine of the product, it is org-scoped and RLS-protected, its
visibility already runs through `can_see_pursuit` (including the 0112 effective-participation window),
and it has an established read-model layer. No other class is registered in Slice 1: not account, not
contact, not opportunity, not partner. A plan naming any of them fails validation.

---

## 2. The exact registry entries

Everything below is a **code-defined constant**. Nothing is user-creatable, model-creatable or
runtime-insertable. The registry is the closed vocabulary of Slice 1 **in its entirety**.

### 2.1 Object class

```
ObjectClass "pursuit"
  canonicalTable:   pursuits           (referenced by the loader, never by a plan)
  identity:         pursuits.id
  tenancy:          org_id + RLS + can_see_pursuit
  loader:           a read-only canonical loader (existing read-model style)
```

### 2.2 Fields (`FieldRef`) — the complete projection vocabulary

| `FieldRef` | Canonical source | Information class | Disclosure audience |
|---|---|---|---|
| `pursuit.id` | `pursuits.id` | identity | participant-visible |
| `pursuit.status` | `pursuits.status` | lifecycle state | participant-visible |
| `pursuit.pursuit_type` | `pursuits.pursuit_type` | lifecycle state | participant-visible |
| `pursuit.use_case` | `pursuits.use_case` | descriptive text | participant-visible |
| `pursuit.compelling_event` | `pursuits.compelling_event` | `timing` | governed |
| `pursuit.timing_window` | `pursuits.timing_window` | `timing` | governed |
| `pursuit.account_name` | `companies.legal_name` via `pursuits.account_id` | descriptive | governed |
| `pursuit.updated_at` | `pursuits.updated_at` | metadata | participant-visible |

Fields deliberately **excluded** from Slice 1: every `current_*_score` column, `expected_value_*`, and
anything else that is a scoring or valuation output. Exposing a stored score through a P7 projection
would put a number on screen whose definition P7 does not own and whose provenance it cannot state —
the shadow-metric failure in contract §14 row 4. Those become available only as **registered metrics**
with declared provenance, in a later slice, and only if their owner domain agrees.

### 2.3 Filters — the complete filter vocabulary

| Dimension | Operators | Notes |
|---|---|---|
| `pursuit.status` | `=`, `in` | closed value list read from the canonical status vocabulary |
| `pursuit.pursuit_type` | `=`, `in` | closed value list |
| `pursuit.account` | `=` | canonical account id; resolved within the authorized set |

No free-text search, no `like`, no date arithmetic, no nested boolean groups in Slice 1.

### 2.4 Metrics — exactly one

```
MetricDefinition {
  id:        "pursuit.open_pipeline_usd"
  version:   1
  inputs:    [ opportunities of this pursuit's account, stage ∉ {closed_won, closed_lost}, amount_usd ]
  informationClasses: [ "economic_value" ]
  compute:   sum(amount_usd) over the governed input rows        // deterministic, no I/O of its own
  determinism: "DETERMINISTIC"
  provenance: "Sum of amount_usd for open opportunities on this pursuit's account, computed from
               canonical opportunity rows the caller is authorized to derive from."
  disclosure: NOT_DISCLOSABLE if ANY contributing input is suppressed (contract §7.3)
}
```

One metric is enough to prove the registry contract, and its information class (`economic_value`) is
one `mayDerive` already governs — so the metric exercises the real derivation path rather than a
trivially-owned field.

### 2.5 Ordering

`pursuit.updated_at desc` · `metric:pursuit.open_pipeline_usd@1 desc` · `pursuit.id asc` (always
appended as the stable final key, so ordering is total and reproducible).

---

## 3. The exact `PursuitQuery` shape for Slice 1

```jsonc
{
  "queryVersion": 1,
  "subject":    { "class": "pursuit" },              // optional "ids": [...] for GO TO
  "scope":      { "kind": "ALL", "id": null },       // the EXISTING Scope type, lib/scope/scope.ts
  "filters":    [ { "dimension": "pursuit.status", "op": "in", "values": ["open"] } ],
  "metrics":    [ { "id": "pursuit.open_pipeline_usd", "version": 1 } ],
  "projection": [ "pursuit.id", "pursuit.account_name", "pursuit.status", "pursuit.updated_at" ],
  "ordering":   [ { "ref": "metric:pursuit.open_pipeline_usd@1", "dir": "desc" } ],
  "limit":      50,
  "asOf":       null,                                 // MUST be null in Slice 1; non-null is rejected
  "explain":    false                                 // MUST be false in Slice 1 (EXPLAIN is Slice 2)
}
```

Validation is total and deterministic: unknown key → reject; unknown class/field/dimension/operator/
metric → reject; `asOf ≠ null` → reject; `explain = true` → reject; `limit` outside `1..200` → reject.
**A rejected plan never reaches the database.** Rejection names the offending identifier and nothing
else — no suggestion, no nearest match, no partial execution.

---

## 4. The exact governance call path

```
PursuitQuery (validated)
  │
  ├─ principal        established by the gate; absent → no tenant (P6→P7 invariant, already enforced)
  ├─ capability       pursuitExperienceEnabled()                     → fast deny, no DB work
  │
  └─ withTenant(async (db, orgId) => {                               // lib/db/tenant.ts — sets app.org_id, RLS binds
       ├─ capability  await experienceEnabledFor(db, orgId)          // tenant-aware; deny → refuse
       ├─ scope       await resolveScope(db, orgId, plan.scope)      // lib/scope/server.ts — narrows within authorized set
       ├─ candidates  canonical read-only loader                     // RLS + can_see_pursuit decide membership
       │                                                             // (effective participation window, SQL clock)
       ├─ derivation  for each candidate whose sourceOrgId ≠ orgId:
       │              await mayDerive(db, orgId,
       │                    { inputKind: "economic_fact" | …, sourceOrgId, pursuitId },
       │                    "VALUE_CASE")                            // federation/derivation.ts
       │              deny → the metric is omitted for that row with a safe reason
       ├─ viewer      await buildFederationViewer(db, orgId, pursuitId)   // federation/grants.ts
       ├─ disclosure  resolveDisclosure(item, viewer) per governed field  // federation/disclosure.ts
       └─ assemble    GovernedResultSet — suppressed cells carry NO value
     })
```

**Order is load-bearing:** governance precedes computation, so a suppressed input can never reach the
metric, and the metric can never be computed and then hidden. Nothing in this path is memoized across
requests; nothing consults a cached verdict.

### 4.1 `GovernedResultSet` shape

```
GovernedResultSet {
  plan:        PursuitQuery            // echoed, so the surface is re-derivable and auditable
  computedAt:  transaction timestamp   // from SQL, never a JS Date (D-P6-1)
  rows: [ { objectRef: { class, id },
            cells: { [FieldRef|MetricRef]: { visibility, value|null, provenance } } } ]
  omissions:   [ { objectRef?, ref, reason } ]   // operation metadata only, never a withheld value
  counts:      { authorized: n }                 // describes the AUTHORIZED set, and says so
}
```

---

## 5. The exact deterministic computation

1. Load candidate rows (RLS-scoped, scope-narrowed, filtered, deterministically ordered by the total
   ordering including the `pursuit.id` final key).
2. Resolve governance per row and per field (§4).
3. Compute `pursuit.open_pipeline_usd@1` **from governed inputs only**. If any contributing input is
   suppressed or `mayDerive`-denied, the metric cell is `NOT_DISCLOSABLE` with no numeric substitute,
   no zero, no "—" that reads as a value, and no partial sum.
4. Assemble the `GovernedResultSet`. No step here consults a model, a cache or the request beyond the
   validated plan.

**Determinism obligation:** the same plan, same principal, same transaction → byte-identical result
set. Tested in §7.

---

## 6. The exact presentation surface

One new read-only route, gated exactly like the existing experience routes:

```
src/app/experience/pursuits/page.tsx     (name subject to ruling — see §9.7)
  export const dynamic = "force-dynamic"
  pursuitExperienceEnabled() === false → notFound()          // matches src/app/pursuits/page.tsx:23
  builds a fixed Slice-1 PursuitQuery (no user-supplied plan in Slice 1 — see below)
  renders the GovernedResultSet as a plain table:
     one row per authorized pursuit; one column per projected field; the metric column shows either a
     value with its "pursuit.open_pipeline_usd v1" provenance, or "not disclosable" — never a blank
     that reads as zero
  suppressed cells render as suppressed, with no tooltip, title attribute or payload carrying a value
```

**Where the plan comes from in Slice 1:** the route constructs it from a small set of **code-defined
plans** selected by a validated query parameter (e.g. `?view=open-by-value`). No caller-supplied JSON
plan is accepted in Slice 1 — accepting arbitrary plans is a separate attack surface that belongs with
the API/MCP slice, where the transport can authenticate and bound it. This keeps Slice 1's proof about
the **spine**, not about plan ingestion.

No change to `/pursuits`, `/`, Today, Queue or any existing surface. No navigation entry is added
unless the ruling asks for one (§9.7).

---

## 7. Negative tests — the proof obligations

Each must fail before the fix and pass after; each maps to a contract threat row.

| # | Test | Proves | Contract |
|---|---|---|---|
| 1 | plan naming `made.up.metric@1` → rejected, **and no database connection is opened** | a metric cannot be invented | §14.4 |
| 2 | plan naming an unregistered field / dimension / operator / object class → rejected | closed vocabulary | §3.3 |
| 3 | plan with `asOf: "2026-01-01"` → rejected | Slice 1 has no historical semantics | ruling 3 |
| 4 | plan with `explain: true` → rejected | EXPLAIN is not in Slice 1 | ruling 1 |
| 5 | a pursuit id outside the authorized set in `subject.ids` → absent from the result, indistinguishable from non-existent | tenancy | §13 |
| 6 | a scope outside the caller's authorized set → resolves to the authorized set, never wider | no NL/plan scope widening | §14.6 |
| 7 | a governed field suppressed by `resolveDisclosure` → **the value does not appear in the response bytes** (not merely unrendered) | evidence firewall | §14.1 |
| 8 | the metric over a `mayDerive`-denied input → `NOT_DISCLOSABLE`, no numeric substitute, no partial sum | zero declassification | §7.3 |
| 9 | source guard: no module in the P7 tree imports a writer, an `unsafe_` reader, or issues INSERT/UPDATE/DELETE | no write path | §14.3 |
| 10 | source guard: **no model/LLM client is imported anywhere in the Slice 1 tree** | no model in the execution path | ruling 1 |
| 11 | same plan twice in one transaction → byte-identical `GovernedResultSet` | determinism | §12.3 |
| 12 | no principal → no tenant, no data (per transport) | interface ≠ authority | §14.9 |
| 13 | `PURSUIT_EXPERIENCE_ENABLED` off → route `notFound()`; org flag off → refusal after org resolution | capability inheritance, both layers | ruling 5 |
| 14 | no table is created, altered or written; `supabase/migrations` unchanged | no shadow data model | §11.4 |
| 15 | the result set contains no P2 pertinence value, standing, Δ or rank | Slice 1 exposes no attention-capability data | ruling 5 |

Tests 1–4, 9–11 and 14–15 run with no network and no database. Tests 5–8, 12–13 run against a seeded
clone in the existing verifier style (`scripts/verify-run.ts --suite …`).

---

## 8. What Slice 1 explicitly does not do

no LLM anywhere · no natural-language parsing · no generated prose · no pinning · no persistence of
any kind · no new table, column, migration or index · no action, offer or `ActionProposal` · no
`asOf` · no cohorts, aggregates across objects, percentiles or ranks · no cross-org anything · no P2
pertinence · no MCP/API transport · no change to `src/proxy.ts`, P5 or P6 · no new capability flag.

**No missing P5/P6 primitive has been identified.** Slice 1 uses `withTenant`, `resolveScope`,
`mayDerive`, `buildFederationViewer` and `resolveDisclosure` exactly as they exist. If implementation
reveals a genuine gap, the rule stands: stop and demonstrate it before changing P5 or P6.

---

## 9. Remaining §16 architectural decisions — verbatim, with recommended disposition

The contract's acceptance did not rule these. Restated verbatim from
`docs/p7-pursuit-experience-analysis-contract.md` §16, each with my recommendation.

> **1. Metric version retention.** Keep every shipped metric version indefinitely, or deprecate on a
> stated policy with forced migration of pinned surfaces? (§4.2)

**Recommendation: keep every shipped version indefinitely until pinning exists, then revisit.** With
no pinned surfaces in Slice 1 there is nothing to migrate, and an immortality promise made now would
bind the design before the cost is visible. Concretely for Slice 1: one metric, one version, and a
test asserting the registry key is `{id, version}` so versioning is structural from the first line.
**Not needed for Slice 1 to proceed.**

> **5. EXPLAIN prose mechanism.** Deterministic templates first (safer, auditable) versus LLM
> narration from the start. Recommendation: templates in Slice 2, LLM narration as a later,
> separately gated step.

**Recommendation unchanged: deterministic templates in Slice 2; LLM narration later and separately
gated.** Ruling 1 already forbids prose in Slice 1, so this binds Slice 2 only. A template is
auditable line by line and cannot introduce a claim; that property is worth having before any model
writes recipient-facing sentences about intercompany evidence.

> **6. Analysis export.** Does P7 export/attach analysis artifacts at all, or is that deferred
> entirely to the owning canonical artifact? (§11.3) Recommendation: **defer**.

**Recommendation unchanged: defer entirely.** An exported artifact is a recipient-facing object that
outlives its governance resolution — the same hazard class as org-shared pinned surfaces, which
ruling 2 has already deferred for exactly that reason. If an export is wanted later it should be
owned by evidence/brief/snapshot, which already have disclosure semantics.

> **7. Feature flag and capability DAG position.** P7 presumably needs its own env + tenant flag.
> Where does it sit relative to the accepted DAG (`pursuitAttention → pursuitCoordination →
> pursuitIntelligence → pursuitState + pursuitMemory`)? The accepted rule is that a flag is not added
> to satisfy a gate, so this must be decided deliberately.

**Now answered empirically by §0, and my recommendation is: add no flag.** `pursuitExperience` already
means what Slice 1 needs, `dynamic_surfaces` is already reserved (and correctly depends on
`pursuitIntelligence`) for the generated-surface slices, and P7 inherits capabilities per operation
rather than becoming a DAG node. The one substantive decision left inside this item: **Slice 1 will
consult both the env master and the tenant row** (§0.1), which is stricter than the existing pages.
Confirm that is wanted, since it means an org without `org_features.pursuit_experience` sees the route
404 at the env layer only if the env master is off, and a refusal after org resolution otherwise.

> **8. Which transports are in scope for P7 as defined** — web + MCP/API only, with Slack/Teams/agents
> explicitly future? Recommendation: **yes**, name them future so no interface-specific logic is
> written speculatively.

**Recommendation unchanged: web + MCP/API in scope, everything else explicitly future.** Slice 1 is
web only; the MCP/API transport arrives in contract slice 4 with the identical-execution test. Naming
Slack/Teams/agents as future is what stops speculative per-interface logic from being written now.

> **9. Aggregate safety review process.** Every new aggregate must pass the differencing control
> (§5.6). Is that a per-slice gate or a standing checklist item?

**Recommendation: a per-aggregate gate, enforced by test, not a checklist.** Every registered
aggregate metric ships with its own differencing negative control in the same commit, in the style of
the accepted P6-IG control. A checklist is a promise; a test is a fact. **Not needed for Slice 1**,
whose single metric is a per-object sum rather than a cross-object aggregate — but it binds from the
first cohort metric in contract slice 3.

### 9.7 One additional question this plan raises

**Route name and navigability.** Slice 1 needs a presentation surface. I propose
`/experience/pursuits`, **not linked from the navigation rail**, so the first vertical is reachable
for acceptance without becoming a product surface anyone stumbles into. Alternatives: link it
(premature), or render into an existing page (contaminates a certified surface). **Recommend:
unlinked route, name to be confirmed.**

---

## 10. What a ruling on this plan authorizes

If ruled, implementation of §1–§7 **only**: the registry, the validator, the governance path, the
computation, one unlinked read-only route, and the fifteen negative tests. Nothing in §8 becomes
authorized by implication, and no decision in §9 is treated as approved unless ruled.

---

## 11. Ruling record (authoritative — supersedes any recommendation above it)

Recorded verbatim in effect, from the Slice 1 approval.

1. **Feature gating.** `pursuitExperienceEnabled()` is the environment master / fast deny;
   `experienceEnabledFor(db, orgId)` is required inside the tenant-aware governed path; **both must
   pass**; missing or false tenant entitlement **fails closed**. The existing nine env-only call sites
   are **not changed** by Slice 1. No new flag. `dynamic_surfaces` is **not claimed** — it stays
   reserved for later generated/composed surface slices.
2. **Route.** `/experience/pursuits`, **unlinked** for Slice 1, requiring normal application
   authentication plus the feature and tenant gates. **Its path is not yet a permanent
   product-navigation contract.**
3. **Metric versioning — §9 decision 1 is MODIFIED.** A metric **name + version definition is
   immutable after release**. Slice 1 ships only `pursuit.open_pipeline_usd@1`. **Do not build
   indefinite version-retention machinery now.** Once persisted pins or external interfaces can
   reference a version, that version acquires a **compatibility obligation**; migration and retention
   semantics are defined when pinning is designed.
4. **EXPLAIN.** Slice 1: none. Slice 2: deterministic templates from governed facts and provenance.
   LLM explanation later, under its own gate.
5. **Export.** Deferred entirely. No P7 result export in Slice 1. Future export is a
   **disclosure/persistence/onward-sharing design problem, not a formatting feature.**
6. **Transports.** One shared, headless P7 execution boundary — validate → registry resolution →
   governance → `GovernedResultSet` → deterministic computation → projection — which the web route
   calls. **No new MCP/API infrastructure in Slice 1** merely to demonstrate portability. The web
   handler carries **transport concerns only** and must not duplicate metric, governance, disclosure
   or query semantics.
7. **Aggregate safety — binding at code level.** Every metric requiring aggregate-safety reasoning
   ships its tests in the same change. For `pursuit.open_pipeline_usd@1`, prove explicitly that
   `mayDerive(economic_value)` is **necessary but not sufficient** to expose the result; that
   computation consumes **only** the post-governance / post-disclosure governed inputs; and that a
   suppressed economic-value input **does not contribute to the recipient-facing amount, directly or
   indirectly**. Zero safe-declassification transforms is unchanged.
8. **Boundaries preserved.** Read-only · pursuit only · eight registered fields · three filter
   dimensions · one canonical metric · `asOf: null` · `explain: false` · no LLM · no pinning · no
   actions · no new tables · no schema · no cross-org ranking · no P5/P6 modification. The
   load-bearing execution order stands, and **P7 must never receive raw hidden data after governance
   resolution**. Every §8 exclusion stays excluded: acceptance authorizes no `current_*_score`, no
   `expected_value_*`, no P2 reimplementation and no unregistered field.
9. **Implementation acceptance** adds these proofs to §7: unknown field/metric/filter hard-fails
   **before query execution**; org feature false/missing denies **despite env master ON**; scope
   cannot broaden from query input; an undisclosable pursuit cannot enter the result set; `mayDerive`
   denial prevents the metric; disclosure suppression cannot feed the metric; **no SQL, table or
   column identifier originates in a `PursuitQuery`**; the rendered response is regenerable entirely
   from the validated plan and governed result; no P7-local write occurs; no hidden value appears in
   response bytes.

**Standing instruction:** if implementation demonstrates that an existing P5/P6 primitive is actually
insufficient, **STOP before modifying it** and return the exact missing primitive. Otherwise proceed
through local implementation and evidence without another architecture checkpoint.

### 11.1 One factual refinement to §2.4, made during implementation prep

`opportunities` carries `pursuit_id` directly (confirmed against schema 112). The metric therefore
sums **the pursuit's own open opportunities** — `where pursuit_id = <pursuit> and stage not in
('closed_won','closed_lost')` — rather than reaching through `account_id`. This is narrower and
removes a class of cross-pursuit contamination the account-based formulation would have allowed. The
registered definition text states this exactly.
