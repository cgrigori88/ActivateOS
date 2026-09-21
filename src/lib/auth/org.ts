import type { Pool, PoolClient } from "pg";
import { cookies } from "next/headers";
import { authConfigured, supabaseServer } from "./supabase";

type Db = Pool | PoolClient;

/**
 * The selected organization, for a user who belongs to more than one.
 *
 * A COOKIE CARRIES THE CHOICE; IT DOES NOT MAKE IT. The value is an organization id the browser can
 * set to anything, so every read below re-checks it against `org_members` for the authenticated
 * user and discards it if the membership is not there. Forging it buys nothing: an id the user does
 * not belong to resolves exactly as if the cookie were absent.
 */
export const ORG_COOKIE = "pursuitos_org";

async function selectedOrgCookie(): Promise<string | null> {
  try {
    const v = (await cookies()).get(ORG_COOKIE)?.value ?? null;
    // Shape-check before it reaches a uuid column: a malformed value is not a database question.
    return v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v) ? v : null;
  } catch {
    return null;   // outside a request scope (scripts, workers)
  }
}

/**
 * The organizations this user may operate in, newest membership last. The ONLY source of truth for
 * what a switcher may offer, and for what a switch may select.
 */
export async function membershipsFor(db: Db, userId: string): Promise<{ orgId: string; name: string; role: string }[]> {
  const { rows } = await db.query<{ org_id: string; name: string; role: string }>(
    `select m.org_id, o.name, m.role
       from org_members m join organizations o on o.id = m.org_id
      where m.user_id = $1
      order by m.created_at asc, m.org_id asc`, [userId]);
  return rows.map((r) => ({ orgId: r.org_id, name: r.name, role: r.role }));
}

/**
 * The selected organization, ALREADY VALIDATED against the caller's own memberships — or null when
 * there is no selection, the selection is not theirs, or there is nobody to validate against.
 *
 * THERE IS EXACTLY ONE OF THESE, ON PURPOSE. The selection used to be validated inline in
 * `currentOrgId`, and separately again in `currentRole`, and NOT AT ALL in `sessionOrgId` — the
 * third resolver, the one that pins `app.org_id` and therefore decides what every RLS-scoped read
 * on a page can see. So the shell switched organizations and the data did not: the switcher named
 * Red Hat Pilot while `withTenant` went on serving the oldest membership, because
 * `resolve_user_org(uid)` answers "the user's first org" and knows nothing about a selection.
 * Three copies of a rule is how one of them ends up not having it. Now there is one.
 *
 * VALIDATED ON THE OWNER POOL, because on the tenant connection it can never succeed: `org_members`
 * is RLS-FORCED on `is_org_member(org_id)` and `user_id = auth.uid()`, and on the app_rw connection
 * `auth.uid()` is null while `app.org_id` is not yet set — resolving it is what these callers are
 * for. The CONNECTION widens; the SUBJECT does not, because `m.user_id = $2` keeps the read bound
 * to the authenticated user. A cookie naming an organization the user does not belong to matches no
 * row and degrades to the deterministic default, so forging it buys nothing.
 *
 * `userId` null means Basic-Auth / demo mode: there are no memberships to check a preference
 * against, so a cookie must not be honoured there at all.
 */
export async function validatedSelectedOrg(
  userId: string | null,
): Promise<{ orgId: string; role: "owner" | "operator" | "viewer" } | null> {
  if (!userId) return null;
  const chosen = await selectedOrgCookie();
  if (!chosen) return null;
  try {
    const { getOwnerPool } = await import("@/db/client");
    const { rows } = await getOwnerPool().query<{ org_id: string; role: "owner" | "operator" | "viewer" }>(
      `select m.org_id, m.role from org_members m where m.org_id = $1 and m.user_id = $2`, [chosen, userId]);
    return rows[0] ? { orgId: rows[0].org_id, role: rows[0].role } : null;
  } catch {
    return null;   // no owner pool configured — fall through to the deterministic default
  }
}

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
      // THE SELECTION IS VALIDATED, NOT TRUSTED — and it is validated in exactly one place, which
      // `sessionOrgId` shares, so the shell and the data can never again answer about different
      // organizations. See `validatedSelectedOrg`.
      const selected = await validatedSelectedOrg(userId);
      if (selected) return selected.orgId;
      // Deterministic fallback, unchanged: a user with one membership never needs to choose.
      const { rows } = await db.query<{ org_id: string }>(
        `select org_id from org_members where user_id = $1 order by created_at asc, org_id asc limit 1`,
        [userId],
      );
      return rows[0]?.org_id ?? null;
    }
  }
  const { rows } = await db.query<{ id: string }>(
    `select id from organizations order by created_at asc, id asc limit 1`,
  );
  return rows[0]?.id ?? null;
}

/**
 * The caller's role in their org: 'owner' | 'operator' | 'viewer'. Basic-Auth
 * / local-dev mode (no identity) acts as 'owner' — the single operator owns
 * the demo. A signed-in user without membership has no role (null).
 */
export async function currentRole(db: Db): Promise<"owner" | "operator" | "viewer" | null> {
  if (!authConfigured()) return "owner";
  let userId: string | null = null;
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.auth.getUser();
    userId = data.user?.id ?? null;
  } catch {
    return "owner"; // outside a request scope (worker/scripts) — system context
  }
  if (!userId) return "owner"; // Basic-Auth session, not an identity session
  // THE ROLE MUST FOLLOW THE SELECTED ORGANIZATION. It did not: it read the first membership while
  // `currentOrgId` could return a different one, so after a switch a viewer in the selected
  // organization could carry an owner role from another. Both now answer about the same org.
  const selected = await validatedSelectedOrg(userId);
  if (selected) return selected.role;
  const { rows } = await db.query<{ role: "owner" | "operator" | "viewer" }>(
    `select role from org_members where user_id = $1 order by created_at asc, org_id asc limit 1`,
    [userId],
  );
  return rows[0]?.role ?? null;
}

/**
 * Gate for mutating server actions: owners and operators pass; viewers and
 * membership-less users are refused. Mirrors the database's write policies so
 * the app refuses politely before RLS would refuse silently.
 */
export async function requireWrite(db: Db): Promise<void> {
  const role = await currentRole(db);
  if (role === "owner" || role === "operator") return;
  throw new Error("Read-only access — ask an owner to make you an operator.");
}

/** Gate for platform administration (members, roles, ops): owners only. */
export async function requireOwner(db: Db): Promise<void> {
  const role = await currentRole(db);
  if (role === "owner") return;
  throw new Error("Owner access required.");
}
