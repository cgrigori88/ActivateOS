import type { Pool, PoolClient } from "pg";
import { normalizeCompanyName } from "./normalize";

/**
 * Query-side company identity resolution (D-G8-4C).
 *
 * WHY THIS EXISTS. Several lookups resolved a typed account name with
 * `... where legal_name ilike $1 order by length(legal_name) limit 1` — the SHORTEST name won. That
 * is not identity evidence; it is a coincidence of spelling. "Acme" would beat "Acme Robotics" for
 * the input "Acme Robotics Inc", and nothing about the shorter string makes it the right record.
 *
 * NOT the same as `resolve.ts`, which is the INGEST-side matcher (domain → normalized+geo →
 * normalized → fuzzy score) used when deciding whether an inbound record is a company we already
 * hold. This module answers a different question: a human typed a name at a query surface — which
 * canonical company, if any, did they unambiguously mean?
 *
 * THE LADDER (owner ruling):
 *   1. explicit canonical `companies.id`
 *   2. exact ID-type alias
 *   3. exact name/domain alias
 *   4. exact normalized canonical company-name match (both sides normalized by the SAME function)
 *   5. a UNIQUE supported fuzzy match
 *   6. UNRESOLVED
 *
 * Name length, alphabetical order, uuid order and row order are NOT identity signals and appear
 * nowhere below. Anything the ladder cannot decide is AMBIGUOUS — never a guess.
 */

/** Aliases that carry a system identity, not a human label. Ranked ABOVE name/domain aliases. */
export const ID_ALIAS_TYPES = ["crm_account_id", "vendor_account_id", "partner_account_id", "distributor_account_id"] as const;
const LABEL_ALIAS_TYPES = ["name", "domain"] as const;

export type IdentityVia = "CANONICAL_ID" | "ID_ALIAS" | "NAME_ALIAS" | "NORMALIZED_NAME" | "UNIQUE_FUZZY";

