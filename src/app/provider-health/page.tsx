import { getPool } from "@/db/client";
import { Card, PageHeader, Disclosure, BlockLabel } from "@/components/ui";
import { RoomTabs } from "@/components/room-tabs";
import { EvidenceModel } from "@/components/evidence-model";
import { loadProviderHealth, TIER_LABELS, type ProviderHealthRow } from "@/lib/intel/provider-health";
import {
  providerLabel, evidenceKind, healthState, healthSummary, freshness,
  HEALTH_LABEL, HEALTH_TONE, HEALTH_MEANING, type HealthState,
} from "@/lib/intel/provider-presentation";

export const dynamic = "force-dynamic";

/**
 * Provider health (Wave 5 §6/§10) — operating confidence in the inputs.
 *
 * WHAT WAS WRONG. The room answered "what is in the registry" when the question
 * is "can I trust what this system knows right now?". Three tables of eleven
 * columns each rendered the registry's own identifiers as the primary column
 * (`pdl_company`, `sec_edgar`, `http_fingerprint`), raw enum constants as the
 * type and cost (`FIRMOGRAPHIC`, `LOW_COST`, `PUBLIC_COMPANY`), and raw failure
 * codes in a footer (`builtwith_domain: DISABLED_NO_CREDITS`). Nineteen rows ×
 * eleven columns, almost every cell an em-dash, and the health of the feeds —
 * the only thing the room exists to convey — was nowhere stated.
 *
 * WHAT IT DOES NOW. Health leads, in §10's six-state vocabulary, with a headline
 * that answers the question in one line. Each feed is named for what it is, says
 * what evidence it produces, when it last refreshed, and what its state means.
 * Run counts, cost and the failure text are all preserved behind disclosure —
 * that detail is real and occasionally needed, it simply is not the headline.
 *
 * Presentation only: no provider is renamed in the registry, no integration is
 * called, no run behaviour changes.
 */
