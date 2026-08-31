import type { PoolClient } from "pg";
import { getSellerPaths } from "@/lib/partners/intelligence";

/**
 * Selected-account intelligence (Phase 3c-2). Assembles the "where should I hunt, why now,
 * through whom, what next" view for ONE account from the SAME canonical objects that power
 * Today, Pursuits, Mapping, Partners and Pipeline — no demo-only intelligence. Read-only.
 */
export interface AccountIntel {
  companyId: string;
  legalName: string;
  industry: string | null;
  hunt: { score: number | null; band: string | null; priority: number | null; propensity: number | null; useCase: string | null; problem: string | null; expectedValue: number | null; openOpps: number; pipelineUsd: number };
  whyNow: { compellingEvent: string | null; timingKnown: boolean; timingScore: number | null; convergence: number | null; materialChange: string | null; evidence: Array<{ claim: string; confidence: number; firstParty: boolean }>; missingEvidence: string | null };
  throughWhom: { recommended: string | null; selected: string | null; overridden: boolean; partners: Array<{ name: string; strength: number | null; tenure: number | null; recommended: boolean }>; overlapLists: string[]; conflict: string | null;
    /** Strongest seller path (P1B.5): tiered + decayed evidence; UNKNOWN recency stays UNKNOWN. */
    sellerPath: { name: string; partnerLabel: string | null; tier: string; recency: string; assigned: boolean } | null };
  whatNext: { motion: string | null; governedAction: string | null; humanDecision: string | null };
}

