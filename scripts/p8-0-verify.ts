/**
 * P8-0 — RUNTIME OBSERVABILITY AND EVALUATION HOOKS.
 *
 * > Observability may record WHAT HAPPENED. It may not invent why, what model executed, what it
 * > cost, what caused it, or what resulted. NULL means NOT OBSERVED — never zero, none or unrelated.
 *
 * The distinction this suite exists to defend is **supported-and-empty vs unobserved**. A marked
 * invocation of a registry capability with zero effect rows is a FACT: it created nothing. An
 * unmarked invocation with zero effect rows is an ABSENCE OF EVIDENCE. A suite that could not tell
 * those apart would certify nothing, so every zero-row case below asserts the marker too.
 *
 * SEEDED CLONE: commits invocations, effects, ledger rows and business fixtures.
 */
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { assertSeededClone } from "./seeded-clone";
import { withTenantOrg } from "../src/lib/db/tenant";
import { dispatchSkill, SKILL_REGISTRY, type Actor } from "../src/lib/pursuits/federation/skills";
import { P8_V1_REGISTRY, coveredByV1 } from "../src/lib/pursuits/federation/observation";

const URL_ = process.env.DATABASE_URL_VERIFY ?? process.env.DATABASE_URL ?? "";
const pool = new Pool({ connectionString: URL_, max: 4 });
let pass = 0, fail = 0;
const ck = (n: string, ok: boolean, d?: unknown) => { ok ? pass++ : fail++; console.log(`  ${ok ? "✓" : "✗"}  ${n}${d === undefined ? "" : ` — ${JSON.stringify(d)}`}`); };
const note = (n: string, d?: unknown) => console.log(`  ·  ${n}${d === undefined ? "" : ` — ${JSON.stringify(d)}`}`);
const HD = (s: string) => console.log(`\n── ${s}`);
const NS = `p80-${Math.random().toString(36).slice(2, 8)}`;
const q = async (s: string, p: unknown[] = []) => (await pool.query(s, p)).rows as any[];
const one = async (s: string, p: unknown[] = []) => (await q(s, p))[0];
const n = async (s: string, p: unknown[] = []) => Number((await one(s, p)).n);
const refs = (inv: string) => q(`select effect_relation, effect_kind, effect_id from invocation_effect_refs where invocation_id = $1 order by effect_kind, effect_id`, [inv]);
const marker = async (inv: string) => (await one(`select observation_contract_version v, status from governed_action_invocations where id = $1`, [inv]));

