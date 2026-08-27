"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPool } from "@/db/client";
import { currentOrgId, requireWrite } from "@/lib/auth/org";
import { askTheRecord } from "@/lib/agents/ask";

/**
 * One ask = one grounded answer. Errors become a notice, never a black page
 * (and never a redirect inside a catch — the errNotice pattern).
 */
export async function askAction(formData: FormData): Promise<void> {
  const pool = getPool();
  await requireWrite(pool); // asking spends AI budget — viewers read past answers only
  const orgId = await currentOrgId(pool);
  if (!orgId) throw new Error("No organization in scope.");
  const question = String(formData.get("question") ?? "").trim();
  if (!question) redirect("/ask?notice=Type+a+question+first.");

  let errNotice: string | null = null;
  try {
    await askTheRecord(pool, orgId, question);
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
