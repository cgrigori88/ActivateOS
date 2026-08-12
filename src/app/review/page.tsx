import Link from "next/link";
import { getPool } from "@/db/client";
import { Bento, Card, PageHeader } from "@/components/ui";
import { QuerySelect } from "@/components/query-select";
import { resolveReviewAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Evidence review = a triage queue, not a firehose. It surfaces only what needs
 * a human (sampled / disputed / contradicted), rolled up BY ACCOUNT so it holds
 * at tens of thousands of accounts, with each item expandable on demand. The
 * full evidence trail lives on each account (the system of record).
 */

const REASON_LABELS: Record<string, string> = {
  sample: "Sample",
  high_impact: "High impact",
  checker_disagreement: "Checker disagreed",
  contradiction: "Contradiction",
};
const REASON_TONE: Record<string, string> = {
  contradiction: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  checker_disagreement: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  high_impact: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  sample: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
};

interface Item {
  id: string;
  reason: string;
  created_at: Date;
  claim: string;
  raw_excerpt: string | null;
  source_type: string;
  status: string;
  computed_confidence: string | null;
  observed_at: Date | null;
  company_id: string | null;
  legal_name: string | null;
}

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; source?: string }>;
}) {
  const sp = await searchParams;
  const pool = getPool();

  const { rows: all } = await pool.query<Item>(
    `select rq.id, rq.reason, rq.created_at,
            e.claim, e.raw_excerpt, e.source_type, e.status, e.computed_confidence, e.observed_at,
            c.id as company_id, c.legal_name
     from review_queue rq
     join evidence e on e.id = rq.evidence_id
     left join companies c on c.id = e.company_id
     where rq.status = 'pending'
     order by (rq.reason = 'contradiction') desc, (rq.reason = 'checker_disagreement') desc, rq.created_at
     limit 300`,
  );
  const { rows: sources } = await pool.query<{ name: string; trust: string; rate: string }>(
    `select name, round(trust_score, 2) as trust, round(audit_sample_rate * 100) as rate
     from signal_sources order by trust_score desc`,
  );

  const sourceOptions = [...new Set(all.map((i) => i.source_type))];
  const items = all.filter(
    (i) => (!sp.reason || sp.reason === "all" || i.reason === sp.reason) && (!sp.source || sp.source === "all" || i.source_type === sp.source),
  );

  // Bentos (from the full pending set, not the filtered view)
  const byReason = (r: string) => all.filter((i) => i.reason === r).length;
  const accounts = new Set(all.map((i) => i.company_id ?? "—")).size;

  // Group filtered items by account
  const groups = new Map<string, { name: string; companyId: string | null; items: Item[] }>();
  for (const i of items) {
    const key = i.company_id ?? "_none";
    const g = groups.get(key) ?? { name: i.legal_name ?? "Unattributed", companyId: i.company_id, items: [] };
    g.items.push(i);
    groups.set(key, g);
  }
  const grouped = [...groups.values()].sort((a, b) => b.items.length - a.items.length);

  return (
    <main>
      <PageHeader
        title="Evidence review"
        subtitle="A prioritized triage queue — only what needs a human, grouped by account. Each verdict tunes source trust and banks a golden example."
      />

      {/* Bentos */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Bento label="pending" value={all.length} />
        <Bento label="contradictions" value={byReason("contradiction")} />
        <Bento label="checker disputes" value={byReason("checker_disagreement")} />
        <Bento label="high impact" value={byReason("high_impact")} />
        <Bento label="accounts affected" value={accounts} />
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <QuerySelect param="reason" value={sp.reason ?? "all"} label="Reason" options={[{ value: "all", label: "Any reason" }, ...Object.entries(REASON_LABELS).map(([v, l]) => ({ value: v, label: l }))]} />
        <QuerySelect param="source" value={sp.source ?? "all"} label="Source" options={[{ value: "all", label: "Any source" }, ...sourceOptions.map((s) => ({ value: s, label: s }))]} />
        {sources.length > 0 && (
          <details className="relative ml-auto">
            <summary className="cursor-pointer text-xs text-neutral-500 hover:underline">Source trust</summary>
            <div className="absolute right-0 z-10 mt-1 w-72 rounded-lg border border-neutral-200 bg-white p-3 text-xs shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
              {sources.map((s) => (
                <div key={s.name} className="flex justify-between py-0.5">
                  <span className="text-neutral-600 dark:text-neutral-300">{s.name}</span>
                  <span className="tnum text-neutral-500">trust {s.trust} · sample {s.rate}%</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {items.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-500">
            {all.length === 0
              ? "Review queue is empty. Items arrive as research runs — sampled by source trust, plus anything the cross-checker disputed."
              : "Nothing matches this filter."}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {grouped.map((g) => (
            <Card key={g.companyId ?? g.name} className="p-0">
              <details open={grouped.length <= 3}>
                <summary className="flex cursor-pointer items-center gap-2 px-4 py-3">
                  <span className="font-semibold">{g.name}</span>
                  {g.companyId && <Link href={`/accounts/${g.companyId}`} className="text-xs text-blue-700 hover:underline dark:text-blue-400">account →</Link>}
                  <span className="tnum text-xs text-neutral-400">{g.items.length} to review</span>
                  <span className="ml-auto flex gap-1">
                    {[...new Set(g.items.map((i) => i.reason))].map((r) => (
                      <span key={r} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${REASON_TONE[r]}`}>{REASON_LABELS[r] ?? r}</span>
                    ))}
                  </span>
                </summary>
                <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {g.items.map((item) => (
                    <div key={item.id} className="px-4 py-3">
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-neutral-400">
                        <span className={`rounded px-1.5 py-0.5 font-medium ${REASON_TONE[item.reason]}`}>{REASON_LABELS[item.reason] ?? item.reason}</span>
                        <span>{item.source_type}</span>
                        {item.computed_confidence != null && <span>· conf {Math.round(Number(item.computed_confidence) * 100)}%</span>}
                        {item.observed_at && <span>· {new Date(item.observed_at).toISOString().slice(0, 10)}</span>}
                        <span>· now {item.status}</span>
                      </div>
                      <p className="mb-1 text-sm font-medium leading-snug">{item.claim}</p>
                      {item.raw_excerpt && item.raw_excerpt !== item.claim && (
                        <details className="mb-2">
                          <summary className="cursor-pointer text-xs text-blue-700 hover:underline dark:text-blue-400">Show source excerpt</summary>
                          <blockquote className="mt-1 border-l-2 border-neutral-300 pl-3 text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
                            {String(item.raw_excerpt).slice(0, 800)}
                          </blockquote>
                        </details>
                      )}
                      <div className="flex gap-2">
                        <form action={resolveReviewAction.bind(null, item.id, "accurate")}>
                          <button className="rounded-md bg-green-700 px-3 py-1 text-xs font-medium text-white hover:bg-green-800">Accurate</button>
                        </form>
                        <form action={resolveReviewAction.bind(null, item.id, "inaccurate")}>
                          <button className="rounded-md px-3 py-1 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-300 hover:bg-red-50 dark:text-red-400 dark:ring-red-800 dark:hover:bg-red-950">Inaccurate</button>
                        </form>
                        <form action={resolveReviewAction.bind(null, item.id, "unsure")}>
                          <button className="rounded-md bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700">Unsure</button>
                        </form>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
