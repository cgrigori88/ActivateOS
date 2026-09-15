import type { PoolClient } from "pg";
import { accountDivergences } from "@/lib/context/divergence";
import { rankNextActions, type NextAction, type PortfolioState } from "@/lib/portfolio/next-best";
import { enabledTriggers } from "@/lib/triggers/catalog";

/**
 * Today's standing context — the "Also queued" list, the At-a-glance counts, Top opportunities,
 * Recent activity and "Where your systems disagree". Moved out of `app/page.tsx` unchanged in
 * shape so it can be verified against a real schema, and TENANT-SCOPED EXPLICITLY (2026-09-14).
 *
 * WHY. These queries ran inline on the Today page and several named no org: draft / approved
 * motions, pending review, open contradictions, the propensity leaderboard, verified evidence and
 * outcome activity. The app connects as the table owner, which bypasses RLS (task #67), so each of
 * them summed, ranked or listed every org's rows. Each now names the caller's org (resolved by
 * `withTenant`, never from input) in SQL — before ranking, counting or LIMIT.
 *
 * `companies` is the shared account catalog and carries no org_id; an account appears here only
 * through something this org owns about it.
 */

export async function loadTodayNextActions(db: PoolClient, orgId: string): Promise<NextAction[]> {
  const drafts = await db.query(
    `select m.id, c.legal_name, m.estimated_value_usd, p.score as propensity
       from revenue_motions m
       join companies c on c.id = m.company_id
       left join propensity_scores p on p.id = m.propensity_score_id
      where m.status = 'draft' and m.org_id = $1
      order by m.id`,
    [orgId],
  );
  const approved = await db.query(
    `select m.id, c.legal_name, m.estimated_value_usd, p.score as propensity,
            exists (select 1 from campaigns cp where cp.motion_id = m.id) as has_campaign
       from revenue_motions m
       join companies c on c.id = m.company_id
       left join propensity_scores p on p.id = m.propensity_score_id
      where m.status = 'approved' and m.org_id = $1
      order by m.id`,
    [orgId],
  );
  const review = await db.query(`select count(*) as n from review_queue where status = 'pending' and org_id = $1`, [orgId]);
  const contradictions = await db.query(
    `select distinct c.id, c.legal_name from contradictions ct
       join companies c on c.id = ct.company_id where ct.status = 'open' and ct.org_id = $1
      order by c.legal_name, c.id`,
    [orgId],
  );
  // A catalog account past its refresh date is this org's hygiene work only if this org works it.
  const refreshes = await db.query(
    `select c.id, c.legal_name, c.refresh_tier from companies c
      where c.next_refresh_at is not null and c.next_refresh_at <= now()
        and (exists (select 1 from propensity_scores ps where ps.company_id = c.id and ps.org_id = $1)
          or exists (select 1 from pursuits pu where pu.account_id = c.id and pu.org_id = $1)
          or exists (select 1 from opportunities o where o.company_id = c.id and o.org_id = $1)
          or exists (select 1 from revenue_motions rm where rm.company_id = c.id and rm.org_id = $1))
      order by c.legal_name, c.id`,
    [orgId],
  );

  const expected = (v: unknown, p: unknown) =>
    v == null ? null : Math.round((Number(v) * (p == null ? 50 : Number(p))) / 100);

  const state: PortfolioState = {
    draftMotions: drafts.rows.map((m) => ({
      motionId: m.id,
      company: m.legal_name,
      expectedValueUsd: expected(m.estimated_value_usd, m.propensity),
    })),
    approvedMotions: approved.rows.map((m) => ({
      motionId: m.id,
      company: m.legal_name,
      expectedValueUsd: expected(m.estimated_value_usd, m.propensity),
      hasCampaign: m.has_campaign,
    })),
    pendingReviewCount: Number(review.rows[0].n),
    openContradictions: contradictions.rows.map((c) => ({
      company: c.legal_name,
      companyId: c.id,
    })),
    refreshDue: refreshes.rows.map((r) => ({
      company: r.legal_name,
      companyId: r.id,
      tier: r.refresh_tier ?? "low",
    })),
  };
  const ranked = rankNextActions(state, 6);

  // Renewal windows surfaced by the account-digest routine (task #77): a
  // renewal inside 90 days is decision-shaped, not FYI — it belongs here,
  // not just on the account card.
  const renewalActions: NextAction[] = [];
  if ((await enabledTriggers(db, orgId)).has("renewal_window")) {
    const { rows: digests } = await db.query<{
      company_id: string;
      legal_name: string;
      items: { type: string; text: string; at: string }[];
    }>(
      `select distinct on (d.company_id) d.company_id, c.legal_name, d.items
     from account_digests d join companies c on c.id = d.company_id
     where d.org_id = $1
     order by d.company_id, d.created_at desc, d.id desc`,
      [orgId],
    );
    for (const d of digests) {
      const renewal = (d.items ?? []).find((it) => it.type === "renewal");
      if (!renewal) continue;
      renewalActions.push({
        type: "RENEWAL_WINDOW",
        priority: 70,
        title: `Plan the renewal — ${d.legal_name}`,
        reason: `${renewal.text} (from this week's account digest)`,
        href: `/accounts/${d.company_id}`,
      });
    }
  }
  return [...ranked, ...renewalActions].slice(0, 7);
}

export interface TodayOverview {
  /** Scope-narrowed conditions ("Where your systems disagree"). */
  divergences: Awaited<ReturnType<typeof accountDivergences>>;
  counts: { draft_motions: string; pending_review: string; scored_accounts: string; verified_evidence: string }[];
  top: { company_id: string; score: string; band: string; legal_name: string; slug: string }[];
  activity: { event_type: string; occurred_at: Date; legal_name: string | null }[];
}

export async function loadTodayOverview(db: PoolClient, orgId: string, scopeIds: string[] | null): Promise<TodayOverview> {
  // Reality-divergence detection (task #83): where the systems disagree —
  // with each other, or with the partner's side of the deal.
  const rawDiv = await accountDivergences(db, orgId, 12);
  // Scope narrowing (§1): keep only conditions on in-scope accounts.
  const divergences = scopeIds == null ? rawDiv : rawDiv.filter((d) => scopeIds.includes(d.companyId));
  const counts = await db.query(
    `select
       (select count(*) from revenue_motions where status = 'draft' and org_id = $1) as draft_motions,
       (select count(*) from review_queue where status = 'pending' and org_id = $1) as pending_review,
       (select count(distinct company_id) from propensity_scores where org_id = $1) as scored_accounts,
       (select count(*) from evidence where status = 'verified' and org_id = $1) as verified_evidence`,
    [orgId],
  );
  const top = await db.query(
    `select distinct on (p.company_id) p.company_id, p.score, p.band, c.legal_name, n.slug
     from propensity_scores p
     join companies c on c.id = p.company_id
     join taxonomy_nodes n on n.id = p.taxonomy_node_id
     where p.org_id = $3 and ($2::boolean is false or p.company_id = any($1))
     order by p.company_id, p.computed_at desc, p.id desc`,
    [scopeIds ?? [], scopeIds != null, orgId],
  );
  const activity = await db.query(
    `select e.event_type, e.occurred_at, c.legal_name
     from outcome_events e left join companies c on c.id = e.company_id
     where e.org_id = $3 and ($2::boolean is false or e.company_id = any($1))
     order by e.occurred_at desc, e.id desc limit 6`,
    [scopeIds ?? [], scopeIds != null, orgId],
  );
  return { divergences, counts: counts.rows, top: top.rows, activity: activity.rows };
}
