import type { PoolClient } from "pg";
import type { FederationViewer } from "./disclosure";

/**
 * Consent grant engine (Workstream E3-B, R8/R24/R28). A grant binds a PURPOSE and
 * SCOPE, an expiry, and delegation/onward rules; DATA consent and ACTION authority
 * are separate `grant_kind`s (R24). Revocation/expiry stops FUTURE access at read
 * time via `grant_is_live` — never a destructive delete (R28).
 */

export type GrantKind = "DATA" | "ACTION";

/**
 * THE AUTHORITATIVE GOVERNANCE CLOCK — AN OBSERVABLE, NEVER A COMPARISON INSTANT.
 *
 * `now()` in PostgreSQL IS `transaction_timestamp()`: fixed for the whole transaction and distinct
 * from `clock_timestamp()`. `withTenant`/`withTenantOrg` wrap each request in one transaction, so
 * every governance predicate below that reads `transaction_timestamp()` reads ONE instant — the
 * identical instant the RLS predicate in `can_see_pursuit` reads as `now()`.
 *
 * THIS FUNCTION IS FOR REPORTING AND AUDIT ONLY. It must never supply the instant a live
 * governance comparison is made against, because a PostgreSQL `timestamptz` carries MICROSECONDS
 * and a JavaScript `Date` carries MILLISECONDS. Crossing that boundary TRUNCATES: measured over
 * 400 round-trips, 400 of 400 lost precision (`01:00:30.787462` → `01:00:30.787`). A clock read
 * into JavaScript and bound back into SQL is therefore up to 999µs BEHIND the database's own, so
 * `effective_to > $asOf` can be TRUE while `effective_to > now()` is already FALSE. That admits a
 * participant the database has already excluded — stored policy != enforced policy, at exactly the
 * boundary this workstream exists to enforce. The P6-IG suite caught it as a 1-in-3 flake on the
 * "exactly at effective_to" assertion.
 *
 * THE RULE. A LIVE decision compares in SQL, against `transaction_timestamp()`, and the instant
 * never enters JavaScript. An explicit `asOf` is reserved for a DELIBERATE as-of query, where the
 * caller's chosen instant — not the boundary — is the subject.
 *
 * An application wall clock (`new Date()`) is never used for a governance decision either: it can
 * drift across an `effective_to` or `expires_at` boundary that the database has already decided.
 */
export async function governanceClock(db: PoolClient): Promise<Date> {
  const { rows } = await db.query<{ t: Date }>(`select transaction_timestamp() as t`);
  return rows[0].t;
}

export interface ProposeGrantInput {
  pursuitId?: string | null;
  fromOrgId: string;
  toOrgId: string;
  grantKind?: GrantKind;
  informationClasses?: string[];  // DATA: audience classes the receiver may resolve
  actionFamily?: string;          // ACTION: e.g. 'route.request_acceptance'
  purpose: string;                // R8 — required
  scope?: Record<string, unknown>;
  expiresAt?: Date | null;
  delegationAllowed?: boolean;
  onwardSharingAllowed?: boolean;
  retentionClass?: string | null;
  dataEnvironment?: string;
}

