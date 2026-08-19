import type { Pool, PoolClient } from "pg";

type Db = Pool | PoolClient;

/**
 * Guest seats (B+2, task #81). The partnership invite code doubles as a
 * shareable link (/join/<code>): whoever holds a live code may claim a FREE
 * guest workspace that lands already connected to the inviter. The code is
 * the capability — ~93 bits, single-use (redeeming activates the
 * partnership, which retires the code).
 *
 * A guest workspace is a full tenant behind the same RLS and consent fabric.
 * The v1 cap is exactly one: guests cannot mint partnership invites of their
 * own (see createPartnershipInvite) — co-selling beyond the inviting
 * partnership is the upgrade.
 */

export interface InviteInfo {
  partnershipId: string;
  inviterOrgName: string;
  /** The partner record the inviter bound this invite to — how they call you. */
  boundPartnerName: string | null;
}

/** Live (unredeemed) invite lookup. Anything else — unknown, redeemed, revoked — is null; callers say "not valid anymore" without detail. */
export async function inviteInfo(db: Db, code: string): Promise<InviteInfo | null> {
  const trimmed = code.trim().toUpperCase();
  if (!/^[A-Z2-9-]{10,32}$/.test(trimmed)) return null;
  const { rows } = await db.query<{ id: string; inviter: string; bound: string | null }>(
    `select p.id, o.name as inviter, pa.name as bound
     from partnerships p
     join organizations o on o.id = p.initiator_org_id
     left join partners pa on pa.id = p.initiator_partner_id
     where p.invite_code = $1 and p.status = 'invited'`,
    [trimmed],
  );
  if (!rows[0]) return null;
  return { partnershipId: rows[0].id, inviterOrgName: rows[0].inviter, boundPartnerName: rows[0].bound };
}

export async function orgKind(db: Db, orgId: string): Promise<"full" | "guest"> {
  const { rows } = await db.query<{ kind: "full" | "guest" }>(
    `select kind from organizations where id = $1`,
    [orgId],
  );
  return rows[0]?.kind ?? "full";
}

/** Create the guest tenant shell. Membership and redemption are the caller's steps. */
export async function createGuestOrg(db: Db, name: string): Promise<string> {
  const clean = name.trim().slice(0, 120);
  if (!clean) throw new Error("The workspace needs a name.");
  const { rows } = await db.query<{ id: string }>(
    `insert into organizations (name, kind) values ($1, 'guest') returning id`,
    [clean],
  );
  return rows[0].id;
}
