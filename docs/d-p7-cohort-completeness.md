# D-P7-COHORT-COMPLETENESS — a presentation limit was deciding a metric's domain

**Classification: PRODUCT SEMANTIC DEFECT, PRE-EXISTING P7 (Slice 3), EXPOSED BY SLICE 14.**
**Status: HOSTED ACCEPTED / CLOSED on serving commit `e55499b`.**
Found by the Slice 14 hosted gate and corrected locally against `0f5f40e`, **which was the serving
commit on the day the defect was found and is not the certified commit** — the correction was carried
by `d977b56`, and the commit that now serves and carries it is **`e55499b`**. No schema, no
migration, no alias movement, no P45, no hosted action.

> **A presentation/cardinality limit may constrain returned rows; it may never silently constrain the
> aggregate's semantic member set.**

## 1. What was wrong

`executePursuitQuery` governed every candidate, ordered the governed rows by `pursuit.updated_at`,
sliced them to `plan.limit`, and then handed **the slice** to `analyze()` as the cohort. Membership
therefore had two definitions and the aggregate read the presentational one.

Measured on a certified `app_rw` substrate before the correction:

| | observed |
|---|---|
| governed cohort / reported basis | **212 members → `basis.members: 200`** |
| omissions outside the slice | filtered away by `execute.ts:110`; a suppressed member left **no trace** |
| withhold-whole | **defeated by row count**: one non-derivable member, unchanged in every respect, moved out of the slice by 200 newer unrelated disclosable rows, and the same request returned **DISCLOSED** where it had returned **WITHHELD** |
| canonical value | a tenant's open pipeline moved from 6,250,000 to 0 with no pursuit changing value |

The last row is why this was ruled STOP-level. Withhold-whole is a governance rule; a rule a row
count can defeat is not a rule.

**Provenance of the number.** `plans.ts` set the cohort plan's limit to `200` — exactly `MAX_LIMIT`
(`registry.ts`), the Slice 1 **request-validation ceiling**, carried into the plan with no
documenting comment. It was never a display decision, never a candidate-query bound and never a
certified cohort definition. For `pursuit.cohort` it bounds nothing a user sees: that component
renders only the aggregate.

## 2. The canonical semantics were never in doubt

