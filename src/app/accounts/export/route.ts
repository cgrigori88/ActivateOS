import { NextResponse } from "next/server";
import { getPool } from "@/db/client";

export const dynamic = "force-dynamic";

/** CSV export of the accounts view, honoring the active band/search filters. */
export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const band = url.searchParams.get("band");
  const q = url.searchParams.get("q")?.toLowerCase();

  const pool = getPool();
  const { rows } = await pool.query(
    `select latest.legal_name, latest.industry, latest.slug, latest.score, latest.band,
            pt.partner_name, c.refresh_tier, c.next_refresh_at,
            (select count(*) from evidence e
              where e.company_id = latest.company_id and e.status = 'verified') as verified_evidence
     from (
       select distinct on (p.company_id)
         p.company_id, p.score, p.band, c2.legal_name, c2.industry, n.slug
       from propensity_scores p
       join companies c2 on c2.id = p.company_id
       join taxonomy_nodes n on n.id = p.taxonomy_node_id
       order by p.company_id, p.computed_at desc
     ) latest
     join companies c on c.id = latest.company_id
     left join lateral (
       select pa.name as partner_name from pursuit_teams t
       join partners pa on pa.id = t.partner_id
       where t.company_id = latest.company_id and t.status in ('recommended','accepted')
       order by t.created_at desc limit 1) pt on true
     order by latest.score desc`,
  );

  let filtered = rows;
  if (band) filtered = filtered.filter((r) => r.band === band);
  if (q) {
    filtered = filtered.filter(
      (r) =>
        r.legal_name.toLowerCase().includes(q) ||
        (r.industry ?? "").toLowerCase().includes(q) ||
        (r.partner_name ?? "").toLowerCase().includes(q),
    );
  }

  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    "account", "industry", "solution", "score", "band",
    "routed_partner", "refresh_tier", "next_refresh", "verified_evidence",
  ];
  const lines = [
    header.join(","),
    ...filtered.map((r) =>
      [
        r.legal_name, r.industry, r.slug, Number(r.score).toFixed(1), r.band,
        r.partner_name, r.refresh_tier,
        r.next_refresh_at ? new Date(r.next_refresh_at).toISOString().slice(0, 10) : "",
        r.verified_evidence,
      ].map(esc).join(","),
    ),
  ];

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pursuitos-accounts.csv"`,
    },
  });
}
