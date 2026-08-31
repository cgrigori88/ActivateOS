import Link from "next/link";
import type { MotionFunnelView, FunnelAccount, MotionConstraint } from "@/lib/motions/funnel";
import { accountsAtStage } from "@/lib/motions/funnel";
import { DrawerKeys } from "@/components/intel/drawer-keys";

/**
 * Motion command view (Intelligence Wave P1A.1/P1A.5). The first viewport of a Motion: the
 * commercial funnel derived at read time from canonical records, cohorts, the canonical outcome
 * rollup with an explicit small-sample caveat, and the signature interaction — "why aren't the
 * other accounts ready?" — opening the constraint decomposition drawer. Every number is a link;
 * every chip is a canonical constraint with a governed remedy or deep link. Calm surface, dense
 * intelligence: one compact card per hypothesis, no card walls.
 */

const money = (n: number | null) => (n == null ? null : n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}k`);
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
                  <b>{money(f.addressableUsd)}</b> <span className="text-neutral-500">addressable</span>
                  {f.readyUsd != null && <> · <b style={{ color: "var(--color-accent-verified)" }}>{money(f.readyUsd)}</b> <span className="text-neutral-500">ready</span></>}
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

            {/* Canonical outcome rollup — conservative with small samples (P1A.4). */}
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
 * Constraint decomposition drawer (P1A.2) — the "why aren't they ready" answer. Server-rendered
 * only when open (nothing serialized while closed); reuses the standard drawer shell so scope,
 * filters and scroll survive. Each account lists its gating constraints as canonical chips with
 * the governed remedy, then informational overlays dimmed beneath.
 */
const DRAWER_PAGE = 30;

export function MotionConstraintDrawer({ funnel, stage, closeHref }: { funnel: MotionFunnelView; stage: string; closeHref: string }) {
  const accounts = accountsAtStage(funnel, stage);
  const title = stage === "not_ready" ? `Why aren't ${accounts.length} accounts ready?`
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
        <p className="mb-3 text-[11px] text-neutral-400">Ranked by expected value. Every chip is a canonical constraint — timing UNKNOWN stays unknown, nothing is inferred.</p>

        {accounts.length === 0 ? (
          <p className="text-[13px] italic text-neutral-500">No accounts in this cut.</p>
        ) : (
          <div className="space-y-3">
            {accounts.slice(0, DRAWER_PAGE).map((a) => <AccountRow key={a.companyId} a={a} />)}
            {accounts.length > DRAWER_PAGE && (
              <p className="text-[11.5px] text-neutral-400">+ {accounts.length - DRAWER_PAGE} more — narrow the scope or open the account list.</p>
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
  const hue = COHORT_META[a.cohort].hue;
  return (
    <div className="rounded-card p-3" style={{ background: "var(--surface-inset)", boxShadow: "inset 0 0 0 1px var(--border-subtle)" }}>
      <div className="flex items-baseline justify-between gap-2">
        <Link href={a.pursuitId ? `/pursuits/${a.pursuitId}` : `/accounts/${a.companyId}`} className="min-w-0 truncate text-[13px] font-semibold hover:underline">{a.name}</Link>
        <span className="flex shrink-0 items-center gap-2 text-[11px]">
          {a.expectedValue != null && <span className="tnum font-semibold">{money(a.expectedValue)}</span>}
          <span className="rounded-full px-1.5 py-px font-semibold" style={{ color: hue, background: `color-mix(in srgb, ${hue} 12%, transparent)` }}>{COHORT_META[a.cohort].label}</span>
        </span>
      </div>
      {gating.length === 0 ? (
        <p className="mt-1 text-[12px]" style={{ color: "var(--color-accent-verified)" }}>All gates pass — execution-ready.</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {gating.map((c, i) => <ConstraintChip key={i} c={c} />)}
        </ul>
      )}
      {info.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {info.map((c, i) => (
            <li key={i} className="text-[11px] text-neutral-400">◦ {c.label}{c.remedy && <> · <Link href={c.remedy.deepLink} className="hover:underline">{c.remedy.label}</Link></>}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ConstraintChip({ c }: { c: MotionConstraint }) {
  const hue = c.severity === "HARD" ? "var(--color-accent-risk)" : c.severity === "UNKNOWN" ? "var(--color-neutral-500, #737373)" : "var(--color-accent-attention)";
  return (
    <li className="flex items-start gap-1.5 text-[12px]">
      <span aria-hidden className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: hue }} />
      <span className="min-w-0">
        {c.label}
        {c.remedy && (
          <Link href={c.remedy.deepLink} className="ml-1.5 font-medium hover:underline" style={{ color: "var(--color-route)" }}>
            {c.remedy.label} →
          </Link>
        )}
      </span>
    </li>
  );
}
