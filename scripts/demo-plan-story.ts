/**
 * Pursuit plan layer (vNext Slice 2A) — the Globex acceptance path.
 *
 * Records PursuitOS's recommended plan for the canonical Globex hero pursuit, through
 * the SAME governed skill a person or a future worker would use
 * (`recommend_pursuit_plan` via `dispatchSkill`). Nothing is hand-written: the goal,
 * milestones, focus, motion, next action, owner and "why" are all composed by
 * `recommendPursuitPlan` from the world the ten earlier layers built. Run it last.
 *
 * WHAT IT LEAVES BEHIND. A PROPOSED goal, a PROPOSED plan and ONE recommendation —
 * awaiting a person's approval. No decision is seeded: approving is the human act the
 * surface exists to show. No change_ledger row is written (a recommendation is a
 * proposal, D-027), so the certified Slice 1 "What changed" for Globex is unchanged,
 * and no `goals` / `revenue_motions` row is written, so the certified manifest digest
 * is unchanged.
 *
 * Idempotent: the recommender records nothing when the canonical state has not moved.
 *
 *   DEMO_URL=… npx tsx scripts/demo-plan-story.ts
 */
import { Pool } from "pg";
import { assertSyntheticDatabase } from "../src/lib/env/db-identity";
import { recordPlanRecommendation } from "../src/lib/pursuits/coordination/plan-store";
import type { DataEnvironment } from "../src/lib/pursuits/lineage";

const URL = process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";

async function main() {
  const pool = new Pool({ connectionString: URL });
  // Refuses unless the TARGET database says it is synthetic (0102).
  await assertSyntheticDatabase(pool, "demo pursuit-plan seed");
  const db = await pool.connect();
  try {
    const hasSchema = (await db.query<{ t: string | null }>(`select to_regclass('public.pursuit_plan_revisions')::text as t`)).rows[0].t;
    if (!hasSchema) throw new Error("migration 0103 (pursuit coordination) is not applied to this database");

    const hero = (await db.query<{ id: string; org_id: string; data_environment: string }>(
      `select p.id, p.org_id, p.data_environment
         from pursuits p join companies c on c.id = p.account_id
        where c.legal_name = 'Globex Manufacturing Inc.' and p.pursuit_type = 'MODERNIZATION'
        order by p.created_at asc limit 1`)).rows[0];
    if (!hero) throw new Error("Globex hero pursuit not found — run the earlier layers first");

    await db.query("begin");
    await db.query("select set_config('app.org_id', $1, true)", [hero.org_id]);
    // SYSTEM actor: the platform proposing, never deciding. Called on the plan store DIRECTLY,
    // not through dispatchSkill — as demo-db.ts does for selectPartnerRoute. A setup-time
    // proposal has no human act to audit, and a governed_action_invocations row would surface
    // as the Federation panel's "Last action" on the flag-OFF Globex page, changing the
    // certified demo for a capability that is switched off. Live recommendations (the surface,
    // a future worker) still go through `recommend_pursuit_plan`.
    const r = await recordPlanRecommendation(db, { type: "SYSTEM", id: null, orgId: hero.org_id }, hero.id, {
      env: hero.data_environment as DataEnvironment, correlationId: null,
    });
    await db.query("commit");
    console.log(`  ✓ Globex — pursuit plan ${r.status === "RECORDED" ? "recommended" : "unchanged"} (awaiting a person's decision)`);
  } catch (e) {
    await db.query("rollback").catch(() => {});
    throw e;
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch((e) => { console.error("[demo-plan-story] fatal:", e); process.exit(1); });
