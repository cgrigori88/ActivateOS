import type { PoolClient } from "pg";
import { normalizeCompanyName, nameSimilarity } from "../identity/normalize";
import { recordChange } from "../pursuits/ledger";

/**
 * Entity resolution for external/distributor identity (Workstream C, §28-31). Deterministic
 * signals (external id → domain → DUNS) resolve BEFORE fuzzy name matching; fuzzy matches are
 * lower confidence. Confidence thresholds gate the outcome: ≥0.95 auto, 0.75–0.95 review,
 * <0.75 unresolved. An unresolved/ambiguous identity must not silently score a Pursuit (§31) —
 * the caller receives companyId=null and a review row is opened.
 */

export type ResolutionMethod = "EXTERNAL_ID" | "DOMAIN" | "DUNS" | "VERIFIED_ALIAS" | "FUZZY_NAME";
export type ResolutionStatus = "AUTO_RESOLVED" | "REVIEW_REQUIRED" | "UNRESOLVED";

/**
 * `sourceOrgId` scopes external-id / alias lookups to a participating org's id space
 * (E3-G, §14/§30). An external account id means different companies in different orgs'
 * id spaces, so a lookup only ever considers this org's own aliases plus global /
 * first-party ones (source_org_id is null) — one org's mapping can never resolve
 * another org's signal onto the wrong company. Omit it for legacy first-party callers.
 */
export interface ResolveInput { orgId: string; sourceSystem: string; sourceOrgId?: string | null; externalId?: string | null; domain?: string | null; duns?: string | null; externalName?: string | null; }
export interface ResolveResult { companyId: string | null; method: ResolutionMethod | null; confidence: number; status: ResolutionStatus; }

const AUTO = 0.95, REVIEW = 0.75;

// Alias lookups consider THIS org's id space plus global (null) aliases, never another org's.
const SCOPE = `(source_org_id is null or source_org_id = $2)`;

export async function resolveCompany(db: PoolClient, input: ResolveInput): Promise<ResolveResult> {
  const scope = input.sourceOrgId ?? null;
  // 1) Deterministic: external id alias (scoped to the org id space).
  if (input.externalId) {
    const a = await db.query<{ company_id: string }>(
      `select company_id from company_aliases where alias = $1 and ${SCOPE} limit 1`, [input.externalId, scope]);
    if (a.rows[0]) return finalize(db, input, a.rows[0].company_id, "EXTERNAL_ID", 0.98);
  }
  // 2) Deterministic: domain.
  if (input.domain) {
    const d = await db.query<{ id: string }>(`select id from companies where primary_domain = $1 limit 1`, [input.domain]).catch(() => ({ rows: [] as { id: string }[] }));
    if (d.rows[0]) return finalize(db, input, d.rows[0].id, "DOMAIN", 0.97);
    const da = await db.query<{ company_id: string }>(
      `select company_id from company_aliases where alias_type='domain' and alias = $1 and ${SCOPE} limit 1`, [input.domain, scope]);
    if (da.rows[0]) return finalize(db, input, da.rows[0].company_id, "DOMAIN", 0.96);
  }
  // 3) Deterministic: DUNS.
  if (input.duns) {
    const dn = await db.query<{ id: string }>(`select id from companies where duns = $1 limit 1`, [input.duns]);
    if (dn.rows[0]) return finalize(db, input, dn.rows[0].id, "DUNS", 0.96);
  }
  // 4) Fuzzy name — lower confidence, gated.
  if (input.externalName) {
    const norm = normalizeCompanyName(input.externalName);
    const cands = await db.query<{ id: string; normalized_name: string | null; legal_name: string | null }>(
      `select id, normalized_name, legal_name from companies`,
    );
    let best: { id: string; sim: number } | null = null;
    for (const c of cands.rows) {
      const sim = nameSimilarity(norm, normalizeCompanyName(c.normalized_name ?? c.legal_name ?? ""));
      if (!best || sim > best.sim) best = { id: c.id, sim };
    }
    if (best && best.sim > 0) return finalize(db, input, best.id, "FUZZY_NAME", Math.min(0.94, best.sim));
  }
  await openReview(db, input, null, "FUZZY_NAME", 0, "UNRESOLVED");
  return { companyId: null, method: null, confidence: 0, status: "UNRESOLVED" };
}

async function finalize(db: PoolClient, input: ResolveInput, companyId: string, method: ResolutionMethod, confidence: number): Promise<ResolveResult> {
  if (confidence >= AUTO) return { companyId, method, confidence, status: "AUTO_RESOLVED" };
  if (confidence >= REVIEW) { await openReview(db, input, companyId, method, confidence, "REVIEW_REQUIRED"); return { companyId: null, method, confidence, status: "REVIEW_REQUIRED" }; }
  await openReview(db, input, companyId, method, confidence, "UNRESOLVED");
  return { companyId: null, method, confidence, status: "UNRESOLVED" };
}

async function openReview(db: PoolClient, input: ResolveInput, candidateId: string | null, method: ResolutionMethod, confidence: number, status: ResolutionStatus): Promise<void> {
  await db.query(
    `insert into entity_resolution_reviews (org_id, source_system, source_org_id, external_id, external_name, candidate_company_id, method, confidence, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [input.orgId, input.sourceSystem, input.sourceOrgId ?? null, input.externalId ?? null, input.externalName ?? null, candidateId, method, confidence, status],
  );
  await recordChange(db, {
    orgId: input.orgId, pursuitId: null, entityType: "company", entityId: candidateId,
    changeType: "ENTITY_RESOLUTION_REVIEW", materiality: "LOW",
    reason: `Entity resolution ${status} (${method}, ${confidence.toFixed(2)})`, actorType: "SYSTEM",
    triggerType: "CRM_SYNC", after: { method, confidence, status },
  });
}
