import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/db/tenant";
import { clientIp, rateLimited } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

/**
 * ⌘K palette search (#78). One GET, five org-scoped lookups, a flat grouped
 * result list. Rooms are static and live in the client — this endpoint only
 * answers "which ENTITIES match". Sits behind the proxy (Basic Auth /
 * identity in production) like every page; a caller without a tenant gets
 * an empty list, never someone else's data.
 */

interface Hit {
  group: string;
  label: string;
  sub: string | null;
  href: string;
}

/** Escape ilike wildcards so "50%" searches for a literal percent sign. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export async function GET(req: NextRequest) {
  if (rateLimited(`palette:${clientIp(req.headers)}`, 120, 60_000)) {
    return NextResponse.json({ results: [] }, { status: 429 });
  }
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return NextResponse.json({ results: [] });

  const pat = likePattern(q);
  const results: Hit[] = [];
  try {
    // RISK-1: run the five lookups under withTenant (pins app.org_id). The
    // subqueries keep their explicit org_id filters (complementary to RLS). A
    // caller with no tenant, or any DB hiccup, throws → empty palette, never a
    // 500 mid-keystroke.
    await withTenant(async (db, orgId) => {
    const [accounts, campaigns, motions, partners, pursuits] = await Promise.all([
      // Accounts the org can actually reach: on one of its lists, or carrying
      // one of its motions or campaigns. Stricter than the accounts table's
      // own query on purpose — search must never widen visibility.
      db.query<{ id: string; legal_name: string; industry: string | null }>(
        `select c.id, c.legal_name, c.industry from companies c
         where c.legal_name ilike $2 and (
           exists (select 1 from population_members pm
                   join account_populations ap on ap.id = pm.population_id
                   where pm.company_id = c.id and ap.org_id = $1)
           or exists (select 1 from revenue_motions m where m.company_id = c.id and m.org_id = $1)
           or exists (select 1 from campaigns ca where ca.company_id = c.id and ca.org_id = $1)
         )
         order by c.legal_name limit 5`,
        [orgId, pat],
      ),
      db.query<{ id: string; name: string; status: string; legal_name: string | null }>(
        `select ca.id, ca.name, ca.status, c.legal_name
         from campaigns ca
         left join revenue_motions m on m.id = ca.motion_id
         left join companies c on c.id = coalesce(ca.company_id, m.company_id)
         where ca.org_id = $1 and ca.name ilike $2 and ca.dismissed_at is null
         order by ca.created_at desc limit 5`,
        [orgId, pat],
      ),
      // A motion's searchable name is its account — that is how operators say
      // "the Initech motion". The brief is the drill-in surface.
      db.query<{ id: string; status: string; legal_name: string }>(
        `select m.id, m.status, c.legal_name
         from revenue_motions m join companies c on c.id = m.company_id
         where m.org_id = $1 and c.legal_name ilike $2
         order by m.created_at desc limit 5`,
        [orgId, pat],
      ),
      db.query<{ id: string; name: string; partner_type: string | null }>(
        `select id, name, partner_type from partners
         where org_id = $1 and name ilike $2 order by name limit 5`,
        [orgId, pat],
      ),
      db.query<{ id: string; name: string; status: string }>(
        `select jp.id, jp.name, jp.status
         from joint_pursuits jp join partnerships p on p.id = jp.partnership_id
         where (p.initiator_org_id = $1 or p.counterpart_org_id = $1)
           and jp.name ilike $2
         order by jp.created_at desc limit 5`,
        [orgId, pat],
      ),
    ]);

    for (const r of accounts.rows)
      results.push({ group: "Accounts", label: r.legal_name, sub: r.industry, href: `/accounts/${r.id}` });
    for (const r of campaigns.rows)
      results.push({ group: "Campaigns", label: r.name, sub: r.legal_name ? `${r.legal_name} · ${r.status}` : r.status, href: `/campaigns/${r.id}` });
    for (const r of motions.rows)
      results.push({ group: "Motions", label: `${r.legal_name} — activation brief`, sub: r.status, href: `/briefs/${r.id}` });
    for (const r of partners.rows)
      results.push({ group: "Partners", label: r.name, sub: r.partner_type, href: `/partners/${r.id}` });
    for (const r of pursuits.rows)
      results.push({ group: "Joint pursuits", label: r.name, sub: r.status, href: `/joint/${r.id}` });
    });
  } catch {
    /* no tenant, or db unavailable — an empty palette beats a 500 mid-keystroke */
  }
  return NextResponse.json({ results });
}
