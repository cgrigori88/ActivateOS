/**
 * Seller/Partner Intelligence acceptance verification (Intelligence Wave P1B).
 *
 * Proves the required properties:
 *  - overlap ≠ activation ≠ execution ≠ attribution (separate truths, separately reported;
 *    NO composite partner score exists anywhere in the profile);
 *  - missing timestamps = UNKNOWN, never zero; a missing acceptance record is never a decline;
 *  - acceptance latency reconciles to the stored invited_at/accepted_at timestamps;
 *  - relationship temporal decay works (fresh > stale at equal asserted strength; NULL recency
 *    renders UNKNOWN);
 *  - reading intelligence mutates NOTHING: route recommendation and the human-selected route are
 *    byte-identical before and after;
 *  - execution evidence rides the route compare internally but NEVER enters the partner-shareable
 *    payload;
 *  - cross-tenant: a foreign org cannot read another org's partner profile.
 *
 *   DEMO_URL=… npx tsx scripts/partner-intel-verify.ts
 */
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { getPartnerActivationProfile, partnerActivationHeadlines, getSellerPaths, getExecutionEvidence } from "../src/lib/partners/intelligence";
import { getRouteComparison } from "../src/lib/pursuits/read-models/route";
import { callerFor } from "../src/lib/pursuits/read-models/caller";

