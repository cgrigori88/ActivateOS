/**
 * Release Gate R1-G5 blind harness — recompute queue recovery.
 * Proves the recompute queue survives retries/restarts without corrupting history:
 * a crash mid-drain rolls back to PENDING (no partial snapshot); a RUNNING row whose
 * lease expired is recovered; a fresh RUNNING row is NOT stolen; a poison request is
 * capped to FAILED after max attempts instead of retrying forever; and recompute is
 * append-only (no duplicate snapshots on re-drain). Runs as app_rw under RLS.
 *
 *   npx tsx scripts/recompute-recovery-verify.ts
 */
import { Pool, type PoolClient } from "pg";
import { upsertPursuit } from "../src/lib/pursuits/model";
import { enqueueRecompute, drainRecomputeQueue } from "../src/lib/pursuits/federation/events";
import { recordChange } from "../src/lib/pursuits/ledger";

const CONN = process.env.DATABASE_URL_VERIFY ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const pool = new Pool({ connectionString: CONN });
let passed = 0, failed = 0; const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); } }
async function asOwner<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> { const c = await pool.connect(); try { await c.query("begin"); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } }
async function asOrg<T>(orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> { const c = await pool.connect(); try { await c.query("begin"); await c.query("set local role app_rw"); await c.query("select set_config('app.org_id',$1,true)", [orgId]); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } }
// Run a body inside a tenant txn then ROLLBACK — simulating a worker crash mid-drain.
async function asOrgCrash(orgId: string, fn: (db: PoolClient) => Promise<void>): Promise<void> { const c = await pool.connect(); try { await c.query("begin"); await c.query("set local role app_rw"); await c.query("select set_config('app.org_id',$1,true)", [orgId]); await fn(c); } finally { await c.query("rollback").catch(() => {}); c.release(); } }
const snapCount = (orgId: string, pursuitId: string) => asOrg(orgId, async (db) => Number((await db.query<{ n: string }>(`select count(*)::text n from pursuit_route_snapshots where pursuit_id=$1`, [pursuitId])).rows[0].n));
const reqStatus = (orgId: string, pursuitId: string, target: string) => asOrg(orgId, async (db) => (await db.query<{ status: string }>(`select status from recompute_requests where pursuit_id=$1 and target=$2 order by created_at desc limit 1`, [pursuitId, target])).rows[0]?.status);

async function main() {
  console.log(`[recompute-recovery-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);
  const RID = Math.random().toString(36).slice(2, 8);
  const s = await asOwner(async (db) => {
    const vendor = (await db.query<{ id: string }>(`insert into organizations (name, kind, created_at) values ($1,'full',now()) returning id`, [`G5 Vendor ${RID}`])).rows[0].id;
    const node = (await db.query<{ id: string }>(`insert into taxonomy_nodes (name, slug) values ($1,$2) returning id`, [`G5 ${RID}`, `g5-${RID}`])).rows[0].id;
    const acct = (await db.query<{ id: string }>(`insert into companies (legal_name, normalized_name, industry, country) values ($1,$1,'Tech','US') returning id`, [`G5 Co ${RID}`])).rows[0].id;
    const hero = (await upsertPursuit(db, { orgId: vendor, accountId: acct, productCategoryId: node, pursuitType: "MODERNIZATION", useCase: "x", businessProblem: "x", createdVia: "SYSTEM_DETECTED", dataEnvironment: "DEMO" })).id;
    return { vendor, hero };
  });
  const enqueue = () => asOrg(s.vendor, async (db) => {
    const ev = await recordChange(db, { orgId: s.vendor, pursuitId: s.hero, entityType: "pursuit", entityId: s.hero, changeType: "TRANSACTION_SIGNAL_INGESTED", occurredAt: new Date(), dataEnvironment: "DEMO" });
    await enqueueRecompute(db, { orgId: s.vendor, pursuitId: s.hero, changeType: "TRANSACTION_SIGNAL_INGESTED", asOf: new Date(), requestedByEventId: ev, dataEnvironment: "DEMO" });
  });

  // ---- Crash mid-drain rolls back to PENDING (no partial snapshot) ----
  console.log("R1-G5.1  Crash mid-drain leaves no partial state");
  await enqueue();
  const snapBefore = await snapCount(s.vendor, s.hero);
  await asOrgCrash(s.vendor, async (db) => { await drainRecomputeQueue(db, {}); /* crash: rollback */ });
  check("after a crashed drain, requests are still PENDING (not stuck RUNNING)", (await reqStatus(s.vendor, s.hero, "ROUTE")) === "PENDING");
  check("a crashed drain wrote NO snapshot (atomic — all or nothing)", (await snapCount(s.vendor, s.hero)) === snapBefore);
  // A clean drain then processes it exactly once.
  await asOrg(s.vendor, (db) => drainRecomputeQueue(db, {}));
  check("a clean re-drain processes the ROUTE recompute and appends exactly one snapshot", (await snapCount(s.vendor, s.hero)) === snapBefore + 1);
  check("the ROUTE request is now resolved (DONE/SUPPRESSED, not reprocessed)", ["DONE", "SUPPRESSED"].includes((await reqStatus(s.vendor, s.hero, "ROUTE")) ?? ""));
  // Re-drain is idempotent: DONE is not re-picked, no duplicate snapshot.
  await asOrg(s.vendor, (db) => drainRecomputeQueue(db, {}));
  check("re-draining does not duplicate the snapshot (append-only, idempotent)", (await snapCount(s.vendor, s.hero)) === snapBefore + 1);

  // ---- Stale RUNNING recovered; fresh RUNNING not stolen ----
  console.log("R1-G5.2  Lease-based recovery of abandoned RUNNING rows");
  await enqueue();
  // Force the fresh requests into a stale RUNNING (a worker that died after marking RUNNING).
  await asOrg(s.vendor, (db) => db.query(`update recompute_requests set status='RUNNING', locked_at = now() - interval '30 minutes' where pursuit_id=$1 and status='PENDING'`, [s.hero]));
  await asOrg(s.vendor, (db) => drainRecomputeQueue(db, {}));
  check("a RUNNING row whose lease expired is recovered and completed", ["DONE", "SUPPRESSED"].includes((await reqStatus(s.vendor, s.hero, "TODAY")) ?? ""));
  // A fresh RUNNING (recent lease) must NOT be stolen mid-flight.
  await enqueue();
  await asOrg(s.vendor, (db) => db.query(`update recompute_requests set status='RUNNING', locked_at = now() where pursuit_id=$1 and target='TODAY' and status='PENDING'`, [s.hero]));
  await asOrg(s.vendor, (db) => drainRecomputeQueue(db, {}));
  check("a fresh RUNNING row (recent lease) is NOT stolen", (await reqStatus(s.vendor, s.hero, "TODAY")) === "RUNNING");

  // ---- Poison request capped, not retried forever ----
  console.log("R1-G5.3  Poison request capped to FAILED");
  await enqueue();
  await asOrg(s.vendor, (db) => db.query(`update recompute_requests set attempts = max_attempts where pursuit_id=$1 and target='ROUTE' and status='PENDING'`, [s.hero]));
  await asOrg(s.vendor, (db) => drainRecomputeQueue(db, {}));
  check("a request that burned its attempts is FAILED (not retried forever)", (await reqStatus(s.vendor, s.hero, "ROUTE")) === "FAILED");

  console.log(`\n[recompute-recovery-verify] ${passed} passed, ${failed} failed`);
  if (failed) { console.log("[recompute-recovery-verify] FAILURES:"); for (const f of failures) console.log("  - " + f); }
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("[recompute-recovery-verify] fatal:", e); process.exit(2); });
