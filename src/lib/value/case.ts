import type { Pool, PoolClient } from "pg";
import { formatMoney } from "@/lib/format/money";
import {
  loadDrivers, driverBounds, LADDER_LABEL, LADDER_RANK,
  type Driver, type Ladder, type DriverRole,
} from "./drivers";

/**
 * The Value Case (P2B §2, §4, §5, §6).
 *
 * Answers, for one Pursuit: what is economically at stake, what part of it is actually supported,
 * what is assumed, what is UNKNOWN, and what evidence would most materially improve the case.
 *
 * ── THREE ECONOMIC TRUTHS, KEPT DISTINCT (§2) ─────────────────────────────────────────────────
 * These are NOT interchangeable and none is derived from another to make them agree:
 *
 *   dealAmount     opportunities.amount_usd        — what the CRM says the commercial deal is worth
 *   expectedValue  pursuits.expected_value_weighted — PursuitOS's probabilistic representation
 *   modeledImpact  Σ economic facts                 — modeled customer/business impact
 *
 * A surface that prints all three MUST label them. `ECONOMIC_TRUTH_LABEL` below is the single
 * source of those labels so no surface invents its own wording.
 *
 * ── THE ARITHMETIC (§4, §5) ───────────────────────────────────────────────────────────────────
 * Interval arithmetic over explicitly-typed drivers. A point value is the degenerate interval
 * [v, v], so points and ranges compose without a special case:
 *
 *   benefit  = Σ BENEFIT drivers                  [Σlow, Σhigh]
 *   change   = Σ CHANGE drivers                   [Σlow, Σhigh]
 *   impact   = benefit − change                   [benefitLow − changeHigh, benefitHigh − changeLow]
 *   baseline = Σ BASELINE drivers                 CONTEXT ONLY — never added to impact
 *
 * Spending $2M a year today is not a $2M benefit, so BASELINE never enters the impact sum. It is
 * reported separately as "what is at stake today".
 *
 * A CONFLICTING driver spans every competing value — it is never averaged (§17).
 */

export type ValueCaseState = "STRONG" | "INCOMPLETE" | "CONFLICTING" | "NOT_ESTABLISHED";

export const STATE_LABEL: Record<ValueCaseState, string> = {
  STRONG: "strong", INCOMPLETE: "incomplete", CONFLICTING: "conflicting", NOT_ESTABLISHED: "not established",
};

export const ECONOMIC_TRUTH_LABEL = {
  dealAmount: "Deal amount",
  expectedValue: "Expected value",
  modeledImpact: "Modeled customer impact",
} as const;

export const ECONOMIC_TRUTH_MEANING = {
  dealAmount: "what the commercial deal is worth to us, as recorded on the opportunity",
  expectedValue: "our probability-weighted representation of that deal",
  modeledImpact: "the customer's modeled business impact, from economic facts — not our revenue",
} as const;

export interface Bounds { low: number; high: number }

export interface SensitivityItem {
  predicateKey: string;
  label: string;
  ladder: Ladder;
  conflicting: boolean;
  /**
   * Exact width this driver contributes to the MODELED RANGE. Under interval addition a driver's
   * own spread IS its contribution to the total, so "resolving this narrows the range by X" is
   * arithmetic, not a confidence claim.
   *
   * Null in two distinct cases, both honest:
   *   • the driver is ABSENT — it has no bounds, so its effect cannot be quantified;
   *   • the driver is a BASELINE — it describes the cost of today and is deliberately NOT part of
   *     the modeled impact, so tightening it changes "at stake today", not the modeled range.
   *     Reporting a range reduction for it would be arithmetically false.
   */
  narrowsRangeBy: number | null;
  /** Which figure this driver actually moves. */
  affects: "MODELED_RANGE" | "AT_STAKE_TODAY" | "NOT_QUANTIFIABLE";
  reason: string;
  /** What would actually move it. */
  ask: string;
}

export interface ValueCase {
  pursuitId: string;
  companyId: string;
  accountLabel: string;

