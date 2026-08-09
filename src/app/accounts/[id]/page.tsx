import Link from "next/link";
import { getPool } from "@/db/client";
import {
  BandBadge,
  Card,
  EvidenceLine,
  FEATURE_LABELS,
  PageHeader,
  StatusBadge,
} from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = getPool();

  const { rows: companies } = await pool.query(
    `select legal_name, primary_domain, industry, employee_count, country from companies where id = $1`,
    [id],
  );
  if (companies.length === 0) {
    return <main>Unknown account.</main>;
  }
  const company = companies[0];

  const { rows: scores } = await pool.query(
    `select p.id, p.score, p.band, n.slug, p.computed_at,
            p.prev_score, p.positive_points, p.negative_points, p.changes
     from propensity_scores p join taxonomy_nodes n on n.id = p.taxonomy_node_id
     where p.company_id = $1 order by p.computed_at desc limit 1`,
    [id],
  );

  let dimensions: { dimension: string; value: string }[] = [];
  if (scores.length > 0) {
    const result = await pool.query(
      `select dimension, value from propensity_dimensions where score_id = $1
       order by dimension`,
      [scores[0].id],
    );
    dimensions = result.rows;
  }

  let features: { feature: string; contribution: string; evidence_ids: string[] }[] = [];
  let evidence = new Map<string, { claim: string; source_type: string; computed_confidence: string }>();
  if (scores.length > 0) {
    const result = await pool.query(
      `select feature, contribution, evidence_ids from score_features
       where score_id = $1 order by contribution desc`,
      [scores[0].id],
    );
    features = result.rows;
    const allIds = [...new Set(features.flatMap((f) => f.evidence_ids))];
    if (allIds.length > 0) {
      const ev = await pool.query(
        `select id, claim, source_type, computed_confidence from evidence where id = any($1)`,
        [allIds],
      );
      evidence = new Map(ev.rows.map((e) => [e.id, e]));
    }
  }

  const { rows: motions } = await pool.query(
    `select m.id, m.status, m.thesis, m.trigger_summary, m.primary_persona, m.secondary_persona,
            m.cta, m.confidence
     from revenue_motions m where m.company_id = $1 order by m.created_at desc limit 1`,
    [id],
  );

  let assets: { asset_type: string; title: string; content: string }[] = [];
  if (motions.length > 0) {
    const result = await pool.query(
      `select a.asset_type, a.title, a.content
       from campaign_assets a join campaigns cp on cp.id = a.campaign_id
       where cp.motion_id = $1 order by a.created_at`,
      [motions[0].id],
    );
    assets = result.rows;
  }

  const { rows: events } = await pool.query(
    `select event_type, occurred_at from outcome_events where company_id = $1
     order by occurred_at desc limit 10`,
    [id],
  );

  return (
    <main>
      <p className="mb-4 text-sm">
        <Link href="/accounts" className="text-neutral-500 hover:underline">
          ← Accounts
        </Link>
      </p>
      <PageHeader
        title={company.legal_name}
        subtitle={[
          company.industry,
          company.primary_domain,
          company.employee_count && `~${company.employee_count} employees`,
          company.country,
        ]
          .filter(Boolean)
          .join(" · ")}
      />

      {scores.length > 0 && (
        <Card className="mb-6">
          <div className="mb-3 flex items-baseline gap-3">
            <span className="tnum text-4xl font-semibold">{Number(scores[0].score).toFixed(0)}</span>
            <BandBadge band={scores[0].band} />
            <span className="text-sm text-neutral-500">{scores[0].slug}</span>
            {scores[0].positive_points != null && (
              <span className="ml-auto text-sm text-neutral-500">
                <span className="text-green-700 dark:text-green-400">
                  +{Number(scores[0].positive_points).toFixed(0)}
                </span>{" "}
                /{" "}
                <span className="text-red-700 dark:text-red-400">
                  {Number(scores[0].negative_points).toFixed(0)}
                </span>{" "}
                net evidence
              </span>
            )}
          </div>

          {dimensions.length > 0 && (
            <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-7">
              {dimensions.map((d) => (
                <div
                  key={d.dimension}
                  className="rounded-lg bg-neutral-50 px-2 py-1.5 text-center dark:bg-neutral-950"
                >
                  <div className="tnum text-base font-semibold">{Number(d.value).toFixed(0)}</div>
                  <div className="text-[10px] leading-tight text-neutral-500">
                    {d.dimension.replace(/_/g, " ")}
                  </div>
                </div>
              ))}
            </div>
          )}

          {scores[0].changes?.delta != null && (
            <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:bg-sky-950 dark:text-sky-200">
              <strong>What changed:</strong>{" "}
              {Number(scores[0].changes.delta) >= 0 ? "+" : ""}
              {scores[0].changes.delta} since prior evaluation
              {scores[0].changes.new_evidence_ids?.length > 0 &&
                ` · ${scores[0].changes.new_evidence_ids.length} new evidence item(s)`}
            </p>
          )}

          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Why now
          </h2>
          {features.map((f) => (
            <div key={f.feature} className="mb-3 last:mb-0">
              <p className="text-sm font-medium">
                <span
                  className={
                    Number(f.contribution) >= 0
                      ? "text-green-700 dark:text-green-400"
                      : "text-red-700 dark:text-red-400"
                  }
                >
                  {Number(f.contribution) >= 0 ? "+" : ""}
                  {Number(f.contribution).toFixed(1)}
                </span>{" "}
                {FEATURE_LABELS[f.feature] ?? f.feature}
              </p>
              <ul className="ml-4 mt-1 list-disc space-y-0.5">
                {f.evidence_ids.map((eid) => {
                  const e = evidence.get(eid);
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
        </Card>
      )}

      {motions.length > 0 && (
        <Card className="mb-6">
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Revenue motion
            </h2>
            <StatusBadge status={motions[0].status} />
            <span className="text-xs text-neutral-400">confidence: {motions[0].confidence}</span>
          </div>
          <p className="mb-3 leading-relaxed">{motions[0].thesis}</p>
          <dl className="space-y-1 text-sm text-neutral-600 dark:text-neutral-400">
            <div>
              <dt className="inline font-medium text-neutral-800 dark:text-neutral-200">Trigger: </dt>
              <dd className="inline">{motions[0].trigger_summary}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-neutral-800 dark:text-neutral-200">Personas: </dt>
              <dd className="inline">
                {motions[0].primary_persona} · {motions[0].secondary_persona}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium text-neutral-800 dark:text-neutral-200">CTA: </dt>
              <dd className="inline">{motions[0].cta}</dd>
            </div>
          </dl>
          {assets.length > 0 && (
            <div className="mt-4 border-t border-neutral-100 pt-3 dark:border-neutral-800">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
                Campaign assets
              </h3>
              {assets.map((a) => (
                <details key={a.asset_type} className="mb-2">
                  <summary className="cursor-pointer text-sm font-medium hover:underline">
                    {a.title}
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-neutral-50 p-3 font-sans text-sm leading-relaxed dark:bg-neutral-950">
                    {a.content}
                  </pre>
                </details>
              ))}
            </div>
          )}
        </Card>
      )}

      {events.length > 0 && (
        <Card>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Timeline
          </h2>
          <ul className="space-y-1.5">
            {events.map((e, i) => (
              <li key={i} className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
                <span className="font-medium">{e.event_type.replace(/_/g, " ").toLowerCase()}</span>
                <span className="ml-auto text-xs text-neutral-400">
                  {new Date(e.occurred_at).toISOString().slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
