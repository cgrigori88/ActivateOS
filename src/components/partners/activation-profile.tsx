import Link from "next/link";
import type { ObservedActivationPattern, PartnerActivationProfile } from "@/lib/partners/intelligence";

/**
 * Partner Activation Profile (Intelligence Wave P1B.1/P1B.3). Presence, relationship, activation,
 * execution and outcomes as SEPARATE truths — no composite score, because the disagreement between
 * them is the intelligence. Every figure is a canonical count with its denominator; UNKNOWN stays
 * UNKNOWN; the headline renders only when its numerator/denominator semantics are valid.
 */

const TIER_LABEL: Record<string, string> = {
  ACTIVE_RELATIONSHIP: "active relationship", ACCOUNT_OVERLAP: "account overlap", NONE: "none asserted",
};

const REL_LABEL: Record<string, string> = {
  ACTIVE_RELATIONSHIP: "active-relationship accounts", ACCOUNT_OVERLAP: "overlap-only accounts", NONE: "no asserted relationship",
};

/**
 * "Where should I use this partner?" (UX normalization §5) — the observed activation pattern,
 * rendered as evidence, never as a score: each row is category × relationship state with the
 * candidate → selected → accepted → outcome trail and its sample size. Cells under the
 * calibrated floor say so; a partner with no evidence is UNKNOWN.
 */
