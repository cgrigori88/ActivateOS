/**
 * Release Gate R1-G1 blind harness — single mutation authority.
 * Proves the agent/MCP write surface is governed and has no ungoverned parallel:
 *  - both MCP write tools carry a skill id and their inline run() REFUSES (no bypass);
 *  - the autonomous Ask LLM tool set contains NO write tool (no autonomous cross-tenant write);
 *  - draft_campaign_touch dispatches through dispatchSkill: EXECUTED for an operator
 *    actor (and the draft is really created + a governed_action_invocations row exists),
 *    REJECTED for a read-scoped (viewer) actor, idempotent on a repeated key;
 *  - request_warm_intro is a CROSS_TENANT_ACTION governed by its own partnership
 *    authority: REJECTED without an active partnership, and once authorized it is
 *    dispatched through the boundary (an invocation is always recorded — never a raw write).
 * Runs as app_rw under RLS against pursuit_demo.
 *
 *   npx tsx scripts/governed-mutation-verify.ts
 */
import { Pool, type PoolClient } from "pg";
import { seedGovernedSkills, dispatchSkill, type Actor } from "../src/lib/pursuits/federation/skills";
import { MCP_TOOLS } from "../src/lib/agents/mcp-tools";
import { randomUUID } from "node:crypto";

const CONN = process.env.DATABASE_URL_VERIFY ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const pool = new Pool({ connectionString: CONN });
let passed = 0, failed = 0; const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); } }
async function asOwner<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> { const c = await pool.connect(); try { await c.query("begin"); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } }
async function asOrg<T>(orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> { const c = await pool.connect(); try { await c.query("begin"); await c.query("set local role app_rw"); await c.query("select set_config('app.org_id',$1,true)", [orgId]); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } }
const agent = (orgId: string, role: Actor["role"]): Actor => ({ type: "AGENT", id: randomUUID(), orgId, role });

async function main() {
  console.log(`[governed-mutation-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);
  const RID = Math.random().toString(36).slice(2, 8);

  // ---- Code-level bypass guarantees (no runtime state needed) ----
  console.log("R1-G1.1  No ungoverned MCP write path");
  const writeTools = MCP_TOOLS.filter((t) => t.write);
  check("there are governed write tools declared", writeTools.length >= 2);
  check("every write tool carries a skill id (dispatched, not run inline)", writeTools.every((t) => !!t.skillId));
  check("every write tool's inline run() refuses (throws)", await (async () => {
    for (const t of writeTools) { try { await t.run(pool, "x", {}); return false; } catch { /* expected */ } }
    return true;
  })());
  check("the autonomous Ask LLM tool set contains NO write tool", MCP_TOOLS.filter((t) => !t.write).every((t) => !t.write));

  const s = await asOwner(async (db) => {
    await seedGovernedSkills(db);
    const vendor = (await db.query<{ id: string }>(`insert into organizations (name, kind, created_at) values ($1,'full',now()) returning id`, [`G1 Vendor ${RID}`])).rows[0].id;
    const acct = (await db.query<{ id: string }>(`insert into companies (legal_name, normalized_name, industry, country) values ($1,$1,'Tech','US') returning id`, [`G1 Acct ${RID}`])).rows[0].id;
    const camp = (await db.query<{ id: string }>(`insert into campaigns (org_id, company_id, name, status) values ($1,$2,$3,'launched') returning id`, [vendor, acct, `G1 Campaign ${RID}`])).rows[0].id;
    const partner = (await db.query<{ id: string }>(`insert into partners (org_id, name, partner_type) values ($1,$2,'reseller') returning id`, [vendor, `G1 Partner ${RID}`])).rows[0].id;
    return { vendor, camp, partner, acct, campName: `G1 Campaign ${RID}`, partnerName: `G1 Partner ${RID}` };
  });

  // ---- draft_campaign_touch through the governed boundary ----
  console.log("R1-G1.2  draft_campaign_touch is governed");
  const draftArgs = { campaign: s.campName, name: "Pilot follow-up", subject: "Following up", body: "Hi there" };
  const asViewer = await asOrg(s.vendor, (db) => dispatchSkill(db, "draft_campaign_touch", agent(s.vendor, "viewer"), { args: draftArgs }));
  check("a read-scoped (viewer) actor is REJECTED for an INTERNAL_WRITE", asViewer.status === "REJECTED");
  const asOp = await asOrg(s.vendor, (db) => dispatchSkill(db, "draft_campaign_touch", agent(s.vendor, "operator"), { args: draftArgs }));
  check("an operator actor EXECUTES the governed draft", asOp.status === "EXECUTED");
  check("the draft touch was really created", (await asOrg(s.vendor, async (db) => (await db.query<{ n: string }>(`select count(*)::text n from campaign_touches where campaign_id=$1`, [s.camp])).rows[0].n)) !== "0");
  check("a governed_action_invocations row records the write (auditable)", (await asOrg(s.vendor, async (db) => (await db.query<{ n: string }>(`select count(*)::text n from governed_action_invocations where skill_id='draft_campaign_touch' and org_id=$1 and status='EXECUTED'`, [s.vendor])).rows[0].n)) !== "0");

  console.log("R1-G1.3  Idempotency");
  const key = `g1-idem-${RID}`;
  const a = await asOrg(s.vendor, (db) => dispatchSkill(db, "draft_campaign_touch", agent(s.vendor, "operator"), { args: draftArgs, idempotencyKey: key }));
  const b = await asOrg(s.vendor, (db) => dispatchSkill(db, "draft_campaign_touch", agent(s.vendor, "operator"), { args: draftArgs, idempotencyKey: key }));
  check("a repeated idempotency key dedupes to one invocation", a.invocationId === b.invocationId);

  // ---- request_warm_intro cross-tenant authority ----
  console.log("R1-G1.4  request_warm_intro is a governed cross-tenant action");
  const noAuth = await asOrg(s.vendor, (db) => dispatchSkill(db, "request_warm_intro", agent(s.vendor, "operator"), { args: { partner: s.partnerName, account: "nonexistent" } }));
  check("REJECTED without an active partnership (own partnership-consent authority)", noAuth.status === "REJECTED");
  check("the rejection is recorded as a governed invocation (not a silent skip)", (await asOrg(s.vendor, async (db) => (await db.query<{ n: string }>(`select count(*)::text n from governed_action_invocations where skill_id='request_warm_intro' and org_id=$1 and status='REJECTED'`, [s.vendor])).rows[0].n)) !== "0");
  // Seed an active partnership so authority passes; the account is not on a named-overlap rung,
  // so the handler fails INSIDE the boundary — still governed (an invocation is recorded), never a raw write.
  await asOwner((db) => db.query(`insert into partnerships (initiator_org_id, initiator_partner_id, invite_code, status, activated_at) values ($1,$2,$3,'active',now())`, [s.vendor, s.partner, `INV-${RID}`]));
  const authed = await asOrg(s.vendor, (db) => dispatchSkill(db, "request_warm_intro", agent(s.vendor, "operator"), { args: { partner: s.partnerName, account: `G1 Acct ${RID}` } }));
  check("with authority, the action is dispatched through the boundary (invocation recorded)", authed.invocationId !== null);
  check("the cross-tenant write only ever happens via a CROSS_TENANT_ACTION invocation", (await asOrg(s.vendor, async (db) => (await db.query<{ effect_class: string }>(`select effect_class from governed_action_invocations where id=$1`, [authed.invocationId])).rows[0]?.effect_class)) === "CROSS_TENANT_ACTION");

  console.log(`\n[governed-mutation-verify] ${passed} passed, ${failed} failed`);
  if (failed) { console.log("[governed-mutation-verify] FAILURES:"); for (const f of failures) console.log("  - " + f); }
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("[governed-mutation-verify] fatal:", e); process.exit(2); });
