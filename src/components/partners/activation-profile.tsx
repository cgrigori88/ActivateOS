import Link from "next/link";
import type { PartnerActivationProfile } from "@/lib/partners/intelligence";

/**
 * Partner Activation Profile (Intelligence Wave P1B.1/P1B.3). Presence, relationship, activation,
 * execution and outcomes as SEPARATE truths — no composite score, because the disagreement between
 * them is the intelligence. Every figure is a canonical count with its denominator; UNKNOWN stays
 * UNKNOWN; the headline renders only when its numerator/denominator semantics are valid.
 */

const TIER_LABEL: Record<string, string> = {
  ACTIVE_RELATIONSHIP: "active relationship", ACCOUNT_OVERLAP: "account overlap", NONE: "none asserted",
};

export function ActivationProfile({ p }: { p: PartnerActivationProfile }) {
  const asked = p.activation.askedToAccept;
  const activationGap = p.presence.overlapAccounts >= 5 && p.activation.selectedIn + p.activation.jointRoomsActive > 0
    ? Math.round(((p.activation.selectedIn + p.activation.jointRoomsActive) / p.presence.overlapAccounts) * 100)
    : null;

  return (
    <div className="pos-card mb-6 rounded-card p-4">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Activation profile</h2>

      {/* The wow headline — only when the denominator is real (≥5 overlap accounts). */}
      {activationGap != null && activationGap < 50 && (
        <p className="mb-3 rounded-card px-3 py-2 text-[13px]" style={{ background: "color-mix(in srgb, var(--color-accent-attention) 8%, transparent)", boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--color-accent-attention) 22%, transparent)" }}>
          <b>{p.name} appears in {p.presence.overlapAccounts} overlapping accounts but is activated in {activationGap}% of them</b>
          <span className="text-neutral-500"> ({p.activation.selectedIn} selected routes · {p.activation.jointRoomsActive} joint rooms). Presence is a list truth; activation is behavior — they are allowed to disagree.</span>
        </p>
      )}

      <div className="grid gap-x-8 gap-y-2 text-[12.5px] sm:grid-cols-2">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-[0.05em] text-neutral-400">Presence · list truth</span>
          <p className="mt-0.5">
            <b className="tnum">{p.presence.overlapAccounts}</b> overlap accounts · <b className="tnum">{p.presence.claimedAccounts}</b> claimed (customer/open lists)
          </p>
          <p className="text-neutral-500">
            Relationship (asserted): {p.presence.relationshipTiers.length === 0 ? "none on record" :
              p.presence.relationshipTiers.map((t) => `${t.count} ${TIER_LABEL[t.tier] ?? t.tier.toLowerCase()}`).join(" · ")}
          </p>
        </div>
        <div>
          <span className="text-[10px] font-bold uppercase tracking-[0.05em] text-neutral-400">Activation · behavior</span>
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
          <span className="text-[10px] font-bold uppercase tracking-[0.05em] text-neutral-400">Execution · canonical outcomes</span>
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
          <span className="text-[10px] font-bold uppercase tracking-[0.05em] text-neutral-400">Blocking now · coverage gaps</span>
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
    </div>
  );
}
