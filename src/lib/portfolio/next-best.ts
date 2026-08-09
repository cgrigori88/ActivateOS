/**
 * Next-Best Action v1 (BLUEPRINT Phase 3) — pure, deterministic ranking of
 * "what should the operator do right now". Actions that unblock revenue
 * rank by the expected value they unblock; hygiene actions (review queue,
 * contradictions, refreshes) carry calibrated fixed weights so they surface
 * without drowning out revenue work.
 */

export type ActionType =
  | "APPROVE_MOTION"
  | "ACTIVATE_MOTION"
  | "COMPOSE_CAMPAIGN"
  | "REVIEW_EVIDENCE"
  | "RESOLVE_CONTRADICTION"
  | "REFRESH_DUE";

export interface NextAction {
  type: ActionType;
  priority: number; // comparable across types; higher = do sooner
  title: string;
  reason: string;
  href: string;
}

export interface PortfolioState {
  /** draft motions awaiting approval */
  draftMotions: {
    motionId: string;
    company: string;
    expectedValueUsd: number | null;
  }[];
  /** approved motions not yet activated */
  approvedMotions: {
    motionId: string;
    company: string;
    expectedValueUsd: number | null;
    hasCampaign: boolean;
  }[];
  pendingReviewCount: number;
  openContradictions: { company: string; companyId: string }[];
  refreshDue: { company: string; companyId: string; tier: string }[];
}

// A motion with unknown economics still beats pure hygiene work.
const DEFAULT_MOTION_VALUE = 50_000;
const REVIEW_WEIGHT_PER_ITEM = 2_000;
const REVIEW_WEIGHT_CAP = 30_000;
const CONTRADICTION_WEIGHT = 40_000;
const REFRESH_WEIGHT: Record<string, number> = {
  very_high: 25_000,
  high: 15_000,
  medium: 5_000,
  low: 1_000,
};

export function rankNextActions(state: PortfolioState, limit = 10): NextAction[] {
  const actions: NextAction[] = [];

  for (const m of state.draftMotions) {
    const value = m.expectedValueUsd ?? DEFAULT_MOTION_VALUE;
    actions.push({
      type: "APPROVE_MOTION",
      priority: value,
      title: `Review motion draft — ${m.company}`,
      reason: `unblocks ~$${Math.round(value / 1000)}k expected value awaiting your approval`,
      href: "/motions",
    });
  }

  for (const m of state.approvedMotions) {
    const value = (m.expectedValueUsd ?? DEFAULT_MOTION_VALUE) * 0.9;
    if (!m.hasCampaign) {
      actions.push({
        type: "COMPOSE_CAMPAIGN",
        priority: value,
        title: `Compose campaign — ${m.company}`,
        reason: "approved motion has no campaign assets yet",
        href: "/motions",
      });
    } else {
      actions.push({
        type: "ACTIVATE_MOTION",
        priority: value,
        title: `Activate motion — ${m.company}`,
        reason: "campaign assets are ready; the motion is not yet live",
        href: "/motions",
      });
    }
  }

  if (state.pendingReviewCount > 0) {
    actions.push({
      type: "REVIEW_EVIDENCE",
      priority: Math.min(REVIEW_WEIGHT_CAP, state.pendingReviewCount * REVIEW_WEIGHT_PER_ITEM),
      title: `Review ${state.pendingReviewCount} evidence item(s)`,
      reason: "human audits keep source trust calibrated",
      href: "/review",
    });
  }

  for (const c of state.openContradictions) {
    actions.push({
      type: "RESOLVE_CONTRADICTION",
      priority: CONTRADICTION_WEIGHT,
      title: `Resolve contradiction — ${c.company}`,
      reason: "conflicting signals on the same node; the score may be misleading either way",
      href: `/accounts/${c.companyId}`,
    });
  }

  for (const r of state.refreshDue) {
    actions.push({
      type: "REFRESH_DUE",
      priority: REFRESH_WEIGHT[r.tier] ?? 1_000,
      title: `Refresh research — ${r.company}`,
      reason: `${r.tier.replace(/_/g, " ")} account past its refresh date`,
      href: `/accounts/${r.companyId}`,
    });
  }

  return actions.sort((a, b) => b.priority - a.priority).slice(0, limit);
}
