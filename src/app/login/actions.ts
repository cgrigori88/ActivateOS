"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getOwnerPool } from "@/db/client";
import { authConfigured, supabaseAdmin, supabaseServer } from "@/lib/auth/supabase";
import { clientIp, rateLimited } from "@/lib/security/rate-limit";

function fail(message: string): never {
  redirect(`/login?error=${encodeURIComponent(message)}`);
}

/** Throttle credential guessing (#66): per-IP, plus per-account when given. */
async function throttleAuthAttempt(kind: string, email?: string): Promise<void> {
  const ip = clientIp(await headers());
  if (rateLimited(`${kind}:ip:${ip}`, 10, 5 * 60_000)) fail("Too many attempts — wait a few minutes.");
  if (email && rateLimited(`${kind}:email:${email}`, 10, 15 * 60_000)) fail("Too many attempts for this account — wait a few minutes.");
}

/** Sign in with email + password; session lands in cookies. */
export async function signInAction(formData: FormData): Promise<void> {
  if (!authConfigured()) fail("Identity is not configured on this deployment.");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) fail("Email and password are required.");
  await throttleAuthAttempt("signin", email);

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) fail("Sign-in failed — check the address and password.");
  redirect("/");
}

/**
 * First-run only: create the owner account. Allowed solely while NO membership
 * exists (afterwards it hard-refuses), so the window closes the moment the
 * owner exists. On the demo deployment this page also sits behind Basic Auth,
 * so the window was never public.
 */
export async function createOwnerAction(formData: FormData): Promise<void> {
  if (!authConfigured()) fail("Identity is not configured on this deployment.");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || password.length < 12) fail("Owner account needs an email and a password of 12+ characters.");
  await throttleAuthAttempt("owner");

  // RISK-1: bootstrap path — this runs BEFORE any membership exists (it reads
  // org_members to check emptiness, then inserts the first owner). It cannot be
  // scoped with withTenant (there is no caller-org yet) and must run on the
  // owner connection. At the app_rw cutover, provisioning paths like this keep
  // a dedicated owner pool — see the RISK-1 runbook's "owner-pool set".
  const pool = getOwnerPool();
  const { rows: existing } = await pool.query<{ n: string }>(`select count(*)::text as n from org_members`);
  if (Number(existing[0].n) > 0) fail("An owner already exists — sign in instead, or ask them to invite you.");

  const { rows: orgs } = await pool.query<{ id: string }>(`select id from organizations order by created_at asc limit 1`);
  if (!orgs[0]) fail("No organization exists yet.");

  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) fail(`Couldn't create the account: ${error?.message ?? "unknown error"}`);

  await pool.query(
    `insert into org_members (org_id, user_id, role) values ($1, $2, 'owner') on conflict do nothing`,
    [orgs[0].id, data.user.id],
  );

  const supabase = await supabaseServer();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) fail("Account created — sign in with it now.");
  redirect("/");
}

/** Signed-in users change their own password (e.g. after a temp-password invite). */
export async function changePasswordAction(formData: FormData): Promise<void> {
  if (!authConfigured()) fail("Identity is not configured on this deployment.");
  const password = String(formData.get("password") ?? "");
  if (password.length < 12) fail("New password needs 12+ characters.");
  await throttleAuthAttempt("passwd");
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) fail("Sign in first.");
  const { error } = await supabase.auth.updateUser({ password });
  if (error) fail(`Couldn't change the password: ${error.message}`);
  redirect("/login?error=" + encodeURIComponent("Password updated."));
}

export async function signOutAction(): Promise<void> {
  if (authConfigured()) {
    const supabase = await supabaseServer();
    await supabase.auth.signOut();
  }
  redirect("/login");
}
