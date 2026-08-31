import type { Pool, PoolClient } from "pg";

/**
 * Value Case economic drivers (P2B §1, §3, §4).
 *
 * Every driver is a canonical `facts` row. There is NO value-case table, NO ROI primitive and NO
 * parallel evidence store: money lives in `money_amount` (a point) or `object_value.{low,high}`
 * (a bounded range), provenance in `provenance_class`, disagreement in `fact_contradictions`,
 * history in `supersedes`/`superseded_by`, and support in `fact_evidence`.
 *
 * Two things are deliberately explicit rather than inferred:
 *
 *  1. **A driver's ROLE in the arithmetic** comes from the predicate registry (`signal_type`), not
 *     from its name. A number whose role is unknown is not admitted to the model — the Value Case
 *     refuses to guess whether $2M is a cost being avoided or a cost being incurred.
 *
 *  2. **The provenance ladder** is a projection of the existing canonical `provenance_class`, not a
 *     second classification system. The mapping is stated once, here, and documented in the
 *     execution artifact.
 */

// ── The provenance ladder (§3) ─────────────────────────────────────────────────────────────────
export type Ladder = "VERIFIED" | "CUSTOMER_CONFIRMED" | "INFERRED" | "ASSUMED" | "UNKNOWN";

/**
 * canonical provenance_class → ladder rung. The translation is NOT one-to-one, so it is stated
 * explicitly rather than left to a reader's assumption:
 *
 *   FIRST_PARTY, THIRD_PARTY_VERIFIED  → VERIFIED            we hold the record, or a verified source does
 *   CUSTOMER_DECLARED                  → CUSTOMER_CONFIRMED  the customer said it — the strongest kind for economics
 *   SECOND_PARTY, THIRD_PARTY_UNVERIFIED, INFERRED → INFERRED  someone else's report, or a model's derivation
 *   HUMAN_ASSERTED                     → ASSUMED             a person typed a working number
 *   (no fact at all)                   → UNKNOWN
 *
 * The one judgement call: HUMAN_ASSERTED maps to ASSUMED, not VERIFIED. In P2A a human asserting a
 * renewal date was trusted for precision, because a person reading a contract is a reliable
 * reporter of a date. Economics are different: a seller's working figure for a customer's
 * infrastructure spend is a planning assumption until it is evidenced. The governed assertion path
 * lets a human record FIRST_PARTY or CUSTOMER_DECLARED **when they can state the evidence**, so the
 * rung a fact lands on is a consequence of what could actually be shown — not of who typed it.
 */
export const LADDER_OF: Record<string, Ladder> = {
  FIRST_PARTY: "VERIFIED",
  THIRD_PARTY_VERIFIED: "VERIFIED",
  CUSTOMER_DECLARED: "CUSTOMER_CONFIRMED",
  SECOND_PARTY: "INFERRED",
  THIRD_PARTY_UNVERIFIED: "INFERRED",
  INFERRED: "INFERRED",
  HUMAN_ASSERTED: "ASSUMED",
};

export const LADDER_RANK: Record<Ladder, number> = {
  VERIFIED: 0, CUSTOMER_CONFIRMED: 1, INFERRED: 2, ASSUMED: 3, UNKNOWN: 4,
};
export const LADDER_LABEL: Record<Ladder, string> = {
  VERIFIED: "verified", CUSTOMER_CONFIRMED: "customer-confirmed", INFERRED: "inferred",
  ASSUMED: "assumed", UNKNOWN: "unknown",
};

// ── Driver roles in the arithmetic (§4) ────────────────────────────────────────────────────────
export type DriverRole = "BASELINE" | "BENEFIT" | "CHANGE" | "TIMING";

const ROLE_OF_SIGNAL: Record<string, DriverRole> = {
  economic_baseline: "BASELINE",
  economic_benefit: "BENEFIT",
  economic_change_cost: "CHANGE",
  economic_timing: "TIMING",
};

