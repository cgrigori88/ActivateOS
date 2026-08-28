"use server";

import { revalidatePath } from "next/cache";
import { createGoal, setGoalStatus, setGoalManualValue, type Metric } from "@/lib/goals/goals";
import { upsertTarget, deleteTarget, type TargetMetric } from "@/lib/goals/targets";
import { requireWrite } from "@/lib/auth/org";
import { withTenant } from "@/lib/db/tenant";

// RISK-1 adoption (task #67): every DB touch runs inside withTenant, which
// resolves the caller's org and pins the session to it (app.org_id) for the
// transaction. Inert while the app connects as the owner; becomes real
// tenant isolation the moment DATABASE_URL points at app_rw. requireWrite runs
// INSIDE the tenant tx so its org_members lookup is visible under the GUC.
// revalidatePath stays OUTSIDE (it must run after the commit).

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

  await withTenant(async (db, orgId) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    await createGoal(db, { orgId, name, description, metric, target, baseline, unit, dueDate, owner });
  });
  revalidatePath("/goals");
}

export async function setGoalStatusAction(goalId: string, status: string): Promise<void> {
  await withTenant(async (db, orgId) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    await setGoalStatus(db, orgId, goalId, status);
  });
  revalidatePath("/goals");
}

export async function setGoalManualValueAction(goalId: string, formData: FormData): Promise<void> {
  const value = Number(formData.get("value") ?? 0);
  if (!Number.isFinite(value)) return;
  await withTenant(async (db, orgId) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    await setGoalManualValue(db, orgId, goalId, value);
  });
  revalidatePath("/goals");
}

/** Set (or update) a per-period pipeline/revenue target — overall or per partner. */
export async function upsertTargetAction(formData: FormData): Promise<void> {
  const periodYear = Number(formData.get("periodYear") ?? 0);
  const metric = String(formData.get("metric") ?? "pipeline") as TargetMetric;
  const partnerId = String(formData.get("partnerId") ?? "").trim() || null;
  const targetUsd = Number(formData.get("targetUsd") ?? 0);
  if (!Number.isInteger(periodYear) || periodYear < 2000 || !Number.isFinite(targetUsd) || targetUsd <= 0) {
    throw new Error("a valid year and a positive target are required");
  }
  await withTenant(async (db, orgId) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    await upsertTarget(db, { orgId, partnerId, periodYear, metric, targetUsd });
  });
  revalidatePath("/goals");
}

export async function deleteTargetAction(targetId: string): Promise<void> {
  await withTenant(async (db, orgId) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    await deleteTarget(db, orgId, targetId);
  });
  revalidatePath("/goals");
}
