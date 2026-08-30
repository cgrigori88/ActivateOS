import type { PoolClient } from "pg";
import { recordChange } from "../pursuits/ledger";
import type { TeamRole, TeamStatus } from "./types";
import type { DataEnvironment } from "../pursuits/lineage";

/**
 * Pursuit Team assembly + acceptance lifecycle (Workstream C, §9/§10/§21/§23/§24). A recommended
 * team is not an active team; roles carry an explicit acceptance lifecycle, and required-role
 * coverage feeds activation readiness. Members are superseded, never deleted.
 */

const ALLOWED: Record<TeamStatus, TeamStatus[]> = {
  RECOMMENDED: ["INVITED", "SUPERSEDED", "INACTIVE"],
  INVITED: ["ACCEPTED", "DECLINED", "SUPERSEDED"],
  ACCEPTED: ["ACTIVE", "ACTION_REQUIRED", "INACTIVE", "SUPERSEDED"],
  ACTIVE: ["ACTION_REQUIRED", "INACTIVE", "SUPERSEDED"],
  ACTION_REQUIRED: ["ACTIVE", "INACTIVE", "SUPERSEDED"],
  DECLINED: ["SUPERSEDED"], INACTIVE: ["SUPERSEDED"], SUPERSEDED: [],
};

function sideOf(role: TeamRole): "VENDOR" | "PARTNER" | "DISTRIBUTOR" {
  if (role.startsWith("VENDOR")) return "VENDOR";
  if (role.startsWith("DISTRIBUTOR")) return "DISTRIBUTOR";
  return "PARTNER";
}

/** Assemble a recommended team from the selected/recommended route + required roles. Idempotent. */
export async function assembleTeam(db: PoolClient, pursuitId: string, env: DataEnvironment = "PRODUCTION"): Promise<{ created: number }> {
  const p = await db.query<{ org_id: string; pursuit_type: string | null; selected_partner_id: string | null; recommended_partner_id: string | null }>(
    `select org_id, pursuit_type, selected_partner_id, recommended_partner_id from pursuits where id = $1`, [pursuitId],
  );
  if (!p.rows[0]) throw new Error(`pursuit ${pursuitId} not found`);
  const { org_id: orgId, pursuit_type: pursuitType } = p.rows[0];
  const partnerId = p.rows[0].selected_partner_id ?? p.rows[0].recommended_partner_id;

  const req = await db.query<{ role: string; required: boolean }>(
    `select role, required from pursuit_team_requirements where (org_id is null or org_id = $1) and (pursuit_type is null or pursuit_type = $2)`,
    [orgId, pursuitType],
  );
  let created = 0;
  for (const r of req.rows) {
    const role = r.role as TeamRole;
    const exists = await db.query<{ n: string }>(`select count(*)::text n from pursuit_team_members where pursuit_id = $1 and role = $2 and status <> 'SUPERSEDED'`, [pursuitId, role]);
    if (Number(exists.rows[0].n) > 0) continue;
    const side = sideOf(role);
    await db.query(
      `insert into pursuit_team_members (org_id, pursuit_id, side, role, partner_id, is_recommended, status)
       values ($1,$2,$3,$4,$5,true,'RECOMMENDED')`,
      [orgId, pursuitId, side, role, side === "PARTNER" ? partnerId : null],
    );
    created++;
  }
  if (created > 0) {
    await recordChange(db, { orgId, pursuitId, entityType: "pursuit", entityId: pursuitId, changeType: "TEAM_CHANGED", materiality: "MEDIUM", reason: `Team assembled (${created} roles)`, actorType: "SYSTEM", triggerType: "MODEL_RECALCULATION", dataEnvironment: env });
  }
  return { created };
}

export async function transitionMember(db: PoolClient, memberId: string, to: TeamStatus, env: DataEnvironment = "PRODUCTION"): Promise<void> {
  const m = await db.query<{ org_id: string; pursuit_id: string; status: TeamStatus; role: string }>(
    `select org_id, pursuit_id, status, role from pursuit_team_members where id = $1 for update`, [memberId],
  );
  if (!m.rows[0]) throw new Error(`team member ${memberId} not found`);
  const from = m.rows[0].status;
  if (from === to) return;
  if (!ALLOWED[from].includes(to)) throw new Error(`illegal team transition ${from} → ${to}`);
  const stamp = to === "INVITED" ? "invited_at" : to === "ACCEPTED" ? "accepted_at" : to === "DECLINED" ? "declined_at" : "last_action_at";
  await db.query(`update pursuit_team_members set status = $2, is_accepted = $3, ${stamp} = now(), last_action_at = now() where id = $1`, [memberId, to, to === "ACCEPTED"]);
  const ct = to === "INVITED" ? "TEAM_MEMBER_INVITED" : to === "ACCEPTED" ? "TEAM_MEMBER_ACCEPTED" : to === "DECLINED" ? "TEAM_MEMBER_DECLINED" : "TEAM_CHANGED";
  await recordChange(db, { orgId: m.rows[0].org_id, pursuitId: m.rows[0].pursuit_id, entityType: "pursuit", entityId: m.rows[0].pursuit_id, changeType: ct as never, materiality: "MEDIUM", reason: `${m.rows[0].role}: ${from} → ${to}`, actorType: "USER", triggerType: "PARTNER_DECISION", dataEnvironment: env, before: { status: from }, after: { status: to } });
}

/** Required-role coverage — feeds readiness. */
export async function requiredRolesMet(db: PoolClient, orgId: string, pursuitId: string, pursuitType: string | null): Promise<{ met: boolean; missing: string[] }> {
  const req = await db.query<{ role: string }>(`select role from pursuit_team_requirements where required = true and (org_id is null or org_id = $1) and (pursuit_type is null or pursuit_type = $2)`, [orgId, pursuitType]);
  const acc = await db.query<{ role: string }>(`select distinct role from pursuit_team_members where pursuit_id = $1 and status in ('ACCEPTED','ACTIVE')`, [pursuitId]);
  const accSet = new Set(acc.rows.map((r) => r.role));
  const missing = req.rows.map((r) => r.role).filter((r) => !accSet.has(r));
  return { met: missing.length === 0, missing };
}
