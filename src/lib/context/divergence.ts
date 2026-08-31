import type { Pool, PoolClient } from "pg";

import { enabledTriggers } from "@/lib/triggers/catalog";

type Db = Pool | PoolClient;

/**
 * Reality-divergence detection (task #83): deterministic rules that surface
 * where the systems disagree with each other — or with the partner's side.
 * Each finding names BOTH records that conflict; no AI, no scores, just the
 * receipts. The cross-company rules are the ones a single-tenant "revenue
 * context" product structurally cannot run.
 */

export interface Divergence {
  kind: "stale_deal" | "stage_vs_engagement" | "joint_vs_pipeline" | "renewal_uncovered" | "motion_stalled" | "crm_vs_platform";
  companyId: string;
  account: string;
  text: string;
  href: string;
}

export async function accountDivergences(db: Db, orgId: string, limit = 12): Promise<Divergence[]> {
  const out: Divergence[] = [];

  // Attention-trigger toggles (task #83): each rule below maps to a catalog
  // key; a rule the org switched off simply doesn't run.
  const on = await enabledTriggers(db, orgId);

  // 1. Stale deal: open in the pipeline, untouched for 21+ days.
  const { rows: stale } = on.has("stale_deal") ? await db.query<{ company_id: string; legal_name: string; name: string; days: string }>(
    `select o.company_id, c.legal_name, o.name,
            extract(day from now() - o.updated_at)::int::text as days
     from opportunities o join companies c on c.id = o.company_id
     where o.stage not in ('closed_won', 'closed_lost') and ($1::uuid is null or o.org_id = $1)
       and o.updated_at < now() - interval '21 days'
     order by o.updated_at asc limit 5`,
    [orgId],
  ) : { rows: [] };
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
  const { rows: silent } = on.has("engagement_decay") ? await db.query<{ company_id: string; legal_name: string; name: string; stage: string }>(
    `select o.company_id, c.legal_name, o.name, o.stage
     from opportunities o join companies c on c.id = o.company_id
     where o.stage in ('proposal', 'negotiation') and ($1::uuid is null or o.org_id = $1)
       and not exists (select 1 from engagement_scores es
                       where es.company_id = o.company_id
                         and es.last_engaged_at > now() - interval '30 days')
       and not exists (select 1 from meeting_notes mn
                       where mn.company_id = o.company_id and mn.org_id = $1
                         and mn.met_at > (now() - interval '30 days')::date)
     limit 5`,
    [orgId],
  ) : { rows: [] };
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
  const { rows: roomOnly } = on.has("joint_room_gap") ? await db.query<{ company_id: string; legal_name: string; pursuit_id: string }>(
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
  ) : { rows: [] };
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
  //
  // P2A §5 — RECONCILED. This previously read `population_members.attributes->>'renewal_date'`
  // directly, which made the import JSON a SECOND independently-interpreted renewal truth beside
  // the canonical fact graph. It now reads the graph, which the one-way import bridge
  // (lifecycle/bridge.ts) promotes those attributes into with their provenance and uncertainty
  // intact. One renewal truth; the import is an input to it, never a parallel display source.
  // Both precise dates and inferred windows qualify — a window's NEAR edge is the clock.
  const { rows: uncovered } = on.has("renewal_window") ? await db.query<{ company_id: string; legal_name: string; renewal: string; state: string }>(
    `select distinct on (f.company_id) f.company_id, c.legal_name,
            to_char(coalesce(f.date_value, f.valid_from), 'YYYY-MM-DD') as renewal,
            case when f.date_value is not null
                   and f.provenance_class in ('FIRST_PARTY','SECOND_PARTY','THIRD_PARTY_VERIFIED','CUSTOMER_DECLARED','HUMAN_ASSERTED')
                 then 'confirmed' else 'an inferred window' end as state
     from facts f
     join companies c on c.id = f.company_id
     where f.org_id = $1 and f.status = 'CURRENT'
       and f.predicate_key in ('renewal_date','contract_expires','subscription_term_end','renewal_window')
       and coalesce(f.date_value, f.valid_from) between now() and now() + interval '60 days'
       and not exists (select 1 from opportunities o where o.company_id = f.company_id
                       and o.stage not in ('closed_won', 'closed_lost'))
       and not exists (select 1 from revenue_motions m where m.company_id = f.company_id
                       and m.status in ('draft', 'approved', 'active'))
     order by f.company_id, coalesce(f.date_value, f.valid_from) asc limit 5`,
    [orgId],
  ) : { rows: [] };
  for (const r of uncovered) {
    out.push({
      kind: "renewal_uncovered",
      companyId: r.company_id,
      account: r.legal_name,
      text: `Renewal ${r.state === "confirmed" ? `due ${r.renewal}` : `expected around ${r.renewal} (${r.state})`} with no open opportunity and no motion — the book knows a date your execution doesn't.`,
      href: `/accounts/${r.company_id}`,
    });
  }

  // 5. Motion active, outreach silent for 14+ days.
  const { rows: stalled } = on.has("motion_stalled") ? await db.query<{ company_id: string; legal_name: string; motion_id: string }>(
    `select m.company_id, c.legal_name, m.id as motion_id
     from revenue_motions m join companies c on c.id = m.company_id
     where m.status = 'active'
       and (m.org_id is null or m.org_id = $1)
       and not exists (select 1 from campaign_touches t
                       join campaigns ca on ca.id = t.campaign_id
                       where ca.motion_id = m.id and t.sent_at > now() - interval '14 days')
     limit 5`,
    [orgId],
  ) : { rows: [] };
  for (const r of stalled) {
    out.push({
      kind: "motion_stalled",
      companyId: r.company_id,
      account: r.legal_name,
      text: `The motion is active but nothing has been sent in 14+ days — the plan says moving, the outbox says stopped.`,
      href: `/briefs/${r.motion_id}`,
    });
  }

  // 6. CRM vs platform: the latest CRM-export snapshot disagrees with the
  //    live record — different stage, or amounts more than 20% apart. The
  //    exported-truth-vs-observed-truth comparison; the snapshot carries the
  //    CRM's words verbatim.
  const { rows: snaps } = on.has("crm_divergence") ? await db.query<{
    company_id: string; legal_name: string; opportunity_name: string;
    crm_stage: string; stage_raw: string | null; crm_amount: string | null;
    live_stage: string | null; live_amount: string | null;
  }>(
    `select distinct on (s.company_id, lower(s.opportunity_name))
            s.company_id, c.legal_name, s.opportunity_name,
            s.stage as crm_stage, s.stage_raw, s.amount_usd as crm_amount,
            o.stage as live_stage, o.amount_usd as live_amount
     from crm_snapshots s
     join companies c on c.id = s.company_id
     left join opportunities o on o.org_id = s.org_id and o.company_id = s.company_id
       and lower(o.name) = lower(s.opportunity_name)
     where s.org_id = $1 and s.reported_at > now() - interval '45 days'
     order by s.company_id, lower(s.opportunity_name), s.reported_at desc`,
    [orgId],
  ) : { rows: [] };
  for (const s of snaps) {
    if (!s.live_stage) continue; // nothing to disagree with (sync-in handled it)
    const a = s.crm_amount == null ? null : Number(s.crm_amount);
    const b = s.live_amount == null ? null : Number(s.live_amount);
    const stageDiffers = s.live_stage !== s.crm_stage;
    const amountDiffers = a != null && b != null && b > 0 && Math.abs(a - b) / b > 0.2;
    if (!stageDiffers && !amountDiffers) continue;
    const crmSaid = `${s.stage_raw ?? s.crm_stage.replace(/_/g, " ")}${a != null ? ` ($${Math.round(a / 1000)}k)` : ""}`;
    const weHold = `${s.live_stage.replace(/_/g, " ")}${b != null ? ` ($${Math.round(b / 1000)}k)` : ""}`;
    out.push({
      kind: "crm_vs_platform",
      companyId: s.company_id,
      account: s.legal_name,
      text: `Your CRM export says "${s.opportunity_name}" is ${crmSaid}; PursuitOS holds ${weHold} — two systems, two stories.`,
      href: `/accounts/${s.company_id}`,
    });
    if (out.length >= limit + 5) break;
  }

  return out.slice(0, limit);
}
