/**
 * Append-only enforcement verification (canonical micro-loop, Phase 2, migration 0094).
 * Proves at the DATABASE level — as the real non-owner `app_rw` role, under RLS — that the
 * canonical history/ledger tables reject destructive writes, while the legitimate forward-only
 * lifecycle writes still succeed. History is corrected by APPENDING, never by rewriting.
 *
 * Run: DEMO_URL=… npx tsx scripts/append-only-verify.ts   (owner connection; drops to app_rw via SET ROLE)
 */
import { Pool, type PoolClient } from "pg";

const URL = process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const DENIED = "42501"; // insufficient_privilege

/** Run one statement as app_rw with the row's org pinned; resolve to the pg error code (or "OK"). */
async function asAppRw(db: PoolClient, orgId: string, sql: string, params: unknown[]): Promise<string> {
  await db.query("begin");
  try {
    await db.query("set local role app_rw");
    await db.query("select set_config('app.org_id',$1,true)", [orgId]);
    await db.query(sql, params);
    await db.query("rollback"); // never actually persist a probe
    return "OK";
  } catch (e) {
    await db.query("rollback").catch(() => {});
    return (e as { code?: string }).code ?? "ERR";
  }
}

async function main() {
  const pool = new Pool({ connectionString: URL });
  const db = await pool.connect();
  try {
    const cl = (await db.query<{ id: string; org_id: string }>(`select id, org_id from change_ledger limit 1`)).rows[0];
    const ov = (await db.query<{ id: string; org_id: string }>(`select id, org_id from pursuit_overrides limit 1`)).rows[0];
    const gi = (await db.query<{ id: string; org_id: string }>(`select id, org_id from governed_action_invocations limit 1`)).rows[0];
    ok("fixtures present (ledger, override, invocation rows exist)", !!(cl && ov && gi));
    if (!cl || !ov || !gi) { console.log("\n[append-only-verify] missing fixtures — run the demo seed first"); process.exit(1); }

    // change_ledger — pure append-only: UPDATE and DELETE both denied.
    ok("change_ledger UPDATE denied for app_rw", await asAppRw(db, cl.org_id, `update change_ledger set reason='x' where id=$1`, [cl.id]) === DENIED);
    ok("change_ledger DELETE denied for app_rw", await asAppRw(db, cl.org_id, `delete from change_ledger where id=$1`, [cl.id]) === DENIED);

    // pursuit_overrides — RECORD immutable, only convergence annotation writable.
    ok("pursuit_overrides UPDATE of the RECORD (reason) denied", await asAppRw(db, ov.org_id, `update pursuit_overrides set reason='x' where id=$1`, [ov.id]) === DENIED);
    ok("pursuit_overrides UPDATE of human_decision denied", await asAppRw(db, ov.org_id, `update pursuit_overrides set human_decision='{}'::jsonb where id=$1`, [ov.id]) === DENIED);
    ok("pursuit_overrides DELETE denied", await asAppRw(db, ov.org_id, `delete from pursuit_overrides where id=$1`, [ov.id]) === DENIED);
    ok("pursuit_overrides convergence annotation (system_converged) ALLOWED", await asAppRw(db, ov.org_id, `update pursuit_overrides set system_converged=true where id=$1`, [ov.id]) === "OK");

    // governed_action_invocations — request identity immutable, forward status writable.
    ok("governed_action_invocations UPDATE of args denied", await asAppRw(db, gi.org_id, `update governed_action_invocations set args='{}'::jsonb where id=$1`, [gi.id]) === DENIED);
    ok("governed_action_invocations UPDATE of skill_id denied", await asAppRw(db, gi.org_id, `update governed_action_invocations set skill_id='x' where id=$1`, [gi.id]) === DENIED);
    ok("governed_action_invocations DELETE denied", await asAppRw(db, gi.org_id, `delete from governed_action_invocations where id=$1`, [gi.id]) === DENIED);
    ok("governed_action_invocations forward status UPDATE ALLOWED", await asAppRw(db, gi.org_id, `update governed_action_invocations set status='EXECUTED', executed_at=now() where id=$1`, [gi.id]) === "OK");

    console.log(`\n[append-only-verify] ${pass} passed, ${fail} failed`);
    if (fail) process.exit(1);
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch((e) => { console.error("[append-only-verify] fatal:", e); process.exit(1); });
