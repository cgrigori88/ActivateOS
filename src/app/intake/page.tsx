import Link from "next/link";
import { withTenant } from "@/lib/db/tenant";
import { Card, PageHeader, fieldClass, BlockLabel, Disclosure } from "@/components/ui";
import { EvidenceModel } from "@/components/evidence-model";
import { analyzeUploadAction } from "./actions";
import { buttonClass } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Intake (Wave 5 §7) — where evidence enters the system.
 *
 * WHAT WAS WRONG. The room opened with an upload form, then a grid of partner
 * cards, then a 25-row log. Nothing anywhere said what state a file was in or
 * what a person was supposed to do next. The one genuinely actionable state —
 * a file that has been read and is waiting for a human to confirm its column
 * mapping before anything is written — was a blue pill in the fourth column of
 * the last table on the page, indistinguishable in weight from a row that had
 * finished importing three weeks ago.
 *
 * WHAT IT DOES NOW. The lifecycle leads, and the work leads with it: anything
 * awaiting review is named at the top with the file and a way into it. The
 * upload form stays, because uploading is the room's other job, but its
 * paragraph of explanation is behind disclosure rather than in front of it.
 *
 * §7 ON VOCABULARY. The brief's chain is received → normalized → matched →
 * needs review → rejected, "only where semantics support". Here they do not
 * fully: a batch row is created only after the file has been parsed and its
 * columns profiled, so received and normalized are the same instant in this
 * system and are shown as one stage rather than invented as two. The states
 * that are real — analyzed / importing / imported / discarded / failed — are
 * named in the reader's language and nothing else is added.
 *
 * Presentation only: no ingest behaviour, mapping or matching logic changes.
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

/** How recently a partner's book was refreshed. Worded, not shouted. */
function recency(last: Date | null): { days: number | null; label: string; tone?: string } {
  if (!last) return { days: null, label: "never imported here" };
  const days = Math.floor((Date.now() - new Date(last).getTime()) / 86_400_000);
  const when = days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  // Ordered by severity — the previous version labelled 20 days "STALE" and
  // 200 days "AGING", which read as the milder of the two.
  if (days <= 14) return { days, label: `refreshed ${when}` };
  if (days <= 45) return { days, label: `${when} — ageing`, tone: "var(--color-timing)" };
  return { days, label: `${when} — stale`, tone: "var(--color-accent-risk)" };
}

/** The five states a batch can actually be in, in the reader's words. */
const STATE_WORD: Record<string, string> = {
  analyzed: "Awaiting your review",
  importing: "Importing",
  imported: "Imported",
  discarded: "Discarded",
  failed: "Failed",
};

