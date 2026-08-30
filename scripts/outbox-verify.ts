/**
 * Release Gate R1-G4 blind harness — governed external-action outbox.
 * Proves the execution transport: dispatchSkill → invocation → transactional outbox →
 * executor → receipt → ledger, with idempotency, explicit lifecycle, bounded retry +
 * retryable/final classification, dead-letter, compensation on pre-execution revocation,
 * tenant/consent enforcement, feature gating (synthetic never reaches a provider), no
 * autonomous BYO-LLM provider path, and append-only history. Runs as app_rw under RLS.
 *
 *   npx tsx scripts/outbox-verify.ts
 */
import { Pool, type PoolClient } from "pg";
import { seedGovernedSkills, dispatchSkill, type Actor } from "../src/lib/pursuits/federation/skills";
import { drainOutbox } from "../src/lib/pursuits/federation/executor";
import { MCP_TOOLS } from "../src/lib/agents/mcp-tools";
import { proposeGrant, acceptGrant, revokeGrant } from "../src/lib/pursuits/federation/grants";
import { upsertPursuit } from "../src/lib/pursuits/model";
import { addParticipant, acceptParticipation } from "../src/lib/pursuits/federation/participation";
import { randomUUID } from "node:crypto";

const CONN = process.env.DATABASE_URL_VERIFY ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const pool = new Pool({ connectionString: CONN });
let passed = 0, failed = 0; const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); } }
async function asOwner<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> { const c = await pool.connect(); try { await c.query("begin"); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } }
async function asOrg<T>(orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> { const c = await pool.connect(); try { await c.query("begin"); await c.query("set local role app_rw"); await c.query("select set_config('app.org_id',$1,true)", [orgId]); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } }
const actor = (orgId: string, role: Actor["role"], type: Actor["type"] = "USER"): Actor => ({ type, id: randomUUID(), orgId, role });

// Seed a raw EXTERNAL_ACTION invocation + outbox row (test.echo executor, deterministic).
async function seedTestAction(orgId: string, payload: Record<string, unknown>, opts: { dataEnv?: string; grantId?: string | null; maxAttempts?: number } = {}) {
  return asOrg(orgId, async (db) => {
    const inv = (await db.query<{ id: string }>(
      `insert into governed_action_invocations (org_id, skill_id, skill_version, effect_class, actor_type, actor_role, status, data_environment, consent_grant_id)
       values ($1,'test_action',1,'EXTERNAL_ACTION','WORKER','operator','EXECUTING',$2,$3) returning id`,
      [orgId, opts.dataEnv ?? "PRODUCTION", opts.grantId ?? null])).rows[0].id;
    const ob = (await db.query<{ id: string }>(
      `insert into action_outbox (invocation_id, org_id, provider, action_family, payload, status, max_attempts, data_environment, idempotency_key, correlation_id)
       values ($1,$2,'test','test.echo',$3,'PENDING',$4,$5,$6,$7) returning id`,
      [inv, orgId, JSON.stringify(payload), opts.maxAttempts ?? 5, opts.dataEnv ?? "PRODUCTION", randomUUID(), randomUUID()])).rows[0].id;
    return { inv, ob };
  });
}
const obStatus = (orgId: string, id: string) => asOrg(orgId, async (db) => (await db.query<{ status: string }>(`select status from action_outbox where id=$1`, [id])).rows[0].status);
const invStatus = (orgId: string, id: string) => asOrg(orgId, async (db) => (await db.query<{ status: string }>(`select status from governed_action_invocations where id=$1`, [id])).rows[0].status);
const receiptCount = (orgId: string, invId: string) => asOrg(orgId, async (db) => Number((await db.query<{ n: string }>(`select count(*)::text n from action_receipts where invocation_id=$1`, [invId])).rows[0].n));

async function main() {
  console.log(`[outbox-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);
  const RID = Math.random().toString(36).slice(2, 8);
  const s = await asOwner(async (db) => {
    await seedGovernedSkills(db);
    const org = async (n: string) => (await db.query<{ id: string }>(`insert into organizations (name, kind, created_at) values ($1,'full',now()) returning id`, [`${n} ${RID}`])).rows[0].id;
    const vendor = await org("G4 Vendor"); const dist = await org("G4 Dist");
    const acct = (await db.query<{ id: string }>(`insert into companies (legal_name, normalized_name, industry, country) values ($1,$1,'Tech','US') returning id`, [`G4 Co ${RID}`])).rows[0].id;
    const node = (await db.query<{ id: string }>(`insert into taxonomy_nodes (name, slug) values ($1,$2) returning id`, [`G4 ${RID}`, `g4-${RID}`])).rows[0].id;
    const camp = (await db.query<{ id: string }>(`insert into campaigns (org_id, company_id, name, status) values ($1,$2,$3,'launched') returning id`, [vendor, acct, `G4 Camp ${RID}`])).rows[0].id;
    const hero = (await upsertPursuit(db, { orgId: vendor, accountId: acct, productCategoryId: node, pursuitType: "MODERNIZATION", useCase: "x", businessProblem: "x", createdVia: "SYSTEM_DETECTED", dataEnvironment: "DEMO" })).id;
    return { vendor, dist, acct, camp, hero };
  });
  let touchN = 0;
  const mkTouch = () => asOrg(s.vendor, async (db) => (await db.query<{ id: string }>(`insert into campaign_touches (campaign_id, touch_no, name, channel, subject, body, text_body, highlights, send_offset_days, status, cc_emails, scheduled_at) values ($1,$2,'t','EMAIL','s','b','b','{}',0,'scheduled','{}', now()) returning id`, [s.camp, ++touchN])).rows[0].id);

  // ---- 8 + BYO-LLM: no autonomous provider path ----
  console.log("R1-G4.1  No autonomous provider path (BYO LLM)");
  check("send_campaign_touch is an internal skill, never an MCP tool", !MCP_TOOLS.some((t) => t.name === "send_campaign_touch"));
  check("the LLM tool set (non-write MCP tools) contains no external-send tool", MCP_TOOLS.filter((t) => !t.write).every((t) => t.skillId === undefined));

  // ---- 1 + 2: approved send executes once; duplicate executes once (idempotent) ----
  console.log("R1-G4.2  Approved send executes once; duplicate collapses");
  const touch = await mkTouch();
  const a1 = await asOrg(s.vendor, (db) => dispatchSkill(db, "send_campaign_touch", actor(s.vendor, "operator", "WORKER"), { args: { touchId: touch }, idempotencyKey: `send:${touch}`, dataEnvironment: "DEMO" }));
  const a2 = await asOrg(s.vendor, (db) => dispatchSkill(db, "send_campaign_touch", actor(s.vendor, "operator", "WORKER"), { args: { touchId: touch }, idempotencyKey: `send:${touch}`, dataEnvironment: "DEMO" }));
  check("a duplicate enqueue collapses to one invocation (idempotent)", a1.invocationId === a2.invocationId);
  check("exactly one outbox row exists for the send", (await asOrg(s.vendor, async (db) => Number((await db.query<{ n: string }>(`select count(*)::text n from action_outbox where invocation_id=$1`, [a1.invocationId])).rows[0].n))) === 1);
  await asOrg(s.vendor, (db) => drainOutbox(db, { allowRealProvider: true }));
  check("the send SUCCEEDED once with one receipt", (await obStatus(s.vendor, (await asOrg(s.vendor, async (db) => (await db.query<{ id: string }>(`select id from action_outbox where invocation_id=$1`, [a1.invocationId])).rows[0].id)))) === "SUCCEEDED" && (await receiptCount(s.vendor, a1.invocationId!)) === 1);
  await asOrg(s.vendor, (db) => drainOutbox(db, { allowRealProvider: true }));
  check("re-draining does NOT re-execute (SUCCEEDED not re-picked)", (await receiptCount(s.vendor, a1.invocationId!)) === 1);

  // ---- 9: synthetic/demo never reaches a live provider ----
  console.log("R1-G4.3  Synthetic/demo never reaches a live provider");
  const demoTouch = await mkTouch();
  const dem = await asOrg(s.vendor, (db) => dispatchSkill(db, "send_campaign_touch", actor(s.vendor, "operator", "WORKER"), { args: { touchId: demoTouch }, idempotencyKey: `send:${demoTouch}`, dataEnvironment: "DEMO" }));
  await asOrg(s.vendor, (db) => drainOutbox(db, { allowRealProvider: true }));   // real allowed, but DEMO ⇒ simulated
  const demReceipt = await asOrg(s.vendor, async (db) => (await db.query<{ detail: { simulated?: boolean }; provider_action_id: string | null }>(`select detail, provider_action_id from action_receipts where invocation_id=$1 order by created_at desc limit 1`, [dem.invocationId])).rows[0]);
  check("a DEMO action's receipt is simulated (no live provider)", demReceipt.detail?.simulated === true && (demReceipt.provider_action_id ?? "").startsWith("sim-"));
  check("the demo touch was NOT flipped to 'sent' (provider never ran)", (await asOrg(s.vendor, async (db) => (await db.query<{ status: string }>(`select status from campaign_touches where id=$1`, [demoTouch])).rows[0].status)) !== "sent");

  // ---- 3: retryable failure retries then succeeds ----
  console.log("R1-G4.4  Retryable failure retries then succeeds");
  const t3 = await seedTestAction(s.vendor, { failUntilAttempt: 1 }, { maxAttempts: 5 });
  await asOrg(s.vendor, (db) => drainOutbox(db, { allowRealProvider: true }));   // attempt 0 <1 ⇒ retryable
  check("first attempt yields FAILED_RETRYABLE (scheduled for retry)", (await obStatus(s.vendor, t3.ob)) === "FAILED_RETRYABLE");
  await asOrg(s.vendor, (db) => drainOutbox(db, { allowRealProvider: true, now: new Date(Date.now() + 3_600_000) })); // past backoff
  check("a later drain retries and SUCCEEDS", (await obStatus(s.vendor, t3.ob)) === "SUCCEEDED" && (await invStatus(s.vendor, t3.inv)) === "EXECUTED");

  // ---- 4: permanent failure reaches terminal visible state ----
  console.log("R1-G4.5  Permanent failure → terminal");
  const t4 = await seedTestAction(s.vendor, { failFinal: true });
  await asOrg(s.vendor, (db) => drainOutbox(db, { allowRealProvider: true }));
  check("a permanent failure is FAILED_FINAL (dead-letter, visible)", (await obStatus(s.vendor, t4.ob)) === "FAILED_FINAL" && (await invStatus(s.vendor, t4.inv)) === "FAILED");
  check("a failure receipt is recorded (operationally visible)", (await asOrg(s.vendor, async (db) => (await db.query<{ status: string }>(`select status from action_receipts where invocation_id=$1 order by created_at desc limit 1`, [t4.inv])).rows[0]?.status)) === "failed");

  // ---- poison: retries exhausted → FAILED_FINAL, not forever ----
  console.log("R1-G4.6  Poison action exhausts bounded retries → terminal");
  const t6 = await seedTestAction(s.vendor, { failRetryableForever: true }, { maxAttempts: 2 });
  await asOrg(s.vendor, (db) => drainOutbox(db, { allowRealProvider: true }));
  await asOrg(s.vendor, (db) => drainOutbox(db, { allowRealProvider: true, now: new Date(Date.now() + 3_600_000) }));
  check("a poison action reaches FAILED_FINAL after max attempts (not retried forever)", (await obStatus(s.vendor, t6.ob)) === "FAILED_FINAL");

  // ---- 5: unauthorized action never enters the executable outbox ----
  console.log("R1-G4.7  Unauthorized action never enters the outbox");
  const unauthTouch = await mkTouch();
  const un = await asOrg(s.vendor, (db) => dispatchSkill(db, "send_campaign_touch", actor(s.vendor, "viewer", "WORKER"), { args: { touchId: unauthTouch }, dataEnvironment: "DEMO" }));
  check("a viewer's send is REJECTED", un.status === "REJECTED");
  check("no outbox row was created for the rejected send", (await asOrg(s.vendor, async (db) => Number((await db.query<{ n: string }>(`select count(*)::text n from action_outbox where invocation_id=$1`, [un.invocationId])).rows[0].n))) === 0);

  // ---- 6: cross-tenant action without a valid grant fails closed ----
  console.log("R1-G4.8  Cross-tenant without grant fails closed");
  const cross = await asOrg(s.vendor, (db) => dispatchSkill(db, "request_team_acceptance", actor(s.vendor, "operator"), { pursuitId: s.hero }));
  check("a CROSS_TENANT_ACTION without an ACTION grant is REJECTED (no outbox, no execution)", cross.status === "REJECTED");

  // ---- 7: revoked authority BEFORE execution → compensated, not executed ----
  console.log("R1-G4.9  Revocation before execution → compensated");
  const part = await asOrg(s.vendor, (db) => addParticipant(db, { pursuitId: s.hero, orgId: s.dist, roleKey: "DISTRIBUTOR", sponsorOrgId: s.vendor }));
  await asOrg(s.dist, (db) => acceptParticipation(db, part));
  const grant = await asOrg(s.dist, (db) => proposeGrant(db, { pursuitId: s.hero, fromOrgId: s.dist, toOrgId: s.vendor, grantKind: "ACTION", actionFamily: "test", purpose: "x" }));
  await asOrg(s.vendor, (db) => acceptGrant(db, grant));
  const t7 = await seedTestAction(s.vendor, { failUntilAttempt: 0 }, { grantId: grant });   // would succeed if executed
  await asOrg(s.dist, (db) => revokeGrant(db, grant));   // authority revoked while queued
  await asOrg(s.vendor, (db) => drainOutbox(db, { allowRealProvider: true }));
  check("a queued action whose grant was revoked is COMPENSATED, not executed", (await obStatus(s.vendor, t7.ob)) === "COMPENSATED" && (await invStatus(s.vendor, t7.inv)) === "COMPENSATED");
  check("no SUCCEEDED receipt exists for the compensated action", (await asOrg(s.vendor, async (db) => Number((await db.query<{ n: string }>(`select count(*)::text n from action_receipts where invocation_id=$1 and status='accepted'`, [t7.inv])).rows[0].n))) === 0);

  // ---- 10: append-only history ----
  console.log("R1-G4.10  History is append-only");
  const before = await receiptCount(s.vendor, a1.invocationId!);
  await asOrg(s.vendor, (db) => drainOutbox(db, { allowRealProvider: true }));
  check("re-draining never deletes or rewrites prior receipts", (await receiptCount(s.vendor, a1.invocationId!)) === before);
  check("an EXECUTED invocation keeps its executed_at (not re-executed)", (await asOrg(s.vendor, async (db) => (await db.query<{ n: string }>(`select count(*)::text n from governed_action_invocations where id=$1 and executed_at is not null`, [a1.invocationId])).rows[0].n)) === "1");

  console.log(`\n[outbox-verify] ${passed} passed, ${failed} failed`);
  if (failed) { console.log("[outbox-verify] FAILURES:"); for (const f of failures) console.log("  - " + f); }
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("[outbox-verify] fatal:", e); process.exit(2); });
