import type { PoolClient } from "pg";
import { upsertPursuit, type PursuitType } from "./model";
import { writeScoreSnapshot } from "./scoring";

/**
 * Reparenting / backfill service (Workstream A, §I / §24-25 / §38-40). Deterministically
 * and IDEMPOTENTLY promotes legacy revenue_motions / pursuit_teams / opportunities /
 * campaigns into canonical Pursuits, per org. Safe to run once, twice, ten times — the
 * dedup key + upsert converge to the same graph. Assumes it runs inside a
 * withTenantOrg(orgId) transaction so RLS scopes every write to the org.
 */

/** Deterministic pursuit_type inference from legacy motion text (§24). NEVER silently NET_NEW. */
export function inferPursuitType(text: string | null | undefined): {
  type: PursuitType;
  source: "TEXT_INFERENCE" | "DEFAULT";
  confidence: "HIGH" | "MEDIUM" | "LOW";
} {
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return { type: "UNCLASSIFIED", source: "DEFAULT", confidence: "LOW" };
  const has = (...ks: string[]) => ks.some((k) => t.includes(k));
  if (has("renewal", "renew ")) return { type: "RENEWAL_ATTACH", source: "TEXT_INFERENCE", confidence: "MEDIUM" };
  if (has("migrat")) return { type: "MIGRATION", source: "TEXT_INFERENCE", confidence: "MEDIUM" };
  if (has("moderniz")) return { type: "MODERNIZATION", source: "TEXT_INFERENCE", confidence: "MEDIUM" };
  if (has("competit", "displace", "rip and replace")) return { type: "COMPETITIVE_DISPLACEMENT", source: "TEXT_INFERENCE", confidence: "MEDIUM" };
  if (has("upsell", "expand", "expansion")) return { type: "EXPANSION", source: "TEXT_INFERENCE", confidence: "MEDIUM" };
  if (has("cross-sell", "cross sell", "attach")) return { type: "CROSS_SELL", source: "TEXT_INFERENCE", confidence: "MEDIUM" };
  if (has("win back", "win-back", "reactivat")) return { type: "WIN_BACK", source: "TEXT_INFERENCE", confidence: "MEDIUM" };
  if (has("consolidat")) return { type: "CONSOLIDATION", source: "TEXT_INFERENCE", confidence: "MEDIUM" };
  if (has("net new", "new logo", "greenfield")) return { type: "NET_NEW", source: "TEXT_INFERENCE", confidence: "MEDIUM" };
  return { type: "UNCLASSIFIED", source: "DEFAULT", confidence: "LOW" };
}

const BACKFILL_SCORE_VERSION = "v0-directional-backfill";

export interface BackfillStats {
  orgId: string;
  motionsSeen: number;
  pursuitsCreated: number;
  pursuitsMatched: number;
  teamsAttached: number;
  opportunitiesLinked: number;
  campaignsLinked: number;
  snapshotsSeeded: number;
}

