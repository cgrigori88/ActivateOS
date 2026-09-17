# P7 Slice 2 — deterministic EXPLAIN: contract and implementation plan

**Status:** **RULED AND AUTHORIZED** (rulings in §12). Implementation may proceed.
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
| **WITHHELD** | a suppressed cell **whose existence is authorized** | the registered withheld representation | fixed text, byte-identical regardless of the hidden value; **never** the internal reason code |
| **OPERATION** | a `DERIVATION_DENIED` cell | "This analysis isn't available for this result." | describes what the system may do, never what the data contains |

There is a fourth possibility that is **not a kind**: a cell whose **existence** is not disclosable
produces **no statement at all** (§5). It is absent from `statements`, from the count, and from the
ordinals — there is nothing to label, because a label would itself be the disclosure.

There is no narrative kind in Slice 2. In particular there is **no narrative**: Slice 2 ships
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
  | { kind: "FACT";      ref: FieldRef;  text: string; provenance: FieldRef }
  | { kind: "DERIVED";   ref: MetricKey; text: string; provenance: `${MetricId}@${Version}` }
  | { kind: "WITHHELD";  ref: string;    text: string }   // registered representation; NO reason code
  | { kind: "OPERATION"; ref: string;    text: string }   // operation-level, names no evidence

// A suppressed-existence cell yields NO ExplanationStatement. The internal OmissionReason stays in
// the GovernedResultSet for authorized audit; it is never carried into a recipient-facing statement.
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
pipeline metric — with the registered WITHHELD statement wherever a cell is suppressed and its
existence is authorized, and nothing at all where existence is not. One template is enough to
prove the contract; more are a later, cheap addition once the shape is ruled.

---

## 5. Absence: three states, and they must not be collapsed (RULED)

The earlier draft had one absence state and would have rendered a "withheld" label for everything
suppressed. That is wrong where **existence itself is not disclosable**: a label is a disclosure.
The ruled model has three states, and Slice 2 must keep them distinct.

| State | Meaning | Recipient-facing rendering |
|---|---|---|
| **UNKNOWN** | no known authorized item | nothing to say; the item is simply not part of the answer |
| **WITHHELD** | existence IS authorized, value/content is not | the **registered WITHHELD representation**, rendered inline and visible |
| **SUPPRESSED existence** | existence itself is not disclosable | **omit entirely** — no placeholder, no label, no tooltip, no count contribution, no statement |

### 5.1 The internal reason codes are not disclosure authority

`DERIVATION_DENIED` and `NOT_DISCLOSABLE` remain distinct **internally**, and stay available to
authorized audit and debug machinery. **That distinction is not automatically exposed to a
recipient.** The renderer maps an internal reason to a recipient-facing state through the disclosure
rules below — it never prints a reason code.

**`DERIVATION_DENIED`** may produce **operation-level** text, because the sentence describes what the
*system may do*, not what the *data contains*:

> "This analysis isn't available for this result."

It must not identify a hidden input, name a class of evidence, or imply that a particular undisclosed
fact exists. "No live grant covers the economic value on this pursuit" would already be too much — it
asserts there is an economic value to cover.

**`NOT_DISCLOSABLE`** splits on whether **existence** is disclosable:

- existence authorized → render the registered WITHHELD representation (§5.2);
- existence not authorized → **render nothing at all** for that statement.

### 5.2 The WITHHELD representation is registered, not improvised

One registered representation, used everywhere, so a recipient learns to read it: a value slot marked
withheld, inline, visible by default, carrying **no** value, magnitude, count, hint or tooltip. Its
text is **byte-identical regardless of the hidden value**, which is what makes it safe — and is
tested as such (§8 test 5).

### 5.3 Omission must leave no shadow

When existence is not disclosable, the statement does not exist — and nothing else in the output may
betray that it once did:

- **no placeholder** and no empty slot where it would have been;
- **no gap in indices or ordinals** — statements are numbered after omission, never before;
- **no change in statement count** that varies with what was omitted;
- **no template wording** that implies a missing item ("and one other item", "3 of 5 shown");
- **no ordering artefact** — the sequence of surviving statements must be the same as if the omitted
  item had never been in the result set at all.

