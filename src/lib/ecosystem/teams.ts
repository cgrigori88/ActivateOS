import type pg from "pg";
import { choosePartner, chooseSeller, type CapacityState, type RankedFit } from "./routing";

/**
 * Assemble pursuit teams for every scored account on a solution. Hot
 * accounts route first, so when a partner's capacity runs out it is the
 * colder accounts that fall to the next-best partner. Existing teams are
 * superseded, never deleted — the routing history stays auditable.
 */
export async function assemblePursuitTeams(
  db: pg.PoolClient,
  orgId: string,
  targetSlug: string,
): Promise<{ assembled: number; unchanged: number; unrouted: number }> {
  const { rows: targetRows } = await db.query<{ id: string }>(
    `select id from taxonomy_nodes where slug = $1`,
    [targetSlug],
  );
  if (targetRows.length === 0) throw new Error(`unknown taxonomy node: ${targetSlug}`);
  const targetNodeId = targetRows[0].id;

  // Latest fit per company × partner, plus the account's propensity for ordering.
  const { rows: fitRows } = await db.query<{
    company_id: string;
    partner_id: string;
    partner_name: string;
    fit_id: string;
    fit_score: string;
    propensity: string;
  }>(
    `with latest_fit as (
       select distinct on (f.company_id, f.partner_id)
         f.company_id, f.partner_id, f.id as fit_id, f.score as fit_score
       from partner_fit_scores f
       where f.org_id = $1 and f.taxonomy_node_id = $2
       order by f.company_id, f.partner_id, f.computed_at desc),
     latest_prop as (
       select distinct on (p.company_id) p.company_id, p.score
       from propensity_scores p
       where p.org_id = $1 and p.taxonomy_node_id = $2
       order by p.company_id, p.computed_at desc)
     select lf.company_id, lf.partner_id, pa.name as partner_name, lf.fit_id,
            lf.fit_score, lp.score as propensity
     from latest_fit lf
     join partners pa on pa.id = lf.partner_id
     join latest_prop lp on lp.company_id = lf.company_id
     order by lp.score desc, lf.fit_score desc`,
    [orgId, targetNodeId],
  );

  const byCompany = new Map<string, { propensity: number; fits: RankedFit[] }>();
  for (const r of fitRows) {
    const entry = byCompany.get(r.company_id) ?? { propensity: Number(r.propensity), fits: [] };
    entry.fits.push({
      partnerId: r.partner_id,
      partnerName: r.partner_name,
      fitId: r.fit_id,
      score: Number(r.fit_score),
    });
    byCompany.set(r.company_id, entry);
  }

  const { rows: partnerRows } = await db.query<{ id: string; capacity: number | null }>(
    `select id, capacity from partners where org_id = $1`,
    [orgId],
  );

  // Workload from pursuits OUTSIDE this assembly run's scope — the ones we
  // are about to re-decide must not count against their own partner.
  const { rows: activeRows } = await db.query<{ partner_id: string; n: string }>(
    `select partner_id, count(*) as n from pursuit_teams
     where org_id = $1 and status in ('recommended','accepted')
       and not (taxonomy_node_id = $2 and company_id = any($3))
     group by partner_id`,
    [orgId, targetNodeId, [...byCompany.keys()]],
  );
  const state: CapacityState = {
    active: new Map(activeRows.map((r) => [r.partner_id, Number(r.n)])),
    capacity: new Map(partnerRows.map((p) => [p.id, p.capacity])),
  };

  let assembled = 0;
  let unchanged = 0;
  let unrouted = 0;

  // Hot accounts first — they get first claim on scarce partner capacity.
  const companies = [...byCompany.entries()].sort((a, b) => b[1].propensity - a[1].propensity);
  for (const [companyId, { fits }] of companies) {
    const decision = choosePartner(
      fits.sort((a, b) => b.score - a.score),
      state,
    );

    const { rows: existing } = await db.query<{
      id: string;
      partner_id: string;
      seller_id: string | null;
    }>(
      `select id, partner_id, seller_id from pursuit_teams
       where org_id = $1 and company_id = $2 and taxonomy_node_id = $3
         and status in ('recommended','accepted')
       order by created_at desc limit 1`,
      [orgId, companyId, targetNodeId],
    );

    if (!decision.chosen) {
      unrouted++;
      if (existing.length > 0) {
        await db.query(
          `update pursuit_teams set status = 'superseded' where id = $1`,
          [existing[0].id],
        );
      }
      continue;
    }

    const { rows: sellerRows } = await db.query<{
      id: string;
      name: string;
      strength: string | null;
    }>(
      `select s.id, s.name, sar.strength
       from sellers s
       left join seller_account_relationships sar
         on sar.seller_id = s.id and sar.company_id = $2
       where s.partner_id = $1`,
      [decision.chosen.partnerId, companyId],
    );
    const seller = chooseSeller(
      sellerRows.map((s) => ({
        sellerId: s.id,
        name: s.name,
        relationshipStrength: s.strength == null ? null : Number(s.strength),
      })),
    );

    state.active.set(
      decision.chosen.partnerId,
      (state.active.get(decision.chosen.partnerId) ?? 0) + 1,
    );

    if (
      existing.length > 0 &&
      existing[0].partner_id === decision.chosen.partnerId &&
      existing[0].seller_id === (seller?.sellerId ?? null)
    ) {
      unchanged++;
      continue;
    }

    if (existing.length > 0) {
      await db.query(`update pursuit_teams set status = 'superseded' where id = $1`, [
        existing[0].id,
      ]);
    }
    const reason =
      `best fit (${decision.chosen.score.toFixed(0)}/100)` +
      (decision.skipped.length > 0
        ? `; skipped ${decision.skipped
            .map((s) => `${s.partnerName}: ${s.reason}`)
            .join(", ")}`
        : "");
    await db.query(
      `insert into pursuit_teams (org_id, company_id, taxonomy_node_id, partner_id, seller_id,
          partner_fit_id, status, reason)
       values ($1, $2, $3, $4, $5, $6, 'recommended', $7)`,
      [
        orgId,
        companyId,
        targetNodeId,
        decision.chosen.partnerId,
        seller?.sellerId ?? null,
        decision.chosen.fitId,
        reason,
      ],
    );
    assembled++;
  }
  return { assembled, unchanged, unrouted };
}
