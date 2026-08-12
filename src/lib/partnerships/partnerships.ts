import { randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
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

/** Append to an org's ledger. Never throws — an audit failure must not roll back the action it records. */
export async function audit(
  db: Db,
  orgId: string,
  event: string,
  detail: Record<string, unknown> = {},
  partnershipId?: string | null,
): Promise<void> {
  try {
    const actor = await currentActor();
    await db.query(
      `insert into audit_log (org_id, actor, event, detail, partnership_id)
       values ($1, $2, $3, $4, $5)`,
      [orgId, actor, event, JSON.stringify(detail), partnershipId ?? null],
    );
  } catch (err) {
    console.error(`audit_log write failed (${event}):`, err);
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
export async function redeemPartnershipInvite(pool: Pool, orgId: string, code: string): Promise<void> {
  const db = await pool.connect();
  try {
    await db.query("begin");
    const { rows } = await db.query<{
      id: string; initiator_org_id: string; initiator_name: string;
    }>(
      `select p.id, p.initiator_org_id, o.name as initiator_name
       from partnerships p join organizations o on o.id = p.initiator_org_id
       where p.invite_code = $1 and p.status = 'invited'
       for update of p`,
      [code.trim().toUpperCase()],
    );
    const invite = rows[0];
    if (!invite) throw new Error("Invite code not found, already redeemed, or revoked.");
    if (invite.initiator_org_id === orgId) throw new Error("This invite was issued by your own organization.");

    const { rows: lens } = await db.query<{ id: string }>(
      `insert into partners (org_id, name, partner_type) values ($1, $2, 'alliance') returning id`,
      [orgId, invite.initiator_name],
    );
    await db.query(
      `update partnerships
       set counterpart_org_id = $2, counterpart_partner_id = $3,
           status = 'active', activated_at = now()
       where id = $1`,
      [invite.id, orgId, lens[0].id],
    );
    await audit(db, orgId, "partnership.accepted", { with: invite.initiator_name }, invite.id);
    const { rows: me } = await db.query<{ name: string }>(`select name from organizations where id = $1`, [orgId]);
    await audit(db, invite.initiator_org_id, "partnership.accepted", { by: me[0]?.name ?? orgId }, invite.id);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  } finally {
    db.release();
  }
}

/**
 * Either side may sever. All grants riding the partnership are revoked and
 * their materialized copies flipped to rejected — access ends NOW, on both
 * sides, and both ledgers say who pulled the plug.
 */
export async function revokePartnership(pool: Pool, orgId: string, partnershipId: string): Promise<void> {
  const db = await pool.connect();
  try {
    await db.query("begin");
    const { rows } = await db.query<{ id: string; initiator_org_id: string; counterpart_org_id: string | null }>(
      `select id, initiator_org_id, counterpart_org_id from partnerships
       where id = $1 and (initiator_org_id = $2 or counterpart_org_id = $2)
       and status <> 'revoked' for update`,
      [partnershipId, orgId],
    );
    const p = rows[0];
    if (!p) throw new Error("Partnership not found (or already revoked).");

    // Kill every live grant + its materialized copy.
    await db.query(
      `update account_populations set status = 'rejected'
       where id in (select materialized_population_id from list_grants
                    where partnership_id = $1 and materialized_population_id is not null)`,
      [partnershipId],
    );
    await db.query(
      `update list_grants set status = 'revoked', decided_at = now()
       where partnership_id = $1 and status in ('offered','accepted')`,
      [partnershipId],
    );
    await db.query(
      `update partnerships set status = 'revoked', revoked_at = now() where id = $1`,
      [partnershipId],
    );

    await audit(db, p.initiator_org_id, "partnership.revoked", { by_org: orgId }, partnershipId);
    if (p.counterpart_org_id) await audit(db, p.counterpart_org_id, "partnership.revoked", { by_org: orgId }, partnershipId);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  } finally {
    db.release();
  }
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
 * Receiver accepts: NOW (and only now) a copy materializes in the receiving
 * org — an approved population bound to their lens on the sharer, members'
 * attributes filtered to the granted fields. The copy is theirs; revocation
 * flips it to rejected rather than deleting their history.
 */
export async function acceptListGrant(pool: Pool, orgId: string, grantId: string): Promise<void> {
  const db = await pool.connect();
  try {
    await db.query("begin");
    const g = await loadIncomingGrant(db, orgId, grantId, true);

    // My lens on the sharer: their side initiated → my lens is counterpart's, and vice versa.
    const myLens = g.initiator_org_id === orgId ? g.initiator_partner_id : g.counterpart_partner_id;

    const { rows: src } = await db.query<{ name: string; category: string }>(
      `select name, category from account_populations where id = $1`,
      [g.population_id],
    );
    if (!src[0]) throw new Error("The shared list no longer exists.");

    const { rows: copy } = await db.query<{ id: string }>(
      `insert into account_populations (org_id, partner_id, name, category, status, created_by)
       values ($1, $2, $3, $4, 'approved', 'partner share') returning id`,
      [orgId, myLens, `${src[0].name} (shared)`, src[0].category],
    );
    // Copy members; attributes cut down to the granted fields (null = all).
    if (g.selected_fields === null) {
      await db.query(
        `insert into population_members (population_id, company_id, attributes)
         select $2, company_id, attributes from population_members where population_id = $1`,
        [g.population_id, copy[0].id],
      );
    } else {
      await db.query(
        `insert into population_members (population_id, company_id, attributes)
         select $2, m.company_id,
                coalesce((select jsonb_object_agg(e.key, e.value)
                          from jsonb_each(m.attributes) e where e.key = any($3)), '{}'::jsonb)
         from population_members m where m.population_id = $1`,
        [g.population_id, copy[0].id, g.selected_fields],
      );
    }
    await db.query(
      `update list_grants set status = 'accepted', decided_at = now(), materialized_population_id = $2
       where id = $1`,
      [grantId, copy[0].id],
    );
    const detail = { list: src[0].name, grant_id: grantId };
    await audit(db, orgId, "grant.accepted", detail, g.partnership_id);
    await audit(db, g.from_org_id, "grant.accepted", detail, g.partnership_id);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  } finally {
    db.release();
  }
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
export async function revokeListGrant(pool: Pool, orgId: string, grantId: string): Promise<void> {
  const db = await pool.connect();
  try {
    await db.query("begin");
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
    if (g.materialized_population_id) {
      await db.query(`update account_populations set status = 'rejected' where id = $1`, [g.materialized_population_id]);
    }
    await db.query(`update list_grants set status = 'revoked', decided_at = now() where id = $1`, [grantId]);
    await audit(db, orgId, "grant.revoked", { grant_id: grantId }, g.partnership_id);
    const other = otherOrg(g, orgId);
    if (other) await audit(db, other, "grant.revoked", { grant_id: grantId }, g.partnership_id);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  } finally {
    db.release();
  }
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
};

export async function listGrantViews(db: Db, orgId: string): Promise<GrantView[]> {
  const { rows } = await db.query<{
    id: string; from_org_id: string; list_name: string; other_name: string | null;
    selected_fields: string[] | null; status: GrantView["status"]; created_at: Date;
  }>(
    `select g.id, g.from_org_id, ap.name as list_name,
            case when g.from_org_id = $1
                 then (select o.name from organizations o
                       where o.id = case when p.initiator_org_id = $1 then p.counterpart_org_id else p.initiator_org_id end)
                 else (select o.name from organizations o where o.id = g.from_org_id) end as other_name,
            g.selected_fields, g.status, g.created_at
     from list_grants g
     join partnerships p on p.id = g.partnership_id
     join account_populations ap on ap.id = g.population_id
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
     where org_id = $1 order by created_at desc limit $2`,
    [orgId, limit],
  );
  return rows.map((r) => ({
    actor: r.actor,
    event: r.event,
    detail: r.detail,
    createdAt: new Date(r.created_at).toISOString().slice(0, 16).replace("T", " "),
  }));
}
