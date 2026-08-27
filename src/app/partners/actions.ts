"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPool } from "@/db/client";
import { currentOrgId, requireWrite } from "@/lib/auth/org";
import { decideEvidenceShare, offerEvidenceShare, revokeEvidenceShare } from "@/lib/partnerships/evidence-shares";
import { createInitiative, setInitiativeStatus } from "@/lib/partnerships/initiatives";
import { decideWarmIntro, requestWarmIntro } from "@/lib/partnerships/warm-intros";
import { savePartnerPlaybook } from "@/lib/playbooks/playbooks";
import { decideSkillShare, offerSkillShare, revokeSkillShare } from "@/lib/skills/skills";

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

/** Partner playbook (task #83): org-private notes that ground the AI when this partner is on the pursuit. */
export async function savePlaybookAction(partnerId: string, formData: FormData): Promise<void> {
  const { pool, orgId } = await writerOrg();
  await savePartnerPlaybook(pool, orgId, partnerId, {
    positioning: String(formData.get("positioning") ?? ""),
    strengths: String(formData.get("strengths") ?? ""),
    rules: String(formData.get("rules") ?? ""),
  });
  revalidatePath(`/partners/${partnerId}`);
  redirect(`/partners/${partnerId}?playbook=saved`);
}

/** Skill sharing (task #85): offer → accept, audited on both ledgers like every consent step. */
export async function offerSkillShareAction(partnerId: string, partnershipId: string, formData: FormData): Promise<void> {
  const { pool, orgId } = await writerOrg();
  const skillId = String(formData.get("skillId") ?? "");
  if (!skillId) throw new Error("Pick a skill to share.");
  await offerSkillShare(pool, orgId, skillId, partnershipId);
  revalidatePath(`/partners/${partnerId}`);
}

export async function decideSkillShareAction(partnerId: string, shareId: string, accept: boolean): Promise<void> {
  const { pool, orgId } = await writerOrg();
  await decideSkillShare(pool, orgId, shareId, accept);
  revalidatePath(`/partners/${partnerId}`);
  revalidatePath("/skills");
}

export async function revokeSkillShareAction(partnerId: string, shareId: string): Promise<void> {
  const { pool, orgId } = await writerOrg();
  await revokeSkillShare(pool, orgId, shareId);
  revalidatePath(`/partners/${partnerId}`);
  revalidatePath("/skills");
}

/** Create an initiative in this partner's room (task #83). */
export async function createInitiativeAction(partnerId: string, formData: FormData): Promise<void> {
  const { pool, orgId } = await writerOrg();
  const name = String(formData.get("name") ?? "");
  const targetRaw = String(formData.get("target") ?? "").replace(/[^0-9.]/g, "");
  const res = await createInitiative(pool, orgId, {
    partnerId,
    name,
    description: String(formData.get("description") ?? "").trim(),
    targetUsd: targetRaw ? Number(targetRaw) : null,
    periodLabel: String(formData.get("period") ?? "").trim(),
  });
  revalidatePath(`/partners/${partnerId}`);
  if ("error" in res) redirect(`/partners/${partnerId}?initiative=${encodeURIComponent(res.error)}`);
  redirect(`/partners/${partnerId}?initiative=created`);
}

/** Complete or archive an initiative — computed history stays intact. */
export async function setInitiativeStatusAction(
  partnerId: string,
  initiativeId: string,
  status: "active" | "completed" | "archived",
): Promise<void> {
  const { pool, orgId } = await writerOrg();
  await setInitiativeStatus(pool, orgId, initiativeId, status);
  revalidatePath(`/partners/${partnerId}`);
}

/** Evidence exchange (slice G): offer a verified claim across the fence. */
export async function offerEvidenceShareAction(partnerId: string, partnershipId: string, formData: FormData): Promise<void> {
  const { pool, orgId } = await writerOrg();
  const evidenceId = String(formData.get("evidenceId") ?? "");
  if (!evidenceId) throw new Error("Pick the claim to offer.");
  await offerEvidenceShare(pool, orgId, partnershipId, evidenceId);
  revalidatePath(`/partners/${partnerId}`);
}

export async function decideEvidenceShareAction(partnerId: string, shareId: string, accept: boolean): Promise<void> {
  const { pool, orgId } = await writerOrg();
  await decideEvidenceShare(pool, orgId, shareId, accept);
  revalidatePath(`/partners/${partnerId}`);
}

export async function revokeEvidenceShareAction(partnerId: string, shareId: string): Promise<void> {
  const { pool, orgId } = await writerOrg();
  await revokeEvidenceShare(pool, orgId, shareId);
  revalidatePath(`/partners/${partnerId}`);
}
