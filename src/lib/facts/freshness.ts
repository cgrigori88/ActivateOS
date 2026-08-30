import type { PoolClient } from "pg";
import { transitionFact } from "./lifecycle";
import type { FreshnessPolicy } from "./predicates";

/**
 * Fact freshness & temporal truth (Workstream B, §16/§17). Freshness is predicate-specific,
 * never one global half-life. It affects evidence_confidence / staleness — NOT whether the
 * proposition is true. Reuses the decay + event-proximity shapes from the scoring engine so
 * facts and signals age consistently.
 */

const DAY_MS = 86_400_000;

/** Exponential decay 0..1 by age vs half-life (same shape as scoring/compute.ts). */
export function decay(observedAt: Date, halfLifeDays: number | null, now = new Date()): number {
  if (!halfLifeDays || halfLifeDays <= 0) return 1;
  const ageDays = Math.max(0, (now.getTime() - observedAt.getTime()) / DAY_MS);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

/** Event proximity 0..1: ramps UP toward a dated event, falls fast after (renewal/expiry). */
export function eventProximity(eventDate: Date, now = new Date()): number {
  const days = (eventDate.getTime() - now.getTime()) / DAY_MS;
  if (days < 0) return Math.max(0, 1 + days / 30);       // just passed → decays over ~a month
  if (days <= 30) return 1;
  if (days >= 365) return 0.35;
  return 0.35 + 0.65 * (1 - (days - 30) / 335);
}

/**
 * Freshness factor for a fact given its policy. STATIC/PERMANENT_HISTORY never decay;
 * VALID_UNTIL/EVENT use proximity to the dated anchor; DECAYING uses half-life decay.
 */
export function factFreshness(args: {
  freshnessPolicy: FreshnessPolicy;
  observedLastAt: Date;
  halfLifeDays: number | null;
  validUntil?: Date | null;
  occurredAt?: Date | null;
  now?: Date;
}): number {
  const now = args.now ?? new Date();
  switch (args.freshnessPolicy) {
    case "STATIC":
    case "PERMANENT_HISTORY": return 1;
    case "VALID_UNTIL": return args.validUntil ? eventProximity(args.validUntil, now) : decay(args.observedLastAt, args.halfLifeDays, now);
    case "EVENT": return args.occurredAt ? Math.max(0.35, decay(args.occurredAt, args.halfLifeDays ?? 365, now)) : decay(args.observedLastAt, args.halfLifeDays, now);
    case "DECAYING":
    default: return decay(args.observedLastAt, args.halfLifeDays, now);
  }
}

export interface SweepStats { staled: number; expired: number; }

/**
 * Sweep CURRENT facts for staleness/expiry. VALID_UNTIL facts past their date EXPIRE;
 * DECAYING facts whose freshness drops below `staleThreshold` go STALE. Idempotent.
 * Assumes an open withTenant/withTenantOrg transaction (RLS-scoped by the caller).
 */
export async function sweepFreshness(db: PoolClient, orgId: string, staleThreshold = 0.15, now = new Date()): Promise<SweepStats> {
  const stats: SweepStats = { staled: 0, expired: 0 };
  const { rows } = await db.query<{
    id: string; freshness_policy: FreshnessPolicy; observed_last_at: Date; half_life_days: number | null;
    valid_until: Date | null; occurred_at: Date | null;
  }>(
    `select id, freshness_policy, observed_last_at, half_life_days, valid_until, occurred_at
       from facts where org_id = $1 and status = 'CURRENT'`, [orgId],
  );
  for (const f of rows) {
    if ((f.freshness_policy === "VALID_UNTIL" || f.freshness_policy === "EVENT") && f.valid_until && f.valid_until.getTime() < now.getTime()) {
      await transitionFact(db, f.id, "EXPIRED", { reason: "Past validity window", triggerType: "SCHEDULED_REFRESH" });
      stats.expired++;
      continue;
    }
    const fresh = factFreshness({ freshnessPolicy: f.freshness_policy, observedLastAt: f.observed_last_at, halfLifeDays: f.half_life_days, validUntil: f.valid_until, occurredAt: f.occurred_at, now });
    if (f.freshness_policy === "DECAYING" && fresh < staleThreshold) {
      await transitionFact(db, f.id, "STALE", { reason: `Freshness ${fresh.toFixed(3)} below ${staleThreshold}`, triggerType: "SCHEDULED_REFRESH" });
      stats.staled++;
    }
  }
  return stats;
}