export const DRIVER_LABEL: Record<string, string> = {
  current_operating_cost: "Current operating cost",
  license_subscription_cost: "License / subscription cost",
  labor_cost: "Labor cost",
  infrastructure_cost: "Infrastructure cost",
  contract_cost: "Contract cost",
  incumbent_renewal_exposure: "Incumbent renewal exposure",
  downtime_risk_cost: "Downtime / risk cost",
  avoided_cost: "Avoided cost",
  productivity_impact: "Productivity impact",
  revenue_impact: "Revenue impact",
  migration_cost: "Migration cost",
  time_to_value_months: "Time to value (months)",
};

/** Disclosure classes that must never reach a partner payload (§16). NULL = unclassified = INTERNAL. */
export const PARTNER_WITHHELD = new Set(["INTERNAL", "TRANSACTION_CONFIDENTIAL", "PII", "RESTRICTED"]);
export const partnerVisible = (disclosureClass: string | null): boolean =>
  disclosureClass != null && !PARTNER_WITHHELD.has(disclosureClass);

// ── A driver as loaded ─────────────────────────────────────────────────────────────────────────

/** One competing value for a driver — present in multiples only when the driver is CONFLICTING. */
export interface DriverValue {
  factId: string;
  /** Bounded value. `low === high` for a point value. Currency-normalized (USD only in v1). */
  low: number;
  high: number;
  currency: string;
  ladder: Ladder;
  provenanceClass: string;
  sourceLabel: string | null;
  evidenceCount: number;
  observedLastAt: Date;
  status: string;
  disclosureClass: string | null;
  supersedesFactId: string | null;
}

export interface Driver {
  predicateKey: string;
  label: string;
  role: DriverRole;
  /** CONFLICTING when live values disagree, otherwise the rung of the value in force. */
  ladder: Ladder;
  conflicting: boolean;
  /** The value in force. Null when conflicting (we do not pick) or when nothing is live. */
  value: DriverValue | null;
  /** Every live value. More than one ⇒ conflicting; all are shown, none is chosen. */
  values: DriverValue[];
  /** Superseded values, kept as history. */
  history: DriverValue[];
  /** The width this driver contributes to the modeled range (§6 sensitivity). */
  spread: number;
  /** True when every live value is partner-disclosable. */
  partnerSafe: boolean;
}

interface FactRow {
  id: string; predicate_key: string; signal_type: string | null;
  money_amount: string | null; money_currency: string | null; number_value: string | null;
  object_type: string; object_value: { low?: number; high?: number } | null;
  provenance_class: string; status: string; disclosure_class: string | null;
  subject_label: string | null; observed_last_at: Date; confidence: string;
  superseded_by: string | null; supersedes: string | null;
  evidence_count: string; contradiction_open: boolean;
}

/** Read the bounded value out of the canonical columns. Returns null when there is no number. */
function boundsOf(r: FactRow): { low: number; high: number; currency: string } | null {
  const cur = r.money_currency ?? "USD";
  if (r.object_type === "RANGE" && r.object_value && r.object_value.low != null && r.object_value.high != null) {
    return { low: Number(r.object_value.low), high: Number(r.object_value.high), currency: cur };
  }
  if (r.money_amount != null) {
    const v = Number(r.money_amount);
    return { low: v, high: v, currency: cur };
  }
  if (r.number_value != null) {
    const v = Number(r.number_value);
    return { low: v, high: v, currency: cur };
  }
  return null;
}

/**
 * Load the economic drivers for one account. RLS-scoped; the caller supplies any narrowing.
 * Superseded and REJECTED rows are kept but separated into `history` — an economic assertion that
 * was replaced is part of the audit trail, not part of the current model.
 */
