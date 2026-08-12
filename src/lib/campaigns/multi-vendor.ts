import type { Pool, PoolClient } from "pg";

type Db = Pool | PoolClient;

/**
 * Multi-vendor campaign plays. When the SAME account is covered by two or more
 * partners with complementary roles (a reseller who owns the relationship, a
 * distributor who fulfills, an alliance that brings the technology), a joint
 * play usually beats three separate ones. This module:
 *  - suggests partner-combo plays from the live mappings (heuristic-grounded,
 *    so it runs in every environment; the ranking mirrors the AI recommend
 *    view's propensity+coverage boost)
 *  - creates the whole package in one action: named list → campaign → partners
 *    attached with roles
 *  - learns from outcomes: win rate on multi-partner-covered accounts vs
 *    single-partner, computed from closed opportunities
 */

export type PartnerRole = "lead" | "co_sell" | "fulfillment" | "distribution" | "technology";

/** A partner's default role in a joint play follows its type. Human-overridable. */
export function defaultRole(partnerType: string | null): PartnerRole {
  switch (partnerType) {
    case "reseller": return "lead";
    case "distributor": return "distribution";
    case "msp": return "fulfillment";
    case "alliance": return "technology";
    default: return "co_sell";
  }
}

export const ROLE_LABEL: Record<PartnerRole, string> = {
  lead: "Lead / owns relationship",
  co_sell: "Co-sell",
  fulfillment: "Fulfillment / delivery",
  distribution: "Distribution / supply",
  technology: "Technology",
};

export interface ComboPartner {
  id: string;
  name: string;
  type: string | null;
  role: PartnerRole;
}

export interface MultiVendorPlay {
  key: string; // sorted partner-id key
  partners: ComboPartner[];
  accounts: { companyId: string; name: string; score: number | null }[];
  avgScore: number | null;
  play: { name: string; objective: string | null; offer: string | null } | null;
  rationale: string;
}

/**
 * Suggest joint plays: group multi-partner overlap accounts by their exact
 * partner combo, rank combos by average best-propensity (plus a breadth nudge),
 * and attach the top-fit solution's active play.
 */
export async function suggestMultiVendorPlays(db: Db, orgId: string): Promise<MultiVendorPlay[]> {
  const { rows } = await db.query<{
    company_id: string;
    legal_name: string;
    partner_id: string;
    partner_name: string;
    partner_type: string | null;
    score: string | null;
  }>(
    `with covered as (
       select distinct pm.company_id, ap.partner_id
       from population_members pm
       join account_populations ap on ap.id = pm.population_id
         and ap.partner_id is not null and ap.status = 'approved' and ap.org_id = $1
     )
     select cv.company_id, c.legal_name, p.id as partner_id, p.name as partner_name, p.partner_type,
            (select max(ps.score) from propensity_scores ps where ps.company_id = cv.company_id) as score
     from covered cv
     join companies c on c.id = cv.company_id
     join partners p on p.id = cv.partner_id`,
    [orgId],
  );

  // Group accounts by exact partner combo (2+ partners only).
  const byCompany = new Map<string, { name: string; score: number | null; partners: ComboPartner[] }>();
  for (const r of rows) {
    const e = byCompany.get(r.company_id) ?? { name: r.legal_name, score: r.score == null ? null : Number(r.score), partners: [] };
    if (!e.partners.some((p) => p.id === r.partner_id)) {
      e.partners.push({ id: r.partner_id, name: r.partner_name, type: r.partner_type, role: defaultRole(r.partner_type) });
    }
    byCompany.set(r.company_id, e);
  }

  const combos = new Map<string, MultiVendorPlay>();
  for (const [companyId, e] of byCompany) {
    if (e.partners.length < 2) continue;
    const sorted = [...e.partners].sort((a, b) => a.id.localeCompare(b.id));
    const key = sorted.map((p) => p.id).join("+");
    const combo = combos.get(key) ?? { key, partners: sorted, accounts: [], avgScore: null, play: null, rationale: "" };
    combo.accounts.push({ companyId, name: e.name, score: e.score });
    combos.set(key, combo);
  }

  // Top-fit solution's active play (shared across combos — one query).
  const { rows: playRows } = await db.query<{ name: string; objective: string | null; offer: string | null; node_id: string }>(
    `select pt.name, pt.definition->>'objective' as objective, pt.definition->'cta'->>'offer' as offer, pt.taxonomy_node_id as node_id
     from play_templates pt where pt.status = 'active'`,
  );
  const { rows: topNode } = await db.query<{ node_id: string }>(
    `select taxonomy_node_id as node_id from propensity_scores
     group by taxonomy_node_id order by avg(score) desc nulls last limit 1`,
  );
  const play = playRows.find((p) => p.node_id === topNode[0]?.node_id) ?? playRows[0] ?? null;

  const out = [...combos.values()].map((c) => {
    const scores = c.accounts.map((a) => a.score).filter((s): s is number => s != null);
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    c.accounts.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    const roles = c.partners.map((p) => `${p.name} (${p.role.replace(/_/g, "-")})`).join(" + ");
    return {
      ...c,
      avgScore: avg,
      play: play ? { name: play.name, objective: play.objective, offer: play.offer } : null,
      rationale: `${c.accounts.length} shared account${c.accounts.length === 1 ? "" : "s"}${avg != null ? ` · avg fit ${avg}` : ""} · ${roles}`,
    };
  });
  // Rank: avg fit + breadth nudge — same spirit as crossPartnerOpportunities.
  return out.sort((a, b) => (b.avgScore ?? 0) + b.accounts.length * 4 - ((a.avgScore ?? 0) + a.accounts.length * 4));
}

