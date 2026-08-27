import type { Pool, PoolClient } from "pg";

/**
 * Win/loss autopsy (slice E): a deterministic post-mortem assembled from the
 * record the moment a deal closes — no AI call, no opinions, just what
 * happened: how long it ran, how it moved, what touched it, which sources
 * fed it, who partnered on it. The learning loop's raw material, and the
 * narrative a rep would otherwise reconstruct from memory in the QBR.
 */

type Db = Pool | PoolClient;

export interface Autopsy {
  lines: string[];
  sources: { sourceType: string; claims: number }[];
}

export async function opportunityAutopsy(db: Db, orgId: string, opportunityId: string): Promise<Autopsy | null> {
  const { rows: opp } = await db.query<{
    id: string; name: string; stage: string; amount_usd: string | null;
    created_at: Date; closed_at: Date | null; company_id: string; legal_name: string;
    partner_name: string | null;
  }>(
    `select o.id, o.name, o.stage, o.amount_usd, o.created_at, o.closed_at,
            o.company_id, c.legal_name, pa.name as partner_name
     from opportunities o
     join companies c on c.id = o.company_id
     left join revenue_motions m on m.id = o.motion_id
     left join partners pa on pa.id = m.partner_id
     where o.id = $1`,
    [opportunityId],
  );
  const o = opp[0];
  if (!o || !o.stage.startsWith("closed")) return null;

  const lines: string[] = [];
  const won = o.stage === "closed_won";
  const days = o.closed_at
    ? Math.max(1, Math.round((o.closed_at.getTime() - o.created_at.getTime()) / 86_400_000))
    : null;
  lines.push(
    `${won ? "Won" : "Lost"}${o.amount_usd ? ` $${Math.round(Number(o.amount_usd) / 1000)}k` : ""}${days ? ` after ${days} day${days === 1 ? "" : "s"}` : ""}${o.partner_name ? ` — via ${o.partner_name}` : " — direct"}.`,
  );

  const { rows: hops } = await db.query<{ from_stage: string | null; to_stage: string }>(
    `select from_stage, to_stage from opportunity_stage_transitions
     where opportunity_id = $1 order by occurred_at`,
    [opportunityId],
  );
  if (hops.length) {
    const path = [hops[0].from_stage ?? "open", ...hops.map((h) => h.to_stage)].map((x) => x.replace(/_/g, " "));
    lines.push(`Path: ${path.join(" → ")}.`);
  }

  const { rows: comms } = await db.query<{ sends: string; replies: string }>(
    `select count(distinct t.id) filter (where t.status = 'sent') as sends,
            count(distinct ee.id) filter (where ee.event_type = 'REPLIED') as replies
     from campaign_touches t
     join campaigns ca on ca.id = t.campaign_id
     left join revenue_motions m on m.id = ca.motion_id
     left join email_events ee on ee.message_id = t.message_id and ee.event_type = 'REPLIED'
     where coalesce(ca.company_id, m.company_id) = $1`,
    [o.company_id],
  );
  const sends = Number(comms[0]?.sends ?? 0);
  const replies = Number(comms[0]?.replies ?? 0);
  const { rows: meets } = await db.query<{ n: string }>(
    `select count(*) as n from meeting_notes where company_id = $1 and org_id = $2`,
    [o.company_id, orgId],
  );
  const meetings = Number(meets[0]?.n ?? 0);
  const touchBits = [
    sends > 0 ? `${sends} touch${sends === 1 ? "" : "es"} sent` : null,
    replies > 0 ? `${replies} repl${replies === 1 ? "y" : "ies"}` : null,
    meetings > 0 ? `${meetings} meeting${meetings === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  if (touchBits.length) lines.push(`Contact: ${touchBits.join(", ")}.`);

  const { rows: srcs } = await db.query<{ source_type: string; n: string }>(
    `select source_type, count(*) as n from evidence
     where company_id = $1 and status = 'verified' and (org_id = $2 or org_id is null)
     group by source_type order by count(*) desc limit 6`,
    [o.company_id, orgId],
  );
  const sources = srcs.map((s) => ({ sourceType: s.source_type, claims: Number(s.n) }));
  if (sources.length) {
    lines.push(`Grounded by: ${sources.map((s) => `${s.sourceType} (${s.claims})`).join(", ")}.`);
  }

  return { lines, sources };
}

/**
 * Early-sample attribution: which evidence sources sat behind won vs lost
 * deals. Deliberately labeled by sample size — patterns firm up with volume,
 * and the honest framing is part of the feature.
 */
export async function sourceOutcomeAttribution(
  db: Db,
  orgId: string,
): Promise<{ sourceType: string; wonDeals: number; lostDeals: number }[]> {
  const { rows } = await db.query<{ source_type: string; won: string; lost: string }>(
    `select e.source_type,
            count(distinct o.id) filter (where o.stage = 'closed_won') as won,
            count(distinct o.id) filter (where o.stage = 'closed_lost') as lost
     from opportunities o
     join evidence e on e.company_id = o.company_id and e.status = 'verified'
       and (e.org_id = $1 or e.org_id is null)
     where o.stage in ('closed_won', 'closed_lost')
     group by e.source_type
     having count(distinct o.id) > 0
     order by count(distinct o.id) filter (where o.stage = 'closed_won') desc`,
    [orgId],
  );
  return rows.map((r) => ({ sourceType: r.source_type, wonDeals: Number(r.won), lostDeals: Number(r.lost) }));
}
