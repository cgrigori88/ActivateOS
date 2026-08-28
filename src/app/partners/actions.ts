"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWrite } from "@/lib/auth/org";
import { withTenant } from "@/lib/db/tenant";
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

export async function requestIntroAction(partnerId: string, partnershipId: string, formData: FormData): Promise<void> {
  const companyId = String(formData.get("companyId") ?? "");
  const ask = String(formData.get("ask") ?? "");
  if (!companyId) throw new Error("Pick the account.");
  await withTenant(async (db, orgId) => {
    await requireWrite(db);
    await requestWarmIntro(db, orgId, partnershipId, companyId, ask);
  });
  revalidatePath(`/partners/${partnerId}`);
  redirect(`/partners/${partnerId}?intro=sent`);
}

export async function decideIntroAction(partnerId: string, requestId: string, accept: boolean, formData: FormData): Promise<void> {
  const contactId = String(formData.get("contactId") ?? "") || undefined;
  await withTenant(async (db, orgId) => {
    await requireWrite(db);
    await decideWarmIntro(db, orgId, requestId, accept, contactId);
  });
  revalidatePath(`/partners/${partnerId}`);
  revalidatePath("/partners");
}

/** Partner playbook (task #83): org-private notes that ground the AI when this partner is on the pursuit. */
export async function savePlaybookAction(partnerId: string, formData: FormData): Promise<void> {
  const positioning = String(formData.get("positioning") ?? "");
  const strengths = String(formData.get("strengths") ?? "");
  const rules = String(formData.get("rules") ?? "");
  await withTenant(async (db, orgId) => {
    await requireWrite(db);
    await savePartnerPlaybook(db, orgId, partnerId, { positioning, strengths, rules });
  });
  revalidatePath(`/partners/${partnerId}`);
  redirect(`/partners/${partnerId}?playbook=saved`);
}

/** Skill sharing (task #85): offer → accept, audited on both ledgers like every consent step. */
export async function offerSkillShareAction(partnerId: string, partnershipId: string, formData: FormData): Promise<void> {
  const skillId = String(formData.get("skillId") ?? "");
  if (!skillId) throw new Error("Pick a skill to share.");
  await withTenant(async (db, orgId) => {
    await requireWrite(db);
    await offerSkillShare(db, orgId, skillId, partnershipId);
  });
  revalidatePath(`/partners/${partnerId}`);
}

export async function decideSkillShareAction(partnerId: string, shareId: string, accept: boolean): Promise<void> {
  await withTenant(async (db, orgId) => {
    await requireWrite(db);
    await decideSkillShare(db, orgId, shareId, accept);
  });
  revalidatePath(`/partners/${partnerId}`);
  revalidatePath("/skills");
}

export async function revokeSkillShareAction(partnerId: string, shareId: string): Promise<void> {
  await withTenant(async (db, orgId) => {
    await requireWrite(db);
    await revokeSkillShare(db, orgId, shareId);
  });
  revalidatePath(`/partners/${partnerId}`);
  revalidatePath("/skills");
}

/** Create an initiative in this partner's room (task #83). */
export async function createInitiativeAction(partnerId: string, formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "");
  const targetRaw = String(formData.get("target") ?? "").replace(/[^0-9.]/g, "");
  const description = String(formData.get("description") ?? "").trim();
  const periodLabel = String(formData.get("period") ?? "").trim();
  const res = await withTenant(async (db, orgId) => {
    await requireWrite(db);
    return await createInitiative(db, orgId, {
      partnerId,
      name,
      description,
      targetUsd: targetRaw ? Number(targetRaw) : null,
      periodLabel,
    });
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
  await withTenant(async (db, orgId) => {
    await requireWrite(db);
    await setInitiativeStatus(db, orgId, initiativeId, status);
  });
  revalidatePath(`/partners/${partnerId}`);
}

/** Evidence exchange (slice G): offer a verified claim across the fence. */
export async function offerEvidenceShareAction(partnerId: string, partnershipId: string, formData: FormData): Promise<void> {
  const evidenceId = String(formData.get("evidenceId") ?? "");
  if (!evidenceId) throw new Error("Pick the claim to offer.");
  await withTenant(async (db, orgId) => {
    await requireWrite(db);
    await offerEvidenceShare(db, orgId, partnershipId, evidenceId);
  });
  revalidatePath(`/partners/${partnerId}`);
}

export async function decideEvidenceShareAction(partnerId: string, shareId: string, accept: boolean): Promise<void> {
  await withTenant(async (db, orgId) => {
    await requireWrite(db);
    await decideEvidenceShare(db, orgId, shareId, accept);
  });
  revalidatePath(`/partners/${partnerId}`);
}

export async function revokeEvidenceShareAction(partnerId: string, shareId: string): Promise<void> {
  await withTenant(async (db, orgId) => {
    await requireWrite(db);
    await revokeEvidenceShare(db, orgId, shareId);
  });
  revalidatePath(`/partners/${partnerId}`);
}
