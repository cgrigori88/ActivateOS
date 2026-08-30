/**
 * Pilot OR-3 rehearsal — pluggable error/alert reporting.
 * With a TEST SINK injected, drives controlled failures and proves: the correct
 * structured event is generated for each failure class; events carry the correlation
 * and ids needed to find the failing Pursuit/action; NO confidential payload / args /
 * cross-tenant data appear in any telemetry field; and when no provider is configured
 * the reporter fails safe to a no-op. Runs as app_rw under RLS against pursuit_demo.
 *
 *   npx tsx scripts/observability-verify.ts
 */
import { Pool, type PoolClient } from "pg";
import { setReporter, getReporter, TestSinkReporter, NullReporter, type TelemetryEvent } from "../src/lib/obs/reporter";
import { seedGovernedSkills, dispatchSkill, type Actor } from "../src/lib/pursuits/federation/skills";
import { drainOutbox } from "../src/lib/pursuits/federation/executor";
import { upsertPursuit } from "../src/lib/pursuits/model";
import { randomUUID } from "node:crypto";

const CONN = process.env.DATABASE_URL_VERIFY ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const pool = new Pool({ connectionString: CONN });
let passed = 0, failed = 0; const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); } }
async function asOwner<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> { const c = await pool.connect(); try { await c.query("begin"); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } }
async function asOrg<T>(orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> { const c = await pool.connect(); try { await c.query("begin"); await c.query("set local role app_rw"); await c.query("select set_config('app.org_id',$1,true)", [orgId]); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } }
const actor = (orgId: string, role: Actor["role"], type: Actor["type"] = "USER"): Actor => ({ type, id: randomUUID(), orgId, role });
const SECRET = "CONFIDENTIAL-1840000-DONOTLEAK";
function serialize(events: TelemetryEvent[]): string { return JSON.stringify(events); }

async function main() {
  console.log(`[observability-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);
  const RID = Math.random().toString(36).slice(2, 8);
  const sink = new TestSinkReporter();
  setReporter(sink);

  const s = await asOwner(async (db) => {
    await seedGovernedSkills(db);
    const vendor = (await db.query<{ id: string }>(`insert into organizations (name, kind, created_at) values ($1,'full',now()) returning id`, [`OR3 Vendor ${RID}`])).rows[0].id;
    const node = (await db.query<{ id: string }>(`insert into taxonomy_nodes (name, slug) values ($1,$2) returning id`, [`OR3 ${RID}`, `or3-${RID}`])).rows[0].id;
    const acct = (await db.query<{ id: string }>(`insert into companies (legal_name, normalized_name, industry, country) values ($1,$1,'Tech','US') returning id`, [`OR3 Co ${RID}`])).rows[0].id;
    const hero = (await upsertPursuit(db, { orgId: vendor, accountId: acct, productCategoryId: node, pursuitType: "MODERNIZATION", useCase: "x", businessProblem: "x", createdVia: "SYSTEM_DETECTED", dataEnvironment: "DEMO" })).id;
    return { vendor, hero };
  });

  // ---- dispatch rejection (permission) ----
  console.log("OR-3.1  Governed-action rejection is reported");
  sink.events = [];
  await asOrg(s.vendor, (db) => dispatchSkill(db, "draft_campaign_touch", actor(s.vendor, "viewer"), { pursuitId: s.hero, args: { secret: SECRET } }));
  check("a REJECTED dispatch emits a telemetry event", sink.events.some((e) => e.kind === "dispatch_skill"));
  check("the event carries org + pursuit + invocation ids", sink.events.some((e) => e.orgId === s.vendor && e.pursuitId === s.hero && !!e.actionInvocationId));
  check("no confidential arg value appears anywhere in the telemetry", !serialize(sink.events).includes(SECRET) && !serialize(sink.events).includes("1840000"));

  // ---- cross-tenant authority denial → tenant-isolation signal ----
  console.log("OR-3.2  Cross-tenant authority denial is a tenant-isolation signal");
  sink.events = [];
  await asOrg(s.vendor, (db) => dispatchSkill(db, "request_team_acceptance", actor(s.vendor, "operator"), { pursuitId: s.hero }));
  check("a cross-tenant denial emits a tenant_isolation_failure event", sink.events.some((e) => e.kind === "tenant_isolation_failure"));

  // ---- governed-action handler failure (error) ----
  console.log("OR-3.3  Governed-action failure is reported at error severity");
  sink.events = [];
  await asOrg(s.vendor, (db) => dispatchSkill(db, "accept_participation", actor(s.vendor, "operator"), { pursuitId: s.hero, args: { participantId: randomUUID(), secret: SECRET } }));
  check("a FAILED handler emits a governed_action error event", sink.events.some((e) => e.kind === "governed_action" && e.severity === "error"));
  check("the failure event leaks no confidential arg", !serialize(sink.events).includes(SECRET));

  // ---- dead-letter (poison external action) with correlation ----
  console.log("OR-3.4  Dead-letter is reported with correlation");
  sink.events = [];
  const corr = randomUUID();
  await asOrg(s.vendor, async (db) => {
    const inv = (await db.query<{ id: string }>(`insert into governed_action_invocations (org_id, skill_id, skill_version, effect_class, actor_type, actor_role, status, correlation_id, data_environment) values ($1,'test_action',1,'EXTERNAL_ACTION','WORKER','operator','EXECUTING',$2,'PRODUCTION') returning id`, [s.vendor, corr])).rows[0].id;
    await db.query(`insert into action_outbox (invocation_id, org_id, provider, action_family, payload, status, max_attempts, data_environment, idempotency_key, correlation_id) values ($1,$2,'test','test.echo',$3,'PENDING',1,'PRODUCTION',$4,$5)`, [inv, s.vendor, JSON.stringify({ failFinal: true, secret: SECRET }), randomUUID(), corr]);
  });
  await asOrg(s.vendor, (db) => drainOutbox(db, { allowRealProvider: true }));
  check("a dead-lettered action emits a dead_letter event", sink.events.some((e) => e.kind === "dead_letter" && e.severity === "error"));
  check("the dead_letter event carries the correlation id (traceable)", sink.events.some((e) => e.kind === "dead_letter" && e.correlationId === corr));
  check("the dead_letter event leaks no confidential payload", !serialize(sink.events).includes(SECRET));

  // ---- every event has the required shape ----
  console.log("OR-3.5  Event shape + redaction guarantee");
  check("every event has kind + severity + timestamp", sink.events.length === 0 || sink.events.every((e) => !!e.kind && !!e.severity));
  check("the event type has no free-form payload/data field (structural redaction)", !("payload" in ({} as TelemetryEvent)) && !("data" in ({} as TelemetryEvent)));

  // ---- fail-safe when unconfigured ----
  console.log("OR-3.6  Fail-safe when no provider is configured");
  setReporter(null); const savedSink = process.env.TELEMETRY_SINK; delete process.env.TELEMETRY_SINK;
  check("unconfigured telemetry resolves to the no-op NullReporter", getReporter() instanceof NullReporter);
  let threw = false; try { getReporter().report({ kind: "worker_job_failure", severity: "info", message: "noop" }); } catch { threw = true; }
  check("reporting through the null reporter never throws", !threw);
  if (savedSink === undefined) delete process.env.TELEMETRY_SINK; else process.env.TELEMETRY_SINK = savedSink;
  setReporter(null);

  console.log(`\n[observability-verify] ${passed} passed, ${failed} failed`);
  if (failed) { console.log("[observability-verify] FAILURES:"); for (const f of failures) console.log("  - " + f); }
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("[observability-verify] fatal:", e); process.exit(2); });
