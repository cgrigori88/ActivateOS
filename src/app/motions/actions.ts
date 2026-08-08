"use server";

import { revalidatePath } from "next/cache";
import { getPool } from "@/db/client";
import { approveMotion, rejectMotion } from "@/lib/motions/approve";

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
