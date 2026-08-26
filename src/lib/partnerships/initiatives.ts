import type { Pool, PoolClient } from "pg";

/**
 * Initiatives (task #83) — the answer to the partner-plan document whose
 * initiatives table reads Target $10M / Won $0 forever. An initiative here is
 * a named target that real objects attach to (motions, campaigns,
 * opportunities), so progress is computed from the pipeline, never reported.
 *
 * Scoping: partner_id set = a joint initiative shown in that partner's room;
 * partner_id null = org-wide. Rollups only ever read this org's own records.
 */

type Db = Pool | PoolClient;

export type InitiativeRollup = {
  id: string;
  partnerId: string | null;
  name: string;
  description: string | null;
  targetUsd: number | null;
  periodLabel: string | null;
  status: "active" | "completed" | "archived";
  createdAt: string;
  motions: number;
  campaigns: number;
  openN: number;
  openUsd: number;   // registered: open opportunities attached
  wonN: number;
  wonUsd: number;
  lostN: number;
  lostUsd: number;
};

export async function listInitiatives(
  db: Db,
  orgId: string,
  opts: { partnerId?: string; includeArchived?: boolean } = {},
): Promise<InitiativeRollup[]> {
  const { rows } = await db.query(
    `select i.id, i.partner_id, i.name, i.description, i.target_usd, i.period_label, i.status, i.created_at,
            (select count(*) from revenue_motions m where m.initiative_id = i.id) as motions,
            (select count(*) from campaigns c where c.initiative_id = i.id) as campaigns,
            count(o.id) filter (where o.stage not in ('closed_won','closed_lost')) as open_n,
            coalesce(sum(o.amount_usd) filter (where o.stage not in ('closed_won','closed_lost')), 0) as open_usd,
            count(o.id) filter (where o.stage = 'closed_won') as won_n,
            coalesce(sum(o.amount_usd) filter (where o.stage = 'closed_won'), 0) as won_usd,
            count(o.id) filter (where o.stage = 'closed_lost') as lost_n,
            coalesce(sum(o.amount_usd) filter (where o.stage = 'closed_lost'), 0) as lost_usd
     from initiatives i
     left join opportunities o on o.initiative_id = i.id
     where i.org_id = $1
       and ($2::uuid is null or i.partner_id = $2)
       and ($3::boolean or i.status <> 'archived')
     group by i.id
     order by (i.status = 'active') desc, i.created_at desc`,
    [orgId, opts.partnerId ?? null, opts.includeArchived ?? false],
  );
  return rows.map((r) => ({
    id: r.id,
    partnerId: r.partner_id,
    name: r.name,
    description: r.description,
    targetUsd: r.target_usd == null ? null : Number(r.target_usd),
    periodLabel: r.period_label,
    status: r.status,
    createdAt: r.created_at,
    motions: Number(r.motions),
    campaigns: Number(r.campaigns),
    openN: Number(r.open_n),
    openUsd: Number(r.open_usd),
    wonN: Number(r.won_n),
    wonUsd: Number(r.won_usd),
    lostN: Number(r.lost_n),
    lostUsd: Number(r.lost_usd),
  }));
}

export async function createInitiative(
  db: Db,
  orgId: string,
  args: { partnerId: string | null; name: string; description?: string; targetUsd?: number | null; periodLabel?: string },
): Promise<{ id: string } | { error: string }> {
  const name = args.name.trim();
  if (!name) return { error: "Give the initiative a name." };
  const dup = await db.query(`select 1 from initiatives where org_id = $1 and lower(name) = lower($2)`, [orgId, name]);
  if (dup.rowCount) return { error: `An initiative named "${name}" already exists — attach work to it instead.` };
  const { rows } = await db.query(
    `insert into initiatives (org_id, partner_id, name, description, target_usd, period_label)
     values ($1, $2, $3, nullif($4, ''), $5, nullif($6, '')) returning id`,
    [orgId, args.partnerId, name.slice(0, 160), args.description ?? "", args.targetUsd ?? null, args.periodLabel ?? ""],
  );
  await db.query(
    `insert into audit_log (org_id, actor, event, detail)
     values ($1, 'operator', 'initiative.created', $2)`,
    [orgId, JSON.stringify({ name, target_usd: args.targetUsd ?? null, partner_id: args.partnerId })],
  );
  return { id: rows[0].id };
}

export async function setInitiativeStatus(
  db: Db,
  orgId: string,
  initiativeId: string,
  status: "active" | "completed" | "archived",
): Promise<void> {
  const { rows } = await db.query(
    `update initiatives set status = $3 where id = $1 and org_id = $2 returning name`,
    [initiativeId, orgId, status],
  );
  if (rows[0]) {
    await db.query(
      `insert into audit_log (org_id, actor, event, detail) values ($1, 'operator', $2, $3)`,
      [orgId, `initiative.${status}`, JSON.stringify({ name: rows[0].name })],
    );
  }
}

const LINKABLE = {
  opportunity: "opportunities",
  motion: "revenue_motions",
  campaign: "campaigns",
} as const;

export type LinkableKind = keyof typeof LINKABLE;

/** Attach or detach (initiativeId null) an object. Verifies both rows belong to the org. */
export async function assignInitiative(
  db: Db,
  orgId: string,
  kind: LinkableKind,
  objectId: string,
  initiativeId: string | null,
): Promise<void> {
  if (initiativeId) {
    const ok = await db.query(`select 1 from initiatives where id = $1 and org_id = $2`, [initiativeId, orgId]);
    if (!ok.rowCount) throw new Error("Unknown initiative.");
  }
  const table = LINKABLE[kind];
  await db.query(
    `update ${table} set initiative_id = $3 where id = $1 and org_id = $2`,
    [objectId, orgId, initiativeId],
  );
}

/** id → name map for labeling linked objects on list screens. */
export async function initiativeOptions(db: Db, orgId: string): Promise<{ id: string; name: string; partnerId: string | null }[]> {
  const { rows } = await db.query(
    `select id, name, partner_id from initiatives where org_id = $1 and status = 'active' order by name`,
    [orgId],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, partnerId: r.partner_id }));
}
