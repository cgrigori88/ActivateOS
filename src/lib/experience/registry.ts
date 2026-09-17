/**
 * P7 Slice 1 — THE CLOSED REGISTRY. This file is the entire vocabulary a plan may name.
 *
 * WHY A REGISTRY RATHER THAN A QUERY BUILDER. A plan carries registry keys, never SQL. The column
 * names live here, beside the audience and information class that govern them, so there is exactly
 * one place where "what may be asked for" is defined and it is a code change — reviewed, versioned
 * and tested. An identifier that is not in this file cannot be validated, therefore cannot be
 * executed, therefore cannot reach the database. That is the same shape as `mayDerive`'s rule that
 * an unmapped input DENIES rather than falling through to a catch-all.
 *
 * NOTHING HERE IS RUNTIME-CREATABLE. Not by a user, not by a model, not by an insert.
 */
import type { Audience } from "@/lib/pursuits/federation/disclosure";
import { PURSUIT_STATUSES, TERMINAL_STATUSES } from "@/lib/pursuits/lifecycle";
import { PURSUIT_TYPES } from "@/lib/pursuits/model";
import type { FieldRef, FilterDimension, FilterOperator, MetricRef, ObjectClass } from "./types";

/** The canonical relation a class reads from. Referenced by the loader; never by a plan. */
export const OBJECT_CLASSES: Record<ObjectClass, { table: string; identity: string }> = {
  pursuit: { table: "pursuits", identity: "id" },
};

export interface FieldDef {
  /** The canonical column this field projects. The ONLY place a column name is bound to a key. */
  column: string;
  /** SQL expression when the value is not a plain column on the base table. */
  expression?: string;
  /**
   * How this field is disclosed to a viewer who is not the owning organization. `PARTICIPANT_SHARED`
   * means an ACTIVE participant sees the exact value; `PURSUIT_INTERNAL` means they do not.
   */
  audience: Audience;
  /** Rendered column heading. Presentation only; it carries no semantics. */
  label: string;
}

/**
 * The complete projection vocabulary. Deliberately EXCLUDED: every `current_*_score` and
 * `expected_value_*` column. Those are scoring and valuation outputs whose definitions P7 does not
 * own; projecting one would put a number on screen with no provenance P7 can state, which is the
 * shadow-metric failure the contract forbids (§14 row 4). They become available only as registered
 * metrics with declared provenance, and only if the owning domain agrees.
 */
export const FIELDS: Record<FieldRef, FieldDef> = {
  "pursuit.id":              { column: "id",               audience: "PARTICIPANT_SHARED", label: "Pursuit" },
  "pursuit.status":          { column: "status",           audience: "PARTICIPANT_SHARED", label: "Status" },
  "pursuit.pursuit_type":    { column: "pursuit_type",     audience: "PARTICIPANT_SHARED", label: "Type" },
  "pursuit.use_case":        { column: "use_case",         audience: "PARTICIPANT_SHARED", label: "Use case" },
  // Timing is governed: a partner's compelling event and window are internal to the owning org
  // unless that org has shared them. Participants get whatever the ladder allows, never the raw value.
  "pursuit.compelling_event":{ column: "compelling_event", audience: "PURSUIT_INTERNAL",   label: "Compelling event" },
  "pursuit.timing_window":   { column: "timing_window",    audience: "PURSUIT_INTERNAL",   label: "Timing window" },
  "pursuit.account_name":    { column: "account_name", expression: "(select c.legal_name from companies c where c.id = p.account_id)",
                               audience: "PARTICIPANT_SHARED", label: "Account" },
  "pursuit.updated_at":      { column: "updated_at",       audience: "PARTICIPANT_SHARED", label: "Updated" },
};

export interface FilterDef {
  column: string;
  ops: readonly FilterOperator[];
  /** When present, a value outside this list is rejected by validation. */
  values?: readonly string[];
  /** True when values must be canonical uuids. */
  uuid?: boolean;
}

/**
 * THE CANONICAL VOCABULARIES ARE IMPORTED, NOT RESTATED.
 *
 * `PURSUIT_STATUSES` and `TERMINAL_STATUSES` are the lifecycle module's own constants — the same
 * values `transitionPursuit` enforces — and `PURSUIT_TYPES` is the pursuit model's. P7 holds no
 * vocabulary of its own: a validation list retyped here would be a second definition of a canonical
 * fact, which is precisely what this workstream exists not to do.
 *
 * These lists are a FAIL-FAST GUARD, not truth. They let validation refuse an unknown value before a
 * statement is built; the database CHECK constraints remain the authority, and the seeded suite
 * proves the code constants and the constraints still agree (drift fails loudly, in either
 * direction, rather than silently narrowing or broadening what P7 will accept).
 */
