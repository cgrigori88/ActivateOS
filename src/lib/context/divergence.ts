import type { Pool, PoolClient } from "pg";

type Db = Pool | PoolClient;

/**
 * Reality-divergence detection (task #83): deterministic rules that surface
 * where the systems disagree with each other — or with the partner's side.
 * Each finding names BOTH records that conflict; no AI, no scores, just the
 * receipts. The cross-company rules are the ones a single-tenant "revenue
 * context" product structurally cannot run.
 */

export interface Divergence {
  kind: "stale_deal" | "stage_vs_engagement" | "joint_vs_pipeline" | "renewal_uncovered" | "motion_stalled";
  companyId: string;
  account: string;
  text: string;
  href: string;
}

export async function accountDivergences(db: Db, orgId: string, limit = 12): Promise<Divergence[]> {
  const out: Divergence[] = [];

  // 1. Stale deal: open in the pipeline, untouched for 21+ days.
  const { rows: stale } = await db.query<{ company_id: string; legal_name: string; name: string; days: string }>(
    `select o.company_id, c.legal_name, o.name,
            extract(day from now() - o.updated_at)::int::text as days
     from opportunities o join companies c on c.id = o.company_id
     where o.stage not in ('closed_won', 'closed_lost') and ($1::uuid is null or o.org_id = $1)
       and o.updated_at < now() - interval '21 days'
     order by o.updated_at asc limit 5`,
    [orgId],
  );
  for (const r of stale) {
    out.push({
      kind: "stale_deal",
      companyId: r.company_id,
      account: r.legal_name,
      text: `"${r.name}" is open in the pipeline but untouched for ${r.days} days — the record and the deal have parted ways.`,
      href: "/pipeline",
    });
  }

  // 2. Late stage, silent engagement: the pipeline believes, the inbox doesn't.
  const { rows: silent } = await db.query<{ company_id: string; legal_name: string; name: string; stage: string }>(
    `select o.company_id, c.legal_name, o.name, o.stage
     from opportunities o join companies c on c.id = o.company_id
     where o.stage in ('proposal', 'negotiation') and ($1::uuid is null or o.org_id = $1)
       and not exists (select 1 from engagement_scores es
                       where es.company_id = o.company_id
                         and es.last_engaged_at > now() - interval '30 days')
     limit 5`,
    [orgId],
  );
  for (const r of silent) {
    out.push({
      kind: "stage_vs_engagement",
      companyId: r.company_id,
      account: r.legal_name,
      text: `"${r.name}" sits at ${r.stage.replace(/_/g, " ")} but engagement has been silent 30+ days — late-stage on paper, quiet in reality.`,
      href: `/accounts/${r.company_id}`,
    });
  }

  // 3. CROSS-COMPANY: the joint room is live, your pipeline is empty. The
  //    partner fabric says this deal is being worked; your own systems don't.
  const { rows: roomOnly } = await db.query<{ company_id: string; legal_name: string; pursuit_id: string }>(
    `select jp.company_id, c.legal_name, jp.id as pursuit_id
     from joint_pursuits jp
     join partnerships p on p.id = jp.partnership_id
     join companies c on c.id = jp.company_id
     where jp.status = 'active' and (p.initiator_org_id = $1 or p.counterpart_org_id = $1)
       and not exists (select 1 from opportunities o
                       where o.company_id = jp.company_id and o.org_id = $1
                         and o.stage not in ('closed_won', 'closed_lost'))
     limit 5`,
    [orgId],
  );
  for (const r of roomOnly) {
    out.push({
      kind: "joint_vs_pipeline",
      companyId: r.company_id,
      account: r.legal_name,
      text: `The joint room with your partner is active, but your pipeline holds no open opportunity here — the two sides of this deal disagree.`,
      href: `/joint/${r.pursuit_id}`,
    });
  }

  // 4. Renewal on the clock, nothing covering it.
  const { rows: uncovered } = await db.query<{ company_id: string; legal_name: string; renewal: string }>(
    `select distinct on (pm.company_id) pm.company_id, c.legal_name, pm.attributes->>'renewal_date' as renewal
     from population_members pm
     join account_populations ap on ap.id = pm.population_id and ap.org_id = $1 and ap.status = 'approved'
     join companies c on c.id = pm.company_id
     where pm.attributes ? 'renewal_date'
       and (pm.attributes->>'renewal_date')::date between now()::date and (now() + interval '60 days')::date
       and not exists (select 1 from opportunities o where o.company_id = pm.company_id
                       and o.stage not in ('closed_won', 'closed_lost'))
       and not exists (select 1 from revenue_motions m where m.company_id = pm.company_id
                       and m.status in ('draft', 'approved', 'active'))
     order by pm.company_id, (pm.attributes->>'renewal_date')::date asc limit 5`,
    [orgId],
  );
  for (const r of uncovered) {
    out.push({
      kind: "renewal_uncovered",
      companyId: r.company_id,
      account: r.legal_name,
      text: `Renewal due ${r.renewal} with no open opportunity and no motion — the book knows a date your execution doesn't.`,
      href: `/accounts/${r.company_id}`,
    });
  }

  // 5. Motion active, outreach silent for 14+ days.
  const { rows: stalled } = await db.query<{ company_id: string; legal_name: string; motion_id: string }>(
    `select m.company_id, c.legal_name, m.id as motion_id
     from revenue_motions m join companies c on c.id = m.company_id
     where m.status = 'active'
       and (m.org_id is null or m.org_id = $1)
       and not exists (select 1 from campaign_touches t
                       join campaigns ca on ca.id = t.campaign_id
                       where ca.motion_id = m.id and t.sent_at > now() - interval '14 days')
     limit 5`,
    [orgId],
  );
  for (const r of stalled) {
    out.push({
      kind: "motion_stalled",
      companyId: r.company_id,
      account: r.legal_name,
      text: `The motion is active but nothing has been sent in 14+ days — the plan says moving, the outbox says stopped.`,
      href: `/briefs/${r.motion_id}`,
    });
  }

  return out.slice(0, limit);
}
