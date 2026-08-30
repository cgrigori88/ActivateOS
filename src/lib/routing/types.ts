/**
 * Route domain vocabulary (Workstream C). Enums + weights kept in one place so scoring,
 * persistence, and explanation agree. Route-v1 is deterministic and versioned (§44).
 */

export type RouteTopology = "DIRECT" | "PARTNER_LED" | "DISTRIBUTOR_LED" | "JOINT" | "MULTI_PARTNER";
export type RouteStatus = "PROPOSED" | "REVIEW_REQUIRED" | "RECOMMENDED" | "SELECTED" | "DECLINED" | "REROUTE_REQUIRED" | "SUPERSEDED";
export type ParticipantRole = "VENDOR" | "DISTRIBUTOR" | "RESELLER" | "PARTNER" | "CUSTOMER";

export type TeamRole =
  | "VENDOR_ACCOUNT_EXECUTIVE" | "VENDOR_PARTNER_MANAGER" | "VENDOR_SPECIALIST"
  | "VENDOR_SOLUTION_ARCHITECT" | "VENDOR_EXECUTIVE_SPONSOR"
  | "PARTNER_ACCOUNT_MANAGER" | "PARTNER_BDM" | "PARTNER_SPECIALIST" | "PARTNER_ARCHITECT"
  | "DISTRIBUTOR_VENDOR_MANAGER" | "DISTRIBUTOR_BDM" | "DISTRIBUTOR_SPECIALIST" | "DISTRIBUTOR_TECHNICAL_RESOURCE";
export type TeamStatus = "RECOMMENDED" | "INVITED" | "ACCEPTED" | "DECLINED" | "ACTIVE" | "ACTION_REQUIRED" | "INACTIVE" | "SUPERSEDED";

export const ROUTE_MODEL_VERSION = "route-v1-rules";
export const PARTNER_FIT_VERSION = "fit-v1-rules";
export const SELLER_FIT_VERSION = "seller-v1-rules";

/** Partner-activation dimension weights (route-v1). Sum ≈ 1.0. */
export const ACTIVATION_WEIGHTS: Record<string, number> = {
  account_relationship: 0.22,
  product_capability: 0.20,
  transaction_adjacency: 0.14,
  historical_performance: 0.12,
  territory_alignment: 0.10,
  seller_coverage: 0.10,
  strategic_alignment: 0.07,
  vertical_alignment: 0.05,
};

export type DisqualifierCode =
  | "NO_REQUIRED_CAPABILITY" | "OUTSIDE_TERRITORY" | "PARTNER_DECLINED" | "CONSENT_BLOCKED"
  | "ENTITY_NOT_RESOLVED" | "NO_NAMED_SELLER" | "LOW_RECENT_ACTIVITY" | "WEAK_TECHNICAL_COVERAGE"
  | "LIMITED_VERTICAL_EXPERIENCE" | "CAPACITY_CONSTRAINT" | "NO_ACCOUNT_COVERAGE";

export type OutcomeLabel =
  | "ROUTE_RECOMMENDED" | "ROUTE_SELECTED" | "PARTNER_ACCEPTED" | "PARTNER_DECLINED"
  | "SELLER_ACCEPTED" | "SELLER_DECLINED" | "FIRST_ACTION_COMPLETED" | "CUSTOMER_ENGAGED"
  | "MEETING_CREATED" | "OPPORTUNITY_CREATED" | "PIPELINE_CREATED" | "DEAL_REGISTERED" | "WON" | "LOST";

export type OverrideCategory =
  | "RELATIONSHIP_KNOWLEDGE" | "CUSTOMER_PREFERENCE" | "PARTNER_CAPACITY" | "EXECUTIVE_DIRECTION"
  | "COMMERCIAL_TERMS" | "TERRITORY" | "STRATEGIC_PRIORITY" | "MODEL_ERROR" | "OTHER";

export type DisclosureClass = "PUBLIC" | "INTERNAL" | "PARTNER_SHARED" | "TRANSACTION_CONFIDENTIAL" | "PII" | "RESTRICTED";