Whole-cohort semantics are established by prior certification, in three independent places:
`AGGREGATES["cohort.open_pipeline_usd@1"]` ("across the members of this governed cohort … computed
only when EVERY member's contribution is disclosable"); Slice 3 §D and ruling 1; and ruling 3, which
defines `basis.members` as *"the actual post-governance cohort"*. `AggregateResult.cohort` carries
`{subjectClass, scope, filters}` — `limit` is not part of cohort identity. **The metric was not
redefined to match the implementation; the implementation was corrected to match the metric.**

## 3. The correction — membership is a sealed type, not an argument of convenience

`src/lib/experience/cohort.ts` introduces `CompleteGovernedCohort`. It is the only thing `analyze()`
accepts, and three independent mechanisms stand behind it:

1. **A module-private symbol brand** — `{ plan, members }` neither type-checks nor exists, the same
   device `ExecutionPrincipal` uses to stop a transport asserting authority.
2. **Validation, not stamping** — `sealCompleteCohort` refuses unless the governed members are
   *exactly* the candidate ids, one per candidate. A slice cannot be relabelled complete, because a
   slice is missing candidates it claims to cover.
3. **Identity, not shape** — the sealed objects live in a module-private `WeakSet`. Object spread
   copies symbol-keyed properties, so `{ ...cohort, members: page }` would otherwise carry the brand
   while carrying a different membership; a clone was never sealed and is refused.

`executePursuitQuery` now seals the cohort from every governed candidate **before** `orderRows` and
before `rows.slice(0, plan.limit)`; ordering and the limit produce the `GovernedResultSet` a renderer
receives. The aggregate reads the cohort; explanation, navigation, ordering and the Slice 8
first-result identity keep reading the presented rows, exactly as certified.

Failing to construct a complete cohort **throws** (`IncompleteCohort`). It is a programming fault,
not a disclosure decision: not `WITHHELD` (governance refused nothing), not `NOT_AVAILABLE`, not a
zero. It surfaces as the boundary's existing safe `FAILED`. **No new recipient disposition was
added**, per ruling.

`counts.authorized` is deliberately **unchanged** and still describes the presented rows. The Slice 1
contract says only that it "describes the AUTHORIZED set" and does not settle the question; it sits
beside `rows` in the same result set and is rendered as that list's caption. Pointing it at the full
cohort would also publish a cohort size next to a withheld aggregate — the differencing channel
Slice 3 ruling 3 exists to close. Verified rather than inferred; preserved deliberately.

## 4. Evidence

**Unit — dedicated suite `tests/d-p7-cohort-completeness.test.ts`, 13/13.** Negative controls that
bite: a sliced cohort, a swapped candidate, a doubly-governed candidate, an ordinary
`GovernedResultSet`, four hand-assembled shapes and a spread clone are each refused — by type, by
identity or by the candidate-set check. A suppressed member at index 0, 199, 200 and 249 of a
250-member cohort withholds in every position. `basis.members` reports 212 where the plan's limit is
200. Structural guards assert the executor seals before it orders or slices, that `analyze` is given
the cohort and never `resultSet` or `limited`, and that presentation limits are untouched.

**Slice 3 — 26/26, no assertion weakened.** The fixtures now build sealed cohorts; the
"excluded-cannot-influence" test became stronger, because a sealed cohort carries no `omissions` and
no `counts` for the analyzer to read even by mistake. The import-closure guard now also holds
`cohort.ts` to the same standard: it imports types only and contains no database reach.

**Semantic proofs on a certified `app_rw` substrate — 19/0** (`+201` open pursuits each carrying one
open opportunity of $1,000, on the 11-pursuit canonical world):

```
whole-cohort value  DISCLOSED 6,451,000        (the truncated path would have returned 200,000)
basis               212 members = the complete governed cohort
presentation        200 rows, counts.authorized 200, list view still 50
withhold-whole      one non-derivable member ranked LAST, far outside the page → WITHHELD,
                    no value, no currency, no basis
baseline            the certified 11-member fixture is unchanged: DISCLOSED 6,250,000, basis 11
```

## 5. Not in this correction

`MAX_LIMIT` and plan validation are unchanged. No presentation limit was deleted. No SQL
`may_derive()` was introduced — one governance rule engine remains. No MCP field was added: the
serializer's dropped `basis` made the defect harder to see but did not cause it, and any later
externalisation of cohort basis must inherit canonical `SurfaceResult` and be ruled against the
existing cross-org differencing controls.

---

# Commit B — the same cohort, in a bounded number of statements

The semantic correction above made the aggregate read the whole cohort. That made the pre-existing
O(N) statement graph load-bearing rather than merely wasteful, which is the total-work half of
**D-S14-EXECUTION-BOUND**.

## The shape of the fix

Governance acquired its facts one member at a time: a viewer query and an allow-list query per row,
plus one to three derivation queries per foreign row — `Σ cost(candidate)`, cost in {3,4,5,6}. The
facts are now loaded for the whole cohort in a constant number of statements, and **only the fetching
changed**:

- `decideDerivation(viewerOrgId, input, purpose, facts)` is the pure decision core, extracted from
  `mayDerive` and now the only implementation of those rules. `mayDerive` remains, as a one-row fact
  loader over the same core — lazily, so its statement cost is what it always was.
- `src/lib/pursuits/federation/batch-facts.ts` loads the same facts with the **same predicates** at
  the **same instant** (`transaction_timestamp()` inside each statement) for a set of pursuits:
  participation standing, allow-listed object keys, and — only when the cohort actually crosses an
  organization boundary — derivation grants.
- `pursuits.__live` (the PURSUIT_LIFETIME bound) rides the candidate row rather than being re-read
  per member: the same row, in the same transaction.
- `loadMetricInputs` reads the metric's inputs for every member in one grouped statement.
- `resolveDisclosure` is untouched and still decides disclosure per input.

**No SQL `may_derive()` was introduced.** One rule engine remains, per ruling: a second one would
have to be proven equivalent forever.

## Measured graph — constant in cohort cardinality

| cohort | before | after |
|---|---|---|
| 11 members | 49 statements | **19** |
| 212 members | 652 | **19** |
| 2,011 members | — | **19** |
| 212 members incl. one foreign member | 656 | **20** (the derivation-grant query, issued only across an org boundary) |

> **The number of externally-triggerable PostgreSQL workload-bearing statements for canonical MCP
> `pipeline_summary` is bounded independently of cohort cardinality, and each is additionally
> protected by the trusted 500 ms statement timeout.**

**Precisely what is and is not bounded.** DB statement count and DB execution time are bounded
independently of N; **in-process governance evaluation remains O(N)** — one `decideDerivation` and
one disclosure resolution per member, plus the rows themselves in memory. Total CPU and memory are
*not* claimed constant. Measured wall time: 5 ms at 11 members, 14 ms at 212, 84 ms at 2,011.

**The 500 ms bound is unchanged and was not relaxed.** At 2,011 members no statement came within a
fifth of it (none exceeded 100 ms).

## Differential governance proof — 56/0

Before relying on the batched path, both paths were run against the same world and compared on
membership, derivability, disclosure state, omission reason and aggregate disposition. The oracle is
built from the product's own one-row functions (`buildFederationViewer`, `mayDerive`,
`resolveDisclosure`) — never a re-implementation.

