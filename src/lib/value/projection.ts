import { driverBounds, partnerVisible, type Driver } from "./drivers";
import { assembleCase, bounds, type Bounds, type ValueCase } from "./case";

/**
 * Value Case audience projections (P2B §9, §10, §11, §16).
 *
 * Two audiences ship in v1: INTERNAL (the full authorized view) and PARTNER (through the existing
 * disclosure vocabulary). A customer-ready projection is deliberately NOT built — only its boundary
 * is defined, at the bottom of this file.
 *
 * ── THE DERIVED-VALUE LEAK (§16) ──────────────────────────────────────────────────────────────
 * Filtering confidential FIELDS out of a payload is not enough. A derived total computed from a
 * confidential input leaks that input the moment the reader can subtract. If a partner saw
 *
 *     modeled impact  $1.2M–$1.6M      (internal total, computed from 3 drivers)
 *     avoided cost    $0.4M            (the two disclosed drivers)
 *     productivity    $0.3M
 *
 * they can solve for the third — the confidential one — exactly. So the partner range is never the
 * internal range with rows hidden. It is **recomputed from the partner-disclosable drivers alone**,
 * and the internal total is never placed in the partner payload at all. That makes the subtraction
 * attack structurally impossible rather than merely unlikely.
 *
 * When the disclosable set cannot support a defensible number, the derived value is WITHHELD — the
 * halt condition is explicit: withhold the derived value rather than weaken disclosure. The partner
 * is told that sponsor-confidential context exists, without it being serialized.
 */

export type ValueAudience = "INTERNAL" | "PARTNER";

export interface PartnerValueCase {
  pursuitId: string;
  accountLabel: string;
  /** Recomputed from disclosable drivers ONLY. Null when nothing defensible can be shared. */
  modeledImpact: Bounds | null;
  /** Disclosable drivers, each with its ladder rung. Never a confidential row. */
  drivers: { label: string; ladder: string; bounds: Bounds; conflicting: boolean }[];
  /** True when confidential economics exist that are NOT in this payload. */
  sponsorConfidentialExists: boolean;
  /** Safe missing-information prompts — what the partner could help establish. */
  couldHelpEstablish: string[];
  /** Present only when the derived value was withheld, saying why in partner-safe words. */
  withheldReason: string | null;
}

/**
 * The partner projection. Takes the INTERNAL case and rebuilds — it never edits it in place, so a
 * caller cannot accidentally hand a mutated internal object to a partner surface.
 */
export function toPartnerValueCase(vc: ValueCase): PartnerValueCase {
  const safe = vc.drivers.filter((d) => d.partnerSafe);
  const withheld = vc.drivers.filter((d) => !d.partnerSafe);

  // Recomputed from the disclosable set alone — NOT the internal total with rows removed.
  const safeCase = assembleCase(vc.pursuitId, vc.companyId, vc.accountLabel, null, null, safe);

  const disclosable = safe.map((d) => ({
    label: d.label,
    ladder: d.ladder as string,
    bounds: driverBounds(d),
    conflicting: d.conflicting,
  }));

  // Withhold the derived value unless the disclosable set can stand on its own.
  let modeledImpact: Bounds | null = safeCase.modeledImpact;
  let withheldReason: string | null = null;
  if (!safeCase.defensible || modeledImpact == null) {
    modeledImpact = null;
    withheldReason = withheld.length > 0
      ? "A modeled range cannot be shared: the economics behind it are sponsor-confidential."
      : "No modeled range has been established that can be shared yet.";
  }

  return {
    pursuitId: vc.pursuitId,
    accountLabel: vc.accountLabel,
    modeledImpact,
    drivers: disclosable,
    sponsorConfidentialExists: withheld.length > 0,
    couldHelpEstablish: vc.sensitivity
      .filter((s) => s.narrowsRangeBy == null || vc.drivers.find((d) => d.predicateKey === s.predicateKey)?.partnerSafe)
      .slice(0, 3)
      .map((s) => s.label),
    withheldReason,
  };
}

/**
 * The one line a partner surface may render about withheld economics. It states that context
 * exists without serializing any part of it — no count, no magnitude, no driver names, because a
 * count of confidential drivers is itself a disclosure about the deal's shape.
 */
export const SPONSOR_CONFIDENTIAL_NOTE =
  "Additional sponsor-confidential economic context exists and is not included here.";

/** Partner-safe summary line. Never contains the internal total. */
export function partnerSummary(p: PartnerValueCase): string {
  if (p.modeledImpact == null) return p.withheldReason ?? "No shareable modeled impact.";
  return `Modeled impact ${bounds(p.modeledImpact)} from ${p.drivers.length} shared economic input${p.drivers.length === 1 ? "" : "s"}.`;
}

// ── CUSTOMER-READY: BOUNDARY ONLY, NOT IMPLEMENTED (§11) ───────────────────────────────────────
/**
 * A customer-ready Value Case is NOT built in P2B, and nothing here may be repurposed into one by
 * accident. The boundary, recorded so the next phase starts from a decision:
 *
 *  1. **A different question.** Internal and partner projections answer "what do we believe and how
 *     well is it supported". A customer-ready projection makes a CLAIM TO THE CUSTOMER about their
 *     own business. That needs a claims policy — who may assert a number about someone else's
 *     operations, and on what evidence — which does not exist yet.
 *  2. **A review gate, not a filter.** Partner disclosure is a policy decision the engine can make.
 *     A customer-facing economic claim requires human review of the claim itself, recorded, before
 *     it can leave the building. There is no such review object today.
 *  3. **A narrower evidence bar.** Plausibly INFERRED is adequate internally and often adequate for
 *     a partner. It is not adequate to tell a customer what their own costs are. A customer-ready
 *     case should admit VERIFIED and CUSTOMER_CONFIRMED drivers only, which is a different
 *     assembly, not a filter over this one.
 *  4. **No accidental export.** Neither `ValueCase` nor `PartnerValueCase` is customer-safe, and
 *     neither may be serialized outward. There is no external send path for either in this phase.
 */
export const CUSTOMER_READY_IMPLEMENTED = false;
