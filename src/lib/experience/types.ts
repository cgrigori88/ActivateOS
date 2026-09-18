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

/**
 * An aggregate request. There is NO organization field anywhere in a plan — a cross-org cohort
 * cannot be REPRESENTED, so there is nothing to accept and reject later (ruling 4).
 */
export type AggregateSpec = false | { id: string; version: number };

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
  /**
   * Slice 2: a REGISTERED template, or `false`. Requesting an explanation requires exactly ONE
   * governed subject object (ruling 3) — zero, several, cohort and aggregate explanations are all
   * refused, and the first row is never silently chosen.
   */
  explain: ExplainSpec;
  /** A REGISTERED aggregate over the governed cohort, or `false`. */
  aggregate: AggregateSpec;
}

/** Why a value is absent. Operation metadata only — never a withheld value or its magnitude. */
export type OmissionReason =
  | "NOT_DISCLOSABLE"        // disclosure resolved to SUPPRESSED
  | "DERIVATION_DENIED"      // mayDerive said no
  | "INPUT_NOT_DISCLOSABLE"; // a contributing input was suppressed, so the result cannot be formed

/**
 * Is the recipient authorized to know this cell EXISTS, independently of its value?
 *
 * Load-bearing for EXPLAIN. `AUTHORIZED` + suppressed value is **WITHHELD** — say so, visibly, so
 * absence is not mistaken for zero. `UNAUTHORIZED` existence must produce **nothing at all**: no
 * placeholder, no label, no tooltip, no count contribution. A label is itself a disclosure.
 */
export type ExistenceDisclosure = "AUTHORIZED" | "UNAUTHORIZED";

export interface GovernedCell {
  /** `EXACT | GENERALIZED | AGGREGATED` carry a value; `SUPPRESSED` never does. */
  visibility: Visibility;
  value: string | number | null;
  /** For a metric: its registry id and version. For a field: its FieldRef. */
  provenance: string;
  reason?: OmissionReason;
  /** Whether the recipient may know this cell exists at all. */
  existence: ExistenceDisclosure;
}

export interface GovernedRow {
  objectRef: { class: ObjectClass; id: string };
  cells: Record<string, GovernedCell>;
}

export interface GovernedResultSet {
  /** Echoed so the surface is re-derivable from the plan alone, and auditable. */
  plan: PursuitQuery;
  /**
   * A stable digest of the validated plan. An `Explanation` carries THIS rather than a second copy
   * of the plan (ruling 1): enough to correlate an explanation with its parent execution, and no
   * more. It is a hash of registry keys and bound values — it contains no governed data, and the
   * suite proves it cannot be used to reconstruct any.
   */
  planDigest: string;
  /** The database transaction instant. Never a JavaScript `Date` comparison (D-P6-1). */
  computedAt: string;
  rows: GovernedRow[];
  /** Operation metadata only. */
  omissions: { objectId?: string; ref: string; reason: OmissionReason }[];
  /** Describes the AUTHORIZED set, and the surface must say so. */
  counts: { authorized: number };
}

// ── ANALYZE (Slice 3) ──────────────────────────────────────────────────────────────────────────

/**
 * The result of one registered aggregate over one governed cohort.
 *
 * `cohort` is the DEFINITION — the question — never the membership. `basis` appears ONLY on a
 * computed aggregate whose every member contributed (ruling 3); on a withheld aggregate it is
 * absent, because a member count beside a withheld value is exactly the differencing channel the
 * withhold-whole rule exists to close.
 */
export interface AggregateResult {
  aggregate: { id: string; version: number };
  over: { id: string; version: number };
  operation: "SUM";
  cohort: { subjectClass: ObjectClass; scope: Scope; filters: Filter[] };
  visibility: "EXACT" | "WITHHELD";
  value: number | null;
  basis?: { members: number };
  provenance: string;
}

// ── GO TO (Slice 4) ─────────────────────────────────────────────────────────────────────────────

/** The registered destination vocabulary. Slice 4 has exactly one, and a second is a code change. */
export type SurfaceKey = "canonical";

