# P7 Slice 2 — deterministic EXPLAIN: contract and implementation plan

**Status:** CONTRACT / PLAN ONLY, awaiting ruling. **No implementation authorized.**
**Builds on:** P7 Slice 1 HOSTED ACCEPTED (`cade340`), contract `docs/p7-pursuit-experience-analysis-contract.md` (§8).
**Excluded by ruling:** LLMs · natural-language plan generation · pinning · actions · exports ·
historical queries · cross-org ranking · any new canonical state.

---

## 1. The question this contract must answer

> **How can PursuitOS explain a governed result with provenance, while guaranteeing the explanation
> contains nothing that was not already authorized in the `GovernedResultSet`?**

The answer, stated as the whole design in one sentence:

> **An explanation is a pure function of a `GovernedResultSet` and a registered template. It never
> reads the database, never sees a raw row, and can only name cells that survived governance — so
> "contains nothing unauthorized" is a property of its INPUT TYPE, not of its prose.**

Everything below exists to make that mechanically checkable rather than merely intended.

---

## 2. Why the input type is the guarantee

Slice 1 already establishes that a `GovernedResultSet` contains no suppressed value: the raw value is
dropped at governance resolution, and a `SUPPRESSED` cell carries `value: null`. Slice 2 adds a
renderer whose **only** parameter is that structure.

```
PursuitQuery ─▶ governance ─▶ GovernedResultSet ─▶ explain(resultSet, templateId) ─▶ Explanation
                                     │                        ▲
                                     │   no database handle, no pool, no canonical loader,
                                     └── no row, no org id beyond what a cell already carries
```

**Three structural consequences, each testable:**

1. `explain()` takes no `PoolClient`, no connection string and no loader. A module that cannot reach
   the database cannot disclose something the database never handed it.
2. It is **synchronous and pure**. Same input → same output, always; no I/O to interleave a second,
   ungoverned read.
3. Its source guard forbids importing anything under `@/db`, `federation/`, or any `unsafe_` reader —
   the same technique already proving the approval closure imports no cross-org content module.

A reviewer therefore does not have to read the templates to trust the boundary. They have to check
one function signature.

---

## 3. What an explanation is made of

### 3.1 The three content kinds, kept visibly distinct (contract §8.2)

| Kind | Source | Example | Rule |
|---|---|---|---|
| **FACT** | a disclosed cell | "Status: QUALIFIED." | must name the `FieldRef` it came from |
| **DERIVED** | a registered metric cell | "Open pipeline 750,000 USD (`pursuit.open_pipeline_usd@1`)." | must name metric id **and** version |
| **ABSENCE** | an omission record | "Open pipeline is not disclosable here." | must name the reason code, never a value or magnitude |

There is no fourth kind in Slice 2. In particular there is **no narrative**: Slice 2 ships
deterministic templates, and generated prose arrives later under its own gate (Slice 1 ruling 4).

### 3.2 `Explanation` — the output shape

```
Explanation {
  subject:    { class, id }              // the object explained
  plan:       PursuitQuery               // echoed, so an explanation is re-derivable like a surface
  computedAt: string                     // the SAME instant the result set carries; never re-read
  statements: ExplanationStatement[]
  templateId: string                     // registered template + version
}

ExplanationStatement =
  | { kind: "FACT";    ref: FieldRef;  text: string; provenance: FieldRef }
  | { kind: "DERIVED"; ref: MetricKey; text: string; provenance: `${MetricId}@${Version}` }
  | { kind: "ABSENCE"; ref: string;    text: string; reason: OmissionReason }
```

Every statement carries the cell reference it was built from. **An explanation with a statement whose
`ref` is absent from the result set is a malformed explanation**, and is rejected by the renderer
rather than emitted — that check is what makes "nothing unauthorized" verifiable per statement rather
than per paragraph.

---

## 4. The template registry

Templates are code-defined, versioned and closed, exactly like metrics.

