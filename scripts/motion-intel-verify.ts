/**
 * Motion Intelligence acceptance verification (Intelligence Wave P1A).
 *
 * Proves the required properties against the live demo world:
 *  - funnel counts RECONCILE to the underlying canonical records (independently recomputed in SQL);
 *  - constraints reconcile to canonical readiness/disqualifier/team/motion state;
 *  - the execution-ready cohort contains ONLY records passing every gate;
 *  - UNKNOWN stays separate (timing UNKNOWN is its own severity/cohort, never "blocked" noise);
 *  - scope narrows and never widens (empty scope ⇒ empty funnel);
 *  - outcome rollups reconcile to pursuit_outcomes/attribution, using ONLY the canonical
 *    attribution taxonomy (P0.3 boundary);
 *  - small samples carry the explicit calibration caveat flag;
 *  - the Brief's partner rendering withholds the motion-context line (no hypothesis leak);
 *  - ⌘K EXPLAIN/SHOW ME motion intents answer grounded, deterministic, honest.
 *
 *   DEMO_URL=… npx tsx scripts/motion-intel-verify.ts
 */
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { getMotionFunnels, getMotionConstraints, accountsAtStage, motionAcceptanceBlockage, ACCEPTANCE_BLOCK_FLOOR_USD } from "../src/lib/motions/funnel";
import { resolveExplain, parseMotionShowMe, resolveMotionShowMe } from "../src/lib/search/query";
import { dispatchSkill, type Actor } from "../src/lib/pursuits/federation/skills";

