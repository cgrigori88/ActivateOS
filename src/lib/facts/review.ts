import type { PoolClient } from "pg";
import { promoteCandidate } from "./promotion";

/**
 * Human review of Fact candidates (Workstream B, §34/§35). The queue item shows the candidate
 * proposition, its source excerpt, predicate mapping, proposed confidence, and why review was
 * required. The reviewer's decision — and any edits — are captured as lineage (supervision
 * data for improving extraction/promotion later). ACCEPT promotes via the SAME gate under
 * force (hard guards still hold); the human is the authority, recorded as HUMAN_ASSERTED.
 */

export type ReviewDecision = "ACCEPT" | "REJECT" | "EDIT" | "DEFER";

export interface ReviewItem {
  reviewId: string; candidateId: string | null; predicateKey: string | null; subjectLabel: string;
  objectValue: Record<string, unknown>; quotedExcerpt: string | null; proposedConfidence: number | null;
  reason: string; sourceEvidenceId: string | null;
}

/** List open Fact reviews for an org, with the context a human needs to decide. */
export async function listOpenReviews(db: PoolClient, orgId: string): Promise<ReviewItem[]> {
  const { rows } = await db.query(
    `select r.id review_id, r.candidate_id, r.proposed_confidence, r.reason,
            c.predicate_key, c.subject_label, c.object_value, c.quoted_excerpt, c.source_evidence_id
       from fact_reviews r left join fact_candidates c on c.id = r.candidate_id
      where r.org_id = $1 and r.human_decision is null and r.system_recommendation = 'REVIEW'
      order by r.created_at asc`,
    [orgId],
  );
  return rows.map((r) => ({
    reviewId: r.review_id, candidateId: r.candidate_id, predicateKey: r.predicate_key,
    subjectLabel: r.subject_label ?? "", objectValue: r.object_value ?? {}, quotedExcerpt: r.quoted_excerpt,
    proposedConfidence: r.proposed_confidence != null ? Number(r.proposed_confidence) : null,
    reason: r.reason, sourceEvidenceId: r.source_evidence_id,
  }));
}

export interface ReviewOutcome { decision: ReviewDecision; factId?: string; }

/** Apply a human review decision; records lineage and produces the durable outcome. */
export async function applyReviewDecision(
  db: PoolClient, reviewId: string,
  input: { decision: ReviewDecision; edits?: Record<string, unknown> | null; reason?: string | null; reviewerId?: string | null },
): Promise<ReviewOutcome> {
  const { rows } = await db.query<{ candidate_id: string | null; org_id: string }>(
    `select candidate_id, org_id from fact_reviews where id = $1 for update`, [reviewId],
  );
  const rev = rows[0];
  if (!rev) throw new Error(`fact_review ${reviewId} not found`);

  // Lineage: capture the human decision + edits regardless of outcome (§35).
  await db.query(
    `update fact_reviews set human_decision = $2, human_edits = $3, decision_reason = $4,
            reviewer_id = $5, decided_at = now() where id = $1`,
    [reviewId, input.decision, input.edits ? JSON.stringify(input.edits) : null, input.reason ?? null, input.reviewerId ?? null],
  );

  if (!rev.candidate_id) return { decision: input.decision };

  if (input.decision === "EDIT" && input.edits) {
    // Apply structured edits to the candidate before promoting (predicate/object overrides).
    const e = input.edits as { predicate_key?: string; predicate_resolved?: boolean };
    if (e.predicate_key) {
      await db.query(`update fact_candidates set predicate_key = $2, predicate_resolved = true, updated_at = now() where id = $1`, [rev.candidate_id, e.predicate_key]);
    }
  }

  if (input.decision === "ACCEPT" || input.decision === "EDIT") {
    const res = await promoteCandidate(db, rev.candidate_id, { force: true });
    // Resolve the linked evidence review-queue rows.
    await db.query(
      `update review_queue set status = 'accurate', resolved_at = now()
        where evidence_id = (select source_evidence_id from fact_candidates where id = $1) and status = 'pending'`,
      [rev.candidate_id],
    );
    return { decision: input.decision, factId: res.factId };
  }
  if (input.decision === "REJECT") {
    await db.query(`update fact_candidates set status = 'REJECTED', rejection_reason = 'human_rejected', updated_at = now() where id = $1`, [rev.candidate_id]);
    await db.query(
      `update review_queue set status = 'inaccurate', resolved_at = now()
        where evidence_id = (select source_evidence_id from fact_candidates where id = $1) and status = 'pending'`,
      [rev.candidate_id],
    );
  }
  return { decision: input.decision };
}
