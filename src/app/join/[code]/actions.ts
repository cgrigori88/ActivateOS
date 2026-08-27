"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getOwnerPool } from "@/db/client";
import { authConfigured, supabaseAdmin, supabaseServer } from "@/lib/auth/supabase";
import { inviteInfo, createGuestOrg } from "@/lib/partnerships/guest";
import { redeemPartnershipInvite } from "@/lib/partnerships/partnerships";
import { clientIp, rateLimited } from "@/lib/security/rate-limit";

/**
 * Guest-seat claim actions (B+2, task #81). /join/<code> is the only public
 * surface in the app, so everything here is defensive: the code is validated
 * before any side effect, attempts are throttled per IP, and failures say as
 * little as possible.
 *
 * Account creation deliberately rides supabaseAdmin (like the owner-invite
 * flow) instead of open self-signup: an account can only come into existence
 * through a LIVE invite code, so the sign-up surface is exactly as public as
 * the codes an owner chooses to share.
 *
 * RISK-1: these are PROVISIONING paths — they mint brand-new tenants, insert
 * the first membership, and redeem cross-tenant invites, all BEFORE (or across)
 * any caller-org boundary. They cannot use withTenant (there is no single org
 * to scope to) and must run on the owner connection. At the app_rw cutover,
 * provisioning stays on a dedicated owner pool — see the RISK-1 runbook's
 * "owner-pool set" (bootstrap/login, guest join, the research worker, webhooks).
 */

function fail(code: string, message: string): never {
  redirect(`/join/${encodeURIComponent(code)}?error=${encodeURIComponent(message)}`);
}

async function throttle(code: string): Promise<void> {
  const ip = clientIp(await headers());
  if (rateLimited(`join:ip:${ip}`, 10, 10 * 60_000)) {
    fail(code, "Too many attempts — wait a few minutes.");
  }
}

/** Anonymous visitor with a live code: create account + guest workspace + redeem, in that order. */
export async function claimGuestSeatAction(code: string, formData: FormData): Promise<void> {
  if (!authConfigured()) fail(code, "This deployment doesn't support self-serve seats.");
  await throttle(code);

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const workspace = String(formData.get("workspace") ?? "").trim();
  if (!email || !email.includes("@")) fail(code, "A work email is required.");
  if (password.length < 12) fail(code, "The password needs 12+ characters.");
  if (!workspace) fail(code, "Name your workspace — usually your company's name.");

  const pool = getOwnerPool();
  if (!(await inviteInfo(pool, code))) fail(code, "This invite link isn't valid anymore.");

  // 1. The account — first, so "email already exists" costs nothing.
  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) {
    fail(code, "Couldn't create that account — if you already have one, sign in first and reopen this link.");
  }

  // 2. The tenant + membership; 3. the redemption (single-use, row-locked).
  let orgId: string | null = null;
  try {
    orgId = await createGuestOrg(pool, workspace);
    await pool.query(`insert into org_members (org_id, user_id, role) values ($1, $2, 'owner')`, [orgId, data.user.id]);
    await redeemPartnershipInvite(pool, orgId, code);
  } catch {
    // The invite raced away (or the org insert failed): unwind the tenant so
    // nothing half-claimed lingers. The auth account stays — it's inert
    // without a membership, and they can sign in later.
    if (orgId) await pool.query(`delete from organizations where id = $1`, [orgId]).catch(() => {});
    fail(code, "This invite link isn't valid anymore.");
  }

  const supabase = await supabaseServer();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) redirect("/login");
  redirect("/partners?welcome=guest");
}

/** Signed-in user WITHOUT a workspace: same claim, existing account. */
export async function claimWorkspaceAction(code: string, formData: FormData): Promise<void> {
  if (!authConfigured()) fail(code, "This deployment doesn't support self-serve seats.");
  await throttle(code);
  const workspace = String(formData.get("workspace") ?? "").trim();
  if (!workspace) fail(code, "Name your workspace — usually your company's name.");

  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) fail(code, "Sign in first, then reopen this link.");

  const pool = getOwnerPool();
  const { rows: member } = await pool.query(`select 1 from org_members where user_id = $1`, [data.user.id]);
  if (member.length > 0) fail(code, "You already have a workspace — use the connect option instead.");
  if (!(await inviteInfo(pool, code))) fail(code, "This invite link isn't valid anymore.");

  let orgId: string | null = null;
  try {
    orgId = await createGuestOrg(pool, workspace);
    await pool.query(`insert into org_members (org_id, user_id, role) values ($1, $2, 'owner')`, [orgId, data.user.id]);
    await redeemPartnershipInvite(pool, orgId, code);
  } catch {
    if (orgId) await pool.query(`delete from organizations where id = $1`, [orgId]).catch(() => {});
    fail(code, "This invite link isn't valid anymore.");
  }
  redirect("/partners?welcome=guest");
}

/**
 * A workspace already exists for this caller: connect the invite to it —
 * exactly the Admin redeem, reachable from the link. Demo/Basic-Auth
 * deployments (no identity) resolve to the sole org, same as every screen.
 */
export async function connectExistingAction(code: string): Promise<void> {
  await throttle(code);
  const pool = getOwnerPool();

  let orgId: string | null = null;
  if (authConfigured()) {
    const supabase = await supabaseServer();
    const { data } = await supabase.auth.getUser();
    if (!data.user) fail(code, "Sign in first, then reopen this link.");
    const { rows } = await pool.query<{ org_id: string }>(
      `select org_id from org_members where user_id = $1 order by created_at asc limit 1`,
      [data.user.id],
    );
    orgId = rows[0]?.org_id ?? null;
    if (!orgId) fail(code, "No workspace yet — claim one with the form instead.");
  } else {
    const { rows } = await pool.query<{ id: string }>(`select id from organizations order by created_at asc limit 1`);
    orgId = rows[0]?.id ?? null;
    if (!orgId) fail(code, "No workspace exists on this deployment.");
  }

  try {
    await redeemPartnershipInvite(pool, orgId, code);
  } catch {
    fail(code, "This invite link isn't valid anymore.");
  }
  redirect("/partners?welcome=connected");
}
