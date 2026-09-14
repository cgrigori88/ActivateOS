import type { PoolClient } from "pg";
import type { TeamRole } from "./types";

/**
 * The canonical GLOBAL pursuit-team requirements — the minimum viable team every pursuit is
 * assembled against (`org_id` null = every org, `pursuit_type` null = every type). `assembleTeam`
 * creates one RECOMMENDED member per requirement; readiness and the funnel read the required ones.
 *
 * WHY THIS LIVES IN CODE AS WELL AS IN MIGRATION 0075. 0075 inserted these five rows once, as
 * bootstrap history. A fresh database gets them by replaying migrations. An existing demo database
 * reseeded IN PLACE does not: `scripts/demo-db.ts` clears every tenant-scoped table (this one
 * carries `org_id`) and never replays migrations. So an in-place reseed silently lost the whole
 * team layer — 0 requirements, `assembleTeam` created nobody, Globex's ledger lost its "Team
 * assembled" row, and the Slice 2A plan owner read "No account executive on the pursuit team yet"
 * (found on the isolated vNext database, 2026-09-14). `verify()` and the manifest count no team
 * table, so the world still reconciled exactly.
 *
 * The canonical seed therefore re-establishes them from THIS list on both paths, so a fresh
 * `migrate → seed` and an in-place `seed again` converge on the same state. 0075 stays untouched
 * as history; `tests/team-requirements.test.ts` pins this list to 0075's insert so the two cannot
 * drift apart silently.
 */
export const CANONICAL_TEAM_REQUIREMENTS: ReadonlyArray<Readonly<{ role: TeamRole; required: boolean }>> = [
  { role: "VENDOR_ACCOUNT_EXECUTIVE", required: true },
  { role: "PARTNER_ACCOUNT_MANAGER", required: true },
  { role: "VENDOR_SPECIALIST", required: false },
  { role: "VENDOR_SOLUTION_ARCHITECT", required: false },
  { role: "DISTRIBUTOR_BDM", required: false },
];

/** A GLOBAL (`org_id is null`) row of `pursuit_team_requirements`. Tenant rows are never planned over. */
export interface GlobalRequirementRow {
  id: string;
  pursuitType: string | null;
  role: string;
  required: boolean;
  createdAt: Date | string;
}

export interface RequirementRepairPlan {
  /** Rows that are not canonical: an unknown role, a type-specific global row, or a duplicate. */
  remove: string[];
  /** Canonical rows whose `required` has drifted. */
  correct: { id: string; required: boolean }[];
  /** Canonical roles with no row at all. */
  insert: { role: TeamRole; required: boolean }[];
}

/**
 * Pure. What it takes to make the global rows EXACTLY the canonical set — each canonical role once,
 * with its canonical `required`, and nothing else. For duplicates the oldest row is kept, so a
 * re-plan never churns ids. An empty plan means the rows are already canonical, which is what makes
 * repeated seeding idempotent.
 */
export function planCanonicalTeamRequirements(rows: readonly GlobalRequirementRow[]): RequirementRepairPlan {
  const canonical = new Map(CANONICAL_TEAM_REQUIREMENTS.map((r) => [r.role as string, r]));
  const ordered = [...rows].sort((a, b) =>
    (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const kept = new Map<string, GlobalRequirementRow>();
  const plan: RequirementRepairPlan = { remove: [], correct: [], insert: [] };
  for (const row of ordered) {
    const want = canonical.get(row.role);
    if (!want || row.pursuitType !== null || kept.has(row.role)) { plan.remove.push(row.id); continue; }
    kept.set(row.role, row);
    if (row.required !== want.required) plan.correct.push({ id: row.id, required: want.required });
  }
  for (const want of CANONICAL_TEAM_REQUIREMENTS) {
    if (!kept.has(want.role)) plan.insert.push({ role: want.role, required: want.required });
  }
  return plan;
}

export const isEmptyRepairPlan = (p: RequirementRepairPlan): boolean =>
  p.remove.length === 0 && p.correct.length === 0 && p.insert.length === 0;

/**
 * Make the database's global team requirements exactly canonical. Seed-time only — the canonical
 * demo seed calls it (owner connection) before any team is assembled. Tenant-scoped requirement
 * rows are left alone. Returns the plan it applied; an empty plan wrote nothing.
 */
export async function establishCanonicalTeamRequirements(db: PoolClient): Promise<RequirementRepairPlan> {
  const { rows } = await db.query<{ id: string; pursuit_type: string | null; role: string; required: boolean; created_at: Date }>(
    `select id, pursuit_type, role, required, created_at from pursuit_team_requirements where org_id is null`,
  );
  const plan = planCanonicalTeamRequirements(
    rows.map((r) => ({ id: r.id, pursuitType: r.pursuit_type, role: r.role, required: r.required, createdAt: r.created_at })),
  );
  if (plan.remove.length) await db.query(`delete from pursuit_team_requirements where id = any($1::uuid[])`, [plan.remove]);
  for (const c of plan.correct) await db.query(`update pursuit_team_requirements set required = $2 where id = $1`, [c.id, c.required]);
  for (const i of plan.insert) {
    await db.query(
      `insert into pursuit_team_requirements (org_id, pursuit_type, role, required) values (null, null, $1, $2)`,
      [i.role, i.required],
    );
  }
  return plan;
}