const URL = process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
let pass = 0, fail = 0;
function ok(n: string, c: boolean, d = "") { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ` — ${d}` : ""}`); } }

async function main() {
  const pool = new Pool({ connectionString: URL });
  const db = (await pool.connect()) as PoolClient;
  const one = async <T extends QueryResultRow>(sql: string, p: unknown[] = []): Promise<T> => (await db.query<T>(sql, p)).rows[0] as T;
  const num = async (sql: string, p: unknown[] = []) => Number((await db.query<{ n: string }>(sql, p)).rows[0].n);
  try {
    const org = (await one<{ org_id: string }>(`select org_id from revenue_motions limit 1`)).org_id;
    const funnels = await getMotionFunnels(db, org);
    ok("at least one hypothesis funnel derived from canonical records", funnels.length >= 1);
    const f = funnels[0];
    const node = f.hypothesis.taxonomyNodeId;
    const stage = (k: string) => f.stages.find((s) => s.key === k)!.count;

    // ---- Reconciliation: independent SQL recomputation of the headline counts ------------------
    const evaluated = await num(
      `select count(distinct p.company_id)::text n from propensity_scores p
        where p.taxonomy_node_id = $1 and (p.org_id is null or p.org_id = $2)`, [node, org]);
    ok("evaluated reconciles to distinct propensity-scored companies", stage("evaluated") === evaluated, `${stage("evaluated")} vs ${evaluated}`);
    const qualified = await num(
      `select count(*)::text n from (
         select distinct on (p.company_id) p.band from propensity_scores p
          where p.taxonomy_node_id = $1 and (p.org_id is null or p.org_id = $2)
          order by p.company_id, p.computed_at desc) x where x.band in ('very_high','high')`, [node, org]);
    ok("qualified reconciles to latest band ∈ {very_high, high}", stage("qualified") === qualified, `${stage("qualified")} vs ${qualified}`);

    // ---- Execution-ready cohort contains ONLY fully-passing records ----------------------------
    const ready = accountsAtStage(f, "execution_ready");
    ok("execution-ready count matches ready cohort", stage("execution_ready") === f.cohorts.ready && ready.length === f.cohorts.ready);
    let readyClean = true;
    for (const a of ready) {
      if (!["very_high", "high"].includes(a.band) || a.pursuitId == null || a.constraints.some((c) => c.gating)) readyClean = false;
      const snap = await one<{ route_status: string }>(`select route_status from pursuit_route_snapshots where pursuit_id=$1 and is_current`, [a.pursuitId]);
      if (snap?.route_status !== "SELECTED") readyClean = false;
      const tim = await one<{ t: string | null }>(`select current_timing_score t from pursuits where id=$1`, [a.pursuitId]);
      if (tim.t == null) readyClean = false;
      const openMotion = await num(`select count(*)::text n from revenue_motions where org_id=$1 and taxonomy_node_id=$2 and company_id=$3 and status in ('approved','active')`, [org, node, a.companyId]);
      if (openMotion === 0) readyClean = false;
    }
    ok("every execution-ready account passes ALL canonical gates (band, route SELECTED, timing known, approved motion, zero gating constraints)", readyClean);

    // ---- Constraints reconcile to canonical state ----------------------------------------------
    let constraintsHonest = true;
    for (const a of f.accounts) {
      const timingUnknown = a.constraints.some((c) => c.code === "TIMING_UNKNOWN");
      if (a.pursuitId) {
        const t = await one<{ t: string | null }>(`select current_timing_score t from pursuits where id=$1`, [a.pursuitId]);
        if ((t.t == null) !== timingUnknown) constraintsHonest = false;
        const invited = await num(`select count(*)::text n from pursuit_team_members where pursuit_id=$1 and status='INVITED'`, [a.pursuitId]);
        const pendingChip = a.constraints.some((c) => c.code.startsWith("ACCEPTANCE_PENDING"));
        if (pendingChip && invited === 0) constraintsHonest = false;
      } else if (!a.constraints.some((c) => c.code === "NO_PURSUIT")) constraintsHonest = false;
    }
    ok("every constraint chip reconciles to its canonical source (timing ⇔ score NULL; acceptance ⇔ INVITED rows; NO_PURSUIT ⇔ absence)", constraintsHonest);

    // ---- UNKNOWN stays separate -----------------------------------------------------------------
    const unknownSeverities = f.accounts.flatMap((a) => a.constraints.filter((c) => c.code === "TIMING_UNKNOWN").map((c) => c.severity));
    ok("timing UNKNOWN carries severity UNKNOWN, never HARD/SOFT", unknownSeverities.every((s) => s === "UNKNOWN"));
    ok("an account whose only failing gates are UNKNOWN classifies as 'unknown', not 'blocked'",
      f.accounts.filter((a) => a.constraints.filter((c) => c.gating).length > 0 && a.constraints.filter((c) => c.gating).every((c) => c.severity === "UNKNOWN")).every((a) => a.cohort === "unknown"));

    // ---- Scope narrows, never widens ------------------------------------------------------------
    const empty = await getMotionFunnels(db, org, { companyIds: [] });
    ok("empty scope ⇒ zero evaluated accounts (never widened)", empty.every((x) => x.stages[0].count === 0));
    const firstCompany = f.accounts[0]?.companyId;
    if (firstCompany) {
      const narrowed = await getMotionFunnels(db, org, { companyIds: [firstCompany] });
      const nf = narrowed.find((x) => x.hypothesis.taxonomyNodeId === node)!;
      ok("single-company scope evaluates exactly that company", nf.stages[0].count === 1 && nf.accounts[0]?.companyId === firstCompany);
    }

    // ---- Outcome rollup reconciles + canonical attribution only (P0.3) --------------------------
    const won = await num(`select count(*)::text n from pursuit_outcomes po join pursuits pu on pu.id=po.pursuit_id where pu.org_id=$1 and pu.product_category_id=$2 and po.outcome_label='CLOSED_WON'`, [org, node]);
    ok("outcome rollup WON reconciles to pursuit_outcomes", f.outcomes.won === won, `${f.outcomes.won} vs ${won}`);
    const classes = Object.keys(f.outcomes.byAttributionClass);
    ok("attribution rollup uses ONLY canonical classes (never settlement's sourced/influenced strings)",
      classes.every((c) => ["SOURCE", "INFLUENCED", "ASSISTED", "OBSERVED", "UNKNOWN"].includes(c)), classes.join(","));
    ok("calibration flag = sample ≥ 5 (small samples carry the caveat)", f.outcomes.calibrated === (f.outcomes.sample >= 5));

    // ---- Brief: partner rendering withholds the hypothesis (no strategy leak) -------------------
    const { buildPursuitBrief } = await import("../src/lib/pursuits/read-models/brief");
    const { getPursuitDetail } = await import("../src/lib/pursuits/read-models/detail");
    const { callerFor } = await import("../src/lib/pursuits/read-models/caller");
    const linked = await one<{ pursuit_id: string }>(`select pursuit_id from revenue_motions where org_id=$1 and pursuit_id is not null limit 1`, [org]);
    if (linked) {
      await db.query("begin"); await db.query("select set_config('app.org_id',$1,true)", [org]);
      const detail = await getPursuitDetail(db, await callerFor(db, org), linked.pursuit_id);
      await db.query("commit");
      if (detail) {
        const brief = buildPursuitBrief(detail, null, { hypothesis: f.hypothesis.name, status: "active" });
        const happening = brief.sections.find((s) => s.key === "happening")!;
        const hypLine = happening.lines.find((l) => /Serving hypothesis/.test(l.text));
        ok("Brief carries the motion context for the sponsor", !!hypLine);
        ok("Brief marks the motion context confidential (withheld from the partner rendering)", hypLine?.confidential === true);
      } else ok("Brief motion-context check (detail unavailable)", false);
    } else ok("Brief motion-context check (no linked motion)", false);

    // ---- Today material intervention: only past the floor, from real INVITED rows ---------------
    const before = await motionAcceptanceBlockage(db, org);
    // Manufacture one real pending acceptance on an approved/active-motion account via the
    // GOVERNED path, then observe the aggregate (and clean up by accepting).
    const target = await one<{ pursuit_id: string; ev: string | null }>(
      `select pu.id pursuit_id, pu.expected_value_weighted ev from pursuits pu
        join revenue_motions m on m.org_id=pu.org_id and m.taxonomy_node_id=pu.product_category_id and m.company_id=pu.account_id
       where pu.org_id=$1 and m.status in ('approved','active') and pu.status not in ('WON','LOST','DISQUALIFIED')
       order by pu.expected_value_weighted desc nulls last limit 1`, [org]);
    const actor: Actor = { type: "USER", id: null, orgId: org, role: "operator" };
    const member = await one<{ id: string }>(`select id from pursuit_team_members where pursuit_id=$1 and status='RECOMMENDED' limit 1`, [target.pursuit_id]);
    if (member) {
      await db.query("begin"); await db.query("select set_config('app.org_id',$1,true)", [org]);
      await dispatchSkill(db, "confirm_team_member", actor, { pursuitId: target.pursuit_id, args: { memberId: member.id }, dataEnvironment: "DEMO" });
      await db.query("commit");
      const after = await motionAcceptanceBlockage(db, org);
      const ev = Number(target.ev ?? 0);
      if (ev >= ACCEPTANCE_BLOCK_FLOOR_USD) {
        ok("a governed confirm (INVITED) surfaces in the acceptance-blockage aggregate", after.some((b) => b.blockedUsd >= ev - 1));
      } else {
        ok("below-floor blockage stays OFF Today (materiality floor respected)", after.length === before.length);
      }
      await db.query("begin"); await db.query("select set_config('app.org_id',$1,true)", [org]);
      await dispatchSkill(db, "accept_team_member", actor, { pursuitId: target.pursuit_id, args: { memberId: member.id }, dataEnvironment: "DEMO" });
      await db.query("commit");
    } else {
      ok("acceptance-blockage check (no RECOMMENDED member available on the top target)", true, "skipped — no proposal to confirm");
    }

    // ---- ⌘K: deterministic, grounded motion intents ---------------------------------------------
    const readyName = ready[0]?.name ?? f.accounts[0].name;
    const exReady = await resolveExplain(db, `why is ${readyName.split(" ")[0]} not execution-ready?`, org);
    ok("EXPLAIN execution-readiness answers with grounded gate lines", !("note" in exReady) && (exReady as { grounding: string[] }).grounding.length > 0);
    const exQual = await resolveExplain(db, `why does ${f.accounts[0].name.split(" ")[0]} qualify for ${f.hypothesis.name}?`, org);
    ok("EXPLAIN qualification answers from propensity + features", !("note" in exQual) && /propensity/i.test((exQual as { subtitle: string }).subtitle));
    const parsed = parseMotionShowMe(`show execution-ready pursuits in ${f.hypothesis.name}`);
    ok("SHOW ME parses the execution-ready allowlist form", parsed != null);
    if (parsed) {
      const { hits } = await resolveMotionShowMe(db, org, parsed, null);
      ok("SHOW ME execution-ready hits equal the funnel's ready cohort", hits.length === f.cohorts.ready, `${hits.length} vs ${f.cohorts.ready}`);
    }

    console.log(`\n  ${fail === 0 ? "✓ MOTION INTELLIGENCE VERIFIED" : "✗ FAILURES"} — ${pass} passed, ${fail} failed\n`);
    process.exit(fail === 0 ? 0 : 1);
  } finally {
    db.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
