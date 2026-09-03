/**
 * Demo breadth enrichment (Pilot Commissioning). ADDITIVE — layers coherent, internally
 * consistent SYNTHETIC commercial data on top of the canonical demo-db.ts hero so the
 * breadth screens (Accounts, Pipeline, Pursuits, Today, Analytics, Campaigns) feel
 * populated and alive. The Globex virtualization hero is left exactly as demo-db built it.
 *
 * Everything here is DEMO / is_simulated and clearly labeled in the product. No external
 * side effect is created; this only writes local demo rows. Run AFTER scripts/demo-db.ts:
 *   npx tsx scripts/demo-enrich.ts
 *
 * Idempotent guard: re-running is a no-op once the sentinel account exists.
 */
import { Pool, type PoolClient } from "pg";
import { upsertPursuit } from "../src/lib/pursuits/model";
import { recordOutcome, recordAttribution } from "../src/lib/pursuits/federation/outcomes";

const URL = process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const pool = new Pool({ connectionString: URL, max: 1 });

// A coherent synthetic book of business. Each account reconciles across Accounts (score),
// Pipeline (opportunity), and Pursuits. Values are illustrative only.
const ACCOUNTS: Array<{ name: string; industry: string; score: number; band: string; opps: Array<{ name: string; stage: string; amt: number }>; pursuit?: { use: string; problem: string; type: string; prio: number; prop: number; ev: number; tim: number; ev_w: number } }> = [
  { name: "Umbrella Health Systems", industry: "Healthcare", score: 88, band: "very_high",
    opps: [{ name: "Backup modernization", stage: "qualification", amt: 260000 }],  // "Datacenter exit — phase 1" belongs to the narrative layer
    pursuit: { use: "virtualization exit", problem: "Renewal-driven hypervisor migration across 9 hospitals", type: "MODERNIZATION", prio: 84, prop: 79, ev: 72, tim: 68, ev_w: 1180000 } },
  // Stark's deal is authored by the narrative layer as "Sovereign landing zone"
  // ($1.45M, business_validation). This layer used to author the SAME deal under
  // a second name, "Hybrid cloud landing zone", for the same account and the
  // same $1.45M — so a clean build gave Stark two identical deals and $2.9M open
  // where the itinerary says one deal at $1.45M. Deduplication by name cannot
  // catch that; only ownership can. The narrative layer owns the hero deals
  // (Wave 6C §4/§5). The pursuit here is harmless — `upsertPursuit` keys on
  // (account, use_case) and demo-stories runs after this, so its timing=null
  // ("UNKNOWN", the point of the Stark story) is what survives.
  { name: "Stark Industries LLC", industry: "Aerospace & Defense", score: 81, band: "very_high",
    opps: [],
    pursuit: { use: "platform modernization", problem: "Sovereign workloads leaving legacy virtualization", type: "MODERNIZATION", prio: 80, prop: 74, ev: 70, tim: 61, ev_w: 1450000 } },
  { name: "Wayne Enterprises", industry: "Manufacturing", score: 74, band: "high",
    opps: [{ name: "Container platform expansion", stage: "qualification", amt: 540000 }],  // "VMware alternative pilot" belongs to the narrative layer
    pursuit: { use: "virtualization exit", problem: "Cost pressure after licensing change", type: "MODERNIZATION", prio: 71, prop: 66, ev: 58, tim: 55, ev_w: 620000 } },
  { name: "Hooli Cloud", industry: "Technology", score: 69, band: "high",
    opps: [{ name: "Kubernetes managed services", stage: "negotiation", amt: 710000 }],
    pursuit: { use: "ai platform", problem: "GPU platform standardization", type: "EXPANSION", prio: 67, prop: 70, ev: 55, tim: 60, ev_w: 710000 } },
  { name: "Soylent Foods Co.", industry: "Consumer Goods", score: 58, band: "medium",
    opps: [{ name: "Edge compute refresh", stage: "discovery", amt: 210000 }],
    pursuit: { use: "edge modernization", problem: "Plant-floor compute refresh", type: "NET_NEW", prio: 55, prop: 52, ev: 44, tim: 40, ev_w: 210000 } },
  // Same as Stark: the narrative layer authors Acme's deal as "Incumbent
  // displacement" ($540K), and this layer authored the same deal as "Automation
  // platform build" ($430K) on the same account.
  { name: "Acme Robotics", industry: "Industrial Automation", score: 63, band: "high",
    opps: [],
    pursuit: { use: "platform modernization", problem: "Legacy control-plane replacement", type: "MODERNIZATION", prio: 61, prop: 57, ev: 49, tim: 47, ev_w: 430000 } },
  { name: "Initech Financial (expansion)", industry: "Financial Services", score: 77, band: "high",
    opps: [{ name: "Core banking resilience", stage: "proposal", amt: 990000 }],  // "DR site build-out" belongs to the narrative layer
    pursuit: { use: "resilience modernization", problem: "Regulatory DR posture upgrade", type: "EXPANSION", prio: 75, prop: 72, ev: 66, tim: 63, ev_w: 990000 } },
];

