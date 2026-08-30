import type { PoolClient } from "pg";

/**
 * Tenant-scoped feature enablement (Release Gate R1-G2). The enforcement rule is
 * env-master AND per-org opt-in:
 *
 *     live_for(org, flag) === envEnabled(flag) && org_features.<flag>
 *
 * The process-env var stays the DEPLOYMENT kill-switch; the per-org row is the tenant
 * opt-in, so a design-partner pilot can enable a capability for ONE org while every
 * other tenant stays dark. FAIL-CLOSED: a missing org_features row, an unreadable
 * value, or any query error resolves to OFF. These readers are async and take an
 * (db, orgId) — they must run inside a tenant transaction so RLS scopes the read.
 * They are the SERVER-SIDE enforcement; nav/UI hiding never substitutes for them.
 */

export type FeatureFlag =
  | "pursuits" | "facts" | "routing" | "pursuit_experience"
  | "federation" | "governed_action" | "outcome_learning";

const ENV_VAR: Record<FeatureFlag, string> = {
  pursuits: "PURSUITS_ENABLED", facts: "FACTS_ENABLED", routing: "ROUTING_ENABLED",
  pursuit_experience: "PURSUIT_EXPERIENCE_ENABLED", federation: "FEDERATION_ENABLED",
  governed_action: "GOVERNED_ACTION_ENABLED", outcome_learning: "OUTCOME_LEARNING_ENABLED",
};

/** The deployment master switch for a flag (the same idiom the legacy env readers use). */
export function envEnabled(flag: FeatureFlag): boolean {
  const v = (process.env[ENV_VAR[flag]] ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "on" || v === "yes";
}

type OrgFeatureRow = Record<FeatureFlag, boolean>;

/** Read this org's feature row. FAIL-CLOSED: no row / error ⇒ every flag false. */
async function orgRow(db: PoolClient, orgId: string): Promise<OrgFeatureRow> {
  const off: OrgFeatureRow = { pursuits: false, facts: false, routing: false, pursuit_experience: false, federation: false, governed_action: false, outcome_learning: false };
  try {
    const { rows } = await db.query<OrgFeatureRow>(
      `select pursuits, facts, routing, pursuit_experience, federation, governed_action, outcome_learning
         from org_features where org_id = $1`, [orgId]);
    if (!rows[0]) return off;
    // Normalize any null/undefined to false (fail-closed per column).
    return { pursuits: !!rows[0].pursuits, facts: !!rows[0].facts, routing: !!rows[0].routing,
      pursuit_experience: !!rows[0].pursuit_experience, federation: !!rows[0].federation,
      governed_action: !!rows[0].governed_action, outcome_learning: !!rows[0].outcome_learning };
  } catch {
    return off; // unresolved flag state ⇒ dark
  }
}

const base = (row: OrgFeatureRow, flag: FeatureFlag): boolean => envEnabled(flag) && row[flag];

export interface TenantFeatureView {
  experience: boolean; federation: boolean; governedAction: boolean; outcomeLearning: boolean;
}

/** Resolve every derived capability for an org in one read (dependency chains applied). */
export async function tenantFeatures(db: PoolClient, orgId: string): Promise<TenantFeatureView> {
  const row = await orgRow(db, orgId);
  const experience = base(row, "pursuits") && base(row, "facts") && base(row, "routing") && base(row, "pursuit_experience");
  const federation = experience && base(row, "federation");
  const governedAction = federation && base(row, "governed_action");
  const outcomeLearning = experience && base(row, "outcome_learning"); // org-local; does not require federation
  return { experience, federation, governedAction, outcomeLearning };
}

export async function experienceEnabledFor(db: PoolClient, orgId: string): Promise<boolean> { return (await tenantFeatures(db, orgId)).experience; }
export async function federationEnabledFor(db: PoolClient, orgId: string): Promise<boolean> { return (await tenantFeatures(db, orgId)).federation; }
export async function governedActionEnabledFor(db: PoolClient, orgId: string): Promise<boolean> { return (await tenantFeatures(db, orgId)).governedAction; }
export async function outcomeLearningEnabledFor(db: PoolClient, orgId: string): Promise<boolean> { return (await tenantFeatures(db, orgId)).outcomeLearning; }

/**
 * Enable/disable one capability for one org, WITH an audit row (who/when/why). Writing
 * a per-org flag is an authorized (owner/admin) act; the deployment env master still
 * gates whether the capability is live. Idempotent upsert.
 */
export async function setOrgFeature(
  db: PoolClient, orgId: string, flag: FeatureFlag, enabled: boolean,
  opts: { changedBy?: string | null; reason?: string | null } = {},
): Promise<void> {
  // Whitelist the column name (never interpolate caller input as SQL identifier).
  const col = ENV_VAR[flag] ? flag : null;
  if (!col) throw new Error(`unknown feature flag ${flag}`);
  await db.query(
    `insert into org_features (org_id, ${col}, updated_at) values ($1, $2, now())
     on conflict (org_id) do update set ${col} = excluded.${col}, updated_at = now()`,
    [orgId, enabled]);
  await db.query(
    `insert into org_feature_changes (org_id, flag, enabled, changed_by, reason) values ($1,$2,$3,$4,$5)`,
    [orgId, flag, enabled, opts.changedBy ?? null, opts.reason ?? null]);
}