/** Live statuses, derived from the canonical lists rather than restated. */
export const OPEN_STATUSES: readonly string[] = PURSUIT_STATUSES.filter((s) => !(TERMINAL_STATUSES as readonly string[]).includes(s));

export const FILTERS: Record<FilterDimension, FilterDef> = {
  "pursuit.status":       { column: "status",       ops: ["=", "in"], values: PURSUIT_STATUSES },
  "pursuit.pursuit_type": { column: "pursuit_type", ops: ["=", "in"], values: PURSUIT_TYPES },
  "pursuit.account":      { column: "account_id",   ops: ["="], uuid: true },
};

/**
 * THE METRIC REGISTRY.
 *
 * A metric is canonical iff it is here. `id` + `version` is the key, and **a released definition is
 * immutable** (ruling 3): changing the formula means a new version, so a surface that referenced v1
 * keeps meaning what it meant. No retention machinery is built now — the compatibility obligation
 * begins when a pin or an external interface can reference a version, and that is designed with
 * pinning.
 *
 * `informationClasses` is what makes the metric governed rather than merely computed: it is the P6
 * class `mayDerive` is asked about before any input is read for a pursuit this viewer does not own.
 */
export interface MetricDef {
  id: MetricRef["id"];
  version: MetricRef["version"];
  /** The canonical inputs, as a registry-level description — not SQL the caller can influence. */
  inputs: { relation: string; predicate: string; valueColumn: string };
  informationClasses: readonly string[];
  /** The input kind handed to `mayDerive`; it must exist in INPUT_CLASS_REGISTRY. */
  deriveInputKind: string;
  /** The derivation purpose asserted for this metric; it must be a DERIVATION purpose. */
  derivePurpose: string;
  determinism: "DETERMINISTIC";
  provenance: string;
  label: string;
}

export const METRICS: Record<string, MetricDef> = {
  "pursuit.open_pipeline_usd@1": {
    id: "pursuit.open_pipeline_usd",
    version: 1,
    inputs: {
      relation: "opportunities",
      predicate: "pursuit_id = $pursuit and stage not in ('closed_won','closed_lost')",
      valueColumn: "amount_usd",
    },
    informationClasses: ["economic_value"],
    deriveInputKind: "economic_fact",
    derivePurpose: "VALUE_CASE",
    determinism: "DETERMINISTIC",
    provenance:
      "Sum of amount_usd over this pursuit's OWN open opportunities (stage not in closed_won, " +
      "closed_lost), computed only from inputs the caller is authorized to derive from and that " +
      "survive disclosure resolution. Not a forecast, not a probability, not a pertinence signal.",
    label: "Open pipeline (USD)",
  },
};

export const metricKey = (m: MetricRef): string => `${m.id}@${m.version}`;

/**
 * THE AGGREGATE REGISTRY — inside the SAME registry, never a second one.
 *
 * An aggregate DELEGATES to an already-registered per-member metric: it names `over`, and the
 * analysis layer reads that metric's governed cells. It does not re-derive the value, re-check the
 * authority, or re-implement the arithmetic — so a member's contribution carries exactly the
 * `mayDerive` and disclosure decisions P6 already made about it, and there is no second place where
 * "what this number means" could drift.
 *
 * `operation` comes from a closed set. The analysis layer performs no other arithmetic anywhere.
 */
export type AggregateOperation = "SUM";

export interface AggregateDef {
  id: string;
  version: number;
  /** The registered per-member metric whose GOVERNED cells this aggregate sums. */
  over: MetricRef;
  operation: AggregateOperation;
  provenance: string;
  label: string;
}

export const AGGREGATES: Record<string, AggregateDef> = {
  "cohort.open_pipeline_usd@1": {
    id: "cohort.open_pipeline_usd",
    version: 1,
    over: { id: "pursuit.open_pipeline_usd", version: 1 },
    operation: "SUM",
    provenance:
      "Sum of the registered per-pursuit open-pipeline metric across the members of this governed " +
      "cohort. Computed only when EVERY member's contribution is disclosable to you; otherwise the " +
      "whole aggregate is withheld rather than partially computed. Not a forecast, not a " +
      "probability, not a ranking, not a pertinence signal, and not a total of anything you are not " +
      "authorized to see.",
    label: "Cohort open pipeline (USD)",
  },
};

export const aggregateKey = (a: { id: string; version: number }): string => `${a.id}@${a.version}`;

/** Ordering keys. `pursuit.id asc` is always appended, so every ordering is total and reproducible. */
export const ORDERABLE = new Set<string>(["pursuit.updated_at", "metric:pursuit.open_pipeline_usd@1"]);

export const MAX_LIMIT = 200;
