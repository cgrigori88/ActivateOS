import { randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { runTx } from "@/db/client";
import { authConfigured, supabaseServer } from "@/lib/auth/supabase";

type Db = Pool | PoolClient;

/**
 * Partnership handshake + cross-tenant audit (multi-tenant slice 5, task #64).
 *
 * The model in one paragraph: `partners` rows stay each org's private LENS on
 * a counterpart; a `partnership` connects two tenants' lenses after an invite
 * code is redeemed by the other side's owner. Nothing crosses the boundary by
 * default — a `list_grant` is the only bridge, it's field-scoped, the RECEIVER
 * must accept before anything materializes in their org, and revoking flips
 * the materialized copy off. Every step lands in each org's own `audit_log`.
 */

// ── actor + ledger ──────────────────────────────────────────────────────────

/** Who is acting — the signed-in email, else the Basic-Auth/local operator. */
export async function currentActor(): Promise<string> {
  if (!authConfigured()) return "operator";
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.auth.getUser();
    return data.user?.email ?? "operator";
  } catch {
    return "system"; // outside a request scope (worker/scripts)
  }
}

/**
 * Append to an org's ledger. Best-effort BY DOCTRINE: an audit failure must not roll back the action
 * it records (D-049).
 *
 * Two things make that doctrine true under RLS (H1B-0), where before it was only claimed:
 *
 *  1. A partnership-scoped event may land in the COUNTERPART's ledger — the handshake doctrine is
 *     "every step lands in each org's own audit_log". Under the least-privilege runtime role a plain
 *     insert carrying the other org's id is refused by the audit_log policy, so those rows go through
 *     `audit_partnership_event()` (migration 0104): a SECURITY DEFINER function that writes only to a
 *     party of that exact partnership, only when the caller is a party too.
 *  2. Inside a caller's transaction, a failed statement aborts the WHOLE transaction — catching the JS
 *     error afterwards does not undo that. So the write runs under a SAVEPOINT and a failure rolls back
 *     to it: the business action commits, and the lost audit row is logged loudly.
 */
export async function audit(
  db: Db,
  orgId: string,
  event: string,
  detail: Record<string, unknown> = {},
  partnershipId?: string | null,
): Promise<void> {
  const actor = await currentActor();
  const write = () => partnershipId
    ? db.query(`select audit_partnership_event($1, $2, $3, $4, $5::jsonb)`, [partnershipId, orgId, actor, event, JSON.stringify(detail)])
    : db.query(`insert into audit_log (org_id, actor, event, detail, partnership_id) values ($1, $2, $3, $4, null)`,
        [orgId, actor, event, JSON.stringify(detail)]);
  // A Pool runs each query in its own implicit transaction — nothing to protect. A client may be inside
  // the caller's transaction: guard the write with a savepoint (outside a transaction block SAVEPOINT
  // itself errors harmlessly, and the write then runs on its own).
  let savepoint = false;
  if ("release" in db) {
    try { await db.query("savepoint audit_write"); savepoint = true; } catch { /* not in a transaction block */ }
  }
  try {
    await write();
    if (savepoint) await db.query("release savepoint audit_write");
  } catch (err) {
    if (savepoint) await db.query("rollback to savepoint audit_write").catch(() => {});
    console.error(`audit_log write failed (${event}) — the action it records was kept:`, err);
  }
}

// ── handshake ───────────────────────────────────────────────────────────────

/** Human-shareable code: 20 chars, unambiguous alphabet, ~93 bits. */
function makeInviteCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
  const bytes = randomBytes(20);
  let code = "";
  for (let i = 0; i < 20; i++) {
    code += alphabet[bytes[i] % alphabet.length];
    if (i === 4 || i === 9 || i === 14) code += "-";
  }
  return code;
}

/**
 * Initiator side: create an invite bound to one of MY partner lenses. The code
 * is the whole secret — share it out-of-band with the counterpart's owner.
 */
export async function createPartnershipInvite(
  db: Db,
  orgId: string,
  partnerId: string,
): Promise<{ id: string; inviteCode: string }> {
  const { rows: lens } = await db.query<{ id: string; name: string }>(
    `select id, name from partners where id = $1 and org_id = $2`,
    [partnerId, orgId],
  );
  if (!lens[0]) throw new Error("That partner doesn't belong to your organization.");

  // Guest cap (B+2): a guest workspace co-sells inside the partnership that
  // created it — inviting partners of its own is the upgrade.
  const { rows: kind } = await db.query<{ kind: string }>(`select kind from organizations where id = $1`, [orgId]);
  if (kind[0]?.kind === "guest") {
    throw new Error("Guest workspaces can't invite partners — upgrade to a full workspace to build your own network.");
  }

  const inviteCode = makeInviteCode();
  const { rows } = await db.query<{ id: string }>(
    `insert into partnerships (initiator_org_id, initiator_partner_id, invite_code)
     values ($1, $2, $3) returning id`,
    [orgId, partnerId, inviteCode],
  );
  await audit(db, orgId, "partnership.invited", { partner: lens[0].name }, rows[0].id);
  return { id: rows[0].id, inviteCode };
}

