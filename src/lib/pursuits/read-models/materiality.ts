import type { DecisionClass } from "./types";

/**
 * Canonical materiality + decision-class policy (Workstream D, §3/§4/§53/§54). One server-side
 * authority for "is this material?" and "what class of attention is this?" — the UI never decides
 * `delta > 5 = material` on its own, and the same policy later feeds Slack/email/digest surfaces.
 * Operational urgency is kept SEPARATE from commercial priority (§4): a mid-value Pursuit with a
 * consent/security block is operationally critical; a huge Pursuit with nothing to do is not.
 */

export type OperationalUrgency = "critical" | "high" | "normal" | "low";

/** Map a change-ledger change_type to a Today decision class. */
export function classifyChange(changeType: string): DecisionClass | null {
  switch (changeType) {
    case "ROUTE_RECOMMENDATION_CHANGED":
    case "PARTNER_DECLINED":
    case "TEAM_MEMBER_DECLINED":
      return "DECISION_REQUIRED";
    case "FACT_DISPUTED":
    case "CONTRADICTION_DETECTED":
      return "RISK";
    case "SCORE_CHANGED":
    case "FACT_PROMOTED":
    case "CONVERGENCE_CHANGED":
    case "WHY_NOW_CHANGED":
    case "TIMING_CHANGED":
      return "MATERIAL_CHANGE";
    case "OPPORTUNITY_LINKED":
    case "CUSTOMER_ENGAGED":
      return "OPPORTUNITY";
    default:
      return null;
  }
}

/** Whether a ledger event is material enough to reach Today / What Changed (server-authoritative). */
export function isMaterial(materiality: string | null): boolean {
  return materiality === "HIGH" || materiality === "CRITICAL" || materiality === "MEDIUM";
}

/** Only the highest-materiality events belong in the primary What-Changed timeline (§23). */
export function isTimelineWorthy(materiality: string | null): boolean {
  return materiality === "HIGH" || materiality === "CRITICAL";
}

const CLASS_RANK: Record<DecisionClass, number> = {
  DECISION_REQUIRED: 0, RISK: 1, ACTION_REQUIRED: 2, MATERIAL_CHANGE: 3, OPPORTUNITY: 4, FYI: 5,
};
const URGENCY_RANK: Record<OperationalUrgency, number> = { critical: 0, high: 1, normal: 2, low: 3 };
const BAND_RANK: Record<string, number> = { very_high: 0, high: 1, moderate: 2, low: 3, unknown: 4 };

/**
 * Today ordering (§3): material business state first — decision class, then operational urgency,
 * then commercial priority, then how long a decision has been unresolved. A low-value recent event
 * never outranks a major route change on a large Pursuit merely for being newer.
 */
export function todaySort(a: { decisionClass: DecisionClass; operationalUrgency: OperationalUrgency; commercialPriority: string; ageSeconds: number },
                          b: { decisionClass: DecisionClass; operationalUrgency: OperationalUrgency; commercialPriority: string; ageSeconds: number }): number {
  return (CLASS_RANK[a.decisionClass] - CLASS_RANK[b.decisionClass])
      || (URGENCY_RANK[a.operationalUrgency] - URGENCY_RANK[b.operationalUrgency])
      || ((BAND_RANK[a.commercialPriority] ?? 9) - (BAND_RANK[b.commercialPriority] ?? 9))
      || (b.ageSeconds - a.ageSeconds);   // older unresolved decisions first
}
