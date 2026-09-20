# Pilot Evidence Foundation — Slice 1 correction pass

Two of the four corrections completed. Two hit their own explicitly stated STOP condition and are
reported here rather than guessed at.

---

## STOP 1 — the attention hook cannot be wired without a bound that does not exist

> *"Computing portfolio pertinence inside the governed write path is accepted only if the existing
> certified P2 computation is bounded … If P2 has no existing bounded portfolio limit: STOP and
> report it rather than inventing one in this slice."*

### 1.1 P2 has no portfolio bound

`loadPortfolioCandidates` (`src/lib/pursuits/read-models/portfolio-pertinence-loaders.ts`) selects
**every** non-terminal, non-merged pursuit in the org. There is no `limit`, no cap constant and no
declared ceiling. The only nearby bound, `ATTENTION_PURSUIT_CAP = 50`, belongs to
`loadPursuitAttention` in `attention-loaders.ts` — a different computation, over a different row
set, feeding a different surface. Borrowing it would change P2's comparison set, and therefore the
meaning of every `rank` and `comparisonSetSize` the product already shows.

### 1.2 Measured execution shape — linear, with an N+1 inside it

Measured on the local clone by wrapping the pool client's `query` and counting, with each
synthesised portfolio rolled back:

| comparison set N | statements | wall (local loopback) | statements per pursuit |
| ---: | ---: | ---: | ---: |
| 11 | 42 | 38 ms | 3.82 |
| 66 | 207 | 62 ms | 3.14 |
| 220 | 669 | 183 ms | 3.04 |

Exactly **3N + 9**. The 3N is an N+1 loop: `loadModeledImpact` calls `getValueCase` once per
pursuit, which issues a pursuit read, an opportunity read and `loadDrivers` — the last carrying two
correlated subqueries per economic fact. Persisting the observation would add one INSERT per
subject, giving **4N + 9** inside a single governed dispatch.

The 500 ms `EXTERNAL_READ_POLICY.statementTimeoutMs` is **per statement** and would not fire; no
individual statement here is slow. The unbounded quantity is the statement **count**, which is not
what that policy bounds. Per-statement latency in the deployed runtime cannot be measured from a
developer machine — the pooler round trip from this Mac is not the round trip from the serving
region — and inferring it would be the same class of error P6-IG established (`app_rw` evidence has
to run inside the deployed runtime).

### 1.3 A prior question the brief's premise did not anticipate

> *"capture the P2 attention state **used** at that recommendation boundary."*

`recommend_pursuit_plan@1` does not consume P2. `recordPlanRecommendation` locks one pursuit row,
loads that pursuit's plan state and recommends for that pursuit alone; no cross-pursuit ranking
enters it at any point. So there is no P2 state *used* at that boundary to capture. Computing one
there would not be recording what the recommendation consulted — it would be **manufacturing a new
ranking at that instant and attaching it to a decision that never saw it**.

The only places P2 is genuinely used are `src/app/page.tsx` (Today) and `src/app/pipeline/page.tsx`
— both read paths, which are correctly forbidden.

### 1.4 What this leaves

The producer ships correct, proved and unwired. Its atomicity, de-duplication, reordering
sensitivity, forgery resistance and no-orphan behaviour are all certified; what is missing is a
boundary to attach it to. Three ways out, none chosen here:

1. **Declare a P2 portfolio bound** — an owner ruling with a real product consequence: beyond the
   bound a rank stops describing the whole portfolio, and `comparisonSetSize` has to say so.
2. **Make the recommendation genuinely consume P2**, so there is a real state to capture. This is a
   recommender/P2 architecture change, outside this slice.
3. **Capture what the recommendation actually does use** — the pursuit-scoped plan basis, which is
   already bounded and already consulted. This is a smaller, honest observation, and a different
   one from the cross-pursuit ranking the brief asked for.

---

## STOP 2 — one deployment serves certification and pilot, and nothing tells them apart

> *"If the same deployment must support both kinds of traffic: STOP and return the smallest trusted
> request/actor/org-scoped provenance mechanism needed."*

