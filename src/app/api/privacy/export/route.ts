import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/org";
import { withTenant } from "@/lib/db/tenant";
import { exportDataSubject, normalizeEmail } from "@/lib/privacy/data-subject";

export const dynamic = "force-dynamic";

/**
 * GDPR access & portability (Art. 15/20, RISK-2): a data subject's personal
 * data in this workspace as a JSON download. Owner-only and tenant-scoped —
 * the export can only ever contain rows from the caller's own org (RISK-1:
 * pinned via withTenant).
 */
export async function GET(req: Request): Promise<Response> {
  const raw = new URL(req.url).searchParams.get("email") ?? "";
  let email: string;
  try {
    email = normalizeEmail(raw);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid email." }, { status: 400 });
  }

  let data;
  try {
    data = await withTenant(async (db, orgId) => {
      await requireOwner(db);
      return exportDataSubject(db, orgId, email);
    });
  } catch (err) {
    // No tenant in scope, or not an owner.
    return NextResponse.json({ error: err instanceof Error ? err.message : "Not available." }, { status: 403 });
  }
  const filename = `data-subject-${email.replace(/[^a-z0-9]+/gi, "_")}-${new Date().toISOString().slice(0, 10)}.json`;
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
