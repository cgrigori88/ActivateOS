/**
 * P7 Slice 3 — DETERMINISTIC ANALYZE. Pure, synchronous, and unable to reach anything.
 *
 * THE ORDER IS THE WHOLE SAFETY ARGUMENT:
 *
 *   candidate discovery → scope → registered filters → P6 eligibility/disclosure
 *     → COHORT MEMBERSHIP → aggregation
 *
 * A row that governance did not admit **never becomes a member**. It is not filtered out after
 * computation; it was never in the set. There is no pre-existing "true cohort" that is later redacted
 * for a recipient, and therefore no total to difference against. Like `explain()`, this module holds
 * no database handle — a function that cannot reach the database cannot widen a cohort.
 *
 * WITHHOLD WHOLE, NEVER PARTIAL (ruling 1). If even one member's contribution is withheld, the
 * aggregate is WITHHELD: no partial sum, no sum of the authorized subset, and no basis metadata.
 * Publishing a cohort size beside a sum over a strict subset of it is a differencing channel whose
 * difference is exactly the withheld contributions. *P7 may return less information; it may not
 * silently change what the metric means.*
 *
 * IT DELEGATES, IT DOES NOT RE-DERIVE. The per-member value is read from the governed cell that
 * `pursuit.open_pipeline_usd@1` already produced — carrying the `mayDerive` and disclosure decisions
 * P6 made about it. This module re-checks no authority and re-implements no metric arithmetic; the
 * only arithmetic it performs is the registered `operation` itself.
 */
import { AGGREGATES, aggregateKey, metricKey } from "./registry";
import type { AggregateResult, GovernedResultSet } from "./types";

export type AnalyzeOutcome =
  | { ok: true; result: AggregateResult }
  | { ok: false; error: "UNREGISTERED_AGGREGATE" | "METRIC_NOT_SELECTED"; detail: string };

export function analyze(result: GovernedResultSet, id: string, version: number): AnalyzeOutcome {
  const def = AGGREGATES[aggregateKey({ id, version })];
  if (!def) return { ok: false, error: "UNREGISTERED_AGGREGATE", detail: `unknown aggregate ${id}@${version}` };

  const overKey = metricKey(def.over);
  // The aggregate can only read a metric the plan actually selected, because only then did
  // governance resolve it. Summing a metric nobody asked to govern would be summing nothing.
  if (!result.plan.metrics.some((m) => metricKey(m) === overKey)) {
    return { ok: false, error: "METRIC_NOT_SELECTED", detail: `${def.id}@${def.version} requires ${overKey} in metrics[]` };
  }

  const cohort = {
    subjectClass: result.plan.subject.class,
    scope: result.plan.scope,
    filters: result.plan.filters,
  };
  const withheld = (): AnalyzeOutcome => ({
    ok: true,
    result: {
      aggregate: { id: def.id, version: def.version },
      over: def.over,
      operation: def.operation,
      cohort,                       // the DEFINITION — the question, never the membership
      visibility: "WITHHELD",
      value: null,
      // basis is ABSENT here, deliberately: a member count beside a withheld value would disclose
      // the composition of a cohort whose aggregate cannot be safely computed (ruling 3).
      provenance: def.provenance,
    },
  });

  // MEMBERSHIP is what governance returned — nothing is added, nothing is filtered out here.
  const members = result.rows;
  const contributions: number[] = [];
  for (const row of members) {
    const cell = row.cells[overKey];
    // A member present in the cohort whose contribution is not disclosable withholds the WHOLE
    // aggregate. Existence-unauthorized rows are not in `members` at all — they were never admitted.
    if (!cell || cell.visibility === "SUPPRESSED" || cell.value === null || typeof cell.value !== "number") {
      return withheld();
    }
    contributions.push(cell.value);
  }

  return {
    ok: true,
    result: {
      aggregate: { id: def.id, version: def.version },
      over: def.over,
      operation: def.operation,
      cohort,
      visibility: "EXACT",
      value: apply(def.operation, contributions),
      // Every counted member is one the principal can see individually AND one that contributed, so
      // the count discloses nothing the cohort itself did not (ruling 3, §F).
      basis: { members: members.length },
      provenance: def.provenance,
    },
  };
}

/** The only arithmetic in the analysis layer, and it is the registered operation. */
function apply(operation: "SUM", values: number[]): number {
  switch (operation) {
    case "SUM":
      return values.reduce((a, b) => a + b, 0);
  }
}
