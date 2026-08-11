import { getPool } from "@/db/client";
import { Card, PageHeader } from "@/components/ui";
import { resolveReviewAction } from "./actions";

export const dynamic = "force-dynamic";

const REASON_LABELS: Record<string, string> = {
  sample: "Random sample",
  high_impact: "High impact",
  checker_disagreement: "Checker disagreed",
  contradiction: "Contradiction",
};

export default async function ReviewPage() {
  const pool = getPool();
  const { rows: items } = await pool.query(
    `select rq.id, rq.reason, e.claim, e.raw_excerpt, e.source_type, e.status, c.legal_name
     from review_queue rq
     join evidence e on e.id = rq.evidence_id
     left join companies c on c.id = e.company_id
     where rq.status = 'pending' order by rq.created_at limit 50`,
  );
  const { rows: sources } = await pool.query(
    `select name, round(trust_score, 2) as trust, round(audit_sample_rate * 100) as rate
     from signal_sources order by trust_score desc`,
  );

  return (
    <main>
      <PageHeader
        title="Evidence review"
        subtitle="Seconds per verdict: each one tunes source trust, adjusts sampling, banks a golden example — and 'accurate' promotes quarantined evidence."
      />

      {sources.length > 0 && (
        <Card className="mb-6 !p-0">
          {/* Collapsed by default: this page's job is seconds per verdict, and a
              22-row ledger above the queue puts the first decision below the fold. */}
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[10.5px] font-bold uppercase tracking-[0.09em] text-neutral-500 transition-colors duration-[140ms] hover:text-neutral-800 dark:hover:text-neutral-200">
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 transition-transform duration-[220ms] group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 4l4 4-4 4" />
              </svg>
              Source trust ledger
              <span className="tnum rounded-full bg-neutral-100 px-1.5 text-[11px] font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                {sources.length}
              </span>
            </summary>
          <div className="scroll-thin">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th className="text-right">Trust</th>
                  <th className="text-right">Sampling</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.name}>
                    <td className="font-medium">{s.name}</td>
                    <td className="tnum text-right">{s.trust}</td>
                    <td className="tnum text-right text-neutral-500">{s.rate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </details>
        </Card>
      )}

      {items.length === 0 && (
        <Card>
          <p className="text-sm text-neutral-500">
            Review queue is empty. New items arrive as research runs — sampled by source trust,
            plus anything the cross-checker disputed.
          </p>
        </Card>
      )}

      <div className="space-y-4">
        {items.map((item) => (
          <Card key={item.id}>
            <p className="mb-1.5 text-xs text-neutral-400">
              {REASON_LABELS[item.reason] ?? item.reason} · {item.source_type} ·{" "}
              {item.legal_name ?? "unknown company"} · currently {item.status}
            </p>
            <p className="mb-2 font-medium leading-snug">{item.claim}</p>
            {item.raw_excerpt && item.raw_excerpt !== item.claim && (
              <blockquote className="mb-3 border-l-2 border-neutral-300 pl-3 text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
                {String(item.raw_excerpt).slice(0, 400)}
              </blockquote>
            )}
            <div className="flex gap-2">
              <form action={resolveReviewAction.bind(null, item.id, "accurate")}>
                <button
                  type="submit"
                  className="rounded-md bg-green-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-800"
                >
                  Accurate
                </button>
              </form>
              <form action={resolveReviewAction.bind(null, item.id, "inaccurate")}>
                <button
                  type="submit"
                  className="rounded-md px-4 py-1.5 text-sm font-medium text-red-700 ring-1 ring-inset ring-red-300 hover:bg-red-50 dark:text-red-400 dark:ring-red-800 dark:hover:bg-red-950"
                >
                  Inaccurate
                </button>
              </form>
              <form action={resolveReviewAction.bind(null, item.id, "unsure")}>
                <button
                  type="submit"
                  className="rounded-md bg-neutral-100 px-4 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                >
                  Unsure
                </button>
              </form>
            </div>
          </Card>
        ))}
      </div>
    </main>
  );
}
