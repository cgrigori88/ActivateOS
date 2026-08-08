import Link from "next/link";
import { getPool } from "@/db/client";
import { BAND_LABELS, BandBadge, EvidenceLine, FEATURE_LABELS, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const BANDS = ["very_high", "high", "medium", "low"];

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ band?: string }>;
}) {
  const { band } = await searchParams;
  const pool = getPool();

  const { rows: scores } = await pool.query(
    `select * from (
       select distinct on (p.company_id)
         p.id as score_id, p.company_id, p.score, p.band, c.legal_name, c.industry, n.slug
       from propensity_scores p
       join companies c on c.id = p.company_id
       join taxonomy_nodes n on n.id = p.taxonomy_node_id
       order by p.company_id, p.computed_at desc
     ) latest
     ${band ? `where band = $1` : ""}
     order by score desc`,
    band ? [band] : [],
  );

  const scoreIds = scores.map((s) => s.score_id);
  const { rows: features } = scoreIds.length
    ? await pool.query(
        `select score_id, feature, contribution, evidence_ids from score_features
         where score_id = any($1) order by contribution desc`,
        [scoreIds],
      )
    : { rows: [] };

  const evidenceIds = [...new Set(features.flatMap((f) => f.evidence_ids as string[]))].slice(0, 400);
  const { rows: evidence } = evidenceIds.length
    ? await pool.query(
        `select id, claim, source_type, computed_confidence from evidence where id = any($1)`,
        [evidenceIds],
      )
    : { rows: [] };
  const evidenceById = new Map(evidence.map((e) => [e.id, e]));
  const featuresByScore = new Map<string, typeof features>();
  for (const f of features) {
    const list = featuresByScore.get(f.score_id) ?? [];
    list.push(f);
    featuresByScore.set(f.score_id, list);
  }

  return (
    <main>
      <PageHeader
        title="Accounts"
        subtitle="Ranked by evidence-backed propensity. Expand any row for WHY NOW."
      />

      <div className="mb-4 flex gap-2 text-sm">
        <Link
          href="/accounts"
          className={`rounded-md px-3 py-1 ring-1 ring-inset ring-neutral-300 dark:ring-neutral-700 ${!band ? "bg-neutral-900 text-white dark:bg-white dark:text-black" : ""}`}
        >
          All
        </Link>
        {BANDS.map((b) => (
          <Link
            key={b}
            href={`/accounts?band=${b}`}
            className={`rounded-md px-3 py-1 ring-1 ring-inset ring-neutral-300 dark:ring-neutral-700 ${band === b ? "bg-neutral-900 text-white dark:bg-white dark:text-black" : ""}`}
          >
            {BAND_LABELS[b]}
          </Link>
        ))}
      </div>

      {scores.length === 0 && (
        <p className="text-sm text-neutral-500">
          No scored accounts{band ? " in this band" : ""} — ingest accounts and run the scoring
          pipeline.
        </p>
      )}

      <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
        {scores.map((s) => (
          <details key={s.company_id} className="group">
            <summary className="flex cursor-pointer items-center gap-4 px-5 py-3.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
              <span className="min-w-0 flex-1">
                <Link
                  href={`/accounts/${s.company_id}`}
                  className="font-medium hover:underline"
                >
                  {s.legal_name}
                </Link>
                <span className="ml-2 text-xs text-neutral-400">
                  {[s.industry, s.slug].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="tnum text-lg font-semibold">{Number(s.score).toFixed(0)}</span>
              <BandBadge band={s.band} />
            </summary>
            <div className="border-t border-neutral-100 bg-neutral-50/60 px-5 py-4 dark:border-neutral-800 dark:bg-neutral-950/40">
              {(featuresByScore.get(s.score_id) ?? []).map((f) => (
                <div key={f.feature} className="mb-3 last:mb-0">
                  <p className="text-sm font-medium">
                    <span className={Number(f.contribution) >= 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}>
                      {Number(f.contribution) >= 0 ? "+" : ""}
                      {Number(f.contribution).toFixed(1)}
                    </span>{" "}
                    {FEATURE_LABELS[f.feature] ?? f.feature}
                  </p>
                  <ul className="ml-4 mt-1 list-disc space-y-0.5">
                    {(f.evidence_ids as string[]).slice(0, 3).map((eid) => {
                      const e = evidenceById.get(eid);
                      return e ? (
                        <EvidenceLine
                          key={eid}
                          claim={e.claim}
                          meta={`${e.source_type}, conf ${Number(e.computed_confidence).toFixed(2)}`}
                        />
                      ) : null;
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </main>
  );
}
