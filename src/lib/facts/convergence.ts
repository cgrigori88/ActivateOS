import type { PoolClient } from "pg";
import { recordChange } from "../pursuits/ledger";
import type { DataEnvironment } from "../pursuits/lineage";

/**
 * Independence-aware signal/fact convergence (Workstream B, §19/§20). The core anti-naivety
 * rule: three facts derived from the SAME source are not three independent confirmations.
 * Independent family count is capped by the number of distinct source identities, so a
 * syndicated press release cannot inflate convergence. Snapshots are versioned and carry an
 * explanation, so Why Now can point at a contemporaneous convergence state (§20/§22).
 */

export interface ConvergenceResult {
  families: { family: string; factIds: string[]; sourceIdentities: string[] }[];
  supportingFactIds: string[];
  distinctSourceIdentities: number;
  independentFamilyCount: number;
  sourceDiversity: number;      // distinct source identities / total support rows
  contradictions: number;
  convergenceScore: number;     // 0..1
  windowDays: number;
  explanation: Record<string, unknown>;
}

const DAY_MS = 86_400_000;
const TARGET_FAMILIES = 3;

export async function computeConvergence(db: PoolClient, companyId: string, windowDays = 90, now = new Date()): Promise<ConvergenceResult> {
  const since = new Date(now.getTime() - windowDays * DAY_MS);
  // CURRENT facts on the account within the window, with their supporting source identities.
  const { rows } = await db.query<{ fact_id: string; family: string | null; source_type: string | null; source_url: string | null }>(
    `select f.id fact_id, f.family, e.source_type, e.source_url
       from facts f
       left join fact_evidence fe on fe.fact_id = f.id and fe.stance = 'SUPPORTS'
       left join evidence e on e.id = fe.evidence_id
      where f.company_id = $1 and f.status = 'CURRENT' and f.polarity = 1
        and f.observed_last_at >= $2`,
    [companyId, since],
  );

  const familyMap = new Map<string, { factIds: Set<string>; sources: Set<string> }>();
  const allSources = new Set<string>();
  const allFacts = new Set<string>();
  for (const r of rows) {
    const fam = r.family ?? "unclassified";
    const srcId = sourceIdentity(r.source_type, r.source_url);
    allFacts.add(r.fact_id);
    if (srcId) allSources.add(srcId);
    if (!familyMap.has(fam)) familyMap.set(fam, { factIds: new Set(), sources: new Set() });
    const fm = familyMap.get(fam)!;
    fm.factIds.add(r.fact_id);
    if (srcId) fm.sources.add(srcId);
  }

  const families = [...familyMap.entries()].map(([family, v]) => ({
    family, factIds: [...v.factIds], sourceIdentities: [...v.sources],
  }));
  const distinctSourceIdentities = allSources.size;
  // Independence cap: you cannot have more independent confirmations than distinct sources.
  const independentFamilyCount = Math.min(families.length, Math.max(distinctSourceIdentities, families.length === 0 ? 0 : 1));
  const totalSupport = rows.filter((r) => r.source_type).length || 1;
  const sourceDiversity = distinctSourceIdentities / totalSupport;

  const contra = await db.query<{ n: string }>(
    `select count(*)::text n from fact_contradictions fc
       join facts f on f.id = fc.fact_id_a where f.company_id = $1 and fc.status = 'open'`,
    [companyId],
  );
  const contradictions = Number(contra.rows[0]?.n ?? 0);

  const convergenceScore = clamp01((independentFamilyCount / TARGET_FAMILIES) * clamp01(0.4 + 0.6 * sourceDiversity));

  return {
    families, supportingFactIds: [...allFacts], distinctSourceIdentities, independentFamilyCount,
    sourceDiversity, contradictions, convergenceScore, windowDays,
    explanation: {
      rule: "independent_family_count capped by distinct source identities",
      familyCount: families.length, distinctSourceIdentities, note:
        families.length > distinctSourceIdentities ? "families exceed distinct sources — convergence capped (possible syndication)" : "families independently sourced",
    },
  };
}

/** Write a versioned convergence snapshot (one-current). Emits CONVERGENCE_CHANGED on change. */
export async function writeConvergenceSnapshot(
  db: PoolClient, orgId: string, pursuitId: string, companyId: string, windowDays = 90, env: DataEnvironment = "PRODUCTION",
): Promise<{ snapshotId: string; seq: number; result: ConvergenceResult }> {
  const result = await computeConvergence(db, companyId, windowDays);
  const prev = await db.query<{ independent_family_count: number }>(
    `select independent_family_count from pursuit_convergence_snapshots where pursuit_id = $1 and is_current`, [pursuitId],
  );
  const seqRow = await db.query<{ seq: number }>(
    `select coalesce(max(seq),0)+1 seq from pursuit_convergence_snapshots where pursuit_id = $1`, [pursuitId],
  );
  const seq = seqRow.rows[0].seq;
  await db.query(`update pursuit_convergence_snapshots set is_current = false where pursuit_id = $1 and is_current`, [pursuitId]);
  const ins = await db.query<{ id: string }>(
    `insert into pursuit_convergence_snapshots
       (org_id, pursuit_id, seq, is_current, families, supporting_fact_ids, source_diversity,
        independent_family_count, contradictions, convergence_score, window_days, explanation)
     values ($1,$2,$3,true,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [orgId, pursuitId, seq, JSON.stringify(result.families), result.supportingFactIds, result.sourceDiversity,
     result.independentFamilyCount, result.contradictions, result.convergenceScore, windowDays, JSON.stringify(result.explanation)],
  );
  if (!prev.rows[0] || prev.rows[0].independent_family_count !== result.independentFamilyCount) {
    await recordChange(db, {
      orgId, pursuitId, entityType: "pursuit", entityId: pursuitId, changeType: "CONVERGENCE_CHANGED",
      materiality: "MEDIUM", reason: `Convergence → ${result.independentFamilyCount} independent families`,
      actorType: "SYSTEM", triggerType: "MODEL_RECALCULATION", dataEnvironment: env,
      before: prev.rows[0] ? { independentFamilyCount: prev.rows[0].independent_family_count } : null,
      after: { independentFamilyCount: result.independentFamilyCount, sourceDiversity: result.sourceDiversity },
    });
  }
  return { snapshotId: ins.rows[0].id, seq, result };
}

function sourceIdentity(sourceType: string | null, sourceUrl: string | null): string | null {
  if (!sourceType && !sourceUrl) return null;
  let domain = "";
  if (sourceUrl) { try { domain = new URL(sourceUrl).hostname.replace(/^www\./, ""); } catch { domain = sourceUrl; } }
  return `${sourceType ?? "?"}:${domain}`;
}

function clamp01(n: number): number { return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0; }
