import type { PoolClient } from "pg";
import type { FederationViewer } from "./disclosure";

/**
 * Consent grant engine (Workstream E3-B, R8/R24/R28). A grant binds a PURPOSE and
 * SCOPE, an expiry, and delegation/onward rules; DATA consent and ACTION authority
 * are separate `grant_kind`s (R24). Revocation/expiry stops FUTURE access at read
 * time via `grant_is_live` — never a destructive delete (R28).
 */

export type GrantKind = "DATA" | "ACTION";

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

async function decide(db: PoolClient, grantId: string, status: "accepted" | "declined" | "revoked"): Promise<void> {
  const stamp = status === "revoked" ? "revoked_at" : "decided_at";
  await db.query(`update context_grants set status = $2, ${stamp} = now() where id = $1`, [grantId, status]);
}
export const acceptGrant = (db: PoolClient, id: string) => decide(db, id, "accepted");
export const declineGrant = (db: PoolClient, id: string) => decide(db, id, "declined");
/** Revoke — future reads blocked immediately; audit/history preserved (R28). */
export const revokeGrant = (db: PoolClient, id: string) => decide(db, id, "revoked");

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
export async function buildFederationViewer(db: PoolClient, orgId: string, pursuitId: string): Promise<FederationViewer> {
  const { rows: sp } = await db.query<{ owner: string | null; participant: boolean }>(
    `select (select org_id from pursuits where id = $2) as owner,
            exists (select 1 from pursuit_participants where pursuit_id = $2 and org_id = $1 and participation_state = 'ACTIVE') as participant`,
    [orgId, pursuitId],
  );
  const isSponsor = sp[0]?.owner === orgId;
  const isParticipant = sp[0]?.participant ?? false;
  const allowlistGrantedFor = await allowlistKeysFor(db, orgId, pursuitId);
  return { orgId, isSponsor, isParticipant, allowlistGrantedFor };
}
