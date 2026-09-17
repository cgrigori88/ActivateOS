/**
 * P7 Slice 2 — THE EXPLANATION RENDERER. Pure, synchronous, and unable to reach anything.
 *
 * THE GUARANTEE IS THE INPUT TYPE, NOT THE PROSE. `explain()` takes a `GovernedResultSet` and a
 * template id. It has no database handle, no pool, no loader and no org id; it imports nothing under
 * `@/db`, `federation/` or any `unsafe_` reader. A function that cannot reach the database cannot
 * disclose what the database never handed it, so a reviewer checks one signature instead of reading
 * every template.
 *
 * THE DIRECTION IS LOAD-BEARING (ruling):
 *
 *     governed cells → SELECT the recipient-authorized ones → render
 *     never:  render everything → redact afterwards
 *
 * Redaction after the fact is the shape that leaks — something always survives the pass. Selection
 * before the fact cannot: a statement that was never built has no bytes, no ordinal and no place in
 * the count.
 *
 * THREE ABSENCE STATES, NEVER COLLAPSED:
 *   • existence UNAUTHORIZED           → no statement at all. No placeholder, no label, no tooltip,
 *                                        no count contribution. A label is itself a disclosure.
 *   • existence authorized, value not  → the registered WITHHELD representation, inline and visible,
 *                                        so absence is not mistaken for zero.
 *   • derivation denied / input hidden → operation-level text: what the system may do, never what
 *                                        the data contains.
 *
 * SINGLE OBJECT ONLY (ruling 3). Exactly one governed subject, or nothing: zero and several are both
 * refused, the first row is never silently chosen, and per-row explanations are never concatenated.
 */
import { OPERATION_UNAVAILABLE_TEXT, TEMPLATES, WITHHELD_TEXT, FORMATTERS, templateKey, type TemplateContext } from "./explain-templates";
import type { ExplainOutcome, Explanation, ExplanationStatement, GovernedCell, GovernedResultSet } from "./types";

/**
 * Render the explanation for a governed result.
 *
 * Synchronous by design: there is no `await` through which a second, ungoverned read could be
 * interleaved between governance and prose.
 */
export function explain(result: GovernedResultSet, templateId: string, templateVersion: number): ExplainOutcome {
  const key = templateKey(templateId, templateVersion);
  const template = TEMPLATES[key];
  if (!template) return { ok: false, error: "UNREGISTERED_TEMPLATE", detail: `unknown explanation template ${key}` };

  // EXACTLY ONE subject. Zero has nothing to explain; several would make statement counts comparable
  // across rows, which is a channel this slice deliberately does not open.
  if (result.rows.length !== 1) {
    return {
      ok: false,
      error: "NO_SUBJECT",
      detail: result.rows.length === 0
        ? "there is no authorized subject to explain"
        : "an explanation covers exactly one subject; this result has several",
    };
  }
  const row = result.rows[0];
  const cells = new Map<string, GovernedCell>(Object.entries(row.cells));

  // SELECTION BEFORE RENDERING. A cell whose existence is unauthorized is removed here, before any
  // template sees it, so the template cannot render it, count it, or leave a gap where it was.
  const disclosable = new Map<string, GovernedCell>();
  for (const [ref, cell] of cells) if (cell.existence === "AUTHORIZED") disclosable.set(ref, cell);

  const statementFor = (ref: string, label: string, format: keyof typeof FORMATTERS, kind: "FACT" | "DERIVED"): ExplanationStatement | null => {
    const cell = disclosable.get(ref);
    if (!cell) return null;                       // unauthorized existence, or simply not projected
    if (cell.visibility === "SUPPRESSED") {
      // Existence is authorized (it survived the filter above), so absence is stated.
      return cell.reason === "NOT_DISCLOSABLE"
        ? { kind: "WITHHELD", ref, text: `${label}: ${WITHHELD_TEXT}` }
        // DERIVATION_DENIED and INPUT_NOT_DISCLOSABLE both become operation-level text: naming the
        // input would assert that a particular hidden fact exists.
        : { kind: "OPERATION", ref, text: `${label}: ${OPERATION_UNAVAILABLE_TEXT}` };
    }
    const rendered = FORMATTERS[format](cell.value);
    if (rendered === "") return null;             // a disclosed-but-empty value states nothing
    return { kind, ref, text: `${label}: ${rendered}`, provenance: cell.provenance };
  };

  const ctx: TemplateContext = {
    cells: disclosable,
    fact: (ref, label, format = "plain") => statementFor(ref, label, format, "FACT"),
    derived: (ref, label, format = "plain") => statementFor(ref, label, format, "DERIVED"),
  };

  const rendered = template.render(ctx).filter((s): s is ExplanationStatement => s !== null);

  // EVERY STATEMENT MUST TRACE TO A CELL, and to a ref the template declared. A statement that does
  // not makes the whole explanation malformed and refused — dropping it quietly would leave an
  // explanation that looks complete while a template mints references.
  for (const s of rendered) {
    if (!cells.has(s.ref)) {
      return { ok: false, error: "MALFORMED", detail: `statement references ${s.ref}, which is not a cell of this result` };
    }
    if (!template.requires.includes(s.ref)) {
      return { ok: false, error: "MALFORMED", detail: `statement references ${s.ref}, which the template does not declare` };
    }
  }

  const explanation: Explanation = {
    subject: row.objectRef,
    templateId: template.id,
    templateVersion: template.version,
    planVersion: result.plan.queryVersion,
    // Ruling 1: the digest binds this explanation to its parent execution. The plan itself is NOT
    // copied here — the parent result owns it, and Slice 2 has no export that would need a second.
    planDigest: result.planDigest,
    computedAt: result.computedAt,   // the parent's instant; there is no clock in this module
    statements: rendered,
  };
  return { ok: true, explanation };
}
