import type { PoolClient } from "pg";
import type { PursuitPortfolioView, PortfolioRow, PortfolioAccountGroup } from "./types";
import { scoreView, type Caller } from "./helpers";

/**
 * Pursuit portfolio read model (Workstream D, §5/§6). The canonical work list: one row per
 * Pursuit (an account may hold several), with an optional account rollup that groups without
 * collapsing their distinct scores. Optimized to answer "what should I work next?"
 */

export async function getPursuitPortfolio(db: PoolClient, caller: Caller): Promise<PursuitPortfolioView> {
  const { rows } = await db.query<{
    id: string; account_id: string; account_label: string; thesis: string | null; use_case: string | null; solution: string | null;
    status: string; expected_value_weighted: string | null; currency: string | null; last_material_change_at: Date | null;
    priority: string | null; propensity: string | null; evidence_conf: string | null; timing: string | null;
    recommended_route: string | null; route_confidence: string | null; readiness: string | null; data_environment: string;
  }>(
    `select pu.id, pu.account_id, c.legal_name account_label, pu.business_problem thesis, pu.use_case, tn.name solution,
            pu.status, pu.expected_value_weighted, pu.expected_value_currency currency, pu.last_material_change_at,
            pu.current_priority_score priority, pu.current_purchase_propensity_score propensity,
            pu.current_evidence_confidence_score evidence_conf, pu.current_timing_score timing,
            pr.name recommended_route, sn.route_confidence, rc.activation_readiness_score readiness, pu.data_environment
       from pursuits pu
       join companies c on c.id = pu.account_id
       left join taxonomy_nodes tn on tn.id = pu.product_category_id
       left join pursuit_route_snapshots sn on sn.pursuit_id = pu.id and sn.is_current
       left join partners pr on pr.id = sn.recommended_partner_id
       left join route_candidates rc on rc.route_snapshot_id = sn.id and rc.is_recommended
      where pu.status not in ('WON','LOST','DISQUALIFIED') and pu.merged_into_pursuit_id is null
      order by pu.current_priority_score desc nulls last`, []);

  const viewRows: PortfolioRow[] = rows.map((r) => ({
    pursuitId: r.id, accountLabel: r.account_label, thesis: r.thesis ?? r.use_case ?? "Untitled pursuit", solution: r.solution,
    priority: scoreView("priority", num(r.priority)), propensity: scoreView("purchase_propensity", num(r.propensity)),
    evidenceConfidence: scoreView("evidence_confidence", num(r.evidence_conf)), timing: scoreView("timing", num(r.timing)),
    recommendedRoute: r.recommended_route, routeConfidence: scoreView("route_confidence", num(r.route_confidence)),
    activationReadiness: scoreView("activation_readiness", num(r.readiness)),
    stage: r.status, expectedValue: num(r.expected_value_weighted), currency: r.currency,
    lastMaterialChange: r.last_material_change_at?.toISOString() ?? null,
    nextBestAction: nextBest(r.status, num(r.readiness), !!r.recommended_route),
    synthetic: r.data_environment !== "PRODUCTION", deepLink: `/pursuits/${r.id}`,
  }));

  const byAccount = new Map<string, PortfolioAccountGroup>();
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i].account_id;
    if (!byAccount.has(a)) byAccount.set(a, { accountId: a, accountLabel: rows[i].account_label, pursuits: [] });
    byAccount.get(a)!.pursuits.push(viewRows[i]);
  }
  void caller;
  return { rows: viewRows, grouped: [...byAccount.values()], total: viewRows.length };
}

function nextBest(status: string, readiness: number | null, hasRoute: boolean): string | null {
  if (!hasRoute) return "Recompute route";
  if (readiness != null && readiness < 50) return "Complete the pursuit team";
  if (status === "ROUTED" || status === "QUALIFIED") return "Approve route";
  if (status === "MOTION_DESIGNED") return "Launch motion";
  return "Review pursuit";
}
function num(v: string | null): number | null { return v == null ? null : Number(v); }
