import { execFileSync } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { Pool } from "pg";
import { assertSeededClone } from "./seeded-clone";
import { fingerprintWorld } from "./world-fingerprint";

/**
 * P3 SLICE 2C-A — THE V2 WRITE-ACTIVATION GATE.
 *
 * > **`PLAN_CONTENT_V2_WRITES_ENABLED` governs only whether a NEW schema-2 plan revision may be
 * > PERSISTED. v2 reads are always enabled. It is a write brake, never a downgrade mode.**
 *
 * WHY IT EXISTS, IN ONE LINE: `e55499b` reads v2 content without failing and gets it wrong, so
 * rollback to it ends at the first persisted v2 revision — and this gate is what makes that moment
 * deliberate rather than incidental.
 *
 * THE INVARIANT THIS SUITE HOLDS: a decision inherits the generation of the recommendation it
 * responds to. Never a downconversion, never an upgrade, and with the gate OFF a v2 recommendation
 * is REFUSED BEFORE ANY MUTATION rather than quietly rewritten.
 *
 * Each case runs the real product path in a CHILD PROCESS, because the gate is read from the
 * environment and a posture must be established before the module graph loads — flipping
 * `process.env` mid-test would prove something about this file rather than about the deployment.
 *
 * Fixtures COMMIT, so this runs on a disposable seeded clone.
 *
 *   npx tsx scripts/verify-run.ts --suite p3-2c-gate
 */

const CONN = process.env.DATABASE_URL_VERIFY ?? process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const REPO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const pool = new Pool({ connectionString: CONN, max: 2 });
let passed = 0, failed = 0;
const failures: string[] = [];
const check = (n: string, ok: boolean, d?: unknown): void => {
  const detail = d === undefined ? "" : ` — ${JSON.stringify(d)}`;
  if (ok) { passed++; console.log(`  ✓ ${n}${detail}`); }
  else { failed++; failures.push(n); console.log(`  ✗ ${n}${detail}`); }
};
const note = (n: string, d?: unknown): void => console.log(`  · ${n}${d === undefined ? "" : ` — ${JSON.stringify(d)}`}`);

/** Run one product operation in a child process with an explicit gate posture. */
function run(gate: string | undefined, body: string, label: string): Record<string, unknown> {
  const out = `${REPO}/.gate_${label}.json`, f = `${REPO}/.gate_${label}.mts`;
  writeFileSync(f, [
    `import { writeFileSync as wf } from "node:fs";`,
    `const emit = (o: unknown) => wf(${JSON.stringify(out)}, JSON.stringify(o));`,
    `const attempt = async (fn: () => Promise<unknown>) => { try { emit(await fn()); } catch (e) { emit({ THREW: e instanceof Error ? e.name + ": " + e.message : String(e) }); } };`,
    // NO try/catch WRAPPER HERE: a body carries top-level `import` statements, which are illegal
    // inside a block. Each body reports its own outcome through `attempt` instead.
    body,
    `process.exit(0);`,
  ].join("\n"));
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: CONN, DEMO_URL: CONN, P7_TEST_PRINCIPAL: "allow" };
  if (gate === undefined) delete env.PLAN_CONTENT_V2_WRITES_ENABLED;
  else env.PLAN_CONTENT_V2_WRITES_ENABLED = gate;
  try {
    execFileSync("npx", ["tsx", f], { cwd: REPO, encoding: "utf8", timeout: 600_000, stdio: ["ignore", "pipe", "pipe"], env });
    return JSON.parse(readFileSync(out, "utf8"));
  } finally { for (const x of [f, out]) { try { unlinkSync(x); } catch { /* ignore */ } } }
}

