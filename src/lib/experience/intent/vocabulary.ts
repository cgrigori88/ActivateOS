/**
 * P7 Slice 5 — THE VOCABULARY THE MODEL SEES, derived from the canonical registries.
 *
 * NOT PROSE THAT CAN DRIFT. Every key here is read from `registry.ts` and `plans.ts` at call time, so
 * a metric added, renamed or retired cannot leave a stale hand-written list behind. This is the same
 * rule that made P7 import `PURSUIT_STATUSES` from the lifecycle module rather than restate it.
 *
 * IT CONTAINS NO DATA. Registry keys and their labels only — no account names, no organization names,
 * no row values, no counts of authorized objects. Intent compilation decides WHICH registered
 * operation the user is asking for, and that question is answerable from the utterance and the
 * vocabulary alone. Because no governed value enters the prompt, no disclosure decision is ever
 * delegated to prompt construction.
 *
 * The canonical ids behind the context are NOT here either (ruling 2): the model sees how many slots
 * exist and their recipient-safe labels, never an identifier it could echo back.
 */
import { createHash } from "node:crypto";
import { AGGREGATES, DESTINATIONS, FIELDS, METRICS } from "../registry";
import { PLANS, VIEW_KEYS } from "../plans";

export interface CompilerVocabulary {
  operations: string[];
  views: { key: string; label: string; aggregate: string | null }[];
  fields: { ref: string; label: string }[];
  metrics: { key: string; label: string }[];
  aggregates: { key: string; label: string }[];
  surfaces: string[];
  clarifications: string[];
}

export const OPERATIONS = ["SHOW_ME", "ANALYZE", "EXPLAIN", "GO_TO", "NEEDS_CLARIFICATION", "UNSUPPORTED"] as const;
export const CLARIFICATIONS = ["view", "subject", "operation"] as const;

export function compilerVocabulary(): CompilerVocabulary {
  return {
    operations: [...OPERATIONS],
    views: VIEW_KEYS.map((key) => ({
      key,
      label: PLANS[key].label,
      // Whether this view carries a registered aggregate decides whether ANALYZE is available for it.
      aggregate: PLANS[key].plan.aggregate === false ? null : `${PLANS[key].plan.aggregate.id}@${PLANS[key].plan.aggregate.version}`,
    })),
    fields: Object.entries(FIELDS).map(([ref, def]) => ({ ref, label: def.label })),
    metrics: Object.entries(METRICS).map(([key, def]) => ({ key, label: def.label })),
    aggregates: Object.entries(AGGREGATES).map(([key, def]) => ({ key, label: def.label })),
    surfaces: [...new Set(Object.values(DESTINATIONS).map((d) => d.surface))],
    clarifications: [...CLARIFICATIONS],
  };
}

/** A digest of the exact vocabulary presented, stamped into provenance so a run is reproducible. */
export function vocabularyDigest(v: CompilerVocabulary = compilerVocabulary()): string {
  return createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
}

/**
 * THE RECIPIENT-FACING OPERATION LABELS (ruling 8).
 *
 * Every successful execution states which canonical operation ran, and the words come from here plus
 * the registry's own view label — never from model prose. A substituted intent is therefore visible
 * to the user, which is the mitigation that makes the prompt-injection residual acceptable.
 */
const OPERATION_LABELS: Record<string, string> = {
  SHOW_ME: "Show",
  ANALYZE: "Analyze",
  EXPLAIN: "Explain",
  GO_TO: "Go to",
};

export function interpretedAs(operation: string, viewKey?: string): string {
  const verb = OPERATION_LABELS[operation] ?? operation;
  if (viewKey && viewKey in PLANS) return `${verb}: ${PLANS[viewKey as keyof typeof PLANS].label}`;
  // Subject-scoped operations name the object CLASS, never the object — naming it would disclose.
  return `${verb}: this pursuit`;
}

/**
 * The registered clarification questions. Deterministic, and deliberately incapable of enumerating
 * objects or implying undisclosed alternatives (ruling 7): each names registered vocabulary only.
 */
export const CLARIFICATION_QUESTIONS: Record<string, string> = {
  view: "Which view did you mean? Choose one of the available views above.",
  subject: "Which pursuit did you mean? Open one first, then ask again.",
  operation: "Did you want to see a view, analyze a cohort, explain one pursuit, or go to one?",
};
