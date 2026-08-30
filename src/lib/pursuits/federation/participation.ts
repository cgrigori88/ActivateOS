import type { PoolClient } from "pg";

/**
 * Pursuit participation model (Workstream E3-A). The N-organization edge around
 * the ONE canonical Pursuit. Participation is explicit and is NEVER derived from
 * commercial route or room membership (R2). Roles come from the extensible
 * pursuit_role_types registry (R3). Field-level disclosure to a participant is
 * mediated by the E3-B engine — this module only manages the edge + its lifecycle.
 *
 * All functions run inside a withTenant transaction (the app.org_id GUC is set);
 * RLS (0080 pursuit_participants_rw + can_see_pursuit) is the enforcement floor:
 * only the participant's own org or the sponsor may write a participation row,
 * and only orgs that can see the pursuit may read it.
 */

export type ParticipationState = "INVITED" | "ACTIVE" | "DECLINED" | "LEFT" | "REVOKED";

/** Legal state transitions. INVITED→ACTIVE (accept), INVITED→DECLINED, ACTIVE→LEFT, any→REVOKED. */
const TRANSITIONS: Record<ParticipationState, ParticipationState[]> = {
  INVITED: ["ACTIVE", "DECLINED", "REVOKED"],
  ACTIVE: ["LEFT", "REVOKED"],
  DECLINED: [],
  LEFT: [],
  REVOKED: [],
};
export function canTransition(from: ParticipationState, to: ParticipationState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export interface RoleType { roleKey: string; label: string; side: string | null; isRouteCapable: boolean; sort: number }

export async function listRoleTypes(db: PoolClient): Promise<RoleType[]> {
  const { rows } = await db.query<{ role_key: string; label: string; side: string | null; is_route_capable: boolean; sort: number }>(
    `select role_key, label, side, is_route_capable, sort from pursuit_role_types order by sort, role_key`,
  );
  return rows.map((r) => ({ roleKey: r.role_key, label: r.label, side: r.side, isRouteCapable: r.is_route_capable, sort: r.sort }));
}

export interface AddParticipantInput {
  pursuitId: string;
  orgId: string;                 // the participating org
  roleKey: string;
  sponsorOrgId: string;          // = pursuits.org_id
  inviterOrgId?: string | null;
  invitedBy?: string | null;
  source?: string;               // partnership | invite | join_code | broker | sponsor
  state?: ParticipationState;    // default INVITED; sponsor self-participation may seed ACTIVE
  dataEnvironment?: string;
}

/** Invite (or seed) an organization into a Pursuit. Idempotent on (pursuit, org). */
export async function addParticipant(db: PoolClient, input: AddParticipantInput): Promise<string> {
  const state = input.state ?? "INVITED";
  const { rows } = await db.query<{ id: string }>(
    `insert into pursuit_participants
       (org_id, pursuit_id, sponsor_org_id, role_key, participation_state,
        inviter_org_id, invited_by, source_of_participation, joined_at, data_environment)
     values ($1,$2,$3,$4,$5,$6,$7,$8, case when $5 = 'ACTIVE' then now() else null end, $9)
     on conflict (pursuit_id, org_id) do update
       set role_key = excluded.role_key, updated_at = now()
     returning id`,
    [input.orgId, input.pursuitId, input.sponsorOrgId, input.roleKey, state,
     input.inviterOrgId ?? null, input.invitedBy ?? null, input.source ?? "sponsor", input.dataEnvironment ?? "PRODUCTION"],
  );
  return rows[0].id;
}

async function transition(db: PoolClient, participantId: string, to: ParticipationState, stamp?: "joined_at" | "left_at"): Promise<void> {
  const { rows } = await db.query<{ participation_state: ParticipationState }>(
    `select participation_state from pursuit_participants where id = $1 for update`,
    [participantId],
  );
  const from = rows[0]?.participation_state;
  if (!from) throw new Error("Participation not found or not visible.");
  if (from === to) return;
  if (!canTransition(from, to)) throw new Error(`Illegal participation transition ${from} → ${to}.`);
  const stampSql = stamp ? `, ${stamp} = now()` : "";
  await db.query(
    `update pursuit_participants set participation_state = $2, updated_at = now()${stampSql} where id = $1`,
    [participantId, to],
  );
}

/** INVITED → ACTIVE. The invited org accepts; it now legitimately participates. */
export const acceptParticipation = (db: PoolClient, id: string) => transition(db, id, "ACTIVE", "joined_at");
/** INVITED → DECLINED. */
export const declineParticipation = (db: PoolClient, id: string) => transition(db, id, "DECLINED");
/** ACTIVE → LEFT (the participant withdraws). */
export const leaveParticipation = (db: PoolClient, id: string) => transition(db, id, "LEFT", "left_at");
/** any active/invited → REVOKED (sponsor or the org itself revokes). Future access stops; audit preserved (R28). */
export const revokeParticipation = (db: PoolClient, id: string) => transition(db, id, "REVOKED");

export interface ParticipantView {
  id: string; orgId: string; orgName: string | null; roleKey: string; roleLabel: string;
  side: string | null; isRouteCapable: boolean; state: ParticipationState;
  isSponsor: boolean; joinedAt: string | null;
}

/**
 * Participants of a Pursuit, visible per RLS (can_see_pursuit). This returns only
 * the participation EDGE (org, role, state) — never another participant's
 * confidential Pursuit data, which the E3-B disclosure engine governs separately.
 */
export async function getParticipants(db: PoolClient, pursuitId: string): Promise<ParticipantView[]> {
  const { rows } = await db.query<{
    id: string; org_id: string; org_name: string | null; role_key: string; label: string;
    side: string | null; is_route_capable: boolean; participation_state: ParticipationState;
    sponsor_org_id: string; joined_at: Date | null;
  }>(
    `select pp.id, pp.org_id, o.name as org_name, pp.role_key, rt.label, rt.side, rt.is_route_capable,
            pp.participation_state, pp.sponsor_org_id, pp.joined_at
       from pursuit_participants pp
       join pursuit_role_types rt on rt.role_key = pp.role_key
       left join organizations o on o.id = pp.org_id
      where pp.pursuit_id = $1
      order by rt.sort, o.name`,
    [pursuitId],
  );
  return rows.map((r) => ({
    id: r.id, orgId: r.org_id, orgName: r.org_name, roleKey: r.role_key, roleLabel: r.label,
    side: r.side, isRouteCapable: r.is_route_capable, state: r.participation_state,
    isSponsor: r.sponsor_org_id === r.org_id, joinedAt: r.joined_at ? r.joined_at.toISOString() : null,
  }));
}

/** Active participant org ids — the set the E3-B disclosure engine treats as SHAREABLE_WITH_PARTICIPANTS. */
export async function activeParticipantOrgIds(db: PoolClient, pursuitId: string): Promise<string[]> {
  const { rows } = await db.query<{ org_id: string }>(
    `select org_id from pursuit_participants where pursuit_id = $1 and participation_state = 'ACTIVE'`,
    [pursuitId],
  );
  return rows.map((r) => r.org_id);
}
