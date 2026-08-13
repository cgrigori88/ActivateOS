import type pg from "pg";
import { CATEGORY_LABEL, type Category } from "./populations";

/**
 * Cross-partner learning (Phase 10 / request #49). Reads every account across
 * every connected partner — the org's populations, all partners' populations,
 * propensity, and multi-partner coverage — and turns it into better targeting:
 * a ranked co-sell opportunity list and suggested target populations. The
 * ranking is deterministic (works without AI); AI motion drafting layers on top
 * per account.
 *
 * The insight partners can't see on their own: an account covered by MORE of
 * your partners, at HIGH propensity, is the strongest co-sell — that signal
 * only exists once every partner's mapping is consolidated here.
 */

export interface CrossPartnerAccount {
  companyId: string;
  name: string;
  industry: string | null;
  score: number | null;
  band: string | null;
  isCustomer: boolean;
  partnerCount: number;
  partners: string[];
  segments: string[]; // partner population categories (verticals/territories/…)
  hasMotion: boolean;
  motion: "cross-sell / upsell" | "net-new";
  rank: number; // propensity + multi-partner coverage boost
}

export async function crossPartnerOpportunities(db: pg.PoolClient, orgId: string): Promise<CrossPartnerAccount[]> {
  const { rows } = await db.query<{
    company_id: string;
    legal_name: string;
    industry: string | null;
    is_customer: boolean;
    partner_count: number;
    partner_names: string[];
    partner_cats: Category[];
    score: string | null;
    band: string | null;
    has_motion: boolean;
  }>(
    `with org_pop as (
       select pm.company_id, bool_or(ap.category = 'customer') as is_customer
       from population_members pm
       join account_populations ap on ap.id = pm.population_id
       where ap.partner_id is null and ap.status = 'approved' and ap.org_id = $1
       group by pm.company_id
     ),
     partner_cov as (
       select pm.company_id,
              count(distinct ap.partner_id)::int as partner_count,
              array_agg(distinct p.name) as partner_names,
              array_agg(distinct ap.category) as partner_cats
       from population_members pm
       join account_populations ap on ap.id = pm.population_id
         and ap.partner_id is not null and ap.status = 'approved' and ap.org_id = $1
       join partners p on p.id = ap.partner_id
       group by pm.company_id
     )
     select c.id as company_id, c.legal_name, c.industry,
            op.is_customer, pc.partner_count, pc.partner_names, pc.partner_cats,
            ps.score, ps.band,
            exists (select 1 from revenue_motions m where m.company_id = c.id) as has_motion
     from partner_cov pc
     join org_pop op on op.company_id = pc.company_id
     join companies c on c.id = pc.company_id
     left join lateral (
       select score, band from propensity_scores p where p.company_id = c.id order by computed_at desc limit 1
     ) ps on true`,
    [orgId],
  );

  const accounts: CrossPartnerAccount[] = rows.map((r) => {
    const score = r.score == null ? null : Number(r.score);
    return {
      companyId: r.company_id,
      name: r.legal_name,
      industry: r.industry,
      score,
      band: r.band,
      isCustomer: r.is_customer,
      partnerCount: r.partner_count,
      partners: r.partner_names ?? [],
      segments: (r.partner_cats ?? []).map((c) => CATEGORY_LABEL[c] ?? c),
      hasMotion: r.has_motion,
      motion: r.is_customer ? "cross-sell / upsell" : "net-new",
      // Multi-partner coverage is a real co-sell amplifier — weight it into rank.
      rank: (score ?? 0) + (r.partner_count - 1) * 8,
    };
  });
  accounts.sort((a, b) => b.rank - a.rank);
  return accounts;
}

export interface TargetBucket {
  key: string;
  name: string;
  rationale: string;
  companyIds: string[];
}

/** Deterministic target-list suggestions from the cross-partner picture. */
export function suggestedTargetLists(accounts: CrossPartnerAccount[]): TargetBucket[] {
  const hot = accounts.filter((a) => (a.band === "high" || a.band === "very_high") && a.partnerCount >= 2);
  const whitespace = accounts.filter((a) => !a.isCustomer && ((a.score ?? 0) >= 50 || a.band === "high" || a.band === "very_high"));
  const expand = accounts.filter((a) => a.isCustomer);

  const buckets: TargetBucket[] = [
    { key: "hot", name: "Hot multi-partner accounts", rationale: "High propensity and covered by 2+ partners — the strongest co-sell.", companyIds: hot.map((a) => a.companyId) },
    { key: "whitespace", name: "Net-new whitespace", rationale: "Not yet your customer, decent propensity, mapped by a partner.", companyIds: whitespace.map((a) => a.companyId) },
    { key: "expand", name: "Cross-sell / expand installed base", rationale: "Existing customers a partner is also working — land-and-expand.", companyIds: expand.map((a) => a.companyId) },
  ];
  return buckets.filter((b) => b.companyIds.length > 0);
}

/** Create an approved org-side 'target' population from a set of companies. */
export async function createTargetFromCompanies(
  db: pg.PoolClient,
  args: { orgId: string | null; name: string; companyIds: string[]; createdBy?: string },
): Promise<{ populationId: string; added: number }> {
  const { rows } = await db.query<{ id: string }>(
    `insert into account_populations (org_id, partner_id, name, category, status, created_by)
     values ($1, null, $2, 'target', 'approved', $3) returning id`,
    [args.orgId, args.name, args.createdBy ?? "ai"],
  );
  const populationId = rows[0].id;
  if (args.companyIds.length === 0) return { populationId, added: 0 };
  const res = await db.query(
    `insert into population_members (population_id, company_id)
     select $1, unnest($2::uuid[]) on conflict do nothing`,
    [populationId, args.companyIds],
  );
  return { populationId, added: res.rowCount ?? 0 };
}
