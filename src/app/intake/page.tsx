import Link from "next/link";
import { withTenant } from "@/lib/db/tenant";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { analyzeUploadAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Intake (Phase 8): per-partner CSV ingest analytics + the runs log + upload.
 * Each card is one partner's account book — rows, match rate, freshness.
 */

interface PartnerRow {
  id: string;
  name: string;
  partner_type: string | null;
  accounts: string;
  batches: string;
  rows_total: string;
  matched_total: string;
  last_import: Date | null;
}

function freshness(last: Date | null): { label: string; tone: string } {
  if (!last) return { label: "NONE", tone: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800" };
  const days = (Date.now() - new Date(last).getTime()) / 86_400_000;
  if (days <= 14) return { label: "FRESH", tone: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" };
  if (days <= 45) return { label: "STALE", tone: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" };
  return { label: "AGING", tone: "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400" };
}

export default async function IntakePage({
  searchParams,
}: {
  searchParams?: Promise<{ notice?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const { partners, runs } = await withTenant(async (db, orgId) => ({
    partners: (await db.query<PartnerRow>(
      `select p.id, p.name, p.partner_type,
       coalesce((select count(distinct pa.company_id) from partner_accounts pa where pa.partner_id = p.id), 0) as accounts,
       coalesce((select count(*) from import_batches b where b.partner_id = p.id), 0) as batches,
       coalesce((select sum(b.row_count) from import_batches b where b.partner_id = p.id), 0) as rows_total,
       coalesce((select sum(b.matched_count) from import_batches b where b.partner_id = p.id), 0) as matched_total,
       (select max(b.created_at) from import_batches b where b.partner_id = p.id) as last_import
     from partners p
     where p.org_id = $1
       and (exists (select 1 from import_batches b where b.partner_id = p.id)
        or exists (select 1 from partner_accounts pa where pa.partner_id = p.id))
     order by last_import desc nulls last`,
      [orgId],
    )).rows,
    runs: (await db.query<{
      id: string;
      filename: string | null;
      kind: string;
      status: string;
      row_count: number;
      matched_count: number;
      created_at: Date;
      partner: string | null;
    }>(
      `select b.id, b.filename, b.kind, b.status, b.row_count, b.matched_count, b.created_at, p.name as partner
     from import_batches b left join partners p on p.id = b.partner_id
     where b.org_id = $1
     order by b.created_at desc limit 25`,
      [orgId],
    )).rows,
  }));

  return (
    <main>
      <PageHeader
        title="Intake"
        subtitle="Partner books and CRM exports, matched into the graph."
      />

      {sp.notice && (
        <div className="mb-4 rounded-lg border border-green-300 bg-green-50 px-4 py-2.5 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
          {sp.notice}
        </div>
      )}

      {/* Upload → analyze → mapping review */}
      <Card className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Upload a file</h2>
        <form action={analyzeUploadAction} className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-neutral-500">CSV file — any columns, any naming</span>
            <input type="file" name="file" accept=".csv,text/csv,text/plain" required className="text-sm" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-neutral-500">What is this file?</span>
            <select name="kind" className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900">
              <option value="book">Partner book / account list</option>
              <option value="crm">CRM export (opportunities)</option>
              <option value="enrichment">Enrichment export (HG, D&amp;B, Gainsight…)</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-neutral-500">Source name (enrichment only)</span>
            <input
              name="sourceLabel"
              maxLength={80}
              placeholder="HG Insights"
              className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
          <button type="submit" className="rounded-md bg-blue-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-800">
            Analyze columns
          </button>
        </form>
        <p className="mt-2 text-xs text-neutral-500">
          No fixed template needed. The file is profiled inside your tenant (no third party sees it), the columns are
          auto-matched to platform fields, and you confirm the mapping before anything is imported. A partner book
          lands as a reviewable list; a CRM export lands as stage/amount snapshots compared against your live
          records — never overwriting them; an enrichment export (technographics, intent, IT spend, health scores)
          lands as third-party evidence with the vendor named as provenance, feeding the next scoring sweep.
        </p>
      </Card>

      {/* Per-partner cards */}
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Last ingested per partner</h2>
      {partners.length === 0 ? (
        <p className="mb-6 text-sm text-neutral-500">No partner uploads yet — upload a CSV above to get started.</p>
      ) : (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {partners.map((p) => {
            const rowsTotal = Number(p.rows_total);
            const matched = Number(p.matched_total);
            const rate = rowsTotal > 0 ? Math.round((matched / rowsTotal) * 100) : 0;
            const f = freshness(p.last_import);
            return (
              <Card key={p.id}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-semibold">{p.name}</span>
                  <span className="rounded px-1.5 py-0.5 text-micro font-medium uppercase tracking-wide text-neutral-500 ring-1 ring-inset ring-neutral-300/50 dark:ring-neutral-700">
                    {(p.partner_type ?? "partner").replace(/_/g, " ")}
                  </span>
                  <span className={`rounded px-1.5 py-0.5 text-micro font-semibold ${f.tone}`}>{f.label}</span>
                  <span className="ml-auto text-xs text-neutral-400">{p.batches} batch{Number(p.batches) === 1 ? "" : "es"}</span>
                </div>
                <div className="flex items-baseline gap-6">
                  <div>
                    <div className="pos-metric-fig">{rowsTotal.toLocaleString()}</div>
                    <div className="text-xs text-neutral-500">rows · {Number(p.accounts).toLocaleString()} accounts</div>
                  </div>
                  <div>
                    <div className="pos-metric-fig">{rate}%</div>
                    <div className="text-xs text-neutral-500">match rate</div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-neutral-500">
                  <span>{p.last_import ? `Imported ${new Date(p.last_import).toISOString().slice(0, 10)}` : "—"}</span>
                  <Link href={`/mapping?partner=${p.id}`} className="text-accent hover:underline dark:text-blue-400">
                    View mapping
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Runs log */}
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Intake runs</h2>
      {runs.length === 0 ? (
        <p className="text-sm text-neutral-500">No runs yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 scroll-thin dark:border-neutral-800">
          <table className="data-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Partner</th>
                <th>Kind</th>
                <th>Status</th>
                <th className="text-right">Rows</th>
                <th className="text-right">Matched</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">
                    {r.status === "analyzed" ? (
                      <Link href={`/intake/${r.id}`} className="text-accent hover:underline dark:text-blue-400">
                        {r.filename ?? "upload"}
                      </Link>
                    ) : (
                      (r.filename ?? "—")
                    )}
                  </td>
                  <td className="text-neutral-500">{r.partner ?? "—"}</td>
                  <td className="text-neutral-500 uppercase text-label tracking-wide">{r.kind}</td>
                  <td>
                    {r.status === "analyzed" ? (
                      <Link
                        href={`/intake/${r.id}`}
                        className="rounded-full bg-accent px-2 py-0.5 text-micro font-bold text-white hover:opacity-90"
                      >
                        Review mapping
                      </Link>
                    ) : r.status === "discarded" ? (
                      <span className="text-label font-medium uppercase tracking-wide text-neutral-400">discarded</span>
                    ) : (
                      <StatusBadge status={r.status === "imported" ? "succeeded" : r.status === "failed" ? "failed" : "running"} />
                    )}
                  </td>
                  <td className="tnum text-right">{Number(r.row_count).toLocaleString()}</td>
                  <td className="tnum text-right text-neutral-500">{Number(r.matched_count).toLocaleString()}</td>
                  <td className="text-xs text-neutral-400">{new Date(r.created_at).toISOString().slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
