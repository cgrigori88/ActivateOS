import type { Pool } from "pg";
import { partnerHub, type PartnerHubData } from "@/lib/mapping/partner-hub";
import { overlapLadder, type OverlapLadder } from "@/lib/partnerships/overlap";
import { listJointPursuits, type PursuitView } from "@/lib/partnerships/joint";
import { settlementStatement, type SettlementStatement } from "@/lib/partnerships/settlement";

/**
 * Partner Hub (B+1, PLATFORM-REVIEW-2 §III.A). "Partner" was smeared across
 * five rooms; this is the one room where you WORK a partner: their book, the
 * trust ladder, shared lists, joint rooms, the settlement statement, and a
 * scorecard computed from settlement truth — not self-reporting. Admin keeps
 * governance (deciding probes/grants); the hub reads and links.
 *
 * The partner⇄partnership binding: an invite is bound to one of your partner
 * records (initiator_partner_id), and redeeming binds the counterpart's
 * record (counterpart_partner_id). One partner, at most one live partnership.
 */

export interface PartnerIndexRow {
  id: string;
  name: string;
  partnerType: string | null;
  industries: string[] | null;
  bookLists: number;
  bookAccounts: number;
  partnershipStatus: "invited" | "active" | "revoked" | null;
  otherOrgName: string | null;
  openPursuits: number;
  settledUsd: number;
  motionsActive: number;
  motionsWon: number;
}

export async function listPartnerRooms(db: Pool, orgId: string): Promise<PartnerIndexRow[]> {
  const { rows } = await db.query<{
    id: string; name: string; partner_type: string | null; industries: string[] | null;
    book_lists: string; book_accounts: string;
    partnership_status: PartnerIndexRow["partnershipStatus"]; other_org_name: string | null;
    open_pursuits: string; settled_usd: string; motions_active: string; motions_won: string;
  }>(
    `select pa.id, pa.name, pa.partner_type, pa.industries,
            (select count(*) from account_populations ap
             where ap.org_id = $1 and ap.partner_id = pa.id and ap.status = 'approved') as book_lists,
            (select count(distinct pm.company_id)
             from population_members pm
             join account_populations ap on ap.id = pm.population_id
             where ap.org_id = $1 and ap.partner_id = pa.id and ap.status = 'approved') as book_accounts,
            ps.status as partnership_status, ps.other_org_name,
            coalesce(ps.open_pursuits, '0') as open_pursuits,
            coalesce(ps.settled_usd, '0') as settled_usd,
            (select count(*) from revenue_motions m
             where m.partner_id = pa.id and m.status in ('approved', 'active')) as motions_active,
            (select count(*) from revenue_motions m
             where m.partner_id = pa.id and m.outcome = 'won') as motions_won
     from partners pa
     left join lateral (
       select p.status,
              (select o.name from organizations o
               where o.id = case when p.initiator_org_id = $1 then p.counterpart_org_id else p.initiator_org_id end) as other_org_name,
              (select count(*) from joint_pursuits jp
               where jp.partnership_id = p.id and jp.status = 'active')::text as open_pursuits,
              -- Settlement consent rule inlined: closed_won on jointly pursued accounts only.
              (select coalesce(sum(o2.amount_usd), 0)
               from joint_pursuits jp
               join opportunities o2 on o2.company_id = jp.company_id
               where jp.partnership_id = p.id and jp.status in ('active', 'closed')
                 and o2.stage = 'closed_won'
                 and o2.org_id in (p.initiator_org_id, p.counterpart_org_id))::text as settled_usd
       from partnerships p
       where (p.initiator_org_id = $1 and p.initiator_partner_id = pa.id)
          or (p.counterpart_org_id = $1 and p.counterpart_partner_id = pa.id)
       order by (p.status = 'active') desc, p.created_at desc
       limit 1
     ) ps on true
     where pa.org_id = $1
     order by (ps.status = 'active') desc nulls last, pa.name asc`,
    [orgId],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    partnerType: r.partner_type,
    industries: r.industries,
    bookLists: Number(r.book_lists),
    bookAccounts: Number(r.book_accounts),
    partnershipStatus: r.partnership_status,
    otherOrgName: r.other_org_name,
    openPursuits: Number(r.open_pursuits),
    settledUsd: Number(r.settled_usd),
    motionsActive: Number(r.motions_active),
    motionsWon: Number(r.motions_won),
  }));
}

