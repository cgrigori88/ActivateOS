import type { PursuitOutcomeSummary } from "@/lib/pursuits/read-models/outcome-summary";
import { titleEnum } from "./vocab";
import { formatMoney } from "@/lib/format/money";

/**
 * Outcome & attribution surface (Phase B3). States the latest commercial outcome, the attribution
 * CLAIM (Outcome ≠ Attribution), why it was assigned, and whether the learning recompute has
 * settled. Calm and evidence-bound: no invented causality, UNKNOWN shown as UNKNOWN.
 */
const CLASS_HUE: Record<string, string> = {
  SOURCE: "var(--color-accent-verified)", INFLUENCED: "var(--color-route)", ASSISTED: "var(--color-accent-intelligence)",
  OBSERVED: "var(--color-neutral-500)", UNKNOWN: "var(--color-accent-attention)",
};
const money = (n: number | null) => (n == null ? null : formatMoney(n));

export function OutcomePanel({ summary }: { summary: PursuitOutcomeSummary }) {
  const { latest, attribution: a } = summary;
  if (!latest) {
    return <p className="text-body text-neutral-500">No commercial outcome recorded yet — outcomes flow in when an opportunity closes or a motion completes.</p>;
  }
  const hue = a ? CLASS_HUE[a.effectiveClass] ?? "var(--color-neutral-500)" : "var(--color-neutral-500)";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="rounded-control px-2.5 py-1 text-copy font-bold"
          style={{ background: latest.isTerminal ? "color-mix(in srgb, var(--color-accent-verified) 12%, var(--surface-primary))" : "var(--surface-inset)", boxShadow: "inset 0 0 0 1px var(--border-subtle)" }}>
          {titleEnum(latest.label)}
        </span>
        {money(latest.valueAmount) && <span className="text-copy font-semibold">{money(latest.valueAmount)}</span>}
        <span className="text-label text-neutral-500">{new Date(latest.occurredAt).toISOString().slice(0, 10)}</span>
        {latest.isTerminal && <span className="text-micro font-bold uppercase tracking-[0.04em] text-neutral-400">terminal</span>}
      </div>

      {a ? (
        <div className="rounded-card p-3" style={{ background: "var(--surface-inset)", boxShadow: "inset 0 0 0 1px var(--border-subtle)" }}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-micro font-bold uppercase tracking-[0.04em] text-neutral-400">Attribution</span>
            <span className="rounded-full px-2 py-px text-label font-bold" style={{ background: `color-mix(in srgb, ${hue} 14%, transparent)`, color: hue }}>{a.effectiveClass}</span>
            {a.subjectLabel && <span className="text-body font-semibold">{a.subjectLabel}</span>}
            {a.overridden && <span className="text-micro text-neutral-500">human override · machine said {a.machineClass}</span>}
          </div>
          {a.reason && <p className="mt-1.5 max-w-[80ch] text-body leading-relaxed text-neutral-600 dark:text-neutral-300">{a.reason}</p>}
          <p className="mt-1 text-micro text-neutral-400">A claim about PursuitOS’s relationship to the outcome — not the outcome itself · {a.modelVersion}</p>
        </div>
      ) : (
        <p className="text-body italic text-neutral-400">Attribution not yet computed for this outcome.</p>
      )}

      {summary.recomputePending ? (
        <div className="inline-flex items-center gap-1.5 text-label text-neutral-500">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: "var(--color-timing)" }} aria-hidden />
          Learning is settling — the outcome’s recompute is still draining.
        </div>
      ) : (
        <p className="text-label text-neutral-400">Recompute complete · {summary.totalOutcomes} outcome{summary.totalOutcomes === 1 ? "" : "s"} on record.</p>
      )}
    </div>
  );
}