The test for this is comparative rather than assertional (§8 test 2): render two result sets that
differ **only** in an item whose existence is unauthorized, and require the outputs to be
**byte-identical**.

### 5.4 Slice 1 is consistent with this, and stays closed

Worth stating so nobody re-opens it: in Slice 1 a row appears only if RLS and `can_see_pursuit`
admitted it, so the row's existence is authorized; field-level suppression inside such a row is
therefore the **WITHHELD** case, and rendering "not disclosable" inline is the correct representation
under this ruling. Slice 2 adopts the registered representation for that state rather than inventing
a second one.

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
| a required cell is suppressed, existence authorized | the template still renders, with the registered WITHHELD statement for that ref |
| a required cell is suppressed, existence NOT authorized | the statement is omitted entirely, leaving no placeholder, gap or count change |
| every cell suppressed with existence authorized | an explanation consisting only of WITHHELD statements — correct and complete, not an error |
| every cell suppressed with existence unauthorized | **no explanation at all** for that subject — indistinguishable from a subject that was never in the result set |
| result set has no rows | no explanation; the surface says the authorized set is empty |
| a statement references an unknown cell | the renderer refuses to emit the explanation at all (malformed), rather than dropping the statement |

---

## 8. Negative tests — the proof obligations

Structural proofs first; the ruled absence proofs are tests 13–21 and are the heart of this slice.

| # | Test | Proves |
|---|---|---|
| 1 | `explain()` has no database parameter, and its module imports nothing under `@/db`, `federation/` or `unsafe_` | the guarantee is structural |
| 2 | `explain()` is synchronous and pure: same input twice → identical output | no interleaved read |
| 3 | a statement whose `ref` is not a cell in the result set → the explanation is refused as malformed | per-statement traceability |
| 4 | a template naming a ref outside its `requires` fails registration | closed template vocabulary |
| 5 | a template containing arithmetic fails a structural guard | no shadow metric in prose |
| 6 | every DERIVED statement names metric id **and** version; every FACT names its `FieldRef` | provenance is mandatory |
| 7 | no model/LLM import anywhere in the Slice 2 tree | deterministic, per ruling |
| 8 | **hosted/DB:** `explain: true` returns the identical row set as `explain: false` for the same plan and principal | EXPLAIN cannot widen a result |
| **9** | **a suppressed value cannot appear in explanation bytes** (fuzzed over generated result sets with known hidden values) | nothing unauthorized, end to end |
| **10** | **a suppressed item's existence cannot be inferred** from a placeholder, a missing index, statement count, ordinal numbering or template wording — two result sets differing only in an existence-unauthorized item render **byte-identically** | omission leaves no shadow |
| **11** | `NOT_DISCLOSABLE` **with existence authorized** produces the registered WITHHELD representation, inline and visible | withheld is legible, not silent |
| **12** | `NOT_DISCLOSABLE` **with existence unauthorized** produces **no recipient-facing statement** — no placeholder, no label, no tooltip, no count contribution | existence is not disclosed by a label |
| **13** | `DERIVATION_DENIED` explains the unavailable **operation** without naming or implying hidden evidence | operation-level text is safe text |
| **14** | explanation **ordering and count** cannot reveal omitted statements | no positional leak |
| **15** | every factual reference maps to an actual `GovernedResultSet` cell | no invented evidence |
| **16** | changing a template cannot introduce arithmetic or an unregistered reference | the guard binds future templates, not just today's |
| **17** | identical `GovernedResultSet` + template version → **byte-identical** explanation output | determinism |
| 18 | the WITHHELD text is **byte-identical** across two result sets whose hidden values differ | no magnitude leak |
| 19 | **hosted/DB:** a participant without a grant gets the authorized absence state, and the withheld amount appears nowhere in the response **bytes** | the Slice 1 guarantee survives explanation |
| 20 | UNKNOWN, WITHHELD and suppressed-existence are three distinct paths in the renderer, and no code path collapses two of them | the states stay distinct |
| 21 | an internal reason code never appears in recipient-facing output | reason codes are not disclosure authority |

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
2. ~~**Where do statements render — inline per row, or an expandable panel?**~~ **RULED: inline and
   visible by default**, with the governance qualification that inline visibility never overrides
   disclosure — *if a statement's existence is not authorized, there is no statement to display.*
   Normal explanation and an authorized WITHHELD state may not be hidden behind a click merely to
   reduce visual density.
