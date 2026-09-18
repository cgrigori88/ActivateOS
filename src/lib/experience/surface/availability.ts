/**
 * P7 Slice 7 — COMPONENT AVAILABILITY. Pure, synchronous, and total.
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
 * produced, and reduces it to one of two values. Adding an authority check here would be a second
 * resolver for a decision that already has exactly one.
 *
 * THE REDUCTION IS DELIBERATELY LOSSY. `NOT_AVAILABLE` covers revoked, became-undisclosable,
 * disappeared, never-existed and `UNAVAILABLE_TARGET` alike. Inside a composed surface the standalone
 * Slice 4 distinction is NOT preserved — that is an intentional information reduction (ruling B), and
 * it is exactly what stops the surface's shape from reporting what its words may not.
 */
import { isContextBound } from "./registry";
import type { IntentOperation } from "../intent/schema";
import type { IntentExecution } from "../intent/run";

/** Two values and no third. No reason, no detail, and nothing a caller could widen into one. */
export type ComponentAvailability = "AVAILABLE" | "NOT_AVAILABLE";

/**
 * Can this component produce its certified available result?
 *
 * THE DISTINCTION THIS PRESERVES (ruling B): a target that is available but whose VALUES are governed
 * is `AVAILABLE`. A withheld cell, a withheld aggregate and a `WITHHELD` explanation statement are
 * governance working correctly inside a valid component — they were certified in Slices 1–3 and are
 * not failures. Only the TARGET being unavailable fails.
 */
export function componentAvailability(
  operation: IntentOperation, execution: IntentExecution,
): ComponentAvailability {
  if (execution.kind === "NAVIGATION") {
    // ok ⇒ a governed destination exists. Everything else — NOT_AVAILABLE, UNAVAILABLE_TARGET and a
    // malformed request alike — collapses to the one value.
    return execution.outcome.ok ? "AVAILABLE" : "NOT_AVAILABLE";
  }

  if (!execution.outcome.ok) return "NOT_AVAILABLE";

  if (operation === "EXPLAIN") {
    // The governed execution succeeded, but produced NO explanation: there is no authorized subject.
    // This is the branch the standalone route renders as "No explanation is available" — which is
    // correct alone, and is a partial surface when it sits beside a sibling that rendered.
    return execution.outcome.explanation ? "AVAILABLE" : "NOT_AVAILABLE";
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
 * It returns the same two values as `componentAvailability` and carries nothing else: no index, no
 * count, no operation and no reason, so a caller cannot reconstruct WHICH component failed from what
 * it is handed.
 */
export function surfaceAvailability(executed: readonly ExecutedComponent[]): ComponentAvailability {
  for (const e of executed) {
    if (!isContextBound(e.operation)) continue;
    if (componentAvailability(e.operation, e.execution) === "NOT_AVAILABLE") return "NOT_AVAILABLE";
  }
  return "AVAILABLE";
}
