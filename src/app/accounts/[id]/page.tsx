import Link from "next/link";
import { getPool } from "@/db/client";

export const dynamic = "force-dynamic";

const FEATURE_LABELS: Record<string, string> = {
  technology_fit: "Technology fit",
  trigger_events: "Trigger events",
  strategic_initiative: "Strategic initiative",
  momentum: "Momentum",
  partner_strength: "Partner strength",
  negative_signals: "Negative signals",
  already_installed: "Target already installed",
};

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = getPool();

  const { rows: companies } = await pool.query(
    `select legal_name, primary_domain, industry, employee_count from companies where id = $1`,
    [id],
  );
  if (companies.length === 0) {
    return <main style={{ padding: "2rem" }}>Unknown account.</main>;
  }
  const company = companies[0];

  const { rows: scores } = await pool.query(
    `select p.id, p.score, p.band, n.slug, p.computed_at
     from propensity_scores p join taxonomy_nodes n on n.id = p.taxonomy_node_id
     where p.company_id = $1 order by p.computed_at desc limit 1`,
    [id],
  );

  let features: { feature: string; contribution: string; evidence_ids: string[] }[] = [];
  let evidence = new Map<string, { claim: string; source_type: string; computed_confidence: string }>();

  if (scores.length > 0) {
    const result = await pool.query(
      `select feature, contribution, evidence_ids from score_features where score_id = $1
       order by contribution desc`,
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
            m.cta, m.confidence, m.created_at
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

  return (
    <main style={{ maxWidth: 720, margin: "6vh auto", padding: "0 1.5rem" }}>
      <p>
        <Link href="/">← Ranked accounts</Link>
      </p>
      <h1 style={{ fontSize: "1.5rem" }}>{company.legal_name}</h1>
      <p style={{ color: "#666" }}>
        {[company.industry, company.primary_domain, company.employee_count && `${company.employee_count} employees`]
          .filter(Boolean)
          .join(" · ")}
      </p>

      {scores.length === 0 ? (
        <p>Not scored yet.</p>
      ) : (
        <>
          <h2 style={{ fontSize: "1.1rem", marginTop: "1.5rem" }}>
            {scores[0].slug}: {Number(scores[0].score).toFixed(0)} / 100 ({scores[0].band.replace("_", " ")})
          </h2>
          <h3 style={{ fontSize: "1rem", marginTop: "1rem" }}>WHY NOW</h3>
          {features.map((f) => (
            <div key={f.feature} style={{ margin: "0.75rem 0" }}>
              <strong>
                {Number(f.contribution) >= 0 ? "+" : ""}
                {Number(f.contribution).toFixed(1)} {FEATURE_LABELS[f.feature] ?? f.feature}
              </strong>
              <ul style={{ margin: "0.25rem 0 0 1.25rem", color: "#444" }}>
                {f.evidence_ids.map((eid) => {
                  const e = evidence.get(eid);
                  return e ? (
                    <li key={eid} style={{ fontSize: "0.9rem" }}>
                      {e.claim}{" "}
                      <span style={{ color: "#999" }}>
                        ({e.source_type}, conf {Number(e.computed_confidence).toFixed(2)})
                      </span>
                    </li>
                  ) : null;
                })}
              </ul>
            </div>
          ))}
        </>
      )}

      {motions.length > 0 && (
        <section style={{ marginTop: "2rem", padding: "1rem", border: "1px solid #ddd", borderRadius: 8 }}>
          <h3 style={{ fontSize: "1rem", marginTop: 0 }}>
            Revenue Motion{" "}
            <span style={{ fontSize: "0.8rem", color: "#b60", textTransform: "uppercase" }}>
              {motions[0].status}
            </span>
          </h3>
          <p style={{ lineHeight: 1.55 }}>{motions[0].thesis}</p>
          <p style={{ color: "#444" }}>
            <strong>Trigger:</strong> {motions[0].trigger_summary}
          </p>
          <p style={{ color: "#444" }}>
            <strong>Personas:</strong> {motions[0].primary_persona} · {motions[0].secondary_persona}
          </p>
          <p style={{ color: "#444" }}>
            <strong>CTA:</strong> {motions[0].cta}{" "}
            <span style={{ color: "#999" }}>(confidence: {motions[0].confidence})</span>
          </p>
          {assets.length > 0 && (
            <div style={{ marginTop: "1rem" }}>
              <h4 style={{ fontSize: "0.95rem", margin: "0 0 0.5rem" }}>Campaign assets</h4>
              {assets.map((a) => (
                <details key={a.asset_type} style={{ margin: "0.5rem 0" }}>
                  <summary style={{ cursor: "pointer" }}>{a.title}</summary>
                  <pre
                    style={{
                      whiteSpace: "pre-wrap",
                      fontFamily: "inherit",
                      fontSize: "0.9rem",
                      background: "#fafafa",
                      padding: "0.75rem",
                      borderRadius: 6,
                    }}
                  >
                    {a.content}
                  </pre>
                </details>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
