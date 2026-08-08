import Link from "next/link";
import { getPool } from "@/db/client";
import { approveMotionAction, rejectMotionAction } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_COLORS: Record<string, string> = {
  draft: "#b60",
  approved: "#080",
  active: "#06c",
  completed: "#666",
  abandoned: "#999",
};

export default async function MotionsPage() {
  const pool = getPool();
  const { rows: motions } = await pool.query(
    `select m.id, m.status, m.thesis, m.trigger_summary, m.cta, m.confidence,
            m.company_id, c.legal_name, n.slug
     from revenue_motions m
     join companies c on c.id = m.company_id
     join taxonomy_nodes n on n.id = m.taxonomy_node_id
     order by (m.status = 'draft') desc, m.created_at desc limit 50`,
  );

  return (
    <main style={{ maxWidth: 760, margin: "4vh auto", padding: "0 1.5rem" }}>
      <h1 style={{ fontSize: "1.5rem" }}>Revenue Motions</h1>
      <p style={{ color: "#666", fontSize: "0.9rem" }}>
        Drafts await your approval — agents propose, you dispose. Approvals and rejections are
        recorded for the learning loop.
      </p>
      {motions.length === 0 && <p>No motions yet — run the scoring pipeline and design-motion.</p>}
      {motions.map((m) => (
        <section
          key={m.id}
          style={{ margin: "1rem 0", padding: "1rem", border: "1px solid #ddd", borderRadius: 8 }}
        >
          <p style={{ margin: 0 }}>
            <strong>
              <Link href={`/accounts/${m.company_id}`}>{m.legal_name}</Link>
            </strong>{" "}
            — {m.slug}{" "}
            <span
              style={{
                color: STATUS_COLORS[m.status] ?? "#333",
                textTransform: "uppercase",
                fontSize: "0.8rem",
                fontWeight: 600,
              }}
            >
              {m.status}
            </span>{" "}
            <span style={{ color: "#999", fontSize: "0.85rem" }}>({m.confidence} confidence)</span>
          </p>
          <p style={{ lineHeight: 1.5, color: "#333" }}>{m.thesis}</p>
          <p style={{ color: "#555", fontSize: "0.9rem" }}>
            <strong>Trigger:</strong> {m.trigger_summary}
            <br />
            <strong>CTA:</strong> {m.cta}
          </p>
          {m.status === "draft" && (
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <form action={approveMotionAction.bind(null, m.id)}>
                <button
                  type="submit"
                  style={{
                    background: "#080",
                    color: "#fff",
                    border: 0,
                    padding: "0.45rem 1rem",
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  Approve
                </button>
              </form>
              <form action={rejectMotionAction.bind(null, m.id)}>
                <button
                  type="submit"
                  style={{
                    background: "#fff",
                    color: "#b00",
                    border: "1px solid #b00",
                    padding: "0.45rem 1rem",
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  Reject
                </button>
              </form>
            </div>
          )}
        </section>
      ))}
    </main>
  );
}
