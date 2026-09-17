import type { PoolClient } from "pg";

/**
 * P6-IG — DERIVATION AUTHORITY.
 *
 * WHY THIS EXISTS. Tenant isolation answers "is this row yours?". P4 answers "may this actor act?".
 * The disclosure ladder answers "at what fidelity may this org SEE it?". None of them answers the
 * question that makes a shared commercial world model possible:
 *
 *      MAY PURSUITOS COMPUTE A NEW CONCLUSION FROM THIS ORGANIZATION'S INFORMATION?
 *
 * DERIVATION AUTHORITY AND DISCLOSURE AUTHORITY ARE SEPARATE. Lawful custody is NOT lawful
 * secondary use: that an org may see an item, or that the system lawfully holds it, says nothing
 * about whether a new output may be derived from it.
 *
 * FAIL-CLOSED, NEVER WILDCARD. Missing governance metadata is DENY. Before 0112 `purpose` was free
 * text and `information_classes` / `retention_class` were stored and never read, so every grant was
 * effectively all-or-nothing per pursuit. Shipping a `mayDerive` that silently ignored purpose and
 * class would have been worse than having none — it would have looked like governance.
 *
 * THE SEMANTIC FIREWALL. `context_grants.information_classes` is a LEGACY DISCLOSURE field that
 * already carries Audience-oriented values ('PARTICIPANT_SHARED') in certified paths as well as
 * data categories elsewhere. NOTHING IN THIS MODULE READS IT. Machine-governed derivation reads
 * `governed_information_classes` and only that column. There is no fallback, no coalesce between
 * the two, and neither can satisfy the other's contract: an Audience value can never become a
 * derivation authority, and a governed data class never alters the disclosure interpretation.
 */

/** Governed-USE purposes. NOT all of these authorize derivation — see DERIVATION_PURPOSES. */
export const GOVERNED_USE_PURPOSES = [
  "CO_SELL_CONTEXT_DISPLAY", "ROUTE_EVALUATION", "VALUE_CASE", "CONFLICT_DETECTION",
] as const;
export type GovernedUsePurpose = (typeof GOVERNED_USE_PURPOSES)[number];

/**
 * The purposes that authorize DERIVATION. `CO_SELL_CONTEXT_DISPLAY` is deliberately absent: it
 * authorizes rendering a contributed item through the disclosure ladder and nothing more. A display
 * operation is not renamed into a "derivation" to make the model uniform, and a grant does not
 * become derivation-capable merely because its other fields are fully populated.
 */
export const DERIVATION_PURPOSES: ReadonlySet<string> = new Set([
  "ROUTE_EVALUATION", "VALUE_CASE", "CONFLICT_DETECTION",
]);

/** Every derivable canonical input resolves to exactly one class. No OTHER, no wildcard. */
export const INFORMATION_CLASSES = [
  "transaction_adjacency", "economic_value", "stakeholder_coverage",
  "timing", "route_candidate", "evidence_document",
] as const;
export type InformationClass = (typeof INFORMATION_CLASSES)[number];

/** Canonical input → class. An unmapped input DENIES; it never falls through to a catch-all. */
export const INPUT_CLASS_REGISTRY: Record<string, InformationClass> = {
  economic_fact: "economic_value", value_case_driver: "economic_value", modeled_impact: "economic_value",
  stakeholder_role: "stakeholder_coverage", buying_role_coverage: "stakeholder_coverage",
  lifecycle_date: "timing", expected_close: "timing", timing_fact: "timing",
  route_snapshot: "route_candidate", route_candidate: "route_candidate", partner_activation: "route_candidate",
  transaction_adjacency: "transaction_adjacency", transaction_feature: "transaction_adjacency",
  evidence: "evidence_document", evidence_share: "evidence_document", document: "evidence_document",
};

/** Retention governs RECIPIENT-SIDE STORAGE ONLY. It is never derivation permission. */
export type RetentionClass = "EPHEMERAL" | "PURSUIT_LIFETIME" | "RETAINED";
export const RETENTION_CLASSES: ReadonlySet<string> = new Set(["EPHEMERAL", "PURSUIT_LIFETIME", "RETAINED"]);

