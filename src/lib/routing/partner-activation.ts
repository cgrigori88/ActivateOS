import type { PoolClient } from "pg";
import { ACTIVATION_WEIGHTS, PARTNER_FIT_VERSION, type DisqualifierCode } from "./types";
import { partnerRelationship } from "./relationship";
import { transactionScore } from "../transactions/features";

/**
 * Partner Activation scoring (Workstream C, §5/§6/§7). Deterministic, explainable, versioned:
 * how strong a partner is for THIS Pursuit, broken into governed dimensions each of which emits
 * a reason with a real ref. Capability is a HARD gate. Business/strategic priority is kept
 * separate from observed fit (§54) and never inflates propensity. Distinct from the route score
 * (which also weighs topology + readiness).
 */

export interface Dimension { dimension: string; rawValue: number; normalizedValue: number; weight: number; contribution: number; source: string; featureObservedAt: Date | null; }
export interface Reason { reasonCode: string; polarity: 1 | -1; weight: number; detail: string; refType: string; refId: string | null; disclosureClass: string; }
export interface Disqualifier { code: DisqualifierCode; severity: "HARD" | "SOFT"; refType: string; refId: string | null; detail: string; }

export interface PartnerActivation {
  partnerActivationScore: number;   // 0..100 — strength of this partner for this pursuit
  suitabilityScore: number;         // structural quality (excludes readiness)
  dimensions: Dimension[];
  reasons: Reason[];
  disqualifiers: Disqualifier[];
  transactionAvailable: boolean;
  dataCompleteness: number;         // 0..1 — feeds route confidence (§10)
  hardDisqualified: boolean;
}

interface PursuitCtx { orgId: string; accountId: string; productCategoryId: string | null; pursuitType: string | null; }