  // The three truths, never merged.
  dealAmount: number | null;
  expectedValue: number | null;
  modeledImpact: Bounds | null;

  /** Recurring cost of the current state — what is at stake today. Context, never impact. */
  baseline: Bounds | null;
  benefit: Bounds | null;
  changeCost: Bounds | null;
  /** Months until impact begins, when a TIMING driver exists. */
  timeToValueMonths: Bounds | null;

  state: ValueCaseState;
  /**
   * False when no defensible range can be stated — no benefit driver, or every benefit driver is
   * a bare assumption. The honest output is then "Value case not yet defensible", which is a
   * valid answer, not a failure.
   */
  defensible: boolean;
  /** Why the case is in the state it is — one plain sentence. */
  because: string;

  drivers: Driver[];
  /** Driver counts by ladder rung, for the evidence-quality line. */
  quality: Record<Ladder, number>;
  /** Registered economic drivers with no fact at all — the UNKNOWNs, preserved as UNKNOWN. */
  missing: string[];
  conflicts: Driver[];
  /** Ranked: what would most materially improve the case (§6). */
  sensitivity: SensitivityItem[];
}

const sum = (bs: Bounds[]): Bounds | null =>
  bs.length === 0 ? null : bs.reduce((a, b) => ({ low: a.low + b.low, high: a.high + b.high }));

const byRole = (ds: Driver[], role: DriverRole) => ds.filter((d) => d.role === role);

/** The economic drivers a Value Case would ideally carry. Absence is UNKNOWN, never zero. */
export const EXPECTED_BENEFIT_DRIVERS = ["avoided_cost", "productivity_impact", "downtime_risk_cost", "revenue_impact"];
export const EXPECTED_BASELINE_DRIVERS = ["current_operating_cost", "infrastructure_cost", "license_subscription_cost", "labor_cost"];

export async function getValueCase(
  db: Pool | PoolClient, orgId: string, pursuitId: string,
): Promise<ValueCase | null> {
  const p = (await db.query<{ id: string; account_id: string; legal_name: string; evw: string | null }>(
    `select p.id, p.account_id, c.legal_name, p.expected_value_weighted evw
       from pursuits p join companies c on c.id = p.account_id
      where p.id = $1 and p.org_id = $2`, [pursuitId, orgId])).rows[0];
  if (!p) return null;

  // The CRM's word on the commercial deal — the largest open opportunity on the account. Kept
  // entirely separate from the modeled impact; neither is derived from the other.
  const opp = (await db.query<{ amount: string | null }>(
    `select max(amount_usd) amount from opportunities
      where company_id = $1 and org_id = $2 and stage not in ('closed_won','closed_lost')`,
    [p.account_id, orgId])).rows[0];

  const drivers = await loadDrivers(db, orgId, p.account_id);
  return assembleCase(p.id, p.account_id, p.legal_name,
    opp?.amount != null ? Number(opp.amount) : null,
    p.evw != null ? Number(p.evw) : null,
    drivers);
}

