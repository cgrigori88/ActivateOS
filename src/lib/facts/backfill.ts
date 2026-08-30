import type { PoolClient } from "pg";
import { createCandidateFromSignal } from "./candidates";
import { promoteCandidate } from "./promotion";
import { predicateForSignalType } from "./predicates";
import { linkFactToPursuits } from "./pursuit-link";
import type { DataEnvironment } from "../pursuits/lineage";

/**
 * Facts backfill (Workstream B, §18/§37/§38/§39). Deterministically and IDEMPOTENTLY promotes
 * EXISTING verified signals into Fact candidates and runs them through the SAME promotion gate
 * — never over-promoting weak legacy evidence, never auto-turning a signal into a Fact without
 * the gate. The LLM extractor is intentionally NOT run in backfill (cost + prod safety); it is
 * a demo-tenant / opt-in path. Produces a rich anomaly report for dry-run inspection.
 */

export interface FactsBackfillReport {
  orgId: string;
  signalsSeen: number;
  candidatesCreated: number;
  promoted: number;
  reviewRequired: number;
  rejected: number;
  unmappedSignals: number;         // signal_type with no predicate (§39 — signal ≠ fact)
  dedupCollisions: number;         // candidates whose value matched an existing live fact
  competingValues: number;         // promotions that superseded a prior value in-slot
  contradictions: number;
  factsLinkedToPursuits: number;
  predicateDistribution: Record<string, number>;
  provenanceDistribution: Record<string, number>;
  confidenceBuckets: Record<string, number>;   // '0-.5','.5-.7','.7-.85','.85-1'
  normalizationFailures: number;
}

function bucket(c: number): string {
  if (c < 0.5) return "0-.5"; if (c < 0.7) return ".5-.7"; if (c < 0.85) return ".7-.85"; return ".85-1";
}

export async function backfillFactsOrg(db: PoolClient, orgId: string, env: DataEnvironment = "PRODUCTION"): Promise<FactsBackfillReport> {
  const r: FactsBackfillReport = {
    orgId, signalsSeen: 0, candidatesCreated: 0, promoted: 0, reviewRequired: 0, rejected: 0,
    unmappedSignals: 0, dedupCollisions: 0, competingValues: 0, contradictions: 0, factsLinkedToPursuits: 0,
    predicateDistribution: {}, provenanceDistribution: {}, confidenceBuckets: {}, normalizationFailures: 0,
  };

  // Only signals derived from verified evidence are eligible.
  const { rows: signals } = await db.query<{ id: string; signal_type: string }>(
    `select s.id, s.signal_type from signals s
       join evidence e on e.id = s.evidence_id
      where s.org_id = $1 and e.status = 'verified'
      order by s.observed_at asc`,
    [orgId],
  );

  for (const s of signals) {
    r.signalsSeen++;
    const pred = await predicateForSignalType(db, s.signal_type);
    if (!pred) { r.unmappedSignals++; continue; }

    // Idempotency: a signal already turned into a candidate is not re-processed.
    const seen = await db.query<{ n: string }>(`select count(*)::text n from fact_candidates where source_signal_id = $1`, [s.id]);
    if (Number(seen.rows[0].n) > 0) { r.dedupCollisions++; continue; }

    let candidateId: string;
    try {
      const cand = await createCandidateFromSignal(db, orgId, s.id, env);
      if (!cand) { r.normalizationFailures++; continue; }
      candidateId = cand.id;
      r.candidatesCreated++;
    } catch { r.normalizationFailures++; continue; }

    const res = await promoteCandidate(db, candidateId);
    r.predicateDistribution[pred.key] = (r.predicateDistribution[pred.key] ?? 0) + 1;
    if (res.outcome === "PROMOTED") {
      r.promoted++;
      if (res.confidence != null) r.confidenceBuckets[bucket(res.confidence)] = (r.confidenceBuckets[bucket(res.confidence)] ?? 0) + 1;
      if (res.factId) {
        const f = await db.query<{ provenance_class: string; supersedes: string | null }>(`select provenance_class, supersedes from facts where id = $1`, [res.factId]);
        const pc = f.rows[0]?.provenance_class ?? "?";
        r.provenanceDistribution[pc] = (r.provenanceDistribution[pc] ?? 0) + 1;
        if (f.rows[0]?.supersedes) r.competingValues++;
        const link = await linkFactToPursuits(db, res.factId);
        r.factsLinkedToPursuits += link.pursuitsLinked;
      }
    } else if (res.outcome === "REVIEW") r.reviewRequired++;
    else r.rejected++;
  }

  const contra = await db.query<{ n: string }>(`select count(*)::text n from fact_contradictions where org_id = $1`, [orgId]);
  r.contradictions = Number(contra.rows[0]?.n ?? 0);
  return r;
}
