import { NextResponse } from "next/server";
import { requireWrite } from "@/lib/auth/org";
import { withTenant } from "@/lib/db/tenant";
import { exportApprovedWritebacks } from "@/lib/opportunities/writeback";

export const dynamic = "force-dynamic";

/**
 * Approved CRM corrections as a CSV download (slice A). Rows flip to
 * 'exported' on handover — the same queue a live CRM push adapter will
 * drain when credentials exist; the human gate stays either way.
 *
 * RISK-1: runs under withTenant so the export is pinned to the caller's org.
 */
export async function GET(): Promise<Response> {
  try {
    const csv = await withTenant(async (db, orgId) => {
      await requireWrite(db);
      return exportApprovedWritebacks(db, orgId);
    });
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="crm-corrections-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    // No tenant in scope, or read-only access.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Not available." },
      { status: 403 },
    );
  }
}
