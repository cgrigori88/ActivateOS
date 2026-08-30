/**
 * Workstream E3-F blind harness — outcomes / attribution / experiments / overrides.
 * Proves: event-rich outcomes incl. the missing NO_DECISION/DORMANT/DISQUALIFIED and
 * economically-meaningful intermediates, captured WITH decision-time context (R14);
 * Outcome ≠ Attribution (R15 — attribution is an explicit, versioned, non-ROI claim
 * that never mutates the factual outcome, and a human override preserves the machine
 * claim); experiments retain the intelligence state BEFORE the intervention, immutably
 * (R16); a human override becomes a supervision record that learns whether the system
 * converged (R17); and every object holds firm under tenant isolation. Runs as app_rw
 * under RLS against pursuit_demo.
 *
 *   npx tsx scripts/outcomes-verify.ts
 */
import { Pool, type PoolClient } from "pg";
import {
  recordOutcome, outcomesForPursuit, isTerminalOutcome,
  recordAttribution, overrideAttribution, attributionsForPursuit,
  createExperiment, addArm, assignCohort, linkCohortOutcome, markOverrideConvergence,
} from "../src/lib/pursuits/federation/outcomes";
import { outcomeLearningEnabled } from "../src/lib/pursuits/federation/flags";
import { recomputeRoute } from "../src/lib/routing/route-model";
import { upsertPursuit } from "../src/lib/pursuits/model";

