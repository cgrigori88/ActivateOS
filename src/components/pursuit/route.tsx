import type { RouteComparisonView, RouteCandidateView, ScoreReason } from "@/lib/pursuits/read-models/types";
import { BandPill, SyntheticBadge, BAND_VAR, BAND_WORD } from "./parts";
import { humanizeReason, titleEnum } from "./vocab";

/**
 * Route decision surfaces (Workstream D.5 §15/§16/§22). The commercial path is a
 * signature PursuitOS visual, not a row of outlined pills; the recommendation and
 * the human selection are stated before the supporting comparison; and the
 * disclosure split makes visible — from real, server-filtered read-model data —
 * that the confidential figure never reaches the partner-safe payload.
 */

/* Participant-type accent so a path reads as a topology, not a breadcrumb. */
const ROLE_HUE: Record<string, string> = {
  VENDOR: "var(--color-band-high)",
  DISTRIBUTOR: "var(--color-accent-intelligence)",
  RESELLER: "var(--color-route)",
  PARTNER: "var(--color-route)",
  SI: "var(--color-accent-violet)",
  MSP: "var(--color-accent-violet)",
  MARKETPLACE: "var(--color-accent-intelligence)",
  CUSTOMER: "var(--color-neutral-500)",
};
const roleWord = (r: string) => r.charAt(0) + r.slice(1).toLowerCase();

/** RoutePath — N-hop commercial topology with typed participants + connectors. */
export function RoutePath({ view }: { view: RouteComparisonView }) {
  if (!view.path.length) return null;
  const recLabel = view.recommended?.label;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {view.path.map((p, i) => {
        const hue = ROLE_HUE[p.role.toUpperCase()] ?? "var(--color-neutral-500)";
        const isRec = recLabel && p.label === recLabel;
        return (
          <span key={i} className="flex items-center gap-1.5">
            <span
              className="inline-flex flex-col rounded-control px-3 py-1.5 leading-tight"
              style={{
                background: isRec ? `color-mix(in srgb, ${hue} 12%, var(--surface-primary))` : "var(--surface-inset)",
                boxShadow: isRec ? `inset 0 0 0 1px color-mix(in srgb, ${hue} 45%, transparent)` : "inset 0 0 0 1px var(--border-subtle)",
              }}
            >
              <span className="text-[13px] font-bold" style={{ color: isRec ? hue : "var(--text-primary, inherit)" }}>{p.label}</span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.04em]" style={{ color: hue }}>{roleWord(p.role)}</span>
            </span>
            {i < view.path.length - 1 && <span className="text-neutral-400" aria-hidden>→</span>}
          </span>
        );
      })}
    </div>
  );
}

/** RecommendationChange — the "recommendation ≠ selection" statement, stated plainly. */
export function RecommendationChange({ view }: { view: RouteComparisonView }) {
  const rec = view.recommended, sel = view.selected;
  const overridden = !!sel && !view.selectionMatchesRecommendation;
  return (
    <div className="flex flex-wrap gap-2.5">
      <div className="flex-1 basis-[220px] rounded-card p-3.5" style={{ background: "color-mix(in srgb, var(--color-route) 6%, var(--surface-primary))", boxShadow: "var(--shadow-low)" }}>
        <div className="text-[10.5px] font-bold uppercase tracking-[0.04em]" style={{ color: "var(--color-route)" }}>Recommended</div>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-[17px] font-extrabold tracking-[-0.02em]">{rec?.label ?? "—"}</span>
        </div>
        <div className="mt-0.5 text-[11.5px] text-neutral-500">Route confidence <span className="font-semibold" style={{ color: BAND_VAR[rec?.confidence.band ?? "unknown"] }}>{rec ? BAND_WORD[rec.confidence.band] : "—"}</span></div>
      </div>
      <div className="flex-1 basis-[220px] rounded-card p-3.5" style={{ background: overridden ? "color-mix(in srgb, var(--color-accent-attention) 8%, var(--surface-primary))" : "var(--surface-inset)", boxShadow: "var(--shadow-low)" }}>
        <div className="text-[10.5px] font-bold uppercase tracking-[0.04em]" style={{ color: overridden ? "var(--color-accent-attention)" : "var(--color-neutral-500)" }}>{overridden ? "Selected — human override" : "Selection"}</div>
        <div className="mt-1 text-[17px] font-extrabold tracking-[-0.02em]">{overridden ? sel!.label : "Recommendation accepted"}</div>
        {overridden && (
          <div className="mt-0.5 text-[11.5px] text-neutral-600 dark:text-neutral-300">
            {view.overrideCategory ? <b>{titleEnum(view.overrideCategory)}</b> : null}{view.overrideReason ? ` · "${view.overrideReason}"` : ""} — recommendation preserved.
          </div>
        )}
      </div>
    </div>
  );
}