export async function scorePartnerActivation(db: PoolClient, ctx: PursuitCtx, partnerId: string, asOf = new Date()): Promise<PartnerActivation> {
  const dims: Dimension[] = [];
  const reasons: Reason[] = [];
  const disq: Disqualifier[] = [];
  let completenessHits = 0, completenessTotal = 0;
  const track = (present: boolean) => { completenessTotal++; if (present) completenessHits++; };

  // Capability (HARD gate).
  const cap = await db.query<{ strength: string; certified: boolean }>(
    `select strength, certified from partner_capabilities where partner_id = $1 and ($2::uuid is null or taxonomy_node_id = $2) order by strength desc limit 1`,
    [partnerId, ctx.productCategoryId],
  );
  const capability = cap.rows[0] ? Number(cap.rows[0].strength) : 0;
  track(!!cap.rows[0]);
  if (capability <= 0) {
    disq.push({ code: "NO_REQUIRED_CAPABILITY", severity: "HARD", refType: "capability", refId: null, detail: "No capability on the required category" });
  } else {
    reasons.push({ reasonCode: "RELEVANT_CAPABILITY", polarity: 1, weight: ACTIVATION_WEIGHTS.product_capability, detail: `Capability ${(capability * 100).toFixed(0)}${cap.rows[0].certified ? " (certified)" : ""}`, refType: "capability", refId: null, disclosureClass: "INTERNAL" });
  }

  // Account relationship.
  const rel = await partnerRelationship(db, partnerId, ctx.accountId);
  track(rel.tier !== "NONE");
  if (rel.strength01 >= 0.6) reasons.push({ reasonCode: "STRONG_ACCOUNT_RELATIONSHIP", polarity: 1, weight: ACTIVATION_WEIGHTS.account_relationship, detail: `${rel.tier} (${(rel.strength01 * 100).toFixed(0)})`, refType: "relationship", refId: null, disclosureClass: "PARTNER_SHARED" });
  else if (rel.tier === "NONE") { reasons.push({ reasonCode: "NO_ACCOUNT_RELATIONSHIP", polarity: -1, weight: ACTIVATION_WEIGHTS.account_relationship, detail: "No known relationship", refType: "relationship", refId: null, disclosureClass: "INTERNAL" }); disq.push({ code: "NO_ACCOUNT_COVERAGE" as DisqualifierCode, severity: "SOFT", refType: "relationship", refId: null, detail: "No account coverage" }); }

  // Seller coverage (named partner seller on the account).
  const sc = await db.query<{ n: string }>(
    `select count(*)::text n from seller_account_relationships sar join sellers s on s.id = sar.seller_id
      where s.partner_id = $1 and sar.company_id = $2 and sar.strength > 0`, [partnerId, ctx.accountId],
  );
  const hasSeller = Number(sc.rows[0].n) > 0;
  track(true);
  if (!hasSeller) disq.push({ code: "NO_NAMED_SELLER", severity: "SOFT", refType: "seller", refId: null, detail: "No named partner seller on the account" });

  // Territory / vertical (from partner coverage vs company).
  const terr = await db.query<{ industries: string[]; countries: string[] }>(`select industries, countries from partners where id = $1`, [partnerId]);
  const co = await db.query<{ industry: string | null; country: string | null }>(`select industry, country from companies where id = $1`, [ctx.accountId]);
  const industries = terr.rows[0]?.industries ?? [];
  const countries = terr.rows[0]?.countries ?? [];
  const geoOk = countries.length === 0 || !co.rows[0]?.country || countries.includes(co.rows[0].country);
  const vertOk = industries.length === 0 || !co.rows[0]?.industry || industries.includes(co.rows[0].industry);
  const territory = (geoOk ? 0.6 : 0) + (vertOk ? 0.4 : 0);
  track(industries.length > 0 || countries.length > 0);
  if (!geoOk) disq.push({ code: "OUTSIDE_TERRITORY", severity: "HARD", refType: "territory", refId: null, detail: "Account country outside partner coverage" });

  // Transaction adjacency (only resolved features contribute).
  const tx = await transactionScore(db, ctx.orgId, ctx.accountId, ctx.productCategoryId, partnerId);
  track(tx.available);
  if (tx.available && tx.score01 >= 0.6) reasons.push({ reasonCode: "TRANSACTION_ADJACENCY", polarity: 1, weight: ACTIVATION_WEIGHTS.transaction_adjacency, detail: "Recent adjacent-category activity through this route", refType: "transaction", refId: null, disclosureClass: "TRANSACTION_CONFIDENTIAL" });

  // Historical performance — neutral when no real data (§53).
  const perf = 0.5;

  const values: Record<string, { v: number; source: string; obs: Date | null }> = {
    account_relationship: { v: rel.strength01, source: "relationship", obs: null },
    product_capability: { v: capability, source: "partner_fit", obs: null },
    transaction_adjacency: { v: tx.available ? tx.score01 : 0.5, source: "transaction", obs: asOf },
    historical_performance: { v: perf, source: "outcome", obs: null },
    territory_alignment: { v: territory, source: "territory", obs: null },
    seller_coverage: { v: hasSeller ? 0.8 : 0.2, source: "relationship", obs: null },
    strategic_alignment: { v: 0.5, source: "strategic", obs: null },   // kept separate from propensity (§54)
    vertical_alignment: { v: vertOk ? 0.7 : 0.3, source: "territory", obs: null },
  };

  let total = 0;
  for (const [dim, w] of Object.entries(ACTIVATION_WEIGHTS)) {
    const { v, source, obs } = values[dim];
    const contribution = w * v * 100;
    dims.push({ dimension: dim, rawValue: v * 100, normalizedValue: v, weight: w, contribution, source, featureObservedAt: obs });
    total += contribution;
  }

  // Suitability excludes readiness proxies (seller_coverage).
  const suitability = total - ACTIVATION_WEIGHTS.seller_coverage * values.seller_coverage.v * 100 + ACTIVATION_WEIGHTS.seller_coverage * 0.5 * 100;

  return {
    partnerActivationScore: clampScore(total),
    suitabilityScore: clampScore(suitability),
    dimensions: dims, reasons, disqualifiers: disq,
    transactionAvailable: tx.available,
    dataCompleteness: completenessTotal ? completenessHits / completenessTotal : 0,
    hardDisqualified: disq.some((d) => d.severity === "HARD"),
  };
}

export const _fitVersion = PARTNER_FIT_VERSION;
function clampScore(n: number): number { return Math.min(100, Math.max(0, Number.isFinite(n) ? n : 0)); }
