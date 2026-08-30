import type { PoolClient } from "pg";
import { loadPredicates } from "./predicates";
import { recordChange } from "../pursuits/ledger";
import type { DataEnvironment } from "../pursuits/lineage";

/**
 * Fact → Pursuit linkage (Workstream B, §7/§18). When a Fact is asserted/updated on an
 * account, the live pursuits for that account gain a typed association (via the 0066
 * pursuit_facts M:N link) whose relevance_type expresses HOW the fact bears on the pursuit —
 * so Why Now and agent retrieval get graph structure, not a flat bag.
 */

export type FactRelevance = "PRIMARY_TRIGGER" | "SUPPORTING_CONTEXT" | "TIMING_ANCHOR" | "SOLUTION_FIT" | "PARTNER_ROUTE" | "RISK" | "CONTRADICTION";

/** Derive the single strongest relevance type of a fact to a pursuit. */
export async function deriveRelevance(db: PoolClient, predicateKey: string, polarity: number): Promise<FactRelevance> {
  const preds = await loadPredicates(db);
  const p = preds.get(predicateKey);
  if (polarity === -1) return "RISK";
  if (!p) return "SUPPORTING_CONTEXT";
  if (p.freshnessPolicy === "VALID_UNTIL" || p.freshnessPolicy === "EVENT") {
    if (p.supportsTiming) return "TIMING_ANCHOR";
  }
  if (p.supportsPartnerActivation) return "PARTNER_ROUTE";
  if (p.supportsSolutionFit) return "SOLUTION_FIT";
  if (p.supportsTiming) return "TIMING_ANCHOR";
  return "SUPPORTING_CONTEXT";
}

export interface LinkStats { pursuitsLinked: number }

/** Link a fact to every LIVE pursuit on its account. Idempotent. */
export async function linkFactToPursuits(db: PoolClient, factId: string): Promise<LinkStats> {
  const f = await db.query<{ org_id: string; company_id: string | null; predicate_key: string; polarity: number; confidence: string; data_environment: DataEnvironment }>(
    `select org_id, company_id, predicate_key, polarity, confidence, data_environment from facts where id = $1`, [factId],
  );
  const fact = f.rows[0];
  if (!fact || !fact.company_id) return { pursuitsLinked: 0 };
  const relevance = await deriveRelevance(db, fact.predicate_key, fact.polarity);

  const pursuits = await db.query<{ id: string }>(
    `select id from pursuits where org_id = $1 and account_id = $2
        and status not in ('WON','LOST','DISQUALIFIED') and merged_into_pursuit_id is null`,
    [fact.org_id, fact.company_id],
  );
  let linked = 0;
  for (const p of pursuits.rows) {
    const r = await db.query(
      `insert into pursuit_facts (pursuit_id, ref_id, relevance_type, relevance_score, reason, linked_by_type)
       values ($1,$2,$3,$4,$5,'system')
       on conflict (pursuit_id, ref_id) do update set relevance_type = excluded.relevance_type, relevance_score = excluded.relevance_score`,
      [p.id, factId, relevance, Number(fact.confidence), `Fact ${fact.predicate_key}`],
    );
    if (r.rowCount) linked++;
    await recordChange(db, {
      orgId: fact.org_id, pursuitId: p.id, entityType: "pursuit", entityId: p.id,
      changeType: "FACT_LINKED_TO_PURSUIT", materiality: "LOW", reason: `Linked fact (${relevance})`,
      actorType: "SYSTEM", triggerType: "FACT_PROMOTED", dataEnvironment: fact.data_environment,
      after: { factId, relevance },
    });
  }
  return { pursuitsLinked: linked };
}
