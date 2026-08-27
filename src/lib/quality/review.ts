import type pg from "pg";
import { auditSampleRate, updateTrust } from "./trust";

/**
 * Resolve a review-queue item with a human verdict (Plane 2).
 * One call does all three closure steps (invariant #7):
 *   1. records the verdict;
 *   2. bounded-updates the source's trust and audit sample rate;
 *   3. banks the verdict as a golden-set candidate.
 */
export async function resolveReview(
  db: pg.PoolClient,
  orgId: string,
  reviewId: string,
  verdict: "accurate" | "inaccurate" | "unsure",
  notes?: string,
): Promise<void> {
  // FLOW-2 fix: the review_queue row must belong to the caller's org. Once
  // this org-scoped update returns the evidence_id, the downstream evidence
  // writes are bounded to that row and inherit the scoping.
  const { rows } = await db.query<{
    evidence_id: string;
    claim: string;
    raw_excerpt: string | null;
    source_type: string;
    status: string;
  }>(
    `update review_queue rq
     set status = $2, notes = $3, resolved_at = now()
     from evidence e
     where rq.id = $1 and e.id = rq.evidence_id and rq.org_id = $4
     returning e.id as evidence_id, e.claim, e.raw_excerpt, e.source_type, e.status`,
    [reviewId, verdict, notes ?? null, orgId],
  );
  if (rows.length === 0) throw new Error(`review ${reviewId} not found`);
  const item = rows[0];

  if (verdict === "unsure") return;
  const accurate = verdict === "accurate";

  // Human judgment is ground truth: an accurate verdict promotes quarantined
  // evidence to verified; an inaccurate one quarantines regardless of status.
  if (accurate) {
    await db.query(
      `update evidence set status = 'verified' where id = $1 and status = 'quarantined'`,
      [item.evidence_id],
    );
  } else {
    await db.query(`update evidence set status = 'quarantined' where id = $1`, [
      item.evidence_id,
    ]);
  }

  // Bounded trust update + recomputed sample rate for the source.
  const { rows: sources } = await db.query<{ id: string; trust_score: number }>(
    `select id, trust_score from signal_sources where name = $1`,
    [item.source_type],
  );
  if (sources.length > 0) {
    const newTrust = updateTrust(Number(sources[0].trust_score), accurate);
    await db.query(
      `update signal_sources
       set trust_score = $2,
           audit_sample_rate = $3,
           audited_count = audited_count + 1,
           accurate_count = accurate_count + $4
       where id = $1`,
      [sources[0].id, newTrust, auditSampleRate(newTrust), accurate ? 1 : 0],
    );
  }

  // Human judgment compounds into the eval harness.
  await db.query(
    `insert into golden_examples (workflow, input, expected, origin)
     values ('extractor', $1, $2, 'review_verdict')`,
    [
      JSON.stringify({ claim: item.claim, excerpt: item.raw_excerpt, source: item.source_type }),
      JSON.stringify({ supported: accurate }),
    ],
  );
}