/**
 * Disposition of a derived output. COMPUTED, never persisted, and deliberately NOT a seventh
 * Audience class — the existing Audience × Sensitivity taxonomy is untouched.
 *
 * `DECLASSIFIED` is structurally representable but UNREACHABLE in P6-IG: this slice ships ZERO
 * safe-declassification transforms, so any hidden input yields NOT_DISCLOSABLE. `CONFLICT_EXISTS`
 * remains documented future work, with its domain-cardinality precondition recorded — in a binary
 * or tiny domain, "your value conflicts with a hidden one" IS the hidden value.
 */
export type DerivedDisposition = "RECIPIENT_DERIVED" | "DECLASSIFIED" | "NOT_DISCLOSABLE";

/** The approved transform set. EMPTY BY RULING. Unknown transform → NOT_DISCLOSABLE. */
export const SAFE_DECLASSIFICATION_TRANSFORMS: ReadonlySet<string> = new Set<string>();

export interface DeriveInput {
  /** Registry key of the canonical input (see INPUT_CLASS_REGISTRY). */
  inputKind: string;
  /** The organization that owns/contributed it. */
  sourceOrgId: string;
  pursuitId: string;
}

export type DeriveDecision =
  | { allow: true; grantId: string; purpose: GovernedUsePurpose; informationClass: InformationClass; retention: RetentionClass }
  | { allow: false; reason: string };

const deny = (reason: string): DeriveDecision => ({ allow: false, reason });

/**
 * MAY PURSUITOS DERIVE? Evaluated independently of disclosure, and denied unless EVERY condition
 * holds.
 *
 * `asOf` is NULL for every live decision, and the comparison instant is then `transaction_timestamp()`
 * read INSIDE each statement — fixed for the whole transaction, so the participant window, the grant
 * window and `can_see_pursuit` all evaluate against one identical instant at full microsecond
 * precision. A `Date` may be supplied ONLY for a deliberate as-of query: a JavaScript `Date` carries
 * milliseconds where `timestamptz` carries microseconds, so threading the instant through JavaScript
 * places the decision up to 999µs in the PAST and can admit an authority the database has already
 * ended (see `governanceClock`).
 */
