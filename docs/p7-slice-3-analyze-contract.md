# P7 Slice 3 — deterministic ANALYZE / cohort querying: contract and plan

**Status:** **RULED AND AUTHORIZED** (rulings in §O). Implementation may proceed.
**Builds on:** Slice 1 (`cade340`) and Slice 2 (`a6dabbb`), both HOSTED ACCEPTED.
**Excluded:** LLM plan generation · Dynamic Pursuit Surfaces · pinning · actions · exports ·
historical `asOf` · cross-org ranking or percentile · new canonical state · a second metric registry ·
hidden-input aggregation · declassification transforms.

The purpose: **prove PursuitOS can analyze a governed set without creating a shadow metric system,
leaking suppressed members through aggregation, or turning cohort construction into an authority
bypass.**

---

## A. What exactly is a cohort?

> **A cohort is a validated, governed SUBSET of one result set — not an object.** It has no identity,
> no persistence, no id and no existence outside the request that produced it.

Slice 3 adds **no persisted cohort object**. A cohort is expressed by the `PursuitQuery` that produced
it: subject class, scope, filters. Two identical plans produce the same cohort; nothing is stored,
nothing is named, and there is nothing to revoke later because nothing outlives the response.

This is the same reasoning that made pinning safe to defer: a saved **question** is safe, a saved
**answer** is not. A cohort object would be a saved answer with a name.

---

## B. When is membership determined? (the order is the whole safety argument)

```
1. candidate discovery      RLS + can_see_pursuit decide what rows exist FOR THIS PRINCIPAL at all
2. scope                    resolveScope narrows within the authorized set
3. registered filters       deterministic, closed-vocabulary predicates
4. P6 eligibility/disclosure per row and per cell — mayDerive, resolveDisclosure
5. COHORT MEMBERSHIP        ← determined HERE, from what survived 1–4
6. aggregation              over members only
```

