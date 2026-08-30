import type { Band, ScoreView, ScoreReason } from "./types";

/**
 * Read-model helpers (Workstream D). Canonical score→band mapping and page-invariant score
 * definitions (§9/§10) so every surface explains the same score the same way, band-first with
 * the exact value secondary. `unknown` is a first-class band, distinct from a low value (§17/§41).
 */

/** The caller's disclosure capability — decides what a read model may return (§39/§40). */
export interface Caller {
  orgId: string;
  canSeeInternal: boolean;             // internal (full) route explanation
  canSeeTransactionDetail: boolean;    // raw transaction values
}

export function bandOf(value: number | null): Band {
  if (value == null || !Number.isFinite(value)) return "unknown";
  if (value >= 80) return "very_high";
  if (value >= 60) return "high";
  if (value >= 40) return "moderate";
  return "low";
}

/** Canonical, page-invariant score definitions (§9). */
export const SCORE_DEFINITIONS: Record<string, { label: string; definition: string }> = {
  priority: { label: "Pursuit Priority", definition: "Directional ranking of how much this Pursuit deserves attention now, from commercial value, propensity, timing, confidence and readiness." },
  purchase_propensity: { label: "Purchase Propensity", definition: "Directional measure of how strongly current evidence supports likely demand for this solution/category. Not a win probability." },
  evidence_confidence: { label: "Evidence Confidence", definition: "How strongly the underlying commercial context is verified and corroborated." },
  timing: { label: "Timing", definition: "How near and defined the commercial window is." },
  route: { label: "Route Score", definition: "How strong the proposed commercial path is for this Pursuit." },
  route_confidence: { label: "Route Confidence", definition: "How complete and trustworthy the data behind the route recommendation is — distinct from the route score." },
  activation_readiness: { label: "Activation Readiness", definition: "How ready the selected route and team are to execute right now." },
  partner_activation: { label: "Partner Activation", definition: "How strong this partner is for this Pursuit." },
  suitability: { label: "Suitability", definition: "Structural quality of the route, independent of whether it can execute yet." },
  seller_fit: { label: "Seller Fit", definition: "How well-positioned this seller is for this account, product and Pursuit." },
};

export function scoreView(key: string, value: number | null, why: ScoreReason[] = []): ScoreView {
  const def = SCORE_DEFINITIONS[key] ?? { label: key, definition: "" };
  return { key, label: def.label, band: bandOf(value), value: value == null ? null : Math.round(value), known: value != null, definition: def.definition, why };
}

export function freshness(label: string, at: Date | null): { label: string; at: string | null } {
  if (!at) return { label: `${label} —`, at: null };
  const mins = Math.max(0, Math.round((Date.now() - at.getTime()) / 60000));
  const rel = mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.round(mins / 60)}h ago` : `${Math.round(mins / 1440)}d ago`;
  return { label: `${label} ${rel}`, at: at.toISOString() };
}
