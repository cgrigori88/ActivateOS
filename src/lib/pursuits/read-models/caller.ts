import type { PoolClient } from "pg";
import type { Caller } from "./helpers";

/**
 * Build the disclosure Caller for the current tenant (Workstream D, §39). Internal (full) route
 * explanations and raw transaction detail are visible to a full tenant's own members; a GUEST
 * tenant (a partner brought in through the consent fabric) sees only shareable, disclosure-safe
 * explanations. Derived from tenant state, never from a name check (§57).
 */
export async function callerFor(db: PoolClient, orgId: string): Promise<Caller> {
  const { rows } = await db.query<{ kind: string | null }>(`select kind from organizations where id = $1`, [orgId]);
  const isGuest = rows[0]?.kind === "guest";
  return { orgId, canSeeInternal: !isGuest, canSeeTransactionDetail: !isGuest };
}
