import type { PoolClient } from "pg";

/**
 * Deterministic Motion → canonical Pursuit linkage (P0.2). ONE rule, used by both the
 * creation path (motion-designer) and the backfill, so the linkage is a total function of
 * state and never a guess:
 *
 *   1. exactly ONE pursuit on (org, account, product category)            → link it;
 *   2. else exactly ONE LIVE pursuit (not WON/LOST/DISQUALIFIED, unmerged) → link it;
 *   3. else (zero, or still ambiguous)                                    → NULL.
 *
 * NULL is the honest answer for ambiguity — downstream read models treat an unlinked motion
 * as "no canonical pursuit linkage", never as an invitation to infer one.
 */
export async function resolveDeterministicPursuit(
  db: PoolClient, orgId: string, companyId: string, taxonomyNodeId: string | null,
): Promise<{ pursuitId: string | null; reason: "unique" | "unique_live" | "none" | "ambiguous" }> {
  if (!taxonomyNodeId) return { pursuitId: null, reason: "none" };
  const { rows } = await db.query<{ id: string; live: boolean }>(
    `select id, (status not in ('WON','LOST','DISQUALIFIED') and merged_into_pursuit_id is null) as live
       from pursuits where org_id = $1 and account_id = $2 and product_category_id = $3`,
    [orgId, companyId, taxonomyNodeId],
  );
  if (rows.length === 0) return { pursuitId: null, reason: "none" };
  if (rows.length === 1) return { pursuitId: rows[0].id, reason: "unique" };
  const live = rows.filter((r) => r.live);
  if (live.length === 1) return { pursuitId: live[0].id, reason: "unique_live" };
  return { pursuitId: null, reason: "ambiguous" };
}