export async function proposeGrant(db: PoolClient, i: ProposeGrantInput): Promise<string> {
  if (!i.purpose?.trim()) throw new Error("A grant requires an explicit purpose (R8).");
  const { rows } = await db.query<{ id: string }>(
    `insert into context_grants
       (pursuit_id, from_org_id, to_org_id, grant_kind, information_classes, action_family,
        purpose, scope, expires_at, delegation_allowed, onward_sharing_allowed, retention_class, data_environment)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
    [i.pursuitId ?? null, i.fromOrgId, i.toOrgId, i.grantKind ?? "DATA",
     i.informationClasses ?? null, i.actionFamily ?? null, i.purpose, JSON.stringify(i.scope ?? {}),
     i.expiresAt ?? null, i.delegationAllowed ?? false, i.onwardSharingAllowed ?? false,
     i.retentionClass ?? null, i.dataEnvironment ?? "PRODUCTION"],
  );
  return rows[0].id;
}

async function decide(db: PoolClient, orgId: string, grantId: string, status: "accepted" | "declined" | "revoked"): Promise<void> {
  const stamp = status === "revoked" ? "revoked_at" : "decided_at";
  // The receiving org accepts/declines; the granting org revokes. A grant the caller is not party to is refused.
  const party = status === "revoked" ? "from_org_id" : "to_org_id";
  const { rowCount } = await db.query(`update context_grants set status = $2, ${stamp} = now() where id = $1 and ${party} = $3`, [grantId, status, orgId]);
  if (!rowCount) throw new Error(`grant not found: ${grantId}`);
}
export const acceptGrant = (db: PoolClient, orgId: string, id: string) => decide(db, orgId, id, "accepted");
export const declineGrant = (db: PoolClient, orgId: string, id: string) => decide(db, orgId, id, "declined");
/** Revoke — future reads blocked immediately; audit/history preserved (R28). */
export const revokeGrant = (db: PoolClient, orgId: string, id: string) => decide(db, orgId, id, "revoked");

/** Sweeper: flip accepted-but-past-expiry grants to expired (R8/R28). Worker-driven in E3-E. */
export async function expireDueGrants(db: PoolClient): Promise<number> {
  const { rowCount } = await db.query(
    `update context_grants set status = 'expired' where status = 'accepted' and expires_at is not null and expires_at <= now()`,
  );
  return rowCount ?? 0;
}

/** Is there a LIVE (accepted, unexpired) DATA grant to `toOrgId` for this pursuit? */
export async function hasLiveDataGrant(db: PoolClient, toOrgId: string, pursuitId: string): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(
    `select exists (
       select 1 from context_grants
       where to_org_id = $1 and (pursuit_id = $2 or pursuit_id is null)
         and grant_kind = 'DATA' and status = 'accepted'
         and (expires_at is null or expires_at > now())) as ok`,
    [toOrgId, pursuitId],
  );
  return rows[0].ok;
}

/** Is one specific grant (by id) currently LIVE — accepted and unexpired? Used by the
 *  external-action executor to re-check consent BEFORE execution (R1-G4 revocation). */
export async function grantIsLiveById(db: PoolClient, grantId: string): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(
    `select exists (
       select 1 from context_grants
       where id = $1 and status = 'accepted' and (expires_at is null or expires_at > now())) as ok`,
    [grantId]);
  return rows[0].ok;
}

/**
 * Does `toOrgId` hold a LIVE ACTION authority for `actionFamily` on this pursuit (R24)?
 * A DATA sharing grant NEVER satisfies this — action authority is a separate grant kind.
 */
export async function hasActionAuthority(db: PoolClient, toOrgId: string, pursuitId: string, actionFamily: string): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(
    `select exists (
       select 1 from context_grants
       where to_org_id = $1 and (pursuit_id = $2 or pursuit_id is null)
         and grant_kind = 'ACTION' and action_family = $3 and status = 'accepted'
         and (expires_at is null or expires_at > now())) as ok`,
    [toOrgId, pursuitId, actionFamily],
  );
  return rows[0].ok;
}

/** Object keys this viewer is specifically granted (for ORG_ALLOWLIST resolution). */
export async function allowlistKeysFor(db: PoolClient, toOrgId: string, pursuitId: string): Promise<Set<string>> {
  const { rows } = await db.query<{ scope: { keys?: string[] } }>(
    `select scope from context_grants
      where to_org_id = $1 and pursuit_id = $2 and grant_kind = 'DATA' and status = 'accepted'
        and (expires_at is null or expires_at > now())`,
    [toOrgId, pursuitId],
  );
  const keys = new Set<string>();
  for (const r of rows) for (const k of r.scope?.keys ?? []) keys.add(k);
  return keys;
}

/**
 * Build the FederationViewer for a caller against a pursuit (R6 richer Caller).
 * isSponsor = owns the pursuit; isParticipant = an ACTIVE participant; allowlist
 * keys come from live DATA grants scoped to this pursuit.
 */
export async function buildFederationViewer(db: PoolClient, orgId: string, pursuitId: string, asOf?: Date | null): Promise<FederationViewer> {
  // ONE CLOCK, AND IT NEVER LEAVES SQL. `asOf` null/absent — the live path every caller in src/
  // uses — coalesces to the transaction timestamp, the same value `can_see_pursuit` reads as
  // `now()`, at full microsecond precision. The effective-window conjuncts below are then
  // CHARACTER-FOR-CHARACTER the predicate's, so RLS eligibility and read-model standing cannot
  // disagree at a boundary — which they did before P6-IG, when `effective_from`/`effective_to` had
  // zero references anywhere in src/, and which they still did while this value was threaded
  // through a millisecond JavaScript `Date` (see `governanceClock`).
  const { rows: sp } = await db.query<{ owner: string | null; participant: boolean }>(
    `select (select org_id from pursuits where id = $2) as owner,
            exists (select 1 from pursuit_participants
                     where pursuit_id = $2 and org_id = $1
                       and participation_state = 'ACTIVE'
                       and (effective_from is null or effective_from <= coalesce($3::timestamptz, transaction_timestamp()))
                       and (effective_to   is null or effective_to   >  coalesce($3::timestamptz, transaction_timestamp()))) as participant`,
    [orgId, pursuitId, asOf ?? null],
  );
  const isSponsor = sp[0]?.owner === orgId;
  const isParticipant = sp[0]?.participant ?? false;
  const allowlistGrantedFor = await allowlistKeysFor(db, orgId, pursuitId);
  return { orgId, isSponsor, isParticipant, allowlistGrantedFor };
}


/**
 * ONWARD SHARING — object level (A-owned item → B → C).
 *
 * B may re-disclose an item it does not own ONLY when the live A→B authority explicitly permits it.
 * `onward_sharing_allowed = false` is a HARD DENIAL. `true` removes that one prohibition and
 * nothing else: C must still independently satisfy tenant/org eligibility, pursuit membership
 * (with the effective window), source classification, an applicable live DATA grant, disclosure
 * resolution, and derivation authority where a derived output is involved. Onward permission is
 * never a visibility grant.
 */
export async function mayShareOnward(
  db: PoolClient, sharerOrgId: string, ownerOrgId: string, pursuitId: string, asOf: Date | null = null,
): Promise<{ allow: boolean; reason: string }> {
  if (sharerOrgId === ownerOrgId) return { allow: true, reason: "the sharer owns the item" };
  const { rows } = await db.query<{ ok: boolean }>(
    `select exists (
       select 1 from context_grants
        where from_org_id = $1 and to_org_id = $2 and (pursuit_id = $3 or pursuit_id is null)
          and grant_kind = 'DATA' and status = 'accepted'
          and onward_sharing_allowed = true
          and (expires_at is null or expires_at > coalesce($4::timestamptz, transaction_timestamp()))) as ok`,
    [ownerOrgId, sharerOrgId, pursuitId, asOf ?? null]);
  return rows[0]?.ok
    ? { allow: true, reason: "the owner's grant permits onward sharing — the recipient must still qualify independently" }
    : { allow: false, reason: "the owner's grant does not permit onward sharing" };
}

/**
 * ONWARD SHARING — pursuit level (B creates a B→C grant over A-owned content).
 *
 * UNSUPPORTED AND FAIL-CLOSED. `context_grants` carries no `parent_grant_id`, no `source_grant_id`
 * and no content-owner reference, so a B→C row cannot be connected to the A→B row that would have
 * to authorize it, and attenuation cannot be proven. A boolean without provable authority lineage
 * grants nothing. No lineage is added in 0112: no current product path needs the capability, and
 * speculative schema for a future one is prohibited.
 *
 * DELEGATION is refused for exactly the same reason — `delegation_allowed = true` grants nothing.
 */
export function mayGrantOnwardAtPursuitLevel(): { allow: false; reason: string } {
  return { allow: false, reason: "pursuit-level onward sharing of another organization's data is unsupported in P6-IG: no authority lineage exists to prove attenuation" };
}
export const mayDelegate = mayGrantOnwardAtPursuitLevel;