/** Ensure the directional backfill score-version exists (idempotent). */
async function ensureScoreVersion(db: PoolClient): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into score_versions (label, description, weights)
     values ($1, 'Directional v0 seeded during Pursuit backfill — NOT statistically calibrated', '{}'::jsonb)
     on conflict (label) do update set label = excluded.label
     returning id`,
    [BACKFILL_SCORE_VERSION],
  );
  return rows[0].id;
}

/** Backfill one org. Idempotent. */
export async function backfillOrg(db: PoolClient, orgId: string): Promise<BackfillStats> {
  const stats: BackfillStats = {
    orgId, motionsSeen: 0, pursuitsCreated: 0, pursuitsMatched: 0,
    teamsAttached: 0, opportunitiesLinked: 0, campaignsLinked: 0, snapshotsSeeded: 0,
  };
  const scoreVersionId = await ensureScoreVersion(db);

  // 1) Motions → Pursuits.
  const { rows: motions } = await db.query<{
    id: string; company_id: string; product_id: string | null; taxonomy_node_id: string | null;
    thesis: string | null; trigger_summary: string | null; status: string; partner_id: string | null;
    vendor_seller_id: string | null; partner_seller_id: string | null;
  }>(
    `select id, company_id, product_id, taxonomy_node_id, thesis, trigger_summary, status,
            partner_id, vendor_seller_id, partner_seller_id
       from revenue_motions where org_id = $1`,
    [orgId],
  );

  for (const m of motions) {
    stats.motionsSeen++;
    const inferred = inferPursuitType(`${m.thesis ?? ""} ${m.trigger_summary ?? ""}`);
    const res = await upsertPursuit(db, {
      orgId, accountId: m.company_id, productId: m.product_id, productCategoryId: m.taxonomy_node_id,
      pursuitType: inferred.type, pursuitTypeSource: inferred.source, pursuitTypeConfidence: inferred.confidence,
      businessProblem: m.thesis, createdByActorType: "import", createdVia: "MOTION_MIGRATION",
      originatingMotionId: m.id,
    });
    if (res.mode === "CREATED") stats.pursuitsCreated++; else stats.pursuitsMatched++;

    // Reparent the motion + set recommendation/decision routing (idempotent).
    const approved = m.status === "approved" || m.status === "active" || m.status === "completed";
    await db.query(
      `update revenue_motions set pursuit_id = $2 where id = $1 and (pursuit_id is distinct from $2)`,
      [m.id, res.id],
    );
    await db.query(
      `update pursuits set
         recommended_partner_id = coalesce(recommended_partner_id, $2),
         selected_partner_id    = coalesce(selected_partner_id, $2),
         recommended_vendor_seller_id  = coalesce(recommended_vendor_seller_id, $3),
         recommended_partner_seller_id = coalesce(recommended_partner_seller_id, $4),
         recommended_motion_id  = coalesce(recommended_motion_id, $5),
         approved_motion_id     = case when $6 then coalesce(approved_motion_id, $5) else approved_motion_id end
       where id = $1`,
      [res.id, m.partner_id, m.vendor_seller_id, m.partner_seller_id, m.id, approved],
    );

    // 5) Seed a directional score snapshot from the latest legacy propensity (idempotent-ish:
    // only if the pursuit has no snapshot yet).
    const { rows: hasSnap } = await db.query<{ n: string }>(
      `select count(*)::text n from pursuit_score_snapshots where pursuit_id = $1`, [res.id],
    );
    if (Number(hasSnap[0].n) === 0) {
      const { rows: prop } = await db.query<{ score: string; computed_at: Date }>(
        `select score, computed_at from propensity_scores
          where org_id = $1 and company_id = $2 and taxonomy_node_id = $3
          order by computed_at desc limit 1`,
        [orgId, m.company_id, m.taxonomy_node_id],
      );
      if (prop[0]) {
        const v = Number(prop[0].score);
        await writeScoreSnapshot(db, {
          pursuitId: res.id, scoreVersionId, asOf: prop[0].computed_at,
          dimensions: [
            { dimension: "purchase_propensity", value: v },
            { dimension: "pursuit_priority", value: v },
          ],
          contributions: [{
            dimension: "purchase_propensity", featureName: "legacy_propensity_score",
            provenanceType: "reference", rawValue: v, normalizedValue: v / 100, weight: 1, contribution: v,
            referenceKind: "reference", featureObservedAt: prop[0].computed_at,
          }],
          reason: "Seeded from legacy propensity during backfill (directional v0)",
        });
        stats.snapshotsSeeded++;
      }
    }
  }

  // 2) Teams → attach to the pursuit for (company, taxonomy).
  const teamRes = await db.query(
    `update pursuit_teams pt set pursuit_id = p.id
       from pursuits p
      where pt.org_id = $1 and pt.pursuit_id is null
        and p.org_id = pt.org_id and p.account_id = pt.company_id
        and (p.product_category_id is not distinct from pt.taxonomy_node_id)`,
    [orgId],
  );
  stats.teamsAttached = teamRes.rowCount ?? 0;

  // 3) Opportunities → their motion's pursuit (many opps may share one pursuit, §33).
  const oppRes = await db.query(
    `update opportunities o set pursuit_id = m.pursuit_id
       from revenue_motions m
      where o.org_id = $1 and o.pursuit_id is null and o.motion_id = m.id and m.pursuit_id is not null`,
    [orgId],
  );
  stats.opportunitiesLinked = oppRes.rowCount ?? 0;

  // 4) Campaigns → their motion's pursuit.
  const campRes = await db.query(
    `update campaigns c set pursuit_id = m.pursuit_id
       from revenue_motions m
      where c.org_id = $1 and c.pursuit_id is null and c.motion_id = m.id and m.pursuit_id is not null`,
    [orgId],
  );
  stats.campaignsLinked = campRes.rowCount ?? 0;

  return stats;
}