const DIMS: Record<string, (a: typeof ACCOUNTS[number]) => number> = {
  purchase_need: (a) => Math.min(100, a.score + 4), purchase_propensity: (a) => a.score,
  timing: (a) => Math.max(20, a.score - 12), evidence_confidence: (a) => Math.max(30, a.score - 8),
  solution_fit: (a) => Math.min(100, a.score + 2), corroboration: (a) => Math.max(25, a.score - 15),
  convergence: (a) => Math.max(20, a.score - 20), activation_probability: (a) => Math.max(30, a.score - 6),
};

async function tx<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("begin"); const r = await fn(c); await c.query("commit"); return r; }
  catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}

async function main() {
  console.log("[demo-enrich] additive synthetic breadth →", URL.replace(/:[^:@/]*@/, ":***@"));
  const ctx = await tx(async (db) => {
    const vendor = (await db.query<{ id: string }>(`select id from organizations where name='Vertex Systems' order by created_at asc limit 1`)).rows[0]?.id;
    const node = (await db.query<{ id: string }>(`select id from taxonomy_nodes where slug='virtualization' limit 1`)).rows[0]?.id;
    if (!vendor || !node) throw new Error("run scripts/demo-db.ts first (vendor/node missing)");
    const sentinel = (await db.query(`select 1 from companies where legal_name='Umbrella Health Systems'`)).rowCount;
    let versionId = (await db.query<{ id: string }>(`select id from score_versions limit 1`)).rows[0]?.id;
    if (!versionId) versionId = (await db.query<{ id: string }>(`insert into score_versions (label, description, weights) values ('demo-v1','Illustrative synthetic scoring', '{}'::jsonb) returning id`)).rows[0].id;
    return { vendor, node, versionId, already: !!sentinel };
  });
  if (ctx.already) { console.log("[demo-enrich] sentinel present — already enriched, no-op."); await pool.end(); return; }

  let accounts = 0, opps = 0, pursuits = 0, outcomes = 0;
  for (const a of ACCOUNTS) {
    await tx(async (db) => {
      await db.query("select set_config('app.org_id',$1,true)", [ctx.vendor]);
      const companyId = (await (async () => {
          /* Wave 6C §4 — reuse, do not fork. `companies.legal_name` carries no
             unique constraint, and demo-db, demo-stories and demo-enrich all
             create overlapping hero accounts. A bare insert therefore produced
             a SECOND "Umbrella Health Systems" on every clean build, and the
             lifecycle/value/stakeholder suites then read whichever row they
             happened to match. The itinerary's reconciliation spine requires
             one account per hero — "one pursuit, one route snapshot" — so the
             layer takes the existing row when there is one. */
          const found = await db.query<{ id: string }>(`select id from companies where legal_name = $1 limit 1`, [a.name]);
          if (found.rows[0]) return found;
          return db.query<{ id: string }>(`insert into companies (legal_name, normalized_name, industry, country) values ($1,$1,$2,'US') returning id`, [a.name, a.industry]);
        })()).rows[0].id;
      // verified evidence (drives the Accounts evidence count + Sources/Trust provenance)
      for (const claim of [`${a.name} shows a modernization initiative in category.`, `${a.name} renewal window opening within 2 quarters.`])
        await db.query(`insert into evidence (org_id, company_id, source_type, claim, confidence, observed_at, status, computed_confidence, first_party) values ($1,$2,'crm',$3,0.8,now(),'verified',0.8,true)`, [ctx.vendor, companyId, claim]);
      // propensity score + dimensions (Accounts screen)
      const scoreId = (await db.query<{ id: string }>(
        `insert into propensity_scores (org_id, company_id, taxonomy_node_id, score, band, score_version_id, computed_at, positive_points, negative_points)
         values ($1,$2,$3,$4,$5,$6, now(), 3, 1) returning id`, [ctx.vendor, companyId, ctx.node, a.score, a.band, ctx.versionId])).rows[0].id;
      for (const [dim, f] of Object.entries(DIMS))
        await db.query(`insert into propensity_dimensions (score_id, dimension, value) values ($1,$2,$3)`, [scoreId, dim, f(a)]);
      accounts++;
      // Opportunities (Pipeline screen + Accounts open-opps rollup).
      //
      // Guarded on (account, name), the way the flagship reconciliation in
      // demo-stories.ts already is. This layer is additive and re-runnable, and
      // an account named here can also be named by demo-stories — unguarded,
      // that produced a second "Datacenter exit — phase 1" on the same company
      // and pushed the goal's opportunity roll-up from $3.67M to $6.55M without
      // anyone authoring a deal (Wave 6C §4).
      for (const o of a.opps) {
        const dup = await db.query(`select 1 from opportunities where company_id = $1 and name = $2`, [companyId, o.name]);
        if (dup.rowCount) continue;
        await db.query(`insert into opportunities (org_id, company_id, taxonomy_node_id, name, stage, amount_usd, next_step, expected_close_date)
          values ($1,$2,$3,$4,$5,$6,$7, now() + (interval '1 day' * $8))`,
          [ctx.vendor, companyId, ctx.node, o.name, o.stage, o.amt, o.stage === "closed_won" ? "Won — expand" : "Advance to next stage", 20 + opps * 9]);
        opps++;
      }
      // a scored pursuit per account (Pursuits + Today portfolio)
      if (a.pursuit) {
        const p = await upsertPursuit(db, { orgId: ctx.vendor, accountId: companyId, productCategoryId: ctx.node, pursuitType: a.pursuit.type as never, useCase: a.pursuit.use, businessProblem: a.pursuit.problem, createdVia: "SYSTEM_DETECTED", dataEnvironment: "DEMO" });
        await db.query(`update pursuits set current_priority_score=$2, current_purchase_propensity_score=$3, current_evidence_confidence_score=$4, current_timing_score=$5, expected_value_weighted=$6, expected_value_currency='USD', data_environment='DEMO' where id=$1`,
          [p.id, a.pursuit.prio, a.pursuit.prop, a.pursuit.ev, a.pursuit.tim, a.pursuit.ev_w]);
        pursuits++;
        // a couple of closed/again outcomes for Analytics + Today recent activity
        if (a.band === "very_high" || a.name.startsWith("Initech")) {
          const oid = await recordOutcome(db, { orgId: ctx.vendor, pursuitId: p.id, label: a.name.startsWith("Initech") ? "CLOSED_WON" : "MEETING_BOOKED", valueAmount: a.name.startsWith("Initech") ? 350000 : null, occurredAt: new Date(Date.now() - 2 * 86400000), dataEnvironment: "DEMO", isSimulated: true });
          if (a.name.startsWith("Initech")) await recordAttribution(db, { orgId: ctx.vendor, pursuitId: p.id, outcomeId: oid, subjectKind: "PARTNER", subjectLabel: "CDW", attributionClass: "INFLUENCED", modelVersion: "attr-v1", evidence: { via: "co-sell adjacency" }, dataEnvironment: "DEMO", isSimulated: true });
          outcomes++;
        }
      }
    });
  }
  console.log(`[demo-enrich] +${accounts} scored accounts · +${opps} opportunities · +${pursuits} pursuits · +${outcomes} outcomes (all DEMO/synthetic)`);
  await pool.end();
}
main().catch((e) => { console.error("[demo-enrich] fatal:", e); pool.end(); process.exit(1); });
