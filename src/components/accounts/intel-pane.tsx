import Link from "next/link";
import type { AccountIntel } from "@/lib/accounts/intel";

/**
 * Selected-account intelligence pane (Phase 3c-2). Answers where to hunt / why now /
 * through whom / what next for one account, from canonical data. Calm, premium, and
 * built from the same objects as Today/Mapping/Partners/Pipeline.
 */
function Section({ label, accent, children }: { label: string; accent: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="h-3 w-0.5 rounded-full" style={{ background: accent }} aria-hidden />
        <span className="text-micro font-bold uppercase tracking-[0.06em]" style={{ color: accent }}>{label}</span>
      </div>
      <div className="space-y-1.5 pl-2.5 text-body">{children}</div>
    </div>
  );
}
function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-[104px] shrink-0 text-neutral-400">{k}</span>
      <span className="min-w-0 flex-1 text-neutral-700 dark:text-neutral-200">{children}</span>
    </div>
  );
}
const money = (n: number | null) => (n == null ? "—" : n >= 1000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${n}`);
const k = (n: number) => `$${Math.round(n / 1000)}k`;

export function AccountIntelPane({ intel, closeHref, flat }: { intel: AccountIntel; closeHref: string; flat?: boolean }) {
  const t = intel.throughWhom;
  // `flat` = sitting on an opaque drawer sheet (§4): no card chrome of its own, so the sheet is the
  // single opaque reading surface. Default (Accounts ?sel) keeps the sticky glass card.
  return (
    <aside
      className={flat ? "" : "rounded-card border p-4 lg:sticky lg:top-4"}
      style={flat ? undefined : { borderColor: "var(--border-subtle)", background: "var(--surface-primary)", boxShadow: "var(--shadow-low)" }}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <Link href={`/accounts/${intel.companyId}`} className="text-title font-bold hover:underline">{intel.legalName}</Link>
          <div className="text-label text-neutral-500">{intel.industry ?? "—"}</div>
        </div>
        <Link href={closeHref} className="rounded-control px-1.5 py-0.5 text-label text-neutral-400 hover:bg-[var(--surface-inset)]" aria-label="Close">✕</Link>
      </div>

      <div className="space-y-4">
        <Section label="Hunt" accent="var(--color-priority)">
          <Row k="Priority · propensity">
            {intel.hunt.priority != null ? <b>{intel.hunt.priority}</b> : "—"} · {intel.hunt.propensity != null ? <b>{intel.hunt.propensity}</b> : "—"}
            {intel.hunt.band && <span className="ml-1.5 text-neutral-400">({intel.hunt.band.replace(/_/g, " ")})</span>}
          </Row>
          {intel.hunt.useCase && <Row k="Pursuit">{intel.hunt.useCase}{intel.hunt.problem ? ` — ${intel.hunt.problem}` : ""}</Row>}
          <Row k="Whitespace">{intel.hunt.openOpps} open opportunit{intel.hunt.openOpps === 1 ? "y" : "ies"} · {k(intel.hunt.pipelineUsd)} pipeline</Row>
          <Row k="Expected value">{money(intel.hunt.expectedValue)}</Row>
        </Section>

        <Section label="Why now" accent="var(--color-timing)">
          <Row k="Compelling event">{intel.whyNow.compellingEvent ?? <span className="text-neutral-400">none verified</span>}</Row>
          <Row k="Timing">
            {intel.whyNow.timingKnown
              ? <b>{intel.whyNow.timingScore}</b>
              : <span style={{ color: "var(--color-accent-attention)" }}>UNKNOWN — preserved, not assumed</span>}
          </Row>
          {/* Lifecycle Intelligence (P2A §8) — state-bearing, never a bare date: an inferred window
              renders as a range and a conflict renders as a conflict. */}
          {intel.whyNow.lifecycle && (
            <Row k={intel.whyNow.lifecycle.label}>
              <b>{intel.whyNow.lifecycle.when}</b>
              <span className="text-neutral-400"> · {intel.whyNow.lifecycle.state}</span>
            </Row>
          )}
          {intel.whyNow.convergence != null && <Row k="Convergence">{intel.whyNow.convergence} independent signal famil{intel.whyNow.convergence === 1 ? "y" : "ies"}</Row>}
          {intel.whyNow.materialChange && <Row k="Latest change">{intel.whyNow.materialChange}</Row>}
          {intel.whyNow.evidence.length > 0 && (
            <Row k="Evidence">
              <span className="space-y-0.5">
                {intel.whyNow.evidence.slice(0, 2).map((e, i) => (
                  <span key={i} className="block">{e.claim} <span className="text-neutral-400">· {(e.confidence * 100).toFixed(0)}% {e.firstParty ? "first-party" : "external"}</span></span>
                ))}
              </span>
            </Row>
          )}
          {intel.whyNow.missingEvidence && (
            <Row k="Still missing"><span style={{ color: "var(--color-accent-attention)" }}>{intel.whyNow.missingEvidence}</span></Row>
          )}
        </Section>

        {/* Value Case state (P2B §14) — one honest line, using the existing truth, not a new score. */}
        {intel.valueCase && (
          <Section label="What it is worth" accent="var(--color-readiness)">
            <Row k="Value case">
              <Link href={`/pursuits/${intel.valueCase.pursuitId}#value`} className="hover:underline">
                <b>{intel.valueCase.label}</b>
                {intel.valueCase.impact && <span className="text-neutral-500"> · modeled impact {intel.valueCase.impact}</span>}
              </Link>
            </Row>
            <Row k="Why"><span className="text-neutral-500">{intel.valueCase.because}</span></Row>
          </Section>
        )}

        <Section label="Through whom" accent="var(--color-route)">
          {t.recommended && (
            <Row k="Recommended">
              <b style={{ color: "var(--color-route)" }}>{t.recommended}</b>
              {t.overridden && <span className="text-neutral-500"> · selected <b>{t.selected}</b> (human override — recommendation preserved)</span>}
            </Row>
          )}
          {t.partners.length > 0 && (
            <Row k="Partners">
              <span className="space-y-0.5">
                {t.partners.slice(0, 3).map((p) => (
                  <span key={p.name} className="block">
                    <b>{p.name}</b>{p.recommended && <span className="ml-1 text-micro font-bold uppercase" style={{ color: "var(--color-route)" }}> rec</span>}
                    <span className="text-neutral-400"> · relationship {p.strength ?? "—"}{p.tenure != null ? ` · ${p.tenure}mo` : ""}</span>
                  </span>
                ))}
              </span>
            </Row>
          )}
          {t.overlapLists.length > 0 && <Row k="Shared book">overlaps {t.overlapLists.join(", ")}</Row>}
          {/* Strongest seller path (P1B.5): tier + recency evidence; UNKNOWN stays UNKNOWN. */}
          {t.sellerPath && (
            <Row k="Strongest path">
              <b>{t.sellerPath.name}</b>{t.sellerPath.partnerLabel && <span className="text-neutral-500"> ({t.sellerPath.partnerLabel})</span>}
              <span className="text-neutral-400"> · {t.sellerPath.tier.replace(/_/g, " ").toLowerCase()} · {t.sellerPath.recency === "UNKNOWN" ? "recency UNKNOWN" : `${t.sellerPath.recency} contact`}</span>
              {!t.sellerPath.assigned && <span style={{ color: "var(--color-timing)" }}> · not on the pursuit team</span>}
            </Row>
          )}
          {t.conflict && <Row k="Note"><span style={{ color: "var(--color-accent-attention)" }}>{t.conflict}</span></Row>}
          {/* Stakeholder coverage context (P1C §8) — one honest line, never a directory. */}
          {intel.stakeholders && (
            <Row k="Buying team">
              {intel.stakeholders.established
                ? <Link href={`/pursuits/${intel.stakeholders.pursuitId}#stakeholders`} className="hover:underline">{intel.stakeholders.note}</Link>
                : <span className="text-neutral-400">{intel.stakeholders.note}</span>}
            </Row>
          )}
        </Section>

        <Section label="What next" accent="var(--color-readiness)">
          {intel.whatNext.motion && <Row k="Motion">{intel.whatNext.motion}</Row>}
          {intel.whatNext.governedAction && <Row k="Governed action">{intel.whatNext.governedAction}</Row>}
          {intel.whatNext.humanDecision && <Row k="Human decision"><b>{intel.whatNext.humanDecision}</b></Row>}
          {intel.stakeholders?.gapNote && (
            <Row k="Stakeholders"><span style={{ color: "var(--color-accent-attention)" }}>{intel.stakeholders.gapNote}</span></Row>
          )}
          {!intel.whatNext.motion && !intel.whatNext.governedAction && !intel.whatNext.humanDecision && !intel.stakeholders?.gapNote && <span className="text-neutral-400">No pending action.</span>}
          <div className="pt-1"><Link href={`/pursuits`} className="text-label font-medium text-accent hover:underline dark:text-blue-400">Open in Pursuits →</Link></div>
        </Section>
      </div>
    </aside>
  );
}