3. **Is `explain: true` permitted on a multi-row result, or only when `subject.ids` names one
   object?** Multi-row explanation is more useful and more likely to produce noise.
   **Recommend: allow multi-row**, capped by the existing `limit`.
4. ~~**Should ABSENCE distinguish `DERIVATION_DENIED` from `NOT_DISCLOSABLE` in user-facing text?**~~
   **RULED: distinct internally, NOT automatically exposed.** See §5 — `DERIVATION_DENIED` may produce
   operation-level text that reveals no hidden data or hidden existence; `NOT_DISCLOSABLE` splits on
   whether existence is disclosable, and where it is not, **nothing is rendered**. UNKNOWN, WITHHELD
   and suppressed-existence must not be collapsed. My original recommendation was too permissive: it
   would have printed a label wherever a value was suppressed, and a label is itself a disclosure.
5. **Does Slice 2 touch the metric registry at all?** It should not need to.
   **Recommend: no** — if a template wants a number that is not already a registered metric, that is a
   metric change in its own slice, not an explanation feature.

---

## 11. What this plan does not authorize

No LLM · no natural-language plan generation · no pinning · no actions · no exports · no historical
queries · no cross-org ranking · no new canonical state · no new object class, field, filter or
metric · no change to P5, P6 or the Slice 1 governance path.

---

## 12. Ruling record (authoritative — supersedes any recommendation above it)

**Decision 1 — plan echo. RULED: do NOT echo the full `PursuitQuery`.** An `Explanation` carries only
the minimum provenance that binds it to the governed execution: **subject identity · template id ·
template version · plan version · a stable `planDigest`** sufficient to correlate it with the
validated parent result. The canonical validated plan stays owned by the parent execution/result and
is not serialized a second time. *Reason: Slice 2 has no persistence, pinning or export, so an
explanation is not yet an independently portable artifact; duplicating the plan would expand response
bytes and create another disclosure and compatibility surface for a capability Slice 2 does not need.
A future persisted or exported explanation must define its provenance packaging explicitly.* My §10.1
recommendation to echo is superseded.

**Decision 3 — multi-row. RULED: Slice 2 is SINGLE-OBJECT ONLY.** `explain` requires **exactly one**
governed subject object. Zero subjects, multiple subjects, cohort explanation and aggregate
explanation over multiple rows are all **rejected** — and the first row is never silently chosen, nor
are per-row explanations concatenated. A later slice may add multi-row EXPLAIN, but must explicitly
solve statement-count/cardinality leakage, omission shadows, per-row comparability, ordering
semantics, and the distinction between EXPLAIN and ANALYZE. Slice 2 proves the narrower invariant
first: **one governed result can be explained without creating a new information channel.** My §10.3
recommendation to allow multi-row is superseded — and the concern I raised when returning it, that
per-row statement counts become comparable across rows, is exactly what this avoids.

**Decision 5 — metric registry. RULED: Slice 2 does not modify it.** An explanation may reference
only values already present in the `GovernedResultSet` from registered fields and metrics. Templates
perform **no arithmetic**, create **no derived numeric value**, restate **no unregistered metric**,
and **do not infer a number from multiple cells**. A desired explanation needing a value that is not
already a canonical registered field or metric is a metric change in its own slice.

**Implementation direction, binding:**

```
GovernedResultSet → recipient-authorized statement inputs → registered deterministic template → Explanation
```

**never** `all possible statements → template → redact afterward`. Redaction after the fact is the
shape that leaks; selection before the fact is the shape that cannot.

`explain()` remains synchronous, deterministic and pure; holds no database handle; is barred from
importing DB, federation or `unsafe_` readers; is incapable of arithmetic, of fetching, and of
creating a statement whose reference does not map to an authorized `GovernedResultSet` cell.

Slice 2 remains: no LLM · no natural-language planning · no pinning · no actions · no exports · no
historical `asOf` · **no multi-row explanation** · no cross-org ranking · no new tables or schema ·
no P5/P6 change.

**Additional required tests:** the plan digest/reference **cannot be used to reconstruct hidden
data**, and explanation bytes contain **only** information authorized by the governed statement set.
