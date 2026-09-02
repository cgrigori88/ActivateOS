import Link from "next/link";
import { getPool } from "@/db/client";
import { Card, PageHeader } from "@/components/ui";
import { RoomTabs } from "@/components/room-tabs";
import { EvidenceModel } from "@/components/evidence-model";

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
      {/* Wave 5 §5: "verification outcomes, audit history and sampling" lists the
          room's mechanics. The question it answers is whose evidence this is and
          how far it can be trusted — and trust here is earned from checked
          outcomes rather than declared, which is the claim worth leading with. */}
      <PageHeader
        title="Sources"
        subtitle="Where the evidence comes from, and how much each source has earned your trust."
      />
      <RoomTabs tabs={[{ href: "/sources", label: "Sources" }, { href: "/provider-health", label: "Provider health" }]} />
      <EvidenceModel
        current="sources"
        steps={{ sources: { detail: `${sources.length} source${sources.length === 1 ? "" : "s"} contributing` } }}
      />
      {/* Wave 5 §4 applies here as much as to Analytics: a room with nothing in it
          should say what it will hold and how it gets there, not leave one grey
          sentence floating on an empty page. */}
      {sources.length === 0 && (
        <Card>
          <p className="text-title font-semibold ink">No source has contributed evidence yet.</p>
          <p className="mt-1 text-body ink-muted">
            A source registers itself the first time a claim is attributed to it — nothing to
            configure here.
          </p>
          <p className="mt-3 text-body ink-muted">Once evidence is flowing, this room answers:</p>
          <ul className="mt-1 space-y-0.5 text-body ink-faint">
            <li>· how much of what each source told us survived verification</li>
            <li>· how much of it was quarantined or rejected outright</li>
            <li>· whether a source&rsquo;s claims actually precede won deals</li>
          </ul>
          <p className="mt-3 text-body">
            <Link href="/provider-health" className="text-accent hover:underline dark:text-blue-400">
              Check which feeds are configured and running →
            </Link>
          </p>
        </Card>
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
