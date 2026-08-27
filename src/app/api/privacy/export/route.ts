import { NextResponse } from "next/server";
import { getPool } from "@/db/client";
import { currentOrgId, requireOwner } from "@/lib/auth/org";
import { exportDataSubject, normalizeEmail } from "@/lib/privacy/data-subject";

export const dynamic = "force-dynamic";

/**
 * GDPR access & portability (Art. 15/20, RISK-2): a data subject's personal
 * data in this workspace as a JSON download. Owner-only and tenant-scoped —
 * the export can only ever contain rows from the caller's own org.
 */
export async function GET(req: Request): Promise<Response> {
  const pool = getPool();
  await requireOwner(pool);
  const orgId = await currentOrgId(pool);
  if (!orgId) return NextResponse.json({ error: "No organization in scope." }, { status: 403 });

  const raw = new URL(req.url).searchParams.get("email") ?? "";
  let email: string;
  try {
    email = normalizeEmail(raw);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid email." }, { status: 400 });
  }

  const data = await exportDataSubject(pool, orgId, email);
  const filename = `data-subject-${email.replace(/[^a-z0-9]+/gi, "_")}-${new Date().toISOString().slice(0, 10)}.json`;
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
