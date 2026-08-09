"use server";

import { revalidatePath } from "next/cache";
import { getPool } from "@/db/client";
import { resolveReview } from "@/lib/quality/review";

export async function resolveReviewAction(
  reviewId: string,
  verdict: "accurate" | "inaccurate" | "unsure",
): Promise<void> {
  const pool = getPool();
  const db = await pool.connect();
  try {
    await resolveReview(db, reviewId, verdict);
  } finally {
    db.release();
  }
  revalidatePath("/review");
}