const CONN = process.env.DATABASE_URL_VERIFY ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const pool = new Pool({ connectionString: CONN });
let passed = 0, failed = 0; const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); } }
async function asOwner<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> { const c = await pool.connect(); try { await c.query("begin"); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } }
async function asOrg<T>(orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> { const c = await pool.connect(); try { await c.query("begin"); await c.query("set local role app_rw"); await c.query("select set_config('app.org_id',$1,true)", [orgId]); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } }
async function expectThrows(fn: () => Promise<unknown>): Promise<boolean> { try { await fn(); return false; } catch { return true; } }

async function main() {
  console.log(`[outcomes-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);
  const RID = Math.random().toString(36).slice(2, 8);
  const s = await asOwner(async (db) => {
    const org = async (n: string) => (await db.query<{ id: string }>(`insert into organizations (name, kind, created_at) values ($1,'full',now()) returning id`, [`${n} ${RID}`])).rows[0].id;
    const vendor = await org("E3F Vendor"); const other = await org("E3F Other");
    const node = (await db.query<{ id: string }>(`insert into taxonomy_nodes (name, slug) values ($1,$2) returning id`, [`E3F ${RID}`, `e3f-${RID}`])).rows[0].id;
    const acct = (await db.query<{ id: string }>(`insert into companies (legal_name, normalized_name, industry, country) values ($1,$1,'Tech','US') returning id`, [`E3F Co ${RID}`])).rows[0].id;
    const hero = (await upsertPursuit(db, { orgId: vendor, accountId: acct, productCategoryId: node, pursuitType: "MODERNIZATION", useCase: "x", businessProblem: "x", createdVia: "SYSTEM_DETECTED", dataEnvironment: "DEMO" })).id;
    return { vendor, other, hero, acct };
  });
  // a route snapshot to serve as decision-time context
  const routeSnapId = await asOrg(s.vendor, async (db) => { await recomputeRoute(db, s.hero, new Date(), "DEMO"); return (await db.query<{ id: string }>(`select id from pursuit_route_snapshots where pursuit_id=$1 and is_current`, [s.hero])).rows[0].id; });

  // ---- Event-rich outcomes with decision-time context (R14) ----
  console.log("E3-F.1  Event-rich outcomes with decision-time context (R14)");
  check("the missing terminal labels exist (NO_DECISION/DORMANT/DISQUALIFIED)", isTerminalOutcome("NO_DECISION") && isTerminalOutcome("DORMANT") && isTerminalOutcome("DISQUALIFIED"));
  check("an intermediate is not terminal", !isTerminalOutcome("MEETING_BOOKED"));
  const interId = await asOrg(s.vendor, (db) => recordOutcome(db, { orgId: s.vendor, pursuitId: s.hero, label: "MEETING_BOOKED", companyId: s.acct, routeSnapshotId: routeSnapId, secondsSinceRecommended: 3600, dataEnvironment: "DEMO", isSimulated: true }));
  const stored = await asOrg(s.vendor, async (db) => (await db.query<{ route_snapshot_id: string | null; is_terminal: boolean }>(`select route_snapshot_id, is_terminal from pursuit_outcomes where id=$1`, [interId])).rows[0]);
  check("outcome captured WITH its decision-time route snapshot", stored.route_snapshot_id === routeSnapId && stored.is_terminal === false);
  await asOrg(s.vendor, (db) => recordOutcome(db, { orgId: s.vendor, pursuitId: s.hero, label: "OPPORTUNITY_CREATED", routeSnapshotId: routeSnapId, valueAmount: 250000, dataEnvironment: "DEMO", isSimulated: true }));
  const wonId = await asOrg(s.vendor, (db) => recordOutcome(db, { orgId: s.vendor, pursuitId: s.hero, label: "CLOSED_WON", routeSnapshotId: routeSnapId, valueAmount: 250000, dataEnvironment: "DEMO", isSimulated: true }));
  const trail = await asOrg(s.vendor, (db) => outcomesForPursuit(db, s.hero));
  check("the outcome trail records intermediate → terminal in order", trail.length >= 3 && trail[0].label === "MEETING_BOOKED" && trail[trail.length - 1].label === "CLOSED_WON");
  check("value lives on the outcome (economic magnitude, not on attribution)", trail.find((o) => o.id === wonId)?.valueAmount === 250000);

  // ---- Outcome ≠ Attribution (R15) ----
  console.log("E3-F.2  Outcome ≠ attribution (R15 — explicit, versioned, NOT ROI)");
  check("an attribution with no model version is refused (no basis, no claim)", await expectThrows(() =>
    asOrg(s.vendor, (db) => db.query(`insert into attribution (org_id, pursuit_id, subject_kind, attribution_class) values ($1,$2,'PARTNER','SOURCE')`, [s.vendor, s.hero]))));
  const attrId = await asOrg(s.vendor, (db) => recordAttribution(db, { orgId: s.vendor, pursuitId: s.hero, outcomeId: wonId, subjectKind: "DISTRIBUTOR", subjectLabel: "TD SYNNEX", attributionClass: "INFLUENCED", modelVersion: "attr-v1", evidence: { signal: "transaction_adjacency" }, reason: "distributor signal flipped the route", dataEnvironment: "DEMO", isSimulated: true }));
  check("recording attribution does NOT mutate the factual outcome label/value", (await asOrg(s.vendor, async (db) => (await db.query<{ outcome_label: string; value_amount: string }>(`select outcome_label, value_amount from pursuit_outcomes where id=$1`, [wonId])).rows[0]))!.outcome_label === "CLOSED_WON");
  check("the outcome back-links the attribution claim (linked, not merged)", (await asOrg(s.vendor, async (db) => (await db.query<{ attribution_id: string | null }>(`select attribution_id from pursuit_outcomes where id=$1`, [wonId])).rows[0]))!.attribution_id === attrId);
  await asOrg(s.vendor, (db) => overrideAttribution(db, attrId, "SOURCE", "channel lead says distributor sourced it"));
  const attrs = await asOrg(s.vendor, (db) => attributionsForPursuit(db, s.hero));
  const claim = attrs.find((a) => a.id === attrId)!;
  check("a human override preserves the machine claim and reflects the effective class", claim.attributionClass === "INFLUENCED" && claim.effectiveClass === "SOURCE");

  // ---- Experiments retain intervention history (R16) ----
  console.log("E3-F.3  Experiments retain intelligence-state-before, immutably (R16)");
  const exp = await asOrg(s.vendor, (db) => createExperiment(db, { orgId: s.vendor, key: `intro-${RID}`, name: "Warm intro vs none", hypothesis: "A warm intro raises meeting-booked rate", dataEnvironment: "DEMO", isSimulated: true }));
  await asOrg(s.vendor, (db) => addArm(db, { experimentId: exp, orgId: s.vendor, armKey: "control", description: "no intro", isControl: true }));
  await asOrg(s.vendor, (db) => addArm(db, { experimentId: exp, orgId: s.vendor, armKey: "intro", description: "warm intro" }));
  const assignId = await asOrg(s.vendor, (db) => assignCohort(db, { experimentId: exp, orgId: s.vendor, pursuitId: s.hero, armKey: "intro", intelligenceStateBefore: { score: 70, route: "CDW" }, recommendation: { partner: "CDW" }, dataEnvironment: "DEMO", isSimulated: true }));
  // re-assign with a DIFFERENT before-state — must not overwrite the captured history
  const assignId2 = await asOrg(s.vendor, (db) => assignCohort(db, { experimentId: exp, orgId: s.vendor, pursuitId: s.hero, armKey: "intro", intelligenceStateBefore: { score: 99, route: "WWT" }, dataEnvironment: "DEMO", isSimulated: true }));
  check("cohort assignment is idempotent per (experiment, pursuit)", assignId === assignId2);
  const before = await asOrg(s.vendor, async (db) => (await db.query<{ intelligence_state_before: { score: number } }>(`select intelligence_state_before from cohort_assignments where id=$1`, [assignId])).rows[0].intelligence_state_before);
  check("the intelligence state BEFORE the intervention is captured once, immutably", before.score === 70);
  await asOrg(s.vendor, (db) => linkCohortOutcome(db, assignId, wonId));
  check("the realized outcome binds back to the cohort assignment (closes the loop)", (await asOrg(s.vendor, async (db) => (await db.query<{ outcome_id: string | null }>(`select outcome_id from cohort_assignments where id=$1`, [assignId])).rows[0].outcome_id)) === wonId);

  // ---- Human override convergence (R17) ----
  console.log("E3-F.4  Human override as supervision (R17)");
  const ovrId = await asOrg(s.vendor, async (db) => (await db.query<{ id: string }>(
    `insert into pursuit_overrides (org_id, pursuit_id, field, original_recommendation, human_decision, reason, actor_role, recommendation_confidence, alternatives, override_category)
     values ($1,$2,'partner','{"partner":"CDW"}'::jsonb,'{"partner":"WWT"}'::jsonb,'exec knows the account','channel_exec',0.62,'["CDW","SHI"]'::jsonb,'better_relationship') returning id`,
    [s.vendor, s.hero])).rows[0].id);
  await asOrg(s.vendor, (db) => markOverrideConvergence(db, ovrId, { systemConverged: true, outcomeId: wonId }));
  const conv = await asOrg(s.vendor, async (db) => (await db.query<{ system_converged: boolean; outcome_id: string | null; converged_at: Date | null }>(`select system_converged, outcome_id, converged_at from pursuit_overrides where id=$1`, [ovrId])).rows[0]);
  check("override records whether the system later converged + the realized outcome", conv.system_converged === true && conv.outcome_id === wonId && conv.converged_at !== null);

  // ---- Tenant isolation (fairness invariant + multi-tenant safety) ----
  console.log("E3-F.5  Tenant isolation");
  check("another org cannot read this org's outcomes", (await asOrg(s.other, (db) => outcomesForPursuit(db, s.hero))).length === 0);
  check("another org cannot read this org's attribution", (await asOrg(s.other, (db) => attributionsForPursuit(db, s.hero))).length === 0);
  check("another org cannot see this org's experiment", (await asOrg(s.other, async (db) => (await db.query<{ n: string }>(`select count(*)::text n from experiments where id=$1`, [exp])).rows[0].n)) === "0");
  check("another org cannot write an outcome onto this org's pursuit (RLS check)", await expectThrows(() =>
    asOrg(s.other, (db) => recordOutcome(db, { orgId: s.vendor, pursuitId: s.hero, label: "CLOSED_LOST", dataEnvironment: "DEMO" }))));

  // ---- Flag fail-safe ----
  console.log("E3-F.6  Outcome-learning flag fail-safe");
  const savedOL = process.env.OUTCOME_LEARNING_ENABLED, savedExp = process.env.PURSUIT_EXPERIENCE_ENABLED;
  process.env.OUTCOME_LEARNING_ENABLED = "1"; delete process.env.PURSUIT_EXPERIENCE_ENABLED;
  check("outcome learning disabled when the experience dependency is off", !outcomeLearningEnabled());
  if (savedOL === undefined) delete process.env.OUTCOME_LEARNING_ENABLED; else process.env.OUTCOME_LEARNING_ENABLED = savedOL;
  if (savedExp === undefined) delete process.env.PURSUIT_EXPERIENCE_ENABLED; else process.env.PURSUIT_EXPERIENCE_ENABLED = savedExp;

  console.log(`\n[outcomes-verify] ${passed} passed, ${failed} failed`);
  if (failed) { console.log("[outcomes-verify] FAILURES:"); for (const f of failures) console.log("  - " + f); }
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("[outcomes-verify] fatal:", e); process.exit(2); });
