import Link from "next/link";
import type { MotionFunnelView, FunnelAccount } from "@/lib/motions/funnel";
import { accountsAtStage, aggregateConstraints, primaryConstraint } from "@/lib/motions/funnel";
import { ConstraintLine, ConstraintAggregateRow, usd, severityHue } from "@/components/intel/constraint-language";
import { DrawerKeys } from "@/components/intel/drawer-keys";

/**
 * Motion command surfaces (Intelligence Wave P1A, normalized in the UX pass). Simple by default,
 * complete on demand:
 *   Overview    — the hypothesis funnel, cohorts, $, honest outcome summary. Nothing else.
 *   Constraints — canonical blockers aggregated by family × count × commercial exposure.
 *   Pursuits    — the whole cut as ONE compact scale-native table (no card walls).
 *   (Manage — the pre-existing motion-instance operations — lives on the page, off the default.)
 * All derived at read time from the same funnel read-model; the drawer is the shared drill-in.
 */

const COHORT_META: Record<string, { label: string; hue: string }> = {
  ready: { label: "execution-ready", hue: "var(--color-accent-verified)" },
  nearly_ready: { label: "nearly ready", hue: "var(--color-timing)" },
  blocked: { label: "blocked", hue: "var(--color-accent-attention)" },
  unknown: { label: "unknown", hue: "var(--color-neutral-500, #737373)" },
};

export function MotionFunnelCommand({ funnels, qs }: { funnels: MotionFunnelView[]; qs: (extra: Record<string, string | null>) => string }) {
  if (funnels.length === 0) return null;
  return (
    <section className="mb-6 space-y-3">
      {funnels.map((f) => {
        const notReady = f.stages.find((s) => s.key === "evaluated")!.count - f.cohorts.ready;
        const o = f.outcomes;
        const hasOutcomes = o.won + o.lost + o.noDecision > 0;
        return (
          <div key={f.hypothesis.taxonomyNodeId} className="pos-card rounded-card p-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-[15px] font-extrabold tracking-[-0.01em]">{f.hypothesis.name}</h2>
              <span className="text-xs text-neutral-400">{f.hypothesis.slug}</span>
              {f.addressableUsd != null && (
                <span className="ml-auto text-[12.5px] tnum">
                  <b>{usd(f.addressableUsd)}</b> <span className="text-neutral-500">addressable</span>
                  {f.readyUsd != null && <> · <b style={{ color: "var(--color-accent-verified)" }}>{usd(f.readyUsd)}</b> <span className="text-neutral-500">ready</span></>}
                </span>
              )}
            </div>
            {f.hypothesis.thesis && <p className="mt-1 max-w-[90ch] text-[12.5px] leading-snug text-neutral-500">{f.hypothesis.thesis}</p>}

            {/* The funnel — each stage count is a drill-in, derived at read time. */}
            <div className="mt-3 flex flex-wrap items-center gap-y-1.5 text-[13px]">
              {f.stages.map((s, i) => (
                <span key={s.key} className="inline-flex items-center">
                  {i > 0 && <span aria-hidden className="mx-2 text-neutral-300 dark:text-neutral-600">→</span>}
                  <Link href={qs({ mdrawer: f.hypothesis.taxonomyNodeId, mstage: s.key })} scroll={false}
                    className="group inline-flex items-baseline gap-1 rounded-control px-1.5 py-0.5 hover:bg-neutral-900/[0.05] dark:hover:bg-white/[0.06]">
                    <b className="tnum text-[14px]" style={s.key === "execution_ready" ? { color: "var(--color-accent-verified)" } : undefined}>{s.count}</b>
                    <span className="text-neutral-500 group-hover:underline">{s.label}</span>
                  </Link>
                </span>
              ))}
            </div>

            {/* Cohorts + the signature interaction */}
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {(Object.keys(COHORT_META) as (keyof typeof COHORT_META)[]).map((k) => f.cohorts[k as keyof typeof f.cohorts] > 0 && (
                <Link key={k} href={qs({ mdrawer: f.hypothesis.taxonomyNodeId, mstage: k })} scroll={false}
                  className="rounded-full px-2 py-px text-[11px] font-semibold hover:opacity-80"
                  style={{ color: COHORT_META[k].hue, background: `color-mix(in srgb, ${COHORT_META[k].hue} 12%, transparent)` }}>
                  {f.cohorts[k as keyof typeof f.cohorts]} {COHORT_META[k].label}
                </Link>
              ))}
              {notReady > 0 && (
                <Link href={qs({ mdrawer: f.hypothesis.taxonomyNodeId, mstage: "not_ready" })} scroll={false}
                  className="ml-auto rounded-control px-2.5 py-1 text-[12px] font-semibold"
                  style={{ color: "var(--color-route)", boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--color-route) 30%, transparent)" }}>
                  Why aren&rsquo;t the other {notReady} ready?
                </Link>
              )}
            </div>

            {/* Canonical outcome rollup — conservative with small samples (P1A.4). Depth lives in
                Insights (the analytical destination) — deliberately not duplicated here. */}
            <p className="mt-2.5 text-[11.5px] text-neutral-500">
              {o.pursuitsActivated > 0 && <>{o.pursuitsActivated} motion{o.pursuitsActivated === 1 ? "" : "s"} active · </>}
              {o.opportunitiesCreated > 0 && <>{o.opportunitiesCreated} opportunities (canonical linkage) · </>}
              {hasOutcomes ? (
                <>
                  {o.calibrated ? "Outcomes: " : "Early observed outcomes: "}
                  <b style={{ color: "var(--color-accent-verified)" }}>{o.won} won</b> · {o.lost} lost{o.noDecision > 0 && <> · {o.noDecision} no decision</>}
                  {Object.keys(o.byAttributionClass).length > 0 && (
                    <> · attribution {Object.entries(o.byAttributionClass).map(([k, v]) => `${v} ${k}`).join(", ")}</>
                  )}
                  {!o.calibrated && <span className="text-neutral-400"> — sample too small for calibrated performance conclusions.</span>}
                  {" · "}<Link href="/insights" className="hover:underline" style={{ color: "var(--color-route)" }}>calibration in Insights →</Link>
                </>
              ) : (
                <span className="text-neutral-400">No terminal outcomes observed yet.</span>
              )}
            </p>
          </div>
        );
      })}
    </section>
  );
}

