/**
 * P45-4 — AGENT ACTOR EXECUTES A GRANTED CAPABILITY.
 *
 * > A production AGENT credential resolves to a durable governed actor, that actor holds an exact
 * > live capability grant, and one real consequential same-org action executes through the existing
 * > governed chokepoint with immutable actor + credential + grant attribution.
 *
 * THE CORE POSITIVE DRIVES THE REAL PRODUCT PATH — the `/api/mcp` route handler itself, with a real
 * bearer token, not this file calling `dispatchSkill`. Everything between the credential and the
 * audit row is the deployed code:
 *
 *   bearer → resolve_api_key → ResolvedApiCredential → MCP Actor → governed actor context
 *          → exact live grant → dispatchSkill → draft_campaign_touch → touch → invocation audit
 *
 * §16N GOVERNS EVERY REFUSAL HERE: a rejection only certifies the check that produced it, so each
 * negative asserts the RECORDED REASON, and the probes are ordered so that no earlier guard can
 * mask a later one. A suite that merely observed "REJECTED" would certify nothing.
 *
 * SEEDED CLONE. This commits governed actors, grants, credentials, touches and invocations through
 * real application paths, so it must never run against the canonical world.
 */
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { assertSeededClone } from "./seeded-clone";
import { withTenantOrg } from "../src/lib/db/tenant";
import { provisionGovernedAgent } from "../src/lib/runtime/agent-provisioning";
import { dispatchSkill, type Actor } from "../src/lib/pursuits/federation/skills";
import { POST as MCP_POST } from "../src/app/api/mcp/route";
import type { NextRequest } from "next/server";

const URL_ = process.env.DATABASE_URL_VERIFY ?? process.env.DATABASE_URL ?? "";
const pool = new Pool({ connectionString: URL_, max: 4 });
let pass = 0, fail = 0;
const ck = (n: string, ok: boolean, d?: unknown) => { ok ? pass++ : fail++; console.log(`  ${ok ? "\u2713" : "\u2717"}  ${n}${d === undefined ? "" : ` \u2014 ${JSON.stringify(d)}`}`); };
const note = (n: string, d?: unknown) => console.log(`  ·  ${n}${d === undefined ? "" : ` — ${JSON.stringify(d)}`}`);
const HD = (s: string) => console.log(`\n── ${s}`);
const NS = `p454-${Math.random().toString(36).slice(2, 8)}`;

/** The gate under test is an env var, so it is set and restored explicitly around each posture. */
function withEnforcement<T>(on: boolean, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.GOVERNED_AGENT_ENFORCEMENT_ENABLED;
  if (on) process.env.GOVERNED_AGENT_ENFORCEMENT_ENABLED = "true";
  else delete process.env.GOVERNED_AGENT_ENFORCEMENT_ENABLED;
  return fn().finally(() => {
    if (prev === undefined) delete process.env.GOVERNED_AGENT_ENFORCEMENT_ENABLED;
    else process.env.GOVERNED_AGENT_ENFORCEMENT_ENABLED = prev;
  });
}