async function main() {
  await assertSeededClone(pool);
  console.log(`P8-0 — runtime observability and evaluation hooks  (${NS})`);

  // ── Own fixtures. The canonical world has no campaigns, and a suite must not assert against
  //    accreted state nobody authored.
  const org = await one(`insert into organizations (name) values ($1) returning id`, [`P8-0 ${NS}`]);
  const foreign = await one(`insert into organizations (name) values ($1) returning id`, [`P8-0 foreign ${NS}`]);
  const co = await one(`insert into companies (legal_name, normalized_name) values ($1,$2) returning id`, [`P8-0 Co ${NS}`, `p80-co-${NS}`]);
  const campaignName = `P8-0 campaign ${NS}`;
  await q(`insert into campaigns (org_id, company_id, name, status, source) values ($1,$2,$3,'draft','user')`, [org.id, co.id, campaignName]);
  await q(`insert into org_features (org_id, governed_action) values ($1,true) on conflict (org_id) do update set governed_action = true`, [org.id]);
  const USER = (o = org.id): Actor => ({ type: "USER", id: null, orgId: o, role: "operator" });
  // `ctx as never` is what let an omitted provenance through the type system and surface as a
  // savepoint error three layers away. The helper now supplies it — this suite IS a certification
  // gate, so CERTIFICATION is the truthful label for everything it writes — and any caller may
  // still override it.
  const disp = (skill: string, ctx: Record<string, unknown>, actor: Actor = USER()) =>
    withTenantOrg(actor.orgId, (db) => dispatchSkill(db, skill, actor,
      { dataEnvironment: "CERTIFICATION", ...ctx } as Parameters<typeof dispatchSkill>[3]));

  // ── REGISTRY INTEGRITY ────────────────────────────────────────────────────────────────────────
  HD("REGISTRY — the database, not application code, decides who may be marked");
  ck("the code registry is exactly the four frozen capabilities",
    P8_V1_REGISTRY.length === 4 && ["draft_campaign_touch", "recommend_pursuit_plan", "decide_pursuit_plan", "assemble_pursuit_team"]
      .every((s) => coveredByV1(s, 1)), P8_V1_REGISTRY.map((r) => `${r.skillId}@${r.version}`));
  ck("a capability outside the registry is not covered, and neither is a wrong version",
    !coveredByV1("assert_stakeholder_role", 1) && !coveredByV1("draft_campaign_touch", 2));
  // The CHECK must bite independently of application code.
  const forge = async (skill: string, version: number, v: number | null) => {
    try {
      await pool.query(`insert into governed_action_invocations (org_id, skill_id, skill_version, effect_class, actor_type, status, observation_contract_version)
                        values ($1,$2,$3,'INTERNAL_WRITE','USER','EXECUTED',$4)`, [org.id, skill, version, v]);
      return "accepted";
    } catch (e) { return (e as Error).message; }
  };
  ck("marker 1 on an UNREGISTERED capability is refused by the database CHECK",
    /violates check constraint/.test(await forge("assert_stakeholder_role", 1, 1)));
  ck("marker 1 on a WRONG VERSION of a registered capability is refused",
    /violates check constraint/.test(await forge("draft_campaign_touch", 2, 1)));
  ck("marker 2 is refused for every capability", /violates check constraint/.test(await forge("draft_campaign_touch", 1, 2)));
  ck("NULL is accepted for an unregistered capability — the legacy/unobserved shape",
    (await forge("assert_stakeholder_role", 1, null)) === "accepted");
  ck("CONTROL — marker 1 on an exact registry member is accepted, so the CHECK is not refusing everything",
    (await forge("draft_campaign_touch", 1, 1)) === "accepted");
  await q(`delete from governed_action_invocations where org_id = $1`, [org.id]);

  // ── LEGACY vs SUPPORTED-AND-EMPTY ─────────────────────────────────────────────────────────────
  HD("THE CENTRAL DISTINCTION — unobserved vs observed-zero");
  const legacyId = (await one(`insert into governed_action_invocations (org_id, skill_id, skill_version, effect_class, actor_type, status)
                               values ($1,'draft_campaign_touch',1,'INTERNAL_WRITE','USER','EXECUTED') returning id`, [org.id])).id;
  const lm = await marker(legacyId);
  ck("a legacy-shaped invocation has NULL marker and zero refs ⇒ UNOBSERVED, not 'zero effects'",
    lm.v === null && (await refs(legacyId)).length === 0);
  await q(`delete from governed_action_invocations where id = $1`, [legacyId]);

  // ── DRAFT TOUCH ───────────────────────────────────────────────────────────────────────────────
  HD("draft_campaign_touch@1");
  const d1 = await disp("draft_campaign_touch", { args: { campaign: campaignName, name: `${NS} a`, subject: "s", body: "b" } });
  const d1m = await marker(d1.invocationId!); const d1r = await refs(d1.invocationId!);
  ck("EXECUTED, marked v1", d1.status === "EXECUTED" && d1m.v === 1, { status: d1.status, marker: d1m.v });
  ck("exactly one CREATED / campaign_touch ref", d1r.length === 1 && d1r[0].effect_kind === "campaign_touch" && d1r[0].effect_relation === "CREATED", d1r);
  ck("and the ref names the row that now exists",
    await n(`select count(*)::int n from campaign_touches where id = $1`, [d1r[0].effect_id]) === 1);
  // A dispatch that creates nothing is EXECUTED with zero refs — and that is a fact, not an absence.
  const d0 = await disp("draft_campaign_touch", { args: { campaign: `no such campaign ${NS}`, subject: "s", body: "b" } });
  const d0m = await marker(d0.invocationId!);
  ck("a dispatch that matched no campaign is EXECUTED, marked, with ZERO refs — observed zero",
    d0.status === "EXECUTED" && d0m.v === 1 && (await refs(d0.invocationId!)).length === 0);

  // ── REJECTED ──────────────────────────────────────────────────────────────────────────────────
  HD("REJECTED — marked, zero refs");
  const rej = await disp("draft_campaign_touch", { args: { campaign: campaignName, subject: "s", body: "b" } }, { type: "USER", id: null, orgId: org.id, role: "viewer" });
  const rm = await marker(rej.invocationId!);
  ck("a registered capability refused at the role gate is marked v1 with zero refs",
    rej.status === "REJECTED" && rm.v === 1 && (await refs(rej.invocationId!)).length === 0, { reason: rej.reason });

  // ── THE FAILURE RULE ──────────────────────────────────────────────────────────────────────────
  HD("FAILED — the in-memory sink is discarded, not merely rolled back");
  // A handler that writes durably, stages an effect, then throws. If the sink were not cleared the
  // FAILED row would durably claim an effect that never persisted.
  const { noteEffectOnCtx } = await import("../src/lib/pursuits/federation/observation");
  const victim = SKILL_REGISTRY.find((d) => d.skillId === "draft_campaign_touch")!;
  const realHandler = victim.handler!;
  let stagedId = "";
  (victim as { handler?: unknown }).handler = async (db: never, a: never, ctx: never) => {
    const r = await realHandler(db, a, ctx) as { touchId?: string };
    stagedId = r.touchId ?? "";
    noteEffectOnCtx(ctx, "campaign_touch", stagedId);     // stage again, deliberately
    throw new Error(`${NS} deliberate handler failure`);
  };
  const failed = await disp("draft_campaign_touch", { args: { campaign: campaignName, name: `${NS} doomed`, subject: "s", body: "b" } });
  (victim as { handler?: unknown }).handler = realHandler;
  const fm = await marker(failed.invocationId!);
  ck("the invocation is FAILED and marked v1", failed.status === "FAILED" && fm.v === 1, { status: failed.status });
  ck("ZERO effect refs — the staged entry was discarded from memory, not just rolled back in the database",
    (await refs(failed.invocationId!)).length === 0);
  ck("the handler's durable write was rolled back by the savepoint", stagedId !== "" &&
    await n(`select count(*)::int n from campaign_touches where id = $1`, [stagedId]) === 0, { stagedId: stagedId.slice(0, 8) });
  ck("and no ledger row survives for that rolled-back work",
    await n(`select count(*)::int n from change_ledger where invocation_id = $1`, [failed.invocationId!]) === 0);

  // ── RECOMMEND / DECIDE ────────────────────────────────────────────────────────────────────────
  HD("recommend_pursuit_plan@1 — conditional 1..3");
  const acct = co.id;
  const fresh = (await one(`insert into pursuits (org_id, account_id, status, dedup_key, data_environment, pursuit_type)
                            values ($1,$2,'QUALIFIED',$3,'DEMO','MODERNIZATION') returning id`, [org.id, acct, `p80-${NS}-1`])).id;
  await q(`insert into revenue_motions (org_id, company_id, pursuit_id, status, created_at) values ($1,$2,$3,'active',now())`, [org.id, acct, fresh]);
  const r1 = await disp("recommend_pursuit_plan", { pursuitId: fresh });
  const r1r = await refs(r1.invocationId!);
  ck("a FRESH pursuit records exactly 3 refs — goal, plan and revision, each at its creation branch",
    r1.status === "EXECUTED" && r1r.length === 3
    && new Set(r1r.map((x) => x.effect_kind)).size === 3, r1r.map((x) => x.effect_kind));
  // recordPlanRecommendation writes a ledger event ONLY when a review is triggered against an
  // in-force plan, so a FIRST recommendation legitimately writes none. Asserting ">= 1" here would
  // have been asserting against the product rather than about it; the threading positive is the
  // decide path below, which always writes PLAN_DECIDED.
  ck("a first recommendation writes no ledger event, and none is invented for it",
    await n(`select count(*)::int n from change_ledger where invocation_id = $1`, [r1.invocationId!]) === 0);
  const rev1 = (await one(`select id from pursuit_plan_revisions where pursuit_id = $1 order by revision_no desc limit 1`, [fresh])).id;
  // A second recommendation on an unchanged world is UNCHANGED — nothing created, so zero refs.
  const r2 = await disp("recommend_pursuit_plan", { pursuitId: fresh });
  const r2r = await refs(r2.invocationId!); const r2m = await marker(r2.invocationId!);
  ck("an UNCHANGED re-recommendation is marked with ZERO refs — it created nothing (D-028)",
    r2.status === "EXECUTED" && r2m.v === 1 && r2r.length === 0, { refs: r2r.length });

  HD("decide_pursuit_plan@1 — 1..2, and never the parent status updates");
  const plan = await one(`select id from pursuit_plans where pursuit_id = $1`, [fresh]);
  const dec = await disp("decide_pursuit_plan", { pursuitId: fresh,
    args: { planId: plan.id, recommendationId: rev1, decision: "APPROVED", reason: null } });
  const dr = await refs(dec.invocationId!);
  ck("staging occurred ⇒ exactly 2 refs: the decision revision and the motion action",
    dec.status === "EXECUTED" && dr.length === 2
    && dr.some((x) => x.effect_kind === "pursuit_plan_revision") && dr.some((x) => x.effect_kind === "motion_action"), dr.map((x) => x.effect_kind));
  ck("the parent status transitions produced NO refs — goal and plan went ACTIVE and neither is an effect",
    !dr.some((x) => x.effect_kind === "pursuit_goal" || x.effect_kind === "pursuit_plan")
    && (await one(`select status from pursuit_plans where id = $1`, [plan.id])).status === "ACTIVE");
  const led = await q(`select change_type from change_ledger where invocation_id = $1 order by change_type`, [dec.invocationId!]);
  ck("BOTH ledger events of the two-event decide path carry the same invocation id (one-to-many)",
    led.length === 2, led.map((x) => x.change_type));

  // LEGACY AMBIGUITY, AND THE PROXIBITY RULE. An unlinked ledger row written in the same instant as
  // a covered invocation must never be joined to it. The canonical query is
  // `change_ledger WHERE invocation_id = ?`, so a NULL row is structurally unreachable from it —
  // which is exactly why the contract forbids inferring linkage from timestamp, subject or proximity.
  const legacyEvent = (await one(
    `insert into change_ledger (org_id, pursuit_id, entity_type, entity_id, change_type, materiality,
                                reason, actor_type, trigger_type, data_environment, occurred_at)
     select $1, $2, 'pursuit', $2, 'PLAN_DECIDED', 'MEDIUM', 'legacy runtime, no invocation link',
            'USER', 'GOVERNED_ACTION', 'DEMO',
            (select occurred_at from change_ledger where invocation_id = $3 limit 1)
     returning id, invocation_id`, [org.id, fresh, dec.invocationId])) as { id: string; invocation_id: string | null };
  ck("a legacy-shaped ledger row carries NULL invocation_id and stays historically ambiguous",
    legacyEvent.invocation_id === null);
  ck("PROXIMITY CONTROL \u2014 written at the SAME instant as a covered event, it is still never joined",
    await n(`select count(*)::int n from change_ledger where invocation_id = $1 and id = $2`,
      [dec.invocationId, legacyEvent.id]) === 0
    && await n(`select count(*)::int n from change_ledger c1
                  join change_ledger c2 on c2.occurred_at = c1.occurred_at
                 where c1.invocation_id = $1 and c2.id = $2 and c2.invocation_id is not null`,
      [dec.invocationId, legacyEvent.id]) === 0);

  // \u2500\u2500 TEAM: 0..N \u2500\u2500──────────────────────────────────────────────────────────────────────────────
  HD("assemble_pursuit_team@1 — 0..N, and N=0 is the canonical supported-and-empty case");
  const t1 = await disp("assemble_pursuit_team", { pursuitId: fresh });
  const t1r = await refs(t1.invocationId!);
  const members = await n(`select count(*)::int n from pursuit_team_members where pursuit_id = $1`, [fresh]);
  ck("exactly one ref per team member actually inserted", t1.status === "EXECUTED" && t1r.length === members && members > 0,
    { refs: t1r.length, members });
  const t2 = await disp("assemble_pursuit_team", { pursuitId: fresh });
  const t2m = await marker(t2.invocationId!);
  ck("a repeat with every role already filled is MARKED with ZERO refs — observed zero, not unobserved",
    t2.status === "EXECUTED" && t2m.v === 1 && (await refs(t2.invocationId!)).length === 0);

  // ── IDENTITY ──────────────────────────────────────────────────────────────────────────────────
  HD("IDENTITY — server-allocated, and a payload has no authority over it");
  const forged = randomUUID();
  const f1 = await disp("draft_campaign_touch", { args: { campaign: campaignName, name: `${NS} forge`, subject: "s", body: "b", invocationId: forged, effects: [{ kind: "campaign_touch", id: forged }] } });
  ck("a payload `invocationId` and `effects` are ignored entirely — the id is the server's",
    f1.invocationId !== forged && await n(`select count(*)::int n from invocation_effect_refs where effect_id = $1`, [forged]) === 0);
  const f1r = await refs(f1.invocationId!);
  ck("and the real effect was still observed correctly", f1r.length === 1 && f1r[0].effect_id !== forged);

  // ── TENANT ────────────────────────────────────────────────────────────────────────────────────
  HD("TENANT — refused RELATIONALLY by the composite parent key");
  let rel = "";
  try {
    await pool.query(`insert into invocation_effect_refs (org_id, invocation_id, effect_relation, effect_kind, effect_id)
                      values ($1,$2,'CREATED','campaign_touch',$3)`, [foreign.id, d1.invocationId, randomUUID()]);
  } catch (e) { rel = (e as Error).message; }
  ck("an effect row in org B naming an invocation in org A violates the composite FK",
    /violates foreign key constraint/.test(rel), rel.slice(0, 70));
  ck("CONTROL — the same-org pairing inserts, so the FK is not refusing everything",
    (await pool.query(`insert into invocation_effect_refs (org_id, invocation_id, effect_relation, effect_kind, effect_id)
                       values ($1,$2,'CREATED','campaign_touch',$3) returning id`, [org.id, d1.invocationId, randomUUID()])).rowCount === 1);

  // ── PRIVILEGE ─────────────────────────────────────────────────────────────────────────────────
  HD("PRIVILEGE — immutability proved, not asserted");
  const upd = async (t: string) => (await q(`select column_name from information_schema.column_privileges where grantee='app_rw' and table_name=$1 and privilege_type='UPDATE' order by column_name`, [t])).map((r) => r.column_name);
  const invUpd = await upd("governed_action_invocations");
  ck("app_rw cannot UPDATE observation_contract_version — 1→NULL and 1→2 are structurally impossible",
    !invUpd.includes("observation_contract_version"), invUpd);
  ck("CONTROL — it can still update status/executed_at, so the allowlist is intact", invUpd.includes("status"));
  ck("app_rw has no UPDATE on invocation_effect_refs", (await upd("invocation_effect_refs")).length === 0);
  ck("app_rw has no DELETE on invocation_effect_refs",
    (await q(`select 1 from information_schema.table_privileges where grantee='app_rw' and table_name='invocation_effect_refs' and privilege_type='DELETE'`)).length === 0);
  ck("CONTROL — app_rw does have INSERT and SELECT",
    (await q(`select privilege_type from information_schema.table_privileges where grantee='app_rw' and table_name='invocation_effect_refs' order by 1`)).map((r) => r.privilege_type).join(",") === "INSERT,SELECT");
  const rls = await one(`select relrowsecurity r, relforcerowsecurity f from pg_class where relname='invocation_effect_refs'`);
  ck("RLS enabled and FORCED", rls.r === true && rls.f === true);

  // ── DEFERRED AREAS ────────────────────────────────────────────────────────────────────────────
  HD("DEFERRED — structurally absent, so nothing can quietly start claiming them");
  for (const t of ["model_invocation_usage", "execution_receipt_observations", "execution_outcome_observations"])
    ck(`no ${t} table exists`, (await one(`select to_regclass($1)::text x`, [`public.${t}`])).x === null);
  ck("no model/token/cost column was added to the invocation",
    (await q(`select column_name from information_schema.columns where table_name='governed_action_invocations'
               and column_name in ('model_provider','model_id','model_version','input_tokens','output_tokens','cost_usd','latency_ms')`)).length === 0);
  const { readFileSync, readdirSync } = await import("node:fs");
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${d}/${e.name}`) : e.name.endsWith(".ts") || e.name.endsWith(".tsx") ? [`${d}/${e.name}`] : []);
  const src = walk("src");
  ck("nothing writes emitted_event_id — it stays LEGACY/DEAD",
    src.filter((f) => /emitted_event_id/.test(readFileSync(f, "utf8"))).length === 0);
  ck("agent_runs is not migrated or joined to the evidence spine",
    src.filter((f) => /invocation_effect_refs/.test(readFileSync(f, "utf8")) && /agent_runs/.test(readFileSync(f, "utf8"))).length === 0);

  console.log(`\n=== P8-0 — ${pass} passed, ${fail} failed`);
}
main().catch((e) => { fail++; console.error("\n!! HALTED:", e instanceof Error ? e.message : e); })
  .finally(async () => {
    console.log(`\n=== P8-0 — ${pass} passed, ${fail} failed`);
    await pool.end().catch(() => {}); process.exit(fail === 0 ? 0 : 1);
  });
