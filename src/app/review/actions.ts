"use server";

import { revalidatePath } from "next/cache";
import { requireWrite } from "@/lib/auth/org";
import { withTenant } from "@/lib/db/tenant";
import { resolveReview } from "@/lib/quality/review";

export async function resolveReviewAction(
  reviewId: string,
  verdict: "accurate" | "inaccurate" | "unsure",
): Promise<void> {
  await withTenant(async (db, orgId) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    await resolveReview(db, orgId, reviewId, verdict);
  });
  revalidatePath("/review");
}
