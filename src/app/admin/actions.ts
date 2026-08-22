"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPool } from "@/db/client";
import { currentOrgId, requireOwner } from "@/lib/auth/org";
import { authConfigured, supabaseAdmin } from "@/lib/auth/supabase";
import {
  acceptListGrant,
  audit,
  createPartnershipInvite,
  declineListGrant,
  offerListGrant,
  redeemPartnershipInvite,
  revokeListGrant,
  revokePartnership,
  syncListGrant,
} from "@/lib/partnerships/partnerships";
import { decideOverlapProbe, requestOverlapProbe, type OverlapLevel } from "@/lib/partnerships/overlap";
import { addSuppression, removeSuppression, saveIcp } from "@/lib/icp/icp";

function notice(msg: string): never {
  redirect(`/admin?notice=${encodeURIComponent(msg)}`);
}

/**
 * Invite a member: the OWNER chooses a temporary password and hands it over
 * out-of-band — no secret ever appears in a URL or an email we don't control.
 * The invitee signs in with it and changes it from the sign-in page.
 */
export async function inviteMemberAction(formData: FormData): Promise<void> {
  const pool = getPool();
  await requireOwner(pool);
  if (!authConfigured()) notice("Identity isn't configured on this deployment.");

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "operator");
  if (!email || password.length < 12) notice("An email and a temporary password of 12+ characters are required.");
  if (!["owner", "operator", "viewer"].includes(role)) notice("Invalid role.");

  const orgId = await currentOrgId(pool);
  if (!orgId) notice("No organization.");

  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  let userId = data.user?.id ?? null;
  if (error) {
    // Already registered → just add the membership.
    const { rows } = await pool.query<{ id: string }>(`select id from auth.users where email = $1`, [email]);
    userId = rows[0]?.id ?? null;
    if (!userId) notice(`Couldn't create the account: ${error.message}`);
  }
  await pool.query(
    `insert into org_members (org_id, user_id, role) values ($1, $2, $3)
     on conflict (org_id, user_id) do update set role = excluded.role`,
    [orgId, userId, role],
  );
  await audit(pool, orgId, "member.invited", { email, role });
  revalidatePath("/admin");
  notice(`${email} added as ${role}. Share the temporary password out-of-band; they can change it after signing in.`);
}

export async function setMemberRoleAction(userId: string, formData: FormData): Promise<void> {
  const pool = getPool();
  await requireOwner(pool);
  const role = String(formData.get("role") ?? "");
  if (!["owner", "operator", "viewer"].includes(role)) notice("Invalid role.");
  const orgId = await currentOrgId(pool);

  if (role !== "owner") {
    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text as n from org_members where org_id = $1 and role = 'owner' and user_id <> $2`,
      [orgId, userId],
    );
    const { rows: target } = await pool.query<{ role: string }>(
      `select role from org_members where org_id = $1 and user_id = $2`,
      [orgId, userId],
    );
    if (target[0]?.role === "owner" && Number(rows[0].n) === 0) notice("Can't demote the last owner.");
  }
  await pool.query(`update org_members set role = $3 where org_id = $1 and user_id = $2`, [orgId, userId, role]);
  if (orgId) await audit(pool, orgId, "member.role_changed", { user_id: userId, role });
  revalidatePath("/admin");
}

export async function removeMemberAction(userId: string): Promise<void> {
  const pool = getPool();
  await requireOwner(pool);
  const orgId = await currentOrgId(pool);
  const { rows: target } = await pool.query<{ role: string }>(
    `select role from org_members where org_id = $1 and user_id = $2`,
    [orgId, userId],
  );
  if (target[0]?.role === "owner") {
    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text as n from org_members where org_id = $1 and role = 'owner' and user_id <> $2`,
      [orgId, userId],
    );
    if (Number(rows[0].n) === 0) notice("Can't remove the last owner.");
  }
  // Membership is the grant — removing it cuts all access; the auth account
  // remains (harmless without a membership) in case they're re-invited.
  await pool.query(`delete from org_members where org_id = $1 and user_id = $2`, [orgId, userId]);
  if (orgId) await audit(pool, orgId, "member.removed", { user_id: userId });
  revalidatePath("/admin");
}

// ── Partnerships (multi-tenant slice 5) — owner-only, like everything here ──

