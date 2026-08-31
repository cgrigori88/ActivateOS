import type { Band, ScoreView } from "@/lib/pursuits/read-models/types";

/**
 * Pursuit visual primitives (Workstream D.5). Every surface is built from the
 * semantic token layer (globals.css) — canvas → raised → inset → glass, with
 * restrained per-dimension tint — never a hard black outline. Status is always
 * form + word, never colour alone (§35). Scores render band-first with the exact
 * value secondary (§10/§12) and a consistent "why" affordance (§13).
 *
 * These render from read-model view objects only; they hold no scoring logic.
 */

/* ---- Band vocabulary -------------------------------------------------------
   The read model speaks very_high/high/moderate/low/unknown; the design kit's
   band tokens speak very-high/high/medium/low. This is the single reconciliation
   point. `unknown` is first-class and neutral — never rendered as low or zero. */
export const BAND_WORD: Record<Band, string> = {
  very_high: "Very high", high: "High", moderate: "Moderate", low: "Low", unknown: "Unknown",
};
export const BAND_VAR: Record<Band, string> = {
  very_high: "var(--color-band-very-high)",
  high: "var(--color-band-high)",
  moderate: "var(--color-band-medium)",
  low: "var(--color-band-low)",
  unknown: "var(--color-band-unknown)",
};
const BAND_PCT: Record<Band, number> = { very_high: 92, high: 72, moderate: 52, low: 26, unknown: 0 };

/** Short, legible metric-band labels (§11) so six tiles never truncate. */
export const SHORT_LABEL: Record<string, string> = {
  priority: "Priority", purchase_propensity: "Propensity", propensity: "Propensity",
  evidence_confidence: "Evidence", evidence: "Evidence", timing: "Timing",
  route: "Route", route_score: "Route", route_confidence: "Route conf.",
  activation_readiness: "Readiness", readiness: "Readiness",
};

/** Per-dimension accent hue (§6/§17) — six distinct instruments, not one blue score. */
export const DIMENSION_VAR: Record<string, string> = {
  priority: "var(--color-priority)",
  purchase_propensity: "var(--color-propensity)",
  propensity: "var(--color-propensity)",
  evidence_confidence: "var(--color-evidence)",
  evidence: "var(--color-evidence)",
  timing: "var(--color-timing)",
  route: "var(--color-route)",
  route_confidence: "var(--color-route)",
  activation_readiness: "var(--color-readiness)",
  readiness: "var(--color-readiness)",
};

/** Small band label with a leading dot — the at-a-glance qualitative read. */
export function BandPill({ band, word }: { band: Band; word?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-body font-bold" style={{ color: BAND_VAR[band] }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} aria-hidden />
      {word ?? BAND_WORD[band]}
    </span>
  );
}

/**
 * MetricCell — one dimension of the decision band (§11). A compact tinted glass
 * bento: dimension-tinted surface, band word in the band hue, exact value
 * secondary, a slim progress treatment, and a help affordance. Individually
 * legible while remaining one band.
 */
export function MetricCell({ s, tone }: { s: ScoreView; tone?: string }) {
  const hue = tone ? DIMENSION_VAR[tone] ?? BAND_VAR[s.band] : BAND_VAR[s.band];
  const pct = s.known ? Math.min(100, Math.max(3, s.value ?? 0)) : BAND_PCT[s.band];
  return (
    <div
      className="pos-lift relative flex flex-col gap-2 rounded-card p-3.5"
      style={{ background: `color-mix(in srgb, ${hue} 5%, var(--surface-primary))`, boxShadow: "var(--shadow-low)" }}
    >
      <div className="flex items-center gap-1.5 text-micro font-bold uppercase tracking-[0.04em] text-neutral-500">
        <span className="truncate">{SHORT_LABEL[s.key] ?? s.label}</span>
        {s.definition && (
          <span
            title={s.definition}
            className="grid h-3.5 w-3.5 flex-none cursor-help place-items-center rounded-full text-micro text-neutral-400"
            style={{ border: "1px solid var(--border-subtle)" }}
          >?</span>
        )}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-title font-extrabold tracking-[-0.01em]" style={{ color: hue }}>{BAND_WORD[s.band]}</span>
        {s.known && <span className="tnum text-label text-neutral-400">{s.value}</span>}
      </div>
      <div className="h-1 overflow-hidden rounded-full" style={{ background: "var(--surface-inset)" }}>
        <span
          className="block h-full rounded-full transition-[width] duration-[300ms]"
          style={{ width: `${pct}%`, background: s.band === "unknown" ? "var(--color-band-unknown)" : hue, opacity: s.band === "unknown" ? 0.4 : 1 }}
        />
      </div>
    </div>
  );
}

