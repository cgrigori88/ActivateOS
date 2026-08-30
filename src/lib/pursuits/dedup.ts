import { createHash } from "node:crypto";

/**
 * Deterministic, explainable Pursuit identity (Workstream A, §J / §2). Identity is the
 * commercial THESIS: org × account × product-or-category × pursuit_type × use_case.
 * NOT the partner/seller/timing route (those are mutable attributes of the thesis).
 *
 * `use_case` is a NORMALIZED controlled token, never an LLM free-text hash — so two
 * legitimately different theses on the same account/product/type (e.g. infra-ops
 * automation vs. network automation) do not collapse, while re-routing/re-timing the
 * same thesis does not fork it.
 */

export interface PursuitIdentity {
  orgId: string;
  accountId: string;
  productId?: string | null;
  productCategoryId?: string | null;
  pursuitType: string; // controlled enum value
  useCase?: string | null;
}

/** Normalize a use-case discriminator to a stable token (lowercase, underscores). */
export function normalizeUseCase(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

/**
 * Compute the dedup key. The component string is intentionally readable before
 * hashing so identity is auditable; the hash keeps the stored key fixed-width and
 * index-friendly. Product OR category (product wins if present) participates.
 */
export function pursuitDedupKey(id: PursuitIdentity): string {
  const productKey = id.productId ?? id.productCategoryId ?? "";
  const parts = [
    id.orgId,
    id.accountId,
    productKey,
    (id.pursuitType || "UNCLASSIFIED").toUpperCase(),
    normalizeUseCase(id.useCase),
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40);
}