/**
 * Counterpart side: redeem the code. Creates MY lens on the initiator (a plain
 * `partners` row named after their org, so every existing screen works), binds
 * it to the partnership, and activates. Both ledgers record it.
 */
export async function redeemPartnershipInvite(pool: Pool | PoolClient, orgId: string, code: string): Promise<void> {
  return runTx(pool, async (db) => {
    // Pre-membership by nature: the redeemer is not yet a party, so under the least-privilege runtime
    // role the invited partnership is invisible to it. `redeem_partnership_invite()` (migration 0104)
    // acts on the ONE partnership whose code was presented — the ~93-bit code is the credential — as
    // the caller's org from trusted server context (`app.org_id`, set here from the authenticated org
    // for the owner-pool /join path; withTenant has already set the same value on the admin path). It
    // can neither list nor discover invites.
    await db.query(`select set_config('app.org_id', $1, true)`, [orgId]);
    const { rows } = await db.query<{ partnership_id: string; initiator_org_id: string; initiator_name: string; redeemer_name: string }>(
      `select partnership_id, initiator_org_id, initiator_name, redeemer_name from redeem_partnership_invite($1)`,
      [code.trim().toUpperCase()],
    );
    const invite = rows[0];
    await audit(db, orgId, "partnership.accepted", { with: invite.initiator_name }, invite.partnership_id);
    await audit(db, invite.initiator_org_id, "partnership.accepted", { by: invite.redeemer_name ?? orgId }, invite.partnership_id);
  });
}

/**
 * Either side may sever. All grants riding the partnership are revoked and
 * their materialized copies flipped to rejected — access ends NOW, on both
 * sides, and both ledgers say who pulled the plug.
 */
export async function revokePartnership(pool: Pool | PoolClient, orgId: string, partnershipId: string): Promise<void> {
  return runTx(pool, async (db) => {
    const { rows } = await db.query<{ id: string; initiator_org_id: string; counterpart_org_id: string | null }>(
      `select id, initiator_org_id, counterpart_org_id from partnerships
       where id = $1 and (initiator_org_id = $2 or counterpart_org_id = $2)
       and status <> 'revoked' for update`,
      [partnershipId, orgId],
    );
    const p = rows[0];
    if (!p) throw new Error("Partnership not found (or already revoked).");

    // Kill every live grant, then its materialized copy. The copies sit in the RECEIVING org's book, so
    // flipping them is a cross-party write: `revoke_list_grant_copies()` (0104) does it for exactly the
    // copies of this partnership's now-revoked grants, and nothing else. Access ends NOW on both sides.
    await db.query(
      `update list_grants set status = 'revoked', decided_at = now()
       where partnership_id = $1 and status in ('offered','accepted')`,
      [partnershipId],
    );
    await db.query(`select revoke_list_grant_copies($1, null)`, [partnershipId]);
    await db.query(
      `update partnerships set status = 'revoked', revoked_at = now() where id = $1`,
      [partnershipId],
    );

    const { rows: me } = await db.query<{ name: string }>(`select name from organizations where id = $1`, [orgId]);
    const detail = { by: me[0]?.name ?? orgId };
    await audit(db, p.initiator_org_id, "partnership.revoked", detail, partnershipId);
    if (p.counterpart_org_id) await audit(db, p.counterpart_org_id, "partnership.revoked", detail, partnershipId);
  });
}

// ── list grants (the only thing that crosses the boundary) ──────────────────

/** The other org of a partnership, from my side of it. */
function otherOrg(p: { initiator_org_id: string; counterpart_org_id: string | null }, orgId: string): string | null {
  return p.initiator_org_id === orgId ? p.counterpart_org_id : p.initiator_org_id;
}

/**
 * Offer one of MY lists across an ACTIVE partnership, optionally scoped to a
 * subset of member-attribute fields. Nothing happens on their side until they
 * accept.
 */
