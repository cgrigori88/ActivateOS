/**
 * P7 Slice 2 — THE EXPLANATION TEMPLATE REGISTRY. Closed, code-defined, versioned.
 *
 * A template turns already-governed cells into sentences. It may narrate a cell; it may not
 * calculate, discover, infer or fetch one. Concretely, and enforced by the structural guards in the
 * suite: **no arithmetic**, no derived numeric value, no restatement of an unregistered metric, and
 * no number inferred from several cells. A sentence that computes is a metric wearing a sentence's
 * clothes, and metrics live in the metric registry with provenance.
 *
 * Each template declares `requires`: the only cell references it may name. A template naming
 * anything else fails registration, so "the explanation mentioned something it shouldn't" is a
 * registration-time property rather than a review-time hope.
 */
import type { ExplanationStatement, GovernedCell } from "./types";

/** Formatters are declared, so a value can never be spliced into a claim it does not support. */
const fmt = {
  plain: (v: string | number | null): string => (v === null ? "" : String(v)),
  /** Presentation only: grouping separators are formatting, not arithmetic. */
  number: (v: string | number | null): string =>
    v === null ? "" : new Intl.NumberFormat("en-US").format(Number(v)),
  /** The date portion of an ISO instant. No relative phrasing — that would be a clock reading. */
  date: (v: string | number | null): string => (v === null ? "" : String(v).slice(0, 10)),
};

/**
 * THE REGISTERED WITHHELD REPRESENTATION. One wording, everywhere, so a recipient learns to read it.
 * It is byte-identical regardless of the hidden value — that is what makes it safe, and the suite
 * proves it across result sets whose hidden values differ.
 */
export const WITHHELD_TEXT = "Withheld — you are not authorized to see this value.";

/**
 * THE REGISTERED OPERATION-LEVEL TEXT, for a derivation the caller may not perform. It describes
 * what the system may do, never what the data contains: it names no input, no class of evidence and
 * no particular undisclosed fact. "No live grant covers the economic value here" would already be
 * too much — it asserts there is an economic value to cover.
 */
export const OPERATION_UNAVAILABLE_TEXT = "This analysis isn't available for this result.";

export interface TemplateContext {
  /** Only the cells the plan projected, already governed. There is no other way in. */
  cells: ReadonlyMap<string, GovernedCell>;
  /** Build a statement for a cell the renderer has already judged disclosable. */
  fact: (ref: string, label: string, format?: keyof typeof fmt) => ExplanationStatement | null;
  derived: (ref: string, label: string, format?: keyof typeof fmt) => ExplanationStatement | null;
}

export interface ExplanationTemplate {
  id: string;
  version: number;
  /** The only refs this template may name. Registration fails if it reaches for another. */
  requires: readonly string[];
  render: (ctx: TemplateContext) => (ExplanationStatement | null)[];
  provenance: string;
}

export const TEMPLATES: Record<string, ExplanationTemplate> = {
  "pursuit.summary@1": {
    id: "pursuit.summary",
    version: 1,
    requires: [
      "pursuit.status", "pursuit.pursuit_type", "pursuit.account_name", "pursuit.updated_at",
      "pursuit.open_pipeline_usd@1",
    ],
    provenance:
      "States this pursuit's disclosed status, type, account and last update, and its open-pipeline " +
      "metric, each attributed to the registered field or metric it came from. It asserts nothing " +
      "that is not a cell of the governed result.",
    render: (ctx) => [
      ctx.fact("pursuit.account_name", "Account"),
      ctx.fact("pursuit.status", "Status"),
      ctx.fact("pursuit.pursuit_type", "Type"),
      ctx.fact("pursuit.updated_at", "Last updated", "date"),
      ctx.derived("pursuit.open_pipeline_usd@1", "Open pipeline (USD)", "number"),
    ],
  },
};

export const templateKey = (id: string, version: number): string => `${id}@${version}`;
export const FORMATTERS = fmt;
