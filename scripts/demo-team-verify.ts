import { createHash } from "node:crypto";
import { Pool } from "pg";
import { CANONICAL_TEAM_REQUIREMENTS, isEmptyRepairPlan, planCanonicalTeamRequirements } from "../src/lib/routing/team-requirements";

/**
 * Canonical team layer — supplemental verifier (2026-09-14).
 *
 * WHY IT EXISTS. The manifest (`demo-manifest.ts`) counts no team table, and `verify()` in
 * `seed-demo-world.ts` did not either. So an in-place reseed that lost every pursuit team — 0
 * global team requirements, 0 team members, Globex's ledger short its "Team assembled" row —
 * still reconciled EXACTLY. This asserts the team layer the canonical seed builds, and prints a
 * digest of it so a fresh build and an in-place reseed can be compared directly.
 *
 * READ-ONLY: one READ ONLY transaction, always rolled back.
 * CLASSIFICATION: SEEDED — it reads the canonical world.
 *
 *   DATABASE_URL_VERIFY=… npx tsx scripts/demo-team-verify.ts
 */

const CONN = process.env.DATABASE_URL_VERIFY ?? process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const pool = new Pool({ connectionString: CONN, max: 1 });

/** The certified Globex hero ledger: the base world, the team, the route override, four stakeholder assertions. */
const GLOBEX_LEDGER = [
  "FACT_LINKED_TO_PURSUIT", "OVERRIDE_RECORDED", "PARTNER_OVERRIDE", "PURSUIT_CREATED", "ROUTE_RECOMMENDATION_CHANGED",
  "STAKEHOLDER_ROLE_ASSERTED", "STAKEHOLDER_ROLE_ASSERTED", "STAKEHOLDER_ROLE_ASSERTED", "STAKEHOLDER_ROLE_ASSERTED", "TEAM_CHANGED",
];
const SIDE: Record<string, string> = {
  VENDOR_ACCOUNT_EXECUTIVE: "VENDOR", VENDOR_SPECIALIST: "VENDOR", VENDOR_SOLUTION_ARCHITECT: "VENDOR",
  PARTNER_ACCOUNT_MANAGER: "PARTNER", DISTRIBUTOR_BDM: "DISTRIBUTOR",
};

let passed = 0, failed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

async function main(): Promise<void> {
  console.log(`[demo-team-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);
  const c = await pool.connect();
  try {
    await c.query("begin read only");

    console.log("\n1  Canonical global team requirements");
    const global = (await c.query<{ id: string; pursuit_type: string | null; role: string; required: boolean; created_at: Date }>(
      `select id, pursuit_type, role, required, created_at from pursuit_team_requirements where org_id is null`)).rows;
    const shape = global.map((r) => `${r.role}:${r.required}:${r.pursuit_type ?? "*"}`).sort();
    const want = CANONICAL_TEAM_REQUIREMENTS.map((r) => `${r.role}:${r.required}:*`).sort();
    check(`exactly the ${want.length} canonical global requirements`, JSON.stringify(shape) === JSON.stringify(want), shape.join(", ") || "none");
    check("no role is duplicated", new Set(global.map((r) => r.role)).size === global.length);
    check("a re-seed would change nothing (repair plan is empty)", isEmptyRepairPlan(planCanonicalTeamRequirements(
      global.map((r) => ({ id: r.id, pursuitType: r.pursuit_type, role: r.role, required: r.required, createdAt: r.created_at })))));
    const tenantRows = Number((await c.query<{ n: string }>(`select count(*)::text n from pursuit_team_requirements where org_id is not null`)).rows[0].n);
    check("the canonical world defines no tenant-specific requirements", tenantRows === 0, `${tenantRows}`);

    console.log("\n2  Globex hero team (assembled from those requirements)");
    const hero = (await c.query<{ id: string }>(
      `select p.id from pursuits p join companies co on co.id = p.account_id
        where co.legal_name = 'Globex Manufacturing Inc.' and p.pursuit_type = 'MODERNIZATION' order by p.created_at limit 1`)).rows[0];
    if (!hero) { console.log("FATAL: Globex hero pursuit not found — seed the canonical world first."); process.exit(1); }
    const team = (await c.query<{ role: string; side: string; status: string; is_recommended: boolean; partner_id: string | null }>(
      `select role, side, status, is_recommended, partner_id from pursuit_team_members where pursuit_id = $1 and status <> 'SUPERSEDED' order by role`,
      [hero.id])).rows;
    check("one live member per canonical role", JSON.stringify(team.map((m) => m.role).sort()) === JSON.stringify(CANONICAL_TEAM_REQUIREMENTS.map((r) => r.role).sort()),
      team.map((m) => m.role).join(", ") || "none");
    check("every member is a recommendation nobody has confirmed (RECOMMENDED)", team.length > 0 && team.every((m) => m.status === "RECOMMENDED" && m.is_recommended));
    check("each member is on the side its role belongs to", team.every((m) => SIDE[m.role] === m.side));
    check("the partner role names a partner; vendor and distributor roles do not", team.every((m) => (m.side === "PARTNER") === (m.partner_id !== null)));

    console.log("\n3  Globex ledger");
    const ledger = (await c.query<{ change_type: string; reason: string | null }>(
      `select change_type, reason from change_ledger where pursuit_id = $1`, [hero.id])).rows;
    const assembled = ledger.filter((l) => l.change_type === "TEAM_CHANGED");
    check("exactly one 'Team assembled' event", assembled.length === 1 && /^Team assembled \(5 roles\)$/.test(assembled[0].reason ?? ""), assembled.map((l) => l.reason).join(" | "));
    check(`the certified ${GLOBEX_LEDGER.length}-row Globex history`,
      JSON.stringify(ledger.map((l) => l.change_type).sort()) === JSON.stringify(GLOBEX_LEDGER), `${ledger.length} rows`);

    console.log("\n4  Team layer across the world");
    const dupes = Number((await c.query<{ n: string }>(
      `select count(*)::text n from (select pursuit_id, role from pursuit_team_members where status <> 'SUPERSEDED' group by 1, 2 having count(*) > 1) d`)).rows[0].n);
    check("no pursuit has a role twice", dupes === 0, `${dupes}`);
    const rows = (await c.query<{ k: string }>(
      `select concat_ws(' | ', co.legal_name, p.use_case, m.role, m.side, m.status, coalesce(pa.name, '-')) k
         from pursuit_team_members m join pursuits p on p.id = m.pursuit_id join companies co on co.id = p.account_id
         left join partners pa on pa.id = m.partner_id
       union all
       select concat_ws(' | ', 'requirement', coalesce(pursuit_type, '*'), role, required::text) from pursuit_team_requirements
       order by 1`)).rows.map((r) => r.k);
    const pursuitsWithTeam = Number((await c.query<{ n: string }>(`select count(distinct pursuit_id)::text n from pursuit_team_members`)).rows[0].n);
    console.log(`     ${rows.length} rows · ${pursuitsWithTeam} pursuit(s) with a team · team digest ${createHash("sha256").update(rows.join("\n")).digest("hex").slice(0, 16)}`);
  } finally {
    await c.query("rollback").catch(() => {});
    c.release();
  }

  console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed`);
  if (failed) for (const f of failures) console.log(`  - ${f}`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error("[demo-team-verify] fatal:", e); await pool.end().catch(() => {}); process.exit(1); });