**A hidden or undisclosable row never becomes a member.** It is not filtered out after computation;
it was never in the set. That distinction is the difference between an aggregate that is safe by
construction and one that is safe only if the redaction pass is perfect — and a redaction pass is the
shape that leaks (Slice 2's lesson, applied to sets instead of sentences).

**Consequence, stated so it can be tested:** for any pair of principals, the cohort one receives is
the cohort computed from *its own* authorized set. There is no global cohort of which each principal
sees a slice; there is no "true" total against which a principal's view is a redaction.

---

## C. The first aggregate

`cohort.open_pipeline_usd@1` — **the sum, across cohort members, of the already-registered
`pursuit.open_pipeline_usd@1`.**

Chosen deliberately over an easier option (a row count) because its governance is the interesting
part: each member's contribution is *already* subject to `mayDerive` on `economic_value` and to
disclosure resolution, so the aggregate inherits a real per-member authority check rather than
inventing one. It also invents **no new business metric** — it is the composition of an existing
registered metric, registered in its own right with its own version and provenance.

```
AggregateDefinition {
  id:        "cohort.open_pipeline_usd"
  version:   1
  over:      MetricRef        // pursuit.open_pipeline_usd@1 — a REGISTERED per-member metric
  operation: "SUM"            // from a closed operator set; the analysis layer performs no other arithmetic
  basis:     "authorized cohort members"
  provenance: "Sum of the registered per-pursuit open-pipeline metric across the members of this
               governed cohort. Not a forecast, not a probability, not a ranking, not a pertinence
               signal, and not a total of anything the caller is not authorized to see."
}
```

The registry is the **same** metric registry. Slice 3 adds an `AGGREGATES` table *within* it, keyed
`id@version`, never a second registry.

---

## D. What an aggregate means when a member's contribution is suppressed

Two distinct cases, which must not be conflated:

| Case | Where it is resolved | Effect on the aggregate |
|---|---|---|
| a row's **existence** is unauthorized | step 1–4 (§B) | it is **not a member**; the aggregate is complete over the members that exist for this principal |
| a **member's contribution** is withheld (`mayDerive` denied, or an input suppressed) | step 4, per cell | **the aggregate is WITHHELD** |

**Recommended rule (decision §K.1): an aggregate is computed only when EVERY member of the stated
cohort has a disclosable contribution; otherwise the aggregate is WITHHELD** with operation-level
wording, and no partial sum, no "over 7 of 10", and no member count is published alongside it.

Why the strict rule. Publishing *both* a cohort size and a sum over a strict subset of it is a
differencing channel: the difference is exactly the withheld contributions. Publishing the sum while
suppressing the size leaves the aggregate without an honest basis. The only statement that is both
true and safe is "the members of this cohort, all of whose contributions you may derive" — so if one
contribution is not derivable, the honest answer is that the aggregate is unavailable.

Zero safe-declassification transforms remains binding: an aggregate over partly-hidden inputs is not
"generalized" into existence by being a sum.

---

## E. Aggregate provenance

A result identifies its definition, its cohort and its basis **without leaking suppressed membership**:

```
AggregateResult {
  aggregate:  { id, version }          // cohort.open_pipeline_usd@1
  over:       { id, version }          // pursuit.open_pipeline_usd@1
  operation:  "SUM"
  cohort:     { subjectClass, scope, filters }   // the DEFINITION — the same shape as the plan
  basis:      { members: n }           // authorized members only, subject to §F
  value:      number | null
  visibility: "EXACT" | "WITHHELD"
}
```

`cohort` is the **definition**, not the membership: it names the question, never the rows. A recipient
can therefore reproduce the query and check the arithmetic against what they are authorized to see —
and learns nothing about what they are not.

---

## F. Counts

The existing P6 rule stands, unchanged and unextended:

- a count is permitted only where **existence is disclosable**;
- the declared product-policy floor (`CROSS_ORG_COUNT_FLOOR = 5`) and the anti-differencing control
  apply wherever a count could describe, or be differenced against, rows belonging to another
  organization;
- **CORRECTED BY RULING — the earlier wording was too broad and is replaced:** *an exact own-org
  cohort count is exempt from the cross-org withheld-count floor **only when** every counted member is
  independently existence-disclosable to the requesting principal **and** the count is computed
  exclusively from the post-governance cohort.* **This is not a generic `count(*)` exception.**
  Hidden, suppressed or otherwise undisclosable rows never contribute to that count. No helper whose
  semantics amount to unrestricted counting may be created.

**No generic `count(*)` is introduced.** `basis.members` is the only count Slice 3 emits, it is
subject to the rules above, and it is omitted entirely when the aggregate is WITHHELD (§D) — because
a basis count beside a withheld value is the differencing channel the strict rule exists to close.

---

## G. Comparing two cohorts

**Recommendation: Slice 3 ships NO comparison operation (decision §K.2).**

Comparison is where cohort querying becomes a ranking system, and the existing restriction is
absolute: P7 may display independently authorized information from several organizations, but may
**never** construct rank, percentile, relative standing, "top/bottom" classification or any derived
relative metric **across** organizations. Side-by-side authorized values are not permission to rank.

If comparison is later ruled in, the binding conditions are: both cohorts pass governance
**independently**; both are single-organization; the comparison emits a **difference of two
independently-authorized aggregates** and never an ordering over organizations; and the
differencing analysis of §J is repeated for the pair, because two adjacent cohorts are exactly the
shape that leaks a single hidden member.

---

## H. ANALYZE versus EXPLAIN

| | ANALYZE | EXPLAIN |
|---|---|---|
| produces | a registered deterministic result | sentences about a result that already exists |
| may compute | yes — only the registered operation over registered inputs | **no arithmetic at all** |
| input | a `GovernedResultSet` | a `GovernedResultSet`, including any aggregate already computed |
| order | runs **before** explanation | runs **after**, or not at all |

**EXPLAIN cannot perform analysis.** Slice 2's template guard already forbids arithmetic in a render
body, and Slice 3 does not relax it: an aggregate a template wants must have been computed by
ANALYZE and be present as a cell. The reverse also holds — ANALYZE produces no prose.

---

## I. What makes a cohort query deterministic

- **Filter semantics** are fixed per registered dimension (§Slice 1 registry) and evaluated in SQL.
- **NULL never matches** `=` or `in`; a row with a null dimension is absent from that filter's result
  rather than silently included. Stated because "null is not a value" is the kind of rule that decides
  membership quietly.
- **Ordering is total**: registered keys, then `pursuit.id` ascending as the final tiebreak — already
  the Slice 1 rule.
- **Ties** are resolved by that final key, never by arrival order or query plan.
- **Observation time** is the database transaction timestamp; `asOf` remains `null` (no historical
  queries in Slice 3). Every predicate that consults time reads the same instant, in SQL — D-P6-1.
- **Determinism obligation:** the same plan, same principal, same transaction → byte-identical
  `AggregateResult`, including `basis.members`.

---

## J. What prevents differential inference

Each attack, and the mechanism that defeats it:

| Attack | Defeated by |
|---|---|
| **add/remove one filter** and diff the aggregate | hidden rows were never members (§B), so no filter change can reveal one; the difference is entirely explained by rows the caller may already read individually |
| **adjacent cohorts** (two filters differing by one predicate) | same: both aggregates are over authorized members only; and with §D's strict rule a withheld contribution makes *both* unavailable rather than one differencing the other |
| **counts below threshold** | §F — floor and anti-differencing apply wherever a count could describe or be differenced against another organization's rows |
| **repeated queries** | determinism (§I): repetition yields the identical result, so there is no sampling channel |
| **single-member cohort** | the aggregate equals that member's own metric — which the caller was *already* authorized to derive, or the aggregate is WITHHELD. A single-member cohort therefore reveals nothing new, and that is the test |
| **hidden-member subtraction** | there is no published total to subtract from: no global aggregate exists, and no cohort size is published beside a withheld value (§D, §F) |

---

## K. Decisions requiring a ruling

1. **Suppressed contribution → WITHHELD whole aggregate, or compute over authorized members?**
   **Recommend: WITHHELD** (§D). Strictest, closes the differencing channel, and matches the zero-
   declassification rule. The cost is a less useful answer in mixed-authority cohorts; the alternative
   requires suppressing `basis.members`, which leaves the number without an honest basis.
2. **Does Slice 3 ship a comparison operation at all?** **Recommend: no** (§G). Comparison is the step
   that turns analysis into ranking, and it deserves its own contract.
3. **Is `basis.members` published at all when the aggregate IS computed?** **Recommend: yes** — with
   every contribution disclosable, the count describes rows the caller may read individually, so it
   discloses nothing new and makes the number checkable.
4. **Which cohorts may be requested in Slice 3?** **Recommend: single-organization only** — the
   caller's own authorized set, no federated cohort — deferring the cross-org question entirely rather
   than relying on §G's prohibition at runtime.
5. **Does the route expose cohort filters to the caller, or ship fixed code-defined cohorts like
   Slice 1's views?** **Recommend: fixed code-defined cohorts** for Slice 3, consistent with Slice 1:
   caller-supplied filter ingestion is the plan-ingestion question, which belongs with the
   authenticated API/MCP transport.

---

## L. Required threat proofs

| # | Test | Answers |
|---|---|---|
| 1 | an undisclosable pursuit cannot affect cohort membership | §B |
| 2 | hidden members cannot affect an aggregate | §B, §D |
| 3 | suppression cannot be inferred from result count or ordering | §D, §F |
| 4 | filter narrowing cannot expose a hidden member through subtraction | §J |
| 5 | an unregistered dimension hard-fails before execution | Slice 1 registry |
| 6 | an unregistered aggregate hard-fails before execution | §C |
| 7 | no aggregate performs arithmetic outside the registered analysis definition | §C, structural guard |
| 8 | changing hidden values alone cannot change recipient-visible output | §B, §D |
| 9 | no cross-org percentile or rank is produced | §G |
| 10 | analysis is correct with the model entirely removed | there is no model — structural guard |
| 11 | a single-member cohort reveals nothing the caller could not already derive | §J |
| 12 | the same plan twice yields a byte-identical `AggregateResult`, `basis.members` included | §I |
| 13 | a null-dimension row is absent from a filtered cohort rather than silently included | §I |

Tests 1–4, 8 and 11 run against a seeded clone with a foreign-owned pursuit and a participating
viewer — the fixture shape Slice 2 already proved out.

---

## M. Smallest implementation vertical

**Single-organization governed cohort → one canonical aggregate → deterministic result. No
comparison.**

```
src/lib/experience/registry.ts        + AGGREGATES: cohort.open_pipeline_usd@1 (same registry)
src/lib/experience/types.ts           + AggregateSpec on PursuitQuery, AggregateResult
src/lib/experience/validate.ts        + aggregate must be registered; over-metric must be selected
src/lib/experience/analyze.ts         pure: (GovernedResultSet) => AggregateResult
src/lib/experience/execute.ts         + run analyze() after governance, before presentation
src/lib/experience/plans.ts           + one fixed cohort plan
src/app/experience/pursuits/page.tsx  + render the aggregate with its provenance (transport only)
tests/p7-slice3.test.ts               tests 1–13 that need no database
scripts/p7-slice1-verify.ts           + the governed-fixture tests
```

No new table, no migration, no new flag, no P5/P6 change. `analyze.ts` is pure and synchronous for
the same reason `explain.ts` is: a function that cannot reach the database cannot widen a cohort.

---

## N. What this plan does not authorize

No LLM · no natural-language planning · no Dynamic Pursuit Surfaces · no pinning · no actions · no
exports · no historical `asOf` · no cross-org ranking or percentile · no new canonical state · no
second metric registry · no hidden-input aggregation · no declassification transform · no generic
`count(*)` · no persisted cohort.

---

## O. Ruling record (authoritative — supersedes any recommendation above it)

1. **Mixed-authority aggregate — WITHHOLD THE WHOLE AGGREGATE.** Every cohort member must have a
   disclosable/derivable `pursuit.open_pipeline_usd@1` contribution. If even one does not: **no
   partial sum**, **no sum of the authorized subset**, the governed **WITHHELD** state, and **no basis
   metadata** that would reveal the withheld contribution or the cohort's composition. *P7 may return
   less information; it may not silently change what the metric means.*
2. **No comparison in Slice 3.** Single governed cohort → one registered aggregate → deterministic
   result. No cohort-vs-cohort comparison, delta, winner, rank, percentile or relative ordering.
   Comparison requires its own contract.
3. **`basis.members` only on a successfully computed aggregate**, describing the actual
   post-governance cohort, and only when every counted member is independently visible to the
   principal, every member contributes to the computed aggregate, and no hidden or suppressed member
   exists in the reported basis. **Omitted entirely when the aggregate is WITHHELD or unavailable.**
   The basis may never expose the size or identities of a cohort whose aggregate cannot be safely
   computed.
4. **Single organization, enforced STRUCTURALLY.** The Slice 3 query shape carries no organization
   field at all — there is nothing to reject later, because a cross-org cohort **cannot be
   represented**. No cross-org cohort construction, aggregation, ranking or comparison.
5. **Fixed, code-defined cohort/filter definitions only.** No caller-supplied filtering, no filter
   AST, no free-form dimension combinations. A later authenticated API/MCP ingestion path must
   separately solve filter authorization, repeated-query differencing and query-shape abuse.

**Additional required proofs** (folded into §L): one withheld contribution withholds the entire
aggregate · the withheld case exposes neither a partial sum nor `basis.members` · the same cohort with
all contributions authorized computes the exact registered sum · `basis.members` exactly matches the
post-governance contributing members · adding a hidden candidate row changes neither membership nor
recipient-visible output · changing only a hidden value changes neither output nor basis · an
undisclosable pursuit cannot influence count, sum, order or provenance · no generic count path exists
outside the registered analysis definition · no cross-org cohort can be represented by the query shape
· caller input cannot synthesize or alter the fixed cohort definition · **the aggregate delegates to
the already-registered per-pursuit metric rather than reimplementing its arithmetic or authority
semantics.**
