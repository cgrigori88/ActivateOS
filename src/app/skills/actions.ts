"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPool } from "@/db/client";
import { currentOrgId, requireWrite } from "@/lib/auth/org";
import { currentActor } from "@/lib/partnerships/partnerships";
import { createSkill, setSkillStatus, updateSkillBody, type SkillKind, type SkillScope } from "@/lib/skills/skills";

/**
 * Skills library actions (task #84). Operator-level: skills ground what the
 * AI writes, and everything AI-written already passes human approval before
 * it faces a customer.
 */

async function writerOrg(): Promise<{ pool: ReturnType<typeof getPool>; orgId: string }> {
  const pool = getPool();
  await requireWrite(pool);
  const orgId = await currentOrgId(pool);
  if (!orgId) throw new Error("No organization in scope.");
  return { pool, orgId };
}

const KINDS: SkillKind[] = ["positioning", "process", "style", "rules"];
const SCOPES: SkillScope[] = ["org", "partner", "list"];

export async function createSkillAction(formData: FormData): Promise<void> {
  const { pool, orgId } = await writerOrg();
  const kind = String(formData.get("kind") ?? "");
  const scopeType = String(formData.get("scopeType") ?? "org");
  if (!KINDS.includes(kind as SkillKind)) throw new Error("Pick what kind of skill this is.");
  if (!SCOPES.includes(scopeType as SkillScope)) throw new Error("Pick where this skill applies.");
  const scopeId =
    scopeType === "partner"
      ? String(formData.get("partnerId") ?? "") || null
      : scopeType === "list"
        ? String(formData.get("listId") ?? "") || null
        : null;
  let notice: string;
  try {
    await createSkill(pool, orgId, {
      name: String(formData.get("name") ?? ""),
      kind: kind as SkillKind,
      scopeType: scopeType as SkillScope,
      scopeId,
      body: String(formData.get("body") ?? ""),
      createdBy: await currentActor(),
    });
    notice = "Skill added — agents on its surfaces read it from the next run.";
  } catch (err) {
    notice = err instanceof Error ? err.message : String(err);
  }
  revalidatePath("/skills");
  redirect(`/skills?notice=${encodeURIComponent(notice)}`);
}

export async function updateSkillBodyAction(skillId: string, formData: FormData): Promise<void> {
  const { pool, orgId } = await writerOrg();
  await updateSkillBody(pool, orgId, skillId, String(formData.get("body") ?? ""));
  revalidatePath("/skills");
}

export async function setSkillStatusAction(skillId: string, status: "active" | "archived"): Promise<void> {
  const { pool, orgId } = await writerOrg();
  await setSkillStatus(pool, orgId, skillId, status);
  revalidatePath("/skills");
}