export interface PartnerScorecard {
  /** Joint deals from settlement truth: settled vs lost, both orgs combined. */
  settledN: number;
  lostN: number;
  jointWinRate: number | null; // 0..100
  sourcedUsd: number;
  influencedUsd: number;
  /** Average days from opportunity open to closed_won on jointly pursued accounts. */
  avgCycleDays: number | null;
  /** Average days a pursuit proposal waited for a decision (either side). */
  responsivenessDays: number | null;
  /** Own-tenant motion outcomes with this partner (no partnership required). */
  motionsWon: number;
  motionsLost: number;
  motionWinRate: number | null; // 0..100
}

export interface PartnerRoomData {
  partner: {
    id: string;
    name: string;
    partnerType: string | null;
    industries: string[] | null;
    countries: string[] | null;
  };
  hub: PartnerHubData;
  book: { id: string; name: string; category: string; status: string; members: number }[];
  partnership: {
    id: string;
    status: "invited" | "active" | "revoked";
    role: "initiator" | "counterpart";
    otherOrgName: string | null;
    activatedAt: string | null;
  } | null;
  ladder: OverlapLadder | null;
  grants: { id: string; direction: "outgoing" | "incoming"; listName: string; status: string }[];
  pursuits: PursuitView[];
  settlement: SettlementStatement | null;
  scorecard: PartnerScorecard;
}