/** Back-compat alias used by earlier code paths. */
export const ScoreTile = ({ s }: { s: ScoreView }) => <MetricCell s={s} tone={s.key} />;

/**
 * ConfidenceBadge / trust tag (§14) — provenance as a calm pill on a tinted
 * material: verified→mint, first-party→blue, disputed→rose, synthetic→violet.
 */
export function TrustTag({ label }: { label: string }) {
  const tone: Record<string, { fg: string; bg: string }> = {
    VERIFIED: { fg: "var(--color-accent-verified)", bg: "color-mix(in srgb, var(--color-accent-verified) 12%, transparent)" },
    FIRST_PARTY: { fg: "var(--color-band-high)", bg: "color-mix(in srgb, var(--color-band-high) 12%, transparent)" },
    HUMAN_ASSERTED: { fg: "var(--color-accent-violet)", bg: "color-mix(in srgb, var(--color-accent-violet) 12%, transparent)" },
    SYNTHETIC: { fg: "var(--color-accent-violet)", bg: "color-mix(in srgb, var(--color-accent-violet) 12%, transparent)" },
    DISPUTED: { fg: "var(--color-accent-risk)", bg: "color-mix(in srgb, var(--color-accent-risk) 12%, transparent)" },
    STALE: { fg: "var(--color-accent-attention)", bg: "color-mix(in srgb, var(--color-accent-attention) 14%, transparent)" },
    SUPERSEDED: { fg: "var(--color-neutral-500)", bg: "color-mix(in srgb, var(--color-neutral-500) 12%, transparent)" },
    HYPOTHESIS: { fg: "var(--color-neutral-500)", bg: "color-mix(in srgb, var(--color-neutral-500) 12%, transparent)" },
  };
  const t = tone[label] ?? tone.SUPERSEDED;
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-micro font-bold" style={{ color: t.fg, background: t.bg }}>
      {label.replace(/_/g, " ").toLowerCase()}
    </span>
  );
}

/** Persistent synthetic-data disclosure (§23) — compact, unmistakable, quiet. */
export function SyntheticBadge({ text = "synthetic" }: { text?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-micro font-bold"
      style={{ color: "var(--color-accent-violet)", background: "color-mix(in srgb, var(--color-accent-violet) 12%, transparent)" }}
    >
      <span aria-hidden>◇</span>{text}
    </span>
  );
}

/** A deliberately-neutral "we don't know this" cell — unknown ≠ zero, ≠ broken. */
export function UnknownState({ children }: { children: React.ReactNode }) {
  return <span className="text-body italic text-neutral-400">{children}</span>;
}

/** Team acceptance status — dot + word, on a tinted pill. */
export function TeamStatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  const tone = s === "ACCEPTED" ? "var(--color-accent-verified)"
    : s === "DECLINED" ? "var(--color-accent-risk)"
    : s === "INVITED" ? "var(--color-band-high)"
    : "var(--color-accent-attention)"; // RECOMMENDED / pending
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-micro font-bold" style={{ color: tone, background: `color-mix(in srgb, ${tone} 12%, transparent)` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone }} aria-hidden />
      {status.replace(/_/g, " ").toLowerCase()}
    </span>
  );
}