### 2.1 Where `dataEnvironment` comes from today

| path | source | trusted? |
| --- | --- | --- |
| Pursuit Coordination server actions | `select data_environment from pursuits where id = $1 and org_id = $2` | **yes** — server-derived from the subject, org-scoped |
| `/api/mcp` | the string literal `"PRODUCTION"`, `route.ts:172` | **no** — it is a constant, not an observation |
| every `recordChange` caller that omits the field | `e.dataEnvironment ?? "PRODUCTION"` | **no** — silent default |

No caller can *declare* its environment — there is no request field that reaches it, and the suite
asserts that. The defect is the opposite one: the server asserts `PRODUCTION` without knowing.

### 2.2 The consequence, enumerated on the hosted project

All **14** hosted pursuits are `DEMO`. There is no genuine production activity on Preview at all.
Yet **31 rows across 7 tables** carry `data_environment = 'PRODUCTION'`:

| table | rows |
| --- | ---: |
| `governed_action_invocations` | 18 |
| `pursuit_participants` | 4 |
| `change_ledger` | 2 |
| `context_contributions` | 2 |
| `context_grants` | 2 |
| `recompute_requests` | 2 |
| `pursuit_overrides` | 1 |

Every one is mislabelled. Certification harnesses and the future pilot both reach the same Preview
deployment, so a deployment-wide default could not separate them even if one existed.

### 2.3 The smallest trusted mechanism — proposed, not implemented

Bind provenance to the **credential**, which is already the trusted, server-resolved, org-scoped
identity on the only untrusted path:

* `resolve_api_key` already returns a hardened binding (P45-4) carrying the credential and its
  governed actor. Add `data_environment` to that binding and have `/api/mcp` pass what it returns
  instead of a literal. A certification harness uses the gate credential and is `CERTIFICATION`;
  pilot traffic uses a pilot credential and is `PILOT`. The caller cannot forge it, it is
  deterministic per execution, and it needs no deployment separation.
* For subject-scoped writes, keep deriving from the subject row, exactly as the UI path already
  does. That is inheritance from the credential's decision at creation, not a second source of
  truth.
* Close `recordChange`'s `?? "PRODUCTION"`. A writer that does not know its provenance should not be
  able to assert the one value that is learning-eligible. (The two opportunity emissions are already
  corrected; the default itself is a wider change that touches every caller.)

An opportunity with **no pursuit** still has no subject to derive from, and the ledger's
`data_environment` is `NOT NULL DEFAULT 'PRODUCTION'` — so that one case remains defaulted. It is
named here rather than disguised.

---

## Completed

* **§2 commercial events** — `OPPORTUNITY_CREATED` now reaches the append-only ledger from the
  genuine business-creation path, with provenance derived from the subject. The CRM import path
  records a `crm_snapshots` observation and claims no creation, because import time is not business
  creation time. No application path mutates `amount_usd` after creation, so the amount-only event
  is unreachable rather than uninstrumented — proved, with a raw UPDATE shown to produce no history.
* **§3 naming** — `REAL_WORLD_DATA_ENVIRONMENTS` / `realWorldEnvironmentSql` /
  `isRealWorldEnvironment`. `LEARNING_ELIGIBLE_ENVIRONMENTS` unchanged at `["PRODUCTION"]`.
* **§4 exclusion closure** — `docs/pilot/certification-exclusion-manifest.json` (33 entries; a
  context grant is filed once per party because the table is org-scoped under FORCEd RLS) and
  `scripts/certification-exclusion-activate.ts`, which contains no identification logic at all.
  `invocation_effect_refs` are absent **by proof**: they carry `invocation_id`, so parent exclusion
  reaches them. The two ledger rows are listed individually **by proof of the opposite**: their
  `invocation_id` is NULL.
* **§6 cardinality** — one header-bearing row per (snapshot, pursuit); N per snapshot, N = the P2
  comparison set. Bounded by the same non-existent bound as §1. `withheld_count` is a count only.
