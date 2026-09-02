import { getPool } from "@/db/client";
import { Bento, Card, PageHeader, StatusBadge, BlockLabel } from "@/components/ui";
import { RoomTabs } from "@/components/room-tabs";
import { loadProviderHealth, TIER_LABELS, type ProviderHealthRow } from "@/lib/intel/provider-health";

export const dynamic = "force-dynamic";

/**
 * Provider health & registry (§44): every intelligence provider's live state —
 * tier, cost, enabled/disabled reason, and run outcomes. Disabled and
 * never-run providers are shown, never silently absent.
 */
export default async function ProviderHealthPage() {
  const pool = getPool();
  const rows = await loadProviderHealth(pool);

  const enabled = rows.filter((r) => !r.disabledReason).length;
  const disabled = rows.length - enabled;
  const everRun = rows.filter((r) => r.runs > 0).length;
  const totalEvidence = rows.reduce((n, r) => n + r.evidence, 0);

  // Group by tier, preserving the tier/priority sort from the loader.
  const groups: { tier: string; rows: ProviderHealthRow[] }[] = [];
  for (const r of rows) {
    let g = groups.find((x) => x.tier === r.tier);
    if (!g) groups.push((g = { tier: r.tier, rows: [] }));
    g.rows.push(r);
  }

  return (
    <main>
      <PageHeader
        title="Provider health"
        subtitle="Every provider's live state — tier, cost, and run outcomes."
      />
      <RoomTabs tabs={[{ href: "/sources", label: "Sources" }, { href: "/provider-health", label: "Provider health" }]} />

      <div className="mb-6 flex flex-wrap gap-3">
        <Bento value={rows.length} label="registered" />
        <Bento value={enabled} label="enabled" />
        <Bento value={disabled} label="disabled" />
        <Bento value={everRun} label="have run" />
        <Bento value={totalEvidence} label="evidence produced" />
      </div>

      {groups.map((g) => (
        <div key={g.tier} className="mb-6">
          <BlockLabel>
            {TIER_LABELS[g.tier] ?? g.tier}
          </BlockLabel>
          <div className="overflow-x-auto rounded-xl border border-neutral-200 scroll-thin dark:border-neutral-800">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Type</th>
                  <th>Cost</th>
                  <th>Stage</th>
                  <th>State</th>
                  <th>Recent</th>
                  <th className="text-right">Runs</th>
                  <th className="text-right">OK / Fail / Skip</th>
                  <th className="text-right">Evidence</th>
                  <th className="text-right">Cost&nbsp;$</th>
                  <th>Last run</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.providerId}>
                    <td>
                      <span className="font-medium">{r.providerId}</span>
                      <div className="text-label text-neutral-400">{r.purpose}</div>
                    </td>
                    <td className="text-neutral-500">{r.providerType}</td>
                    <td className="text-neutral-500">{r.costClass}</td>
                    <td className="text-neutral-500">{r.stages.join(" + ") || "—"}</td>
                    <td>
                      {r.disabledReason ? (
                        <span title={r.disabledReason}>
                          <StatusBadge status="disabled" />
                        </span>
                      ) : r.lastStatus ? (
                        <StatusBadge status={r.lastStatus} />
                      ) : (
                        <span className="text-body text-neutral-400">never run</span>
                      )}
                    </td>
                    <td>
                      <RunSparkline runs={r.recentRuns} />
                    </td>
                    <td className="tnum text-right">{r.runs || "—"}</td>
                    <td className="tnum text-right text-neutral-500">
                      {r.runs ? `${r.succeeded} / ${r.failed} / ${r.skipped}` : "—"}
                    </td>
                    <td className="tnum text-right">{r.evidence || "—"}</td>
                    <td className="tnum text-right text-neutral-500">
                      {r.costUsd > 0 ? r.costUsd.toFixed(2) : "—"}
                    </td>
                    <td className="text-body text-neutral-400">
                      {r.lastRunAt ? new Date(r.lastRunAt).toISOString().slice(0, 10) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {g.rows.some((r) => r.disabledReason) && (
            <p className="mt-1.5 text-body text-neutral-500">
              {g.rows
                .filter((r) => r.disabledReason)
                .map((r) => `${r.providerId}: ${r.disabledReason}`)
                .join(" · ")}
            </p>
          )}
          {g.rows.some((r) => r.lastError) && (
            <div className="mt-1.5 space-y-0.5">
              {g.rows
                .filter((r) => r.lastError)
                .map((r) => (
                  <p key={r.providerId} className="text-body text-red-600 dark:text-red-400">
                    <span className="font-medium">{r.providerId}</span> last error:{" "}
                    <span className="text-neutral-500">{r.lastError!.slice(0, 160)}</span>
                  </p>
                ))}
            </div>
          )}
        </div>
      ))}
    </main>
  );
}

const RUN_COLORS: Record<string, string> = {
  succeeded: "bg-green-500",
  failed: "bg-red-500",
  skipped: "bg-neutral-300 dark:bg-neutral-600",
  running: "bg-sky-500",
};

/** Recent-run sparkline: oldest → newest (left → right), one bar per run. */
function RunSparkline({ runs }: { runs: string[] }) {
  if (runs.length === 0) return <span className="text-body text-neutral-400">—</span>;
  const ordered = [...runs].reverse(); // query gives newest-first; show newest at right
  return (
    <span className="inline-flex items-end gap-[2px]" title={`last ${ordered.length} runs`}>
      {ordered.map((s, i) => (
        <span
          key={i}
          className={`h-3.5 w-1 rounded-inner ${RUN_COLORS[s] ?? "bg-neutral-300 dark:bg-neutral-600"}`}
          title={s}
        />
      ))}
    </span>
  );
}