const RECOMMEND = (org: string, pursuit: string) => `
  import { withTenantOrg } from "@/lib/db/tenant";
  import { recordPlanRecommendation } from "@/lib/pursuits/coordination/plan-store";
  import { getPool } from "@/db/client";
  await attempt(async () => withTenantOrg(${JSON.stringify(org)}, (db: any) =>
    recordPlanRecommendation(db, { type: "USER", id: null, orgId: ${JSON.stringify(org)} }, ${JSON.stringify(pursuit)},
      { env: "TEST", correlationId: null })));
  await getPool().end().catch(() => {});
`;
const DECIDE = (org: string, pursuit: string, planId: string, recId: string) => `
  import { withTenantOrg } from "@/lib/db/tenant";
  import { decidePlan } from "@/lib/pursuits/coordination/plan-store";
  import { getPool } from "@/db/client";
  await attempt(async () => withTenantOrg(${JSON.stringify(org)}, (db: any) =>
    decidePlan(db, { type: "USER", id: null, orgId: ${JSON.stringify(org)} },
      { pursuitId: ${JSON.stringify(pursuit)}, planId: ${JSON.stringify(planId)}, recommendationId: ${JSON.stringify(recId)}, decision: "APPROVED" },
      { env: "TEST", correlationId: null })));
  await getPool().end().catch(() => {});
`;
const READ = (org: string, pursuit: string) => `
  import { withTenantOrg } from "@/lib/db/tenant";
  import { loadPlanRecords, loadPursuitPlanView } from "@/lib/pursuits/read-models/plan-loaders";
  import { loadPursuitAttention, loadQueuePlanLineage } from "@/lib/pursuits/read-models/attention-loaders";
  import { loadQueueWorklist } from "@/lib/motions/queue-read";
  import { pendingApprovals } from "@/lib/runtime/approvals";
  import { selectCurrentPlanAction } from "@/lib/pursuits/read-models/pursuit-plan";
  import { getPool } from "@/db/client";
  const ORG = ${JSON.stringify(org)}; const P = ${JSON.stringify(pursuit)};
  const caller = { orgId: ORG, band: "internal", internal: true } as any;
  await attempt(async () => {
  const out: any = await withTenantOrg(ORG, async (db: any) => {
    const view: any = await loadPursuitPlanView(db, caller, P);
    const recs: any = await loadPlanRecords(db, caller, P);
    const inForce = recs.revisions.filter((r: any) => r.kind === "DECISION" && r.decision !== "REJECTED").at(-1) ?? null;
    const wl: any = await loadQueueWorklist(db, ORG, null);
    const lineage: any = await loadQueuePlanLineage(db, caller, wl.cadence.map((x: any) => String(x.id)));
    const approvals: any = await pendingApprovals(db, ORG);
    const current = inForce ? selectCurrentPlanAction(inForce.content.actions, inForce.basis.inputs.milestones ?? {}) : null;
    return {
      headline: view?.nextAction?.text ?? null,
      actions: view?.actions?.length ?? null,
      storedSchemas: recs.revisions.map((r: any) => r.contentSchema),
      inForceActions: inForce ? inForce.content.actions.length : null,
      currentActionKey: current?.action.key ?? null,
      stagedByActionKey: Object.keys(recs.stagedByActionKey).length,
      lineageResolved: Object.keys(lineage).length,
      approvals: approvals.length,
    };
  });
  out.today = (await withTenantOrg(ORG, (db: any) => loadPursuitAttention(db, caller, {}))).length;
  return out;
  });
  await getPool().end().catch(() => {});
`;

