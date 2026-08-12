"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPool } from "@/db/client";
import { currentOrgId, requireOwner } from "@/lib/auth/org";
import { authConfigured, supabaseAdmin } from "@/lib/auth/supabase";

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
  revalidatePath("/admin");
}
