import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { BandPill, SyntheticBadge } from "@/components/pursuit/parts";
import { withTenant } from "@/lib/db/tenant";
import { pursuitExperienceEnabled } from "@/lib/pursuits/experience-flags";
import { getPursuitPortfolio } from "@/lib/pursuits/read-models/portfolio";
import { callerFor } from "@/lib/pursuits/read-models/caller";

export const dynamic = "force-dynamic";

/**
 * Pursuits portfolio (Workstream D, §3/§5/§6). The canonical work list — one row per Pursuit,
 * grouped by account without collapsing scores. Reads the portfolio read model; never recomputes.
 * Gated by PURSUIT_EXPERIENCE_ENABLED so the current UI is untouched when off.
 */
export default async function PursuitsPage() {
  if (!pursuitExperienceEnabled()) notFound();
  const view = await withTenant(async (db, orgId) => {
    const caller = await callerFor(db, orgId);
    return getPursuitPortfolio(db, caller);
  });

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <PageHeader title="Pursuits" subtitle={`${view.total} active — what should I work next?`} />
      <div className="mt-4 overflow-x-auto">
        <table className="data-table w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Pursuit</th><th className="px-3 py-2">Priority</th><th className="px-3 py-2">Propensity</th>
              <th className="px-3 py-2">Confidence</th><th className="px-3 py-2">Timing</th><th className="px-3 py-2">Route</th>
              <th className="px-3 py-2">Readiness</th><th className="px-3 py-2">Next best action</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <tr key={r.pursuitId} data-band={r.priority.band}>
                <td className="px-3 py-2.5">
                  <Link href={r.deepLink} className="font-semibold hover:underline">{r.accountLabel}</Link>
                  <div className="text-xs text-slate-500">{r.thesis}{r.synthetic && <> · <SyntheticBadge text="demo" /></>}</div>
                </td>
                <td className="px-3 py-2.5"><BandPill band={r.priority.band} /></td>
                <td className="px-3 py-2.5"><BandPill band={r.propensity.band} /></td>
                <td className="px-3 py-2.5"><BandPill band={r.evidenceConfidence.band} /></td>
                <td className="px-3 py-2.5"><BandPill band={r.timing.band} /></td>
                <td className="px-3 py-2.5 text-xs">{r.recommendedRoute ?? <span className="text-slate-400">—</span>} · <BandPill band={r.routeConfidence.band} /></td>
                <td className="px-3 py-2.5"><BandPill band={r.activationReadiness.band} /></td>
                <td className="px-3 py-2.5 text-xs text-slate-600 dark:text-slate-300">{r.nextBestAction ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view.total === 0 && <p className="mt-6 text-sm text-slate-500">No active pursuits yet.</p>}
    </div>
  );
}
