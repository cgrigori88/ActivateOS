"use server";

import { revalidatePath } from "next/cache";
import { getPool } from "@/db/client";
import { requireWrite } from "@/lib/auth/org";
import { resolveReview } from "@/lib/quality/review";

export async function resolveReviewAction(
  reviewId: string,
  verdict: "accurate" | "inaccurate" | "unsure",
): Promise<void> {
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
  const pool = getPool();
  const db = await pool.connect();
  try {
    await resolveReview(db, reviewId, verdict);
  } finally {
    db.release();
  }
  revalidatePath("/review");
}
