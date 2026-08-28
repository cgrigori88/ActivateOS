"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWrite } from "@/lib/auth/org";
import { withTenant } from "@/lib/db/tenant";
import { askTheRecord } from "@/lib/agents/ask";

/**
 * One ask = one grounded answer. Errors become a notice, never a black page
 * (and never a redirect inside a catch — the errNotice pattern).
 */
export async function askAction(formData: FormData): Promise<void> {
  const question = String(formData.get("question") ?? "").trim();
  if (!question) redirect("/ask?notice=Type+a+question+first.");

  let errNotice: string | null = null;
  try {
    await withTenant(async (db, orgId) => {
      await requireWrite(db); // asking spends AI budget — viewers read past answers only
      await askTheRecord(db, orgId, question);
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "The ask surface hit an error.";
    errNotice = /credential|api key|auth/i.test(msg)
      ? "AI credentials aren't configured in this environment — the ask surface needs them."
      : msg.slice(0, 200);
  }
  revalidatePath("/ask");
  if (errNotice) redirect(`/ask?notice=${encodeURIComponent(errNotice)}`);
  redirect("/ask");
}