/**
 * Constraints view — the canonical blockers as commercial exposure, aggregated by family (pure
 * presentation over the funnel; PRIMARY blocker per account, so figures reconcile to the cohort
 * counts). Clicking a family opens the drawer scoped to exactly those pursuits.
 */
export function MotionConstraintsPanel({ funnels, qs }: { funnels: MotionFunnelView[]; qs: (extra: Record<string, string | null>) => string }) {
  return (
    <section className="mb-6 space-y-3">
      {funnels.map((f) => {
        const agg = aggregateConstraints(f);
        return (
          <div key={f.hypothesis.taxonomyNodeId} className="pos-card rounded-card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[15px] font-extrabold tracking-[-0.01em]">{f.hypothesis.name}</h2>
              <span className="tnum text-[13px]">
                {agg.totalUsd > 0 ? <><b>{usd(agg.totalUsd)}</b> <span className="text-neutral-500">currently constrained</span></> : <span className="text-neutral-500">nothing constrained</span>}
              </span>
            </div>
            {agg.rows.length === 0 ? (
              <p className="mt-2 text-[12.5px] text-neutral-500">Every evaluated account is execution-ready.</p>
            ) : (
              <div className="mt-2 space-y-0.5">
                {agg.rows.map((r) => (
                  <ConstraintAggregateRow key={r.family} label={r.label} count={r.count} exposureUsd={r.exposureUsd}
                    severity={r.severity} href={qs({ mdrawer: f.hypothesis.taxonomyNodeId, mstage: `family:${r.family}` })} />
                ))}
              </div>
            )}
            {/* Informational overlays (P1C §12) — real canonical signals that never gate:
                stakeholder coverage, weak evidence, contested routes. Kept visually apart from the
                gating rows so the constrained-$ figure stays reconciled to the funnel cohorts. */}
            {agg.overlays.length > 0 && (
              <div className="mt-2 border-t border-neutral-200/70 pt-1.5 dark:border-neutral-800">
                <span className="px-2.5 text-[10px] font-bold uppercase tracking-[0.05em] text-neutral-400">Informational — never gates</span>
                <div className="mt-0.5 space-y-0.5">
                  {agg.overlays.map((r) => (
                    <ConstraintAggregateRow key={r.family} label={r.label} count={r.count} exposureUsd={r.exposureUsd}
                      severity={r.severity} href={qs({ mdrawer: f.hypothesis.taxonomyNodeId, mstage: `family:${r.family}` })} />
                  ))}
                </div>
              </div>
            )}
            <p className="mt-2 text-[10.5px] text-neutral-400">Grouped by each pursuit&rsquo;s primary blocker — the first failing canonical gate. Click a row for the exact pursuits.</p>
          </div>
        );
      })}
    </section>
  );
}

/**
 * Pursuits view — the whole cut as ONE compact scale-native table (Account · readiness · primary
 * constraint · route · team · value · outcome). No card walls; rows deep-link; capped with an
 * honest remainder note (scope/filters narrow further).
 */