```
ExplanationTemplate {
  id:        "pursuit.summary"
  version:   1
  requires:  FieldRef[] | MetricRef[]     // cells it may name — nothing else is reachable
  render:    (cells: ReadonlyMap<ref, GovernedCell>) => ExplanationStatement[]
  provenance: string                      // what this template asserts, in words, for review
}
```

**Rules that make a template safe by construction:**

- `render` receives **only** the cells the plan already projected, as an immutable map. There is no
  parameter through which anything else could arrive.
- A template may not concatenate free text with a cell value except through a declared formatter
  (`number`, `date`, `identifier`, `plain`), so a value cannot be smuggled into a sentence that claims
  something the value does not say.
- A template that names a `ref` not in `requires` fails registration; a template whose `requires` are
  not all in the plan's projection fails at execution, visibly.
- **A template may not contain arithmetic.** Comparisons, sums, percentages and rankings are metrics,
  and metrics live in the metric registry with provenance. This is the shadow-metric rule applied to
  prose: a sentence that computes is a metric wearing a sentence's clothes.

### 4.1 Slice 2 ships exactly one template

`pursuit.summary@1` over the Slice 1 projection: status, type, account, last update, and the open
pipeline metric — with an ABSENCE statement wherever a cell is suppressed. One template is enough to
prove the contract; more are a later, cheap addition once the shape is ruled.

---

## 5. Absence is stated, never implied

When a cell is `SUPPRESSED`, the explanation says so with the reason code and **nothing else**:

| Reason | Statement text |
|---|---|
| `NOT_DISCLOSABLE` | "Not disclosable to your organization." |
| `DERIVATION_DENIED` | "No live machine-governed grant authorizes deriving this." |
| `INPUT_NOT_DISCLOSABLE` | "Withheld because a contributing input is not disclosable." |

Three properties this must preserve, each a test:

1. **No magnitude leaks.** The text never varies with the hidden value — not "a large deal", not
   "several opportunities", not a count of withheld inputs. The reason code is the whole message.
2. **No existence leak beyond what the result set already implies.** If governance omitted the row
   entirely, the explanation has no subject to be asked about — absence of a row is absence of an
   explanation, not "this pursuit exists but you may not see it".
3. **Silence is not an option either.** A suppressed cell produces an explicit ABSENCE statement, so
   a reader can tell "withheld" from "zero" from "not applicable". A blank that reads as zero is the
   failure mode this slice exists to avoid.

---

## 6. What Slice 2 adds to the existing pipeline

```
 validate → registry → governance → GovernedResultSet → compute → ┬─ presentation      (Slice 1)
                                                                  └─ explain()          (Slice 2, pure)
```

`explain: true` in a `PursuitQuery` becomes **legal** in Slice 2 (Slice 1 rejects it). It changes
nothing about fetching or governance: the same plan produces the same `GovernedResultSet`, and the
flag only asks for statements to be rendered from it afterwards.

**Consequence worth stating plainly:** turning EXPLAIN on can never widen a result. If it ever did,
the renderer would be reading something the result set did not contain, which is the one thing this
design forbids.

---

## 7. Failure semantics (Slice 2 additions to contract §13)

| Condition | Behaviour |
|---|---|
| template not registered | reject the plan at validation, naming the template id |
| template requires a ref the plan did not project | fail visibly: "this explanation needs `X`, which this view does not include" — never silently fetch it |
| a required cell is suppressed | the template still renders, with an ABSENCE statement for that ref |
| every cell suppressed | an explanation consisting only of ABSENCE statements — correct and complete, not an error |
| result set has no rows | no explanation; the surface says the authorized set is empty |
| a statement references an unknown cell | the renderer refuses to emit the explanation at all (malformed), rather than dropping the statement |

---

## 8. Negative tests — the proof obligations

Each is checkable without a database except where noted.

