import type { PursuitDetailView, WhyNowView, WhyNowComponent, FactItem, PursuitTeamView, PursuitTimelineView } from "@/lib/pursuits/read-models/types";
import { MetricCell, BandPill, TrustTag, SyntheticBadge, TeamStatusBadge, UnknownState } from "./parts";
import { humanizeText } from "./vocab";

/** Money in a compact, readable form; unknown stays unknown. */
export function money(n: number | null, cur: string | null): string {
  if (n == null) return "—";
  const c = cur || "USD";
  if (Math.abs(n) >= 1000) return new Intl.NumberFormat("en-US", { style: "currency", currency: c, notation: "compact", maximumFractionDigits: 1 }).format(n);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: c, maximumFractionDigits: 0 }).format(n);
}

/**
 * PursuitHero (§10) — the opportunity understandable in ~3 seconds: eyebrow,
 * thesis, one supporting line, compact metadata, then the metric band.
 */
export function PursuitHero({ d, lifecycleWord }: { d: PursuitDetailView; lifecycleWord: string }) {
  const meta: [string, string][] = [
    ["Lifecycle", lifecycleWord],
    ["Expected value", money(d.expectedValue, d.currency)],
    ["Solution", d.solution || "—"],
    ["Last material change", d.lastMaterialChange ? new Date(d.lastMaterialChange).toLocaleDateString() : "—"],
  ];
  return (
    <div>
      <div className="flex items-center gap-2 text-label font-bold uppercase tracking-[0.08em] text-neutral-500">
        <span style={{ color: "var(--color-priority)" }}>Pursuit</span>
        <span aria-hidden>·</span>
        <span>{d.accountLabel}</span>
        {d.synthetic && <SyntheticBadge text="demo" />}
      </div>
      <h1 className="mt-1.5 text-hero font-extrabold leading-[1.08] tracking-[-0.03em]">{d.thesis}</h1>
      <p className="mt-2 max-w-[70ch] text-title text-neutral-500 dark:text-neutral-400">
        One governed commercial Pursuit connecting intent, evidence, route, team and execution.
      </p>
      <div className="mt-3.5 flex flex-wrap gap-x-7 gap-y-2">
        {meta.map(([k, v]) => (
          <div key={k}>
            <div className="text-micro font-bold uppercase tracking-[0.05em] text-neutral-400">{k}</div>
            <div className="mt-0.5 text-copy font-semibold">{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** MetricBand (§11/§12) — six distinct instruments, one band each, never one score. */
export function MetricBand({ scores }: { scores: PursuitDetailView["decisionBand"] }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
      {scores.map((s) => <MetricCell key={s.key} s={s} tone={s.key} />)}
    </div>
  );
}

const WHY_ICON: Record<string, string> = {
  business_trigger: "⚡", technology_condition: "▣", timing_anchor: "◷", signal_convergence: "⌁", route_relevance: "↗",
};
function WhyNowRow({ c, kind, forceLabel }: { c: WhyNowComponent | null; kind: string; forceLabel: string }) {
  return (
    <div className="grid grid-cols-[150px_1fr] gap-3 py-2.5" style={{ borderTop: "1px solid var(--border-subtle)" }}>
      <div className="flex items-center gap-2 text-body font-semibold text-neutral-600 dark:text-neutral-300">
        <span aria-hidden className="text-neutral-400">{WHY_ICON[kind] ?? "•"}</span>{c?.label ?? forceLabel}
      </div>
      <div>
        {c?.present && c.detail
          ? <>
              <div className="text-copy font-semibold">{c.detail}</div>
              {c.commercialImplication && <div className="mt-0.5 text-label text-neutral-500">{c.commercialImplication}</div>}
              {c.refId && <div className="mt-0.5 text-label font-semibold" style={{ color: "var(--color-band-high)" }}>↳ traceable to source</div>}
            </>
          : <UnknownState>Not yet established</UnknownState>}
      </div>
    </div>
  );
}

/** WhyNowBento (§13) — the assembled commercial thesis, with missing kept visibly missing. */
export function WhyNowBento({ w }: { w: WhyNowView }) {
  if (!w.present) return <p className="text-copy italic text-neutral-500">No structured Why Now assembled yet.</p>;
  return (
    <div>
      <div className="[&>div:first-child]:border-t-0">
        <WhyNowRow c={w.businessTrigger} kind="business_trigger" forceLabel="Business trigger" />
        <WhyNowRow c={w.technologyCondition} kind="technology_condition" forceLabel="Technology condition" />
        <WhyNowRow c={w.timingAnchor} kind="timing_anchor" forceLabel="Timing anchor" />
        <WhyNowRow c={w.signalConvergence} kind="signal_convergence" forceLabel="Signal convergence" />
        <WhyNowRow c={w.routeRelevance} kind="route_relevance" forceLabel="Route relevance" />
      </div>
      {w.contradictions.length > 0 && (
        <div className="mt-3 rounded-card p-3 text-body" style={{ background: "color-mix(in srgb, var(--color-accent-risk) 8%, transparent)" }}>
          <b style={{ color: "var(--color-accent-risk)" }}>Conflicting evidence.</b> {w.contradictions.map((c) => c.text).join("; ")}.
        </div>
      )}
      {w.unknowns.length > 0 && (
        <div className="mt-3 rounded-card p-3" style={{ background: "var(--surface-inset)" }}>
          <div className="text-micro font-bold uppercase tracking-[0.05em] text-neutral-500">What we don’t know yet</div>
          <ul className="mt-1 space-y-0.5 text-body text-neutral-600 dark:text-neutral-300">
            {w.unknowns.map((u, i) => <li key={i} className="flex gap-1.5"><span className="text-neutral-400" aria-hidden>·</span>{u}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

/** FactsBento (§14) — trusted intelligence cards, not database rows. */
export function FactsBento({ facts }: { facts: FactItem[] }) {
  if (!facts.length) return <p className="text-copy italic text-neutral-500">No facts surfaced yet.</p>;
  return (
    <div className="space-y-2.5">
      {facts.map((f) => {
        const proposed = f.state !== "CURRENT";
        const hue = proposed ? "var(--color-accent-violet)" : "var(--color-accent-verified)";
        return (
          <div key={f.id} className="flex items-start justify-between gap-3 rounded-card p-3.5" style={{ background: `color-mix(in srgb, ${hue} 5%, var(--surface-primary))`, boxShadow: "var(--shadow-low)" }}>
            <div>
              <div className="text-copy font-semibold">{f.proposition}</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">{f.trust.map((t) => <TrustTag key={t} label={t} />)}</div>
            </div>
            {f.confidence && (
              <div className="flex-none text-right">
                <BandPill band={f.confidence.band} />
                {f.confidence.known && <div className="tnum mt-0.5 text-micro text-neutral-400">confidence {f.confidence.value}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** PursuitTeamBento (§ team) — acceptance lifecycle + readiness + missing roles. */
export function TeamBento({ team }: { team: PursuitTeamView }) {
  return (
    <div>
      <div className="grid gap-2 sm:grid-cols-2">
        {team.members.map((m, i) => (
          <div key={i} className="flex items-center justify-between gap-2 rounded-card px-3.5 py-2.5" style={{ background: "var(--surface-inset)" }}>
            <div>
              <div className="text-body font-semibold">{m.personLabel ?? m.role.replace(/_/g, " ").toLowerCase()}</div>
              <div className="text-label text-neutral-400">{m.personLabel ? m.role.replace(/_/g, " ").toLowerCase() : `${m.side.toLowerCase()} side`}</div>
            </div>
            <TeamStatusBadge status={m.status} />
          </div>
        ))}
      </div>
      {team.missingRequiredRoles.length > 0 && (
        <div className="mt-2.5 rounded-card p-3 text-body" style={{ background: "color-mix(in srgb, var(--color-accent-attention) 9%, transparent)" }}>
          <b style={{ color: "var(--color-accent-attention)" }}>Readiness held.</b> Required role(s) not yet accepted: {team.missingRequiredRoles.map((r) => r.replace(/_/g, " ").toLowerCase()).join(", ")}.
        </div>
      )}
    </div>
  );
}

/** MaterialChangeTimeline (§ what changed) — material events only, never an audit log. */
export function MaterialChangeTimeline({ timeline }: { timeline: PursuitTimelineView }) {
  if (!timeline.events.length) return <p className="text-copy italic text-neutral-500">No material changes yet.</p>;
  return (
    <div>
      {timeline.events.map((e, i) => {
        const high = e.materiality === "HIGH" || e.materiality === "CRITICAL";
        const hue = high ? "var(--color-accent-risk)" : "var(--color-band-high)";
        return (
          <div key={i} className="grid grid-cols-[14px_1fr] gap-3 py-2.5" style={{ borderTop: i ? "1px solid var(--border-subtle)" : "none" }}>
            <span className="mt-1.5 h-2 w-2 rounded-full" style={{ background: hue }} aria-hidden />
            <div>
              <div className="flex flex-wrap items-center gap-2 text-copy font-semibold">
                {humanizeText(e.label)}
                {high && <span className="rounded px-1.5 py-0.5 text-micro font-bold uppercase" style={{ color: "var(--color-accent-risk)", background: "color-mix(in srgb, var(--color-accent-risk) 12%, transparent)" }}>{e.materiality}</span>}
                {e.synthetic && <SyntheticBadge />}
              </div>
              <div className="tnum mt-0.5 text-label text-neutral-400">{new Date(e.at).toLocaleString()} · {e.changeType.replace(/_/g, " ").toLowerCase()}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
