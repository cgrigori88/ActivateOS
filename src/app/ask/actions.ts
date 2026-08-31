"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWrite } from "@/lib/auth/org";
import { withTenant } from "@/lib/db/tenant";
import { askTheRecord } from "@/lib/agents/ask";
import { resolveScope } from "@/lib/scope/server";
import { parseScope, SCOPE_COOKIE } from "@/lib/scope/scope";
import { cookies } from "next/headers";

/**
 * One ask = one canonical answer. Errors become a notice, never a black page
 * (and never a redirect inside a catch — the errNotice pattern).
 */
export async function askAction(formData: FormData): Promise<void> {
  const question = String(formData.get("question") ?? "").trim();
  if (!question) redirect("/ask?notice=Type+a+question+first.");

  let errNotice: string | null = null;
  try {
    await withTenant(async (db, orgId) => {
      await requireWrite(db); // asking spends AI budget — viewers read past answers only
      // P2C-0 §2: the persistent ecosystem scope reaches the Ask surface. It is resolved to the
      // authorized company set and handed to the resolvers, so a narrowed operator can never
      // receive whole-book answers. Scope ALL resolves to null (no narrowing).
      let scopeRaw: string | null = null;
      try { scopeRaw = (await cookies()).get(SCOPE_COOKIE)?.value ?? null; } catch { /* no request cookies */ }
      const scope = parseScope(scopeRaw);
      const companyIds = scope.kind === "ALL" ? null : (await resolveScope(db, orgId, scope)).companyIds;
      await askTheRecord(db, orgId, question, { companyIds });
    });
  } catch (err) {
    // P2C-1 §12: the interpreter tier degrades on its own and never surfaces here — an AI
    // credential problem now costs the paraphrase coverage, not the answer, because the
    // deterministic registry still runs. What reaches this catch is a real failure.
    const msg = err instanceof Error ? err.message : "The ask surface hit an error.";
    errNotice = msg.slice(0, 200);
  }
  revalidatePath("/ask");
  if (errNotice) redirect(`/ask?notice=${encodeURIComponent(errNotice)}`);
  redirect("/ask");
}