| # | Test | Proves |
|---|---|---|
| 1 | `explain()` has no database parameter, and its module imports nothing under `@/db`, `federation/` or `unsafe_` | the guarantee is structural |
| 2 | `explain()` is synchronous and pure: same input twice → identical output | no interleaved read |
| 3 | a statement whose `ref` is not a cell in the result set → the explanation is refused as malformed | per-statement traceability |
| 4 | a suppressed cell yields exactly one ABSENCE statement carrying the reason code | absence is stated |
| 5 | the ABSENCE text is **byte-identical** across two result sets whose hidden values differ | no magnitude leak |
| 6 | a template naming a ref outside its `requires` fails registration | closed template vocabulary |
| 7 | a template containing arithmetic fails a structural guard | no shadow metric in prose |
| 8 | every DERIVED statement names metric id **and** version; every FACT names its `FieldRef` | provenance is mandatory |
| 9 | the serialized explanation contains no value absent from the result set (fuzzed over generated result sets) | nothing unauthorized, end to end |
| 10 | **hosted/DB:** a participant without a grant gets ABSENCE for the metric and the withheld amount appears nowhere in the response **bytes** | the Slice 1 guarantee survives explanation |
| 11 | **hosted/DB:** `explain: true` returns the identical row set as `explain: false` for the same plan and principal | EXPLAIN cannot widen a result |
| 12 | no model/LLM import anywhere in the Slice 2 tree | deterministic, per ruling |

Test 9 is the one that matters most: it takes generated `GovernedResultSet`s with known hidden
values, renders explanations, and asserts the hidden values appear nowhere in the output — the same
"absent from the bytes" discipline Slice 1 applied to the response.

---

## 9. Implementation shape (for ruling, not for building)

```
src/lib/experience/explain.ts            pure renderer: (resultSet, templateId) => Explanation
src/lib/experience/explain-templates.ts  the closed template registry; pursuit.summary@1 only
src/lib/experience/types.ts              + Explanation, ExplanationStatement (no other change)
src/lib/experience/validate.ts           explain: true becomes legal; templateId must be registered
src/app/experience/pursuits/page.tsx     renders statements beneath each row (transport only)
tests/p7-slice2.test.ts                  tests 1–9, 12
scripts/p7-slice1-verify.ts              + tests 10–11 (the existing suite; no new suite needed)
```

No new table, no migration, no P5/P6 change, no new flag — Slice 2 inherits `pursuitExperience`
exactly as Slice 1 does, since it exposes the same data with sentences attached.

---

## 10. Decisions requiring a ruling

1. **Does the `Explanation` echo the full plan, or only the subject and template id?** Echoing the
   plan makes an explanation independently re-derivable, at the cost of a larger payload.
   **Recommend: echo it**, consistent with the result set.
2. **Where do statements render — inline per row, or an expandable panel?** Presentation only, but it
   determines whether ABSENCE statements are always visible. **Recommend: inline and always visible**,
   because a withheld value that is only visible on click reads as absent rather than withheld.
3. **Is `explain: true` permitted on a multi-row result, or only when `subject.ids` names one
   object?** Multi-row explanation is more useful and more likely to produce noise.
   **Recommend: allow multi-row**, capped by the existing `limit`.
4. **Should ABSENCE distinguish `DERIVATION_DENIED` from `NOT_DISCLOSABLE` in user-facing text?**
   Both are honest; the first tells a partner that a grant would change the answer, which is arguably
   useful and arguably a hint about what exists. **Recommend: keep them distinct** — the reason codes
   describe the operation, not the data, which is the existing P6-IG deny-reason discipline.
5. **Does Slice 2 touch the metric registry at all?** It should not need to.
   **Recommend: no** — if a template wants a number that is not already a registered metric, that is a
   metric change in its own slice, not an explanation feature.

---

## 11. What this plan does not authorize

No LLM · no natural-language plan generation · no pinning · no actions · no exports · no historical
queries · no cross-org ranking · no new canonical state · no new object class, field, filter or
metric · no change to P5, P6 or the Slice 1 governance path.
