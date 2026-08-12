import type pg from "pg";

/**
 * Partner hub (Phase 10). Everything the host org has built for one connected
 * partner, gathered by partner_id: their populations, and the motions,
 * campaigns, and pipeline attributed to that partnership. Data stays cleanly
 * scoped — a partner's lists/fields are theirs; motions/campaigns/opps belong
 * to a partner only when motion.partner_id points at them — so the main user
 * can orchestrate across partners without cross-contaminating their data.
 */

export interface PartnerHubData {
  populations: number;
  totalMotions: number;
  activeMotions: number;
  motions: { id: string; company: string; status: string }[];
  campaigns: { id: string; name: string; status: string; touches: number }[];
  opportunities: { id: string; name: string; stage: string; amount: number | null; company_id: string }[];
  pipelineUsd: number;
}

export async function partnerHub(
  db: pg.PoolClient,
  args: { orgId: string; partnerId: string },
): Promise<PartnerHubData> {
  const [pops, mCounts, motions, campaigns, opps, pipe] = await Promise.all([
    db.query<{ n: number }>(
      `select count(*)::int n from account_populations where org_id = $1 and partner_id = $2 and status = 'approved'`,
      [args.orgId, args.partnerId],
    ),
    db.query<{ total: number; active: number }>(
      `select count(*)::int total,
              count(*) filter (where status in ('active','approved'))::int active
       from revenue_motions where partner_id = $1`,
      [args.partnerId],
    ),
    db.query<{ id: string; company: string; status: string }>(
      `select m.id, c.legal_name as company, m.status
       from revenue_motions m join companies c on c.id = m.company_id
       where m.partner_id = $1 order by m.created_at desc limit 8`,
      [args.partnerId],
    ),
    db.query<{ id: string; name: string; status: string; touches: number }>(
      `select ca.id, ca.name, ca.status,
              (select count(*) from campaign_touches t where t.campaign_id = ca.id)::int as touches
       from campaigns ca join revenue_motions m on m.id = ca.motion_id
       where m.partner_id = $1 and ca.dismissed_at is null
       order by ca.created_at desc limit 8`,
      [args.partnerId],
    ),
    db.query<{ id: string; name: string; stage: string; amount_usd: string | null; company_id: string }>(
      `select o.id, o.name, o.stage, o.amount_usd, o.company_id
       from opportunities o join revenue_motions m on m.id = o.motion_id
       where m.partner_id = $1 and o.stage not in ('closed_won','closed_lost')
       order by o.updated_at desc limit 8`,
      [args.partnerId],
    ),
    db.query<{ usd: string }>(
      `select coalesce(sum(o.amount_usd), 0) as usd
       from opportunities o join revenue_motions m on m.id = o.motion_id
       where m.partner_id = $1 and o.stage not in ('closed_won','closed_lost')`,
      [args.partnerId],
    ),
  ]);

  return {
    populations: pops.rows[0]?.n ?? 0,
    totalMotions: mCounts.rows[0]?.total ?? 0,
    activeMotions: mCounts.rows[0]?.active ?? 0,
    motions: motions.rows,
    campaigns: campaigns.rows,
    opportunities: opps.rows.map((o) => ({
      id: o.id,
      name: o.name,
      stage: o.stage,
      amount: o.amount_usd == null ? null : Number(o.amount_usd),
      company_id: o.company_id,
    })),
    pipelineUsd: Number(pipe.rows[0]?.usd ?? 0),
  };
}
