import type { PoolClient } from "pg";
import { recordChange } from "../pursuits/ledger";
import type { DataEnvironment } from "../pursuits/lineage";

/**
 * Governed stakeholder role assertion (Intelligence Wave P1C). The ONLY legal way to establish or
 * change an authoritative buying-role assertion — bound to dispatchSkill as `assert_stakeholder_role`
 * (there is no direct CRUD path: migration 0097's DB trigger rejects role/assertion_state mutation
 * outside this handler's transaction-local flag).
 *
 * The truth model keeps its parts distinct (never a composite "confidence"):
 *  - person identity + employment  = the existing `contacts` row (id, name, title, company);
 *  - buying role                   = the canonical vocabulary (economic_buyer, technical_buyer,
 *                                    champion, influencer, blocker, end_user — the 0011 check);
 *  - assertion state               = verified | inferred | unverified;
 *  - evidence/provenance           = `source` + the evidence text preserved in the ledger;
 *  - history                       = append-only change_ledger (STAKEHOLDER_ROLE_ASSERTED events
 *                                    with before/after) — a superseding assertion never erases
 *                                    the prior one.
 *
 * LOCKED RULES enforced here:
 *  - title alone can NEVER establish a buying role (basis ['title'] is rejected for any state
 *    above unverified) — a title is display context, not authority;
 *  - an AGENT may propose (inferred/unverified) but may never assert `verified` — verification
 *    is a human act;
 *  - `verified` requires stated evidence (what confirmed the authority).
 */

export const STAKEHOLDER_ROLES = ["economic_buyer", "technical_buyer", "champion", "influencer", "blocker", "end_user"] as const;
export type StakeholderRole = (typeof STAKEHOLDER_ROLES)[number];
export const ASSERTION_STATES = ["verified", "inferred", "unverified"] as const;
export type AssertionState = (typeof ASSERTION_STATES)[number];

export interface AssertRoleArgs {
  opportunityId: string;
  contactId: string;
  role: StakeholderRole;
  assertionState: AssertionState;
  /** Provenance of this assertion (who/what asserted it), e.g. "human:pipeline", "ai:conversation". */
  source: string;
  /** Why PursuitOS should believe it — required for `verified`. */
  evidence?: string | null;
  /** What the assertion is based on, e.g. ["customer_confirmation"], ["title", "meeting_attendance"]. */
  basis?: string[] | null;
}

export interface AssertRoleResult {
  asserted: { role: string; assertionState: string };
  superseded: { role: string; assertionState: string; source: string | null } | null;
}

/** dispatchSkill precheck: the stakeholder's opportunity and contact must belong to the actor's org. */
export async function stakeholderInOrg(
  db: PoolClient, orgId: string, args: Record<string, unknown> | undefined,
): Promise<{ ok: boolean; reason?: string }> {
  const oppId = args?.opportunityId ? String(args.opportunityId) : null;
  const contactId = args?.contactId ? String(args.contactId) : null;
  if (!oppId || !contactId) return { ok: false, reason: "missing opportunityId/contactId" };
  const opp = (await db.query<{ org_id: string | null }>(`select org_id from opportunities where id = $1`, [oppId])).rows[0];
  if (!opp || opp.org_id !== orgId) return { ok: false, reason: "opportunity not found in this org" };
  const ct = (await db.query<{ org_id: string | null }>(`select org_id from contacts where id = $1`, [contactId])).rows[0];
  if (!ct || (ct.org_id != null && ct.org_id !== orgId)) return { ok: false, reason: "contact not found in this org" };
  return { ok: true };
}

