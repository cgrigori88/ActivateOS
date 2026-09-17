/**
 * P7 Slice 1 — the shapes that cross the experience boundary.
 *
 * Contract: docs/p7-pursuit-experience-analysis-contract.md · Plan: docs/p7-slice-1-plan.md.
 *
 * THE GOVERNING SENTENCE: P7 owns presentation, query composition and explanation. It owns no truth.
 *
 * A `PursuitQuery` is the only thing that executes, and it carries **no SQL, table or column name**:
 * every identifier in it is a registry key, resolved to canonical SQL by the loader. A
 * `GovernedResultSet` is the only thing computation or presentation ever sees, and a suppressed cell
 * carries no value — the raw value is dropped at governance resolution, not hidden at render.
 */
import type { Scope } from "@/lib/scope/scope";
import type { Visibility } from "@/lib/pursuits/federation/disclosure";

/** The one object class registered in Slice 1. */
export type ObjectClass = "pursuit";

/** Registry keys. Narrow string unions, so an unregistered key cannot type-check either. */
export type FieldRef =
  | "pursuit.id" | "pursuit.status" | "pursuit.pursuit_type" | "pursuit.use_case"
  | "pursuit.compelling_event" | "pursuit.timing_window" | "pursuit.account_name" | "pursuit.updated_at";

export type FilterDimension = "pursuit.status" | "pursuit.pursuit_type" | "pursuit.account";
export type FilterOperator = "=" | "in";

export interface Filter {
  dimension: FilterDimension;
  op: FilterOperator;
  values: string[];
}

/** A metric is referenced by id AND version; the pair is the registry key (ruling 3: immutable). */
export interface MetricRef {
  id: "pursuit.open_pipeline_usd";
  version: 1;
}

export type OrderRef =
  | { ref: "pursuit.updated_at"; dir: "asc" | "desc" }
  | { ref: "metric:pursuit.open_pipeline_usd@1"; dir: "asc" | "desc" };

export interface PursuitQuery {
  queryVersion: 1;
  subject: { class: ObjectClass; ids?: string[] };
  scope: Scope;
  filters: Filter[];
  metrics: MetricRef[];
  projection: FieldRef[];
  ordering?: OrderRef[];
  limit?: number;
  /** MUST be null in Slice 1. A non-null value is rejected by validation (ruling 3 of the contract). */
  asOf: null;
  /** MUST be false in Slice 1. EXPLAIN arrives in Slice 2 as deterministic templates (ruling 4). */
  explain: false;
}

/** Why a value is absent. Operation metadata only — never a withheld value or its magnitude. */
export type OmissionReason =
  | "NOT_DISCLOSABLE"        // disclosure resolved to SUPPRESSED
  | "DERIVATION_DENIED"      // mayDerive said no
  | "INPUT_NOT_DISCLOSABLE"; // a contributing input was suppressed, so the result cannot be formed

export interface GovernedCell {
  /** `EXACT | GENERALIZED | AGGREGATED` carry a value; `SUPPRESSED` never does. */
  visibility: Visibility;
  value: string | number | null;
  /** For a metric: its registry id and version. For a field: its FieldRef. */
  provenance: string;
  reason?: OmissionReason;
}

export interface GovernedRow {
  objectRef: { class: ObjectClass; id: string };
  cells: Record<string, GovernedCell>;
}

export interface GovernedResultSet {
  /** Echoed so the surface is re-derivable from the plan alone, and auditable. */
  plan: PursuitQuery;
  /** The database transaction instant. Never a JavaScript `Date` comparison (D-P6-1). */
  computedAt: string;
  rows: GovernedRow[];
  /** Operation metadata only. */
  omissions: { objectId?: string; ref: string; reason: OmissionReason }[];
  /** Describes the AUTHORIZED set, and the surface must say so. */
  counts: { authorized: number };
}

/** Validation and capability failures are values, not exceptions: the caller renders them. */
export type ExecuteOutcome =
  | { ok: true; result: GovernedResultSet }
  | { ok: false; error: "INVALID_PLAN"; detail: string }
  | { ok: false; error: "CAPABILITY_DENIED"; detail: string };
