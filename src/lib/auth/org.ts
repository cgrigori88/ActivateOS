import type { Pool, PoolClient } from "pg";
import { authConfigured, supabaseServer } from "./supabase";

type Db = Pool | PoolClient;

/**
 * Per-request tenant context (multi-tenant slice 2). THE way app code resolves
 * "which organization am I operating on":
 *
 *  - Identity configured + signed-in user → the user's org membership. A
 *    signed-in user WITHOUT a membership gets null (no tenant, no data) —
 *    membership is the grant, not the login.
 *  - Otherwise (Basic Auth demo, local dev) → the sole organization, exactly
 *    the behavior every screen had before identity existed.
 *
 * Multi-org users are future work: first membership wins until an org
 * switcher exists.
 */
export async function currentOrgId(db: Db): Promise<string | null> {
  if (authConfigured()) {
    let userId: string | null = null;
    try {
      const supabase = await supabaseServer();
      const { data } = await supabase.auth.getUser();
      userId = data.user?.id ?? null;
    } catch {
      /* outside a request scope (scripts) — fall through to sole-org */
    }
    if (userId) {
      const { rows } = await db.query<{ org_id: string }>(
        `select org_id from org_members where user_id = $1 order by created_at asc limit 1`,
        [userId],
      );
      return rows[0]?.org_id ?? null;
    }
  }
  const { rows } = await db.query<{ id: string }>(
    `select id from organizations order by created_at asc limit 1`,
  );
  return rows[0]?.id ?? null;
}