Classes covered: self-owned · foreign with ACTIVE participation and no grant · RETAINED grant ·
PURSUIT_LIFETIME grant with a live pursuit · PURSUIT_LIFETIME grant with a **merged** pursuit ·
expired grant · revoked grant · participation `LEFT` · no participation at all · non-derivation
purpose · wrong information class · `scope.keys` narrowing · two qualifying grants.

Negative controls bite: flipping one member's decision, changing the aggregate by one dollar and
dropping one member each make the comparison fail, and an anti-vacuity guard asserts the fixtures
produced EXACT, SUPPRESSED *and* absent outcomes.

## One behavioural change, recorded rather than buried

The one-row grant query used `limit 1` with **no ordering**, so with several equally-qualifying
grants it saw an arbitrary one — and the pick can matter, because grants differ in `retention_class`
and `scope.keys`. The decision core now considers every qualifying grant and allows if any of them
permits, which is what *"a live grant covers this purpose and class"* means; a narrower sibling can
no longer deny by happening to be chosen first. This affects both paths identically (`mayDerive` was
rewritten onto the same core), it is pinned by a unit test, and it is the only decision-level change
in this commit.

## Hosted closure

**HOSTED ACCEPTED / CLOSED — serving `e55499b`, schema 114, 173 assertions / 0 failures** (the Slice
14 gate record). On the serving runtime, `analyze()` accepts only a sealed cohort, the executor seals
from every governed candidate before ordering and before the limit, and the rendered basis equals the
organization's whole open-pursuit set.

**What hosted evidence could NOT do, stated plainly.** The Preview tenant's governed cohort is **11
members against a `plan.limit` of 200**, so the pre-correction code returns the identical figure
there: *this gate proves membership equals the complete cohort and proves nothing about truncation.*
The discriminating evidence is the seeded `app_rw` substrate — 212 members reporting `basis.members`
200, and a non-derivable member pushed out of the page turning WITHHELD into DISCLOSED. Recorded as a
standing rule in §16L of the P7 analysis contract: **an invariant about scale is not evidenced at a
scale where both implementations agree.**
