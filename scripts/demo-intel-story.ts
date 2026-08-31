/**
 * Intelligence-wave demo story (P1AB — design-partner narrative). ADDITIVE + idempotent, layered
 * on demo-db.ts + demo-stories.ts. Everything is DEMO / is_simulated synthetic data.
 *
 * What it builds (and why):
 *  1. Motion funnel variety — the seeded world already shows execution-ready (Globex), timing
 *     UNKNOWN (Stark) and no-route (Tyrell). This adds the two missing states through the REAL
 *     governed paths (dispatchSkill route decisions + team confirm/accept — no direct CRUD):
 *       · Initech  → route decided, one required role confirmed (INVITED) ⇒ ACCEPTANCE_PENDING
 *                    (nearly-ready; also feeds the Today "$X blocked by partner acceptance" line);
 *       · Umbrella → route decided, both required roles accepted ⇒ a second execution-ready
 *                    account (if its other gates hold).
 *  2. The partner DISAGREEMENT — Partner A (CDW) has broader presence: a customer list covering
 *     most demo accounts + modest asserted relationships, but few selected routes. Partner B
 *     (WWT) has the stronger actual activation/execution (already seeded + selected on the hero).
 *     Neither becomes "correct": route recommendation and the human decision remain separately
 *     governed; outcomes stay mixed. Two modest CDW canonical wins are recorded through the real
 *     outcome/attribution helpers so execution history has evidence on both sides.
 *
 *   npx tsx scripts/demo-intel-story.ts     (idempotent — sentinel-guarded)
 */
import { Pool, type PoolClient } from "pg";
import { dispatchSkill, type Actor } from "../src/lib/pursuits/federation/skills";
import { upsertPursuit } from "../src/lib/pursuits/model";
import { recordOutcome, recordAttribution } from "../src/lib/pursuits/federation/outcomes";

const URL = process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const SENTINEL = "Intel Story Sentinel Co";

async function tx<T>(pool: Pool, orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("begin"); await c.query("select set_config('app.org_id',$1,true)", [orgId]); const r = await fn(c); await c.query("commit"); return r; }
  catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}

