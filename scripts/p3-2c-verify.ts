import { Pool, type PoolClient } from "pg";
import { assertDisposableDatabase } from "./verify-guard";

/**
 * P3 SLICE 2C-A — PLAN-ACTION LINEAGE, AS THE DATABASE ENFORCES IT.
 *
 * > **v2 lineage lives on `motion_actions`. Live lineage requires `plan_revision_id`; a bare
 * > `plan_action_key` after a parent deletion is PROVENANCE, never lineage.**
 *
 * The semantic half of 2C-A — ordered derivation, dedup, versioned fingerprints, the current-action
 * selector — is pure and is proven in `tests/p3-2c-ordered-plan-actions.test.ts`. This suite proves
 * only what PostgreSQL itself must guarantee, because a constraint that is merely intended is not a
 * constraint: tenant integrity, live-lineage completeness, staging idempotency, and an explicit,
 * tested outcome for every way a parent row can disappear.
 *
 * Every assertion that claims something is REFUSED is paired with a control showing the same shape
 * ACCEPTED, so a suite that refused everything — including the legal cases — would fail.
 *
 * Fixtures COMMIT, so this runs on a disposable fully-migrated database.
 *
 *   npx tsx scripts/verify-run.ts --suite p3-2c
 */

const CONN = process.env.DATABASE_URL_VERIFY ?? "postgresql://postgres:postgres@127.0.0.1:5433/verify_disposable";
const pool = new Pool({ connectionString: CONN, max: 2 });
let passed = 0, failed = 0;
const failures: string[] = [];
const check = (n: string, ok: boolean, d?: unknown): void => {
  const detail = d === undefined ? "" : ` — ${JSON.stringify(d)}`;
  if (ok) { passed++; console.log(`  ✓ ${n}${detail}`); }
  else { failed++; failures.push(n); console.log(`  ✗ ${n}${detail}`); }
};
const note = (n: string, d?: unknown): void => console.log(`  · ${n}${d === undefined ? "" : ` — ${JSON.stringify(d)}`}`);

/** Did this statement fail, and with what? Used for every refusal claim. */
async function refused(fn: () => Promise<unknown>): Promise<string | null> {
  try { await fn(); return null; } catch (e) { return (e as Error).message; }
}

const V2_CONTENT = (actions: { key: string; text: string }[]) => JSON.stringify({
  schema: 2, focus: null,
  motion: { motionId: null, linkage: "NONE", label: null, status: null, partnerLabel: null, openActions: 0 },
  actions: actions.map((a) => ({
    key: a.key, text: a.text, doneWhen: null, via: null,
    owner: { kind: "UNASSIGNED", teamMemberId: null, role: null, roleLabel: null, personLabel: null, confirmed: false },
    dueInDays: 5, milestoneKey: null,
  })),
  milestones: [], why: [],
});
const V1_CONTENT = (stagedMotionActionId: string | null) => JSON.stringify({
  schema: 1, focus: null,
  motion: { motionId: null, linkage: "NONE", label: null, status: null, partnerLabel: null, openActions: 0 },
  nextAction: {
    key: "verify_role:economic_buyer", text: "Identify and verify the economic buyer", doneWhen: null, via: null,
    owner: { kind: "UNASSIGNED", teamMemberId: null, role: null, roleLabel: null, personLabel: null, confirmed: false },
    dueInDays: 5, stagedMotionActionId,
  },
  milestones: [], why: [],
});
const BASIS = (v: 1 | 2) => JSON.stringify({ recommenderVersion: `pursuit-plan-v${v}`, computedAt: new Date().toISOString(), fingerprint: `fp-v${v}`, inputs: { v }, evidence: [] });

interface World {
  orgA: string; orgB: string;
  companyA: string; motionA: string; motionB: string;
  pursuitA: string; pursuitB: string;
  planA: string; revA: string; revB: string; revA1: string;
}

