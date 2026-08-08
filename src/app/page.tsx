import Link from "next/link";
import { getPool } from "@/db/client";

export const dynamic = "force-dynamic";

const BAND_LABELS: Record<string, string> = {
  very_high: "Very High",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export default async function Home() {
  let rows: {
    company_id: string;
    legal_name: string;
    score: string;
    band: string;
    slug: string;
  }[] = [];
  let error: string | null = null;

  try {
    const pool = getPool();
    const result = await pool.query(
      `select distinct on (p.company_id)
              p.company_id, c.legal_name, p.score, p.band, n.slug
       from propensity_scores p
       join companies c on c.id = p.company_id
       join taxonomy_nodes n on n.id = p.taxonomy_node_id
       order by p.company_id, p.computed_at desc`,
    );
    rows = result.rows;
    rows.sort((a, b) => Number(b.score) - Number(a.score));
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <main style={{ maxWidth: 720, margin: "6vh auto", padding: "0 1.5rem" }}>
      <h1 style={{ fontSize: "1.5rem" }}>ActivateOS — Ranked Accounts</h1>
      <p style={{ color: "#666", fontSize: "0.9rem" }}>
        Deterministic, evidence-backed propensity (v1 rules). Click an account for WHY NOW.
      </p>
      {error && (
        <p style={{ color: "#b00" }}>
          No data available: {error}. Run migrate → seed → ingest → map-signals → score.
        </p>
      )}
      {!error && rows.length === 0 && <p>No scores yet — run the scoring pipeline.</p>}
      {rows.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1rem" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
              <th style={{ padding: "0.5rem" }}>Account</th>
              <th style={{ padding: "0.5rem" }}>Solution</th>
              <th style={{ padding: "0.5rem", textAlign: "right" }}>Score</th>
              <th style={{ padding: "0.5rem" }}>Band</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.company_id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "0.5rem" }}>
                  <Link href={`/accounts/${r.company_id}`}>{r.legal_name}</Link>
                </td>
                <td style={{ padding: "0.5rem", color: "#666" }}>{r.slug}</td>
                <td style={{ padding: "0.5rem", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {Number(r.score).toFixed(0)}
                </td>
                <td style={{ padding: "0.5rem" }}>{BAND_LABELS[r.band] ?? r.band}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