async function main() {
  const pool = new Pool({ connectionString: URL });
  const db = await pool.connect();
  try {
    const done = await db.query(`select 1 from companies where legal_name = $1`, [SENTINEL]);
    if (done.rows.length) { console.log("[demo-intel-story] sentinel present — already applied, no-op."); return; }

    const org = (await db.query<{ org_id: string }>(`select org_id from revenue_motions limit 1`)).rows[0].org_id;
    const node = (await db.query<{ id: string }>(`select id from taxonomy_nodes where slug='virtualization'`)).rows[0].id;
    const cdw = (await db.query<{ id: string }>(`select id from partners where org_id=$1 and name='CDW'`, [org])).rows[0]?.id;
    const wwt = (await db.query<{ id: string }>(`select id from partners where org_id=$1 and name='WWT'`, [org])).rows[0]?.id;
    if (!cdw || !wwt) throw new Error("demo partners CDW/WWT not found — run demo-db.ts + demo-stories.ts first");
    const actor: Actor = { type: "USER", id: null, orgId: org, role: "operator" };

    // ---- 1a. Initech: governed route decision → proposed team → ONE confirmed role (pending) ----
    const decideAndTeam = async (companyName: string, accept: boolean) => {
      const p = (await db.query<{ id: string }>(
        `select pu.id from pursuits pu join companies c on c.id = pu.account_id
          where pu.org_id=$1 and c.legal_name ilike $2 and pu.product_category_id=$3
            and pu.status not in ('WON','LOST','DISQUALIFIED') limit 1`, [org, companyName + "%", node])).rows[0];
      if (!p) { console.log(`  · ${companyName}: no live pursuit — skipped`); return; }
      const snap = (await db.query<{ id: string; route_status: string }>(
        `select id, route_status from pursuit_route_snapshots where pursuit_id=$1 and is_current`, [p.id])).rows[0];
      if (!snap) { console.log(`  · ${companyName}: no route snapshot — skipped`); return; }
      if (snap.route_status !== "SELECTED") {
        const cand = (await db.query<{ id: string }>(
          `select id from route_candidates where route_snapshot_id=$1 and is_recommended and not disqualified limit 1`, [snap.id])).rows[0]
          ?? (await db.query<{ id: string }>(`select id from route_candidates where route_snapshot_id=$1 and partner_id is not null and not disqualified order by rank limit 1`, [snap.id])).rows[0];
        if (!cand) { console.log(`  · ${companyName}: no viable candidate — skipped`); return; }
        await tx(pool, org, (c) => dispatchSkill(c, "select_partner_route", actor, {
          pursuitId: p.id, args: { candidateKey: cand.id }, dataEnvironment: "DEMO",
          idempotencyKey: `demo-intel:${p.id}:route` }));
      }
      const members = (await db.query<{ id: string; role: string }>(
        `select id, role from pursuit_team_members where pursuit_id=$1 and status='RECOMMENDED'
          and role in ('VENDOR_ACCOUNT_EXECUTIVE','PARTNER_ACCOUNT_MANAGER') order by role asc`, [p.id])).rows;
      for (const [i, m] of members.entries()) {
        await tx(pool, org, (c) => dispatchSkill(c, "confirm_team_member", actor, { pursuitId: p.id, args: { memberId: m.id }, dataEnvironment: "DEMO" }));
        if (accept || i > 0) {   // pending story keeps exactly ONE invitation open (the first role)
          await tx(pool, org, (c) => dispatchSkill(c, "accept_team_member", actor, { pursuitId: p.id, args: { memberId: m.id }, dataEnvironment: "DEMO" }));
        }
      }
      console.log(`  · ${companyName}: route decided, team ${accept ? "accepted" : "1 role pending acceptance"}`);
    };
    await decideAndTeam("Initech", false);   // ⇒ ACCEPTANCE_PENDING (nearly-ready + Today aggregate)
    await decideAndTeam("Umbrella", true);   // ⇒ team ready (second execution-ready if gates hold)

    // ---- 2a. CDW presence breadth: a customer list covering the demo book (list truth only) ----
    const listId = (await db.query<{ id: string }>(
      `insert into account_populations (org_id, partner_id, name, category, status)
       values ($1,$2,'CDW installed base (synthetic)','customer','approved') returning id`, [org, cdw])).rows[0].id;
    const cos = (await db.query<{ id: string }>(
      `select distinct c.id from companies c join propensity_scores p on p.company_id = c.id
        where p.taxonomy_node_id = $1 limit 12`, [node])).rows;
    for (const c of cos) {
      await db.query(`insert into population_members (population_id, company_id) values ($1,$2) on conflict do nothing`, [listId, c.id]);
      await db.query(
        `insert into partner_relationships (partner_id, company_id, strength, tenure_months)
         values ($1,$2,45,18) on conflict (partner_id, company_id) do nothing`, [cdw, c.id]);
    }
    console.log(`  · CDW: presence on ${cos.length} accounts (customer list + modest asserted relationships)`);

    // ---- 2b. CDW execution evidence: two modest closed pursuits with canonical outcomes ----------
    // Recorded through the real helpers (outcome + honest INFLUENCED attribution, DEMO/simulated).
    const sentinel = (await db.query<{ id: string }>(
      `insert into companies (legal_name, normalized_name, primary_domain) values ($1,'intel story sentinel co','intel-sentinel.example') returning id`, [SENTINEL])).rows[0].id;
    for (const [i, name] of [["CDW win A (synthetic)"], ["CDW win B (synthetic)"]].map((x, i) => [i, x[0]] as const)) {
      const co2 = (await db.query<{ id: string }>(
        `insert into companies (legal_name, normalized_name, primary_domain) values ($1,$2,$3) returning id`,
        [name, name.toLowerCase(), `cdw-win-${i}.example`])).rows[0].id;
      const pu = await tx(pool, org, (c) => upsertPursuit(c, {
        orgId: org, accountId: co2, productCategoryId: node, pursuitType: "NET_NEW",
        useCase: "virtualization exit (synthetic history)", businessProblem: "Synthetic CDW execution history",
        createdVia: "SYSTEM_DETECTED", dataEnvironment: "DEMO",
      }));
      await db.query(`update pursuits set selected_partner_id=$2, status='WON' where id=$1`, [pu.id, cdw]);
      await tx(pool, org, async (c) => {
        const oc = await recordOutcome(c, { orgId: org, pursuitId: pu.id, label: "CLOSED_WON", valueAmount: 120_000, occurredAt: new Date(Date.now() - (200 - i * 40) * 86_400_000), dataEnvironment: "DEMO", isSimulated: true, sourceRef: `demo-intel:cdw-win:${i}` });
        const at = await recordAttribution(c, { orgId: org, pursuitId: pu.id, outcomeId: oc, subjectKind: "PARTNER", subjectId: cdw, subjectLabel: "CDW", attributionClass: "INFLUENCED", modelVersion: "outcome-bridge/v1", reason: "Selected partner route at close (synthetic history)", evidence: { synthetic: true }, dataEnvironment: "DEMO", isSimulated: true });
        await c.query(`update pursuit_outcomes set attribution_id=$2 where id=$1`, [oc, at]);
      });
    }
    console.log("  · CDW: 2 canonical CLOSED_WON with INFLUENCED attribution (synthetic history — WWT still leads activation)");
    void sentinel;
    console.log("[demo-intel-story] done — funnel variety + partner presence-vs-execution disagreement (all DEMO/synthetic).");
  } finally {
    db.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
