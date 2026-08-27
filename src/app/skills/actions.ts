"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWrite } from "@/lib/auth/org";
import { withTenant } from "@/lib/db/tenant";
import { currentActor } from "@/lib/partnerships/partnerships";
import { createSkill, setSkillStatus, updateSkillBody, type SkillKind, type SkillScope } from "@/lib/skills/skills";

/**
 * Skills library actions (task #84). Operator-level: skills ground what the
 * AI writes, and everything AI-written already passes human approval before
 * it faces a customer.
 */

const KINDS: SkillKind[] = ["positioning", "process", "style", "rules"];
const SCOPES: SkillScope[] = ["org", "partner", "list"];

export async function createSkillAction(formData: FormData): Promise<void> {
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
  const name = String(formData.get("name") ?? "");
  const body = String(formData.get("body") ?? "");
  let notice: string;
  try {
    await withTenant(async (db, orgId) => {
      await requireWrite(db);
      await createSkill(db, orgId, {
        name,
        kind: kind as SkillKind,
        scopeType: scopeType as SkillScope,
        scopeId,
        body,
        createdBy: await currentActor(),
      });
    });
    notice = "Skill added — agents on its surfaces read it from the next run.";
  } catch (err) {
    notice = err instanceof Error ? err.message : String(err);
  }
  revalidatePath("/skills");
  redirect(`/skills?notice=${encodeURIComponent(notice)}`);
}

export async function updateSkillBodyAction(skillId: string, formData: FormData): Promise<void> {
  const body = String(formData.get("body") ?? "");
  await withTenant(async (db, orgId) => {
    await requireWrite(db);
    await updateSkillBody(db, orgId, skillId, body);
  });
  revalidatePath("/skills");
}

export async function setSkillStatusAction(skillId: string, status: "active" | "archived"): Promise<void> {
  await withTenant(async (db, orgId) => {
    await requireWrite(db);
    await setSkillStatus(db, orgId, skillId, status);
  });
  revalidatePath("/skills");
}
