import type { Pool, PoolClient } from "pg";
import { resolveTie } from "@/lib/facts/provenance-precedence";

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
  valid_from: Date | null; valid_until: Date | null;
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
 * The driver projection, written ONCE. Both the single-account and bulk readers append their own
 * company predicate to this, so the two paths cannot drift into selecting different columns or a
 * different `family` — which is the way a "faster" variant usually stops agreeing.
 *
 * ── THE ORDER IS TOTAL, AND IT HAS TO BE (D-G5-1) ───────────────────────────────────────────────
 *
 * `order by predicate_key, observed_last_at desc` alone is NOT a total order: two economic facts
 * asserted at the same instant tie on every key, and PostgreSQL may then return them in either
 * order. That order is not cosmetic — it becomes `Driver.values[]`, which is part of the value
 * case, and on a tie between a VERIFIED $1.8M and an INFERRED $2.4M assertion it decides what the
 * case reports.
 *
 * It was latent for as long as one plan happened to be stable, and the equivalence harness for the
 * bulk reader is what surfaced it: the bulk query sorts a larger row set, the planner chose a
 * different arrangement of the tied pair, and the two readers disagreed on one account out of
 * eleven. The defect was never the batching — it was an ordering the repository's own
 * ordering-determinism discipline already forbids. `f.id` is the declared final key: arbitrary, and
 * arbitrary is exactly what a tie-break must be, so long as it is DECLARED and stable.
 */
const FACT_DRIVER_SELECT = `select f.id, f.predicate_key, p.signal_type,
            f.money_amount, f.money_currency, f.number_value,
            f.object_type, f.object_value, f.provenance_class, f.status, f.disclosure_class,
            f.subject_label, f.observed_last_at, f.confidence, f.superseded_by, f.supersedes,
            f.valid_from, f.valid_until,
            (select count(*) from fact_evidence fe where fe.fact_id = f.id)::text evidence_count,
            exists (select 1 from fact_contradictions fc
                     where fc.status = 'open' and (fc.fact_id_a = f.id or fc.fact_id_b = f.id)) contradiction_open
       from facts f
       join fact_predicates p on p.key = f.predicate_key
      where f.org_id = $1 and p.family = 'economic'`;
const FACT_DRIVER_ORDER = `f.predicate_key, f.observed_last_at desc, f.id`;

/**
 * Load the economic drivers for one account. RLS-scoped; the caller supplies any narrowing.
 * Superseded and REJECTED rows are kept but separated into `history` — an economic assertion that
 * was replaced is part of the audit trail, not part of the current model.
 */
export async function loadDrivers(
  db: Pool | PoolClient, orgId: string, companyId: string, asOf: Date,
): Promise<Driver[]> {
  const { rows } = await db.query<FactRow>(
    FACT_DRIVER_SELECT + ` and f.company_id = $2 order by ` + FACT_DRIVER_ORDER,
    [orgId, companyId]);
  return assembleDrivers(rows, asOf);
}

/**
 * The same drivers, for MANY accounts, in ONE query (Slice 2).
 *
 * WHY THIS EXISTS. `loadPortfolioCandidates` called `getValueCase` once per pursuit, and each call
 * issued three statements — so P2's cost was 3N + 9 and grew without bound with the portfolio. The
 * fix is a READ-LAYER change only: the predicate becomes `= any($2)`, the rows are partitioned by
 * company, and each partition is handed to the SAME `assembleDrivers` the single-account path uses.
 *
 * NOT A SECOND IMPLEMENTATION. Every rule that decides what a driver is — supersession, the
 * validity window against the caller's single `asOf`, the ladder ordering, the conflict rule, the
 * tie collapse, the spread arithmetic — lives in `assembleDrivers` and is executed identically by
 * both paths. If that function changes, both change. A parallel copy of this logic would be a
 * second source of truth for the economics, which `case.ts` is explicit about refusing.
 */
export async function loadDriversBulk(
  db: Pool | PoolClient, orgId: string, companyIds: string[], asOf: Date,
): Promise<Map<string, Driver[]>> {
  const out = new Map<string, Driver[]>();
  if (companyIds.length === 0) return out;
  const { rows } = await db.query<FactRow & { company_id: string }>(
    // The partition key leads the sort so rows arrive grouped, but the WITHIN-company order is the
    // identical total order the single-account reader uses — which is what makes the two agree.
    FACT_DRIVER_SELECT.replace("select f.id,", "select f.company_id, f.id,")
      + ` and f.company_id = any($2::uuid[]) order by f.company_id, ` + FACT_DRIVER_ORDER,
    [orgId, companyIds]);
  const byCompany = new Map<string, FactRow[]>();
  for (const r of rows) {
    const list = byCompany.get(r.company_id) ?? [];
    list.push(r);
    byCompany.set(r.company_id, list);
  }
  for (const [companyId, facts] of byCompany) out.set(companyId, assembleDrivers(facts, asOf));
  return out;
}

/**
 * ONE ACCOUNT'S FACT ROWS → ITS DRIVERS. Pure: no database, no clock of its own.
 *
 * Extracted verbatim from `loadDrivers` so the bulk path can reuse it rather than restate it. The
 * ONLY change is that the rows arrive as an argument instead of from a query immediately above.
 */
export function assembleDrivers(rows: FactRow[], asOf: Date): Driver[] {
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

    // D-G8-4C: eligibility is supersession AND the fact's own validity window, evaluated against an
    // EXPLICIT asOf the caller captured once. The window used to be ignored entirely, so a fact whose
    // validity had closed could still be "in force" as long as nothing superseded it.
    const inForceAt = (r: FactRow): boolean =>
      r.superseded_by == null && r.status !== "SUPERSEDED" && r.status !== "REJECTED"
      && (r.valid_from == null || r.valid_from.getTime() <= asOf.getTime())
      && (r.valid_until == null || r.valid_until.getTime() > asOf.getTime());
    const live = all.filter(inForceAt);
    const values = live.map(toValue).filter((v): v is DriverValue => v != null);
    const history = all.filter((r) => !live.includes(r)).map(toValue).filter((v): v is DriverValue => v != null);
    if (values.length === 0) continue;

    const contradicted = live.some((r) => r.contradiction_open) || live.some((r) => r.status === "DISPUTED");
    const distinct = new Set(values.map((v) => `${v.low}:${v.high}`));
    const conflicting = contradicted || distinct.size > 1;

    // The value in force: highest ladder rung, then most evidence, then freshest. Never chosen when
    // conflicting — a disagreement is resolved by evidence, not by ranking. D-G8-4C: anything still
    // tied after those three keys is collapsed only when it would report the SAME value and rung;
    // otherwise it is UNRESOLVED (null), exactly like a conflict, rather than decided by row order.
    const picked = conflicting ? null : resolveTie(
      values,
      (a, b) => LADDER_RANK[a.ladder] - LADDER_RANK[b.ladder] ||
        b.evidenceCount - a.evidenceCount ||
        b.observedLastAt.getTime() - a.observedLastAt.getTime(),
      (a, b) => a.low === b.low && a.high === b.high && a.ladder === b.ladder && a.currency === b.currency,
    );
    const inForce = picked?.kind === "RESOLVED" ? picked.value : null;

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
