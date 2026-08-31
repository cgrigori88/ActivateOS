"use client";

import { useState } from "react";
import type { ScoreReason } from "@/lib/pursuits/read-models/types";
import { humanizeReason } from "./vocab";

/**
 * DisclosureTheater — the hero interaction. A view-only Sponsor ⇄ Partner toggle over
 * the TWO projections the server already produced and filtered (`internal`, `shareable`).
 * Toggling only chooses which permitted payload to display; it changes no disclosure logic
 * and moves no data — the confidential reason exists only in `internal` because the read
 * model removed it from `shareable` server-side, so switching to Partner genuinely shows
 * it is absent from that payload, not hidden in the browser.
 */
export function DisclosureTheater({ internal, shareable, candidateLabel }: {
  internal: ScoreReason[] | null;
  shareable: ScoreReason[];
  candidateLabel: string;
}) {
  const [audience, setAudience] = useState<"sponsor" | "partner">("sponsor");
  const sponsor = audience === "sponsor";
  const shareText = new Set(shareable.map((r) => humanizeReason(r.text)));
  // A reason carries a confidential FIGURE when its text holds a currency/spend amount
  // ($…, or a number with a magnitude suffix). Those specifics are what the read model
  // strips from the partner payload — not every internal line.
  const isConfidentialFigure = (text: string) => /\$\s?\d|\b\d[\d,.]*\s?(?:M|K|bn|B)\b/.test(humanizeReason(text));
  // Confidential figures present for the sponsor but absent from the partner payload.
  const figuresRemoved = (internal ?? []).filter((r) => isConfidentialFigure(r.text) && !shareText.has(humanizeReason(r.text)));
  const rows = sponsor ? (internal ?? []) : shareable;
  const hue = sponsor ? "var(--color-band-high)" : "var(--color-accent-verified)";

  return (
    <div>
      {/* Segmented audience control */}
      <div className="mb-3 inline-flex rounded-control p-0.5" style={{ background: "var(--surface-inset)", boxShadow: "inset 0 0 0 1px var(--border-subtle)" }} role="tablist" aria-label="Disclosure audience">
        {([["sponsor", "Sponsor view"], ["partner", "Partner view"]] as const).map(([k, label]) => {
          const on = audience === k;
          const kHue = k === "sponsor" ? "var(--color-band-high)" : "var(--color-accent-verified)";
          return (
            <button key={k} type="button" role="tab" aria-selected={on} onClick={() => setAudience(k)}
              className="rounded-[calc(var(--radius-control)-2px)] px-3.5 py-1.5 text-[12px] font-semibold transition-colors"
              style={on ? { background: "var(--surface-primary)", color: kHue, boxShadow: "var(--shadow-low)" } : { color: "var(--color-neutral-500)" }}>
              {label}
            </button>
          );
        })}
      </div>

      {/* The morphing payload — one card, two audiences */}
      <div className="rounded-card p-4 transition-colors" style={{ background: `color-mix(in srgb, ${hue} 5%, var(--surface-primary))`, boxShadow: "var(--shadow-low)" }}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.03em]" style={{ color: hue }}>
            <span aria-hidden>{sponsor ? "🔒" : "↗"}</span>
            {sponsor ? `Why ${candidateLabel} — internal, full detail` : `Why ${candidateLabel} — shareable with partner`}
          </div>
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.04em] text-neutral-400">{rows.length} reason{rows.length === 1 ? "" : "s"}</span>
        </div>

        <div className="mt-2.5">
          {rows.length
            ? rows.map((r, i) => {
                const isConfidential = sponsor && isConfidentialFigure(r.text);
                return (
                  <div key={i} className="flex items-start gap-2 py-1 text-[12.5px]">
                    <span className="flex-none font-extrabold" style={{ color: r.polarity >= 0 ? "var(--color-accent-verified)" : "var(--color-accent-risk)" }}>{r.polarity >= 0 ? "+" : "−"}</span>
                    <span className={isConfidential ? "font-semibold" : sponsor ? "" : "text-neutral-500"}>
                      {humanizeReason(r.text)}
                      {isConfidential && <span className="ml-1.5 rounded-full px-1.5 py-px text-[9.5px] font-bold uppercase tracking-[0.04em]" style={{ background: "color-mix(in srgb, var(--color-band-high) 14%, transparent)", color: "var(--color-band-high)" }}>confidential</span>}
                    </span>
                  </div>
                );
              })
            : <div className="text-[12.5px] italic text-neutral-400">{sponsor ? "Withheld — this viewer is not permitted internal reasoning." : "No partner-safe reasons on this route yet."}</div>}
        </div>

        {/* The caption that makes the boundary visceral */}
        <div className="mt-2.5 border-t pt-2 text-[10.5px]" style={{ borderColor: "var(--border-subtle)" }}>
          {sponsor
            ? <span className="text-neutral-400">Restricted reasoning — visible to the vendor’s own team only.</span>
            : figuresRemoved.length
              ? <span style={{ color: "var(--color-accent-verified)" }}><b>{figuresRemoved.length} confidential figure{figuresRemoved.length === 1 ? "" : "s"} removed at the server</b> — absent from this payload, not hidden in the browser.</span>
              : <span className="text-neutral-400">Generalized server-side — confidential figures never enter this payload.</span>}
        </div>
      </div>
    </div>
  );
}
