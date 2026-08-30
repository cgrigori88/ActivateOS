/**
 * Materiality policy (Workstream A, §15 / §28). Not every background refresh is an
 * executive notification. Only material commercial changes surface in "What Changed?".
 * Thresholds are centralized here so scoring/interaction/route code agrees.
 */

export type Materiality = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** Priority-score delta magnitude → materiality. */
export function priorityDeltaMateriality(delta: number): Materiality {
  const d = Math.abs(delta);
  if (d >= 20) return "CRITICAL";
  if (d >= 8) return "HIGH";
  if (d >= 3) return "MEDIUM";
  return "LOW";
}

/** Change types that are inherently material regardless of magnitude. */
export const INHERENTLY_MATERIAL = new Set<string>([
  "TIMING_CHANGED",
  "FACT_PROMOTED",
  "CONTRADICTION_DETECTED",
  "PARTNER_ROUTE_CHANGED",
  "SELLER_ROUTE_CHANGED",
  "CUSTOMER_ENGAGED",
  "OPPORTUNITY_LINKED",
  "OUTCOME_RECORDED",
  "PURSUIT_CREATED",
]);

/** Whether a change should raise a What-Changed / alert item. */
export function isSurfaced(materiality: Materiality): boolean {
  return materiality === "HIGH" || materiality === "CRITICAL";
}