export default async function ProviderHealthPage() {
  const pool = getPool();
  const rows = await loadProviderHealth(pool);
  const now = Date.now();
  const summary = healthSummary(rows, now);

  // Group by tier, preserving the tier/priority sort from the loader.
  const groups: { tier: string; rows: ProviderHealthRow[] }[] = [];
  for (const r of rows) {
    let g = groups.find((x) => x.tier === r.tier);
    if (!g) groups.push((g = { tier: r.tier, rows: [] }));
    g.rows.push(r);
  }

  /* §10: the states worth showing as counts, in the order an operator cares. A
     state with no members is omitted rather than shown as a zero — an absent
     failure mode is not an instrument reading. */
  const chips: { state: HealthState; n: number }[] = (
    ["unavailable", "stale", "degraded", "healthy", "not_configured", "disabled", "never_run"] as HealthState[]
  ).map((s) => ({ state: s, n: summary.by.get(s) ?? 0 })).filter((c) => c.n > 0);
  const unconfigured = summary.by.get("not_configured") ?? 0;

  return (
    <main>
      <PageHeader
        title="Provider health"
        subtitle="Whether the feeds this system depends on are healthy enough to trust."
      />
      <RoomTabs tabs={[{ href: "/sources", label: "Sources" }, { href: "/provider-health", label: "Provider health" }]} />
      <EvidenceModel
        current="health"
        steps={{
          health: {
            detail:
              summary.needsAttention === 0
                ? `${rows.length} feeds, none failing`
                : `${summary.needsAttention} of ${rows.length} need attention`,
          },
        }}
      />

      {/* The headline: one sentence, before any table. */}
      <Card className="mb-4">
        <p className="text-title font-semibold ink">
          {summary.needsAttention === 0
            ? `No feed is failing or stale.`
            : `${summary.needsAttention} of ${rows.length} feeds need attention.`}
        </p>
        <p className="mt-1 text-body ink-muted">
          {summary.needsAttention === 0
            ? unconfigured > 0
              ? `${unconfigured} of the ${rows.length} registered feeds cannot run until an account, key or credit is in place — that is a spend or entitlement decision, not a fault, and the rest are working or waiting to be called.`
              : "Nothing is failing, and nothing has gone stale."
            : "A stale feed needs a refresh; an unavailable one needs investigating; one that is not configured is a spend or entitlement decision — they are not the same problem."}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {chips.map(({ state, n }) => (
            <span key={state} className="inline-flex items-baseline gap-1.5 rounded-full px-2.5 py-1 text-label font-semibold"
              style={{ color: HEALTH_TONE[state].color, background: HEALTH_TONE[state].background }}>
              <b className="tnum">{n}</b> {HEALTH_LABEL[state]}
            </span>
          ))}
        </div>
      </Card>

      {/*
        §6/§12 — density. Giving all nineteen feeds a full card ran the room to
        2,700px, and in this workspace sixteen of them share one benign state:
        registered, never run here. A room that exists to answer "is anything
        wrong?" should not make the reader scroll past sixteen identical "nothing
        is wrong" cards to find out. Feeds that have run, or that need a decision,
        get the full card; the untouched majority is listed compactly underneath
        with the same names and states, nothing hidden.
      */}
      {groups.map((g) => {
        const notable = g.rows.filter((r) => healthState(r, now) !== "never_run");
        const quiet = g.rows.filter((r) => healthState(r, now) === "never_run");
        return (
        <div key={g.tier} className="mb-5">
          <BlockLabel>{TIER_LABELS[g.tier] ?? g.tier}</BlockLabel>
          <div className="space-y-1.5">
            {notable.map((r) => {
              const state = healthState(r, now);
              const fresh = freshness(r, now);
              return (
                <Card key={r.providerId}>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-copy font-semibold ink">{providerLabel(r.providerId)}</span>
                    <span className="rounded-full px-2 py-0.5 text-micro font-bold uppercase tracking-[0.04em]"
                      style={{ color: HEALTH_TONE[state].color, background: HEALTH_TONE[state].background }}>
                      {HEALTH_LABEL[state]}
                    </span>
                    <span className="text-body ink-muted">{evidenceKind(r.providerType)}</span>
                    <span className="ml-auto text-label ink-faint">
                      {fresh ?? "no runs recorded here"}
                    </span>
                  </div>

                  <p className="mt-1 text-body ink-faint">
                    {r.purpose}
                    <span aria-hidden> · </span>
                    <span className="ink-muted">{HEALTH_MEANING[state]}</span>
                  </p>

                  {/* Everything the previous eleven columns carried, kept intact —
                      run counts, spend, and the failure text — one click away. The
                      identifier lives here too, for whoever needs to grep for it. */}
                  <Disclosure summary="Run detail" className="mt-2">
                    <div className="flex flex-wrap gap-x-5 gap-y-1">
                      <span>Runs recorded: <b>{r.runs || 0}</b>{r.runs > 0 && <> — {r.succeeded} succeeded, {r.failed} failed, {r.skipped} skipped</>}</span>
                      <span>Evidence produced: <b>{r.evidence || 0}</b></span>
                      {r.costUsd > 0 && <span>Spend to date: <b>${r.costUsd.toFixed(2)}</b></span>}
                      <span>Last run: <b>{r.lastRunAt ? new Date(r.lastRunAt).toISOString().slice(0, 10) : "never"}</b></span>
                      <span className="ink-faint">Registry id: <code className="font-mono">{r.providerId}</code></span>
                    </div>
                    {r.recentRuns.length > 0 && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="ink-faint">Recent runs, oldest first:</span>
                        <RunSparkline runs={r.recentRuns} />
                      </div>
                    )}
                    {r.disabledReason && (
                      <p className="mt-2">Reported reason: <code className="font-mono ink-muted">{r.disabledReason}</code></p>
                    )}
                    {r.lastError && (
                      <p className="mt-1" style={{ color: "var(--color-accent-risk)" }}>
                        Last error: <span className="ink-muted">{r.lastError.slice(0, 200)}</span>
                      </p>
                    )}
                  </Disclosure>
                </Card>
              );
            })}
          </div>

          {quiet.length > 0 && (
            <Card className={notable.length > 0 ? "mt-1.5" : ""}>
              <p className="text-body ink-muted">
                <b className="ink">{quiet.length}</b> more registered here but not yet run —
                they produce nothing until a screening or deep run calls them.
              </p>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-label ink-faint">
                {quiet.map((r) => (
                  <span key={r.providerId}>{providerLabel(r.providerId)}</span>
                ))}
              </div>
            </Card>
          )}
        </div>
        );
      })}
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
