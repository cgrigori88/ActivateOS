import type { Pool, PoolClient } from "pg";
import { getValueCase, type ValueCase, type Bounds } from "./case";

/**
 * Value Case aggregation (P2B §14, Motions).
 *
 * §14 is explicit: *"Do not sum overlapping/duplicated impact values without explicit aggregation
 * semantics."* Modeled impact is a property of an ACCOUNT — the economic drivers live on the
 * company, not the pursuit — so two pursuits against the same account model the SAME customer
 * impact. Adding them would double-count a single business case.
 *
 * The semantics implemented here, stated rather than assumed:
 *
 *   1. **De-duplicate by account.** Each account contributes its modeled impact at most once,
 *      regardless of how many pursuits target it.
 *   2. **Only defensible cases are summed.** A pursuit whose case is not defensible contributes
 *      nothing to the total and is counted separately, so the aggregate never quietly treats
 *      "we don't know" as zero.
 *   3. **CONFLICTING accounts are excluded from the sum**, and reported on their own. Summing a
 *      contested figure would bake a disagreement into a portfolio number.
 *   4. **Interval arithmetic throughout** — the aggregate is a range, never a point.
 *
 * The result therefore always reports what it EXCLUDED, so a reader can never mistake the total
 * for the whole book.
 */

export interface ValueAggregate {
  /** Σ modeled impact over de-duplicated, defensible, non-conflicting accounts. */
  total: Bounds | null;
  /** Accounts that contributed. */
  accountsCounted: number;
  /** Accounts excluded because their case is not defensible — UNKNOWN, never zero. */
  accountsNotDefensible: number;
  /** Accounts excluded because their economics are contested. */
  accountsConflicting: number;
  /** Accounts with a Value Case at all (the denominator for coverage). */
  accountsWithAnyCase: number;
  /** One sentence stating exactly what the total does and does not contain. */
  basis: string;
}

export async function aggregateValue(
  db: Pool | PoolClient, orgId: string, opts: { companyIds?: string[] | null; limit?: number } = {},
): Promise<ValueAggregate> {
  const { companyIds = null, limit = 200 } = opts;
  const scoped = companyIds != null;

  const { rows } = await db.query<{ id: string; account_id: string }>(
    `select p.id, p.account_id
       from pursuits p
      where p.org_id = $1 and p.status not in ('CLOSED','ARCHIVED')
        and ($3::boolean is false or p.account_id = any($2))
      order by p.expected_value_weighted desc nulls last
      limit $4`,
    [orgId, companyIds ?? [], scoped, limit]);

  // Rule 1: one Value Case per ACCOUNT. Economics are account-scoped; two pursuits against the
  // same account describe one customer's business case, not two.
  const seen = new Set<string>();
  const cases: ValueCase[] = [];
  for (const r of rows) {
    if (seen.has(r.account_id)) continue;
    seen.add(r.account_id);
    const vc = await getValueCase(db, orgId, r.id);
    if (vc && vc.state !== "NOT_ESTABLISHED") cases.push(vc);
  }

  const conflicting = cases.filter((c) => c.state === "CONFLICTING");
  const notDefensible = cases.filter((c) => c.state !== "CONFLICTING" && (!c.defensible || !c.modeledImpact));
  const counted = cases.filter((c) => c.state !== "CONFLICTING" && c.defensible && c.modeledImpact);

  const total = counted.length === 0 ? null : counted.reduce<Bounds>(
    (a, c) => ({ low: a.low + c.modeledImpact!.low, high: a.high + c.modeledImpact!.high }),
    { low: 0, high: 0 });

  const parts = [`${counted.length} account${counted.length === 1 ? "" : "s"} with a defensible case`];
  if (notDefensible.length) parts.push(`${notDefensible.length} not yet defensible (excluded, not counted as zero)`);
  if (conflicting.length) parts.push(`${conflicting.length} with contested economics (excluded)`);

  return {
    total,
    accountsCounted: counted.length,
    accountsNotDefensible: notDefensible.length,
    accountsConflicting: conflicting.length,
    accountsWithAnyCase: cases.length,
    basis: `De-duplicated by account: ${parts.join("; ")}.`,
  };
}
