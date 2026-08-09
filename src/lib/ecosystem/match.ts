import type pg from "pg";
import {
  computePartnerFit,
  PARTNER_FIT_VERSION,
  type AccountContext,
  type PartnerProfile,
} from "./partner-fit";

/**
 * Ecosystem Match: for every account holding a propensity score on the
 * target solution, rank the partners who could pursue it and persist the
 * fits with their feature breakdowns. Capability is a hard gate — a partner
 * with no practice in the solution is never routed, however warm the
 * relationship.
 */
export async function matchPartners(
  db: pg.PoolClient,
  orgId: string,
  targetSlug: string,
): Promise<{ accounts: number; fits: number }> {
  const { rows: targetRows } = await db.query<{ id: string }>(
    `select id from taxonomy_nodes where slug = $1`,
    [targetSlug],
  );
  if (targetRows.length === 0) throw new Error(`unknown taxonomy node: ${targetSlug}`);
  const targetNodeId = targetRows[0].id;

  const { rows: partnerRows } = await db.query<{
    id: string;
    name: string;
    industries: string[];
    countries: string[];
  }>(`select id, name, industries, countries from partners where org_id = $1`, [orgId]);
  if (partnerRows.length === 0) return { accounts: 0, fits: 0 };

  const { rows: capRows } = await db.query<{ partner_id: string; slug: string; strength: string }>(
    `select pc.partner_id, n.slug, pc.strength
     from partner_capabilities pc join taxonomy_nodes n on n.id = pc.taxonomy_node_id
     where pc.partner_id = any($1)`,
    [partnerRows.map((p) => p.id)],
  );
  const capsByPartner = new Map<string, Map<string, number>>();
  for (const c of capRows) {
    const m = capsByPartner.get(c.partner_id) ?? new Map<string, number>();
    m.set(c.slug, Number(c.strength));
    capsByPartner.set(c.partner_id, m);
  }

  // Accounts to route: those with a current score for this solution.
  const { rows: accounts } = await db.query<{
    company_id: string;
    industry: string | null;
    country: string | null;
  }>(
    `select distinct on (p.company_id) p.company_id, c.industry, c.country
     from propensity_scores p join companies c on c.id = p.company_id
     where p.org_id = $1 and p.taxonomy_node_id = $2
     order by p.company_id, p.computed_at desc`,
    [orgId, targetNodeId],
  );

  let fits = 0;
  for (const acct of accounts) {
    const { rows: relRows } = await db.query<{
      partner_id: string;
      strength: string;
      tenure_months: number | null;
    }>(
      `select partner_id, strength, tenure_months from partner_relationships
       where company_id = $1 and partner_id = any($2)`,
      [acct.company_id, partnerRows.map((p) => p.id)],
    );
    const relByPartner = new Map(relRows.map((r) => [r.partner_id, r]));

    const { rows: sellerRows } = await db.query<{ partner_id: string; strength: string }>(
      `select s.partner_id, sar.strength
       from seller_account_relationships sar
       join sellers s on s.id = sar.seller_id
       where sar.company_id = $1 and s.partner_id = any($2)`,
      [acct.company_id, partnerRows.map((p) => p.id)],
    );
    const sellersByPartner = new Map<string, number[]>();
    for (const s of sellerRows) {
      const list = sellersByPartner.get(s.partner_id) ?? [];
      list.push(Number(s.strength));
      sellersByPartner.set(s.partner_id, list);
    }

    const context: AccountContext = { industry: acct.industry, country: acct.country };
    for (const p of partnerRows) {
      const profile: PartnerProfile = {
        partnerId: p.id,
        name: p.name,
        capabilities: capsByPartner.get(p.id) ?? new Map(),
        industries: p.industries,
        countries: p.countries,
        relationshipStrength: relByPartner.has(p.id)
          ? Number(relByPartner.get(p.id)!.strength)
          : null,
        tenureMonths: relByPartner.get(p.id)?.tenure_months ?? null,
        sellerStrengths: sellersByPartner.get(p.id) ?? [],
      };
      if ((profile.capabilities.get(targetSlug) ?? 0) <= 0) continue; // hard gate

      const fit = computePartnerFit(profile, context, targetSlug);
      const { rows: fitRows } = await db.query<{ id: string }>(
        `insert into partner_fit_scores (org_id, company_id, taxonomy_node_id, partner_id, score, band, version)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [orgId, acct.company_id, targetNodeId, p.id, fit.score.toFixed(2), fit.band, PARTNER_FIT_VERSION],
      );
      for (const f of fit.features) {
        await db.query(
          `insert into partner_fit_features (fit_id, feature, contribution, detail)
           values ($1, $2, $3, $4)`,
          [fitRows[0].id, f.feature, f.contribution.toFixed(3), fit.details.get(f.feature) ?? null],
        );
      }
      fits++;
    }
  }
  return { accounts: accounts.length, fits };
}
