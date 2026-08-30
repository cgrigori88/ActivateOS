/**
 * Federation disclosure policy engine (Workstream E3-B, R6/R7).
 *
 * Two INDEPENDENT policy dimensions — never one overloaded field (R6):
 *  - AUDIENCE  (who may receive the item)
 *  - SENSITIVITY (how sensitive the item is)
 * A highly sensitive item may still be allow-listed to one authorized org; a
 * low-sensitivity item may still be irrelevant to a given participant.
 *
 * `resolveDisclosure` is POLICY RESOLUTION, not string redaction (R7): it returns
 * the EXACT value, a GENERALIZED substitute, an AGGREGATE, or SUPPRESSES the item
 * entirely (existence hidden — T11 inference resistance). The INVARIANT the read
 * models must honor: for any non-authorized resolution the exact value is NEVER
 * returned — the payload carries the substitute or null, never `item.value`.
 */

export type Audience =
  | "ORG_PRIVATE"            // only the owning org
  | "PURSUIT_INTERNAL"       // the sponsor/owning org's internal team only
  | "PARTICIPANT_SHARED"     // any ACTIVE participant
  | "ORG_ALLOWLIST"          // only specifically granted orgs
  | "GENERALIZED"            // already a safe generalized form
  | "AGGREGATED"             // aggregate-only representation
  | "PUBLIC";                // anyone

export type Sensitivity = "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";

/** Maps the legacy 6-value disclosure_class (route_candidate_reasons, transaction_features) to the E audience vocabulary (R6). */
export const LEGACY_TO_AUDIENCE: Record<string, Audience> = {
  PUBLIC: "PUBLIC",
  INTERNAL: "PURSUIT_INTERNAL",
  PARTNER_SHARED: "PARTICIPANT_SHARED",
  TRANSACTION_CONFIDENTIAL: "PURSUIT_INTERNAL",
  PII: "ORG_PRIVATE",
  RESTRICTED: "ORG_PRIVATE",
};
export const LEGACY_TO_SENSITIVITY: Record<string, Sensitivity> = {
  PUBLIC: "PUBLIC", INTERNAL: "INTERNAL", PARTNER_SHARED: "INTERNAL",
  TRANSACTION_CONFIDENTIAL: "CONFIDENTIAL", PII: "RESTRICTED", RESTRICTED: "RESTRICTED",
};

export interface FederationViewer {
  orgId: string;
  isSponsor: boolean;              // owns/sponsors the pursuit → sees everything on it
  isParticipant: boolean;          // an ACTIVE participant
  allowlistGrantedFor: Set<string>;// object keys this viewer is specifically granted (ORG_ALLOWLIST)
}

/** A disclosable item declares its audience + optional safe substitutes and its source org (provenance, R3). */
export interface Disclosable<T> {
  key?: string;                    // stable key for ORG_ALLOWLIST matching
  ownerOrgId: string;              // the source org (provenance retained independent of disclosure)
  audience: Audience;
  sensitivity?: Sensitivity;
  value: T;                        // the exact / internal value — never emitted to non-authorized viewers
  generalized?: T;                 // safe generalized substitute
  aggregate?: T;                   // aggregate-only representation
  allowlistOrgs?: string[];        // ORG_ALLOWLIST: orgs that may receive the exact value
}

export type Visibility = "EXACT" | "GENERALIZED" | "AGGREGATED" | "SUPPRESSED";
export interface Resolution<T> { visibility: Visibility; value: T | null }

function downgrade<T>(item: Disclosable<T>): Resolution<T> {
  if (item.generalized !== undefined) return { visibility: "GENERALIZED", value: item.generalized };
  if (item.aggregate !== undefined) return { visibility: "AGGREGATED", value: item.aggregate };
  return { visibility: "SUPPRESSED", value: null };
}

/** Resolve one item for one viewer. Never returns the exact value to a non-authorized viewer. */
export function resolveDisclosure<T>(item: Disclosable<T>, viewer: FederationViewer): Resolution<T> {
  // Owner / sponsor sees the exact value on their own pursuit.
  if (viewer.isSponsor || viewer.orgId === item.ownerOrgId) return { visibility: "EXACT", value: item.value };
  // Public is public.
  if (item.audience === "PUBLIC") return { visibility: "EXACT", value: item.value };

  const allowlisted = item.audience === "ORG_ALLOWLIST" &&
    ((item.allowlistOrgs ?? []).includes(viewer.orgId) || (item.key ? viewer.allowlistGrantedFor.has(item.key) : false));

  // A viewer with no standing on the pursuit (not a participant, not specifically
  // allow-listed for this item) receives NOTHING pursuit-scoped — existence hidden
  // (T11 inference resistance). Generalized/aggregate substitutes are the PARTICIPANT
  // tier, never an outsider tier.
  if (!viewer.isParticipant && !allowlisted) return { visibility: "SUPPRESSED", value: null };

  switch (item.audience) {
    case "PARTICIPANT_SHARED":
      return { visibility: "EXACT", value: item.value };
    case "GENERALIZED":
      return { visibility: "GENERALIZED", value: item.generalized ?? item.value };
    case "AGGREGATED":
      return { visibility: "AGGREGATED", value: item.aggregate ?? item.value };
    case "ORG_ALLOWLIST":
      return allowlisted ? { visibility: "EXACT", value: item.value } : downgrade(item);
    case "PURSUIT_INTERNAL":
      return downgrade(item);          // internal to the owning org; participants get the generalized form if any
    case "ORG_PRIVATE":
    default:
      return { visibility: "SUPPRESSED", value: null };
  }
}

/**
 * Apply disclosure across a list for a viewer. Suppressed items are OMITTED (their
 * existence is not leaked). Each returned entry carries only the authorized value —
 * the exact value never appears for a downgraded/suppressed item (R7 payload absence).
 */
export function applyDisclosure<T>(items: Disclosable<T>[], viewer: FederationViewer): { visibility: Visibility; value: T }[] {
  const out: { visibility: Visibility; value: T }[] = [];
  for (const item of items) {
    const r = resolveDisclosure(item, viewer);
    if (r.visibility === "SUPPRESSED" || r.value === null) continue;   // omit existence
    out.push({ visibility: r.visibility, value: r.value });
  }
  return out;
}