async function ownerOrg(): Promise<{ pool: ReturnType<typeof getPool>; orgId: string }> {
  const pool = getPool();
  await requireOwner(pool);
  const orgId = await currentOrgId(pool);
  if (!orgId) notice("No organization.");
  return { pool, orgId };
}

/** Run the work; return the failure message (never throw) so callers can
    redirect OUTSIDE try/catch — notice() throws Next's redirect internally. */
async function attempt(work: () => Promise<void>, fallback: string): Promise<string | null> {
  try {
    await work();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : fallback;
  }
}

export async function createInviteAction(formData: FormData): Promise<void> {
  const { pool, orgId } = await ownerOrg();
  const partnerId = String(formData.get("partnerId") ?? "");
  if (!partnerId) notice("Pick which partner this invite is for.");
  let code = "";
  const failed = await attempt(async () => {
    code = (await createPartnershipInvite(pool, orgId, partnerId)).inviteCode;
  }, "Couldn't create the invite.");
  if (failed) notice(failed);
  revalidatePath("/admin");
  notice(`Invite created. Share this code with the partner's owner (they redeem it on their Admin page): ${code}`);
}

export async function redeemInviteAction(formData: FormData): Promise<void> {
  const { pool, orgId } = await ownerOrg();
  const code = String(formData.get("code") ?? "").trim();
  if (!code) notice("Paste the invite code.");
  const failed = await attempt(() => redeemPartnershipInvite(pool, orgId, code), "Couldn't redeem the invite.");
  if (failed) notice(failed);
  revalidatePath("/admin");
  notice("Partnership active. Their organization now appears in your partners.");
}

export async function revokePartnershipAction(partnershipId: string): Promise<void> {
  const { pool, orgId } = await ownerOrg();
  const failed = await attempt(() => revokePartnership(pool, orgId, partnershipId), "Couldn't revoke the partnership.");
  if (failed) notice(failed);
  revalidatePath("/admin");
  notice("Partnership revoked — all shared lists withdrawn on both sides.");
}

export async function offerGrantAction(formData: FormData): Promise<void> {
  const { pool, orgId } = await ownerOrg();
  const partnershipId = String(formData.get("partnershipId") ?? "");
  const populationId = String(formData.get("populationId") ?? "");
  const fieldsRaw = String(formData.get("fields") ?? "").trim();
  const fields = fieldsRaw ? fieldsRaw.split(",").map((f) => f.trim()).filter(Boolean) : null;
  if (!partnershipId || !populationId) notice("Pick a partnership and a list to share.");
  const failed = await attempt(
    () => offerListGrant(pool, orgId, partnershipId, populationId, fields),
    "Couldn't offer the list.",
  );
  if (failed) notice(failed);
  revalidatePath("/admin");
  notice("List offered — nothing is visible to them until their owner accepts.");
}

export async function acceptGrantAction(grantId: string): Promise<void> {
  const { pool, orgId } = await ownerOrg();
  const failed = await attempt(() => acceptListGrant(pool, orgId, grantId), "Couldn't accept the share.");
  if (failed) notice(failed);
  revalidatePath("/admin");
  notice("Share accepted — the list is now in your account lists on Mapping.");
}

export async function declineGrantAction(grantId: string): Promise<void> {
  const { pool, orgId } = await ownerOrg();
  const failed = await attempt(() => declineListGrant(pool, orgId, grantId), "Couldn't decline the share.");
  if (failed) notice(failed);
  revalidatePath("/admin");
}

export async function syncGrantAction(grantId: string): Promise<void> {
  const { pool, orgId } = await ownerOrg();
  const failed = await attempt(() => syncListGrant(pool, orgId, grantId), "Couldn't sync the share.");
  if (failed) notice(failed);
  revalidatePath("/admin");
  notice("Share synced — the copy now matches the source list.");
}

export async function revokeGrantAction(grantId: string): Promise<void> {
  const { pool, orgId } = await ownerOrg();
  const failed = await attempt(() => revokeListGrant(pool, orgId, grantId), "Couldn't revoke the share.");
  if (failed) notice(failed);
  revalidatePath("/admin");
  notice("Share revoked — their copy is withdrawn.");
}

// ── Agent API keys (task #76) ───────────────────────────────────────────────