async function main(): Promise<void> {
  await assertSeededClone(pool);
  console.log(`[p3-2c-gate-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);
  const db = await pool.connect();
  const one = async <T>(sql: string, p: unknown[] = []): Promise<T> => (await db.query(sql, p)).rows[0] as T;
  const all = async <T>(sql: string, p: unknown[] = []): Promise<T[]> => (await db.query(sql, p)).rows as T[];
  try {
    const org = await one<{ id: string }>(
      `select org_id id from pursuits where status not in ('WON','LOST','DISQUALIFIED') group by org_id order by count(*) desc limit 1`);
    const pursuit = await one<{ id: string }>(
      `select pursuit_id id from pursuit_plan_revisions order by created_at asc limit 1`);
    // Start from a clean plan history: each case below must attribute its own rows.
    await db.query(`delete from pursuit_plan_revisions where pursuit_id = $1`, [pursuit.id]);
    await db.query(`delete from pursuit_plans where pursuit_id = $1`, [pursuit.id]);
    await db.query(`delete from pursuit_goals where pursuit_id = $1`, [pursuit.id]);
    note("fixture", { org: org.id.slice(0, 8), pursuit: pursuit.id.slice(0, 8) });

    const schemasOf = async () => (await all<{ s: string; n: number }>(
      `select content->>'schema' s, count(*)::int n from pursuit_plan_revisions where pursuit_id = $1 group by 1 order by 1`, [pursuit.id]));
    const lineageCount = async () => Number((await one<{ n: number }>(
      `select count(*)::int n from motion_actions where plan_revision_id is not null`)).n);

    // ── G12 · DEFAULT OFF ───────────────────────────────────────────────────────────────────────
    console.log("\n=== G12 · DEFAULT OFF");
    const posture = (gate: string | undefined) => run(gate, `
      import { planContentV2WritesEnabled } from "@/lib/env/environment";
      await attempt(async () => ({ on: planContentV2WritesEnabled() }));`, `p_${gate ?? "absent"}`.replace(/[^a-z0-9_]/gi, ""));
    check("G12 · env ABSENT ⇒ OFF", (posture(undefined) as { on: boolean }).on === false);
    for (const v of ["", "false", "0", "off", "no", "maybe", "TRUE "]) {
      const on = (posture(v) as { on: boolean }).on;
      const expected = v.trim().toLowerCase() === "true";
      check(`G12 · ${JSON.stringify(v)} ⇒ ${expected ? "ON" : "OFF"} — no permissive truthiness`, on === expected, on);
    }
    for (const v of ["true", "1", "on", "yes", "ON", " yes "]) {
      check(`G12 · ${JSON.stringify(v)} ⇒ ON (the canonical opt-in idiom)`, (posture(v) as { on: boolean }).on === true);
    }

    // ── G1 · OFF RECOMMENDATION ─────────────────────────────────────────────────────────────────
    console.log("\n=== G1 · GATE OFF → RECOMMENDATION IS v1");
    const g1 = run(undefined, RECOMMEND(org.id, pursuit.id), "g1") as { status: string; planId: string; revisionId: string };
    check("G1 · a recommendation was recorded", g1.status === "RECORDED", g1);
    const g1row = await one<{ schema: string; has_next: boolean; has_actions: boolean; basis_v: string }>(
      `select content->>'schema' schema, content ? 'nextAction' has_next, content ? 'actions' has_actions,
              basis->'inputs'->>'v' basis_v from pursuit_plan_revisions where id = $1`, [g1.revisionId]);
    check("G1 · persisted as schema 1", g1row.schema === "1", g1row);
    check("G1 · with the v1 shape: a nextAction, and NO actions[]", g1row.has_next === true && g1row.has_actions === false, g1row);
    check("G1 · and a v1 basis — content and basis agree about their generation", g1row.basis_v === "1", g1row.basis_v);
    check("G1 · no v2 lineage was populated", await lineageCount() === 0);

    // ── G2 · OFF DECISION ON A v1 RECOMMENDATION ────────────────────────────────────────────────
    console.log("\n=== G2 · GATE OFF → v1 RECOMMENDATION → v1 DECISION");
    const g2 = run(undefined, DECIDE(org.id, pursuit.id, g1.planId, g1.revisionId), "g2") as { decision: string; stagedMotionActionId: string | null };
    check("G2 · the decision was taken", g2.decision === "APPROVED", g2);
    const g2row = await one<{ schema: string; staged: string | null; basis_v: string }>(
      `select content->>'schema' schema, content->'nextAction'->>'stagedMotionActionId' staged, basis->'inputs'->>'v' basis_v
         from pursuit_plan_revisions where pursuit_id = $1 and kind = 'DECISION' order by revision_no desc limit 1`, [pursuit.id]);
    check("G2 · persisted as schema 1", g2row.schema === "1", g2row);
    check("G2 · staged the v1 way — the pointer is INSIDE the content, where a rollback runtime looks",
      !!g2row.staged && g2row.staged === g2.stagedMotionActionId, { inContent: g2row.staged, returned: g2.stagedMotionActionId });
    check("G2 · and the lineage columns stay NULL on that row",
      Number((await one<{ n: number }>(`select count(*)::int n from motion_actions where id = $1 and plan_revision_id is null`, [g2.stagedMotionActionId])).n) === 1);
    check("G2 · no schema-2 revision exists anywhere", (await schemasOf()).every((r) => r.s === "1"), await schemasOf());

    // ── G5 · OFF→ON TRANSITION ──────────────────────────────────────────────────────────────────
    console.log("\n=== G5 · OFF→ON BETWEEN GENERATION AND DECISION — THE DECISION STAYS v1");
    // Move the world so a new recommendation is warranted rather than UNCHANGED.
    const originalStatus = (await one<{ s: string }>(`select status s from pursuits where id = $1`, [pursuit.id])).s;
    await db.query(`update pursuits set status = 'ROUTED' where id = $1`, [pursuit.id]);
    const g5rec = run(undefined, RECOMMEND(org.id, pursuit.id), "g5r") as { status: string; planId: string; revisionId: string };
    check("G5 · a v1 recommendation was generated while OFF",
      (await one<{ s: string }>(`select content->>'schema' s from pursuit_plan_revisions where id = $1`, [g5rec.revisionId])).s === "1", g5rec.status);
    const g5dec = run("true", DECIDE(org.id, pursuit.id, g5rec.planId, g5rec.revisionId), "g5d") as { decision: string };
    const g5row = await one<{ schema: string; basis_v: string; staged: string | null }>(
      `select content->>'schema' schema, basis->'inputs'->>'v' basis_v, content->'nextAction'->>'stagedMotionActionId' staged
         from pursuit_plan_revisions where responds_to_revision_id = $1`, [g5rec.revisionId]);
    check("G5 · decided with the gate ON, the decision is STILL schema 1 — never upgraded",
      g5dec.decision === "APPROVED" && g5row.schema === "1" && g5row.basis_v === "1", { decision: g5dec.decision, row: g5row });
    check("G5 · and it staged the v1 way", !!g5row.staged);

    // ── G3 · ON RECOMMENDATION ──────────────────────────────────────────────────────────────────
    console.log("\n=== G3 · GATE ON → RECOMMENDATION IS v2");
    await db.query(`update pursuits set status = $2 where id = $1`, [pursuit.id, originalStatus]);
    const g3 = run("on", RECOMMEND(org.id, pursuit.id), "g3") as { status: string; planId: string; revisionId: string };
    const g3row = await one<{ schema: string; has_next: boolean; actions: number; basis_v: string }>(
      `select content->>'schema' schema, content ? 'nextAction' has_next,
              jsonb_array_length(content->'actions') actions, basis->'inputs'->>'v' basis_v
         from pursuit_plan_revisions where id = $1`, [g3.revisionId]);
    check("G3 · persisted as schema 2 with an ordered action set, and no nextAction",
      g3row.schema === "2" && g3row.has_next === false && Number(g3row.actions) >= 1, g3row);
    check("G3 · with a v2 basis", g3row.basis_v === "2", g3row.basis_v);

    // ── G6 · ON→OFF TRANSITION — REFUSED BEFORE MUTATION ────────────────────────────────────────
    console.log("\n=== G6 · ON→OFF BEFORE THE DECISION — REFUSED, AND NOTHING MOVES");
    const beforeFp = await fingerprintWorld(CONN);
    const g6 = run(undefined, DECIDE(org.id, pursuit.id, g3.planId, g3.revisionId), "g6") as { THREW?: string };
    check("G6 · the decision is REFUSED, named as a disabled write path rather than a governance denial",
      typeof g6.THREW === "string" && /PlanContentV2WritesDisabled/.test(g6.THREW), g6.THREW);
    const afterFp = await fingerprintWorld(CONN);
    const moved = Object.keys({ ...beforeFp.tables, ...afterFp.tables })
      .filter((t) => JSON.stringify(beforeFp.tables[t]) !== JSON.stringify(afterFp.tables[t]));
    check("G6 · NOTHING was written — no revision, no staged action, no ledger row",
      beforeFp.digest === afterFp.digest && moved.length === 0, { moved, before: beforeFp.digest, after: afterFp.digest });
    check("G6 · the v2 recommendation is NOT downconverted and is still pending",
      (await one<{ s: string }>(`select content->>'schema' s from pursuit_plan_revisions where id = $1`, [g3.revisionId])).s === "2");

    // ── G7 · v2 IS STILL READABLE WHILE THE GATE IS OFF ─────────────────────────────────────────
    console.log("\n=== G7 · v2 DATA + GATE OFF IS A SUPPORTED STATE");
    const g7 = run(undefined, READ(org.id, pursuit.id), "g7") as Record<string, unknown>;
    note("G7 · what the OFF deployment reads", g7);
    check("G7 · the v2 revision is read, not refused — stored schemas include 2",
      Array.isArray(g7.storedSchemas) && (g7.storedSchemas as number[]).includes(2), g7.storedSchemas);
    check("G7 · Pursuit Detail renders an action and the ordered list", !!g7.headline && Number(g7.actions) >= 1, { headline: g7.headline, actions: g7.actions });
    check("G7 · Today, Queue lineage and Approvals all answer", typeof g7.today === "number" && typeof g7.lineageResolved === "number" && typeof g7.approvals === "number", g7);

    // ── G4 · ON DECISION ON A v2 RECOMMENDATION ─────────────────────────────────────────────────
    console.log("\n=== G4 · GATE ON → v2 RECOMMENDATION → v2 DECISION WITH LINEAGE");
    const lineageBefore = await lineageCount();
    const g4 = run("yes", DECIDE(org.id, pursuit.id, g3.planId, g3.revisionId), "g4") as { decision: string; stagedMotionActionId: string | null };
    check("G4 · the same recommendation is now decidable — the gate changed storage, not authority", g4.decision === "APPROVED", g4);
    const g4row = await one<{ schema: string; basis_v: string; has_next: boolean }>(
      `select content->>'schema' schema, basis->'inputs'->>'v' basis_v, content ? 'nextAction' has_next
         from pursuit_plan_revisions where responds_to_revision_id = $1`, [g3.revisionId]);
    check("G4 · persisted as schema 2 with a v2 basis and no legacy pointer",
      g4row.schema === "2" && g4row.basis_v === "2" && g4row.has_next === false, g4row);
    check("G4 · and it staged through the LINEAGE COLUMNS, not the content",
      await lineageCount() === lineageBefore + 1 && !!g4.stagedMotionActionId, { before: lineageBefore, after: await lineageCount() });
    const g4link = await one<{ key: string; rev: string }>(
      `select plan_action_key key, plan_revision_id::text rev from motion_actions where id = $1`, [g4.stagedMotionActionId]);
    const g4actions = await one<{ keys: string[] }>(
      `select array(select jsonb_array_elements(content->'actions')->>'key') keys from pursuit_plan_revisions where responds_to_revision_id = $1`, [g3.revisionId]);
    check("G4 · the staged key is a MEMBER of that revision's action set", g4actions.keys.includes(g4link.key), { staged: g4link.key, members: g4actions.keys });

    // ── G10 · THE GATE IS NOT AUTHORITY ─────────────────────────────────────────────────────────
    console.log("\n=== G10 · THE GATE CHANGES STORAGE VERSION, NEVER WHO MAY ACT");
    check("G10 · the SAME authorized actor took the SAME decision in both postures — OFF on a v1 plan (G2/G5), ON on a v2 plan (G4)",
      g2.decision === "APPROVED" && g5dec.decision === "APPROVED" && g4.decision === "APPROVED");
    check("G10 · and the refusal it does produce is a write-path error, not a permission or governance one",
      /PlanContentV2WritesDisabled/.test(String(g6.THREW)) && !/permission|not authori[sz]ed|forbidden|denied/i.test(String(g6.THREW)), g6.THREW);

    // ── G8 · UNKNOWN SCHEMA FAILS CLOSED IN EITHER POSTURE ──────────────────────────────────────
    console.log("\n=== G8 · UNKNOWN SCHEMA FAILS CLOSED, WHATEVER THE GATE SAYS");
    await db.query(
      `insert into pursuit_plan_revisions (org_id, pursuit_id, plan_id, revision_no, kind, content, basis, basis_fingerprint, actor_type, data_environment)
       values ($1,$2,$3,(select coalesce(max(revision_no),0)+1 from pursuit_plan_revisions where plan_id = $3),'RECOMMENDATION',
               jsonb_set($4::jsonb,'{schema}','3'), $5, 'fp-v3', 'SYSTEM', 'TEST')`,
      [org.id, pursuit.id, g3.planId,
       JSON.stringify({ schema: 3, focus: null, motion: { motionId: null, linkage: "NONE", label: null, status: null, partnerLabel: null, openActions: 0 }, actions: [], milestones: [], why: [] }),
       JSON.stringify({ recommenderVersion: "x", computedAt: new Date().toISOString(), fingerprint: "fp-v3", inputs: { v: 3 }, evidence: [] })]);
    for (const gate of [undefined, "true"]) {
      const r = run(gate, READ(org.id, pursuit.id), `g8_${gate ?? "off"}`) as { THREW?: string };
      check(`G8 · with the gate ${gate ? "ON" : "OFF"} an unknown schema throws UnknownPlanContentSchema`,
        typeof r.THREW === "string" && /UnknownPlanContentSchema/.test(r.THREW), r.THREW?.slice(0, 90));
    }
    await db.query(`delete from pursuit_plan_revisions where basis_fingerprint = 'fp-v3'`);

    // ── G11 · OPERATIONAL POSTURE ───────────────────────────────────────────────────────────────
    console.log("\n=== G11 · THE POSTURE IS REPORTED, AND NOT AS A TENANT CAPABILITY");
    const routeSrc = readFileSync(`${REPO}/src/app/api/build/route.ts`, "utf8");
    const postureBlock = routeSrc.slice(routeSrc.indexOf("posture: {"), routeSrc.indexOf("capabilities,"));
    check("G11 · `planContentV2WritesEnabled` is reported in the POSTURE block",
      /planContentV2WritesEnabled: planContentV2WritesEnabled\(\)/.test(postureBlock));
    check("G11 · and NOT inside the tenant capability array",
      !/planContentV2WritesEnabled/.test(routeSrc.slice(routeSrc.indexOf("let capabilities"), routeSrc.indexOf("posture: {"))));
    check("G11 · the resolved boolean is reported — never the env value itself",
      !/process\.env\.PLAN_CONTENT_V2_WRITES_ENABLED/.test(routeSrc));

    // ── G9 · NO UNAUTHORIZED SERIALIZER ─────────────────────────────────────────────────────────
    console.log("\n=== G9 · EVERY PRODUCTION PLAN-CONTENT SERIALIZER IS ACCOUNTED FOR");
    const store = readFileSync(`${REPO}/src/lib/pursuits/coordination/plan-store.ts`, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    const prodSerializers = execFileSync("grep", ["-rl", "insert into pursuit_plan_revisions", `${REPO}/src`], { encoding: "utf8" })
      .trim().split("\n").filter(Boolean);
    check("G9 · exactly ONE production module inserts plan content",
      prodSerializers.length === 1 && prodSerializers[0].endsWith("coordination/plan-store.ts"), prodSerializers.map((f) => f.replace(REPO, "")));
    const inserts = store.match(/insert into pursuit_plan_revisions/g) ?? [];
    check("G9 · with exactly two sites: recommendation generation, and a decision inheriting its parent's schema", inserts.length === 2, inserts.length);
    check("G9 · the GENERATION site consults the gate and writes one of the two composed representations",
      /const v2Writes = planContentV2WritesEnabled\(\);/.test(store)
      && /\? \{ content: rec\.content as StoredPlanContent, basis: rec\.basis \}/.test(store)
      && /: \{ content: rec\.legacyContent as StoredPlanContent, basis: rec\.legacyBasis \}/.test(store)
      && /JSON\.stringify\(written\.content\)/.test(store));
    check("G9 · the DECISION site inherits schema from the pinned recommendation and never converts",
      /const v1Decision = pending\.contentSchema === 1;/.test(store)
      && /JSON\.stringify\(storedContent\)/.test(store)
      && !/planContentV2WritesEnabled\(\)\s*\?\s*content/.test(store));
    check("G9 · and it refuses a v2 decision while writes are disabled, BEFORE any mutation",
      /if \(pending\.contentSchema === 2 && !planContentV2WritesEnabled\(\)\) \{\s*throw new PlanContentV2WritesDisabled\(\);/.test(store));
    check("G9 · no other production path can reach schema 2 — `PLAN_CONTENT_SCHEMA_V2` is written nowhere else",
      execFileSync("grep", ["-rl", "PLAN_CONTENT_SCHEMA_V2", `${REPO}/src`], { encoding: "utf8" })
        .trim().split("\n").every((f) => /read-models\/pursuit-plan\.ts$/.test(f)),
      execFileSync("grep", ["-rl", "PLAN_CONTENT_SCHEMA_V2", `${REPO}/src`], { encoding: "utf8" }).trim().split("\n").map((f) => f.replace(REPO, "")));
    check("G9 · READERS ARE NEVER GATED — no read module consults the write brake",
      execFileSync("grep", ["-rl", "planContentV2WritesEnabled", `${REPO}/src`], { encoding: "utf8" })
        .trim().split("\n").every((f) => /env\/environment\.ts$|coordination\/plan-store\.ts$|api\/build\/route\.ts$/.test(f)),
      execFileSync("grep", ["-rl", "planContentV2WritesEnabled", `${REPO}/src`], { encoding: "utf8" }).trim().split("\n").map((f) => f.replace(REPO, "")));
  } finally {
    db.release();
  }
}

main()
  .then(() => {
    console.log(`\n[p3-2c-gate-verify] ${passed} passed, ${failed} failed`);
    if (failures.length) console.log(failures.map((f) => `  - ${f}`).join("\n"));
    return pool.end();
  })
  .then(() => process.exit(failed === 0 ? 0 : 1))
  .catch(async (e) => {
    console.error("[p3-2c-gate-verify] FATAL", e);
    await pool.end().catch(() => {});
    process.exit(2);
  });
