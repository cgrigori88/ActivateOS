import type { PoolClient } from "pg";
import { recordChange } from "../pursuits/ledger";
import type { DataEnvironment } from "../pursuits/lineage";

/**
 * Fact support / contradiction associations (Workstream B, §13/§14). Support and
 * contradiction are stored INDEPENDENTLY and never netted away — a Fact can show its 3
 * supporting and 1 contradicting sources and name each. Idempotent (PK on the pair).
 */

export type Stance = "SUPPORTS" | "CONTRADICTS";
export type ContradictionType = "NEGATION" | "COMPETING_VALUE" | "TEMPORAL_CONFLICT" | "SCOPE_CONFLICT" | "SOURCE_DISAGREEMENT";

export async function attachEvidence(
  db: PoolClient, factId: string, evidenceId: string, stance: Stance, observedAt: Date, weight: number | null = null, linkedBy: string | null = null,
): Promise<void> {
  await db.query(
    `insert into fact_evidence (fact_id, evidence_id, stance, weight, observed_at, linked_by)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (fact_id, evidence_id) do update set stance = excluded.stance, weight = excluded.weight`,
    [factId, evidenceId, stance, weight, observedAt, linkedBy],
  );
}

export async function attachSignal(
  db: PoolClient, factId: string, signalId: string, stance: Stance, observedAt: Date, weight: number | null = null, linkedBy: string | null = null,
): Promise<void> {
  await db.query(
    `insert into fact_signals (fact_id, signal_id, stance, weight, observed_at, linked_by)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (fact_id, signal_id) do update set stance = excluded.stance, weight = excluded.weight`,
    [factId, signalId, stance, weight, observedAt, linkedBy],
  );
}

/** Record a fact-level contradiction (two facts asserting incompatible propositions). */
export async function linkContradiction(
  db: PoolClient, orgId: string, factIdA: string, factIdB: string, type: ContradictionType, basis: string,
  env: DataEnvironment = "PRODUCTION",
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into fact_contradictions (org_id, fact_id_a, fact_id_b, contradiction_type, basis)
     values ($1,$2,$3,$4,$5) returning id`,
    [orgId, factIdA, factIdB, type, basis],
  );
  await recordChange(db, {
    orgId, pursuitId: null, entityType: "fact", entityId: factIdA,
    changeType: "CONTRADICTION_DETECTED", materiality: "HIGH",
    reason: `Fact contradiction (${type}): ${basis}`,
    actorType: "SYSTEM", triggerType: "CONTRADICTION", dataEnvironment: env,
    after: { factIdA, factIdB, contradictionType: type },
  });
  return rows[0].id;
}

export interface SupportSummary {
  supportCount: number;
  contradictionCount: number;
  independentSourceTypes: number;
  independentFamilies: number;
  firstParty: boolean;
  strongestTrust: number;
  strongestSupport: number;
}

/**
 * Summarize a fact's current support/contradiction from evidence (+signals), used by the
 * deterministic confidence engine. Independence = distinct source_type / distinct family.
 */
export async function summarizeSupport(db: PoolClient, factId: string): Promise<SupportSummary> {
  const ev = await db.query<{ stance: Stance; source_type: string; first_party: boolean; computed_confidence: string | null; confidence: string }>(
    `select fe.stance, e.source_type, e.first_party, e.computed_confidence, e.confidence
       from fact_evidence fe join evidence e on e.id = fe.evidence_id where fe.fact_id = $1`,
    [factId],
  );
  const sig = await db.query<{ stance: Stance; signal_type: string; confidence: string }>(
    `select fs.stance, s.signal_type, s.confidence from fact_signals fs join signals s on s.id = fs.signal_id where fs.fact_id = $1`,
    [factId],
  );
  const supportSourceTypes = new Set<string>();
  let supportCount = 0, contradictionCount = 0, firstParty = false, strongestSupport = 0;
  for (const r of ev.rows) {
    if (r.stance === "SUPPORTS") {
      supportCount++; supportSourceTypes.add(r.source_type);
      if (r.first_party) firstParty = true;
      strongestSupport = Math.max(strongestSupport, Number(r.computed_confidence ?? r.confidence));
    } else contradictionCount++;
  }
  const supportFamilies = new Set<string>();
  for (const r of sig.rows) {
    if (r.stance === "SUPPORTS") { supportCount++; supportFamilies.add(r.signal_type); strongestSupport = Math.max(strongestSupport, Number(r.confidence)); }
    else contradictionCount++;
  }
  return {
    supportCount, contradictionCount,
    independentSourceTypes: supportSourceTypes.size,
    independentFamilies: Math.max(supportFamilies.size, supportSourceTypes.size > 0 ? 1 : 0),
    firstParty, strongestTrust: firstParty ? 0.95 : 0.7, strongestSupport: strongestSupport || 0.5,
  };
}
