import type { PoolClient } from "pg";

/**
 * As-of Fact reconstruction (Workstream B, §17/§25; Workstream A leakage guard). Returns the
 * facts the system BELIEVED about a company at time `t`: knowable by then (as_of ≤ t,
 * observed_at ≤ t), not yet superseded at t (no superseder with as_of ≤ t), still valid at t,
 * and not rejected. This is the query behind "what did we believe then" and the absolute
 * rule that a fact unknowable at a score's historical as-of time can never influence it.
 */

export interface AsOfFact {
  id: string; predicate_key: string; object_type: string; object_value: Record<string, unknown>;
  confidence: number; as_of: Date; family: string | null; polarity: number;
}

export async function factsAsOf(db: PoolClient, companyId: string, t: Date): Promise<AsOfFact[]> {
  const { rows } = await db.query(
    `select f.id, f.predicate_key, f.object_type, f.object_value, f.confidence, f.as_of, f.family, f.polarity
       from facts f
      where f.company_id = $1
        and f.status <> 'REJECTED'
        and f.as_of <= $2
        and f.observed_at <= $2
        and (f.valid_until is null or f.valid_until >= $2)
        and not exists (
          select 1 from facts s
           where s.id = f.superseded_by and s.as_of <= $2
        )`,
    [companyId, t],
  );
  return rows.map((r) => ({
    id: r.id, predicate_key: r.predicate_key, object_type: r.object_type, object_value: r.object_value,
    confidence: Number(r.confidence), as_of: r.as_of, family: r.family, polarity: r.polarity,
  }));
}