export async function offerListGrant(
  db: Db,
  orgId: string,
  partnershipId: string,
  populationId: string,
  selectedFields: string[] | null,
): Promise<void> {
  const { rows: ps } = await db.query<{ initiator_org_id: string; counterpart_org_id: string | null }>(
    `select initiator_org_id, counterpart_org_id from partnerships
     where id = $1 and status = 'active' and (initiator_org_id = $2 or counterpart_org_id = $2)`,
    [partnershipId, orgId],
  );
  if (!ps[0]) throw new Error("No active partnership to share across.");
  const { rows: pop } = await db.query<{ name: string }>(
    `select name from account_populations where id = $1 and org_id = $2`,
    [populationId, orgId],
  );
  if (!pop[0]) throw new Error("That list doesn't belong to your organization.");

  const { rows } = await db.query<{ id: string }>(
    `insert into list_grants (partnership_id, from_org_id, population_id, selected_fields)
     values ($1, $2, $3, $4) returning id`,
    [partnershipId, orgId, populationId, selectedFields],
  );
  const detail = { list: pop[0].name, fields: selectedFields ?? "all", grant_id: rows[0].id };
  await audit(db, orgId, "grant.offered", detail, partnershipId);
  const other = otherOrg(ps[0], orgId);
  if (other) await audit(db, other, "grant.received", detail, partnershipId);
}

type GrantRow = {
  id: string;
  partnership_id: string;
  from_org_id: string;
  population_id: string;
  selected_fields: string[] | null;
  status: string;
  initiator_org_id: string;
  counterpart_org_id: string | null;
  initiator_partner_id: string | null;
  counterpart_partner_id: string | null;
};

async function loadIncomingGrant(db: Db, orgId: string, grantId: string, lock: boolean): Promise<GrantRow> {
  const { rows } = await db.query<GrantRow>(
    `select g.id, g.partnership_id, g.from_org_id, g.population_id, g.selected_fields, g.status,
            p.initiator_org_id, p.counterpart_org_id, p.initiator_partner_id, p.counterpart_partner_id
     from list_grants g join partnerships p on p.id = g.partnership_id
     where g.id = $1 and g.status = 'offered' and g.from_org_id <> $2
       and (p.initiator_org_id = $2 or p.counterpart_org_id = $2)
       ${lock ? "for update of g" : ""}`,
    [grantId, orgId],
  );
  if (!rows[0]) throw new Error("No such pending offer for your organization.");
  return rows[0];
}

/**
 * (Re)materialize a copy's members from the source: wipe and re-copy, member attributes cut down to
 * the granted fields (null = all). Used by accept and by every later sync — one code path, no drift.
 *
 * The source list belongs to the SHARER and the copy to the RECEIVER, so the copy is a cross-party
 * operation by definition. It runs in `sync_list_grant_members()` (0104), which copies only an
 * ACCEPTED grant on an ACTIVE partnership, only into that grant's own materialized copy, only the
 * granted fields — and only for a party to the partnership.
 */
async function materializeMembers(db: Db, grantId: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`select sync_list_grant_members($1) as n`, [grantId]);
  return Number(rows[0]?.n ?? 0);
}

/** The shared list's name / category and member counts, visible to either party of the grant (0104). */
async function grantSourceState(db: Db, grantId: string): Promise<{ list_name: string; category: string } | null> {
  const { rows } = await db.query<{ list_name: string; category: string }>(
    `select list_name, category from list_grant_source_state($1)`, [grantId]);
  return rows[0] ?? null;
}

/**
 * Receiver accepts: NOW (and only now) a copy materializes in the receiving
 * org — an approved population bound to their lens on the sharer, members'
 * attributes filtered to the granted fields. The copy is theirs; revocation
 * flips it to rejected rather than deleting their history.
 */
export async function acceptListGrant(pool: Pool | PoolClient, orgId: string, grantId: string): Promise<void> {
  return runTx(pool, async (db) => {
    const g = await loadIncomingGrant(db, orgId, grantId, true);

    // My lens on the sharer: their side initiated → my lens is counterpart's, and vice versa.
    const myLens = g.initiator_org_id === orgId ? g.initiator_partner_id : g.counterpart_partner_id;

    const src = await grantSourceState(db, grantId);
    if (!src) throw new Error("The shared list no longer exists.");

    const { rows: copy } = await db.query<{ id: string }>(
      `insert into account_populations (org_id, partner_id, name, category, status, created_by)
       values ($1, $2, $3, $4, 'approved', 'partner share') returning id`,
      [orgId, myLens, `${src.list_name} (shared)`, src.category],
    );
    // Accept first, then copy: the copy function only ever fills an ACCEPTED grant's own copy.
    await db.query(
      `update list_grants set status = 'accepted', decided_at = now(), synced_at = now(),
              materialized_population_id = $2
       where id = $1`,
      [grantId, copy[0].id],
    );
    await materializeMembers(db, grantId);
    const detail = { list: src.list_name, grant_id: grantId };
    await audit(db, orgId, "grant.accepted", detail, g.partnership_id);
    await audit(db, g.from_org_id, "grant.accepted", detail, g.partnership_id);
  });
}

