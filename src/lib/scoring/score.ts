import type pg from "pg";
import { SIGNAL_DEFS, type SignalFamily } from "../signals/types";
import {
  computeScore,
  FEATURE_WEIGHTS,
  SCORE_VERSION_LABEL,
  type EdgeMap,
  type ScorableSignal,
} from "./compute";

/** Load signals + ontology edges, compute explainable scores, persist them. */
export async function scoreOrg(
  db: pg.PoolClient,
  orgId: string,
  targetSlug: string,
): Promise<{ scored: number }> {
  const { rows: targetRows } = await db.query<{ id: string }>(
    `select id from taxonomy_nodes where slug = $1`,
    [targetSlug],
  );
  if (targetRows.length === 0) throw new Error(`unknown taxonomy node: ${targetSlug}`);
  const targetNodeId = targetRows[0].id;

  const { rows: edges } = await db.query<{ slug: string; weight: string; edge_type: string }>(
    `select f.slug, e.weight, e.edge_type
     from taxonomy_edges e
     join taxonomy_nodes f on f.id = e.from_node_id
     where e.to_node_id = $1`,
    [targetNodeId],
  );
  const edgeMap: EdgeMap = new Map(
    edges.map((e) => [e.slug, { weight: Number(e.weight), edgeType: e.edge_type }]),
  );

  const { rows: versionRows } = await db.query<{ id: string }>(
    `insert into score_versions (label, description, weights)
     values ($1, 'Deterministic v1 rules engine', $2)
     on conflict (label) do update set weights = excluded.weights
     returning id`,
    [SCORE_VERSION_LABEL, JSON.stringify(FEATURE_WEIGHTS)],
  );
  const versionId = versionRows[0].id;

  const { rows: signalRows } = await db.query<{
    company_id: string;
    signal_type: string;
    node_slug: string | null;
    direction: number;
    magnitude: string;
    confidence: string;
    observed_at: Date;
    half_life_days: number;
    evidence_id: string;
  }>(
    `select s.company_id, s.signal_type, n.slug as node_slug, s.direction,
            s.magnitude, s.confidence, s.observed_at, s.half_life_days, s.evidence_id
     from signals s
     left join taxonomy_nodes n on n.id = s.taxonomy_node_id
     where s.org_id = $1`,
    [orgId],
  );

  const byCompany = new Map<string, ScorableSignal[]>();
  for (const r of signalRows) {
    const def = SIGNAL_DEFS[r.signal_type];
    const family: SignalFamily = def?.family ?? "trigger";
    const list = byCompany.get(r.company_id) ?? [];
    list.push({
      signalType: r.signal_type,
      family,
      nodeSlug: r.node_slug,
      direction: r.direction === -1 ? -1 : 1,
      magnitude: Number(r.magnitude),
      confidence: Number(r.confidence),
      observedAt: r.observed_at,
      halfLifeDays: r.half_life_days,
      evidenceId: r.evidence_id,
    });
    byCompany.set(r.company_id, list);
  }

  let scored = 0;
  for (const [companyId, signals] of byCompany) {
    const result = computeScore(signals, targetSlug, edgeMap);
    const { rows: scoreRows } = await db.query<{ id: string }>(
      `insert into propensity_scores (org_id, company_id, taxonomy_node_id, score, band, score_version_id)
       values ($1, $2, $3, $4, $5, $6)
       returning id`,
      [orgId, companyId, targetNodeId, result.score.toFixed(2), result.band, versionId],
    );
    for (const f of result.features) {
      await db.query(
        `insert into score_features (score_id, feature, contribution, evidence_ids)
         values ($1, $2, $3, $4)`,
        [scoreRows[0].id, f.feature, f.contribution.toFixed(3), f.evidenceIds],
      );
    }
    scored++;
  }
  return { scored };
}
