import type { MomentumVerdict } from "./momentum";

/**
 * Canonical opportunity CONDITION (scale-disclosure §3). One definition of "what is actually
 * happening" on a deal, shared by Pipeline Attention (the intervention cards) and Pipeline
 * Portfolio (the pivot matrix) so the two rooms never disagree. Built ONLY from existing canonical
 * signals — declared stage, silent-days from `updated_at`, and the deal-momentum verdict. No new
 * score, no new primitive.
 */

export type ConditionState = "at_risk" | "stalling" | "healthy" | "closed";

export interface Condition {
  state: ConditionState;
  /** Present-tense description of the condition (empty for healthy/closed). */
  label: string;
  /** The next intervention (empty for healthy/closed). */
  next: string;
  silentDays: number | null;
  /** True when the deal is intervention-worthy (Attention view surfaces these). */
  needsAttention: boolean;
}

const DAY = 86_400_000;

export function opportunityCondition(
  o: { stage: string; updatedAt: string | Date | null },
  mo?: { verdict: MomentumVerdict; reasons: string[] } | null,
): Condition {
  const closed = o.stage.startsWith("closed");
  const silentDays = o.updatedAt ? Math.floor((Date.now() - new Date(o.updatedAt).getTime()) / DAY) : null;
  if (closed) return { state: "closed", label: "", next: "", silentDays, needsAttention: false };

  const lateStage = o.stage === "proposal" || o.stage === "negotiation";
  if (lateStage && silentDays != null && silentDays >= 30)
    return { state: "at_risk", label: `Late-stage on paper, silent ${silentDays} days — the record and the deal have parted ways`, next: "Re-engage the economic buyer", silentDays, needsAttention: true };
  if (silentDays != null && silentDays >= 21)
    return { state: "stalling", label: `Untouched ${silentDays} days — renewal window closing, deal dormant`, next: "Follow up before the window lapses", silentDays, needsAttention: true };
  if (mo?.verdict === "at_risk")
    return { state: "at_risk", label: mo.reasons.join(" · ") || "Momentum at risk", next: "Intervene now", silentDays, needsAttention: true };
  if (mo?.verdict === "stalling")
    return { state: "stalling", label: mo.reasons.join(" · ") || "Stalling — plan says moving, outbox stopped", next: "Advance the next step", silentDays, needsAttention: true };

  return { state: "healthy", label: "", next: "", silentDays, needsAttention: false };
}

/** Human label for a condition column/legend. */
export const CONDITION_LABEL: Record<ConditionState, string> = {
  at_risk: "At risk", stalling: "Stalling", healthy: "Healthy", closed: "Closed",
};
export const CONDITION_ORDER: ConditionState[] = ["at_risk", "stalling", "healthy"];
