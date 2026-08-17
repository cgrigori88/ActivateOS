import type pg from "pg";
import { STAGE_PROBABILITY, STAGES, type OpenStage, type Stage } from "./lifecycle";

type Db = pg.Pool | pg.PoolClient;

/**
 * Editable stage-probability weights (migration 0036). Resolution order for a
 * deal attributed to partner P:
 *
 *   partner P's override → the org's default override → declared v1 curve
 *
 * Closed stages stay fixed (won=1, lost=0) — only open stages are editable.
 */

export interface StageWeights {
  /** effective probability for a stage, given the deal's partner (null = direct) */
  weightFor(partnerId: string | null, stage: Stage): number;
  /** the effective open-stage curve for one scope (for display/editing) */
  curveFor(partnerId: string | null): Record<OpenStage, number>;
  /** partner ids that carry at least one override (for the editor's select) */
  overriddenPartnerIds: string[];
}

export async function loadStageWeights(db: Db, orgId: string | null): Promise<StageWeights> {
  const orgDefault = new Map<string, number>();
  const byPartner = new Map<string, Map<string, number>>();

  if (orgId) {
    const { rows } = await db.query<{ partner_id: string | null; stage: string; probability: string }>(
      `select partner_id, stage, probability from stage_weights where org_id = $1`,
      [orgId],
    );
    for (const r of rows) {
      if (r.partner_id == null) orgDefault.set(r.stage, Number(r.probability));
      else {
        if (!byPartner.has(r.partner_id)) byPartner.set(r.partner_id, new Map());
        byPartner.get(r.partner_id)!.set(r.stage, Number(r.probability));
      }
    }
  }

  const weightFor = (partnerId: string | null, stage: Stage): number => {
    if (stage === "closed_won") return 1;
    if (stage === "closed_lost") return 0;
    const partnerVal = partnerId ? byPartner.get(partnerId)?.get(stage) : undefined;
    return partnerVal ?? orgDefault.get(stage) ?? STAGE_PROBABILITY[stage];
  };

  return {
    weightFor,
    curveFor: (partnerId) =>
      Object.fromEntries(STAGES.map((s) => [s, weightFor(partnerId, s)])) as Record<OpenStage, number>,
    overriddenPartnerIds: [...byPartner.keys()],
  };
}
