import type { PoolClient } from "pg";

/**
 * Context Contribution model (Workstream E3-C, R4/R5). The durable provenance
 * object: "org X contributed information Y, under policy Z, for purpose P, to
 * Pursuit Q." Provenance (source_org_id) is ALWAYS retained; disclosure of the
 * VALUE is a separate concern governed by the E3-B engine (R3). Federation must
 * not require central custody of the source rows (R5): a FEDERATED/ASSERTED/
 * AGGREGATED contribution can exist with raw_stored=false / derived_only=true.
 */

export type ContributionMode = "RAW" | "DERIVED" | "FEDERATED" | "ASSERTED" | "AGGREGATED";

/** Whether a contribution mode implies central custody of the raw source rows (R5). */
export function impliesRawCustody(mode: ContributionMode): boolean {
  return mode === "RAW";
}

export interface RecordContributionInput {
  pursuitId?: string | null;
  sourceOrgId: string;
  mode: ContributionMode;
  sourceSystem?: string;
  providerId?: string | null;
  dataCategory?: string;
  subjectEntityId?: string | null;
  subjectKind?: string;
  semanticMeaning?: string;
  provenance?: Record<string, unknown>;
  observedAt?: Date | null;
  validUntil?: Date | null;
  disclosureClass?: string;     // audience (E3-B)
  sensitivityClass?: string;    // sensitivity (E3-B)
  purpose?: string;
  scope?: Record<string, unknown>;
  consentGrantId?: string | null;
  rawStored?: boolean;
  derivedOnly?: boolean;
  retentionClass?: string | null;
  expiresAt?: Date | null;
  onwardSharingAllowed?: boolean;
  delegationAllowed?: boolean;
  dataEnvironment?: string;
  isSimulated?: boolean;
}

export async function recordContribution(db: PoolClient, i: RecordContributionInput): Promise<string> {
  // Enforce the no-central-custody defaults per mode unless explicitly overridden (R5).
  const rawStored = i.rawStored ?? impliesRawCustody(i.mode);
  const derivedOnly = i.derivedOnly ?? !rawStored;
  const { rows } = await db.query<{ contribution_id: string }>(
    `insert into context_contributions
       (pursuit_id, source_org_id, source_system, provider_id, contribution_mode, data_category,
        subject_entity_id, subject_kind, semantic_meaning, provenance, observed_at, valid_until,
        disclosure_class, sensitivity_class, purpose, scope, consent_grant_id, raw_stored, derived_only,
        retention_class, expires_at, onward_sharing_allowed, delegation_allowed, data_environment, is_simulated)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
     returning contribution_id`,
    [i.pursuitId ?? null, i.sourceOrgId, i.sourceSystem ?? null, i.providerId ?? null, i.mode,
     i.dataCategory ?? null, i.subjectEntityId ?? null, i.subjectKind ?? null, i.semanticMeaning ?? null,
     JSON.stringify(i.provenance ?? {}), i.observedAt ?? null, i.validUntil ?? null,
     i.disclosureClass ?? null, i.sensitivityClass ?? null, i.purpose ?? null, JSON.stringify(i.scope ?? {}),
     i.consentGrantId ?? null, rawStored, derivedOnly, i.retentionClass ?? null, i.expiresAt ?? null,
     i.onwardSharingAllowed ?? false, i.delegationAllowed ?? false, i.dataEnvironment ?? "PRODUCTION", i.isSimulated ?? false],
  );
  return rows[0].contribution_id;
}

/** Revoke a contribution — future USE stops; the row (history) is preserved (R28). */
export async function revokeContribution(db: PoolClient, contributionId: string): Promise<void> {
  await db.query(`update context_contributions set revocation_state = 'REVOKED' where contribution_id = $1`, [contributionId]);
}

export interface ContributionView {
  contributionId: string; pursuitId: string | null; sourceOrgId: string; mode: ContributionMode;
  semanticMeaning: string | null; disclosureClass: string | null; sensitivityClass: string | null;
  rawStored: boolean; derivedOnly: boolean; revocationState: string; observedAt: string | null; contributedAt: string;
}
function view(r: {
  contribution_id: string; pursuit_id: string | null; source_org_id: string; contribution_mode: ContributionMode;
  semantic_meaning: string | null; disclosure_class: string | null; sensitivity_class: string | null;
  raw_stored: boolean; derived_only: boolean; revocation_state: string; observed_at: Date | null; contributed_at: Date;
}): ContributionView {
  return {
    contributionId: r.contribution_id, pursuitId: r.pursuit_id, sourceOrgId: r.source_org_id, mode: r.contribution_mode,
    semanticMeaning: r.semantic_meaning, disclosureClass: r.disclosure_class, sensitivityClass: r.sensitivity_class,
    rawStored: r.raw_stored, derivedOnly: r.derived_only, revocationState: r.revocation_state,
    observedAt: r.observed_at ? r.observed_at.toISOString() : null, contributedAt: r.contributed_at.toISOString(),
  };
}

const SELECT = `select contribution_id, pursuit_id, source_org_id, contribution_mode, semantic_meaning,
  disclosure_class, sensitivity_class, raw_stored, derived_only, revocation_state, observed_at, contributed_at
  from context_contributions`;

/** All contributions on a pursuit (provenance always visible via can_see_pursuit). */
export async function contributionsForPursuit(db: PoolClient, pursuitId: string): Promise<ContributionView[]> {
  const { rows } = await db.query(`${SELECT} where pursuit_id = $1 order by contributed_at desc`, [pursuitId]);
  return rows.map(view);
}

/** Only ACTIVE, unexpired contributions — the set recompute/disclosure may USE (R28). */
export async function liveContributionsForPursuit(db: PoolClient, pursuitId: string, asOf?: Date): Promise<ContributionView[]> {
  const { rows } = await db.query(
    `${SELECT} where pursuit_id = $1 and revocation_state = 'ACTIVE'
       and (valid_until is null or valid_until > $2)
       and (expires_at is null or expires_at > now())
     order by contributed_at desc`,
    [pursuitId, asOf ?? new Date()],
  );
  return rows.map(view);
}

/** Bind a Fact to the Contribution it originated from (the provenance boundary, R4). */
export async function linkFactToContribution(db: PoolClient, factId: string, contributionId: string, sourceOrgId: string): Promise<void> {
  await db.query(`update facts set contribution_id = $2, source_org_id = $3 where id = $1`, [factId, contributionId, sourceOrgId]);
}