export async function mintApiKeyAction(
  _prev: { key?: string; name?: string; error?: string } | null,
  formData: FormData,
): Promise<{ key?: string; name?: string; error?: string } | null> {
  try {
    const { pool, orgId } = await ownerOrg();
    const name = String(formData.get("name") ?? "").trim().slice(0, 80);
    if (!name) return { error: "Name the key so you can recognize it later." };
    const { mintKey } = await import("@/lib/agents/mcp-tools");
    const { plaintext, hash } = mintKey();
    await pool.query(`insert into api_keys (org_id, name, key_hash) values ($1, $2, $3)`, [orgId, name, hash]);
    await audit(pool, orgId, "agent_key.minted", { name });
    revalidatePath("/admin");
    return { key: plaintext, name };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't mint the key." };
  }
}

export async function revokeApiKeyAction(keyId: string): Promise<void> {
  const { pool, orgId } = await ownerOrg();
  const { rowCount } = await pool.query(
    `update api_keys set revoked_at = now() where id = $1 and org_id = $2 and revoked_at is null`,
    [keyId, orgId],
  );
  if (rowCount) await audit(pool, orgId, "agent_key.revoked", { keyId });
  revalidatePath("/admin");
}

// ── Blind overlap (task #72) ────────────────────────────────────────────────

export async function requestOverlapAction(partnershipId: string, level: string): Promise<void> {
  const { pool, orgId } = await ownerOrg();
  const failed = await attempt(
    () => requestOverlapProbe(pool, orgId, partnershipId, level as OverlapLevel),
    "Couldn't request the overlap probe.",
  );
  if (failed) notice(failed);
  revalidatePath("/admin");
  notice("Probe requested — their owner sees it now; nothing is computed until they approve.");
}

export async function decideOverlapAction(probeId: string, approve: boolean): Promise<void> {
  const { pool, orgId } = await ownerOrg();
  const failed = await attempt(
    () => decideOverlapProbe(pool, orgId, probeId, approve),
    "Couldn't record the decision.",
  );
  if (failed) notice(failed);
  revalidatePath("/admin");
  if (!approve) notice("Probe declined.");
  // Next-step pull (#79): an approved NAMED overlap unlocks joint pursuit rooms —
  // counts/bands don't, so only that rung gets the pull.
  const { rows } = await pool.query<{ level: string }>(`select level from overlap_probes where id = $1`, [probeId]);
  redirect(
    `/admin?notice=${encodeURIComponent("Probe approved — the result is now visible to both sides, identically.")}${
      rows[0]?.level === "named" ? "&next=joint" : ""
    }`,
  );
}

// ── Targeting: ICP + suppression (task #83) ──────────────────────────────────

export async function saveIcpAction(formData: FormData): Promise<void> {
  const { pool, orgId } = await ownerOrg();
  const list = (k: string) =>
    String(formData.get(k) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 40);
  const int = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    return /^\d+$/.test(v) ? Number(v) : null;
  };
  const failed = await attempt(
    () =>
      saveIcp(pool, orgId, {
        industries: list("industries"),
        employeeMin: int("employeeMin"),
        employeeMax: int("employeeMax"),
        geos: list("geos"),
        notes: String(formData.get("icpNotes") ?? "").trim() || null,
      }),
    "Couldn't save the targeting profile.",
  );
  if (failed) notice(failed);
  revalidatePath("/admin");
  notice("Targeting profile saved — fit chips now render wherever named overlap shows.");
}

export async function addSuppressionAction(formData: FormData): Promise<void> {
  const { pool, orgId } = await ownerOrg();
  const kind = String(formData.get("kind") ?? "name") === "domain" ? ("domain" as const) : ("name" as const);
  const failed = await attempt(
    () =>
      addSuppression(pool, orgId, {
        kind,
        value: String(formData.get("value") ?? ""),
        reason: String(formData.get("reason") ?? "").trim(),
      }),
    "Couldn't add the suppression.",
  );
  if (failed) notice(failed);
  revalidatePath("/admin");
  revalidatePath("/motions");
  notice("Suppressed — the machine will not pursue matching accounts.");
}

export async function removeSuppressionAction(id: string): Promise<void> {
  const { pool, orgId } = await ownerOrg();
  await removeSuppression(pool, orgId, id);
  revalidatePath("/admin");
  revalidatePath("/motions");
  notice("Suppression removed.");
}
