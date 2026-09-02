"use client";

import { useState } from "react";
import type { ScoreReason } from "@/lib/pursuits/read-models/types";
import { humanizeReason } from "./vocab";
import { segmentClass, segmentTrackClass } from "@/components/room-tabs";

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
      {/* The audience control is the demo's hero interaction, and it was a fifth
          hand-rolled segmented control: its own track, its own radius arithmetic,
          and a selected colour that changed with the audience. It now wears the
          one segmented grammar, so switching audience reads the same way as
          switching any other view in the product. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className={segmentTrackClass()} role="tablist" aria-label="Disclosure audience">
          {([["sponsor", "Sponsor view"], ["partner", "Partner view"]] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={audience === k}
              onClick={() => setAudience(k)} className={segmentClass(audience === k)}>
              {label}
            </button>
          ))}
        </div>
        {/* The stake, stated BEFORE the click and in both states.
            Until now the control announced nothing: a reader had to switch to
            Partner and notice an absence to learn what the toggle was for, and an
            absence is the hardest thing to notice. Naming the count up front makes
            the switch a verification of a claim already made rather than a hunt
            for a difference. Same number, same source (`figuresRemoved`) that the
            partner caption already reports — nothing new is computed and no
            behaviour changes. */}
        {figuresRemoved.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-label ink-muted">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-accent-verified)" }} />
            <b className="ink">{figuresRemoved.length} confidential figure{figuresRemoved.length === 1 ? "" : "s"}</b>
            {figuresRemoved.length === 1 ? " is" : " are"} never sent to the partner
          </span>
        )}
      </div>

      {/* The morphing payload — one card, two audiences */}
      <div className="rounded-card p-4 transition-colors" style={{ background: `color-mix(in srgb, ${hue} 5%, var(--surface-primary))`, boxShadow: "var(--shadow-low)" }}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-label font-bold uppercase tracking-[0.03em]" style={{ color: hue }}>
            <span aria-hidden>{sponsor ? "🔒" : "↗"}</span>
            {sponsor ? `Why ${candidateLabel} — internal, full detail` : `Why ${candidateLabel} — shareable with partner`}
          </div>
          <span className="text-micro font-semibold uppercase tracking-[0.04em] text-neutral-400">{rows.length} reason{rows.length === 1 ? "" : "s"}</span>
        </div>

        <div className="mt-2.5">
          {rows.length
            ? rows.map((r, i) => {
                const isConfidential = sponsor && isConfidentialFigure(r.text);
                return (
                  <div key={i} className="flex items-start gap-2 py-1 text-body">
                    <span className="flex-none font-extrabold" style={{ color: r.polarity >= 0 ? "var(--color-accent-verified)" : "var(--color-accent-risk)" }}>{r.polarity >= 0 ? "+" : "−"}</span>
                    <span className={isConfidential ? "font-semibold" : sponsor ? "" : "text-neutral-500"}>
                      {humanizeReason(r.text)}
                      {isConfidential && <span className="ml-1.5 rounded-full px-1.5 py-px text-micro font-bold uppercase tracking-[0.04em]" style={{ background: "color-mix(in srgb, var(--color-band-high) 14%, transparent)", color: "var(--color-band-high)" }}>confidential</span>}
                    </span>
                  </div>
                );
              })
            : <div className="text-body italic text-neutral-400">{sponsor ? "Withheld — this viewer is not permitted internal reasoning." : "No partner-safe reasons on this route yet."}</div>}
        </div>

        {/* The caption that makes the boundary visceral.
            PRECISION MATTERS HERE, because this is the claim a technical buyer will test. Both
            payloads are present in THIS page — the sponsor is authorized to see both, and that is
            the whole point of a comparison view. What the caption asserts is a fact about the
            PARTNER'S payload, and the place that fact can be checked independently is the partner's
            own surface, where the figure was never serialized at all. Saying "not hidden in the
            browser" without saying where to verify it invites exactly the objection it answers. */}
        <div className="mt-2.5 border-t pt-2 text-micro" style={{ borderColor: "var(--border-subtle)" }}>
          {sponsor
            ? <span className="text-neutral-400">Restricted reasoning — visible to the vendor’s own team only. You are seeing both payloads because you are authorized to; a partner receives only the shareable one.</span>
            : figuresRemoved.length
              ? <span style={{ color: "var(--color-accent-verified)" }}><b>{figuresRemoved.length} confidential figure{figuresRemoved.length === 1 ? "" : "s"} removed at the server</b> — the partner’s payload is built without {figuresRemoved.length === 1 ? "it" : "them"}. Verify on the partner’s own review surface, where {figuresRemoved.length === 1 ? "it was" : "they were"} never serialized.</span>
              : <span className="text-neutral-400">Generalized server-side — confidential figures never enter this payload.</span>}
        </div>
      </div>
    </div>
  );
}
