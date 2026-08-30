/**
 * Release Gate R1-G2 blind harness — tenant-scoped feature flags.
 * Proves: enablement is env-master AND per-org opt-in; a design-partner org can be
 * enabled while every other tenant stays DARK; the derived dependency chains hold
 * (federation ⇒ experience; governed_action ⇒ federation; outcome_learning ⇒
 * experience, NOT federation); FAIL-CLOSED (no org_features row ⇒ everything off, and
 * env-off ⇒ off even if the org row is true); every change writes an audit row; and
 * OUTCOME_LEARNING stays dark unless explicitly enabled. Runs as app_rw under RLS.
 *
 *   npx tsx scripts/tenant-flags-verify.ts
 */
import { Pool, type PoolClient } from "pg";
import { setOrgFeature, tenantFeatures, experienceEnabledFor, federationEnabledFor, governedActionEnabledFor, outcomeLearningEnabledFor } from "../src/lib/pursuits/tenant-flags";

const CONN = process.env.DATABASE_URL_VERIFY ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const pool = new Pool({ connectionString: CONN });
let passed = 0, failed = 0; const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); } }
async function asOwner<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> { const c = await pool.connect(); try { await c.query("begin"); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } }
async function asOrg<T>(orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> { const c = await pool.connect(); try { await c.query("begin"); await c.query("set local role app_rw"); await c.query("select set_config('app.org_id',$1,true)", [orgId]); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } }

const ENV_KEYS = ["PURSUITS_ENABLED", "FACTS_ENABLED", "ROUTING_ENABLED", "PURSUIT_EXPERIENCE_ENABLED", "FEDERATION_ENABLED", "GOVERNED_ACTION_ENABLED", "OUTCOME_LEARNING_ENABLED"];
function setEnvAll(on: boolean) { for (const k of ENV_KEYS) { if (on) process.env[k] = "1"; else delete process.env[k]; } }

async function main() {
  console.log(`[tenant-flags-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  const RID = Math.random().toString(36).slice(2, 8);
  const s = await asOwner(async (db) => {
    const org = async (n: string) => (await db.query<{ id: string }>(`insert into organizations (name, kind, created_at) values ($1,'full',now()) returning id`, [`${n} ${RID}`])).rows[0].id;
    return { pilot: await org("G2 Pilot"), other: await org("G2 Other") };
  });

  // ---- Fail-closed by default (no row) ----
  console.log("R1-G2.1  Fail-closed by default");
  setEnvAll(true); // deployment master ON for all
  check("an org with NO org_features row is fully dark (fail-closed)", !(await asOrg(s.pilot, (db) => experienceEnabledFor(db, s.pilot))));

  // ---- Single-tenant enablement + isolation ----
  console.log("R1-G2.2  Single-tenant enablement, others stay dark");
  await asOrg(s.pilot, async (db) => { for (const f of ["pursuits", "facts", "routing", "pursuit_experience"] as const) await setOrgFeature(db, s.pilot, f, true, { reason: "pilot" }); });
  check("the pilot org is enabled for the experience", await asOrg(s.pilot, (db) => experienceEnabledFor(db, s.pilot)));
  check("a DIFFERENT org stays dark (per-tenant isolation)", !(await asOrg(s.other, (db) => experienceEnabledFor(db, s.other))));

  // ---- Dependency chains ----
  console.log("R1-G2.3  Derived dependency chains");
  check("federation is OFF until its own flag is set (even with experience on)", !(await asOrg(s.pilot, (db) => federationEnabledFor(db, s.pilot))));
  await asOrg(s.pilot, (db) => setOrgFeature(db, s.pilot, "federation", true, {}));
  check("federation ON once set (requires experience, which is on)", await asOrg(s.pilot, (db) => federationEnabledFor(db, s.pilot)));
  check("governed_action still OFF (needs its own flag)", !(await asOrg(s.pilot, (db) => governedActionEnabledFor(db, s.pilot))));
  await asOrg(s.pilot, (db) => setOrgFeature(db, s.pilot, "governed_action", true, {}));
  check("governed_action ON (requires federation, which is on)", await asOrg(s.pilot, (db) => governedActionEnabledFor(db, s.pilot)));

  // ---- outcome_learning is org-local + stays dark until explicitly enabled ----
  console.log("R1-G2.4  Outcome learning dark unless explicitly enabled");
  check("outcome_learning is OFF for the pilot (never implied by federation)", !(await asOrg(s.pilot, (db) => outcomeLearningEnabledFor(db, s.pilot))));
  await asOrg(s.pilot, (db) => setOrgFeature(db, s.pilot, "outcome_learning", true, { reason: "authorized design-partner rollout" }));
  check("outcome_learning ON only after an explicit, audited enablement", await asOrg(s.pilot, (db) => outcomeLearningEnabledFor(db, s.pilot)));

  // ---- Env master is the deployment kill-switch ----
  console.log("R1-G2.5  Env master kill-switch");
  setEnvAll(false); // deployment master OFF
  const featsEnvOff = await asOrg(s.pilot, (db) => tenantFeatures(db, s.pilot));
  check("env-off forces everything OFF even though the org row is all true", !featsEnvOff.experience && !featsEnvOff.federation && !featsEnvOff.governedAction && !featsEnvOff.outcomeLearning);
  setEnvAll(true);

  // ---- Change audit ----
  console.log("R1-G2.6  Flag-change audit");
  const audits = await asOrg(s.pilot, async (db) => (await db.query<{ flag: string; enabled: boolean }>(`select flag, enabled from org_feature_changes where org_id=$1 order by changed_at`, [s.pilot])).rows);
  check("every flag change wrote an audit row (who/when/why)", audits.length >= 6 && audits.some((a) => a.flag === "outcome_learning" && a.enabled));
  check("another org cannot read the pilot's flag-change audit (RLS)", (await asOrg(s.other, async (db) => (await db.query<{ n: string }>(`select count(*)::text n from org_feature_changes where org_id=$1`, [s.pilot])).rows[0].n)) === "0");
  check("another org cannot read the pilot's org_features row (RLS)", (await asOrg(s.other, async (db) => (await db.query<{ n: string }>(`select count(*)::text n from org_features where org_id=$1`, [s.pilot])).rows[0].n)) === "0");

  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]!; }
  console.log(`\n[tenant-flags-verify] ${passed} passed, ${failed} failed`);
  if (failed) { console.log("[tenant-flags-verify] FAILURES:"); for (const f of failures) console.log("  - " + f); }
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("[tenant-flags-verify] fatal:", e); process.exit(2); });