/**
 * Re-sync an accepted grant: the copy catches up to the source (adds, removes,
 * attribute changes — still scoped to the granted fields). Either side may
 * trigger it; the grant itself is the standing consent, so a sync changes
 * nothing about WHAT is shared, only brings it current.
 */
export async function syncListGrant(pool: Pool | PoolClient, orgId: string, grantId: string): Promise<void> {
  return runTx(pool, async (db) => {
    const { rows } = await db.query<{
      id: string; partnership_id: string; materialized_population_id: string | null;
      from_org_id: string; initiator_org_id: string; counterpart_org_id: string | null;
    }>(
      `select g.id, g.partnership_id, g.materialized_population_id, g.from_org_id,
              p.initiator_org_id, p.counterpart_org_id
       from list_grants g
       join partnerships p on p.id = g.partnership_id
       where g.id = $1 and g.status = 'accepted' and p.status = 'active'
         and (p.initiator_org_id = $2 or p.counterpart_org_id = $2)
       for update of g`,
      [grantId, orgId],
    );
    const g = rows[0];
    if (!g) throw new Error("No live accepted share with that id on an active partnership.");
    if (!g.materialized_population_id) throw new Error("Their copy no longer exists — offer the list again.");

    const src = await grantSourceState(db, grantId);
    const n = await materializeMembers(db, grantId);
    await db.query(`update list_grants set synced_at = now() where id = $1`, [grantId]);
    const detail = { list: src?.list_name ?? null, members: n, grant_id: grantId };
    await audit(db, g.from_org_id, "grant.synced", detail, g.partnership_id);
    const other = otherOrg(g, g.from_org_id);
    if (other) await audit(db, other, "grant.synced", detail, g.partnership_id);
  });
}

/** Receiver declines: the offer dies, nothing ever materialized. */
export async function declineListGrant(db: Db, orgId: string, grantId: string): Promise<void> {
  const g = await loadIncomingGrant(db, orgId, grantId, false);
  await db.query(`update list_grants set status = 'declined', decided_at = now() where id = $1`, [grantId]);
  await audit(db, orgId, "grant.declined", { grant_id: grantId }, g.partnership_id);
  await audit(db, g.from_org_id, "grant.declined", { grant_id: grantId }, g.partnership_id);
}

/**
 * Sharer revokes: the offer (or the live share) ends and any materialized copy
 * flips to rejected on the receiving side.
 */
export async function revokeListGrant(pool: Pool | PoolClient, orgId: string, grantId: string): Promise<void> {
  return runTx(pool, async (db) => {
    const { rows } = await db.query<{
      id: string; partnership_id: string; materialized_population_id: string | null;
      initiator_org_id: string; counterpart_org_id: string | null;
    }>(
      `select g.id, g.partnership_id, g.materialized_population_id,
              p.initiator_org_id, p.counterpart_org_id
       from list_grants g join partnerships p on p.id = g.partnership_id
       where g.id = $1 and g.from_org_id = $2 and g.status in ('offered','accepted')
       for update of g`,
      [grantId, orgId],
    );
    const g = rows[0];
    if (!g) throw new Error("No live grant of yours with that id.");
    // Revoke first; then flip the receiver's copy of THIS now-revoked grant (a cross-party write, 0104).
    await db.query(`update list_grants set status = 'revoked', decided_at = now() where id = $1`, [grantId]);
    if (g.materialized_population_id) await db.query(`select revoke_list_grant_copies($1, $2)`, [g.partnership_id, grantId]);
    await audit(db, orgId, "grant.revoked", { grant_id: grantId }, g.partnership_id);
    const other = otherOrg(g, orgId);
    if (other) await audit(db, other, "grant.revoked", { grant_id: grantId }, g.partnership_id);
  });
}

// ── reads (admin room) ──────────────────────────────────────────────────────

export type PartnershipView = {
  id: string;
  status: "invited" | "active" | "revoked";
  role: "initiator" | "counterpart";
  otherOrgName: string | null;   // null while invited (nobody has redeemed yet)
  myLensName: string | null;
  inviteCode: string | null;     // shown only to the initiator while pending
  createdAt: string;
  activatedAt: string | null;
  grantsOut: number;
  grantsIn: number;
};

