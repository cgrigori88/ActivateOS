import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Panel } from "@/components/pursuit/panel";
import { BandPill, SyntheticBadge } from "@/components/pursuit/parts";
import { money } from "@/components/pursuit/surfaces";
import { withTenant } from "@/lib/db/tenant";
import { pursuitExperienceEnabled } from "@/lib/pursuits/experience-flags";
import { getPursuitPortfolio } from "@/lib/pursuits/read-models/portfolio";
import { callerFor } from "@/lib/pursuits/read-models/caller";
import type { PortfolioRow } from "@/lib/pursuits/read-models/types";

export const dynamic = "force-dynamic";

/**
 * Pursuits portfolio (Workstream D / D.5). The canonical work list — grouped by
 * account, one soft row per Pursuit, band-first, never collapsing scores. Built
 * from the portfolio read model on the material system (no hard outlines); never
 * recomputes. Gated by PURSUIT_EXPERIENCE_ENABLED.
 */
export default async function PursuitsPage() {
  if (!pursuitExperienceEnabled()) notFound();
  const view = await withTenant(async (db, orgId) => {
    const caller = await callerFor(db, orgId);
    return getPursuitPortfolio(db, caller);
  });

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-6">
      <PageHeader title="Pursuits" subtitle={`${view.total} active commercial ${view.total === 1 ? "pursuit" : "pursuits"} — what should I work next?`} />
      {view.total === 0 ? (
        <Panel><p className="text-[13px] text-neutral-500">No active pursuits yet.</p></Panel>
      ) : (
        <div className="space-y-4">
          {view.grouped.map((g) => (
            <Panel key={g.accountId} eyebrow={`${g.pursuits.length} ${g.pursuits.length === 1 ? "pursuit" : "pursuits"}`} title={g.accountLabel} accent="var(--color-priority)">
              <div className="space-y-2">
                {g.pursuits.map((r) => <PursuitRow key={r.pursuitId} r={r} />)}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}

function PursuitRow({ r }: { r: PortfolioRow }) {
  return (
    <Link
      href={r.deepLink}
      className="pos-lift block rounded-card p-3.5"
      style={{ background: "var(--surface-inset)" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-[260px]">
          <div className="flex items-center gap-2 text-[14px] font-bold">
            <span className="truncate">{r.thesis}</span>
            {r.synthetic && <SyntheticBadge text="demo" />}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-neutral-500">
            {r.solution && <span>{r.solution}</span>}
            {r.expectedValue != null && <span className="tnum font-semibold text-neutral-600 dark:text-neutral-300">{money(r.expectedValue, r.currency)}</span>}
            {r.nextBestAction && <span>Next: <b className="font-semibold text-neutral-600 dark:text-neutral-300">{r.nextBestAction}</b></span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <Metric label="Priority" band={r.priority.band} />
          <Metric label="Propensity" band={r.propensity.band} />
          <Metric label="Evidence" band={r.evidenceConfidence.band} />
          <Metric label="Timing" band={r.timing.band} />
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] font-bold uppercase tracking-[0.04em] text-neutral-400">Route</span>
            <span className="flex items-center gap-1.5 text-[12px] font-semibold">
              {r.recommendedRoute ?? <span className="text-neutral-400">—</span>}
              <BandPill band={r.routeConfidence.band} word="" />
            </span>
          </div>
          <Metric label="Readiness" band={r.activationReadiness.band} />
        </div>
      </div>
    </Link>
  );
}

function Metric({ label, band }: { label: string; band: import("@/lib/pursuits/read-models/types").Band }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] font-bold uppercase tracking-[0.04em] text-neutral-400">{label}</span>
      <BandPill band={band} />
    </div>
  );
}