export default async function IntakePage({
  searchParams,
}: {
  searchParams?: Promise<{ notice?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const { partners, runs, states } = await withTenant(async (db, orgId) => ({
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
    /* Org-wide lifecycle counts — the log above is capped at 25, and a headline
       drawn from a capped list would be a wrong number stated confidently. */
    states: (await db.query<{ status: string; n: string; rows: string; matched: string }>(
      `select status, count(*)::text n,
              coalesce(sum(row_count), 0)::text rows,
              coalesce(sum(matched_count), 0)::text matched
         from import_batches where org_id = $1 group by status`,
      [orgId],
    )).rows,
  }));

  const count = (s: string) => Number(states.find((r) => r.status === s)?.n ?? 0);
  const received = states.reduce((t, r) => t + Number(r.n), 0);
  const awaiting = count("analyzed");
  const imported = count("imported");
  const rejected = count("discarded") + count("failed");
  const importedRows = Number(states.find((r) => r.status === "imported")?.rows ?? 0);
  const importedMatched = Number(states.find((r) => r.status === "imported")?.matched ?? 0);
  const matchRate = importedRows > 0 ? Math.round((importedMatched / importedRows) * 100) : null;

  const toReview = runs.filter((r) => r.status === "analyzed");

  return (
    <main>
      <PageHeader
        title="Intake"
        subtitle="Where evidence enters — partner books and CRM exports, matched into the graph."
      />
      <EvidenceModel
        current="intake"
        steps={{
          intake: { detail: awaiting > 0 ? `${awaiting} awaiting review` : `${received} file${received === 1 ? "" : "s"} received` },
        }}
      />

      {sp.notice && (
        <div className="mb-4 rounded-inner border border-green-300 bg-green-50 px-4 py-2.5 text-copy text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
          {sp.notice}
        </div>
      )}

      {/* The lifecycle, stated once, with the org-wide counts under it. */}
      <Card className="mb-4">
        <p className="text-title font-semibold ink">
          {received === 0
            ? "Nothing has been ingested yet."
            : awaiting > 0
              ? `${awaiting} file${awaiting === 1 ? "" : "s"} ${awaiting === 1 ? "is" : "are"} waiting for you to confirm the mapping.`
              : `${imported} of ${received} file${received === 1 ? "" : "s"} imported. Nothing is waiting on you.`}
        </p>
        <p className="mt-1 text-body ink-muted">
          A file is read and its columns profiled the moment it lands — there is no separate
          normalisation step to wait on. Nothing is written to the graph until a person confirms the
          mapping.
        </p>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-body">
          <Stage label="Received &amp; read" n={received} />
          <Stage label="Awaiting your review" n={awaiting} tone={awaiting > 0 ? "var(--color-timing)" : undefined} />
          <Stage label="Imported" n={imported} sub={matchRate == null ? undefined : `${matchRate}% of rows matched an account`} />
          <Stage label="Discarded or failed" n={rejected} tone={rejected > 0 ? "var(--ink-faint)" : undefined} />
        </div>
      </Card>

      {/* The one actionable state, named, with a way in. */}
      {toReview.length > 0 && (
        <Card className="mb-6">
          <BlockLabel>Waiting on you</BlockLabel>
          <ul className="space-y-1.5">
            {toReview.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-copy font-semibold ink">{r.filename ?? "upload"}</span>
                <span className="text-body ink-muted">
                  {Number(r.row_count).toLocaleString()} rows
                  {r.partner && <> · {r.partner}</>} · {r.kind}
                </span>
                <span className="text-label ink-faint">
                  received {new Date(r.created_at).toISOString().slice(0, 10)}
                </span>
                <Link href={`/intake/${r.id}`} className={`ml-auto ${buttonClass("primary", "sm")}`}>
                  Review the mapping →
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Upload → analyze → mapping review */}
      <Card className="mb-6">
        <BlockLabel>Upload a file</BlockLabel>
        <form action={analyzeUploadAction} className="flex flex-wrap items-end gap-3">
          <label className="text-copy">
            <span className="mb-1 block text-body text-neutral-500">CSV file — any columns, any naming</span>
            <input type="file" name="file" accept=".csv,text/csv,text/plain" required className="text-copy" />
          </label>
          <label className="text-copy">
            <span className="mb-1 block text-body text-neutral-500">What is this file?</span>
            <select name="kind" className={fieldClass("md")}>
              <option value="book">Partner book / account list</option>
              <option value="crm">CRM export (opportunities)</option>
              <option value="enrichment">Enrichment export (HG, D&amp;B, Gainsight…)</option>
            </select>
          </label>
          <label className="text-copy">
            <span className="mb-1 block text-body text-neutral-500">Source name (enrichment only)</span>
            <input
              name="sourceLabel"
              maxLength={80}
              placeholder="HG Insights"
              className={fieldClass("md")}
            />
          </label>
          <button type="submit" className={buttonClass("primary", "md")}>
            Analyze columns
          </button>
        </form>
        <Disclosure summary="What happens to the file after this" className="mt-2">
          No fixed template needed. The file is profiled inside your tenant (no third party sees it), the columns are
          auto-matched to platform fields, and you confirm the mapping before anything is imported. A partner book
          lands as a reviewable list; a CRM export lands as stage/amount snapshots compared against your live
          records — never overwriting them; an enrichment export (technographics, intent, IT spend, health scores)
          lands as third-party evidence with the vendor named as provenance, feeding the next scoring sweep.
        </Disclosure>
      </Card>

      {/* Per-partner cards */}
      <BlockLabel>What each partner has contributed</BlockLabel>
      {partners.length === 0 ? (
        <p className="mb-6 text-copy text-neutral-500">No partner uploads yet — upload a CSV above to get started.</p>
      ) : (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {partners.map((p) => {
            const rowsTotal = Number(p.rows_total);
            const matched = Number(p.matched_total);
            const rate = rowsTotal > 0 ? Math.round((matched / rowsTotal) * 100) : 0;
            const r = recency(p.last_import);
            return (
              <Card key={p.id}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-semibold">{p.name}</span>
                  <span className="rounded-inner px-1.5 py-0.5 text-micro font-medium uppercase tracking-wide text-neutral-500 ring-1 ring-inset ring-neutral-300/50 dark:ring-neutral-700">
                    {(p.partner_type ?? "partner").replace(/_/g, " ")}
                  </span>
                  {Number(p.batches) > 0 && (
                    <span className="ml-auto text-body text-neutral-400">{p.batches} batch{Number(p.batches) === 1 ? "" : "es"}</span>
                  )}
                </div>
                {/* A partner can hold mapped accounts without ever having had a
                    file imported here — they arrived through an approved list.
                    Showing that partner "0 rows · 0% matched" states a failure
                    that did not happen. */}
                {rowsTotal === 0 ? (
                  <div>
                    <div className="pos-metric-fig">{Number(p.accounts).toLocaleString()}</div>
                    <div className="text-body text-neutral-500">accounts mapped, none of them from a file imported here</div>
                  </div>
                ) : (
                  <div className="flex items-baseline gap-6">
                    <div>
                      <div className="pos-metric-fig">{rowsTotal.toLocaleString()}</div>
                      <div className="text-body text-neutral-500">rows · {Number(p.accounts).toLocaleString()} accounts</div>
                    </div>
                    <div>
                      <div className="pos-metric-fig">{rate}%</div>
                      <div className="text-body text-neutral-500">matched an account</div>
                    </div>
                  </div>
                )}
                <div className="mt-3 flex items-center justify-between gap-2 text-body">
                  {/* The metric caption above already says "none from a file
                      imported here"; repeating it as a status is noise. */}
                  <span style={r.tone ? { color: r.tone } : undefined} className={r.tone ? "font-medium" : "text-neutral-500"}>
                    {r.days == null ? "" : r.label}
                  </span>
                  <Link href={`/mapping?partner=${p.id}`} className="text-accent hover:underline dark:text-blue-400">
                    View mapping →
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Runs log */}
      <BlockLabel>Every file received</BlockLabel>
      {runs.length === 0 ? (
        <p className="text-copy text-neutral-500">No runs yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 scroll-thin dark:border-neutral-800">
          <table className="data-table">
            <thead>
              <tr>
                <th>File</th>
                <th>State</th>
                <th>Partner</th>
                <th>Kind</th>
                <th className="text-right">Rows</th>
                <th className="text-right">Matched</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">
                    {r.status === "analyzed" ? (
                      <Link href={`/intake/${r.id}`} className="text-accent hover:underline dark:text-blue-400">
                        {r.filename ?? "upload"} →
                      </Link>
                    ) : (
                      (r.filename ?? "—")
                    )}
                  </td>
                  <td
                    className={r.status === "analyzed" || r.status === "failed" ? "font-semibold" : "text-neutral-500"}
                    style={
                      r.status === "analyzed"
                        ? { color: "var(--color-timing)" }
                        : r.status === "failed"
                          ? { color: "var(--color-accent-risk)" }
                          : undefined
                    }
                  >
                    {STATE_WORD[r.status] ?? r.status}
                  </td>
                  <td className="text-neutral-500">{r.partner ?? "—"}</td>
                  <td className="text-neutral-500 uppercase text-label tracking-wide">{r.kind}</td>
                  <td className="tnum text-right">{Number(r.row_count).toLocaleString()}</td>
                  <td className="tnum text-right text-neutral-500">
                    {r.status === "imported" ? Number(r.matched_count).toLocaleString() : <span className="text-neutral-300 dark:text-neutral-600">—</span>}
                  </td>
                  <td className="text-body text-neutral-400">{new Date(r.created_at).toISOString().slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

/** One lifecycle stage: the count first, because that is what is being read. */
function Stage({ label, n, sub, tone }: { label: string; n: number; sub?: string; tone?: string }) {
  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span className="tnum text-section font-semibold" style={tone ? { color: tone } : undefined}>
          {n}
        </span>
        <span className="text-body ink-muted">{label}</span>
      </div>
      {sub && <div className="text-label ink-faint">{sub}</div>}
    </div>
  );
}