export type IdentityResolution =
  | { kind: "RESOLVED"; companyId: string; via: IdentityVia }
  | { kind: "NONE" }
  /**
   * Two or more candidates the ladder cannot separate. `candidates` is a COUNT, never the rows:
   * an ambiguity explanation must not become a channel for reading accounts the caller may not be
   * entitled to see.
   */
  | { kind: "AMBIGUOUS"; via: IdentityVia; candidates: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LookupOptions {
  /** Restrict to an already-authorized set. `null` means "no narrowing" (the caller's own choice). */
  companyIds?: string[] | null;
  /** When the input channel names an alias namespace, only that namespace is consulted at step 2. */
  aliasType?: string | null;
}

/** Resolve a typed account reference to ONE company, or say why it cannot be resolved. */
export async function resolveCompanyIdentity(
  db: Pool | PoolClient, typed: string, opts: LookupOptions = {},
): Promise<IdentityResolution> {
  const text = typed.trim();
  if (text.length === 0) return { kind: "NONE" };
  const scope = opts.companyIds ?? null;
  const scoped = scope != null;
  if (scoped && scope!.length === 0) return { kind: "NONE" };
  const inScope = (ids: string[]) => (scoped ? ids.filter((id) => scope!.includes(id)) : ids);
  const distinct = (ids: string[]) => [...new Set(ids)];

  // ── 1. explicit canonical id ────────────────────────────────────────────────────────────────
  if (UUID.test(text)) {
    const ids = inScope((await db.query<{ id: string }>(
      `select id from companies where id = $1`, [text])).rows.map((r) => r.id));
    if (ids.length === 1) return { kind: "RESOLVED", companyId: ids[0], via: "CANONICAL_ID" };
    return { kind: "NONE" };
  }

  // ── 2-3. explicit alias / mapped identity (ID-type alias, then name/domain alias) ─────────────────────────────────────────────────────
  const aliasRows = (await db.query<{ company_id: string; alias_type: string }>(
    `select company_id, alias_type from company_aliases where lower(alias) = lower($1)`, [text])).rows;
  const typed_ns = opts.aliasType ?? null;
  const pool_ = typed_ns ? aliasRows.filter((r) => r.alias_type === typed_ns) : aliasRows;
  const idHits = distinct(inScope(
    pool_.filter((r) => (ID_ALIAS_TYPES as readonly string[]).includes(r.alias_type)).map((r) => r.company_id)));
  if (idHits.length === 1) return { kind: "RESOLVED", companyId: idHits[0], via: "ID_ALIAS" };
  // Two different companies claim the same system identifier and no namespace was supplied: the
  // caller must say which namespace they meant. Inventing a precedence AMONG id types would be a
  // product decision, not a deduction.
  if (idHits.length > 1) return { kind: "AMBIGUOUS", via: "ID_ALIAS", candidates: idHits.length };
  const labelHits = distinct(inScope(
    pool_.filter((r) => (LABEL_ALIAS_TYPES as readonly string[]).includes(r.alias_type)).map((r) => r.company_id)));
  if (labelHits.length === 1) return { kind: "RESOLVED", companyId: labelHits[0], via: "NAME_ALIAS" };
  if (labelHits.length > 1) return { kind: "AMBIGUOUS", via: "NAME_ALIAS", candidates: labelHits.length };

  // ── 4. exact normalized canonical match ─────────────────────────────────────────────────────
  //
  // BOTH SIDES are normalized by the SAME application function. This rung used to compare the
  // normalized input against the stored `companies.normalized_name`, which silently made it inert:
  // on the hosted world that column holds the RAW legal name, so 0 of 14 companies satisfied
  // `normalized_name = normalizeCompanyName(legal_name)` and every exact name fell through to the
  // fuzzy rung. The visible consequence was that typing the exact name "Initech Financial" came back
  // AMBIGUOUS, because the substring match also caught "Initech Financial (expansion)".
  //
  // `companies.normalized_name` is deliberately NOT read here and NOT modified: other callers
  // (ingest/staged.ts, motions/page.tsx, identity/resolve.ts) have their own contract with that
  // column, and repairing it is data work, not identity-lookup semantics.
  //
  // The comparison cannot be pushed into SQL without re-implementing the normalizer there, and two
  // normalizers that drift are exactly the defect being fixed — so the candidate rows are normalized
  // in application code. The scan is bounded by the authorized set when the caller supplies one, and
  // otherwise by the company catalogue; this runs once per typed lookup, not in a loop.
  const wanted = normalizeCompanyName(text);
  if (wanted) {
    const candidates = scoped
      ? (await db.query<{ id: string; legal_name: string }>(
          `select id, legal_name from companies where id = any($1)`, [scope])).rows
      : (await db.query<{ id: string; legal_name: string }>(`select id, legal_name from companies`)).rows;
    const hits = distinct(candidates.filter((r) => normalizeCompanyName(r.legal_name) === wanted).map((r) => r.id));
    // Exactly one canonical name normalizes to the input: that IS the answer, and the fuzzy rung
    // below never gets to override it. Two or more are genuinely indistinguishable by name.
    if (hits.length === 1) return { kind: "RESOLVED", companyId: hits[0], via: "NORMALIZED_NAME" };
    if (hits.length > 1) return { kind: "AMBIGUOUS", via: "NORMALIZED_NAME", candidates: hits.length };
  }

  // ── 5. a UNIQUE supported fuzzy match (6. otherwise unresolved) ─────────────────────────────
  const pat = `%${text.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const ids = distinct(inScope((await db.query<{ id: string }>(
    `select id from companies where legal_name ilike $1`, [pat])).rows.map((r) => r.id)));
  if (ids.length === 1) return { kind: "RESOLVED", companyId: ids[0], via: "UNIQUE_FUZZY" };
  if (ids.length > 1) return { kind: "AMBIGUOUS", via: "UNIQUE_FUZZY", candidates: ids.length };
  return { kind: "NONE" };
}
