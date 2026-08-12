"use server";

import { revalidatePath } from "next/cache";
import { getPool } from "@/db/client";
import { requireWrite } from "@/lib/auth/org";
import { approveMotion, rejectMotion } from "@/lib/motions/approve";
import { transitionMotion, type MotionOutcome } from "@/lib/motions/lifecycle";

/** Link (or unlink) a motion to a S.M.A.R.T. goal so its value rolls up. */
export async function setMotionGoalAction(motionId: string, formData: FormData): Promise<void> {
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
  const goalId = String(formData.get("goalId") ?? "").trim() || null;
  await getPool().query(`update revenue_motions set goal_id = $2 where id = $1`, [motionId, goalId]);
  revalidatePath("/motions");
  revalidatePath("/goals");
}

export async function approveMotionAction(motionId: string): Promise<void> {
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
  const pool = getPool();
  const db = await pool.connect();
  try {
    await approveMotion(db, motionId);
  } finally {
    db.release();
  }
  revalidatePath("/motions");
}

export async function rejectMotionAction(motionId: string): Promise<void> {
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
  const pool = getPool();
  const db = await pool.connect();
  try {
    await rejectMotion(db, motionId);
  } finally {
    db.release();
  }
  revalidatePath("/motions");
}

export async function activateMotionAction(motionId: string): Promise<void> {
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
  const pool = getPool();
  const db = await pool.connect();
  try {
    await transitionMotion(db, motionId, "active");
  } finally {
    db.release();
  }
  revalidatePath("/motions");
}

export async function completeMotionAction(
  motionId: string,
  outcome: MotionOutcome,
): Promise<void> {
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
  const pool = getPool();
  const db = await pool.connect();
  try {
    await transitionMotion(db, motionId, "completed", { outcome });
  } finally {
    db.release();
  }
  revalidatePath("/motions");
}

export async function abandonMotionAction(motionId: string): Promise<void> {
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
  const pool = getPool();
  const db = await pool.connect();
  try {
    await transitionMotion(db, motionId, "abandoned");
  } finally {
    db.release();
  }
  revalidatePath("/motions");
}
