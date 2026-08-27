import type { Pool, PoolClient } from "pg";

/**
 * Context confidence (slice B of the meets/beats/leaps batch): how much of
 * what we hold on an account is TRUE, current, and broadly sourced. The
 * anti-"fused context" argument made visible — fusing data into one place
 * says nothing about whether it can be trusted; this meter does.
 *
 * The formula is deliberately simple and shown to the user verbatim
 * (no-unexplained-scores rule):
 *   50 pts · share of claims verified (vs quarantined/rejected)
 *   30 pts · freshness — full marks inside 7 days, fading to 0 at 90
 *   20 pts · source breadth — full marks at 4+ distinct source types
 *   −10 pts per open contradiction (floor 0)
 */

type Db = Pool | PoolClient;

export interface ContextConfidence {
  score: number; // 0..100
  verifiedN: number;
  quarantinedN: number;
  verifiedPct: number; // 0..100
  freshDays: number | null; // days since newest verified claim
  sourceTypes: number;
  contradictions: number;
}

export async function contextConfidence(db: Db, orgId: string, companyId: string): Promise<ContextConfidence> {
  const { rows } = await db.query<{
    verified_n: string; quarantined_n: string; source_types: string; newest: Date | null; contradictions: string;
  }>(
    `select
       count(*) filter (where e.status = 'verified') as verified_n,
       count(*) filter (where e.status <> 'verified') as quarantined_n,
       count(distinct e.source_type) filter (where e.status = 'verified') as source_types,
       max(e.observed_at) filter (where e.status = 'verified') as newest,
       (select count(*) from contradictions x
        where x.company_id = $2 and x.status = 'open'
          and (x.org_id = $1 or x.org_id is null)) as contradictions
     from evidence e
     where e.company_id = $2 and (e.org_id = $1 or e.org_id is null)`,
    [orgId, companyId],
  );
  const r = rows[0];
  const verifiedN = Number(r.verified_n);
  const quarantinedN = Number(r.quarantined_n);
  const total = verifiedN + quarantinedN;
  const verifiedPct = total > 0 ? Math.round((verifiedN / total) * 100) : 0;
  const freshDays = r.newest ? Math.max(0, Math.floor((Date.now() - new Date(r.newest).getTime()) / 86_400_000)) : null;
  const sourceTypes = Number(r.source_types);
  const contradictions = Number(r.contradictions);

  const verifiedPts = total > 0 ? 50 * (verifiedN / total) : 0;
  const freshPts = freshDays == null ? 0 : 30 * Math.max(0, 1 - Math.max(0, freshDays - 7) / 83);
  const breadthPts = 20 * Math.min(1, sourceTypes / 4);
  const score = Math.max(0, Math.round(verifiedPts + freshPts + breadthPts - 10 * contradictions));

  return { score, verifiedN, quarantinedN, verifiedPct, freshDays, sourceTypes, contradictions };
}

export function confidenceTone(score: number): "emerald" | "amber" | "rose" {
  return score >= 70 ? "emerald" : score >= 40 ? "amber" : "rose";
}

export const CONFIDENCE_FORMULA =
  "50 pts × share of claims verified · 30 pts × freshness (full inside 7d, zero at 90d) · 20 pts × source breadth (full at 4+ types) · −10 per open contradiction";
