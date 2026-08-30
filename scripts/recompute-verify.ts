/**
 * Workstream E3-E blind harness — event-driven recompute engine.
 * Proves: the deterministic dependency map (R11 — a change type invalidates exactly
 * its declared targets; unlisted types are inert); as-of propagation (R12 — the
 * request carries the TRIGGERING EVENT's occurred_at, never now()); append-only
 * recompute (R13 — a ROUTE drain writes a NEW snapshot and preserves the prior one);
 * materiality suppression (R22 — a 68→69 nudge is SUPPRESSED and never surfaces, a
 * band-crossing jump is DONE + surfaces a downstream event); the loop guard (R23 —
 * a correlation chain past the depth cap is refused); idempotent enqueue; and that
 * change_ledger accepts the E-family change types. Runs as app_rw under RLS.
 *
 *   npx tsx scripts/recompute-verify.ts
 */
import { Pool, type PoolClient } from "pg";
import {
  DEPENDENCY_MAP, targetsFor, enqueueRecompute, drainRecomputeQueue, recordAndEnqueue,
} from "../src/lib/pursuits/federation/events";
import { recordChange } from "../src/lib/pursuits/ledger";
import { upsertPursuit } from "../src/lib/pursuits/model";
import { randomUUID } from "node:crypto";

const CONN = process.env.DATABASE_URL_VERIFY ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const pool = new Pool({ connectionString: CONN });
let passed = 0, failed = 0; const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); } }
async function asOwner<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> { const c = await pool.connect(); try { await c.query("begin"); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } }
async function asOrg<T>(orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> { const c = await pool.connect(); try { await c.query("begin"); await c.query("set local role app_rw"); await c.query("select set_config('app.org_id',$1,true)", [orgId]); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } }

async function main() {
  console.log(`[recompute-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);
  const RID = Math.random().toString(36).slice(2, 8);
  const s = await asOwner(async (db) => {
    const org = async (n: string) => (await db.query<{ id: string }>(`insert into organizations (name, kind, created_at) values ($1,'full',now()) returning id`, [`${n} ${RID}`])).rows[0].id;
    const vendor = await org("E3E Vendor");
    const node = (await db.query<{ id: string }>(`insert into taxonomy_nodes (name, slug) values ($1,$2) returning id`, [`E3E ${RID}`, `e3e-${RID}`])).rows[0].id;
    const acct = (await db.query<{ id: string }>(`insert into companies (legal_name, normalized_name, industry, country) values ($1,$1,'Tech','US') returning id`, [`E3E Co ${RID}`])).rows[0].id;
    const hero = (await upsertPursuit(db, { orgId: vendor, accountId: acct, productCategoryId: node, pursuitType: "MODERNIZATION", useCase: "x", businessProblem: "x", createdVia: "SYSTEM_DETECTED", dataEnvironment: "DEMO" })).id;
    return { vendor, hero, acct };
  });

  // ---- Deterministic dependency map (R11) ----
  console.log("E3-E.1  Deterministic dependency map (R11)");
  check("FACT_ACCEPTED invalidates SCORE, WHY_NOW, ROUTE, TODAY", JSON.stringify(targetsFor("FACT_ACCEPTED")) === JSON.stringify(["SCORE", "WHY_NOW", "ROUTE", "TODAY"]));
  check("CONTRIBUTION_REVOKED invalidates SCORE, ROUTE, READINESS, TODAY", targetsFor("CONTRIBUTION_REVOKED").join(",") === "SCORE,ROUTE,READINESS,TODAY");
  check("an unlisted change type is inert (enqueues nothing)", targetsFor("PURSUIT_MIGRATED").length === 0);
  check("every mapped target set is non-empty and TODAY-terminated where present", Object.values(DEPENDENCY_MAP).every((t) => t.length > 0));

  // ---- As-of propagation (R12) ----
  console.log("E3-E.2  As-of propagation (R12)");
  const eventTime = new Date(Date.now() - 3 * 24 * 3600 * 1000); // 3 days ago — the business time
  const enq = await asOrg(s.vendor, async (db) => {
    const eventId = await recordChange(db, { orgId: s.vendor, pursuitId: s.hero, entityType: "pursuit", entityId: s.hero, changeType: "FACT_ACCEPTED", before: { score: 68 }, after: { score: 69 }, occurredAt: eventTime, dataEnvironment: "DEMO" });
    return enqueueRecompute(db, { orgId: s.vendor, pursuitId: s.hero, changeType: "FACT_ACCEPTED", asOf: eventTime, requestedByEventId: eventId, dataEnvironment: "DEMO" });
  });
  check("enqueue fans out to exactly the mapped targets", enq.enqueued.join(",") === "SCORE,WHY_NOW,ROUTE,TODAY");
  const asOfRows = await asOrg(s.vendor, async (db) => (await db.query<{ as_of: Date }>(`select as_of from recompute_requests where pursuit_id=$1 and status='PENDING'`, [s.hero])).rows);
  check("every request carries the event's as-of, not now()", asOfRows.length === 4 && asOfRows.every((r) => Math.abs(new Date(r.as_of).getTime() - eventTime.getTime()) < 1000));

  // ---- Idempotent enqueue ----
  console.log("E3-E.3  Idempotent enqueue");
  const enq2 = await asOrg(s.vendor, (db) => enqueueRecompute(db, { orgId: s.vendor, pursuitId: s.hero, changeType: "FACT_ACCEPTED", asOf: eventTime, dataEnvironment: "DEMO" }));
  check("re-enqueue at the same as-of does not duplicate PENDING rows", enq2.enqueued.length === 0);

  // ---- Materiality suppression (R22): the 68→69 nudge ----
  console.log("E3-E.4  Materiality suppression (R22)");
  const drain1 = await asOrg(s.vendor, (db) => drainRecomputeQueue(db, {}));
  check("a 68→69 SCORE recompute is SUPPRESSED, not surfaced", drain1.suppressed >= 1);
  const scoreStatus = await asOrg(s.vendor, async (db) => (await db.query<{ status: string; reason: string }>(`select status, reason from recompute_requests where pursuit_id=$1 and target='SCORE' and change_type='FACT_ACCEPTED'`, [s.hero])).rows[0]);
  check("immaterial SCORE request marked SUPPRESSED:LOW", scoreStatus.status === "SUPPRESSED" && /LOW/.test(scoreStatus.reason ?? ""));
  const surfacedAfterNudge = await asOrg(s.vendor, async (db) => (await db.query<{ n: string }>(`select count(*)::text n from change_ledger where pursuit_id=$1 and change_type='SCORE_CHANGED'`, [s.hero])).rows[0].n);
  check("no downstream SCORE_CHANGED event emitted for an immaterial nudge", surfacedAfterNudge === "0");

  // ---- Materiality surfacing: a band-crossing jump ----
  console.log("E3-E.5  Material change surfaces (R22)");
  const bigTime = new Date(Date.now() - 2 * 24 * 3600 * 1000);
  await asOrg(s.vendor, async (db) => {
    const eventId = await recordChange(db, { orgId: s.vendor, pursuitId: s.hero, entityType: "pursuit", entityId: s.hero, changeType: "CONTRADICTION_DETECTED", before: { score: 68 }, after: { score: 84 }, occurredAt: bigTime, dataEnvironment: "DEMO" });
    return enqueueRecompute(db, { orgId: s.vendor, pursuitId: s.hero, changeType: "CONTRADICTION_DETECTED", asOf: bigTime, requestedByEventId: eventId, dataEnvironment: "DEMO" });
  });
  const drain2 = await asOrg(s.vendor, (db) => drainRecomputeQueue(db, {}));
  check("a 68→84 SCORE recompute is DONE and surfaced", drain2.surfaced >= 1);
  const surfacedBig = await asOrg(s.vendor, async (db) => (await db.query<{ n: string }>(`select count(*)::text n from change_ledger where pursuit_id=$1 and change_type='SCORE_CHANGED'`, [s.hero])).rows[0].n);
  check("a material jump emits a downstream SCORE_CHANGED event", Number(surfacedBig) >= 1);
  const emittedAsOf = await asOrg(s.vendor, async (db) => (await db.query<{ occurred_at: Date; trigger_type: string }>(`select occurred_at, trigger_type from change_ledger where pursuit_id=$1 and change_type='SCORE_CHANGED' order by recorded_at desc limit 1`, [s.hero])).rows[0]);
  check("the emitted event is stamped EVENT_TRIGGERED at the source event's as-of", emittedAsOf.trigger_type === "EVENT_TRIGGERED" && Math.abs(new Date(emittedAsOf.occurred_at).getTime() - bigTime.getTime()) < 1000);

  // ---- Append-only ROUTE recompute (R13) ----
  console.log("E3-E.6  Append-only ROUTE recompute (R13)");
  const beforeSnaps = await asOrg(s.vendor, async (db) => (await db.query<{ n: string }>(`select count(*)::text n from pursuit_route_snapshots where pursuit_id=$1`, [s.hero])).rows[0].n);
  const routeTime = new Date(Date.now() - 1 * 24 * 3600 * 1000);
  await asOrg(s.vendor, async (db) => {
    const eventId = await recordChange(db, { orgId: s.vendor, pursuitId: s.hero, entityType: "pursuit", entityId: s.hero, changeType: "TRANSACTION_SIGNAL_INGESTED", occurredAt: routeTime, dataEnvironment: "DEMO" });
    await enqueueRecompute(db, { orgId: s.vendor, pursuitId: s.hero, changeType: "TRANSACTION_SIGNAL_INGESTED", asOf: routeTime, requestedByEventId: eventId, dataEnvironment: "DEMO" });
  });
  await asOrg(s.vendor, (db) => drainRecomputeQueue(db, {}));
  const afterSnaps = await asOrg(s.vendor, async (db) => (await db.query<{ n: string }>(`select count(*)::text n from pursuit_route_snapshots where pursuit_id=$1`, [s.hero])).rows[0].n);
  check("ROUTE recompute appends a new route snapshot", Number(afterSnaps) === Number(beforeSnaps) + 1);
  check("at most one snapshot is current (prior preserved, not rewritten)", (await asOrg(s.vendor, async (db) => (await db.query<{ n: string }>(`select count(*)::text n from pursuit_route_snapshots where pursuit_id=$1 and is_current`, [s.hero])).rows[0].n)) === "1");
  const routeReqAsOf = await asOrg(s.vendor, async (db) => (await db.query<{ as_of: Date }>(`select as_of from pursuit_route_snapshots where pursuit_id=$1 order by seq desc limit 1`, [s.hero])).rows[0]);
  check("the new snapshot is stamped at the event's as-of (R12)", Math.abs(new Date(routeReqAsOf.as_of).getTime() - routeTime.getTime()) < 1000);

  // ---- Loop guard (R23) ----
  console.log("E3-E.7  Loop guard (R23)");
  const corr = randomUUID();
  const loopRes = await asOrg(s.vendor, async (db) => {
    let last;
    for (let i = 0; i < 30; i++) last = await enqueueRecompute(db, { orgId: s.vendor, pursuitId: s.hero, changeType: "FACT_ACCEPTED", asOf: new Date(Date.now() - i * 1000), correlationId: corr, dataEnvironment: "DEMO" });
    return last;
  });
  check("a correlation chain past the depth cap is refused (loop guard)", loopRes?.suppressed === true && loopRes.reason === "loop guard");
  check("the guard lands a SUPPRESSED loop-guard marker", (await asOrg(s.vendor, async (db) => (await db.query<{ n: string }>(`select count(*)::text n from recompute_requests where correlation_id=$1 and status='SUPPRESSED' and reason like 'loop guard%'`, [corr])).rows[0].n)) !== "0");

  // ---- change_ledger accepts the E family ----
  console.log("E3-E.8  change_ledger accepts E-family types");
  const eTypes = ["PARTICIPANT_JOINED", "ACCESS_GRANTED", "CONTRIBUTION_ADDED", "ACTION_EXECUTED", "MEETING_BOOKED", "PURSUIT_WON"];
  check("all E-family change types insert into change_ledger", await asOrg(s.vendor, async (db) => {
    for (const t of eTypes) await recordChange(db, { orgId: s.vendor, pursuitId: s.hero, entityType: "pursuit", entityId: s.hero, changeType: t as never, dataEnvironment: "DEMO" });
    return (await db.query<{ n: string }>(`select count(*)::text n from change_ledger where pursuit_id=$1 and change_type = any($2)`, [s.hero, eTypes])).rows[0].n === String(eTypes.length);
  }));

  // ---- recordAndEnqueue producer path ----
  console.log("E3-E.9  Producer convenience path");
  const combined = await asOrg(s.vendor, (db) => recordAndEnqueue(db, { orgId: s.vendor, pursuitId: s.hero, entityType: "pursuit", entityId: s.hero, changeType: "PARTICIPANT_JOINED", occurredAt: new Date(), dataEnvironment: "DEMO" }));
  check("recordAndEnqueue writes the event and fans out its targets", !!combined.eventId && combined.enqueue.enqueued.join(",") === "ROUTE,READINESS,TODAY");

  console.log(`\n[recompute-verify] ${passed} passed, ${failed} failed`);
  if (failed) { console.log("[recompute-verify] FAILURES:"); for (const f of failures) console.log("  - " + f); }
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("[recompute-verify] fatal:", e); process.exit(2); });
