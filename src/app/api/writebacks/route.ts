import { NextResponse } from "next/server";
import { getPool } from "@/db/client";
import { currentOrgId, requireWrite } from "@/lib/auth/org";
import { exportApprovedWritebacks } from "@/lib/opportunities/writeback";

export const dynamic = "force-dynamic";

/**
 * Approved CRM corrections as a CSV download (slice A). Rows flip to
 * 'exported' on handover — the same queue a live CRM push adapter will
 * drain when credentials exist; the human gate stays either way.
 */
export async function GET(): Promise<Response> {
  const pool = getPool();
  await requireWrite(pool);
  const orgId = await currentOrgId(pool);
  if (!orgId) return NextResponse.json({ error: "No organization in scope." }, { status: 403 });
  const csv = await exportApprovedWritebacks(pool, orgId);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="crm-corrections-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
