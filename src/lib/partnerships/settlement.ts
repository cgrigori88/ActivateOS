import type { Pool, PoolClient } from "pg";

type Db = Pool | PoolClient;

/**
 * Co-sell settlement ledger (task #75, Act II). One statement per
 * partnership, computed identically for both viewers — org names in the
 * payload, viewer-relative framing only at render.
 *
 * THE CONSENT RULE, stated plainly: an opportunity enters the statement only
 * if its account has a joint pursuit (active or closed) in THIS partnership.
 * Opening the room together IS the agreement to settle its outcome together;
 * everything else in either tenant's pipeline stays invisible. Attribution:
 *
 *   sourced     — a deal registration exists on the opportunity (the deal
 *                 came through the partner channel, protected effort)
 *   influenced  — jointly pursued, no registration
 *
 * Settled = closed_won, grouped by quarter. In-flight = open opportunities on
 * jointly pursued accounts (the partner is literally in the room working
 *  them). closed_lost is counted, not itemized — losses settle to zero but
 * hiding their existence would make the won-rate look better than it is.
 */

export interface SettlementEntry {
  closerOrgId: string; // whose tenant closed / holds the opportunity
  account: string;
  companyId: string;
  attribution: "sourced" | "influenced";
  amountUsd: number | null;
  stage: string;
  closedAt: string | null; // settled entries only
  quarter: string | null; // e.g. "2026 Q3"
}

export interface SettlementStatement {
  partnershipId: string;
  orgNames: Record<string, string>;
  settled: SettlementEntry[]; // closed_won, newest first
  inFlight: SettlementEntry[]; // open stages
  lostCount: Record<string, number>; // per closer org
  settledTotals: Record<string, number>; // per closer org, USD
}

function quarterOf(d: Date): string {
  return `${d.getUTCFullYear()} Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

export async function settlementStatement(db: Db, partnershipId: string): Promise<SettlementStatement> {
  const { rows: pRows } = await db.query<{ initiator_org_id: string; counterpart_org_id: string | null }>(
    `select initiator_org_id, counterpart_org_id from partnerships where id = $1`,
    [partnershipId],
  );
  if (!pRows[0]) throw new Error("Partnership not found.");
  const orgs = [pRows[0].initiator_org_id, pRows[0].counterpart_org_id].filter(Boolean) as string[];

  const { rows: nameRows } = await db.query<{ id: string; name: string }>(
    `select id, name from organizations where id = any($1)`,
    [orgs],
  );
  const orgNames = Object.fromEntries(nameRows.map((r) => [r.id, r.name]));

  // Deliberate cross-tenant read in system context (like overlap/broker):
  // both sides' opportunities, but ONLY on jointly pursued accounts of this
  // partnership — the consent boundary is the join, not a WHERE we might
  // forget. updated_at stands in for close date (stage transitions carry the
  // precise moment; the statement needs the quarter).
  const { rows } = await db.query<{
    org_id: string;
    company_id: string;
    legal_name: string;
    stage: string;
    amount_usd: string | null;
    updated_at: Date;
    registered: boolean;
  }>(
    `select o.org_id, o.company_id, c.legal_name, o.stage, o.amount_usd, o.updated_at,
            exists (select 1 from deal_registrations dr where dr.opportunity_id = o.id) as registered
     from joint_pursuits jp
     join opportunities o on o.company_id = jp.company_id and o.org_id = any($2)
     join companies c on c.id = o.company_id
     where jp.partnership_id = $1 and jp.status in ('active', 'closed')
     order by o.updated_at desc`,
    [partnershipId, orgs],
  );

  const settled: SettlementEntry[] = [];
  const inFlight: SettlementEntry[] = [];
  const lostCount: Record<string, number> = Object.fromEntries(orgs.map((o) => [o, 0]));
  const settledTotals: Record<string, number> = Object.fromEntries(orgs.map((o) => [o, 0]));

  for (const r of rows) {
    const entry: SettlementEntry = {
      closerOrgId: r.org_id,
      account: r.legal_name,
      companyId: r.company_id,
      attribution: r.registered ? "sourced" : "influenced",
      amountUsd: r.amount_usd == null ? null : Number(r.amount_usd),
      stage: r.stage,
      closedAt: r.stage === "closed_won" ? new Date(r.updated_at).toISOString().slice(0, 10) : null,
      quarter: r.stage === "closed_won" ? quarterOf(new Date(r.updated_at)) : null,
    };
    if (r.stage === "closed_won") {
      settled.push(entry);
      settledTotals[r.org_id] = (settledTotals[r.org_id] ?? 0) + (entry.amountUsd ?? 0);
    } else if (r.stage === "closed_lost") {
      lostCount[r.org_id] = (lostCount[r.org_id] ?? 0) + 1;
    } else {
      inFlight.push(entry);
    }
  }

  return { partnershipId, orgNames, settled, inFlight, lostCount, settledTotals };
}
