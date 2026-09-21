import type { PoolClient } from "pg";
import { mintKey } from "@/lib/agents/mcp-tools";
import type { DataEnvironment } from "@/lib/pursuits/lineage";

/**
 * P45-4 — THE CANONICAL PROVISIONING SEQUENCE, AS ONE OPERATION.
 *
 * **Actor → grant → bound credential, in that order, in one transaction.**
 *
 * The order is not stylistic. The 0109 governed-actor gate demands a live grant WHENEVER
 * `ctx.governedActorId` is present — independently of `GOVERNED_AGENT_ENFORCEMENT_ENABLED`. So:
 *
 *   • creating an actor is inert;
 *   • creating a grant for an actor that no credential names is inert;
 *   • **binding a credential is NOT inert.** From that instant the credential must already hold the
 *     grant for the action it will attempt, or every attempt is refused.
 *
 * A bound-but-ungranted credential is therefore a live authority change, not a staging step, and
 * this function exists so that window cannot be opened by accident. It is also why no pre-existing
 * Slice 14 key is ever bound: a legacy key is left exactly as it is, and a NEW key is minted for
 * the governed path.
 *
 * The plaintext key is returned ONCE and never stored — only its sha256 hash reaches the database,
 * exactly as `mintApiKeyAction` has always done.
 */

export interface ProvisionAgentInput {
  /** Stable, human-meaningful slug, unique per org. Immutable once created. */
  key: string;
  displayName: string;
  purpose?: string | null;
  /** The capability this agent may exercise, and the exact version it is authorized for. */
  skillId: string;
  skillVersion: number;
  /** Optional expiry. Absent means the grant is live until revoked. */
  expiresAt?: Date | null;
  keyName: string;
  /**
   * REQUIRED (0120). The data provenance of everything this agent's executions will produce. It is
   * written to BOTH the durable actor and the credential: the actor's copy describes the agent, and
   * the credential's is what `/api/mcp` actually reads at dispatch, because the credential is the
   * only thing an external caller cannot choose. It was optional and defaulted to PRODUCTION, which
   * is how a certification agent came to write into the one learning-eligible environment.
   */
  dataEnvironment: DataEnvironment;
  ownerUserId?: string | null;
}

export interface ProvisionedAgent {
  actorId: string;
  grantId: string;
  keyId: string;
  /** Shown once to the operator; never persisted. */
  plaintext: string;
}

export async function provisionGovernedAgent(
  db: PoolClient, orgId: string, i: ProvisionAgentInput,
): Promise<ProvisionedAgent> {
  // 1. The durable identity. ACTIVE immediately: an actor with no credential can do nothing, and a
  //    DRAFT actor would only add a state to forget to leave.
  const { rows: actor } = await db.query<{ id: string }>(
    `insert into governed_actors (org_id, actor_type, key, display_name, purpose, lifecycle,
                                  owner_user_id, data_environment)
     values ($1, 'AGENT', $2, $3, $4, 'ACTIVE', $5, $6)
     returning id`,
    [orgId, i.key, i.displayName, i.purpose ?? null, i.ownerUserId ?? null, i.dataEnvironment],
  );

  // 2. The authority instrument, naming the EXACT capability version. A wildcard grant
  //    (skill_version null) is legacy-valid but does not satisfy strict AGENT execution, so
  //    provisioning never creates one.
  const { rows: grant } = await db.query<{ id: string }>(
    `insert into actor_capability_grants (org_id, actor_id, skill_id, skill_version, status, expires_at)
     values ($1, $2, $3, $4, 'ACTIVE', $5)
     returning id`,
    [orgId, actor[0].id, i.skillId, i.skillVersion, i.expiresAt ?? null],
  );

  // 3. The credential — minted ALREADY BOUND. The binding is set at INSERT and there is no
  //    rebinding operation: `app_rw`'s UPDATE on api_keys is narrowed to `revoked_at`, so changing
  //    which agent a credential represents means revoking it and issuing a new one.
  const { plaintext, hash } = mintKey();
  const { rows: key } = await db.query<{ id: string }>(
    `insert into api_keys (org_id, name, key_hash, scope, governed_actor_id, data_environment)
     values ($1, $2, $3, 'write', $4, $5)
     returning id`,
    [orgId, i.keyName, hash, actor[0].id, i.dataEnvironment],
  );

  return { actorId: actor[0].id, grantId: grant[0].id, keyId: key[0].id, plaintext };
}