/**
 * Learned signal: do multi-partner-covered accounts actually win more? Computed
 * from closed opportunities × how many partners covered the account. Every close
 * sharpens this — it's the learning loop for joint plays.
 */
export async function coverageWinRates(db: Db, orgId: string): Promise<{ bucket: string; closed: number; won: number; rate: number }[]> {
  const { rows } = await db.query<{ bucket: string; closed: string; won: string }>(
    `with coverage as (
       select pm.company_id, count(distinct ap.partner_id) as n
       from population_members pm
       join account_populations ap on ap.id = pm.population_id
         and ap.partner_id is not null and ap.status = 'approved' and ap.org_id = $1
       group by pm.company_id
     )
     select case when coalesce(cv.n, 0) >= 2 then 'multi_partner'
                 when coalesce(cv.n, 0) = 1 then 'single_partner'
                 else 'uncovered' end as bucket,
            count(*) as closed,
            count(*) filter (where o.stage = 'closed_won') as won
     from opportunities o
     left join coverage cv on cv.company_id = o.company_id
     where o.stage in ('closed_won','closed_lost')
     group by 1`,
    [orgId],
  );
  const order = ["multi_partner", "single_partner", "uncovered"];
  return rows
    .map((r) => ({ bucket: r.bucket, closed: Number(r.closed), won: Number(r.won), rate: Number(r.closed) ? Math.round((Number(r.won) / Number(r.closed)) * 100) : 0 }))
    .sort((a, b) => order.indexOf(a.bucket) - order.indexOf(b.bucket));
}

/**
 * One action, whole package: an approved NAMED target list from the combo's
 * accounts, a campaign linked to that list, and every partner attached with its
 * role. The campaign lands as a draft — touches, personalization and launch stay
 * human-gated as everywhere else.
 */
export async function createMultiVendorCampaign(
  db: Db,
  args: {
    orgId: string;
    name: string;
    companyIds: string[];
    partners: { id: string; role: PartnerRole }[];
  },
): Promise<{ campaignId: string }> {
  const { rows: pop } = await db.query<{ id: string }>(
    `insert into account_populations (org_id, name, category, status, created_by)
     values ($1, $2, 'target', 'approved', 'multi_vendor_play') returning id`,
    [args.orgId, args.name],
  );
  await db.query(
    `insert into population_members (population_id, company_id)
     select $1, unnest($2::uuid[]) on conflict do nothing`,
    [pop[0].id, args.companyIds],
  );

  // Seed account = the list's best-scoring member (reach comes from the list).
  const { rows: seed } = await db.query<{ company_id: string }>(
    `select pm.company_id from population_members pm
     left join lateral (select max(score) as s from propensity_scores ps where ps.company_id = pm.company_id) sc on true
     where pm.population_id = $1 order by sc.s desc nulls last limit 1`,
    [pop[0].id],
  );

  const { rows: ca } = await db.query<{ id: string }>(
    `insert into campaigns (org_id, company_id, name, status, source)
     values ($1, $2, $3, 'draft', 'user') returning id`,
    [args.orgId, seed[0]?.company_id ?? args.companyIds[0], args.name],
  );
  const campaignId = ca[0].id;

  await db.query(
    `insert into campaign_populations (campaign_id, population_id, added_by) values ($1, $2, 'multi_vendor_play')`,
    [campaignId, pop[0].id],
  );
  for (const p of args.partners) {
    await db.query(
      `insert into campaign_partners (campaign_id, partner_id, role) values ($1, $2, $3) on conflict do nothing`,
      [campaignId, p.id, p.role],
    );
  }
  return { campaignId };
}