export async function getAccountIntel(db: PoolClient, companyId: string): Promise<AccountIntel | null> {
  const co = (await db.query<{ legal_name: string; industry: string | null }>(`select legal_name, industry from companies where id=$1`, [companyId])).rows[0];
  if (!co) return null;

  const score = (await db.query<{ score: string; band: string; score_id: string }>(`select id as score_id, score, band from propensity_scores where company_id=$1 order by computed_at desc limit 1`, [companyId])).rows[0];
  const dims = score ? new Map((await db.query<{ dimension: string; value: string }>(`select dimension, value from propensity_dimensions where score_id=$1`, [score.score_id])).rows.map((r) => [r.dimension, Number(r.value)])) : new Map<string, number>();

  const pursuit = (await db.query<{ id: string; use_case: string | null; business_problem: string | null; prio: number | null; prop: number | null; tim: number | null; evw: string | null; why_now: unknown }>(
    `select id, use_case, business_problem, current_priority_score prio, current_purchase_propensity_score prop, current_timing_score tim, expected_value_weighted evw, why_now
       from pursuits where account_id=$1 order by created_at asc limit 1`, [companyId])).rows[0];
  const wn = (pursuit?.why_now ?? {}) as { business_trigger?: { label?: string } | null; timing_anchor?: unknown; signal_convergence?: { independent_family_count?: number }; evidence_gap?: string | null };

  const opps = (await db.query<{ open: string; pipeline: string }>(`select count(*) filter (where stage not like 'closed%') open, coalesce(sum(amount_usd) filter (where stage not like 'closed%'),0) pipeline from opportunities where company_id=$1`, [companyId])).rows[0];

  const evidence = (await db.query<{ claim: string; confidence: string; first_party: boolean }>(`select claim, computed_confidence confidence, first_party from evidence where company_id=$1 and status='verified' order by observed_at desc limit 4`, [companyId])).rows;

  const materialChange = pursuit ? (await db.query<{ change_type: string; reason: string | null }>(`select change_type, reason from change_ledger where pursuit_id=$1 order by occurred_at desc limit 1`, [pursuit.id])).rows[0] : undefined;

  // Route recommendation + human selection (through-whom, recommendation ≠ decision).
  const route = pursuit ? (await db.query<{ rec: string | null; sel: string | null }>(
    `select rp.name rec, sp.name sel from pursuit_route_snapshots s
       left join partners rp on rp.id = s.recommended_partner_id
       left join partners sp on sp.id = s.selected_partner_id
      where s.pursuit_id=$1 and s.is_current limit 1`, [pursuit.id])).rows[0] : undefined;

  const partners = (await db.query<{ name: string; strength: number | null; tenure: number | null }>(
    `select p.name, pr.strength, pr.tenure_months tenure from partner_relationships pr join partners p on p.id=pr.partner_id where pr.company_id=$1 order by pr.strength desc nulls last`, [companyId])).rows;

  const overlapLists = (await db.query<{ name: string }>(
    `select ap.name from population_members pm join account_populations ap on ap.id=pm.population_id where pm.company_id=$1 and ap.partner_id is not null`, [companyId])).rows.map((r) => r.name);

  const motion = (await db.query<{ thesis: string | null; status: string }>(`select thesis, status from revenue_motions where company_id=$1 order by created_at desc limit 1`, [companyId])).rows[0];
  const nextAction = (await db.query<{ action: string; status: string }>(`select a.action, a.status from motion_actions a join revenue_motions m on m.id=a.motion_id where m.company_id=$1 and a.status='pending' order by a.due_at limit 1`, [companyId])).rows[0];

  const overridden = !!(route?.sel && route.rec && route.sel !== route.rec);
  const recName = route?.rec ?? null;

  // Strongest seller path (P1B.5) — evidence-ranked; ownership ≠ recommendation.
  const orgRow = (await db.query<{ org_id: string | null }>(`select org_id from revenue_motions where company_id=$1 limit 1`, [companyId])).rows[0]
    ?? (await db.query<{ org_id: string | null }>(`select org_id from partners limit 1`)).rows[0];
  const sellerPaths = orgRow?.org_id ? await getSellerPaths(db, orgRow.org_id, companyId) : [];
  const topSeller = sellerPaths[0] ?? null;

  return {
    companyId, legalName: co.legal_name, industry: co.industry,
    hunt: {
      score: score ? Number(score.score) : null, band: score?.band ?? null,
      priority: pursuit?.prio ?? dims.get("purchase_need") ?? null,
      propensity: pursuit?.prop ?? dims.get("purchase_propensity") ?? null,
      useCase: pursuit?.use_case ?? null, problem: pursuit?.business_problem ?? null,
      expectedValue: pursuit?.evw ? Number(pursuit.evw) : null,
      openOpps: Number(opps?.open ?? 0), pipelineUsd: Number(opps?.pipeline ?? 0),
    },
    whyNow: {
      compellingEvent: wn.business_trigger?.label ? `${wn.business_trigger.label} — strategic initiative` : (evidence[0]?.claim ?? null),
      timingKnown: pursuit?.tim != null, timingScore: pursuit?.tim ?? null,
      convergence: wn.signal_convergence?.independent_family_count ?? null,
      materialChange: materialChange ? (materialChange.reason ?? materialChange.change_type.replace(/_/g, " ")) : null,
      evidence: evidence.map((e) => ({ claim: e.claim, confidence: Number(e.confidence), firstParty: e.first_party })),
      missingEvidence: wn.evidence_gap ?? (pursuit?.tim == null ? "A verified renewal or contract-end date would materially raise timing and priority." : null),
    },
    throughWhom: {
      recommended: recName, selected: route?.sel ?? null, overridden,
      partners: partners.map((p) => ({ name: p.name, strength: p.strength, tenure: p.tenure, recommended: p.name === recName })),
      overlapLists,
      conflict: partners.length >= 2 && Math.abs((partners[0].strength ?? 0) - (partners[1].strength ?? 0)) <= 6 ? `${partners[0].name} and ${partners[1].name} are both credibly positioned — a routing decision, not a default` : null,
      sellerPath: topSeller ? { name: topSeller.name, partnerLabel: topSeller.partnerLabel, tier: topSeller.tier, recency: topSeller.recency, assigned: topSeller.assignedOnLivePursuit } : null,
    },
    whatNext: {
      motion: motion ? `${motion.thesis ?? "motion"}${motion.status === "draft" ? " (draft — awaiting approval)" : ""}` : null,
      governedAction: nextAction ? nextAction.action : null,
      humanDecision: overridden ? `Route overridden to ${route!.sel} — recommendation (${recName}) preserved` : (motion?.status === "draft" ? "Approve the drafted motion to activate" : null),
    },
  };
}
