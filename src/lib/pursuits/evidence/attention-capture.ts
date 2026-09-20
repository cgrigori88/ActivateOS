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
 * ── AN EXPLICIT PRODUCER, NEVER A READ-PATH WRITE ───────────────────────────────────────────────
 *
 * This is called from WRITE paths only. Capturing it while rendering Today would reintroduce
 * exactly the defect D-HIST-1 found and `6f3e65d` closed — `pipeline_snapshots` written from a page
 * render, whose own comment read "Today's snapshot, idempotent — history accrues just by looking."
 * That pattern is why `97e975f0` could not be safely reconstructed during the P45-4 incident.
 * D-HIST-2 established the correction: history has an EXPLICIT PRODUCER. This is one.
 *
 * ── SELF-DEDUPLICATING, SO THERE IS NO CADENCE TO DECIDE ────────────────────────────────────────
 *
 * The fingerprint identifies the ranking INPUT STATE — algorithm version, scope, comparison-set
 * size, and each ranked subject with its score and band. Capturing again while nothing has moved
 * collides on (org_id, snapshot_fingerprint, pursuit_id) and writes nothing. We capture on CHANGE,
 * not on a timer, so no row count depends on how often anyone happens to act.
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

export interface AttentionCaptureInput {
  orgId: string;
  view: PortfolioPertinenceView;
  algorithmVersion: string;
  /** The decision this ranking stood behind, where one exists. Null is a fact, not a gap. */
  decision?: { kind: "pursuit_plan_revision"; id: string } | null;
  dataEnvironment?: DataEnvironment;
}

/** The ranking input state. Order matters: a reordering IS a different state. */
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
 * Persist one attention observation set. Returns the rows actually written — zero when the ranking
 * state is unchanged, which is the normal and expected case.
 */
export async function captureAttention(
  db: PoolClient, input: AttentionCaptureInput,
): Promise<{ snapshotId: string; written: number; fingerprint: string }> {
  const fingerprint = attentionFingerprint(input.view, input.algorithmVersion);
  const h = createHash("sha256").update(`${input.orgId}:${fingerprint}`).digest("hex");
  const snapshotId = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
  let written = 0;
  for (const item of input.view.items) {
    const r = await db.query(
      `insert into attention_observations
         (org_id, snapshot_id, snapshot_fingerprint, algorithm_version, scope, comparison_set_size,
          withheld_count, decision_ref_kind, decision_ref_id, pursuit_id, rank, score, band,
          components, data_environment)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       on conflict (org_id, snapshot_fingerprint, pursuit_id) do nothing`,
      [input.orgId, snapshotId, fingerprint, input.algorithmVersion, input.view.scope,
       input.view.comparisonSetSize, input.view.withheldCount,
       input.decision?.kind ?? null, input.decision?.id ?? null,
       item.pursuitId, item.rank, item.score, item.band,
       // Numbers and declared signal keys only — never reasons, never evidence text.
       JSON.stringify((item.signals ?? []).map((s) => {
         const sig = s as { key?: string; signal?: string; contribution?: number };
         return { key: sig.key ?? sig.signal ?? null, contribution: sig.contribution ?? null };
       })),
       input.dataEnvironment ?? "PRODUCTION"],
    );
    written += r.rowCount ?? 0;
  }
  return { snapshotId, written, fingerprint };
}
