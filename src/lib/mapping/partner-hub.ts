import type pg from "pg";

/**
 * Partner hub (Phase 10). Aggregate rollups for one connected partner — or,
 * when partnerId is null, across ALL connected partners. Returns totals only
 * (no per-record lists) so it stays useful at tens of thousands of accounts.
 * Data stays cleanly scoped: motions/campaigns/pipeline attach to a partner via
 * motion.partner_id; a partner's populations are theirs.
 */

export interface PartnerHubData {
  populations: number;
  motionsTotal: number;
  motionsActive: number;
  campaignsTotal: number;
  campaignsLive: number; // launched or completed
  touchesSent: number;
  oppsOpen: number;
  pipelineUsd: number;
  oppsWon: number;
  wonUsd: number;
}

export async function partnerHub(
  db: pg.PoolClient,
  args: { orgId: string; partnerId: string | null },
): Promise<PartnerHubData> {
  /* Sequential on purpose: these five run on ONE checked-out client, and
     parallel query() calls on a shared client are deprecated (removed in
     pg@9) — they only queue anyway. Fanning out over separate connections
     would spend pool slots we can't spare on serverless. */
  const pops = await db.query<{ n: number }>(
      `select count(*)::int n from account_populations
       where org_id = $1 and partner_id is not null and ($2::uuid is null or partner_id = $2) and status = 'approved'`,
    [args.orgId, args.partnerId],
  );
  const motions = await db.query<{ total: number; active: number }>(
      `select count(*)::int total,
              count(*) filter (where status in ('active','approved'))::int active
       from revenue_motions
       where partner_id is not null and ($1::uuid is null or partner_id = $1)`,
    [args.partnerId],
  );
  const campaigns = await db.query<{ total: number; live: number }>(
      `select count(*)::int total,
              count(*) filter (where ca.status in ('launched','completed'))::int live
       from campaigns ca join revenue_motions m on m.id = ca.motion_id
       where m.partner_id is not null and ($1::uuid is null or m.partner_id = $1) and ca.dismissed_at is null`,
    [args.partnerId],
  );
  const touches = await db.query<{ sent: number }>(
      `select count(*)::int sent
       from campaign_touches t
       join campaigns ca on ca.id = t.campaign_id
       join revenue_motions m on m.id = ca.motion_id
       where t.status = 'sent' and m.partner_id is not null and ($1::uuid is null or m.partner_id = $1)`,
    [args.partnerId],
  );
  const opps = await db.query<{ open_n: number; open_usd: string; won_n: number; won_usd: string }>(
      `select
         count(*) filter (where o.stage not in ('closed_won','closed_lost'))::int as open_n,
         coalesce(sum(o.amount_usd) filter (where o.stage not in ('closed_won','closed_lost')), 0) as open_usd,
         count(*) filter (where o.stage = 'closed_won')::int as won_n,
         coalesce(sum(o.amount_usd) filter (where o.stage = 'closed_won'), 0) as won_usd
       from opportunities o join revenue_motions m on m.id = o.motion_id
       where m.partner_id is not null and ($1::uuid is null or m.partner_id = $1)`,
    [args.partnerId],
  );

  return {
    populations: pops.rows[0]?.n ?? 0,
    motionsTotal: motions.rows[0]?.total ?? 0,
    motionsActive: motions.rows[0]?.active ?? 0,
    campaignsTotal: campaigns.rows[0]?.total ?? 0,
    campaignsLive: campaigns.rows[0]?.live ?? 0,
    touchesSent: touches.rows[0]?.sent ?? 0,
    oppsOpen: opps.rows[0]?.open_n ?? 0,
    pipelineUsd: Number(opps.rows[0]?.open_usd ?? 0),
    oppsWon: opps.rows[0]?.won_n ?? 0,
    wonUsd: Number(opps.rows[0]?.won_usd ?? 0),
  };
}