export async function mayDerive(
  db: PoolClient,
  viewerOrgId: string,
  input: DeriveInput,
  operationPurpose: string,
  asOf: Date | null = null,
): Promise<DeriveDecision> {
  // The operation itself must be one we recognise. Unknown operation → DENY, never permissive.
  if (!DERIVATION_PURPOSES.has(operationPurpose)) return deny(`operation purpose ${operationPurpose} is not a derivation purpose`);
  const cls = INPUT_CLASS_REGISTRY[input.inputKind];
  if (!cls) return deny(`input kind ${input.inputKind} has no information-class mapping`);

  // An organization derives from its OWN information without a grant; a grant governs the crossing.
  if (viewerOrgId === input.sourceOrgId) {
    return { allow: true, grantId: "self", purpose: operationPurpose as GovernedUsePurpose, informationClass: cls, retention: "PURSUIT_LIFETIME" };
  }

  // Lawful eligibility first: the viewer must still be an EFFECTIVE participant at the instant.
  // This mirrors `can_see_pursuit` exactly, so RLS and the read model cannot disagree at a boundary.
  const { rows: elig } = await db.query<{ ok: boolean }>(
    `select exists (
       select 1 from pursuit_participants pp
        where pp.pursuit_id = $1 and pp.org_id = $2
          and pp.participation_state = 'ACTIVE'
          and (pp.effective_from is null or pp.effective_from <= coalesce($3::timestamptz, transaction_timestamp()))
          and (pp.effective_to   is null or pp.effective_to   >  coalesce($3::timestamptz, transaction_timestamp()))) as ok`,
    [input.pursuitId, viewerOrgId, asOf ?? null]);
  if (!elig[0]?.ok) return deny("viewer is not an effective participant on this pursuit");

  // A MACHINE-GOVERNED, DERIVATION-CAPABLE, LIVE grant from the source org. Every clause matters:
  // purpose_code NOT NULL makes it machine-governed (0112 then guarantees completeness); the
  // purpose must be a DERIVATION purpose AND match the operation exactly; the class must be covered
  // BY THE GOVERNED COLUMN — `information_classes` is the legacy disclosure field and is never
  // consulted here, so an Audience value or a legacy data category cannot confer derivation
  // authority; and the grant must be live at the same instant.
  const { rows } = await db.query<{ id: string; purpose_code: string; retention_class: string; scope: Record<string, unknown> }>(
    `select id, purpose_code, retention_class, scope
       from context_grants
      where from_org_id = $1 and to_org_id = $2 and pursuit_id = $3
        and grant_kind = 'DATA' and status = 'accepted'
        and purpose_code is not null
        and purpose_code = $4
        and governed_information_classes is not null and $5 = any(governed_information_classes)
        and (expires_at is null or expires_at > coalesce($6::timestamptz, transaction_timestamp()))
      limit 1`,
    [input.sourceOrgId, viewerOrgId, input.pursuitId, operationPurpose, cls, asOf ?? null]);
  const g = rows[0];
  if (!g) return deny("no live machine-governed DATA grant covers this purpose and information class");

  if (!RETENTION_CLASSES.has(g.retention_class)) return deny(`unknown retention class ${g.retention_class}`);

  // PURSUIT_LIFETIME is bounded by the EARLIEST of pursuit terminality, the participant window and
  // the grant. The participant window and the grant are already proven above; the pursuit remains.
  if (g.retention_class === "PURSUIT_LIFETIME") {
    const { rows: pu } = await db.query<{ live: boolean }>(
      `select (status not in ('WON','LOST','DISQUALIFIED') and merged_into_pursuit_id is null) as live
         from pursuits where id = $1`, [input.pursuitId]);
    if (!pu[0]?.live) return deny("PURSUIT_LIFETIME authority ended: the pursuit is terminal or merged");
  }

  // `scope = {}` means THE WHOLE OF THIS PURSUIT — never organization-wide, and never a wildcard.
  // 0112 guarantees a machine-governed grant is pursuit-anchored, which is what makes the empty
  // object unambiguous. `scope.keys[]`, when present, can only NARROW.
  const keys = (g.scope as { keys?: string[] })?.keys;
  if (Array.isArray(keys) && keys.length > 0 && !keys.includes(input.inputKind)) {
    return deny(`scope.keys narrows this grant and does not include ${input.inputKind}`);
  }

  return { allow: true, grantId: g.id, purpose: g.purpose_code as GovernedUsePurpose, informationClass: cls, retention: g.retention_class as RetentionClass };
}

/**
 * Disposition for a derived output. With zero approved transforms, ANY hidden input yields
 * NOT_DISCLOSABLE — there is no path by which unauthorized evidence reaches a recipient.
 */
export function derivedDisposition(inputsAuthorized: boolean[], transform?: string): DerivedDisposition {
  if (inputsAuthorized.every(Boolean)) return "RECIPIENT_DERIVED";
  if (transform && SAFE_DECLASSIFICATION_TRANSFORMS.has(transform)) return "DECLASSIFIED";
  return "NOT_DISCLOSABLE";
}

/**
 * THE COUNT FLOOR IS A DECLARED PRODUCT POLICY. It is NOT anonymity and NOT differential privacy,
 * and must never be cited as either. A count of one discloses existence and, in a small pursuit
 * network, identity.
 */
export const CROSS_ORG_COUNT_FLOOR = 5;

/** A cross-org withheld count renders only when all three conditions hold. Otherwise: no count. */
export function mayRenderWithheldCount(
  count: number, existenceIsDisclosable: boolean, recipientVariableFiltering: boolean,
): boolean {
  if (!existenceIsDisclosable) return false;          // suppression must not yield an aggregate
  if (recipientVariableFiltering) return false;       // differencing would reconstruct membership
  return count >= CROSS_ORG_COUNT_FLOOR;
}
