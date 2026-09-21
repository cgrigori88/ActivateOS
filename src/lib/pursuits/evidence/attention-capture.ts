import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { PortfolioPertinenceView } from "../read-models/portfolio-pertinence";
import type { DataEnvironment } from "../lineage";

/**
 * PILOT EVIDENCE — decision-time attention capture (Slice 1).
 *
 * THE FACT THIS EXISTS TO SAVE. P2 rank is computed at read time and never persisted, and a rank
 * depends on the whole comparison set, which moves. So "what did PursuitOS consider important, and
 * why, at the moment this decision was taken" is UNRECOVERABLE from present-day state. It is one of
 * the few pilot facts that cannot be reconstructed later at any price, which is the whole test for
 * belonging in this slice.
 *
 * ── THE WRITE BOUNDARY IS A DELIBERATE SELECTION, NOT A RENDER ──────────────────────────────────
 *
 * This is called from ONE place: redeeming an attention token at the explicit primary CTA on a
 * ranked surface. Capturing while rendering Today would reintroduce exactly the defect D-HIST-1
 * found and `6f3e65d` closed — `pipeline_snapshots` written from a page render, whose own comment
 * read "history accrues just by looking". That pattern is why `97e975f0` could not be safely
 * reconstructed during the P45-4 incident.
 *
 * It is equally NOT attached to `recommend_pursuit_plan@1`: that capability never consumed P2, so a
 * ranking attached to it would be false lineage.
 *
 * ── TWO POSITIONS, AND THEY ARE DIFFERENT NUMBERS ───────────────────────────────────────────────
 *
 * `p2_rank` is the canonical portfolio rank the card displayed — "#3 of 18". `surface_ordinal` is
 * where the card actually sat on the page. On Today these differ by construction (the materiality
 * policy orders the list and pertinence is only its third key, then a top-K cut applies); on
 * /pipeline they differ whenever the sort mode is recency. Collapsing them would make the
 * observation claim something we cannot support, so they are stored separately and the surface
 * context needed to interpret each is stored with them.
 *
 * ── WHAT THIS DOES AND DOES NOT MEAN ────────────────────────────────────────────────────────────
 *
 * It means: the user deliberately selected this pursuit for work from this rendered surface, where
 * these were the displayed ranking facts. It does NOT mean the user agreed the rank was correct,
 * that P2 caused the decision, or that anything good or bad followed.
 *
 * ── WHAT IS STORED, AND WHAT IS REFUSED ─────────────────────────────────────────────────────────
 *
 * Bounded references and numbers: rank, score, band, the signal contributions P2 actually summed,
 * and the comparison-set size — because portfolio-pertinence.ts is explicit that a rank is
 * meaningless without it. NO prose, NO evidence text, NO withheld content, NO payload copy.
 * `withheldCount` is carried as a COUNT only, exactly as D-018 requires.
 *
 * ── P2 SEMANTICS ARE UNTOUCHED ──────────────────────────────────────────────────────────────────
 *
 * This records THAT a ranking happened and what it was. It does not change the computation, and the
 * stored rank/score/band keep their only meaning: RELATIVE ATTENTION PRIORITY — never win
 * probability, forecast, account quality or causal uplift. Nothing here labels an outcome, and
 * absence of a later outcome never becomes a negative fact.
 */

export interface AttentionSelection {
  /** The server-minted facts, already verified. Never assembled from a request body. */
  facts: import("./attention-token").AttentionFacts;
  /** The authenticated selector, resolved independently of the token and re-checked against it. */
  userId: string | null;
}

/** The ranking input state, for provenance. Order matters: a reordering IS a different state. */
export function attentionFingerprint(view: PortfolioPertinenceView, algorithmVersion: string): string {
  const body = [
    `v=${algorithmVersion}`,
    `scope=${view.scope}`,
    `n=${view.comparisonSetSize}`,
    `withheld=${view.withheldCount}`,
    ...view.items.map((i) => `${i.rank}:${i.pursuitId}:${i.score.toFixed(3)}:${i.band}`),
  ].join("|");
  return createHash("sha256").update(body).digest("hex").slice(0, 32);
}

/**
 * Persist ONE deliberate selection. Returns whether a row was written — false means this exact
 * token was already redeemed, which is idempotence rather than an error.
 */
export async function recordAttentionSelection(
  db: PoolClient, sel: AttentionSelection,
): Promise<{ written: boolean; snapshotId: string }> {
  const f = sel.facts;
  const h = createHash("sha256").update(`${f.orgId}:${f.snapshotFingerprint}:${f.nonce}`).digest("hex");
  const snapshotId = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
  const r = await db.query(
    `insert into attention_observations
       (org_id, snapshot_id, snapshot_fingerprint, algorithm_version, scope, comparison_set_size,
        withheld_count, pursuit_id, p2_rank, surface_ordinal, surface_id, surface_version, sort_mode,
        filters, display_limit, score, band, components, data_environment,
        selected_by_user_id, rendered_at, selected_at, token_nonce)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21, now(), $22)
     -- The predicate is restated because the index is PARTIAL: PostgreSQL only infers a partial
     -- unique index when the ON CONFLICT clause repeats its WHERE, and without it the insert fails
     -- with "no unique or exclusion constraint matching the ON CONFLICT specification".
     on conflict (org_id, token_nonce) where token_nonce is not null do nothing`,
    [f.orgId, snapshotId, f.snapshotFingerprint, f.algorithmVersion, f.scope, f.comparisonSetSize,
     f.withheldCount, f.pursuitId, f.p2Rank, f.surfaceOrdinal, f.surfaceId, f.surfaceVersion, f.sortMode,
     JSON.stringify(f.filters ?? {}), f.displayLimit, f.score, f.band,
     // Numbers and declared signal keys only — never reasons, never evidence text, never a payload copy.
     JSON.stringify(f.components ?? []), f.dataEnvironment,
     sel.userId, f.renderedAt, f.nonce]);
  return { written: (r.rowCount ?? 0) > 0, snapshotId };
}
