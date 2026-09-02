/**
 * Demo goal — one commercial objective whose progress is COMPUTED (Wave 2 §8).
 *
 * The Goals room is the one place that proves the platform's central claim about
 * reporting: a target is not a spreadsheet cell somebody types at quarter end,
 * it is a number that rolls up from the commercial objects a team actually
 * linked to it. With no goal on the board that claim is unillustrated, and the
 * room opens on an empty-state form.
 *
 * USES EXISTING PRIMITIVES ONLY. `goals` (migration 0026) and
 * `revenue_motions.goal_id` already exist; this writes one row and sets a
 * foreign key on motions that are already there. No schema change, no new
 * semantics, and — importantly — NO WRITTEN ACTUAL. `pipeline_usd` is derived by
 * `listGoals` as the sum of `estimated_value_usd` over linked motions, so the
 * attainment the room shows is whatever the canonical record says it is.
 *
 * If that number is unflattering, it is still the number. The point of the demo
 * is that the roll-up is real, not that it is high.
 *
 *   DEMO_URL=postgresql://... npx tsx scripts/demo-goal.ts
 */
import { Pool } from "pg";
import { assertSyntheticDatabase } from "../src/lib/env/db-identity";
import { formatMoney } from "../src/lib/format/money";

const URL = process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const pool = new Pool({ connectionString: URL });

const GOAL_NAME = "$5M Virtualization Co-Sell Pipeline — Q4 2026";
const TARGET = 5_000_000;
const START = "2026-10-01";
const DUE = "2026-12-31";

const log = (m: string) => console.log(`[demo-goal] ${m}`);

async function main() {
  log(`seeding → ${URL.replace(/:[^:@/]*@/, ":***@")}`);
  // The database says whether it is synthetic; an exported production DEMO_URL
  // is the realistic accident, and the env cannot be trusted to catch it.
  await assertSyntheticDatabase(pool, "demo goal seed");

  const db = await pool.connect();
  try {
    await db.query("begin");

    const org = (await db.query<{ id: string }>(
      `select id from organizations where name = 'Vertex Systems' order by created_at asc limit 1`,
    )).rows[0];
    if (!org) throw new Error("Vertex Systems (the demo vendor org) not found — run scripts/demo-db.ts first.");

    // Idempotent by (org, name): re-running updates the target rather than
    // stacking duplicate goals on the board.
    const existing = (await db.query<{ id: string }>(
      `select id from goals where org_id = $1 and name = $2 limit 1`, [org.id, GOAL_NAME],
    )).rows[0];

    const description =
      "Demo goal. Progress is computed from the co-sell motions linked below — " +
      "no actual is typed in.";

    let goalId: string;
    if (existing) {
      await db.query(
        `update goals set target_value = $2, baseline_value = 0, metric = 'pipeline_usd',
                          start_date = $3, due_date = $4, status = 'active',
                          description = $5, owner = 'Dana'
         where id = $1`,
        [existing.id, TARGET, START, DUE, description],
      );
      goalId = existing.id;
      log("goal already present — refreshed target and dates");
    } else {
      goalId = (await db.query<{ id: string }>(
        `insert into goals (org_id, name, description, metric, target_value, baseline_value,
                            start_date, due_date, status, owner)
         values ($1,$2,$3,'pipeline_usd',$4,0,$5,$6,'active','Dana') returning id`,
        [org.id, GOAL_NAME, description, TARGET, START, DUE],
      )).rows[0].id;
      log("goal created");
    }

    // Link every PARTNER-ATTRIBUTED motion in this org. Partner attribution is
    // what makes a motion co-sell, so the link rule is the goal's own definition
    // rather than a hand-picked list chosen to make the total look better.
    const linked = await db.query<{ id: string }>(
      `update revenue_motions m set goal_id = $1
         where m.org_id = $2 and m.partner_id is not null and m.goal_id is distinct from $1
       returning m.id`,
      [goalId, org.id],
    );
    log(`linked ${linked.rowCount} partner-attributed motion(s)`);

    // Report what the room will now show, from the same expression listGoals uses.
    const roll = await db.query<{ partner: string; n: string; usd: string }>(
      `select coalesce(p.name, '(direct)') as partner, count(*)::text as n,
              coalesce(sum(m.estimated_value_usd), 0)::text as usd
         from revenue_motions m
         left join partners p on p.id = m.partner_id
        where m.goal_id = $1
        group by 1 order by 3 desc`,
      [goalId],
    );
    const total = roll.rows.reduce((s, r) => s + Number(r.usd), 0);

    // ---- Skills (Wave 2 §12) ----------------------------------------------
    // One positioning skill, so the Skills library shows what it is FOR:
    // institutional commercial knowledge — the thing a good rep knows and a new
    // one does not — written down once and applied by every agent. It is not a
    // prompt, and it is deliberately not clever.
    const SKILL = "Virtualization renewal positioning";
    const skillBody =
      "Lead with modernization risk and renewal timing.\n\n" +
      "Do not position migration as cost reduction alone — the saving is real but it is not the " +
      "reason a platform decision gets made, and leading with it invites a procurement conversation " +
      "instead of an architecture one.\n\n" +
      "Require partner acceptance before any partner-led customer outreach.";
    const skillExists = (await db.query(
      `select 1 from skills where org_id = $1 and name = $2`, [org.id, SKILL],
    )).rowCount;
    if (!skillExists) {
      await db.query(
        `insert into skills (org_id, name, kind, scope_type, scope_id, body, status, created_by)
         values ($1, $2, 'positioning', 'org', null, $3, 'active', 'Demo')`,
        [org.id, SKILL, skillBody],
      );
      log(`skill created: ${SKILL}`);
    } else {
      log(`skill already present: ${SKILL}`);
    }

    await db.query("commit");

    log("");
    log(`  ${GOAL_NAME}`);
    log(`  target   ${formatMoney(TARGET)}`);
    log(`  actual   ${formatMoney(total)}  (computed, not written)`);
    log(`  progress ${Math.round((total / TARGET) * 100)}%`);
    for (const r of roll.rows) log(`    ${r.partner.padEnd(12)} ${r.n} motion(s)  ${formatMoney(Number(r.usd))}`);
  } catch (e) {
    await db.query("rollback").catch(() => {});
    throw e;
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(`[demo-goal] fatal: ${e}`); process.exit(1); });