function ObservedPattern({ pattern, name }: { pattern: ObservedActivationPattern; name: string }) {
  return (
    <div className="mt-3 border-t border-neutral-200/70 pt-2.5 dark:border-neutral-800">
      <span className="text-micro font-bold uppercase tracking-[0.05em] text-neutral-400">Where to activate · observed pattern</span>
      {pattern.status === "UNKNOWN" ? (
        <p className="mt-0.5 text-body text-neutral-500">
          UNKNOWN — {name} has no route or execution evidence yet. The pattern appears once they are candidates on routed pursuits; nothing is inferred in the meantime.
        </p>
      ) : (
        <>
          <ul className="mt-1 space-y-0.5 text-body">
            {pattern.rows.slice(0, 6).map((r, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="font-medium">{r.category}</span>
                <span className="text-neutral-500">· {REL_LABEL[r.relationshipState]}</span>
                <span className="tnum text-neutral-500">
                  — candidate {r.candidate} · selected {r.selected} · accepted {r.accepted}
                  {r.outcomes.sample > 0 && <> · <b style={{ color: "var(--color-accent-verified)" }}>{r.outcomes.won}W</b>/{r.outcomes.lost}L (n={r.outcomes.sample})</>}
                </span>
                {r.sufficient ? (
                  <span className="rounded-full px-1.5 py-px text-micro font-bold" style={{ background: "color-mix(in srgb, var(--color-accent-verified) 12%, transparent)", color: "var(--color-accent-verified)" }}>observed</span>
                ) : (
                  <span className="rounded-full bg-neutral-500/10 px-1.5 py-px text-micro font-semibold text-neutral-500">insufficient evidence</span>
                )}
                {r.segments.length > 0 && <span className="text-label text-neutral-400">segments: {r.segments.slice(0, 3).join(", ")}</span>}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-label text-neutral-400">
            {pattern.evidencePursuits} pursuit{pattern.evidencePursuits === 1 ? "" : "s"} of evidence · observations, not a score — nothing here feeds route scoring
            {pattern.status === "INSUFFICIENT" && <> · every cell is below the calibrated floor (n≥5), so this reads as early observation only</>}.
          </p>
        </>
      )}
    </div>
  );
}

export function ActivationProfile({ p, pattern }: { p: PartnerActivationProfile; pattern?: ObservedActivationPattern }) {
  const asked = p.activation.askedToAccept;
  const activationGap = p.presence.overlapAccounts >= 5 && p.activation.selectedIn + p.activation.jointRoomsActive > 0
    ? Math.round(((p.activation.selectedIn + p.activation.jointRoomsActive) / p.presence.overlapAccounts) * 100)
    : null;

  return (
    <div className="pos-card mb-6 rounded-card p-4">
      <h2 className="mb-2 text-copy font-semibold uppercase tracking-wide text-neutral-500">Activation profile</h2>

      {/* The wow headline — only when the denominator is real (≥5 overlap accounts). */}
      {activationGap != null && activationGap < 50 && (
        <p className="mb-3 rounded-card px-3 py-2 text-copy" style={{ background: "color-mix(in srgb, var(--color-accent-attention) 8%, transparent)", boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--color-accent-attention) 22%, transparent)" }}>
          <b>{p.name} appears in {p.presence.overlapAccounts} overlapping accounts but is activated in {activationGap}% of them</b>
          <span className="text-neutral-500"> ({p.activation.selectedIn} selected routes · {p.activation.jointRoomsActive} joint rooms). Presence is a list truth; activation is behavior — they are allowed to disagree.</span>
        </p>
      )}

      <div className="grid gap-x-8 gap-y-2 text-body sm:grid-cols-2">
        <div>
          <span className="text-micro font-bold uppercase tracking-[0.05em] text-neutral-400">Presence · list truth</span>
          <p className="mt-0.5">
            <b className="tnum">{p.presence.overlapAccounts}</b> overlap accounts · <b className="tnum">{p.presence.claimedAccounts}</b> claimed (customer/open lists)
          </p>
          <p className="text-neutral-500">
            Relationship (asserted): {p.presence.relationshipTiers.length === 0 ? "none on record" :
              p.presence.relationshipTiers.map((t) => `${t.count} ${TIER_LABEL[t.tier] ?? t.tier.toLowerCase()}`).join(" · ")}
          </p>
        </div>
        <div>
          <span className="text-micro font-bold uppercase tracking-[0.05em] text-neutral-400">Activation · behavior</span>
          <p className="mt-0.5">
            candidate in <b className="tnum">{p.activation.candidateIn}</b> pursuits · recommended <b className="tnum">{p.activation.recommendedIn}</b> · <b className="tnum" style={{ color: "var(--color-route)" }}>{p.activation.selectedIn} SELECTED</b>
            {p.activation.jointRoomsActive > 0 && <> · {p.activation.jointRoomsActive} joint rooms</>}
          </p>
          <p className="text-neutral-500">
            asked to accept {asked > 0 ? <><b className="tnum">{asked}</b> → {p.activation.accepted} accepted{p.activation.declined > 0 && <> · {p.activation.declined} declined</>}{p.activation.pendingNow > 0 && <> · {p.activation.pendingNow} pending now</>}</> : "— no invitations issued yet"}
            {" · median "}
            {p.activation.medianAcceptDays == null
              ? <span title="no timestamped invite→accept pairs">UNKNOWN</span>
              : <>{p.activation.medianAcceptDays}d <span className="text-neutral-400">(n={p.activation.acceptSample})</span></>}
          </p>
        </div>
        <div>
          <span className="text-micro font-bold uppercase tracking-[0.05em] text-neutral-400">Execution · canonical outcomes</span>
          <p className="mt-0.5">
            {p.execution.sample === 0 ? <span className="text-neutral-500">No terminal canonical outcomes on their selected pursuits yet.</span> : (
              <>
                <b style={{ color: "var(--color-accent-verified)" }}>{p.execution.won} won</b> · {p.execution.lost} lost{p.execution.noDecision > 0 && <> · {p.execution.noDecision} no decision</>}
                {Object.keys(p.execution.byAttributionClass).length > 0 && (
                  <span className="text-neutral-500"> · attribution {Object.entries(p.execution.byAttributionClass).map(([k, v]) => `${v} ${k}`).join(", ")}</span>
                )}
                {p.execution.sample < 5 && <span className="text-neutral-400"> · sample {p.execution.sample} — too small for calibrated conclusions</span>}
              </>
            )}
          </p>
          {p.execution.byCategory.length > 0 && (
            <p className="text-neutral-500">by category: {p.execution.byCategory.map((c) => `${c.name} ${c.won}W/${c.lost}L`).join(" · ")}</p>
          )}
        </div>
        <div>
          <span className="text-micro font-bold uppercase tracking-[0.05em] text-neutral-400">Blocking now · coverage gaps</span>
          {p.blocking.length === 0 ? <p className="mt-0.5 text-neutral-500">Nothing waiting on this partner.</p> : (
            <ul className="mt-0.5 space-y-0.5">
              {p.blocking.slice(0, 4).map((b, i) => (
                <li key={i}>
                  <Link href={`/pursuits/${b.pursuitId}#team`} className="font-medium hover:underline" style={{ color: "var(--color-timing)" }}>
                    {b.account}
                  </Link>{" "}
                  <span className="text-neutral-500">— {b.role} invited, waiting {b.waitingDays}d</span>
                </li>
              ))}
            </ul>
          )}
          {p.coverageGaps.length > 0 && (
            <p className="mt-1 text-neutral-500">
              gaps: {p.coverageGaps.filter((g) => g.gap === "NO_RELATIONSHIP").length} overlap accounts w/o asserted relationship · {p.coverageGaps.filter((g) => g.gap === "NO_NAMED_SELLER").length} w/o named seller
            </p>
          )}
        </div>
      </div>

      {pattern && <ObservedPattern pattern={pattern} name={p.name} />}
    </div>
  );
}
