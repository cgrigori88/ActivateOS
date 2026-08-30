import type { PoolClient } from "pg";
import { resolveCompany as resolveDeterministic, type ResolveResult } from "../transactions/identity-resolve";
import { resolveCompany as matchInMemory, type CompanyCandidate } from "./resolve";

/**
 * The single federation-aware identity entry point (Workstream E3-G, §14/§30). Before
 * E3-G, two resolvers coexisted — a DB-backed deterministic→fuzzy resolver
 * (`transactions/identity-resolve`) and a pure in-memory candidate matcher
 * (`identity/resolve`) — with no shared, org-scoped front door. This is that front
 * door: every external identity a federated signal carries resolves HERE, scoped to
 * the SOURCE ORG's id space, and an unresolved identity is QUARANTINED (companyId
 * stays null) so it can never silently attach a contribution to another org's Pursuit.
 *
 * `resolveIdentity` is the canonical call; `matchInMemory` remains the pure ranking
 * primitive it (and ingest) reuse, not a second policy.
 */

export interface IdentityInput {
  orgId: string;
  sourceSystem: string;
  /** The participating org whose id space `externalId` belongs to (null = first-party/global). */
  sourceOrgId?: string | null;
  externalId?: string | null;
  domain?: string | null;
  duns?: string | null;
  name?: string | null;
}

export interface IdentityResolution extends ResolveResult { quarantined: boolean }

/** Resolve a federated external identity to a canonical company, org-scoped and quarantine-safe. */
export async function resolveIdentity(db: PoolClient, input: IdentityInput): Promise<IdentityResolution> {
  const r = await resolveDeterministic(db, {
    orgId: input.orgId, sourceSystem: input.sourceSystem, sourceOrgId: input.sourceOrgId ?? null,
    externalId: input.externalId ?? null, domain: input.domain ?? null, duns: input.duns ?? null,
    externalName: input.name ?? null,
  });
  // Quarantine: anything not AUTO_RESOLVED yields no company id — the signal is held,
  // never applied to a Pursuit, and a source-org-scoped review row already exists.
  return { ...r, quarantined: r.companyId === null };
}

/** Pure in-memory ranking primitive, re-exported so callers share ONE matcher (not a second policy). */
export function rankCandidates(name: string, domain: string | null, candidates: CompanyCandidate[]) {
  return matchInMemory({ name, domain }, candidates);
}

export interface RecordAliasInput {
  companyId: string;
  alias: string;
  aliasType: "name" | "domain" | "vendor_account_id" | "partner_account_id" | "distributor_account_id" | "crm_account_id";
  sourceOrgId?: string | null;
  source?: string | null;
  resolutionMethod?: string | null;
  resolutionConfidence?: number | null;
}

/**
 * Register an external id → company alias inside a specific org id space (E3-G). Two
 * orgs may legitimately map the SAME external id to DIFFERENT companies; scoping by
 * `source_org_id` keeps those from colliding. Idempotent per (company, alias, type).
 */
export async function recordAlias(db: PoolClient, i: RecordAliasInput): Promise<void> {
  await db.query(
    `insert into company_aliases (company_id, alias, alias_type, source_org_id, source, resolution_method, resolution_confidence)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (company_id, alias, alias_type) do update set
       source_org_id = coalesce(excluded.source_org_id, company_aliases.source_org_id),
       resolution_method = coalesce(excluded.resolution_method, company_aliases.resolution_method),
       resolution_confidence = coalesce(excluded.resolution_confidence, company_aliases.resolution_confidence)`,
    [i.companyId, i.alias, i.aliasType, i.sourceOrgId ?? null, i.source ?? null, i.resolutionMethod ?? null, i.resolutionConfidence ?? null],
  );
}