export async function listPartnerships(db: Db, orgId: string): Promise<PartnershipView[]> {
  const { rows } = await db.query<{
    id: string; status: PartnershipView["status"]; initiator_org_id: string;
    other_name: string | null; my_lens: string | null; invite_code: string;
    created_at: Date; activated_at: Date | null; grants_out: string; grants_in: string;
  }>(
    `select p.id, p.status, p.initiator_org_id,
            case when p.initiator_org_id = $1 then oc.name else oi.name end as other_name,
            case when p.initiator_org_id = $1 then pi.name else pc.name end as my_lens,
            p.invite_code, p.created_at, p.activated_at,
            (select count(*) from list_grants g where g.partnership_id = p.id and g.from_org_id = $1) as grants_out,
            (select count(*) from list_grants g where g.partnership_id = p.id and g.from_org_id <> $1) as grants_in
     from partnerships p
     left join organizations oi on oi.id = p.initiator_org_id
     left join organizations oc on oc.id = p.counterpart_org_id
     left join partners pi on pi.id = p.initiator_partner_id
     left join partners pc on pc.id = p.counterpart_partner_id
     where p.initiator_org_id = $1 or p.counterpart_org_id = $1
     order by p.created_at desc`,
    [orgId],
  );
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    role: r.initiator_org_id === orgId ? "initiator" : "counterpart",
    otherOrgName: r.other_name,
    myLensName: r.my_lens,
    inviteCode: r.initiator_org_id === orgId && r.status === "invited" ? r.invite_code : null,
    createdAt: new Date(r.created_at).toISOString().slice(0, 10),
    activatedAt: r.activated_at ? new Date(r.activated_at).toISOString().slice(0, 10) : null,
    grantsOut: Number(r.grants_out),
    grantsIn: Number(r.grants_in),
  }));
}

export type GrantView = {
  id: string;
  direction: "outgoing" | "incoming";
  listName: string;
  otherOrgName: string | null;
  fields: string[] | null;
  status: "offered" | "accepted" | "declined" | "revoked";
  createdAt: string;
  /** Accepted only: the source list changed since the copy last synced. */
  stale: boolean;
};

export async function listGrantViews(db: Db, orgId: string): Promise<GrantView[]> {
  const { rows } = await db.query<{
    id: string; from_org_id: string; list_name: string; other_name: string | null;
    selected_fields: string[] | null; status: GrantView["status"]; created_at: Date; stale: boolean;
  }>(
    // The source list is the SHARER's and the copy the RECEIVER's: each side sees the other's half only
    // through `list_grant_source_state()` (0104) — the list's name / category and member counts for a
    // grant on a partnership the caller is party to. No member row crosses here.
    `select g.id, g.from_org_id, s.list_name,
            case when g.from_org_id = $1
                 then (select o.name from organizations o
                       where o.id = case when p.initiator_org_id = $1 then p.counterpart_org_id else p.initiator_org_id end)
                 else (select o.name from organizations o where o.id = g.from_org_id) end as other_name,
            g.selected_fields, g.status, g.created_at,
            (g.status = 'accepted' and g.materialized_population_id is not null and (
               s.source_last_added > coalesce(g.synced_at, g.decided_at)
               or s.source_members <> s.copy_members
            )) as stale
     from list_grants g
     join partnerships p on p.id = g.partnership_id
     cross join lateral list_grant_source_state(g.id) s
     where p.initiator_org_id = $1 or p.counterpart_org_id = $1
     order by g.created_at desc`,
    [orgId],
  );
  return rows.map((r) => ({
    id: r.id,
    direction: r.from_org_id === orgId ? "outgoing" : "incoming",
    listName: r.list_name,
    otherOrgName: r.other_name,
    fields: r.selected_fields,
    status: r.status,
    createdAt: new Date(r.created_at).toISOString().slice(0, 10),
    stale: r.stale,
  }));
}

export type AuditEntry = {
  actor: string;
  event: string;
  detail: Record<string, unknown>;
  createdAt: string;
};

export async function auditEntries(db: Db, orgId: string, limit = 30): Promise<AuditEntry[]> {
  const { rows } = await db.query<{ actor: string; event: string; detail: Record<string, unknown>; created_at: Date }>(
    `select actor, event, detail, created_at from audit_log
     where org_id = $1 order by created_at desc, id desc limit $2`,
    [orgId, limit],
  );
  return rows.map((r) => ({
    actor: r.actor,
    event: r.event,
    detail: r.detail,
    createdAt: new Date(r.created_at).toISOString().slice(0, 16).replace("T", " "),
  }));
}
