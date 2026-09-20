import type { PoolClient } from "pg";

/**
 * P45-4 — THE ONE PRODUCTION DEFINITION OF A LIVE CAPABILITY GRANT.
 *
 * Before this module there were two hand-written grant queries — `dispatchSkill`'s authority check
 * and `staleAuthority`'s invalidation check. They agreed only by coincidence. Adding `expires_at`
 * to one and not the other would let a human approve an action that can no longer legally execute,
 * which is the exact failure `staleAuthority` exists to prevent. There is now one implementation,
 * and a structural certification proves no second P45 grant-expiry comparison exists.
 *
 * ── THE DATABASE ESTABLISHES "NOW" ──────────────────────────────────────────────────────────────
 *
 * The predicate below reads `transaction_timestamp()` and EXPOSES NO TIME OPERAND AT ALL — not a
 * parameter, not an `asOf`, not a `coalesce($n, transaction_timestamp())`. That is deliberate and
 * it is §14 / CFR-1.2 plus the D-P6-1 correction applied to a new instrument: a PostgreSQL
 * `timestamptz` carries MICROSECONDS and a JavaScript `Date` carries MILLISECONDS, so an instant
 * read into the application and bound back into SQL is up to 999µs BEHIND the database's own.
 * `expires_at > $asOf` can therefore be TRUE while `expires_at > transaction_timestamp()` is
 * already FALSE — authority the database has already withdrawn. Measured over 400 round-trips
 * during P6-IG, 400 of 400 lost precision.
 *
 * The deliberate as-of helpers in `federation/grants.ts` and `federation/contributions.ts` remain
 * separate and MUST NOT be repurposed as the live authority helper. There, the caller's chosen
 * instant is the subject of the question. Here, the boundary is.
 *
 * ── LIVENESS IS NOT APPLICABILITY ───────────────────────────────────────────────────────────────
 *
 * Liveness is status, revocation and expiry — is this instrument in force at all? Applicability is
 * actor, org, capability and version — does it speak to THIS action? They are different questions
 * and are kept apart so exact-version matching never duplicates expiry logic.
 */

/** Status, revocation and expiry. The only place P45 decides whether a grant is in force. */
export const LIVE_GRANT_SQL = `g.status = 'ACTIVE'
       and g.revoked_at is null
       and (g.expires_at is null or g.expires_at > transaction_timestamp())`;

export interface LiveGrant {
  id: string;
  skillVersion: number | null;
}

/**
 * The live grant this actor holds for `skillId`, or null.
 *
 * `skillVersion` narrows to grants that speak to that version: an explicit match, or the legacy
 * NULL wildcard. The wildcard is retained because it is the existing instrument's historical
 * semantics and this slice does not rewrite legacy grant behaviour — callers that require an
 * EXACT version (P45-4 strict AGENT execution) ask for it separately via `exactVersion`, which is
 * an applicability question, not a liveness one.
 */
export async function liveGrantFor(
  db: PoolClient,
  orgId: string,
  actorId: string,
  skillId: string,
  skillVersion: number,
  opts: { exactVersion?: boolean } = {},
): Promise<LiveGrant | null> {
  const applicability = opts.exactVersion
    ? `g.skill_version = $4`
    : `(g.skill_version is null or g.skill_version = $4)`;
  const { rows } = await db.query<{ id: string; skill_version: number | null }>(
    `select g.id, g.skill_version
       from actor_capability_grants g
      where g.org_id = $1 and g.actor_id = $2 and g.skill_id = $3
        and ${applicability}
        and ${LIVE_GRANT_SQL}
      order by g.created_at desc, g.id
      limit 1`,
    [orgId, actorId, skillId, skillVersion],
  );
  return rows[0] ? { id: rows[0].id, skillVersion: rows[0].skill_version } : null;
}
