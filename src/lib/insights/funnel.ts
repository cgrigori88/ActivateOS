/**
 * Outcome Learning v1 (BLUEPRINT Phase 7) — pure, deterministic analytics
 * over the immutable outcome-event log. No model calls; the event stream is
 * the single source of truth, and every number here is reproducible from it.
 */

/** The commercial funnel, in order. Each step maps to observable events. */
export const FUNNEL_STEPS = [
  { key: "motion_created", label: "Motions drafted", events: ["MOTION_CREATED"] },
  { key: "motion_approved", label: "Approved", events: ["MOTION_APPROVED"] },
  { key: "motion_activated", label: "Activated", events: ["MOTION_ACTIVATED"] },
  { key: "replied", label: "Customer replied", events: ["CUSTOMER_REPLIED", "REPLIED"] },
  { key: "opportunity", label: "Opportunity", events: ["OPPORTUNITY_CREATED"] },
  { key: "won", label: "Won", events: ["CLOSED_WON"] },
] as const;

export interface FunnelStep {
  key: string;
  label: string;
  count: number;
  /** conversion from the previous step; null on the first step or 0-base */
  conversion: number | null;
}

/**
 * Count DISTINCT motions reaching each step (an event repeated on one motion
 * counts once — funnels measure progression, not activity volume).
 */
export function computeFunnel(
  events: { event_type: string; motion_id: string | null }[],
): FunnelStep[] {
  const out: FunnelStep[] = [];
  let prev: number | null = null;
  for (const step of FUNNEL_STEPS) {
    const motions = new Set(
      events
        .filter((e) => (step.events as readonly string[]).includes(e.event_type))
        .map((e) => e.motion_id ?? "no-motion"),
    );
    const count = motions.size;
    out.push({
      key: step.key,
      label: step.label,
      count,
      conversion: prev == null || prev === 0 ? null : Math.round((count / prev) * 100) / 100,
    });
    prev = count;
  }
  return out;
}
