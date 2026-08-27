"use server";

import { revalidatePath } from "next/cache";
import { getPool } from "@/db/client";
import { createGoal, setGoalStatus, setGoalManualValue, type Metric } from "@/lib/goals/goals";
import { upsertTarget, deleteTarget, type TargetMetric } from "@/lib/goals/targets";
import { currentOrgId, requireWrite } from "@/lib/auth/org";

async function soleOrgId(): Promise<string | null> {
  return currentOrgId(getPool());
}

export async function createGoalAction(formData: FormData): Promise<void> {
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
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
  const pool = getPool();
  await requireWrite(pool);  // viewers are read-only (multi-tenant slice 3)
  const orgId = await currentOrgId(pool);
  if (!orgId) throw new Error("No organization in scope.");
  await setGoalStatus(pool, orgId, goalId, status);
  revalidatePath("/goals");
}

export async function setGoalManualValueAction(goalId: string, formData: FormData): Promise<void> {
  const pool = getPool();
  await requireWrite(pool);  // viewers are read-only (multi-tenant slice 3)
  const orgId = await currentOrgId(pool);
  if (!orgId) throw new Error("No organization in scope.");
  const value = Number(formData.get("value") ?? 0);
  if (Number.isFinite(value)) await setGoalManualValue(pool, orgId, goalId, value);
  revalidatePath("/goals");
}

/** Set (or update) a per-period pipeline/revenue target — overall or per partner. */
export async function upsertTargetAction(formData: FormData): Promise<void> {
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
  const periodYear = Number(formData.get("periodYear") ?? 0);
  const metric = String(formData.get("metric") ?? "pipeline") as TargetMetric;
  const partnerId = String(formData.get("partnerId") ?? "").trim() || null;
  const targetUsd = Number(formData.get("targetUsd") ?? 0);
  if (!Number.isInteger(periodYear) || periodYear < 2000 || !Number.isFinite(targetUsd) || targetUsd <= 0) {
    throw new Error("a valid year and a positive target are required");
  }
  const orgId = await soleOrgId();
  if (!orgId) throw new Error("no organization");
  await upsertTarget(getPool(), { orgId, partnerId, periodYear, metric, targetUsd });
  revalidatePath("/goals");
}

export async function deleteTargetAction(targetId: string): Promise<void> {
  const pool = getPool();
  await requireWrite(pool);  // viewers are read-only (multi-tenant slice 3)
  const orgId = await soleOrgId();
  if (!orgId) throw new Error("No organization in scope.");
  await deleteTarget(pool, orgId, targetId);
  revalidatePath("/goals");
}