export async function assertStakeholderRole(
  db: PoolClient,
  actor: { type: string; id?: string | null; orgId: string },
  raw: Record<string, unknown>,
  env: DataEnvironment = "PRODUCTION",
): Promise<AssertRoleResult> {
  const args: AssertRoleArgs = {
    opportunityId: String(raw.opportunityId ?? ""),
    contactId: String(raw.contactId ?? ""),
    role: String(raw.role ?? "") as StakeholderRole,
    assertionState: String(raw.assertionState ?? "") as AssertionState,
    source: String(raw.source ?? ""),
    evidence: raw.evidence != null ? String(raw.evidence) : null,
    basis: Array.isArray(raw.basis) ? raw.basis.map(String) : null,
  };
  if (!STAKEHOLDER_ROLES.includes(args.role)) throw new Error(`unknown buying role: ${args.role}`);
  if (!ASSERTION_STATES.includes(args.assertionState)) throw new Error(`unknown assertion state: ${args.assertionState}`);
  if (!args.source.trim()) throw new Error("source (provenance) is required for a role assertion");

  // LOCKED: title → role is not a shortcut. A basis of title alone cannot create anything
  // authoritative — it may exist only as an unverified proposal.
  const titleOnly = args.basis != null && args.basis.length > 0 && args.basis.every((b) => b.trim().toLowerCase() === "title");
  if (titleOnly && args.assertionState !== "unverified")
    throw new Error("job title alone cannot establish a buying role — record evidence, or keep the proposal unverified");

  // LOCKED: verification is a human act; agents propose, humans verify.
  if (args.assertionState === "verified" && actor.type === "AGENT")
    throw new Error("an agent may propose (inferred/unverified) but may not assert verified — verification is a human decision");
  if (args.assertionState === "verified" && !(args.evidence ?? "").trim())
    throw new Error("a verified assertion requires evidence (what confirmed the authority)");

  const opp = (await db.query<{ org_id: string | null; pursuit_id: string | null }>(
    `select org_id, pursuit_id from opportunities where id = $1`, [args.opportunityId])).rows[0];
  if (!opp || opp.org_id !== actor.orgId) throw new Error("opportunity not found in this org");

  const prior = (await db.query<{ role: string; assertion_state: string; source: string | null }>(
    `select role, assertion_state, source from stakeholders where opportunity_id = $1 and contact_id = $2`,
    [args.opportunityId, args.contactId])).rows[0] ?? null;

  // The governed write. The transaction-local flag is what the 0097 trigger checks — it exists
  // only inside this handler, so no other code path can perform an authoritative mutation.
  await db.query(`select set_config('app.governed_assertion', '1', true)`);
  try {
    await db.query(
      `insert into stakeholders (opportunity_id, contact_id, role, assertion_state, source, pursuit_id, asserted_at, asserted_by)
       values ($1, $2, $3, $4, $5, $6, now(), $7)
       on conflict (opportunity_id, contact_id) do update
         set role = excluded.role, assertion_state = excluded.assertion_state, source = excluded.source,
             pursuit_id = coalesce(excluded.pursuit_id, stakeholders.pursuit_id),
             asserted_at = now(), asserted_by = excluded.asserted_by`,
      [args.opportunityId, args.contactId, args.role, args.assertionState, args.source, opp.pursuit_id, actor.id ?? null]);
  } finally {
    await db.query(`select set_config('app.governed_assertion', '', true)`);
  }

  // History: the append-only record of what was believed before and after, why, and by whom.
  // A supersede keeps the prior assertion intact here forever (0094 revokes UPDATE/DELETE).
  await recordChange(db, {
    orgId: actor.orgId, pursuitId: opp.pursuit_id, entityType: "stakeholder", entityId: args.contactId,
    changeType: "STAKEHOLDER_ROLE_ASSERTED",
    before: prior ? { role: prior.role, assertion_state: prior.assertion_state, source: prior.source } : null,
    after: { role: args.role, assertion_state: args.assertionState, source: args.source, evidence: args.evidence ?? null, basis: args.basis ?? null },
    materiality: args.role === "economic_buyer" && args.assertionState === "verified" ? "HIGH" : "MEDIUM",
    reason: `${args.role.replace(/_/g, " ")} — ${args.assertionState}${prior ? ` (supersedes ${prior.role.replace(/_/g, " ")} — ${prior.assertion_state})` : ""}`,
    actorType: actor.type === "AGENT" ? "AGENT" : "USER", actorId: actor.id ?? null,
    triggerType: "GOVERNED_ACTION", dataEnvironment: env,
  });

  return {
    asserted: { role: args.role, assertionState: args.assertionState },
    superseded: prior ? { role: prior.role, assertionState: prior.assertion_state, source: prior.source } : null,
  };
}
