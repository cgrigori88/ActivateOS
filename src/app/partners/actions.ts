"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPool } from "@/db/client";
import { currentOrgId, requireWrite } from "@/lib/auth/org";
import { decideWarmIntro, requestWarmIntro } from "@/lib/partnerships/warm-intros";

/**
 * Warm-intro actions (B+3, task #82). Operator-level like joint pursuits —
 * the heavy consent (which accounts are even mentionable) already happened
 * on the owner-approved named-overlap rung.
 */

async function writerOrg(): Promise<{ pool: ReturnType<typeof getPool>; orgId: string }> {
  const pool = getPool();
  await requireWrite(pool);
  const orgId = await currentOrgId(pool);
  if (!orgId) throw new Error("No organization in scope.");
  return { pool, orgId };
}

export async function requestIntroAction(partnerId: string, partnershipId: string, formData: FormData): Promise<void> {
  const { pool, orgId } = await writerOrg();
  const companyId = String(formData.get("companyId") ?? "");
  const ask = String(formData.get("ask") ?? "");
  if (!companyId) throw new Error("Pick the account.");
  await requestWarmIntro(pool, orgId, partnershipId, companyId, ask);
  revalidatePath(`/partners/${partnerId}`);
  redirect(`/partners/${partnerId}?intro=sent`);
}

export async function decideIntroAction(partnerId: string, requestId: string, accept: boolean, formData: FormData): Promise<void> {
  const { pool, orgId } = await writerOrg();
  const contactId = String(formData.get("contactId") ?? "") || undefined;
  await decideWarmIntro(pool, orgId, requestId, accept, contactId);
  revalidatePath(`/partners/${partnerId}`);
  revalidatePath("/partners");
}
