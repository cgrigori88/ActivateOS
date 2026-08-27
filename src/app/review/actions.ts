"use server";

import { revalidatePath } from "next/cache";
import { getPool } from "@/db/client";
import { currentOrgId, requireWrite } from "@/lib/auth/org";
import { resolveReview } from "@/lib/quality/review";

export async function resolveReviewAction(
  reviewId: string,
  verdict: "accurate" | "inaccurate" | "unsure",
): Promise<void> {
  const pool = getPool();
  await requireWrite(pool);  // viewers are read-only (multi-tenant slice 3)
  const orgId = await currentOrgId(pool);
  if (!orgId) throw new Error("No organization in scope.");
  const db = await pool.connect();
  try {
    await resolveReview(db, orgId, reviewId, verdict);
  } finally {
    db.release();
  }
  revalidatePath("/review");
}
