/**
 * P7 Slice 7 — COMPONENT DISPOSITION. Pure, synchronous, and total.
 *
 * > **Manifest membership is identity binding, not durable authorization.**
 *
 * A manifest slot says *which* object a compiled request names. It says nothing about whether that
 * object may still be disclosed when the component actually runs — governance decides that, freshly,
 * inside the certified boundary. So a spec that compiled at T1 may execute at T2 against an object the
 * principal can no longer be told about, and this module is where that is noticed.
 *
 * IT IS A CLASSIFIER, NOT A SECOND AUTHORITY (ruling B2). It performs no check of its own, holds no
 * database handle and reads no principal: it inspects an ALREADY-GOVERNED `IntentExecution` that P6
 * produced, and reduces it to one of four dispositions. Adding an authority check here would be a
 * second resolver for a decision that already has exactly one.
 *
 * ── THE LINE THIS MODULE EXISTS TO HOLD ────────────────────────────────────────────────────────
 *
 * > **`NOT_AVAILABLE` is the recipient-safe collapse of GOVERNED OBJECT AVAILABILITY. It is not
 * > generic error masking.**
 *
 * Only a certified governed decision about the target may collapse into it. An unexpected exception,
 * a malformed internal result, an infrastructure or provider failure and a programming defect are
 * APPLICATION FAILURES, and calling them "not available" would tell the recipient something false
 * about governance while hiding a bug behind a disclosure word. Those become `FAILED`, which is a
 * different thing and says so.
 *
 * The reduction that IS deliberately lossy is the governed one: `NOT_AVAILABLE` covers revoked,
 * became-undisclosable, disappeared, never-existed and `UNAVAILABLE_TARGET` alike. Inside a composed
 * surface the standalone Slice 4 distinction is NOT preserved — an intentional information reduction
 * (ruling B), and what stops the surface's shape from reporting what its words may not.
 */
import { isContextBound } from "./registry";
import type { IntentOperation } from "../intent/schema";
import type { IntentExecution } from "../intent/run";

/**
 * Four dispositions, and each means exactly one thing.
 *
 * `NOT_AVAILABLE` is a GOVERNANCE decision about the target. `CAPABILITY_DENIED` is the entitlement
 * conjunction — organization-wide, identical for every object, and therefore not a statement about
 * any object. `FAILED` is an application defect. Keeping the three apart is the whole point: a defect
 * that arrived wearing a governance word would be both a lie and a lost bug report.
 */
export type ComponentDisposition = "AVAILABLE" | "NOT_AVAILABLE" | "CAPABILITY_DENIED" | "FAILED";

/**
 * What happened to this component?
 *
 * THE DISTINCTION THIS PRESERVES (ruling B): a target that is available but whose VALUES are governed
 * is `AVAILABLE`. A withheld cell, a withheld aggregate and a `WITHHELD` explanation statement are
 * governance working correctly inside a valid component — certified in Slices 1–3, and not failures.
 * Only the TARGET being unavailable is `NOT_AVAILABLE`.
 */
export function componentDisposition(
  operation: IntentOperation, execution: IntentExecution,
): ComponentDisposition {
  if (execution.kind === "NAVIGATION") {
    if (execution.outcome.ok) return "AVAILABLE";
    switch (execution.outcome.error) {
      // Both are GOVERNED answers about the target: unauthorized-or-nonexistent, and
      // existence-authorized-but-no-destination. Ruling B collapses them to one value here.
      case "NOT_AVAILABLE":
      case "UNAVAILABLE_TARGET":
        return "NOT_AVAILABLE";
      // The request was built by the COMPILER from a resolved manifest slot, not by a caller. A
      // malformed one means application code produced an invalid certified request: a defect.
      case "INVALID_REQUEST":
        return "FAILED";
    }
  }

  if (!execution.outcome.ok) {
    // Entitlement, not object availability: the same answer for every object, so it discloses none.
    if (execution.outcome.error === "CAPABILITY_DENIED") return "CAPABILITY_DENIED";
    // A plan this application built failed its own validator. That is a defect, not governance.
    return "FAILED";
  }

  if (operation === "EXPLAIN") {
    if (execution.outcome.explanation) return "AVAILABLE";
    // NO AUTHORIZED SUBJECT — the governed read admitted no row, so there is nothing this recipient
    // may be told about. This is the branch the standalone route renders as "No explanation is
    // available", which is correct alone and is a partial surface beside a sibling that rendered.
    if (execution.outcome.result.rows.length === 0) return "NOT_AVAILABLE";
    // The subject WAS authorized and an explanation still did not come back: an unregistered
    // template, a malformed one, or a single-subject plan that returned several rows. Every one of
    // those is a defect in this application, and none of them is a statement about the recipient.
    return "FAILED";
  }

  // SHOW_ME / ANALYZE bind no object, so there is no target whose availability could be in question.
  // An empty authorized set is a governed answer, not an absent target (Slices 1 and 3 certified it).
  return "AVAILABLE";
}

/** One executed component, reduced to the only two things the whole-surface rule depends on. */
export interface ExecutedComponent {
  /** The CERTIFIED operation, not the component key: the rule is inherited from the operation. */
  operation: IntentOperation;
  execution: IntentExecution;
}

/**
 * THE WHOLE-SURFACE RULE (ruling B), as a pure total function over the FULL executed set.
 *
 * > If either context-bound component cannot produce its certified available result, the entire
 * > surface fails.
 *
 * It is deliberately a reducer over every component rather than a per-component early exit, because
 * the property being decided is a property of the SURFACE. One unavailable context-bound component
 * makes the whole set unavailable no matter how many siblings succeeded — there is no arithmetic here
 * by which a majority of healthy components could outvote it.
 *
 * PRECEDENCE IS DEFECT-FIRST, and that ordering is the clarification made executable: a `FAILED`
 * component decides the surface BEFORE any governance disposition can be considered, so a bug can
 * never be absorbed into — or hidden behind — a governed `NOT_AVAILABLE`. `CAPABILITY_DENIED`
 * likewise keeps its own meaning rather than being folded into a statement about an object.
 *
 * It returns a disposition and nothing else: no index, no count, no operation and no reason, so a
 * caller cannot reconstruct WHICH component produced it from what it is handed.
 *
 * Only CONTEXT-BOUND components participate. `SHOW_ME`/`ANALYZE` keep the per-component rendering
 * certified in Slice 6 — this slice was not authorized to change them, and they name no object whose
 * availability could make a surface partial.
 */
export function surfaceDisposition(executed: readonly ExecutedComponent[]): ComponentDisposition {
  const bound = executed.filter((e) => isContextBound(e.operation))
    .map((e) => componentDisposition(e.operation, e.execution));
  // Defect first — a failure must never be masked by a governance word.
  if (bound.includes("FAILED")) return "FAILED";
  if (bound.includes("CAPABILITY_DENIED")) return "CAPABILITY_DENIED";
  if (bound.includes("NOT_AVAILABLE")) return "NOT_AVAILABLE";
  return "AVAILABLE";
}