/**
 * A canonical navigation request.
 *
 * `ref` is the SAME shape `GovernedRow.objectRef` already emits — GO TO does not invent a second
 * object model, because a reference navigation can name but a governed result cannot is a second way
 * to talk about objects, and every invariant proven about `GovernedRow` would stop covering it.
 *
 * What this type CANNOT express, structurally (ruling 1): a pathname · a URL · a template · a query
 * string · a fragment · a slug · a route parameter · an organization · a scope · a label. There is
 * nothing to sanitize because there is nothing to accept.
 */
export interface GoToRequest {
  requestVersion: 1;
  ref: { class: ObjectClass; id: string };
  surface: SurfaceKey;
}

/**
 * The canonical destination descriptor — NOT an HTTP redirect, a `Response`, or a framework call.
 *
 * Web renders it as a link, an API returns it, MCP returns it. No transport re-checks authorization,
 * and structurally none can: they receive a value, not a query, and hold no database handle. That is
 * what makes "transports duplicate no authorization logic" provable rather than conventional.
 */
export interface NavigationTarget {
  ref: { class: ObjectClass; id: string };
  surface: SurfaceKey;
  /** Formed by `pathFor()` — the single path-forming function. Carries only the canonical id. */
  path: string;
  /** Governed (ruling 4): a disclosed registered cell, or the destination's class-generic fallback. */
  label: string;
}

export type GoToOutcome =
  | { ok: true; target: NavigationTarget }
  /** Unauthorized OR nonexistent — ONE value, and the distinction never crosses this boundary. */
  | { ok: false; error: "NOT_AVAILABLE" }
  /** Existence authorized, the registered surface has no usable destination (ruling 2). */
  | { ok: false; error: "UNAVAILABLE_TARGET" }
  /** The caller's own input was malformed. Describes the request, never stored state. */
  | { ok: false; error: "INVALID_REQUEST"; detail: string };

// ── EXPLAIN (Slice 2) ───────────────────────────────────────────────────────────────────────────

/** A plan asks for an explanation by naming a REGISTERED template. `false` means none. */
export type ExplainSpec = false | { template: { id: string; version: number } };

/**
 * One statement. There are four kinds and no fifth — and a cell whose EXISTENCE is unauthorized
 * produces NO statement at all, which is why omission is a property of the renderer's input
 * selection rather than something removed afterwards.
 */
export type ExplanationStatement =
  | { kind: "FACT"; ref: string; text: string; provenance: string }
  | { kind: "DERIVED"; ref: string; text: string; provenance: string }
  /** Existence authorized, value not. Fixed text, identical regardless of the hidden value. */
  | { kind: "WITHHELD"; ref: string; text: string }
  /** Operation-level: what the system may do, never what the data contains. */
  | { kind: "OPERATION"; ref: string; text: string };

/**
 * Minimum provenance, per ruling 1: enough to bind the explanation to its governed execution, and
 * deliberately NOT a second copy of the plan. Slice 2 has no persistence or export, so an
 * explanation is not yet an independently portable artifact.
 */
export interface Explanation {
  subject: { class: ObjectClass; id: string };
  templateId: string;
  templateVersion: number;
  planVersion: number;
  planDigest: string;
  /** The instant the parent result set carries. Never re-read — there is no clock in here. */
  computedAt: string;
  statements: ExplanationStatement[];
}

export type ExplainOutcome =
  | { ok: true; explanation: Explanation }
  | { ok: false; error: "NO_SUBJECT" | "UNREGISTERED_TEMPLATE" | "MALFORMED"; detail: string };

/** Validation and capability failures are values, not exceptions: the caller renders them. */
export type ExecuteOutcome =
  | { ok: true; result: GovernedResultSet; explanation?: Explanation; explanationError?: string; aggregate?: AggregateResult }
  | { ok: false; error: "INVALID_PLAN"; detail: string }
  | { ok: false; error: "CAPABILITY_DENIED"; detail: string };
