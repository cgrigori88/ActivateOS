"use client";

import { useState } from "react";
import type { PursuitBrief, BriefLine } from "@/lib/pursuits/read-models/brief";
import { buttonClass } from "@/components/ui";
import { segmentClass, segmentTrackClass } from "@/components/room-tabs";

/**
 * Disclosure-aware Pursuit Brief drawer (Phase F1). A contextual slide-over — NOT a /briefs room —
 * that states one pursuit as a calm executive brief: what is happening, why now, who matters, the
 * route, what we know, what the partner may know, what to say / ask / not claim, and what's next.
 * The Sponsor⇄Partner toggle is the wow: switching to Partner drops every line the server marked
 * confidential and hides the sponsor-only guardrail section entirely, so the confidential figures
 * are genuinely absent from the partner rendering — the same server-side split the route theater uses.
 */

const SPONSOR_ONLY_SECTIONS = new Set(["notclaim"]);   // rep guidance — never part of a partner rendering

export function PursuitBriefButton({ brief }: { brief: PursuitBrief }) {
  const [open, setOpen] = useState(false);
  const [audience, setAudience] = useState<"sponsor" | "partner">("sponsor");
  const partner = audience === "partner";

  const withheldCount = brief.sections.reduce((n, s) =>
    n + (SPONSOR_ONLY_SECTIONS.has(s.key) ? s.lines.length : s.lines.filter((l) => l.confidential).length), 0);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("secondary", "sm")}>
        Pursuit brief
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Pursuit brief">
          <div className="absolute inset-0" style={{ background: "color-mix(in srgb, var(--color-ink, #0b0f1a) 42%, transparent)" }} onClick={() => setOpen(false)} aria-hidden />
          <aside className="relative flex h-full w-full max-w-[560px] flex-col overflow-hidden shadow-2xl"
            style={{ background: "var(--surface-primary)", borderLeft: "1px solid var(--border-subtle)" }}>
            {/* Header */}
            <div className="shrink-0 px-5 pt-5 pb-3.5" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-micro font-bold uppercase tracking-[0.09em] text-neutral-400">Pursuit brief</div>
                  <h2 className="mt-1 max-w-[42ch] text-section font-extrabold leading-[1.15] tracking-[-0.02em]" style={{ textWrap: "balance" } as React.CSSProperties}>{brief.headline}</h2>
                  <p className="mt-1 max-w-[52ch] text-label text-neutral-500">{brief.subhead}</p>
                </div>
                <button type="button" onClick={() => setOpen(false)} aria-label="Close brief"
                  className={`shrink-0 ${buttonClass("secondary", "sm")}`}>✕</button>
              </div>
              {/* Audience toggle */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {/* The brief's audience toggle was a SIXTH hand-rolled segmented
                    control — its own track, a 7px radius off the token set, and a
                    filled colour that changed with the audience. It is the same
                    Sponsor/Partner choice the disclosure panel offers, so it takes
                    the same grammar and the reader learns the control once. */}
                <div className={segmentTrackClass()} role="tablist" aria-label="Brief audience">
                  {([["sponsor", "Sponsor brief"], ["partner", "Partner-safe brief"]] as const).map(([k, label]) => (
                    <button key={k} type="button" role="tab" aria-selected={audience === k}
                      onClick={() => setAudience(k)} className={segmentClass(audience === k)}>{label}</button>
                  ))}
                </div>
                {partner && (
                  <span className="inline-flex items-center gap-1.5 text-label font-medium" style={{ color: "var(--color-accent-verified)" }}>
                    <span aria-hidden>🛡</span> {withheldCount} confidential line{withheldCount === 1 ? "" : "s"} withheld server-side
                  </span>
                )}
              </div>
            </div>

            {/* Body */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="space-y-4">
                {brief.sections.map((s) => {
                  if (partner && SPONSOR_ONLY_SECTIONS.has(s.key)) return null;
                  const lines = partner ? s.lines.filter((l) => !l.confidential) : s.lines;
                  const droppedHere = partner ? s.lines.length - lines.length : 0;
                  return <Section key={s.key} title={s.title} lines={lines} emptyNote={s.emptyNote} dropped={droppedHere} />;
                })}
              </div>
              <p className="mt-5 text-micro leading-relaxed text-neutral-400">
                Every line is drawn from this pursuit&rsquo;s own evidence — facts, why-now, the route&rsquo;s disclosure-filtered reasons, team and outcome. Nothing here is invented; the partner rendering is the server-side disclosure split, not a browser filter.
              </p>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

function Section({ title, lines, emptyNote, dropped }: { title: string; lines: BriefLine[]; emptyNote?: string; dropped: number }) {
  return (
    <section>
      <h3 className="text-micro font-bold uppercase tracking-[0.07em] text-neutral-400">{title}</h3>
      {lines.length === 0 ? (
        <p className="mt-1 text-body italic text-neutral-400">{dropped > 0 ? `Withheld from the partner rendering (${dropped} confidential line${dropped === 1 ? "" : "s"}).` : (emptyNote ?? "—")}</p>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {lines.map((l, i) => (
            <li key={i} className="flex gap-2 text-copy leading-relaxed">
              <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full" style={{ background: l.caution ? "var(--color-accent-risk)" : "var(--color-route)" }} />
              <span style={l.caution ? { color: "var(--color-accent-risk)" } : undefined}>
                {l.text}
                {l.confidential && <span className="ml-1.5 rounded-inner px-1 py-px text-micro font-bold uppercase tracking-[0.04em]" style={{ color: "var(--color-band-high)", background: "color-mix(in srgb, var(--color-band-high) 12%, transparent)" }}>sponsor only</span>}
              </span>
            </li>
          ))}
          {dropped > 0 && <li className="text-label italic text-neutral-400">+ {dropped} confidential line{dropped === 1 ? "" : "s"} withheld from the partner.</li>}
        </ul>
      )}
    </section>
  );
}
