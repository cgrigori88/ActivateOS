import type { PoolClient } from "pg";
import type { PartnerActivation } from "./partner-activation";

/**
 * Activation readiness (Workstream C, §8/§24/§30). DISTINCT from suitability: can this route
 * execute NOW? A structurally ideal partner (suitability 95) can be unready (readiness 42)
 * when no seller is named or required team roles are unaccepted. Feeds route status and the
 * "why not yet activation-ready" explanation.
 */

export interface Readiness { readinessScore: number; missingRequiredRoles: string[]; hasNamedSeller: boolean; capacityOk: boolean; }

export async function activationReadiness(
  db: PoolClient, orgId: string, pursuitId: string, accountId: string, partnerId: string | null,
  pursuitType: string | null, pa: PartnerActivation,
): Promise<Readiness> {
  const hasNamedSeller = partnerId
    ? Number((await db.query<{ n: string }>(
        `select count(*)::text n from seller_account_relationships sar join sellers s on s.id = sar.seller_id
          where s.partner_id = $1 and sar.company_id = $2 and sar.strength > 0`, [partnerId, accountId])).rows[0].n) > 0
    : true;

  // Capacity: partner not over its concurrent-pursuit ceiling.
  let capacityOk = true;
  if (partnerId) {
    const cap = await db.query<{ capacity: number | null }>(`select capacity from partners where id = $1`, [partnerId]);
    if (cap.rows[0]?.capacity != null) {
      const active = await db.query<{ n: string }>(
        `select count(*)::text n from pursuits where selected_partner_id = $1 and status not in ('WON','LOST','DISQUALIFIED')`, [partnerId]);
      capacityOk = Number(active.rows[0].n) < cap.rows[0].capacity;
    }
  }

  // Required roles present + accepted (or at least present as recommended).
  const req = await db.query<{ role: string }>(
    `select role from pursuit_team_requirements where required = true and (org_id is null or org_id = $1) and (pursuit_type is null or pursuit_type = $2)`,
    [orgId, pursuitType],
  );
  const present = await db.query<{ role: string }>(`select distinct role from pursuit_team_members where pursuit_id = $1 and status <> 'SUPERSEDED'`, [pursuitId]);
  const presentSet = new Set(present.rows.map((r) => r.role));
  const missing = req.rows.map((r) => r.role).filter((r) => !presentSet.has(r));

  // Composite: named seller + capacity + roles + not hard-disqualified.
  let score = 100;
  if (!hasNamedSeller) score -= 35;
  if (!capacityOk) score -= 25;
  score -= missing.length * 15;
  if (pa.hardDisqualified) score = Math.min(score, 10);
  return { readinessScore: Math.max(0, Math.min(100, score)), missingRequiredRoles: missing, hasNamedSeller, capacityOk };
}