/** RouteCandidateTable — supporting dimension comparison; unknown renders as unknown, never zero. */
export function RouteCandidateTable({ view }: { view: RouteComparisonView }) {
  const cands = [view.recommended, ...view.alternatives].filter(Boolean).slice(0, 4) as RouteCandidateView[];
  if (!cands.length) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-[12.5px]">
        <thead>
          <tr>
            <th className="px-2.5 py-2 text-left text-[10px] font-bold uppercase tracking-[0.04em] text-neutral-500">Dimension</th>
            {cands.map((c) => (
              <th key={c.key} className="px-2.5 py-2 text-left text-[10px] font-bold uppercase tracking-[0.04em] text-neutral-500">
                {c.label}{c.key === view.recommended?.key ? " ·rec" : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.dimensionKeys.map((dim) => (
            <tr key={dim} style={{ borderTop: "1px solid var(--border-subtle)" }}>
              <td className="px-2.5 py-2 capitalize text-neutral-500">{dim.replace(/_/g, " ")}</td>
              {cands.map((c) => {
                const cell = c.dimensions[dim];
                return (
                  <td key={c.key} className="px-2.5 py-2">
                    {cell?.known ? <BandPill band={cell.band} word={cell.label} /> : <span className="text-[12px] italic text-neutral-400">Not available</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReasonRow({ r, muted }: { r: ScoreReason; muted?: boolean }) {
  const sign = r.polarity >= 0 ? "+" : "−";
  return (
    <div className="flex items-start gap-2 py-1 text-[12.5px]">
      <span className="flex-none font-extrabold" style={{ color: r.polarity >= 0 ? "var(--color-accent-verified)" : "var(--color-accent-risk)" }}>{sign}</span>
      <span className={muted ? "text-neutral-500" : ""}>{humanizeReason(r.text)}</span>
    </div>
  );
}

/**
 * DisclosureSplit (§22) — the centerpiece. Internal reasons (incl. any confidential
 * figure) beside the partner-safe reasons. The read model has ALREADY removed the
 * confidential value from `reasonsShareable` server-side; this component only
 * displays what each caller was permitted to receive. When the viewer lacks
 * internal disclosure, `reasonsInternal` is null and the internal column states so.
 */
export function DisclosureSplit({ candidate }: { candidate: RouteCandidateView }) {
  const internal = candidate.reasonsInternal;
  return (
    <div className="grid gap-2.5 md:grid-cols-2">
      <div className="rounded-card p-4" style={{ background: "color-mix(in srgb, var(--color-band-high) 5%, var(--surface-primary))", boxShadow: "var(--shadow-low)" }}>
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.03em]" style={{ color: "var(--color-band-high)" }}>
          <span aria-hidden>🔒</span> Internal view · full detail
        </div>
        <div className="mt-2">
          {internal
            ? internal.map((r, i) => <ReasonRow key={i} r={r} />)
            : <div className="text-[12.5px] italic text-neutral-400">Withheld — this viewer is not permitted internal reasoning.</div>}
        </div>
        <div className="mt-2 border-t pt-2 text-[10.5px] text-neutral-400" style={{ borderColor: "var(--border-subtle)" }}>Restricted reasons — visible to the vendor’s own team only.</div>
      </div>
      <div className="rounded-card p-4" style={{ background: "color-mix(in srgb, var(--color-accent-verified) 5%, var(--surface-primary))", boxShadow: "var(--shadow-low)" }}>
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.03em]" style={{ color: "var(--color-accent-verified)" }}>
          <span aria-hidden>↗</span> Shareable with partner
        </div>
        <div className="mt-2">
          {candidate.reasonsShareable.map((r, i) => <ReasonRow key={i} r={r} muted />)}
        </div>
        <div className="mt-2 border-t pt-2 text-[10.5px] text-neutral-400" style={{ borderColor: "var(--border-subtle)" }}>Generalized server-side — confidential figures are absent from this payload, not hidden in the browser.</div>
      </div>
    </div>
  );
}