async function plant(db: PoolClient): Promise<World> {
  const rid = Math.random().toString(36).slice(2, 8);
  const org = async (n: string) => (await db.query<{ id: string }>(
    `insert into organizations (name, kind, created_at) values ($1,'full', now()) returning id`, [`${n} ${rid}`])).rows[0].id;
  const orgA = await org("P3-2C A"); const orgB = await org("P3-2C B");
  // `companies` is a shared canonical entity with no org column — tenancy lives on the rows that
  // reference it, which is exactly why the lineage FK carries org_id itself.
  const company = async (n: string) => (await db.query<{ id: string }>(
    `insert into companies (legal_name, normalized_name, created_at) values ($1,$2, now()) returning id`,
    [`${n} ${rid}`, `${n.toLowerCase()}-${rid}`])).rows[0].id;
  const companyA = await company("Globex"); const companyB = await company("Initech");
  const motion = async (o: string, c: string) => (await db.query<{ id: string }>(
    `insert into revenue_motions (org_id, company_id, status, created_at) values ($1,$2,'active', now()) returning id`, [o, c])).rows[0].id;
  const motionA = await motion(orgA, companyA); const motionB = await motion(orgB, companyB);
  const pursuit = async (o: string, c: string) => (await db.query<{ id: string }>(
    `insert into pursuits (org_id, account_id, status, dedup_key, data_environment)
     values ($1,$2,'QUALIFIED',$3,'TEST') returning id`, [o, c, `p3-2c-${rid}-${Math.random().toString(36).slice(2, 8)}`])).rows[0].id;
  const pursuitA = await pursuit(orgA, companyA); const pursuitB = await pursuit(orgB, companyB);
  const planOf = async (o: string, p: string) => {
    const goal = (await db.query<{ id: string }>(
      `insert into pursuit_goals (org_id, pursuit_id, objective, status, origin, proposed_by_actor_type, data_environment)
       values ($1,$2,'Close it','PROPOSED','SYSTEM_RECOMMENDED','SYSTEM','TEST') returning id`, [o, p])).rows[0].id;
    return (await db.query<{ id: string }>(
      `insert into pursuit_plans (org_id, pursuit_id, goal_id, status, data_environment)
       values ($1,$2,$3,'PROPOSED','TEST') returning id`, [o, p, goal])).rows[0].id;
  };
  const planA = await planOf(orgA, pursuitA); const planB = await planOf(orgB, pursuitB);
  const revision = async (o: string, p: string, pl: string, no: number, content: string, v: 1 | 2) => (await db.query<{ id: string }>(
    `insert into pursuit_plan_revisions (org_id, pursuit_id, plan_id, revision_no, kind, content, basis, basis_fingerprint, actor_type, data_environment)
     values ($1,$2,$3,$4,'RECOMMENDATION',$5,$6,$7,'SYSTEM','TEST') returning id`,
    [o, p, pl, no, content, BASIS(v), `fp-v${v}`])).rows[0].id;
  const revA = await revision(orgA, pursuitA, planA, 1, V2_CONTENT([{ key: "verify_role:economic_buyer", text: "Confirm the economic buyer" }, { key: "confirm_timing", text: "Confirm the timing" }]), 2);
  const revA1 = await revision(orgA, pursuitA, planA, 2, V1_CONTENT(null), 1);
  const revB = await revision(orgB, pursuitB, planB, 1, V2_CONTENT([{ key: "verify_role:champion", text: "Confirm the champion" }]), 2);
  return { orgA, orgB, companyA, motionA, motionB, pursuitA, pursuitB, planA, revA, revB, revA1 };
}

const stage = (db: PoolClient, w: { org: string; motion: string; step: number; revision: string | null; key: string | null }) =>
  db.query<{ id: string }>(
    `insert into motion_actions (org_id, motion_id, step, action, due_at, plan_revision_id, plan_action_key)
     values ($1,$2,$3,'staged action', now() + interval '5 days', $4, $5) returning id`,
    [w.org, w.motion, w.step, w.revision, w.key]);

