import Link from "next/link";
import { getPool } from "@/db/client";
import { BandBadge, Card, PageHeader, StatChip, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const pool = getPool();

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

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatChip label="Motions awaiting approval" value={c.draft_motions} href="/motions" tone="attention" />
        <StatChip label="Evidence to review" value={c.pending_review} href="/review" tone="attention" />
        <StatChip label="Scored accounts" value={c.scored_accounts} href="/accounts" />
        <StatChip label="Verified evidence" value={c.verified_evidence} />
      </div>

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
