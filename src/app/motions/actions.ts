"use server";

import { revalidatePath } from "next/cache";
import { getPool } from "@/db/client";
import { approveMotion, rejectMotion } from "@/lib/motions/approve";
import { transitionMotion, type MotionOutcome } from "@/lib/motions/lifecycle";

export async function approveMotionAction(motionId: string): Promise<void> {
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
  const pool = getPool();
  const db = await pool.connect();
  try {
    await transitionMotion(db, motionId, "abandoned");
  } finally {
    db.release();
  }
  revalidatePath("/motions");
}