/** One real MCP call: the deployed route handler, a real bearer, a real JSON-RPC body. */
async function mcpCall(bearer: string, name: string, args: Record<string, unknown>) {
  const req = new Request("https://verify.local/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }) as unknown as NextRequest;
  const res = await MCP_POST(req);
  const body = await res.json() as any;
  const text = body?.result?.content?.[0]?.text;
  return { status: res.status, body, isError: body?.result?.isError === true,
           payload: text ? JSON.parse(text) : null, rpcError: body?.error?.message ?? null };
}

const q = async (s: string, p: unknown[] = []) => (await pool.query(s, p)).rows as any[];
const one = async (s: string, p: unknown[] = []) => (await q(s, p))[0];
/** The audit row for the most recent attempt at this skill by this credential. */
const lastInvocation = (orgId: string, keyId: string) => one(
  `select status, reason, actor_id, governed_actor_id, grant_id, result
     from governed_action_invocations
    where org_id = $1 and skill_id = 'draft_campaign_touch' and actor_id = $2
    order by requested_at desc, id desc limit 1`, [orgId, keyId]);

async function main() {
  await assertSeededClone(pool);
  console.log(`P45-4 — governed agent capability execution  (${NS})`);

  // OWN FIXTURES, NOT THE CANONICAL WORLD'S. The certified world has zero campaigns (see the
  // p45-runtime entry in verify-classes), and a suite that writes drafts into whatever campaign
  // happens to exist would be asserting against accreted state nobody authored.
  const org = (await one(`insert into organizations (name) values ($1) returning id, name`, [`P45-4 ${NS}`]));
  const foreign = (await one(`insert into organizations (name) values ($1) returning id`, [`P45-4 foreign ${NS}`]));
  const company = (await one(`insert into companies (legal_name, normalized_name) values ($1,$2) returning id`,
    [`P45-4 Co ${NS}`, `p454-co-${NS}`]));
  const campaign = (await one(`insert into campaigns (org_id, company_id, name, status, source)
                               values ($1,$2,$3,'draft','user') returning id, name`, [org.id, company.id, `P45-4 campaign ${NS}`]));
  await pool.query(`insert into org_features (org_id, governed_action) values ($1, true)
                    on conflict (org_id) do update set governed_action = true`, [org.id]);
  note("tenant under test", { org: org.name, campaign: campaign.name });
  const draftArgs = (n: string) => ({ campaign: campaign.name, name: n, subject: `${NS} subject`, body: `${NS} body` });

  // ── PROVISIONING ──────────────────────────────────────────────────────────────────────────────
  HD("PROVISIONING — actor, then grant, then a credential minted already bound");
  const agent = await withTenantOrg(org.id, (db) => provisionGovernedAgent(db, org.id, {
    key: `${NS}-agent`, displayName: `Research Agent ${NS}`, purpose: "P45-4 acceptance",
    skillId: "draft_campaign_touch", skillVersion: 1, keyName: `${NS}-bound`,
    // This suite IS a certification gate, and now says so. Before 0120 its provisioning inherited
    // PRODUCTION by default, which is precisely how the hosted gate credential produced 17
    // invocations claiming the one learning-eligible environment.
    dataEnvironment: "CERTIFICATION",
  }));
  const actorRow = await one(`select actor_type, lifecycle, principal_user_id from governed_actors where id = $1`, [agent.actorId]);
  ck("a governed AGENT exists, ACTIVE, with no user principal", actorRow.actor_type === "AGENT"
    && actorRow.lifecycle === "ACTIVE" && actorRow.principal_user_id === null, actorRow);
  const grantRow = await one(`select skill_id, skill_version, status, expires_at from actor_capability_grants where id = $1`, [agent.grantId]);
  ck("its grant names the EXACT capability version, not a wildcard",
    grantRow.skill_id === "draft_campaign_touch" && grantRow.skill_version === 1, grantRow);
  const keyRow = await one(`select governed_actor_id, scope, revoked_at from api_keys where id = $1`, [agent.keyId]);
  ck("the credential is bound to that actor at issue", keyRow.governed_actor_id === agent.actorId, keyRow);

  // A legacy Slice 14 credential — UNBOUND, exactly as one minted before this slice.
  //
  // IT IS UNBOUND, NOT UNCLASSIFIED, AND SINCE 0120 THOSE ARE TWO INDEPENDENT FACTS. Binding is
  // about AUTHORITY (which governed actor acts); provenance is about DATA (what kind of rows the
  // execution produces). This fixture exists to prove the authority compatibility contract, so it
  // carries provenance and varies only the binding — otherwise it would be testing two changes at
  // once and would fail for the wrong reason.
  const { mintKey } = await import("../src/lib/agents/mcp-tools");
  const legacy = mintKey();
  const legacyId = (await one(
    `insert into api_keys (org_id, name, key_hash, scope, data_environment)
     values ($1,$2,$3,'write','CERTIFICATION') returning id`,
    [org.id, `${NS}-legacy`, legacy.hash])).id;
  ck("a legacy unbound credential exists for the compatibility control",
    (await one(`select governed_actor_id from api_keys where id = $1`, [legacyId])).governed_actor_id === null);
  // And the OTHER half of that separation: a credential with no provenance at all cannot write,
  // whatever its binding. The route refuses before dispatching, so no invocation row is created —
  // which is the only coherent outcome, since that row could not be labelled either.
  const unclassified = mintKey();
  const unclassifiedId = (await one(
    `insert into api_keys (org_id, name, key_hash, scope) values ($1,$2,$3,'write') returning id`,
    [org.id, `${NS}-unclassified`, unclassified.hash])).id;
  const invCount = async () => Number((await one(`select count(*)::int n from governed_action_invocations where org_id=$1`, [org.id])).n);
  const beforeUnclassified = await invCount();
  const unclassifiedCall = await mcpCall(unclassified.plaintext, "draft_touch", draftArgs(`${NS} unclassified`));
  // The refusal is a JSON-RPC ERROR, not a tool result carrying isError — the same channel the
  // identity refusal two lines above uses, because in both cases the CALL is inadmissible rather
  // than the tool having failed.
  ck("a credential with NO data provenance is refused, and writes no invocation at all",
    unclassifiedCall.rpcError !== null && /provenance/i.test(unclassifiedCall.rpcError)
    && (await invCount()) === beforeUnclassified,
    { rpcError: unclassifiedCall.rpcError, keyId: unclassifiedId });

  // ── CORE POSITIVE ─────────────────────────────────────────────────────────────────────────────
  HD("CORE POSITIVE — enforcement ON, through the real /api/mcp route");
  const exec = await withEnforcement(true, () => mcpCall(agent.plaintext, "draft_touch", draftArgs(`${NS} governed`)));
  ck("the route executed the governed write", exec.status === 200 && exec.isError === false && exec.payload?.created === true,
    { status: exec.status, payload: exec.payload });
  const inv = await lastInvocation(org.id, agent.keyId);
  note("the audit row", { status: inv?.status, actor_id: inv?.actor_id?.slice(0, 8), governed: inv?.governed_actor_id?.slice(0, 8), grant: inv?.grant_id?.slice(0, 8) });
  ck("IDENTITY — actor_id is the CREDENTIAL, unchanged legacy semantics", inv?.actor_id === agent.keyId);
  ck("IDENTITY — governed_actor_id is the DURABLE AGENT, in its own column", inv?.governed_actor_id === agent.actorId);
  ck("IDENTITY — the two are different values; neither was overloaded", inv?.actor_id !== inv?.governed_actor_id);
  ck("ATTRIBUTION — the invocation records the EXACT grant that authorized it", inv?.grant_id === agent.grantId,
    { recorded: inv?.grant_id, expected: agent.grantId });
  const touchId = exec.payload?.touchId;
  const touch = await one(`select id, status, name from campaign_touches where id = $1`, [touchId]);
  ck("PRODUCT MUTATION — a real campaign touch exists, in DRAFT", touch?.status === "draft", touch);
  ck("NO EXTERNAL SEND — nothing was queued or sent",
    Number((await one(`select count(*)::int n from campaign_touches where id = $1 and sent_at is not null`, [touchId])).n) === 0
    && Number((await one(`select count(*)::int n from governed_action_invocations where org_id = $1 and effect_class = 'EXTERNAL_ACTION' and skill_id = 'send_campaign_touch' and requested_at > now() - interval '2 minutes'`, [org.id])).n) === 0);
  ck("TELEMETRY — no model, token or cost column exists to attribute in this slice",
    (await q(`select column_name from information_schema.columns where table_name='governed_action_invocations'
               and column_name in ('model_provider','model_id','model_version','input_tokens','output_tokens','cost_usd','latency_ms')`)).length === 0);

  // ── IDENTITY CANNOT COME FROM THE PAYLOAD ─────────────────────────────────────────────────────
  HD("TRUSTED IDENTITY — a payload may not nominate authority");
  for (const field of ["governedActorId", "actorId", "grantId", "orgId", "organizationId"]) {
    const before = Number((await one(`select count(*)::int n from governed_action_invocations where org_id = $1`, [org.id])).n);
    const r = await withEnforcement(true, () => mcpCall(agent.plaintext, "draft_touch",
      { ...draftArgs(`${NS} forged ${field}`), [field]: agent.actorId }));
    const after = Number((await one(`select count(*)::int n from governed_action_invocations where org_id = $1`, [org.id])).n);
    ck(`a payload \`${field}\` is REJECTED at the boundary, not ignored, and dispatches nothing`,
      /credential/i.test(r.rpcError ?? "") && after === before, { rpcError: r.rpcError });
  }

  // ── LIFECYCLE ─────────────────────────────────────────────────────────────────────────────────
  HD("LIFECYCLE — an inactive agent cannot act, whatever it holds");
  for (const state of ["DRAFT", "SUSPENDED", "RETIRED"]) {
    await pool.query(`update governed_actors set lifecycle = $2 where id = $1`, [agent.actorId, state]);
    const r = await withEnforcement(true, () => mcpCall(agent.plaintext, "draft_touch", draftArgs(`${NS} ${state}`)));
    const row = await lastInvocation(org.id, agent.keyId);
    ck(`${state} rejects, AT THE LIFECYCLE CHECK`, r.isError === true && row.status === "REJECTED"
      && row.reason === `governed actor is ${state}`, { reason: row.reason });
  }
  await pool.query(`update governed_actors set lifecycle = 'ACTIVE' where id = $1`, [agent.actorId]);
  ck("restoring ACTIVE restores execution — the control bites in both directions",
    (await withEnforcement(true, () => mcpCall(agent.plaintext, "draft_touch", draftArgs(`${NS} restored`)))).isError === false);

  // ── GRANT ─────────────────────────────────────────────────────────────────────────────────────
  HD("GRANT — the instrument, and only the instrument, confers authority");
  const reasonFor = async (label: string) => {
    const r = await withEnforcement(true, () => mcpCall(agent.plaintext, "draft_touch", draftArgs(`${NS} ${label}`)));
    return { isError: r.isError, row: await lastInvocation(org.id, agent.keyId) };
  };
  await pool.query(`update actor_capability_grants set status='REVOKED', revoked_at=now() where id=$1`, [agent.grantId]);
  let g = await reasonFor("revoked");
  ck("a REVOKED grant rejects, at the grant check", g.isError && g.row.reason === "no active capability grant for this skill", g.row.reason);
  ck("and the refusal records no grant — a refusal attributes no authority", g.row.grant_id === null);
  await pool.query(`update actor_capability_grants set status='ACTIVE', revoked_at=null where id=$1`, [agent.grantId]);

  // Expiry is set IN SQL relative to the database's own instant: no timestamp crosses into
  // JavaScript, so the microsecond truncation that caused the P6-IG boundary flake cannot occur.
  await pool.query(`update actor_capability_grants set expires_at = transaction_timestamp() - interval '1 second' where id = $1`, [agent.grantId]);
  g = await reasonFor("expired");
  ck("an EXPIRED grant rejects, at the same check — expiry is decided by DATABASE time",
    g.isError && g.row.reason === "no active capability grant for this skill");
  ck("the expired grant is still status ACTIVE — dead for authority, live for uniqueness",
    (await one(`select status from actor_capability_grants where id=$1`, [agent.grantId])).status === "ACTIVE");
  const dup = await pool.query(
    `insert into actor_capability_grants (org_id, actor_id, skill_id, skill_version, status)
     values ($1,$2,'draft_campaign_touch',1,'ACTIVE') on conflict do nothing returning id`,
    [org.id, agent.actorId]);
  ck("UNIQUENESS — a second ACTIVE grant is refused while the expired one occupies the slot", dup.rowCount === 0);
  await pool.query(`update actor_capability_grants set expires_at = transaction_timestamp() + interval '1 hour' where id=$1`, [agent.grantId]);
  ck("moving expiry into the future restores execution",
    (await withEnforcement(true, () => mcpCall(agent.plaintext, "draft_touch", draftArgs(`${NS} unexpired`)))).isError === false);

  // RENEWAL AND WRONG VERSION, in the one sequence that proves grant identity is immutable.
  HD("VERSION — exact, and never re-pinned");
  await pool.query(`update actor_capability_grants set status='REVOKED', revoked_at=now() where id=$1`, [agent.grantId]);
  const v2 = (await one(`insert into actor_capability_grants (org_id, actor_id, skill_id, skill_version, status)
                         values ($1,$2,'draft_campaign_touch',2,'ACTIVE') returning id`, [org.id, agent.actorId])).id;
  g = await reasonFor("v2 grant");
  ck("an ACTIVE grant for @2 does NOT authorize @1", g.isError && g.row.reason === "no active capability grant for this skill");
  await pool.query(`update actor_capability_grants set status='REVOKED', revoked_at=now() where id=$1`, [v2]);
  const wildcard = (await one(`insert into actor_capability_grants (org_id, actor_id, skill_id, skill_version, status)
                               values ($1,$2,'draft_campaign_touch',null,'ACTIVE') returning id`, [org.id, agent.actorId])).id;
  g = await reasonFor("wildcard grant");
  ck("a NULL/wildcard-version grant does NOT satisfy strict AGENT enforcement",
    g.isError && g.row.reason === "no active capability grant for this skill");
  await pool.query(`update actor_capability_grants set status='REVOKED', revoked_at=now() where id=$1`, [wildcard]);
  const renewed = (await one(`insert into actor_capability_grants (org_id, actor_id, skill_id, skill_version, status)
                              values ($1,$2,'draft_campaign_touch',1,'ACTIVE') returning id`, [org.id, agent.actorId])).id;
  const okAgain = await withEnforcement(true, () => mcpCall(agent.plaintext, "draft_touch", draftArgs(`${NS} renewed`)));
  ck("revoke-then-insert renews authority, and the NEW grant is the one recorded",
    okAgain.isError === false && (await lastInvocation(org.id, agent.keyId)).grant_id === renewed, { renewed });

  // ── ELIGIBILITY ───────────────────────────────────────────────────────────────────────────────
  HD("ELIGIBILITY — a grant may narrow, never rescue");
  const excluded = (await one(`insert into actor_capability_grants (org_id, actor_id, skill_id, skill_version, status)
                               values ($1,$2,'assemble_pursuit_team',1,'ACTIVE') returning id`, [org.id, agent.actorId])).id;
  const inel = await withEnforcement(true, () => withTenantOrg(org.id, (db) => dispatchSkill(db, "assemble_pursuit_team",
    { type: "AGENT", id: agent.keyId, orgId: org.id, role: "operator" }, { dataEnvironment: "PRODUCTION", governedActorId: agent.actorId, args: {} })));
  ck("a grant for a skill whose registry EXCLUDES agents still rejects, at the eligibility check",
    inel.status === "REJECTED" && /not eligible/.test(inel.reason ?? ""), inel.reason);
  await pool.query(`delete from actor_capability_grants where id=$1`, [excluded]);

  // ── TENANT ────────────────────────────────────────────────────────────────────────────────────
  HD("TENANT — foreignness is refused relationally and disclosed as nothing");
  let relErr = "";
  try {
    await pool.query(`insert into api_keys (org_id, name, key_hash, scope, governed_actor_id)
                      values ($1,$2,$3,'write',$4)`, [foreign.id, `${NS}-x`, `${NS}-xhash`, agent.actorId]);
  } catch (e) { relErr = (e as Error).message; }
  ck("a foreign-org credential cannot bind this actor — refused by the composite FK",
    /foreign key|api_keys_governed_actor_fk/i.test(relErr), relErr.slice(0, 80));
  let grantErr = "";
  try {
    await pool.query(`insert into actor_capability_grants (org_id, actor_id, skill_id, skill_version, status)
                      values ($1,$2,'draft_campaign_touch',1,'ACTIVE')`, [foreign.id, agent.actorId]);
  } catch (e) { grantErr = (e as Error).message; }
  ck("a foreign-org grant cannot name this actor — refused relationally", /foreign key/i.test(grantErr), grantErr.slice(0, 80));
  const unknownActor = await withEnforcement(true, () => withTenantOrg(org.id, (db) => dispatchSkill(db, "draft_campaign_touch",
    { type: "AGENT", id: agent.keyId, orgId: org.id, role: "operator" },
    { dataEnvironment: "PRODUCTION", governedActorId: "00000000-0000-0000-0000-000000000000", args: draftArgs(`${NS} unknown`) })));
  ck("an actor id that does not exist is reported UNKNOWN, never as a permission failure",
    unknownActor.reason === "unknown governed actor", unknownActor.reason);

  // ── CREDENTIAL IMMUTABILITY ───────────────────────────────────────────────────────────────────
  HD("CREDENTIAL — the binding is immutable after issue");
  const rw = new Pool({ connectionString: URL_.replace(/\/\/postgres:/, "//app_rw:"), max: 1 });
  // POSITIVE CONTROL FIRST (§16B). "permission denied" on the rebind proves nothing unless app_rw
  // can demonstrably perform the update it IS entitled to — otherwise the refusal might only mean
  // it could never touch this table at all, which was already true before this slice.
  let canRevoke = false, revokeErr = "";
  try {
    await rw.query(`update api_keys set revoked_at = now() where id = $1`, [legacyId]);
    canRevoke = true;
    await pool.query(`update api_keys set revoked_at = null where id = $1`, [legacyId]);
  } catch (e) { revokeErr = (e as Error).message; }
  ck("CONTROL — app_rw CAN still revoke a credential, so the refusal below is about the column",
    canRevoke, revokeErr.slice(0, 90));
  let privErr = "";
  try { await rw.query(`update api_keys set governed_actor_id = null where id = $1`, [agent.keyId]); }
  catch (e) { privErr = (e as Error).message; }
  await rw.end().catch(() => {});
  ck("app_rw cannot rebind a credential — refused by PRIVILEGE, not by convention",
    /permission denied|column .*governed_actor_id/i.test(privErr), privErr.slice(0, 90));
  await pool.query(`update api_keys set revoked_at = now() where id = $1`, [legacyId]);
  ck("revocation works and a revoked credential resolves to nothing",
    (await withEnforcement(false, () => mcpCall(legacy.plaintext, "draft_touch", draftArgs(`${NS} revoked-key`)))).status === 401);
  await pool.query(`update api_keys set revoked_at = null where id = $1`, [legacyId]);

  // ── POSTURES ──────────────────────────────────────────────────────────────────────────────────
  HD("POSTURES — OFF preserves the certified contract; ON requires the binding");
  const offLegacy = await withEnforcement(false, () => mcpCall(legacy.plaintext, "draft_touch", draftArgs(`${NS} off-legacy`)));
  const offRow = await lastInvocation(org.id, legacyId);
  ck("OFF + unbound legacy key EXECUTES, exactly as Slice 14 certified", offLegacy.isError === false && offRow.status === "EXECUTED");
  ck("and NO governed actor or grant is invented for it", offRow.governed_actor_id === null && offRow.grant_id === null);
  const onLegacy = await withEnforcement(true, () => mcpCall(legacy.plaintext, "draft_touch", draftArgs(`${NS} on-legacy`)));
  const onRow = await lastInvocation(org.id, legacyId);
  ck("ON + unbound legacy key REJECTS, at the new mandatory-binding check", onLegacy.isError === true
    && onRow.reason === "this deployment requires an AGENT to act as a governed actor", onRow.reason);
  // The contradiction this slice had to find: binding is NOT inert, because the 0109 gate engages
  // on the presence of a governed actor, independently of the enforcement switch.
  await pool.query(`update actor_capability_grants set status='REVOKED', revoked_at=now() where id=$1`, [renewed]);
  const offBoundNoGrant = await withEnforcement(false, () => mcpCall(agent.plaintext, "draft_touch", draftArgs(`${NS} off-bound`)));
  const obRow = await lastInvocation(org.id, agent.keyId);
  ck("OFF + BOUND key with no live grant REJECTS — by the pre-existing 0109 gate. Binding is not inert",
    offBoundNoGrant.isError === true && obRow.reason === "no active capability grant for this skill", obRow.reason);
  const final = (await one(`insert into actor_capability_grants (org_id, actor_id, skill_id, skill_version, status)
                            values ($1,$2,'draft_campaign_touch',1,'ACTIVE') returning id`, [org.id, agent.actorId])).id;
  ck("OFF + bound key WITH a live grant executes and is fully attributed",
    (await withEnforcement(false, () => mcpCall(agent.plaintext, "draft_touch", draftArgs(`${NS} off-bound-granted`)))).isError === false
    && (await lastInvocation(org.id, agent.keyId)).grant_id === final);

  // ── WORKER IS OUT OF SCOPE ────────────────────────────────────────────────────────────────────
  HD("WORKER — untouched under both postures");
  // `actor_id` is a uuid column; the production scheduler passes a label, which is its own
  // pre-existing matter. What is under test here is the ACTOR TYPE, so the id is a valid uuid.
  const workerId = randomUUID();
  for (const on of [false, true]) {
    const r = await withEnforcement(on, () => withTenantOrg(org.id, (db) => dispatchSkill(db, "send_campaign_touch",
      { type: "WORKER", id: workerId, orgId: org.id, role: "operator" }, { dataEnvironment: "PRODUCTION", args: {} })));
    ck(`a WORKER dispatch is NOT rejected by the new gate (enforcement ${on ? "ON" : "OFF"})`,
      !/requires an AGENT to act as a governed actor/.test(r.reason ?? ""), r.reason?.slice(0, 60));
  }

  // ── INDEPENDENT PRODUCT INVARIANT ─────────────────────────────────────────────────────────────
  HD("INDEPENDENT CONTROL — an AGENT may never assert a VERIFIED role");
  const opp = await one(`insert into opportunities (org_id, company_id, name, stage) values ($1,$2,$3,'discovery') returning id`,
    [org.id, company.id, `P45-4 opp ${NS}`]);
  const contact = await one(`insert into contacts (org_id, company_id, email, name) values ($1,$2,$3,$4) returning id`,
    [org.id, company.id, `${NS}@example.test`, "P45-4 contact"]);
  {
    const verified = await withTenantOrg(org.id, (db) => dispatchSkill(db, "assert_stakeholder_role",
      { type: "AGENT", id: agent.keyId, orgId: org.id, role: "operator" },
      { dataEnvironment: "PRODUCTION", args: { opportunityId: opp.id, contactId: contact.id, role: "economic_buyer", assertionState: "verified", source: NS, evidence: "x" } }));
    ck("the pre-existing agent/human authority boundary still holds, independent of anything here",
      verified.status === "FAILED" && /may not assert verified/.test(verified.reason ?? ""), verified.reason?.slice(0, 60));
  }

  // ── PRIVILEGES ────────────────────────────────────────────────────────────────────────────────
  HD("PRIVILEGES — the new facts are immutable by omission");
  const upd = (t: string) => q(`select column_name from information_schema.column_privileges
                                 where grantee='app_rw' and table_name=$1 and privilege_type='UPDATE' order by column_name`, [t]);
  const invUpd = (await upd("governed_action_invocations")).map((r) => r.column_name);
  ck("app_rw cannot UPDATE governed_action_invocations.grant_id", !invUpd.includes("grant_id"), invUpd);
  const grantUpd = (await upd("actor_capability_grants")).map((r) => r.column_name);
  ck("app_rw cannot UPDATE actor_capability_grants.expires_at", !grantUpd.includes("expires_at"), grantUpd);
  const keyUpd = (await upd("api_keys")).map((r) => r.column_name);
  ck("app_rw UPDATE on api_keys is narrowed to revoked_at only",
    keyUpd.length === 1 && keyUpd[0] === "revoked_at", keyUpd);

  // ── PROTECTED FUNCTION ────────────────────────────────────────────────────────────────────────
  HD("PROTECTED FUNCTION — the resolver kept its hardening across the recreate");
  const fn = await one(`select prosecdef, array_to_string(proconfig, ',') cfg from pg_proc where proname='resolve_api_key'`);
  ck("resolve_api_key is still SECURITY DEFINER with 0105's hardened search_path",
    fn.prosecdef === true && fn.cfg === "search_path=pg_catalog, public, pg_temp", fn);

  // ── ONE LIVENESS IMPLEMENTATION ───────────────────────────────────────────────────────────────
  HD("STRUCTURE — one definition of a live grant");
  const { readFileSync, readdirSync } = await import("node:fs");
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${d}/${e.name}`) : e.name.endsWith(".ts") || e.name.endsWith(".tsx") ? [`${d}/${e.name}`] : []);
  const offenders = walk("src").filter((f) => !f.endsWith("grant-liveness.ts"))
    .filter((f) => /expires_at\s*(is null|>)/.test(readFileSync(f, "utf8").replace(/\s+/g, " "))
                && /actor_capability_grants/.test(readFileSync(f, "utf8")));
  ck("no second P45 grant-expiry comparison exists anywhere in src/", offenders.length === 0, offenders);

  // ── ORGANIZATION CASCADE (blocking) ───────────────────────────────────────────────────────────
  HD("CASCADE — NO ACTION survives a tenant's dual cascade paths");
  const t = await one(`insert into organizations (name) values ($1) returning id`, [`${NS}-cascade`]);
  const ta = (await one(`insert into governed_actors (org_id, actor_type, key, display_name, lifecycle)
                         values ($1,'AGENT',$2,'Cascade agent','ACTIVE') returning id`, [t.id, `${NS}-ca`])).id;
  const tg = (await one(`insert into actor_capability_grants (org_id, actor_id, skill_id, skill_version, status)
                         values ($1,$2,'draft_campaign_touch',1,'ACTIVE') returning id`, [t.id, ta])).id;
  await pool.query(`insert into api_keys (org_id, name, key_hash, scope, governed_actor_id) values ($1,$2,$3,'write',$4)`,
    [t.id, `${NS}-ck`, `${NS}-ckhash`, ta]);
  await pool.query(`insert into governed_action_invocations (org_id, skill_id, skill_version, effect_class, actor_type,
                      actor_id, status, governed_actor_id, grant_id)
                    values ($1,'draft_campaign_touch',1,'INTERNAL_WRITE','AGENT',$2,'EXECUTED',$3,$4)`,
    [t.id, ta, ta, tg]);
  let cascadeErr = "";
  try { await pool.query(`delete from organizations where id = $1`, [t.id]); }
  catch (e) { cascadeErr = (e as Error).message; }
  ck("deleting the organization succeeds — no FK-order violation from the NO ACTION grant reference",
    cascadeErr === "", cascadeErr.slice(0, 160));
  ck("and the whole tenant is gone: actor, credential, grant and invocation",
    Number((await one(`select (select count(*) from governed_actors where org_id=$1)
                            + (select count(*) from actor_capability_grants where org_id=$1)
                            + (select count(*) from api_keys where org_id=$1)
                            + (select count(*) from governed_action_invocations where org_id=$1) n`, [t.id])).n) === 0);

}

main().catch((e) => { fail++; console.error("\n!! HALTED:", e instanceof Error ? e.message : e); })
  .finally(async () => {
    console.log(`\n=== P45-4 — ${pass} passed, ${fail} failed`);
    await pool.end().catch(() => {}); process.exit(fail === 0 ? 0 : 1);
  });
