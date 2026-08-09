import type pg from "pg";
import { SIGNAL_DEFS, type SignalFamily } from "../signals/types";
import {
  computeScore,
  FEATURE_WEIGHTS,
  type EdgeMap,
} from "./compute";
import {
  computeDimensions,
  detectContradictions,
  DIMENSION_VERSION,
  evidenceSplit,
  refreshIntervalDays,
  type SignalWithSource,
} from "./dimensions";

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
     values ($1, 'Deterministic rules engine with multidimensional scores', $2)
     on conflict (label) do update set weights = excluded.weights
     returning id`,
    [DIMENSION_VERSION, JSON.stringify(FEATURE_WEIGHTS)],
  );
  const versionId = versionRows[0].id;

  const { rows: signalRows } = await db.query<{
    id: string;
    company_id: string;
    signal_type: string;
    node_slug: string | null;
    node_id: string | null;
    direction: number;
    magnitude: string;
    confidence: string;
    observed_at: Date;
    half_life_days: number;
    evidence_id: string;
    source_type: string;
  }>(
    `select s.id, s.company_id, s.signal_type, n.slug as node_slug, n.id as node_id,
            s.direction, s.magnitude, s.confidence, s.observed_at, s.half_life_days,
            s.evidence_id, e.source_type
     from signals s
     left join taxonomy_nodes n on n.id = s.taxonomy_node_id
     join evidence e on e.id = s.evidence_id
     where s.org_id = $1`,
    [orgId],
  );

  const byCompany = new Map<string, (SignalWithSource & { id: string; nodeId: string | null })[]>();
  for (const r of signalRows) {
    const def = SIGNAL_DEFS[r.signal_type];
    const family: SignalFamily = def?.family ?? "trigger";
    const list = byCompany.get(r.company_id) ?? [];
    list.push({
      id: r.id,
      signalType: r.signal_type,
      family,
      nodeSlug: r.node_slug,
      nodeId: r.node_id,
      direction: r.direction === -1 ? -1 : 1,
      magnitude: Number(r.magnitude),
      confidence: Number(r.confidence),
      observedAt: r.observed_at,
      halfLifeDays: r.half_life_days,
      evidenceId: r.evidence_id,
      sourceType: r.source_type,
    });
    byCompany.set(r.company_id, list);
  }

  const edgeWeights = new Map([...edgeMap].map(([slug, e]) => [slug, e.weight]));
  let scored = 0;
  for (const [companyId, signals] of byCompany) {
    const result = computeScore(signals, targetSlug, edgeMap);
    const dims = computeDimensions(signals, targetSlug, edgeWeights, result.score);
    const split = evidenceSplit(result.features);

    // What changed vs. the previous evaluation (BLUEPRINT §52).
    const { rows: prevRows } = await db.query<{ score: string; evidence_ids: string[] }>(
      `select p.score, coalesce(
         (select array_agg(distinct e) from score_features f, unnest(f.evidence_ids) e
          where f.score_id = p.id), '{}') as evidence_ids
       from propensity_scores p
       where p.org_id = $1 and p.company_id = $2 and p.taxonomy_node_id = $3
       order by p.computed_at desc limit 1`,
      [orgId, companyId, targetNodeId],
    );
    const prevScore = prevRows[0] ? Number(prevRows[0].score) : null;
    const prevEvidence = new Set(prevRows[0]?.evidence_ids ?? []);
    const currentEvidence = [...new Set(result.features.flatMap((f) => f.evidenceIds))];
    const newEvidence = currentEvidence.filter((e) => !prevEvidence.has(e));
    const changes = {
      delta: prevScore == null ? null : Math.round((result.score - prevScore) * 10) / 10,
      new_evidence_ids: newEvidence,
    };

    const { rows: scoreRows } = await db.query<{ id: string }>(
      `insert into propensity_scores
         (org_id, company_id, taxonomy_node_id, score, band, score_version_id,
          prev_score, positive_points, negative_points, changes)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning id`,
      [
        orgId, companyId, targetNodeId, result.score.toFixed(2), result.band, versionId,
        prevScore, split.positive, split.negative, JSON.stringify(changes),
      ],
    );
    const scoreId = scoreRows[0].id;

    for (const f of result.features) {
      await db.query(
        `insert into score_features (score_id, feature, contribution, evidence_ids)
         values ($1, $2, $3, $4)`,
        [scoreId, f.feature, f.contribution.toFixed(3), f.evidenceIds],
      );
    }
    for (const [dimension, value] of Object.entries(dims)) {
      await db.query(
        `insert into propensity_dimensions (score_id, dimension, value) values ($1, $2, $3)`,
        [scoreId, dimension, value],
      );
    }

    // Contradictions (BLUEPRINT §5–6): recorded, never silently netted away.
    for (const pair of detectContradictions(signals)) {
      const a = pair.a as SignalWithSource & { id: string; nodeId: string | null };
      const b = pair.b as SignalWithSource & { id: string; nodeId: string | null };
      await db.query(
        `insert into contradictions (org_id, company_id, taxonomy_node_id, basis, signal_id_a, signal_id_b)
         select $1, $2, $3, $4, $5, $6
         where not exists (
           select 1 from contradictions
           where signal_id_a = $5 and signal_id_b = $6 and status = 'open')`,
        [orgId, companyId, a.nodeId, pair.basis, a.id, b.id],
      );
    }

    // Refresh engine (BLUEPRINT §50): cadence follows the band.
    await db.query(
      `update companies set refresh_tier = $2,
         next_refresh_at = now() + make_interval(days => $3)
       where id = $1`,
      [companyId, result.band, refreshIntervalDays(result.band)],
    );
    scored++;
  }
  return { scored };
}