const TABLE_CAP = 60;
export function MotionPursuitsTable({ funnels, qs }: { funnels: MotionFunnelView[]; qs: (extra: Record<string, string | null>) => string }) {
  return (
    <section className="mb-6 space-y-3">
      {funnels.map((f) => (
        <div key={f.hypothesis.taxonomyNodeId} className="pos-card rounded-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-extrabold tracking-[-0.01em]">{f.hypothesis.name}</h2>
            <span className="text-[11.5px] text-neutral-500">{f.accounts.length} evaluated · ranked by expected value</span>
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
              <thead>
                <tr className="text-left text-[10px] font-bold uppercase tracking-[0.04em] text-neutral-500">
                  <th className="px-2 py-1.5">Account</th><th className="px-2 py-1.5">Readiness</th>
                  <th className="px-2 py-1.5">Primary constraint</th><th className="px-2 py-1.5">Route</th>
                  <th className="px-2 py-1.5">Team</th><th className="px-2 py-1.5 text-right">Value</th><th className="px-2 py-1.5">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {f.accounts.slice(0, TABLE_CAP).map((a) => {
                  const p = primaryConstraint(a);
                  const hue = COHORT_META[a.cohort].hue;
                  return (
                    <tr key={a.companyId} style={{ borderTop: "1px solid var(--border-subtle)" }}>
                      <td className="px-2 py-1.5">
                        <Link href={a.pursuitId ? `/pursuits/${a.pursuitId}` : `/accounts/${a.companyId}`} className="font-semibold hover:underline">{a.name}</Link>
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="rounded-full px-1.5 py-px text-[10.5px] font-semibold" style={{ color: hue, background: `color-mix(in srgb, ${hue} 12%, transparent)` }}>{COHORT_META[a.cohort].label}</span>
                      </td>
                      <td className="px-2 py-1.5">
                        {p ? (
                          <Link href={qs({ mdrawer: f.hypothesis.taxonomyNodeId, mstage: `family:${p.code.split(":")[0]}` })} scroll={false}
                            className="inline-flex max-w-[260px] items-center gap-1.5 hover:underline" title={p.label}>
                            <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: severityHue(p.severity) }} />
                            <span className="min-w-0 truncate">{p.label}</span>
                          </Link>
                        ) : <span style={{ color: "var(--color-accent-verified)" }}>all gates pass</span>}
                      </td>
                      <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-300">
                        {a.routeLabel ? <>{a.routeLabel}{a.routeDecided ? "" : <span className="text-neutral-400"> · undecided</span>}</> : <span className="text-neutral-400">—</span>}
                      </td>
                      <td className="tnum px-2 py-1.5 text-neutral-600 dark:text-neutral-300">
                        {a.team.required > 0 ? <>{a.team.accepted}/{a.team.required}{a.team.pending > 0 && <span style={{ color: "var(--color-timing)" }}> · {a.team.pending} pending</span>}</> : "—"}
                      </td>
                      <td className="tnum px-2 py-1.5 text-right font-semibold">{usd(a.expectedValue) ?? "—"}</td>
                      <td className="px-2 py-1.5 text-[11.5px]">
                        {a.latestOutcome ? <span className={a.latestOutcome === "CLOSED_WON" ? "font-semibold" : "text-neutral-500"} style={a.latestOutcome === "CLOSED_WON" ? { color: "var(--color-accent-verified)" } : undefined}>{a.latestOutcome.replace(/_/g, " ").toLowerCase()}</span> : <span className="text-neutral-400">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {f.accounts.length > TABLE_CAP && (
            <p className="mt-2 text-[11.5px] text-neutral-400">Showing the top {TABLE_CAP} by expected value — narrow the scope to see a specific cut.</p>
          )}
        </div>
      ))}
    </section>
  );
}

/**
 * Constraint decomposition drawer (P1A.2, compressed in the UX pass). Two-second rule: each entry
 * defaults to account · value · readiness + the PRIMARY blocker with its evidence-grounded line,
 * then "+N additional constraints" expands to the full decomposition with governed remedies and
 * informational overlays. Nothing removed — re-layered. Server-rendered only when open.
 */
const DRAWER_PAGE = 30;

export function MotionConstraintDrawer({ funnel, stage, closeHref }: { funnel: MotionFunnelView; stage: string; closeHref: string }) {
  const accounts = accountsAtStage(funnel, stage);
  const famAgg = stage.startsWith("family:") ? aggregateConstraints(funnel) : null;
  const famLabel = famAgg ? (famAgg.rows.find((r) => r.family === stage.slice(7)) ?? famAgg.overlays.find((r) => r.family === stage.slice(7)))?.label : null;
  const title = famLabel ? `${famLabel} — ${funnel.hypothesis.name}`
    : stage === "not_ready" ? `Why aren't ${accounts.length} accounts ready?`
    : COHORT_META[stage] ? `${COHORT_META[stage].label} — ${funnel.hypothesis.name}`
    : `${funnel.stages.find((s) => s.key === stage)?.label ?? stage} — ${funnel.hypothesis.name}`;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <DrawerKeys closeHref={closeHref} />
      <Link href={closeHref} scroll={false} aria-label="Close" className="absolute inset-0 bg-neutral-950/50 backdrop-blur-[3px]" />
      <aside className="absolute inset-y-0 right-0 flex w-[min(480px,94vw)] flex-col overflow-y-auto border-l p-4 scroll-thin"
        style={{ background: "var(--surface-sheet)", borderColor: "var(--border-emphasis)", boxShadow: "var(--shadow-float)" }}>
        <div className="mb-1 flex items-start justify-between gap-2">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-400">{funnel.hypothesis.name} · constraint decomposition</div>
            <h2 className="mt-0.5 text-[15px] font-extrabold leading-tight">{title}</h2>
          </div>
          <Link href={closeHref} scroll={false} aria-label="Close" className="rounded-control px-2 py-0.5 text-sm text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200" style={{ boxShadow: "inset 0 0 0 1px var(--border-subtle)" }}>✕</Link>
        </div>
        <p className="mb-3 text-[11px] text-neutral-400">Ranked by expected value. The primary blocker leads; expand for the full canonical decomposition. UNKNOWN stays unknown — nothing is inferred.</p>

        {accounts.length === 0 ? (
          <p className="text-[13px] italic text-neutral-500">No accounts in this cut.</p>
        ) : (
          <div className="space-y-2">
            {accounts.slice(0, DRAWER_PAGE).map((a) => <AccountRow key={a.companyId} a={a} />)}
            {accounts.length > DRAWER_PAGE && (
              <p className="text-[11.5px] text-neutral-400">+ {accounts.length - DRAWER_PAGE} more — narrow the scope or open the Pursuits view.</p>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function AccountRow({ a }: { a: FunnelAccount }) {
  const gating = a.constraints.filter((c) => c.gating);
  const info = a.constraints.filter((c) => !c.gating);
  const p = primaryConstraint(a);
  const rest = gating.length - (p ? 1 : 0);
  const hue = COHORT_META[a.cohort].hue;
  return (
    <div className="rounded-card p-3" style={{ background: "var(--surface-inset)", boxShadow: "inset 0 0 0 1px var(--border-subtle)" }}>
      {/* Line 1 — account · value · readiness state (the two-second read). */}
      <div className="flex items-baseline justify-between gap-2">
        <Link href={a.pursuitId ? `/pursuits/${a.pursuitId}` : `/accounts/${a.companyId}`} className="min-w-0 truncate text-[13px] font-semibold hover:underline">{a.name}</Link>
        <span className="flex shrink-0 items-center gap-2 text-[11px]">
          {a.expectedValue != null && <span className="tnum font-semibold">{usd(a.expectedValue)}</span>}
          <span className="rounded-full px-1.5 py-px font-semibold" style={{ color: hue, background: `color-mix(in srgb, ${hue} 12%, transparent)` }}>{COHORT_META[a.cohort].label}</span>
        </span>
      </div>
      {/* Line 2 — the PRIMARY blocker, evidence-grounded, with its governed remedy. */}
      {p ? (
        <div className="mt-1.5">
          <span className="text-[9.5px] font-bold uppercase tracking-[0.06em]" style={{ color: severityHue(p.severity) }}>Primary blocker</span>
          <ConstraintLine c={{ blockedBy: p.label, severity: p.severity, action: p.remedy ? { label: p.remedy.label, deepLink: p.remedy.deepLink } : null }} />
        </div>
      ) : (
        <p className="mt-1 text-[12px]" style={{ color: "var(--color-accent-verified)" }}>All gates pass — execution-ready.</p>
      )}
      {/* Expand on demand — the complete decomposition, nothing removed. */}
      {(rest > 0 || info.length > 0) && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[11px] font-medium text-neutral-500 hover:underline">
            +{rest + info.length} additional constraint{rest + info.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-1.5 space-y-1">
            {gating.filter((c) => c !== p).map((c, i) => (
              <li key={i}><ConstraintLine dense c={{ blockedBy: c.label, severity: c.severity, action: c.remedy ? { label: c.remedy.label, deepLink: c.remedy.deepLink } : null }} /></li>
            ))}
            {info.map((c, i) => (
              <li key={`i${i}`} className="text-[11px] text-neutral-400">◦ {c.label}{c.remedy && <> · <Link href={c.remedy.deepLink} className="hover:underline">{c.remedy.label}</Link></>}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
