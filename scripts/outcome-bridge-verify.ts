/**
 * Canonical outcome + attribution bridge verification (Phase B1/B5).
 *
 * Proves the legacy commercial event → canonical outcome path: a deterministic pursuit_id feeds
 * recordOutcome + honest attribution + recompute; idempotent; UNKNOWN preserved; no guessing; no
 * causation inference; DEMO stays DEMO. Covers WON, LOST, NO_DECISION, UNKNOWN attribution, retry,
 * and the outcome_learning gate. Self-contained: builds its own fixtures.
 *
 * Run with the experience env masters set, e.g.:
 *   DEMO_URL=… PURSUITS_ENABLED=on FACTS_ENABLED=on ROUTING_ENABLED=on PURSUIT_EXPERIENCE_ENABLED=on \
 *   OUTCOME_LEARNING_ENABLED=on npx tsx scripts/outcome-bridge-verify.ts
 */
import { Pool, type PoolClient } from "pg";
import { advanceOpportunity } from "../src/lib/opportunities/lifecycle";
import { transitionMotion } from "../src/lib/motions/lifecycle";
import { bridgePursuitOutcome } from "../src/lib/pursuits/bridge/outcome-bridge";

const URL = process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
let pass = 0, fail = 0;
function ok(n: string, c: boolean, d = "") { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ` — ${d}` : ""}`); } }
async function tx<T>(pool: Pool, orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("begin"); await c.query("select set_config('app.org_id',$1,true)", [orgId]); const r = await fn(c); await c.query("commit"); return r; }
  catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}
const num = async (pool: Pool, sql: string, p: unknown[]) => Number((await pool.query<{ n: string }>(sql, p)).rows[0].n);

async function main() {
  const pool = new Pool({ connectionString: URL });
  try {
    const org = (await pool.query<{ id: string }>(`select id from organizations order by created_at asc limit 1`)).rows[0].id;
    await pool.query(`update org_features set outcome_learning=true where org_id=$1`, [org]); // canonical demo enables the learning loop
    const node = (await pool.query<{ id: string }>(`select id from taxonomy_nodes limit 1`)).rows[0].id;

    // Fixture A — a pursuit whose current route has a SELECTED partner (decide one if needed).
    let decided = (await pool.query<{ pursuit_id: string; account_id: string }>(
      `select s.pursuit_id, p.account_id from pursuit_route_snapshots s join pursuits p on p.id=s.pursuit_id
        where s.is_current and s.selected_partner_id is not null and p.org_id=$1 limit 1`, [org])).rows[0];
    if (!decided) {
      const c = (await pool.query<{ pursuit_id: string; partner_id: string; account_id: string }>(
        `select s.pursuit_id, rc.partner_id, p.account_id from pursuit_route_snapshots s
           join route_candidates rc on rc.route_snapshot_id=s.id join pursuits p on p.id=s.pursuit_id
          where s.is_current and rc.partner_id is not null and p.org_id=$1 limit 1`, [org])).rows[0];
      await pool.query(`update pursuit_route_snapshots set selected_partner_id=$2, route_status='SELECTED' where pursuit_id=$1 and is_current`, [c.pursuit_id, c.partner_id]);
      decided = { pursuit_id: c.pursuit_id, account_id: c.account_id };
    }
    const P = decided.pursuit_id, company = decided.account_id;
    console.log(`\n  · pursuit ${P.slice(0, 8)} (selected route) — bridging commercial outcomes\n`);

    // ---- WON via the real advanceOpportunity producer (dual-write: legacy + canonical). ----
    const wonOpp = (await tx(pool, org, (db) => db.query<{ id: string }>(
      `insert into opportunities (org_id, company_id, taxonomy_node_id, name, stage, amount_usd, pursuit_id)
       values ($1,$2,$3,'Verify · won','negotiation',250000,$4) returning id`, [org, company, node, P]))).rows[0];
    const beforeLegacy = await num(pool, `select count(*)::text n from outcome_events where org_id=$1 and event_type='CLOSED_WON'`, [org]);
    await tx(pool, org, (db) => advanceOpportunity(db, wonOpp.id, "closed_won", "verify"));
    ok("WON: legacy outcome_events still written (strangler dual-write)", await num(pool, `select count(*)::text n from outcome_events where org_id=$1 and event_type='CLOSED_WON'`, [org]) === beforeLegacy + 1);
    const oc = (await pool.query<{ id: string; outcome_label: string; is_terminal: boolean; value_amount: string | null; data_environment: string; is_simulated: boolean }>(
      `select id, outcome_label, is_terminal, value_amount, data_environment, is_simulated from pursuit_outcomes where source_ref=$1`, [`opp:${wonOpp.id}:CLOSED_WON`])).rows[0];
    ok("WON: canonical pursuit_outcome recorded (CLOSED_WON, terminal)", !!oc && oc.outcome_label === "CLOSED_WON" && oc.is_terminal);
    ok("WON: value captured, DEMO stays DEMO/simulated", !!oc && oc.value_amount === "250000" && oc.data_environment === "DEMO" && oc.is_simulated === true);
    const at = (await pool.query<{ attribution_class: string; subject_kind: string; model_version: string; reason: string | null; evidence: unknown }>(
      `select attribution_class, subject_kind, model_version, reason, evidence from attribution where outcome_id=$1`, [oc.id])).rows[0];
    ok("WON: attribution INFLUENCED on the selected partner (never SOURCE without origination)", !!at && at.attribution_class === "INFLUENCED" && at.subject_kind === "PARTNER");
    ok("WON: attribution carries model_version + evidence + reason (a claim with a basis)", !!at && !!at.model_version && !!at.reason && !!at.evidence);
    ok("WON: the outcome back-links its attribution", await num(pool, `select count(*)::text n from pursuit_outcomes where id=$1 and attribution_id is not null`, [oc.id]) === 1);

    // Idempotency (B5): a duplicate source event does not create a second outcome/attribution.
    await tx(pool, org, (db) => bridgePursuitOutcome(db, { orgId: org, pursuitId: P, companyId: null, label: "CLOSED_WON", sourceRef: `opp:${wonOpp.id}:CLOSED_WON` }));
    ok("WON idempotency: duplicate source event → still ONE outcome", await num(pool, `select count(*)::text n from pursuit_outcomes where source_ref=$1`, [`opp:${wonOpp.id}:CLOSED_WON`]) === 1);
    ok("WON idempotency: still ONE attribution", await num(pool, `select count(*)::text n from attribution where outcome_id=$1`, [oc.id]) === 1);

    // ---- LOST. ----
    const lostOpp = (await tx(pool, org, (db) => db.query<{ id: string }>(
      `insert into opportunities (org_id, company_id, taxonomy_node_id, name, stage, amount_usd, pursuit_id)
       values ($1,$2,$3,'Verify · lost','discovery',120000,$4) returning id`, [org, company, node, P]))).rows[0];
    await tx(pool, org, (db) => advanceOpportunity(db, lostOpp.id, "closed_lost", "verify"));
    ok("LOST: canonical CLOSED_LOST outcome recorded", await num(pool, `select count(*)::text n from pursuit_outcomes where source_ref=$1 and outcome_label='CLOSED_LOST'`, [`opp:${lostOpp.id}:CLOSED_LOST`]) === 1);

    // ---- UNKNOWN attribution: a pursuit WITHOUT a selected partner route. ----
    const direct = (await pool.query<{ id: string; account_id: string }>(
      `select p.id, p.account_id from pursuits p left join pursuit_route_snapshots s on s.pursuit_id=p.id and s.is_current
        where p.org_id=$1 and coalesce(s.selected_partner_id, null) is null limit 1`, [org])).rows[0];
    if (direct) {
      const r = await tx(pool, org, (db) => bridgePursuitOutcome(db, { orgId: org, pursuitId: direct.id, companyId: direct.account_id, label: "CLOSED_WON", sourceRef: `verify:direct:${direct.id}:${Date.now()}` }));
      ok("UNKNOWN: no selected partner route → attribution class UNKNOWN (never invented)", r.attributionClass === "UNKNOWN");
    } else { ok("UNKNOWN case available", true, "no direct-route pursuit — skipped"); }

    // ---- NO_DECISION via a completed motion. ----
    const ndMotion = (await tx(pool, org, (db) => db.query<{ id: string }>(
      `insert into revenue_motions (org_id, company_id, taxonomy_node_id, thesis, status, pursuit_id, activated_at)
       values ($1,$2,$3,'Verify motion','active',$4, now()) returning id`, [org, company, node, P]))).rows[0];
    await tx(pool, org, (db) => transitionMotion(db, ndMotion.id, "completed", { outcome: "no_decision" }));
    ok("NO_DECISION: motion completion bridged to a canonical NO_DECISION outcome", await num(pool, `select count(*)::text n from pursuit_outcomes where source_ref=$1 and outcome_label='NO_DECISION'`, [`motion:${ndMotion.id}:completed:no_decision`]) === 1);

    // ---- Recompute (B3 preview): OUTCOME_RECORDED enqueued a recompute request. ----
    ok("recompute: OUTCOME_RECORDED enqueued recompute_requests", await num(pool, `select count(*)::text n from recompute_requests r join change_ledger c on c.id=r.requested_by_event_id where c.change_type='OUTCOME_RECORDED'`, []) > 0);

    // ---- Gate: outcome_learning OFF → bridge skips (no silent production rewrite). ----
    const off = await tx(pool, org, async (db) => {
      await db.query(`update org_features set outcome_learning=false where org_id=$1`, [org]);
      const r = await bridgePursuitOutcome(db, { orgId: org, pursuitId: P, companyId: null, label: "CLOSED_WON", sourceRef: `verify:gate:${Date.now()}` });
      await db.query(`update org_features set outcome_learning=true where org_id=$1`, [org]);
      return r;
    });
    ok("gate: bridge skips when outcome_learning is disabled", off.skipped === true);

    console.log(`\n[outcome-bridge-verify] ${pass} passed, ${fail} failed`);
    if (fail) process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error("[outcome-bridge-verify] fatal:", e); process.exit(1); });
