"use server";

import { revalidatePath } from "next/cache";
import { getPool } from "@/db/client";
import { createGoal, setGoalStatus, setGoalManualValue, type Metric } from "@/lib/goals/goals";

async function soleOrgId(): Promise<string | null> {
  const { rows } = await getPool().query<{ id: string }>(`select id from organizations order by created_at asc limit 1`);
  return rows[0]?.id ?? null;
}

export async function createGoalAction(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  const metric = String(formData.get("metric") ?? "pipeline_usd") as Metric;
  const target = Number(formData.get("target") ?? 0);
  const baseline = Number(formData.get("baseline") ?? 0) || 0;
  const dueDate = String(formData.get("dueDate") ?? "").trim() || null;
  const owner = String(formData.get("owner") ?? "").trim() || null;
  const unit = String(formData.get("unit") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim() || null;
  if (!name || !Number.isFinite(target) || target <= 0) throw new Error("a name and a positive target are required");

  const orgId = await soleOrgId();
  await createGoal(getPool(), { orgId, name, description, metric, target, baseline, unit, dueDate, owner });
  revalidatePath("/goals");
}

export async function setGoalStatusAction(goalId: string, status: string): Promise<void> {
  await setGoalStatus(getPool(), goalId, status);
  revalidatePath("/goals");
}

export async function setGoalManualValueAction(goalId: string, formData: FormData): Promise<void> {
  const value = Number(formData.get("value") ?? 0);
  if (Number.isFinite(value)) await setGoalManualValue(getPool(), goalId, value);
  revalidatePath("/goals");
}
