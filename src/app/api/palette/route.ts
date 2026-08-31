import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { withTenant } from "@/lib/db/tenant";
import { clientIp, rateLimited } from "@/lib/security/rate-limit";
import { answerQuestion, classifyForAnswer } from "@/lib/interpret/answer";
import "@/lib/search/intents";   // registers every deterministic intent (side-effect import)
import { resolveScope } from "@/lib/scope/server";
import { parseScope, SCOPE_COOKIE } from "@/lib/scope/scope";

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

/** Long enough for a multi-constraint question; short enough to stay a bounded input. */
const MAX_QUERY_CHARS = 300;

/** Escape ilike wildcards so "50%" searches for a literal percent sign. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export async function GET(req: NextRequest) {
  if (rateLimited(`palette:${clientIp(req.headers)}`, 120, 60_000)) {
    return NextResponse.json({ results: [] }, { status: 429 });
  }
  // The cap was 80 characters, sized for an entity name. A compound question is legitimately
  // longer than that: "show WWT pursuits over $500K renewing in 90 days without a verified
  // economic buyer" is 82, and truncating it silently removed the stakeholder constraint — so the
  // palette returned MORE pursuits than were asked for, with a read-back that did not mention the
  // constraint it had dropped. A dropped filter that widens the answer is the worst shape of bug
  // this surface can have. The cap is now 300, and truncation is stated rather than silent.
  const raw = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const q = raw.slice(0, MAX_QUERY_CHARS);
  const truncated = raw.length > MAX_QUERY_CHARS;
  if (q.length < 2) return NextResponse.json({ results: [] });

  const pat = likePattern(q);
  const results: Hit[] = [];
  // Unified retrieval intent (§5 / R6): GO TO (entity nav, below) · SHOW ME (structured query) ·
  // EXPLAIN (evidence-bound). All deterministic; unmatched fails honestly.
  // Registry-aware classification (P2C-1): the P2C-0 token heuristic did not know about the
  // intents added since, so "what should I focus on today" was treated as a name to navigate to.
  const intent = classifyForAnswer(q);
  let interpreted: string | null = null;
  let explanation: unknown = null;
  let note: string | null = null;
  // Which registered intent answered, and how routing ended (MATCHED / AMBIGUOUS / UNSUPPORTED) —
  // surfaced so the resolution path is inspectable rather than implicit.
  let intentKey: string | null = null;
  let outcome: string | null = null;
  // Which tier answered: GOTO · DETERMINISTIC · INTERPRETED (P2C-1 §11 — the path is part of the
  // answer's provenance, so the palette can say so rather than implying every answer is parsed).
  let path: string | null = null;
  let scopeRaw: string | null = null;
  try { scopeRaw = (await cookies()).get(SCOPE_COOKIE)?.value ?? null; } catch { /* no request cookies */ }
  const scope = parseScope(scopeRaw);
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

    // SHOW ME / EXPLAIN — the shared answer stack (P2C-1 §10). Deterministic registry first; the
    // LLM interpreter runs ONLY where the parsers found nothing, so no keystroke that resolves
    // today can start costing a model round trip, and no model outage can take one offline.
    // GO TO never reaches this branch at all — entity navigation is the five lookups above.
    if (intent === "showme" || intent === "explain") {
      const companyIds = scope.kind === "ALL" ? null : (await resolveScope(db, orgId, scope)).companyIds;
      const env = await answerQuestion(db, orgId, q, { intentClass: intent, companyIds });
      intentKey = env.intentKey;
      outcome = env.outcome;
      path = env.path;
      if (env.interpreted) interpreted = env.interpreted;
      if (env.explanation) explanation = env.explanation;
      for (const h of env.hits) results.push(h);
      // AMBIGUOUS carries a clarification instead of an answer — one short question, never a guess.
      if (env.clarification) note = env.clarification;
      else if (env.outcome !== "MATCHED") note = env.answer;
    }
    });
  } catch {
    /* no tenant, or db unavailable — an empty palette beats a 500 mid-keystroke */
  }
  if (truncated) {
    note = `Only the first ${MAX_QUERY_CHARS} characters were read — the rest of the question was not applied.`;
  }
  return NextResponse.json({ intent, intentKey, outcome, path, interpreted, results, explanation, note, truncated });
}
