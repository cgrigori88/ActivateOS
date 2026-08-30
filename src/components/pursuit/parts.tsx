import type { Band, ScoreView } from "@/lib/pursuits/read-models/types";

/**
 * Pursuit presentational parts (Workstream D). Status is form + label, never colour alone (§35):
 * every band carries a word. Scores render band-first with the exact value secondary (§10) and a
 * consistent "why" affordance (§29). These render from read-model view objects only.
 */

const BAND_WORD: Record<Band, string> = { very_high: "Very high", high: "High", moderate: "Moderate", low: "Low", unknown: "Unknown" };
const BAND_CLASS: Record<Band, string> = {
  very_high: "text-emerald-600 dark:text-emerald-400",
  high: "text-blue-600 dark:text-blue-400",
  moderate: "text-amber-600 dark:text-amber-400",
  low: "text-slate-500",
  unknown: "text-slate-400",
};
const BAND_PCT: Record<Band, number> = { very_high: 90, high: 70, moderate: 50, low: 25, unknown: 0 };

export function BandPill({ band, word }: { band: Band; word?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${BAND_CLASS[band]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />{word ?? BAND_WORD[band]}
    </span>
  );
}

export function ScoreTile({ s }: { s: ScoreView }) {
  return (
    <div className="flex flex-col gap-1.5 p-3">
      <div className="flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">
        {s.label}
        <span title={s.definition} className="grid h-3.5 w-3.5 cursor-help place-items-center rounded-full border border-slate-300 text-[9px] text-slate-400 dark:border-slate-600">?</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={`text-sm font-bold ${BAND_CLASS[s.band]}`}>{BAND_WORD[s.band]}</span>
        {s.known && <span className="font-mono text-[11px] text-slate-400">{s.value}</span>}
      </div>
      <div className="h-1 overflow-hidden rounded bg-slate-200 dark:bg-slate-800">
        <span className={`block h-full rounded ${s.band === "unknown" ? "" : "bg-current"} ${BAND_CLASS[s.band]}`} style={{ width: `${s.known ? Math.min(100, s.value ?? 0) : BAND_PCT[s.band]}%` }} />
      </div>
    </div>
  );
}

export function TrustTag({ label }: { label: string }) {
  const map: Record<string, string> = {
    VERIFIED: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40",
    DISPUTED: "text-rose-600 bg-rose-50 dark:bg-rose-950/40",
    STALE: "text-amber-600 bg-amber-50 dark:bg-amber-950/40",
    SUPERSEDED: "text-slate-500 bg-slate-100 dark:bg-slate-800",
    FIRST_PARTY: "text-blue-600 bg-blue-50 dark:bg-blue-950/40",
    HUMAN_ASSERTED: "text-violet-600 bg-violet-50 dark:bg-violet-950/40",
    SYNTHETIC: "text-violet-600 bg-violet-50 dark:bg-violet-950/40",
    HYPOTHESIS: "text-slate-500 bg-slate-100 dark:bg-slate-800",
  };
  return <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${map[label] ?? "text-slate-500 bg-slate-100"}`}>{label.replace(/_/g, " ").toLowerCase()}</span>;
}

/** Persistent synthetic-data disclosure (§24) — never hidden in metadata. */
export function SyntheticBadge({ text = "synthetic" }: { text?: string }) {
  return <span className="inline-flex items-center gap-1 rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-[10.5px] font-semibold text-violet-600 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300">{text}</span>;
}