export async function partnerRoom(db: Pool, orgId: string, partnerId: string): Promise<PartnerRoomData | null> {
  const { rows: pRows } = await db.query<{
    id: string; name: string; partner_type: string | null;
    industries: string[] | null; countries: string[] | null;
  }>(
    `select id, name, partner_type, industries, countries from partners where id = $1 and org_id = $2`,
    [partnerId, orgId],
  );
  if (!pRows[0]) return null;
  const partner = {
    id: pRows[0].id,
    name: pRows[0].name,
    partnerType: pRows[0].partner_type,
    industries: pRows[0].industries,
    countries: pRows[0].countries,
  };

  // partnerHub wants one checked-out client (sequential on purpose).
  const client = await db.connect();
  let hub: PartnerHubData;
  try {
    hub = await partnerHub(client, { orgId, partnerId });
  } finally {
    client.release();
  }

  const { rows: book } = await db.query<{ id: string; name: string; category: string; status: string; members: string }>(
    `select ap.id, ap.name, ap.category, ap.status,
            (select count(*) from population_members pm where pm.population_id = ap.id) as members
     from account_populations ap
     where ap.org_id = $1 and ap.partner_id = $2 and ap.status in ('pending', 'approved')
     order by ap.status asc, ap.created_at desc`,
    [orgId, partnerId],
  );

  const { rows: shipRows } = await db.query<{
    id: string; status: "invited" | "active" | "revoked"; initiator_org_id: string;
    other_org_name: string | null; activated_at: Date | null;
  }>(
    `select p.id, p.status, p.initiator_org_id, p.activated_at,
            (select o.name from organizations o
             where o.id = case when p.initiator_org_id = $1 then p.counterpart_org_id else p.initiator_org_id end) as other_org_name
     from partnerships p
     where (p.initiator_org_id = $1 and p.initiator_partner_id = $2)
        or (p.counterpart_org_id = $1 and p.counterpart_partner_id = $2)
     order by (p.status = 'active') desc, p.created_at desc
     limit 1`,
    [orgId, partnerId],
  );
  const ship = shipRows[0];
  const partnership = ship
    ? {
        id: ship.id,
        status: ship.status,
        role: (ship.initiator_org_id === orgId ? "initiator" : "counterpart") as "initiator" | "counterpart",
        otherOrgName: ship.other_org_name,
        activatedAt: ship.activated_at ? new Date(ship.activated_at).toISOString().slice(0, 10) : null,
      }
    : null;

  let ladder: OverlapLadder | null = null;
  let grants: PartnerRoomData["grants"] = [];
  let pursuits: PursuitView[] = [];
  let settlement: SettlementStatement | null = null;

  if (partnership && partnership.status === "active") {
    ladder = await overlapLadder(db, orgId, partnership.id);
    const { rows: gRows } = await db.query<{ id: string; from_org_id: string; list_name: string; status: string }>(
      `select g.id, g.from_org_id, ap.name as list_name, g.status
       from list_grants g join account_populations ap on ap.id = g.population_id
       where g.partnership_id = $1
       order by g.created_at desc`,
      [partnership.id],
    );
    grants = gRows.map((g) => ({
      id: g.id,
      direction: g.from_org_id === orgId ? ("outgoing" as const) : ("incoming" as const),
      listName: g.list_name,
      status: g.status,
    }));
    pursuits = (await listJointPursuits(db, orgId)).filter((x) => x.partnershipId === partnership.id);
    if (pursuits.some((x) => x.status === "active" || x.status === "closed")) {
      settlement = await settlementStatement(db, partnership.id);
    }
  }

  // ── Scorecard v1: settlement truth + own-motion outcomes ──
  const settledN = settlement?.settled.length ?? 0;
  const lostN = settlement ? Object.values(settlement.lostCount).reduce((a, b) => a + b, 0) : 0;
  const sourcedUsd = settlement
    ? settlement.settled.filter((e) => e.attribution === "sourced").reduce((s, e) => s + (e.amountUsd ?? 0), 0)
    : 0;
  const influencedUsd = settlement
    ? settlement.settled.filter((e) => e.attribution === "influenced").reduce((s, e) => s + (e.amountUsd ?? 0), 0)
    : 0;

  let avgCycleDays: number | null = null;
  let responsivenessDays: number | null = null;
  if (partnership && partnership.status === "active") {
    const { rows: cyc } = await db.query<{ days: string | null }>(
      `select avg(extract(epoch from (coalesce(o.closed_at, o.updated_at) - o.created_at)) / 86400)::text as days
       from joint_pursuits jp
       join partnerships p on p.id = jp.partnership_id
       join opportunities o on o.company_id = jp.company_id
         and o.org_id in (p.initiator_org_id, p.counterpart_org_id)
       where jp.partnership_id = $1 and jp.status in ('active', 'closed') and o.stage = 'closed_won'`,
      [partnership.id],
    );
    avgCycleDays = cyc[0]?.days == null ? null : Math.round(Number(cyc[0].days));
    const { rows: resp } = await db.query<{ days: string | null }>(
      `select avg(extract(epoch from (decided_at - created_at)) / 86400)::text as days
       from joint_pursuits where partnership_id = $1 and decided_at is not null`,
      [partnership.id],
    );
    responsivenessDays = resp[0]?.days == null ? null : Math.round(Number(resp[0].days) * 10) / 10;
  }

  const { rows: mo } = await db.query<{ won: string; lost: string }>(
    `select count(*) filter (where outcome = 'won') as won,
            count(*) filter (where outcome = 'lost') as lost
     from revenue_motions where partner_id = $1`,
    [partnerId],
  );
  const motionsWon = Number(mo[0]?.won ?? 0);
  const motionsLost = Number(mo[0]?.lost ?? 0);

  const scorecard: PartnerScorecard = {
    settledN,
    lostN,
    jointWinRate: settledN + lostN > 0 ? Math.round((settledN / (settledN + lostN)) * 100) : null,
    sourcedUsd,
    influencedUsd,
    avgCycleDays,
    responsivenessDays,
    motionsWon,
    motionsLost,
    motionWinRate: motionsWon + motionsLost > 0 ? Math.round((motionsWon / (motionsWon + motionsLost)) * 100) : null,
  };

  return {
    partner,
    hub,
    book: book.map((l) => ({ ...l, members: Number(l.members) })),
    partnership,
    ladder,
    grants,
    pursuits,
    settlement,
    scorecard,
  };
}