export async function loadDrivers(
  db: Pool | PoolClient, orgId: string, companyId: string,
): Promise<Driver[]> {
  const { rows } = await db.query<FactRow>(
    `select f.id, f.predicate_key, p.signal_type,
            f.money_amount, f.money_currency, f.number_value,
            f.object_type, f.object_value, f.provenance_class, f.status, f.disclosure_class,
            f.subject_label, f.observed_last_at, f.confidence, f.superseded_by, f.supersedes,
            (select count(*) from fact_evidence fe where fe.fact_id = f.id)::text evidence_count,
            exists (select 1 from fact_contradictions fc
                     where fc.status = 'open' and (fc.fact_id_a = f.id or fc.fact_id_b = f.id)) contradiction_open
       from facts f
       join fact_predicates p on p.key = f.predicate_key
      where f.org_id = $1 and f.company_id = $2 and p.family = 'economic'
      order by f.predicate_key, f.observed_last_at desc`,
    [orgId, companyId]);

  const byPredicate = new Map<string, FactRow[]>();
  for (const r of rows) {
    const list = byPredicate.get(r.predicate_key) ?? [];
    list.push(r);
    byPredicate.set(r.predicate_key, list);
  }

  const drivers: Driver[] = [];
  for (const [key, all] of byPredicate) {
    const role = ROLE_OF_SIGNAL[all[0].signal_type ?? ""] ?? null;
    // A number whose role in the arithmetic is not declared is NOT admitted to the model.
    if (!role) continue;

    const toValue = (r: FactRow): DriverValue | null => {
      const b = boundsOf(r);
      if (!b) return null;
      return {
        factId: r.id, low: b.low, high: b.high, currency: b.currency,
        ladder: LADDER_OF[r.provenance_class] ?? "INFERRED",
        provenanceClass: r.provenance_class, sourceLabel: r.subject_label,
        evidenceCount: Number(r.evidence_count), observedLastAt: r.observed_last_at,
        status: r.status, disclosureClass: r.disclosure_class, supersedesFactId: r.supersedes,
      };
    };

    const live = all.filter((r) => r.superseded_by == null && r.status !== "SUPERSEDED" && r.status !== "REJECTED");
    const values = live.map(toValue).filter((v): v is DriverValue => v != null);
    const history = all.filter((r) => !live.includes(r)).map(toValue).filter((v): v is DriverValue => v != null);
    if (values.length === 0) continue;

    const contradicted = live.some((r) => r.contradiction_open) || live.some((r) => r.status === "DISPUTED");
    const distinct = new Set(values.map((v) => `${v.low}:${v.high}`));
    const conflicting = contradicted || distinct.size > 1;

    // The value in force: highest ladder rung, then most evidence, then freshest. Never chosen
    // when conflicting — a disagreement is resolved by evidence, not by ranking.
    const inForce = conflicting ? null : [...values].sort((a, b) =>
      LADDER_RANK[a.ladder] - LADDER_RANK[b.ladder] ||
      b.evidenceCount - a.evidenceCount ||
      b.observedLastAt.getTime() - a.observedLastAt.getTime())[0];

    // Spread: the width this driver contributes to the modeled range. Under interval addition a
    // driver's own width IS its exact contribution to the total, which is what makes the
    // sensitivity statement in §6 arithmetic rather than a confidence claim.
    // A CONFLICTING driver spans every competing value — never an average.
    const lo = Math.min(...values.map((v) => v.low));
    const hi = Math.max(...values.map((v) => v.high));
    const spread = conflicting ? hi - lo : (inForce ? inForce.high - inForce.low : 0);

    drivers.push({
      predicateKey: key,
      label: DRIVER_LABEL[key] ?? key.replace(/_/g, " "),
      role,
      ladder: conflicting
        ? [...values].sort((a, b) => LADDER_RANK[a.ladder] - LADDER_RANK[b.ladder])[0].ladder
        : (inForce?.ladder ?? "UNKNOWN"),
      conflicting,
      value: inForce,
      values,
      history,
      spread,
      partnerSafe: values.every((v) => partnerVisible(v.disclosureClass)),
    });
  }

  return drivers.sort((a, b) => a.role.localeCompare(b.role) || a.label.localeCompare(b.label));
}

/** The bounded contribution of a driver, spanning every competing value when conflicting. */
export function driverBounds(d: Driver): { low: number; high: number } {
  const lo = Math.min(...d.values.map((v) => v.low));
  const hi = Math.max(...d.values.map((v) => v.high));
  return { low: lo, high: hi };
}