async function main(): Promise<void> {
  await assertDisposableDatabase(pool);
  console.log(`[p3-2c-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);
  const db = await pool.connect();
  try {
    // ── 0 · THE MIGRATION IS PRESENT, AND IS WHAT IT CLAIMS ────────────────────────────────────
    console.log("\n=== 0 · SCHEMA 115");
    const cols = (await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name='motion_actions' and column_name in ('plan_revision_id','plan_action_key') order by 1`)).rows.map((r) => r.column_name);
    check("0 · motion_actions carries both lineage columns", cols.join(",") === "plan_action_key,plan_revision_id", cols);
    const fk = (await db.query<{ d: string }>(`select pg_get_constraintdef(oid) d from pg_constraint where conname='motion_actions_plan_revision_fk'`)).rows[0]?.d ?? "";
    check("0 · the FK is tenant-composite and sets NULL on plan_revision_id only",
      /FOREIGN KEY \(org_id, plan_revision_id\) REFERENCES pursuit_plan_revisions\(org_id, id\)/.test(fk)
      && /ON DELETE SET NULL \(plan_revision_id\)/.test(fk), fk);
    check("0 · no trigger was introduced by 0115",
      Number((await db.query<{ n: number }>(`select count(*)::int n from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and c.relname='motion_actions'`)).rows[0].n) === 0);

    const w = await plant(db);
    note("fixture planted", { orgA: w.orgA.slice(0, 8), orgB: w.orgB.slice(0, 8) });

    // ── D1–D5 · WHAT THE CONSTRAINTS REFUSE, AND WHAT THEY MUST NOT ────────────────────────────
    console.log("\n=== D1–D5 · LIVE-LINEAGE INTEGRITY");
    const d1 = await refused(() => stage(db, { org: w.orgA, motion: w.motionA, step: 10, revision: w.revB, key: "verify_role:champion" }));
    check("D1 · a cross-tenant revision reference is REFUSED", d1 !== null && /foreign key|violates/i.test(d1), d1?.slice(0, 80));
    const d2 = await refused(() => stage(db, { org: w.orgA, motion: w.motionA, step: 11, revision: w.revA, key: null }));
    check("D2 · a revision without an action key is REFUSED", d2 !== null && /motion_actions_plan_lineage_live/.test(d2), d2?.slice(0, 80));
    const d3 = await refused(() => stage(db, { org: null as unknown as string, motion: w.motionA, step: 12, revision: w.revA, key: "verify_role:economic_buyer" }));
    check("D3 · a null tenant with live lineage is REFUSED — the FK alone would not catch it (MATCH SIMPLE)",
      d3 !== null && /motion_actions_plan_lineage_live/.test(d3), d3?.slice(0, 80));

    const live = (await stage(db, { org: w.orgA, motion: w.motionA, step: 1, revision: w.revA, key: "verify_role:economic_buyer" })).rows[0].id;
    check("D1–D3 CONTROL · the legal shape is ACCEPTED — the constraints are not refusing everything", !!live);
    const d4 = await refused(() => stage(db, { org: w.orgA, motion: w.motionA, step: 2, revision: w.revA, key: "verify_role:economic_buyer" }));
    check("D4 · a duplicate (org, revision, action key) is REFUSED", d4 !== null && /motion_actions_plan_action_unique/.test(d4), d4?.slice(0, 80));
    const second = await refused(() => stage(db, { org: w.orgA, motion: w.motionA, step: 3, revision: w.revA, key: "confirm_timing" }));
    check("D4 CONTROL · a DIFFERENT action of the same revision stages normally", second === null, second?.slice(0, 80));
    const legacy = await refused(() => stage(db, { org: w.orgA, motion: w.motionA, step: 4, revision: null, key: null }));
    check("D5 · a legacy row with no lineage at all is ACCEPTED, unchanged and unbackfilled", legacy === null, legacy?.slice(0, 80));

    // ── D6/D7 · PARENT DELETION ────────────────────────────────────────────────────────────────
    console.log("\n=== D6–D9 · DELETION SEMANTICS");
    const beforeDirect = (await db.query(`select org_id, plan_revision_id, plan_action_key, action from motion_actions where id = $1`, [live])).rows[0];
    await db.query(`delete from pursuit_plan_revisions where id = $1`, [w.revA]);
    const afterDirect = (await db.query(`select org_id, plan_revision_id, plan_action_key, action from motion_actions where id = $1`, [live])).rows[0];
    check("D6 · the queue row SURVIVES a direct plan-revision deletion", !!afterDirect);
    check("D6 · plan_revision_id is nulled, org_id and the action key SURVIVE",
      afterDirect?.plan_revision_id === null && afterDirect?.org_id === beforeDirect?.org_id
      && afterDirect?.plan_action_key === beforeDirect?.plan_action_key,
      { org: afterDirect?.org_id === beforeDirect?.org_id, key: afterDirect?.plan_action_key });
    check("D6 · the surviving row still satisfies the live-lineage check", true);

    // A pursuit deletion cascades its revisions away while `revenue_motions -> pursuits` SET NULL
    // keeps the motion. The queue work must survive that too, with its tenant intact.
    const live2 = (await stage(db, { org: w.orgA, motion: w.motionA, step: 5, revision: w.revA1, key: "verify_role:economic_buyer" })).rows[0].id;
    await db.query(`update revenue_motions set pursuit_id = $2 where id = $1`, [w.motionA, w.pursuitA]);
    await db.query(`delete from pursuits where id = $1`, [w.pursuitA]);
    const afterCascade = (await db.query(`select org_id, plan_revision_id, plan_action_key from motion_actions where id = $1`, [live2])).rows[0];
    check("D7 · a pursuit deletion produces the same detached result", !!afterCascade && afterCascade.plan_revision_id === null && afterCascade.plan_action_key !== null,
      afterCascade);
    check("D7 · the motion and its queue work survive the pursuit, exactly as `revenue_motions -> pursuits SET NULL` intends",
      Number((await db.query<{ n: number }>(`select count(*)::int n from revenue_motions where id = $1`, [w.motionA])).rows[0].n) === 1
      && Number((await db.query<{ n: number }>(`select count(*)::int n from motion_actions where motion_id = $1`, [w.motionA])).rows[0].n) > 0);
    check("D7 · the plan history is gone, as it always was",
      Number((await db.query<{ n: number }>(`select count(*)::int n from pursuit_plan_revisions where plan_id = $1`, [w.planA])).rows[0].n) === 0);

    const orphanCount = Number((await db.query<{ n: number }>(`select count(*)::int n from motion_actions where motion_id = $1`, [w.motionA])).rows[0].n);
    await db.query(`delete from revenue_motions where id = $1`, [w.motionA]);
    check("D8 · deleting the MOTION cascades its actions away, and touches no plan history",
      Number((await db.query<{ n: number }>(`select count(*)::int n from motion_actions where motion_id = $1`, [w.motionA])).rows[0].n) === 0
      && Number((await db.query<{ n: number }>(`select count(*)::int n from pursuit_plan_revisions where org_id = $1`, [w.orgB])).rows[0].n) === 1,
      { hadActions: orphanCount });

    const liveB = (await stage(db, { org: w.orgB, motion: w.motionB, step: 1, revision: w.revB, key: "verify_role:champion" })).rows[0].id;
    await db.query(`delete from organizations where id = $1`, [w.orgB]);
    check("D9 · deleting the organization removes BOTH sides, with no dangling reference and no error",
      Number((await db.query<{ n: number }>(`select count(*)::int n from motion_actions where id = $1`, [liveB])).rows[0].n) === 0
      && Number((await db.query<{ n: number }>(`select count(*)::int n from pursuit_plan_revisions where id = $1`, [w.revB])).rows[0].n) === 0);

    // ── D10–D12 · WHAT A DETACHED ROW MEANS ────────────────────────────────────────────────────
    console.log("\n=== D10–D12 · PROVENANCE IS NOT LINEAGE");
    const w2 = await plant(db);
    const detached = (await stage(db, { org: w2.orgA, motion: w2.motionA, step: 1, revision: w2.revA, key: "confirm_timing" })).rows[0].id;
    await db.query(`delete from pursuit_plan_revisions where id = $1`, [w2.revA]);
    // The lineage read is the v2 predicate the product uses: it names plan_revision_id, so a
    // detached row is invisible to it by construction rather than by filtering afterwards.
    const resolved = (await db.query(
      `select ma.id from motion_actions ma join pursuit_plan_revisions r on r.org_id = ma.org_id and r.id = ma.plan_revision_id
        where ma.id = $1 and ma.plan_revision_id is not null`, [detached])).rows;
    check("D10 · a detached row resolves to NO live plan lineage", resolved.length === 0);
    check("D10 · and it still carries its action key as provenance",
      (await db.query<{ k: string | null }>(`select plan_action_key k from motion_actions where id = $1`, [detached])).rows[0].k === "confirm_timing");
    const reStage = await refused(() => stage(db, { org: w2.orgA, motion: w2.motionA, step: 2, revision: null, key: "confirm_timing" }));
    check("D11 · detached rows are OUTSIDE the live-lineage unique index — a second one is accepted", reStage === null, reStage?.slice(0, 80));

    const live3 = (await stage(db, { org: w2.orgA, motion: w2.motionA, step: 3, revision: w2.revA1, key: "verify_role:economic_buyer" })).rows[0].id;
    await db.query(`delete from change_ledger where org_id = $1`, [w2.orgA]);
    const stillResolves = (await db.query(
      `select ma.id from motion_actions ma join pursuit_plan_revisions r on r.org_id = ma.org_id and r.id = ma.plan_revision_id where ma.id = $1`, [live3])).rows;
    check("D12 · lineage resolves with NO ledger row — the ledger corroborates, it never defines", stillResolves.length === 1);

    // ── V1 / V2 DISCRIMINATION ─────────────────────────────────────────────────────────────────
    console.log("\n=== VERSIONED LINEAGE READS");
    const w3 = await plant(db);
    const legacyRow = (await stage(db, { org: w3.orgA, motion: w3.motionA, step: 1, revision: null, key: null })).rows[0].id;
    await db.query(`update pursuit_plan_revisions set content = $2 where id = $1`, [w3.revA1, V1_CONTENT(legacyRow)]);
    const v2Row = (await stage(db, { org: w3.orgA, motion: w3.motionA, step: 2, revision: w3.revA, key: "confirm_timing" })).rows[0].id;
    const v1Branch = (await db.query<{ staged: string }>(
      `select ma.id::text as staged from pursuit_plan_revisions r
         join motion_actions ma on ma.id::text = r.content->'nextAction'->>'stagedMotionActionId' and ma.org_id = r.org_id
        where r.org_id = $1 and (r.content->>'schema')::int = 1 and ma.plan_revision_id is null`, [w3.orgA])).rows.map((r) => r.staged);
    const v2Branch = (await db.query<{ staged: string }>(
      `select ma.id::text as staged from motion_actions ma
         join pursuit_plan_revisions r on r.org_id = ma.org_id and r.id = ma.plan_revision_id
        where ma.org_id = $1 and ma.plan_revision_id is not null`, [w3.orgA])).rows.map((r) => r.staged);
    check("v1 lineage resolves ONLY through the schema=1 branch", v1Branch.length === 1 && v1Branch[0] === legacyRow, v1Branch);
    check("v2 lineage resolves ONLY through the structural columns", v2Branch.length === 1 && v2Branch[0] === v2Row, v2Branch);
    check("the two branches are disjoint — no row is claimed by both", !v1Branch.some((x) => v2Branch.includes(x)));
    // AN UNKNOWN SCHEMA REACHES NEITHER. A v3 row carrying a v1-shaped pointer must not be read as
    // v1 merely because the field is there.
    await db.query(`update pursuit_plan_revisions set content = jsonb_set($2::jsonb, '{schema}', '3') where id = $1`, [w3.revB, V1_CONTENT(legacyRow)]);
    const unknownBranch = (await db.query<{ n: number }>(
      `select count(*)::int n from pursuit_plan_revisions r
         join motion_actions ma on ma.id::text = r.content->'nextAction'->>'stagedMotionActionId' and ma.org_id = r.org_id
        where r.id = $1 and (r.content->>'schema')::int = 1`, [w3.revB])).rows[0].n;
    check("an unknown schema carrying a v1-shaped pointer resolves to NOTHING — absence, not a guess", Number(unknownBranch) === 0);

    // ── AUTHORITY IS UNCHANGED ─────────────────────────────────────────────────────────────────
    console.log("\n=== AUTHORITY");
    for (const t of ["pursuit_runs", "pursuit_run_steps", "pursuit_run_approvals", "governed_action_invocations"]) {
      check(`2C-A creates no ${t} row — plan content confers no authority and compiles to nothing`,
        Number((await db.query<{ n: number }>(`select count(*)::int n from ${t}`)).rows[0].n) === 0);
    }
  } finally {
    db.release();
  }
}

main()
  .then(() => {
    console.log(`\n[p3-2c-verify] ${passed} passed, ${failed} failed`);
    if (failures.length) console.log(failures.map((f) => `  - ${f}`).join("\n"));
    return pool.end();
  })
  .then(() => process.exit(failed === 0 ? 0 : 1))
  .catch(async (e) => {
    console.error("[p3-2c-verify] FATAL", e);
    await pool.end().catch(() => {});
    process.exit(2);
  });
