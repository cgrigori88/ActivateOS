import { NextResponse } from "next/server";
import { withTenant } from "@/lib/db/tenant";
import { getScopeContext } from "@/lib/scope/server";

export const dynamic = "force-dynamic";

/** CSV export of the accounts view, honoring the active band/search filters. */
export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const band = url.searchParams.get("band");
  const q = url.searchParams.get("q")?.toLowerCase();

  // Ecosystem scope (§1): the export must narrow to exactly the same authorized set
  // the on-screen table shows — otherwise a scoped view could export the full book.
  const scope = await getScopeContext(url.searchParams.get("scope"));
  const scopeIds = scope.companyIds;

  // RISK-1: scope to the caller's org. This export previously ran unscoped —
  // any authenticated user could export every tenant's accounts. Now the
  // propensity_scores source is filtered by org_id (app-layer), and withTenant
  // pins the session so RLS enforces the same boundary at cutover.
  const { rows } = await withTenant(async (db, orgId) =>
    db.query(
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
       where p.org_id = $1 and ($3::boolean is false or p.company_id = any($2))
       order by p.company_id, p.computed_at desc
     ) latest
     join companies c on c.id = latest.company_id
     left join lateral (
       select pa.name as partner_name from pursuit_teams t
       join partners pa on pa.id = t.partner_id
       where t.company_id = latest.company_id and t.status in ('recommended','accepted')
       order by t.created_at desc limit 1) pt on true
     order by latest.score desc`,
      [orgId, scopeIds ?? [], scopeIds != null],
    ),
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
    let s = v == null ? "" : String(v);
    // Formula-injection guard: account/partner names come from ingested data,
    // and a leading = + - @ (or tab/CR) makes Excel/Sheets EXECUTE the cell.
    // A leading apostrophe forces text and is invisible in spreadsheet UIs.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
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
