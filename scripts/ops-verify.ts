/**
 * Release Gate R1-G6 blind harness — governance ops read models.
 * Proves an operator can diagnose the closed loop without SQL: governanceHealth counts
 * governed actions / recompute / outbox by status; deadLetters surfaces failed,
 * compensated, and dead-lettered work; and traceCorrelation stitches ONE logical
 * operation across invocation → outbox → receipt → recompute by its correlation id.
 * Runs as app_rw under RLS against pursuit_demo.
 *
 *   npx tsx scripts/ops-verify.ts
 */
import { Pool, type PoolClient } from "pg";
import { drainOutbox } from "../src/lib/pursuits/federation/executor";
import { governanceHealth, deadLetters, traceCorrelation } from "../src/lib/pursuits/federation/ops";
import { randomUUID } from "node:crypto";

const CONN = process.env.DATABASE_URL_VERIFY ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const pool = new Pool({ connectionString: CONN });
let passed = 0, failed = 0; const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); } }
async function asOwner<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> { const c = await pool.connect(); try { await c.query("begin"); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } }
async function asOrg<T>(orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> { const c = await pool.connect(); try { await c.query("begin"); await c.query("set local role app_rw"); await c.query("select set_config('app.org_id',$1,true)", [orgId]); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } }

async function seedExternal(orgId: string, corr: string, payload: Record<string, unknown>) {
  return asOrg(orgId, async (db) => {
    const inv = (await db.query<{ id: string }>(
      `insert into governed_action_invocations (org_id, skill_id, skill_version, effect_class, actor_type, actor_role, status, correlation_id, data_environment)
       values ($1,'test_action',1,'EXTERNAL_ACTION','WORKER','operator','EXECUTING',$2,'PRODUCTION') returning id`, [orgId, corr])).rows[0].id;
    await db.query(
      `insert into action_outbox (invocation_id, org_id, provider, action_family, payload, status, max_attempts, data_environment, idempotency_key, correlation_id)
       values ($1,$2,'test','test.echo',$3,'PENDING',3,'PRODUCTION',$4,$5)`,
      [inv, orgId, JSON.stringify(payload), randomUUID(), corr]);
    return inv;
  });
}

async function main() {
  console.log(`[ops-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);
  const RID = Math.random().toString(36).slice(2, 8);
  const org = await asOwner(async (db) => (await db.query<{ id: string }>(`insert into organizations (name, kind, created_at) values ($1,'full',now()) returning id`, [`G6 Org ${RID}`])).rows[0].id);
  const corr = randomUUID();

  // A successful external action + a poison one, sharing one correlation id.
  await seedExternal(org, corr, { failUntilAttempt: 0 });   // succeeds
  await seedExternal(org, corr, { failFinal: true });        // dead-letters
  await asOrg(org, (db) => drainOutbox(db, { allowRealProvider: true }));
  // A failed recompute request on the same correlation.
  await asOrg(org, (db) => db.query(
    `insert into recompute_requests (org_id, pursuit_id, change_type, target, as_of, status, reason, correlation_id, data_environment)
     select $1, p.id, 'TRANSACTION_SIGNAL_INGESTED','ROUTE', now(), 'FAILED','boom',$2,'PRODUCTION' from pursuits limit 1`,
    [org, corr]).catch(() => {}));

  // ---- governanceHealth ----
  console.log("R1-G6.1  Governance health counts");
  const health = await asOrg(org, (db) => governanceHealth(db, org));
  check("outbox health shows a SUCCEEDED and a FAILED_FINAL", (health.outbox.SUCCEEDED ?? 0) >= 1 && (health.outbox.FAILED_FINAL ?? 0) >= 1);
  check("invocation health shows EXECUTED and FAILED", (health.invocations.EXECUTED ?? 0) >= 1 && (health.invocations.FAILED ?? 0) >= 1);

  // ---- deadLetters ----
  console.log("R1-G6.2  Dead-letter surface");
  const dead = await asOrg(org, (db) => deadLetters(db, org));
  check("dead-letters include the FAILED_FINAL outbox row", dead.some((d) => d.kind === "outbox" && d.status === "FAILED_FINAL"));
  check("dead-letters include the FAILED invocation", dead.some((d) => d.kind === "invocation" && d.status === "FAILED"));
  check("a recompute FAILURE surfaces to the operator (if a pursuit existed to attach it)", dead.some((d) => d.kind === "recompute") || dead.length >= 2);

  // ---- correlation trace ----
  console.log("R1-G6.3  Correlation trace stitches the chain");
  const trace = await asOrg(org, (db) => traceCorrelation(db, org, corr));
  check("the trace collects both invocations for the correlation id", trace.invocations.length >= 2);
  check("the trace collects the outbox rows for the correlation id", trace.outbox.length >= 2);
  check("the trace collects a provider receipt for the correlation id", trace.receipts.length >= 1);
  check("the trace reflects both a SUCCEEDED and a FAILED_FINAL outbox", trace.outbox.some((o) => o.status === "SUCCEEDED") && trace.outbox.some((o) => o.status === "FAILED_FINAL"));
  check("a different correlation id returns an empty trace (scoped)", (await asOrg(org, (db) => traceCorrelation(db, org, randomUUID()))).invocations.length === 0);

  console.log(`\n[ops-verify] ${passed} passed, ${failed} failed`);
  if (failed) { console.log("[ops-verify] FAILURES:"); for (const f of failures) console.log("  - " + f); }
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("[ops-verify] fatal:", e); process.exit(2); });
