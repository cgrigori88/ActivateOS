import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@/lib/db/tenant";
import { PageHeader } from "@/components/ui";
import { loadStagedBatch } from "@/lib/ingest/staged";
import { guessCategory } from "@/lib/ingest/detect";
import { MappingReview } from "./mapping-review";
import { commitCrmAction, commitEnrichmentAction, commitImportAction, discardImportAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Mapping review for one analyzed upload. The batch (and its staged rows) is
 * tenant-scoped — a batch id from another org 404s rather than leaks.
 */
export default async function IntakeReviewPage({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(batchId)) notFound();

  const { batch, partners } = await withTenant(async (db, orgId) => ({
    batch: await loadStagedBatch(db, { orgId, batchId }),
    partners: (await db.query<{ id: string; name: string; type: string | null }>(
      `select id, name, partner_type as type from partners where org_id = $1 order by name`,
      [orgId],
    )).rows,
  }));
  if (!batch) notFound();

  const defaultName = (batch.filename ?? "Imported list").replace(/\.csv$/i, "").replace(/[_-]+/g, " ").trim() || "Imported list";
  const defaultCategory = guessCategory(batch.filename, batch.proposal);

  const commit = (
    batch.kind === "crm" ? commitCrmAction : batch.kind === "enrichment" ? commitEnrichmentAction : commitImportAction
  ).bind(null, batch.id);
  const discard = discardImportAction.bind(null, batch.id);

  return (
    <main>
      <PageHeader
        title={
          batch.kind === "crm"
            ? "Review CRM export mapping"
            : batch.kind === "enrichment"
              ? `Review enrichment mapping${batch.sourceLabel ? ` — ${batch.sourceLabel}` : ""}`
              : "Review import mapping"
        }
        subtitle={`${batch.filename ?? "upload"} — ${batch.rowCount.toLocaleString()} rows, ${batch.headers.length} columns${batch.hasHeaderRow ? "" : " (no header row detected — columns are positional)"}. Confirm where each column lands${batch.kind === "crm" ? "" : " and which fields are surfaced"}.`}
      />
      <p className="mb-4 -mt-2 text-xs text-neutral-500">
        <Link href="/intake" className="text-accent hover:underline dark:text-blue-400">← Intake</Link>
        {" · "}Detection is deterministic and runs entirely inside your tenant — nothing in this file is sent to any
        third party, and the staged rows are deleted the moment you import or discard.
      </p>
      <MappingReview
        batchId={batch.id}
        filename={batch.filename}
        rowCount={batch.rowCount}
        headers={batch.headers}
        profiles={batch.profiles}
        proposal={batch.proposal}
        preview={batch.preview}
        partners={partners}
        defaultName={defaultName}
        defaultCategory={defaultCategory}
        commit={commit}
        discard={discard}
        kind={batch.kind}
      />
    </main>
  );
}