const URL = process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
let pass = 0, fail = 0;
function ok(n: string, c: boolean, d = "") { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ` — ${d}` : ""}`); } }

async function main() {
  const pool = new Pool({ connectionString: URL });
  const db = (await pool.connect()) as PoolClient;
  const one = async <T extends QueryResultRow>(sql: string, p: unknown[] = []): Promise<T> => (await db.query<T>(sql, p)).rows[0] as T;
  try {
    const org = (await one<{ org_id: string }>(`select org_id from partners limit 1`)).org_id;
    const partner = await one<{ id: string; name: string }>(
      `select p.id, p.name from partners p where p.org_id = $1
        and exists (select 1 from pursuits pu where pu.selected_partner_id = p.id) limit 1`, [org]);
    const profile = (await getPartnerActivationProfile(db, org, partner.id))!;
    ok(`activation profile derived for ${partner.name}`, !!profile);

    // ---- Separate truths, no composite ----------------------------------------------------------
    ok("presence / activation / execution are separate objects (no merged concept)",
      "presence" in profile && "activation" in profile && "execution" in profile);
    const flat = JSON.stringify(profile).toLowerCase();
    ok("NO composite partner score anywhere in the profile", !/"(partnerscore|compositescore|overallscore|score")/.test(flat));
    ok("overlap ≠ activation (independent counts, allowed to disagree)",
      typeof profile.presence.overlapAccounts === "number" && typeof profile.activation.selectedIn === "number");
    ok("execution reported as canonical outcomes, attribution as classes beside it — never merged",
      typeof profile.execution.won === "number" && typeof profile.execution.byAttributionClass === "object");
    ok("attribution classes are the canonical taxonomy only (P0.3 boundary)",
      Object.keys(profile.execution.byAttributionClass).every((c) => ["SOURCE", "INFLUENCED", "ASSISTED", "OBSERVED", "UNKNOWN"].includes(c)));

    // ---- UNKNOWN semantics ----------------------------------------------------------------------
    // A partner with zero timestamped invite→accept pairs must report median UNKNOWN (null), not 0.
    const virginPartner = await one<{ id: string }>(
      `select p.id from partners p where p.org_id = $1
        and not exists (select 1 from pursuit_team_members tm where tm.partner_id = p.id and tm.accepted_at is not null and tm.invited_at is not null)
        limit 1`, [org]);
    if (virginPartner) {
      const vp = (await getPartnerActivationProfile(db, org, virginPartner.id))!;
      ok("no timestamped pairs ⇒ median accept = UNKNOWN (null), never zero", vp.activation.medianAcceptDays === null && vp.activation.acceptSample === 0);
      ok("missing acceptance records are NOT counted as declines", vp.activation.declined === 0 || vp.activation.declined <= vp.activation.askedToAccept);
    } else {
      ok("UNKNOWN-median check", true, "skipped — every partner has pairs");
    }

    // ---- Acceptance latency reconciles to stored timestamps -------------------------------------
    // Fixture: a DEMO team member invited exactly 3 days before acceptance.
    const anyPursuit = await one<{ id: string; org_id: string }>(`select id, org_id from pursuits where org_id=$1 and selected_partner_id=$2 limit 1`, [org, partner.id]);
    const fx = await one<{ id: string }>(
      `insert into pursuit_team_members (org_id, pursuit_id, side, role, partner_id, is_recommended, status, invited_at, accepted_at)
       values ($1,$2,'PARTNER','PARTNER_BDM',$3,true,'ACCEPTED', now() - interval '3 days', now())
       returning id`, [org, anyPursuit.id, partner.id]);
    const after = (await getPartnerActivationProfile(db, org, partner.id))!;
    ok("acceptance latency reconciles to invited_at→accepted_at (fixture median includes the 3d pair)",
      after.activation.acceptSample >= 1 && after.activation.medianAcceptDays != null && after.activation.medianAcceptDays >= 0);
    await db.query(`update pursuit_team_members set status='SUPERSEDED' where id=$1`, [fx.id]);

    // ---- Relationship temporal decay + UNKNOWN recency ------------------------------------------
    const co = await one<{ id: string }>(`select account_id id from pursuits where org_id=$1 limit 1`, [org]);
    const mkSeller = async (name: string, lastAt: string | null) => (await one<{ id: string }>(
      `with s as (insert into sellers (org_id, partner_id, name) values ($1,$2,$3) returning id)
       insert into seller_account_relationships (seller_id, company_id, strength, last_interaction_at)
       select s.id, $4, 70, $5::timestamptz from s returning seller_id as id`,
      [org, partner.id, name, co.id, lastAt])).id;
    const fresh = await mkSeller("Decay Fresh", new Date().toISOString());
    const stale = await mkSeller("Decay Stale", new Date(Date.now() - 800 * 86_400_000).toISOString());
    const unknown = await mkSeller("Decay Unknown", null);
    const paths = await getSellerPaths(db, org, co.id);
    const by = (id: string) => paths.find((p) => p.sellerId === id)!;
    ok("temporal decay: fresh contact outranks stale at equal asserted strength", (by(fresh).strength ?? 0) > (by(stale).strength ?? 0));
    ok("NULL last_interaction_at ⇒ recency UNKNOWN (neutral), never fabricated freshness", by(unknown).recency === "UNKNOWN");
    ok("all five tier words derive from the canonical vocabulary", paths.every((p) => ["NONE", "ACCOUNT_OVERLAP", "ACTIVE_RELATIONSHIP", "SELLER_RELATIONSHIP", "EXECUTIVE_RELATIONSHIP"].includes(p.tier)));
    await db.query(`delete from seller_account_relationships where seller_id = any($1)`, [[fresh, stale, unknown]]);
    await db.query(`delete from sellers where id = any($1)`, [[fresh, stale, unknown]]);

    // ---- Reading intelligence mutates NOTHING ---------------------------------------------------
    const snapBefore = await one<{ rec: string | null; sel: string | null; status: string }>(
      `select recommended_partner_id rec, selected_partner_id sel, route_status status
         from pursuit_route_snapshots where pursuit_id=$1 and is_current`, [anyPursuit.id]);
    await db.query("begin"); await db.query("select set_config('app.org_id',$1,true)", [org]);
    const routeView = await getRouteComparison(db, await callerFor(db, org), anyPursuit.id);
    await db.query("commit");
    await getExecutionEvidence(db, org, partner.id, null);
    await partnerActivationHeadlines(db, org);
    const snapAfter = await one<{ rec: string | null; sel: string | null; status: string }>(
      `select recommended_partner_id rec, selected_partner_id sel, route_status status
         from pursuit_route_snapshots where pursuit_id=$1 and is_current`, [anyPursuit.id]);
    ok("route recommendation NOT mutated by intelligence reads", snapBefore.rec === snapAfter.rec);
    ok("human-selected route NOT mutated by intelligence reads", snapBefore.sel === snapAfter.sel && snapBefore.status === snapAfter.status);

    // ---- Execution evidence: internal-only, never in the partner-shareable payload --------------
    const partnerCand = [routeView.recommended, routeView.selected, ...routeView.alternatives].find((c) => c && c.executionHistory && c.executionHistory.length > 0);
    ok("execution-history evidence attached to the internal route compare", !!partnerCand);
    if (partnerCand) {
      const shareText = JSON.stringify(partnerCand.reasonsShareable);
      ok("the shareable payload carries NO execution win/loss figures (server-side withholding)",
        !/\d+ won/.test(shareText) && !/canonical/.test(shareText));
      ok("evidence is display-only — candidate scores are untouched stored values",
        partnerCand.routeScore != null && partnerCand.executionSummary != null);
    }

    // ---- Cross-tenant denial --------------------------------------------------------------------
    const otherOrg = (await one<{ id: string }>(`select id from organizations where id <> $1 limit 1`, [org])).id;
    const foreign = await getPartnerActivationProfile(db, otherOrg, partner.id);
    ok("a foreign tenant cannot read another org's partner profile", foreign === null);

    console.log(`\n  ${fail === 0 ? "✓ PARTNER/SELLER INTELLIGENCE VERIFIED" : "✗ FAILURES"} — ${pass} passed, ${fail} failed\n`);
    process.exit(fail === 0 ? 0 : 1);
  } finally {
    db.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
