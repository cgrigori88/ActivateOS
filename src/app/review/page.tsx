import { getPool } from "@/db/client";
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
    `select rq.id, rq.reason, e.claim, e.raw_excerpt, e.source_type, e.status,
            c.legal_name
     from review_queue rq
     join evidence e on e.id = rq.evidence_id
     left join companies c on c.id = e.company_id
     where rq.status = 'pending' order by rq.created_at limit 50`,
  );

  const { rows: sources } = await pool.query(
    `select name, round(trust_score, 2) as trust, round(audit_sample_rate * 100) as rate,
            audited_count, accurate_count
     from signal_sources order by name`,
  );

  const btn = (bg: string, fg: string, border = "0") => ({
    background: bg,
    color: fg,
    border,
    padding: "0.4rem 0.9rem",
    borderRadius: 6,
    cursor: "pointer",
  });

  return (
    <main style={{ maxWidth: 760, margin: "4vh auto", padding: "0 1.5rem" }}>
      <h1 style={{ fontSize: "1.5rem" }}>Evidence Review</h1>
      <p style={{ color: "#666", fontSize: "0.9rem" }}>
        Each verdict takes seconds: it updates the source&apos;s trust, adjusts how much of that
        source you see here, and banks a golden-set example. &quot;Accurate&quot; promotes
        quarantined evidence to verified.
      </p>

      {sources.length > 0 && (
        <p style={{ fontSize: "0.85rem", color: "#555" }}>
          {sources.map((s) => `${s.name}: trust ${s.trust} (sampling ${s.rate}%)`).join(" · ")}
        </p>
      )}

      {items.length === 0 && <p>Review queue is empty. 🎉</p>}
      {items.map((item) => (
        <section
          key={item.id}
          style={{ margin: "1rem 0", padding: "1rem", border: "1px solid #ddd", borderRadius: 8 }}
        >
          <p style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", color: "#888" }}>
            {REASON_LABELS[item.reason] ?? item.reason} · {item.source_type} ·{" "}
            {item.legal_name ?? "unknown company"} · currently {item.status}
          </p>
          <p style={{ margin: "0 0 0.5rem", fontWeight: 600 }}>{item.claim}</p>
          {item.raw_excerpt && item.raw_excerpt !== item.claim && (
            <blockquote
              style={{
                margin: "0 0 0.75rem",
                padding: "0.5rem 0.75rem",
                background: "#fafafa",
                borderLeft: "3px solid #ccc",
                fontSize: "0.9rem",
                color: "#444",
              }}
            >
              {String(item.raw_excerpt).slice(0, 400)}
            </blockquote>
          )}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <form action={resolveReviewAction.bind(null, item.id, "accurate")}>
              <button type="submit" style={btn("#080", "#fff")}>Accurate</button>
            </form>
            <form action={resolveReviewAction.bind(null, item.id, "inaccurate")}>
              <button type="submit" style={btn("#fff", "#b00", "1px solid #b00")}>Inaccurate</button>
            </form>
            <form action={resolveReviewAction.bind(null, item.id, "unsure")}>
              <button type="submit" style={btn("#eee", "#333")}>Unsure</button>
            </form>
          </div>
        </section>
      ))}
    </main>
  );
}
