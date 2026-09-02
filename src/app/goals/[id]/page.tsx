import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink, Card, Disclosure, PageHeader, BlockLabel } from "@/components/ui";
import { withTenant } from "@/lib/db/tenant";
import { listGoals, METRIC_LABEL, METRICS, formatMetric, type Goal } from "@/lib/goals/goals";
import { goalChain, goalBlockers } from "@/lib/goals/chain";
import { formatMoney } from "@/lib/format/money";
import { OperatingModel } from "@/components/operating-model";

export const dynamic = "force-dynamic";

/**
 * Goal detail (Wave 3 §3) — the room that answers "why are we ahead or behind?"
 *
 * The Goals index could show a bar and a percentage; it had nowhere to send a
 * reader who wanted the reason. This is that place: the target and the pace at
 * the top, then the motions carrying it, the pipeline those motions have
 * produced, and what is holding the rest up — in that order, because that is the
 * order the question is actually asked in.
 *
 * It is a presentation over existing reads. No new domain concept, no new
 * primitive, nothing written: `listGoals` and `goalChain` are the same functions
 * the index uses, so the two rooms cannot disagree about a number.
 */

const PACE_TONE: Record<Goal["pace"], string> = {
  ahead: "bg-green-100 text-positive dark:bg-green-950 dark:text-green-300",
  on_track: "bg-blue-100 text-accent dark:bg-blue-950 dark:text-blue-300",
  behind: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  none: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
};
const PACE_LABEL: Record<Goal["pace"], string> = { ahead: "Ahead", on_track: "On track", behind: "Behind", none: "No due date" };
const metricKind = (m: string) => METRICS.find((x) => x.key === m)?.kind ?? "count";