/** Pure assembly — separated so tests can drive the arithmetic without a database. */
export function assembleCase(
  pursuitId: string, companyId: string, accountLabel: string,
  dealAmount: number | null, expectedValue: number | null, drivers: Driver[],
): ValueCase {
  const benefit = sum(byRole(drivers, "BENEFIT").map(driverBounds));
  const changeCost = sum(byRole(drivers, "CHANGE").map(driverBounds));
  const baseline = sum(byRole(drivers, "BASELINE").map(driverBounds));
  const timing = sum(byRole(drivers, "TIMING").map(driverBounds));

  // Interval subtraction: the worst case is the smallest benefit against the largest change cost.
  const modeledImpact: Bounds | null = benefit == null ? null : {
    low: benefit.low - (changeCost?.high ?? 0),
    high: benefit.high - (changeCost?.low ?? 0),
  };

  const quality: Record<Ladder, number> = { VERIFIED: 0, CUSTOMER_CONFIRMED: 0, INFERRED: 0, ASSUMED: 0, UNKNOWN: 0 };
  for (const d of drivers) quality[d.ladder] += 1;

  const conflicts = drivers.filter((d) => d.conflicting);
  const benefitDrivers = byRole(drivers, "BENEFIT");
  const supported = benefitDrivers.filter((d) => d.ladder === "VERIFIED" || d.ladder === "CUSTOMER_CONFIRMED");

  // Defensible = a range can honestly be stated at all. A case built entirely from bare
  // assumptions is not a Value Case; saying so is a valid output (§5).
  const defensible = benefitDrivers.length > 0 && benefitDrivers.some((d) => d.ladder !== "ASSUMED");

  // Share of modeled benefit magnitude resting on VERIFIED / CUSTOMER_CONFIRMED evidence.
  const benefitMass = benefitDrivers.reduce((s, d) => s + (driverBounds(d).low + driverBounds(d).high) / 2, 0);
  const supportedMass = supported.reduce((s, d) => s + (driverBounds(d).low + driverBounds(d).high) / 2, 0);
  const supportedShare = benefitMass > 0 ? supportedMass / benefitMass : 0;

  let state: ValueCaseState;
  let because: string;
  if (drivers.length === 0) {
    state = "NOT_ESTABLISHED";
    because = "No economic facts on this account — nothing has been established about what is at stake.";
  } else if (conflicts.length > 0) {
    // A conflict outranks strength, exactly as it does for lifecycle timing: a number two sources
    // disagree about is more dangerous than a number we simply do not have.
    state = "CONFLICTING";
    because = `${conflicts.length} economic driver${conflicts.length === 1 ? "" : "s"} ${conflicts.length === 1 ? "has" : "have"} sources that disagree.`;
  } else if (!defensible) {
    state = "INCOMPLETE";
    because = benefitDrivers.length === 0
      ? "Costs of the current state are recorded, but no benefit of changing has been established."
      : "Every modeled benefit is a working assumption — nothing is evidenced yet.";
  } else if (supportedShare >= 0.6 && benefitDrivers.length >= 2) {
    state = "STRONG";
    because = `${Math.round(supportedShare * 100)}% of the modeled benefit rests on verified or customer-confirmed evidence.`;
  } else {
    state = "INCOMPLETE";
    because = supported.length === 0
      ? "The modeled benefit is inferred — none of it is verified or customer-confirmed yet."
      : "Part of the modeled benefit is evidenced; the rest is inferred or assumed.";
  }

  const present = new Set(drivers.map((d) => d.predicateKey));
  const missing = [...EXPECTED_BENEFIT_DRIVERS, ...EXPECTED_BASELINE_DRIVERS].filter((k) => !present.has(k));

  return {
    pursuitId, companyId, accountLabel,
    dealAmount, expectedValue, modeledImpact,
    baseline, benefit, changeCost, timeToValueMonths: timing,
    state, defensible, because,
    drivers, quality, missing, conflicts,
    sensitivity: rankSensitivity(drivers, missing),
  };
}

/**
 * "What would strengthen this Value Case?" (§6)
 *
 * Deterministic sensitivity, not a confidence model. For a driver that is already bounded, the
 * amount the modeled range would narrow if that driver collapsed to a point is EXACTLY its own
 * spread — that is a property of interval addition, so the statement is arithmetic. A driver that
 * is absent has no bounds, so its effect cannot be computed; we say that plainly rather than
 * inventing a number, and we never report a confidence percentage improvement.
 */
