import Link from "next/link";
import { getPool } from "@/db/client";
import { currentOrgId } from "@/lib/auth/org";
import { rankNextActions, type NextAction, type PortfolioState } from "@/lib/portfolio/next-best";
import { BandBadge, Card, CountChip, PageHeader, StatusBadge } from "@/components/ui";
import { RoomTabs } from "@/components/room-tabs";
import { accountDivergences } from "@/lib/context/divergence";
import { enabledTriggers } from "@/lib/triggers/catalog";

export const dynamic = "force-dynamic";

async function loadNextActions() {
  const pool = getPool();
  const [drafts, approved, review, contradictions, refreshes] = await Promise.all([
    pool.query(
      `select m.id, c.legal_name, m.estimated_value_usd, p.score as propensity
       from revenue_motions m
       join companies c on c.id = m.company_id
       left join propensity_scores p on p.id = m.propensity_score_id
       where m.status = 'draft'`,
    ),
    pool.query(
      `select m.id, c.legal_name, m.estimated_value_usd, p.score as propensity,
              exists (select 1 from campaigns cp where cp.motion_id = m.id) as has_campaign
       from revenue_motions m
       join companies c on c.id = m.company_id
       left join propensity_scores p on p.id = m.propensity_score_id
       where m.status = 'approved'`,
    ),
    pool.query(`select count(*) as n from review_queue where status = 'pending'`),
    pool.query(
      `select distinct c.id, c.legal_name from contradictions ct
       join companies c on c.id = ct.company_id where ct.status = 'open'`,
    ),
    pool.query(
      `select id, legal_name, refresh_tier from companies
       where next_refresh_at is not null and next_refresh_at <= now()`,
    ),
  ]);

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
  const orgId = await currentOrgId(pool);
  const renewalActions: NextAction[] = [];
  if (orgId && (await enabledTriggers(pool, orgId)).has("renewal_window")) {
    const { rows: digests } = await pool.query<{
      company_id: string;
      legal_name: string;
      items: { type: string; text: string; at: string }[];
    }>(
      `select distinct on (d.company_id) d.company_id, c.legal_name, d.items
       from account_digests d join companies c on c.id = d.company_id
       where d.org_id = $1
       order by d.company_id, d.created_at desc`,
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

export default async function TodayPage() {
  const pool = getPool();
  const nextActions = await loadNextActions();

  // Reality-divergence detection (task #83): where the systems disagree —
  // with each other, or with the partner's side of the deal.
  const divOrgId = await currentOrgId(pool);
  const divergences = divOrgId ? await accountDivergences(pool, divOrgId, 6) : [];

  const [{ rows: counts }, { rows: drafts }, { rows: top }, { rows: activity }] =
    await Promise.all([
      pool.query(
        `select
           (select count(*) from revenue_motions where status = 'draft') as draft_motions,
           (select count(*) from review_queue where status = 'pending') as pending_review,
           (select count(distinct company_id) from propensity_scores) as scored_accounts,
           (select count(*) from evidence where status = 'verified') as verified_evidence`,
      ),
      pool.query(
        `select m.id, m.trigger_summary, m.confidence, c.legal_name, c.id as company_id, n.slug
         from revenue_motions m
         join companies c on c.id = m.company_id
         join taxonomy_nodes n on n.id = m.taxonomy_node_id
         where m.status = 'draft' order by m.created_at limit 5`,
      ),
      pool.query(
        `select distinct on (p.company_id) p.company_id, p.score, p.band, c.legal_name, n.slug
         from propensity_scores p
         join companies c on c.id = p.company_id
         join taxonomy_nodes n on n.id = p.taxonomy_node_id
         order by p.company_id, p.computed_at desc`,
      ),
      pool.query(
        `select e.event_type, e.occurred_at, c.legal_name
         from outcome_events e left join companies c on c.id = e.company_id
         order by e.occurred_at desc limit 6`,
      ),
    ]);
  const c = counts[0];
  const topRanked = [...top].sort((a, b) => Number(b.score) - Number(a.score)).slice(0, 5);

  return (
    <main>
      <PageHeader
        title="Today"
        subtitle="What needs your decision, and where the next revenue is."
      />
      <RoomTabs tabs={[{ href: "/", label: "Today" }, { href: "/queue", label: "Queue" }]} />

      <div className="mb-6 flex flex-wrap gap-2">
        <CountChip label="Awaiting approval" value={c.draft_motions} href="/motions" tone={Number(c.draft_motions) > 0 ? "amber" : "neutral"} />
        <CountChip label="Evidence to review" value={c.pending_review} href="/review" tone={Number(c.pending_review) > 0 ? "amber" : "neutral"} />
        <CountChip label="Scored accounts" value={c.scored_accounts} href="/accounts" tone="sky" />
        <CountChip label="Verified evidence" value={c.verified_evidence} href="/sources" tone="green" />
      </div>

      {nextActions.length > 0 && (
        <Card className="mb-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Next best actions
          </h2>
          <ol className="space-y-2">
            {nextActions.map((a, i) => (
              <li key={i} className="flex items-baseline gap-3 text-sm">
                <span className="tnum w-5 text-right font-semibold text-neutral-400">{i + 1}</span>
                <span>
                  <Link href={a.href} className="font-medium hover:underline">
                    {a.title}
                  </Link>
                  <span className="ml-2 text-neutral-500">— {a.reason}</span>
                </span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {/* ── Where your systems disagree (task #83): reality divergence, with
          the receipts — including the cross-company rules only a two-sided
          platform can run. ── */}
      {divergences.length > 0 && (
        <Card tone="amber" className="mb-6">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Where your systems disagree
            </h2>
            <span className="text-[11px] text-neutral-400">each row names both records in conflict</span>
          </div>
          <ul className="space-y-2">
            {divergences.map((d, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span
                  className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    d.kind === "joint_vs_pipeline"
                      ? "bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-400"
                      : "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
                  }`}
                >
                  {d.kind.replace(/_/g, " ")}
                </span>
                <span className="min-w-0 flex-1">
                  <Link href={d.href} className="font-medium hover:underline">{d.account}</Link>
                  <span className="text-neutral-500"> — {d.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Pending approvals
          </h2>
          {drafts.length === 0 ? (
            <p className="text-sm text-neutral-500">
              All clear — new motions appear here when the designer drafts them.
            </p>
          ) : (
            <ul className="space-y-3">
              {drafts.map((m) => (
                <li key={m.id} className="text-sm">
                  <Link href="/motions" className="font-medium hover:underline">
                    {m.legal_name}
                  </Link>{" "}
                  <span className="text-neutral-500">— {m.slug}</span>
                  <p className="mt-0.5 line-clamp-2 text-neutral-600 dark:text-neutral-400">
                    {m.trigger_summary}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Top opportunities
          </h2>
          {topRanked.length === 0 ? (
            <p className="text-sm text-neutral-500">Run the scoring pipeline to populate.</p>
          ) : (
            <ul className="space-y-2">
              {topRanked.map((r) => (
                <li key={r.company_id} className="flex items-center justify-between text-sm">
                  <Link href={`/accounts/${r.company_id}`} className="font-medium hover:underline">
                    {r.legal_name}
                  </Link>
                  <span className="flex items-center gap-2">
                    <span className="tnum font-semibold">{Number(r.score).toFixed(0)}</span>
                    <BandBadge band={r.band} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Recent activity
        </h2>
        {activity.length === 0 ? (
          <p className="text-sm text-neutral-500">Outcome events land here.</p>
        ) : (
          <ul className="space-y-1.5">
            {activity.map((a, i) => (
              <li key={i} className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
                <StatusBadge status={a.event_type.toLowerCase().replace(/_/g, " ")} />
                <span>{a.legal_name}</span>
                <span className="ml-auto text-xs text-neutral-400">
                  {new Date(a.occurred_at).toISOString().slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