export default async function GoalDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const loaded = await withTenant(async (db, orgId) => {
    const goal = (await listGoals(db, orgId)).find((g) => g.id === id);
    if (!goal) return null;
    return { goal, chain: await goalChain(db, goal.id) };
  });
  if (!loaded) notFound();

  const { goal: g, chain } = loaded;
  const kind = metricKind(g.metric);
  const blockers = goalBlockers(chain);
  const barTone = g.pace === "behind" ? "bg-red-500" : g.pace === "ahead" ? "bg-green-500" : "bg-blue-500";
  const live = chain.motions.filter((m) => m.status !== "draft");

  return (
    <main>
      <div className="mb-3">
        <BackLink href="/goals" label="Goals" />
      </div>
      <PageHeader title={g.name} subtitle={g.description ?? undefined} />

      <OperatingModel
        current="goal"
        steps={{
          goal: { label: g.name, detail: `${formatMetric(kind, g.target, g.unit)} target` },
          motion: { href: "/motions", label: `${chain.motions.length} motion${chain.motions.length === 1 ? "" : "s"}`, detail: `${formatMoney(chain.motionValueUsd)} motion-level` },
          pursuit: { href: "/pursuits", detail: "accounts these motions run on" },
          pipeline: { href: "/pipeline", label: `${chain.oppCount} opportunit${chain.oppCount === 1 ? "y" : "ies"}`, detail: `${formatMoney(chain.openPipelineUsd)} open` },
        }}
      />

      {/* ── Where we stand ─────────────────────────────────────────────────── */}
      <Card className="mb-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-copy ink-muted">{METRIC_LABEL[g.metric]}</span>
          <span className="flex items-center gap-2">
            {g.status === "active"
              ? <span className={`rounded-inner px-1.5 py-0.5 text-micro font-medium ${PACE_TONE[g.pace]}`}>{PACE_LABEL[g.pace]}</span>
              : <span className="rounded-inner bg-neutral-100 px-1.5 py-0.5 text-micro font-medium uppercase text-neutral-500 dark:bg-neutral-800">{g.status}</span>}
            <span className="tnum">
              <span className="text-display font-extrabold tracking-[-0.02em]">{formatMetric(kind, g.current, g.unit)}</span>
              <span className="ink-faint"> / {formatMetric(kind, g.target, g.unit)}</span>
              <span className="ml-2 text-copy ink-muted">{g.progressPct}%</span>
            </span>
          </span>
        </div>
        <div className="relative mb-2 h-2.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
          <div className={`h-full ${barTone}`} style={{ width: `${g.progressPct}%` }} />
          {g.timePct != null && (
            <div className="absolute top-0 h-full w-px bg-neutral-500" style={{ left: `${g.timePct}%` }} title={`${g.timePct}% of the window elapsed`} />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body ink-muted">
          {g.dueDate ? (
            <span>
              Due {g.dueDate}
              {g.daysLeft != null && (g.daysLeft >= 0 ? ` · ${g.daysLeft} day${g.daysLeft === 1 ? "" : "s"} left` : ` · ${-g.daysLeft} day${g.daysLeft === -1 ? "" : "s"} overdue`)}
              {g.timePct != null && ` · ${g.timePct}% of the window elapsed`}
            </span>
          ) : (
            <span className="ink-faint">No due date — pace cannot be computed without one</span>
          )}
          {g.owner && <span>· {g.owner}</span>}
        </div>
      </Card>

      {/* ── What is holding it up. Above the detail, because it is the answer. ── */}
      {blockers.length > 0 && (
        <Card className="mb-4">
          <BlockLabel>What is holding it up</BlockLabel>
          <div className="space-y-1.5">
            {blockers.map((b, i) => (
              <Link key={i} href={b.href}
                className="flex flex-wrap items-baseline gap-x-2 rounded-control px-2.5 py-1.5 text-copy transition-colors hover:brightness-[0.98]"
                style={{ background: "color-mix(in srgb, var(--color-accent-attention) 8%, transparent)" }}>
                <span aria-hidden className="h-1.5 w-1.5 shrink-0 self-center rounded-full" style={{ background: "var(--color-accent-attention)" }} />
                <b className="ink">{b.label}</b>
                {b.usd != null && b.usd > 0 && <span className="tnum ink-muted">{formatMoney(b.usd)} held up</span>}
                <span className="text-body ink-faint">— {b.detail}</span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* ── The motions carrying it, and the pipeline each has produced ─────── */}
      <Card className="mb-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <BlockLabel className="mb-0">Motions carrying this goal</BlockLabel>
          <Link href="/motions" className="text-label font-semibold text-accent hover:underline dark:text-blue-400">All motions →</Link>
        </div>

        {chain.motions.length === 0 ? (
          /* §9: a purposeful empty state, with the action that actually exists. */
          <div className="rounded-card px-3 py-4 text-copy" style={{ background: "var(--surface-inset)" }}>
            <p className="ink-muted">No motion is linked to this goal yet, so its progress cannot move.</p>
            <Link href="/motions" className="mt-1.5 inline-block text-body font-semibold text-accent hover:underline dark:text-blue-400">
              Link a motion from the Motions room →
            </Link>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto scroll-thin">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>State</th>
                    <th className="text-right">Motion value</th>
                    <th className="text-right">Opportunities</th>
                    <th className="text-right">Open pipeline</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {chain.motions.map((m) => (
                    <tr key={m.id}>
                      <td className="font-semibold">{m.account}</td>
                      <td>
                        <span className={`rounded-full px-2 py-0.5 text-micro font-bold uppercase tracking-[0.04em] ${
                          m.status === "draft"
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                            : "bg-blue-100 text-accent dark:bg-blue-950 dark:text-blue-300"
                        }`}>{m.status}</span>
                      </td>
                      <td className="tnum text-right">{formatMoney(m.valueUsd)}</td>
                      <td className="tnum text-right">
                        {m.oppCount > 0
                          ? m.oppCount
                          : <span className="ink-faint">none yet</span>}
                      </td>
                      <td className="tnum text-right">
                        {m.openPipelineUsd > 0
                          ? formatMoney(m.openPipelineUsd)
                          : <span className="ink-faint">—</span>}
                      </td>
                      <td className="text-right">
                        {/* §6: the pursuit link is ACCOUNT-level, and says so. There is
                            no motion→pursuit foreign key set in this tenant, so calling
                            it "the pursuit this motion created" would be a fabrication. */}
                        {m.pursuitId && (
                          <Link href={`/pursuits/${m.pursuitId}`} className="text-label font-medium text-accent hover:underline dark:text-blue-400"
                            title="Open the pursuit on this account. Related by account, not by motion provenance.">
                            pursuit on this account →
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-2.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t pt-2.5 text-body" style={{ borderColor: "var(--border-subtle)" }}>
              <span className="ink-muted"><b className="ink">{formatMoney(chain.motionValueUsd)}</b> motion-level, across {chain.motions.length}</span>
              <span className="ink-muted"><b className="ink">{formatMoney(chain.openPipelineUsd)}</b> open pipeline, from {chain.oppCount} opportunit{chain.oppCount === 1 ? "y" : "ies"}</span>
              {live.length > 0 && chain.motionsWithoutPipeline > 0 && (
                <span style={{ color: "var(--color-accent-attention)" }}>
                  {chain.motionsWithoutPipeline} of {chain.motions.length} have produced nothing yet
                </span>
              )}
            </div>
          </>
        )}

        {/* §8/§10: the two money figures on this page are different measures and a
            reader will notice they do not add up. Named here, at the numbers,
            rather than left to be discovered as an apparent inconsistency. */}
        <Disclosure summary="Why the two totals differ" className="mt-3">
          Goal progress is computed at the <b>motion</b> level — the estimated value of each motion
          linked to this goal. Open pipeline is computed at the <b>opportunity</b> level — the amount on
          each opportunity that names one of those motions as its origin. They count different objects
          at different stages, so they are not expected to match, and neither is derived from the other.
        </Disclosure>
      </Card>

      {/* Contributing partners — carried over from the index, same source. */}
      {g.contributors.length > 0 && (
        <Card>
          <BlockLabel>Contributing partners</BlockLabel>
          <div className="space-y-1">
            {g.contributors.map((c) => (
              <div key={c.name} className="flex items-center gap-3 text-body">
                <Link href="/partners" className="w-28 shrink-0 truncate font-medium ink-soft hover:underline">{c.name}</Link>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                  <div className="h-full rounded-full" style={{ width: `${g.current > 0 ? Math.round((c.usd / g.current) * 100) : 0}%`, background: "var(--color-route)" }} />
                </div>
                <span className="tnum w-16 shrink-0 text-right font-semibold">{formatMoney(c.usd)}</span>
                <span className="w-20 shrink-0 text-right text-label ink-faint">{c.motions} motion{c.motions === 1 ? "" : "s"}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-label ink-faint">Motion-level share, from the same linked motions the progress bar is computed over.</p>
        </Card>
      )}
    </main>
  );
}
