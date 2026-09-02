import { getPool } from "@/db/client";
import { Card, PageHeader } from "@/components/ui";
import { RoomTabs } from "@/components/room-tabs";

export const dynamic = "force-dynamic";

/**
 * Source health: our answer to "intake dashboards" — not just volume, but
 * verification outcomes and earned trust per source (docs/DESIGN.md §2).
 */
export default async function SourcesPage() {
  const pool = getPool();
  const { rows: sources } = await pool.query(
    `select s.name, s.kind, s.trust_score, s.audit_sample_rate, s.audited_count, s.accurate_count,
            s.predictive_value, s.scored_evidence, s.high_band_evidence,
            count(e.id) as total,
            count(e.id) filter (where e.status = 'verified') as verified,
            count(e.id) filter (where e.status = 'quarantined') as quarantined,
            count(e.id) filter (where e.status = 'rejected') as rejected,
            max(e.collected_at) as last_seen
     from signal_sources s
     left join evidence e on e.source_type = s.name
     group by s.id order by s.trust_score desc`,
  );

  return (
    <main>
      <PageHeader
        title="Sources"
        subtitle="Verification outcomes, audit history and sampling, per source."
      />
      <RoomTabs tabs={[{ href: "/sources", label: "Sources" }, { href: "/provider-health", label: "Provider health" }]} />
      {sources.length === 0 && (
        <p className="text-copy text-neutral-500">Sources register automatically as evidence flows in.</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {sources.map((s) => {
          const total = Number(s.total);
          const verifiedPct = total ? Math.round((Number(s.verified) / total) * 100) : 0;
          return (
            <Card key={s.name}>
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="font-semibold">{s.name}</h2>
                <span className="text-body uppercase tracking-wide text-neutral-400">{s.kind}</span>
              </div>
              <div className="mb-3 flex items-baseline gap-4">
                <div>
                  <div className="pos-metric-fig">{Number(s.trust_score).toFixed(2)}</div>
                  <div className="text-body text-neutral-500">earned trust</div>
                </div>
                <div>
                  <div className="pos-metric-fig">
                    {Math.round(Number(s.audit_sample_rate) * 100)}%
                  </div>
                  <div className="text-body text-neutral-500">audit sampling</div>
                </div>
                <div>
                  <div className="pos-metric-fig">{verifiedPct}%</div>
                  <div className="text-body text-neutral-500">verified rate</div>
                </div>
                {s.predictive_value != null && (
                  <div>
                    <div className="pos-metric-fig">
                      {Number(s.predictive_value).toFixed(2)}
                    </div>
                    <div className="text-body text-neutral-500">predictive value</div>
                  </div>
                )}
              </div>
              {total > 0 && (
                <div className="mb-2 flex h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                  <div className="bg-green-600" style={{ width: `${(Number(s.verified) / total) * 100}%` }} />
                  <div className="bg-amber-500" style={{ width: `${(Number(s.quarantined) / total) * 100}%` }} />
                  <div className="bg-red-600" style={{ width: `${(Number(s.rejected) / total) * 100}%` }} />
                </div>
              )}
              <p className="text-body text-neutral-500">
                {s.total} evidence items — {s.verified} verified, {s.quarantined} quarantined,{" "}
                {s.rejected} rejected · audited {s.audited_count} ({s.accurate_count} accurate)
                {s.predictive_value != null &&
                  ` · ${s.high_band_evidence}/${s.scored_evidence} scored evidence in high bands`}
                {s.last_seen && ` · last seen ${new Date(s.last_seen).toISOString().slice(0, 10)}`}
              </p>
            </Card>
          );
        })}
      </div>
    </main>
  );
}