export function rankSensitivity(drivers: Driver[], missing: string[]): SensitivityItem[] {
  const items: SensitivityItem[] = [];

  for (const d of drivers) {
    if (d.role === "TIMING") continue;                 // timing shapes when, not how much
    if (d.spread === 0 && !d.conflicting) continue;    // a settled point value has nothing to narrow

    // ONLY drivers that enter the modeled impact can narrow the modeled range. A BASELINE describes
    // the cost of the current state and is deliberately excluded from the impact sum (§4), so
    // claiming that firming it up narrows the modeled range would be arithmetically false — exactly
    // the invented improvement §6 forbids. It is still worth firming up; it moves a different number.
    const movesRange = d.role === "BENEFIT" || d.role === "CHANGE";
    items.push({
      predicateKey: d.predicateKey,
      label: d.label,
      ladder: d.ladder,
      conflicting: d.conflicting,
      narrowsRangeBy: movesRange ? d.spread : null,
      affects: movesRange ? "MODELED_RANGE" : "AT_STAKE_TODAY",
      reason: d.conflicting
        ? movesRange
          ? "Sources disagree; the modeled range spans every competing value."
          : "Sources disagree on this current-state cost; it shapes what is at stake today, not the modeled range."
        : movesRange
          ? `Currently ${LADDER_LABEL[d.ladder]}, carried as a range.`
          : `Currently ${LADDER_LABEL[d.ladder]}. It sizes what is at stake today; it is not part of the modeled impact.`,
      ask: d.conflicting
        ? "Reconcile the competing figures with the customer — the range cannot close until one is evidenced."
        : d.ladder === "ASSUMED"
          ? "Ask the customer to confirm this figure, or attach the record it comes from."
          : "Obtain the customer's own number, or evidence the current bound.",
    });
  }

  // Absent drivers last: real gaps, but their effect on the range is not computable.
  for (const key of missing) {
    items.push({
      predicateKey: key,
      label: (drivers.find((d) => d.predicateKey === key)?.label) ?? key.replace(/_/g, " "),
      ladder: "UNKNOWN",
      conflicting: false,
      narrowsRangeBy: null,
      affects: "NOT_QUANTIFIABLE",
      reason: "No figure at all — its effect on the range cannot be calculated until a first bound exists.",
      ask: "Establish an initial bound with the customer.",
    });
  }

  const rank = { MODELED_RANGE: 0, AT_STAKE_TODAY: 1, NOT_QUANTIFIABLE: 2 } as const;
  return items.sort((a, b) => {
    // Conflicts first — an unresolved disagreement blocks the arithmetic itself. Then drivers that
    // actually move the modeled range, by the width each would remove. Then baseline-only drivers.
    // Unquantifiable gaps last.
    if (a.conflicting !== b.conflicting) return a.conflicting ? -1 : 1;
    if (rank[a.affects] !== rank[b.affects]) return rank[a.affects] - rank[b.affects];
    if ((a.narrowsRangeBy == null) !== (b.narrowsRangeBy == null)) return a.narrowsRangeBy == null ? 1 : -1;
    if (a.narrowsRangeBy != null && b.narrowsRangeBy != null && a.narrowsRangeBy !== b.narrowsRangeBy) {
      return b.narrowsRangeBy - a.narrowsRangeBy;
    }
    return LADDER_RANK[b.ladder] - LADDER_RANK[a.ladder];
  });
}

// ── Formatting helpers shared by every surface, so no surface invents its own wording ──────────

export const usd = (n: number): string => formatMoney(n);

/** A bounded value as text. A point renders as a point; a range never collapses to a day-like point. */
export const bounds = (b: Bounds | null): string =>
  b == null ? "UNKNOWN" : b.low === b.high ? usd(b.low) : `${usd(b.low)}–${usd(b.high)}`;

/** The evidence-quality line: "3 verified · 2 confirmed · 1 assumed". Zero counts are omitted. */
export function qualityLine(q: Record<Ladder, number>): string {
  const parts: string[] = [];
  if (q.VERIFIED) parts.push(`${q.VERIFIED} verified`);
  if (q.CUSTOMER_CONFIRMED) parts.push(`${q.CUSTOMER_CONFIRMED} customer-confirmed`);
  if (q.INFERRED) parts.push(`${q.INFERRED} inferred`);
  if (q.ASSUMED) parts.push(`${q.ASSUMED} assumed`);
  return parts.length ? parts.join(" · ") : "no economic evidence";
}
