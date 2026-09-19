import "server-only";
import { withTenant } from "@/lib/db/tenant";
import {
  definitionDigest, validatePersistedDefinition, PERSISTED_DEFINITION_VERSION,
  type PersistedSurfaceDefinition,
} from "./persisted";

/**
 * P7 Slice 12 — THE ONLY PRODUCTION ACCESS PATH to `pinned_surface_definitions`.
 *
 * ── THE BOUNDARY ASYMMETRY, STATED WHERE IT IS ENFORCED ─────────────────────────────────────────
 *
 * Two different guarantees protect a pin, and they are NOT the same strength:
 *
 *   ORGANIZATION isolation — enforced by the DATABASE. Every statement runs under `withTenant`, and
 *     the table's RLS policy is the canonical `is_org_member(org_id)`. A caller in another org
 *     cannot read this table at all, whatever this file does.
 *
 *   CREATOR visibility — enforced HERE, in the application. It is **not** RLS-enforced, and calling
 *     it "database-enforced user privacy" would be false: under the deployed runtime the app
 *     connects as `app_rw` with the `app.org_id` GUC set, so `auth.uid()` is not the acting identity
 *     and a `created_by_user_id = auth.uid()` policy would reject every legitimate request.
 *
 * That asymmetry is why this module exists at all. Every read, rename and delete constrains by
 * `org_id` **and** `created_by_user_id` in the same statement, so a peer inside the same
 * organization is refused by the query rather than by a policy — and a structural inventory test
 * requires any new direct reader or writer of the table to be classified rather than added quietly.
 *
 * CREATOR IDENTITY IS NEVER ACCEPTED FROM A CALLER. It is derived from the authenticated server-side
 * principal and passed in by the boundary that resolved it; there is no parameter through which a
 * browser, a form or a SurfaceSpec could nominate one.
 */

export interface PinSummary {
  id: string;
  name: string;
  definitionDigest: string;
  createdAt: string;
}

export interface PinRecord extends PinSummary {
  definition: PersistedSurfaceDefinition;
}

/** Why an operation did not happen. A missing pin and a foreign pin are ONE value, deliberately. */
export type PinOutcome<T> =
  | { ok: true; value: T }
  /** Not found, not yours, or not loadable — indistinguishable, so existence is not probeable. */
  | { ok: false; error: "NOT_AVAILABLE" }
  /** The stored definition no longer validates against the current registry. */
  | { ok: false; error: "DEFINITION_UNAVAILABLE"; detail: string }
  | { ok: false; error: "INVALID"; detail: string };

const NAME_MAX = 120;

/** Save a validated definition. The digest is computed here, never accepted from a caller. */
export async function createPin(
  principalUserId: string, name: string, definition: PersistedSurfaceDefinition,
): Promise<PinOutcome<PinSummary>> {
  const trimmed = (name ?? "").trim();
  if (!principalUserId) return { ok: false, error: "INVALID", detail: "no authenticated principal" };
  if (trimmed.length === 0 || trimmed.length > NAME_MAX) return { ok: false, error: "INVALID", detail: "a pin needs a name" };
  // VALIDATED BEFORE INSERT, against the current registry — the same check the load path re-runs.
  const checked = validatePersistedDefinition(definition);
  if (!checked.ok) return { ok: false, error: "DEFINITION_UNAVAILABLE", detail: checked.detail };

  const digest = definitionDigest(checked.definition);
  return withTenant(async (db, orgId) => {
    const { rows } = await db.query<{ id: string; created_at: string }>(
      `insert into pinned_surface_definitions
         (org_id, created_by_user_id, name, definition_schema_version, definition, definition_digest)
       values ($1, $2, $3, $4, $5::jsonb, $6)
       on conflict (org_id, created_by_user_id, lower(btrim(name))) do nothing
       returning id, created_at`,
      [orgId, principalUserId, trimmed, PERSISTED_DEFINITION_VERSION, JSON.stringify(checked.definition), digest]);
    if (!rows[0]) return { ok: false as const, error: "INVALID" as const, detail: "a pin with that name already exists" };
    return { ok: true as const, value: { id: rows[0].id, name: trimmed, definitionDigest: digest, createdAt: rows[0].created_at } };
  });
}

/** The caller's own pins. Constrained by org AND creator in the statement itself. */
export async function listPins(principalUserId: string): Promise<PinSummary[]> {
  if (!principalUserId) return [];
  return withTenant(async (db, orgId) => {
    const { rows } = await db.query<{ id: string; name: string; definition_digest: string; created_at: string }>(
      `select id, name, definition_digest, created_at from pinned_surface_definitions
        where org_id = $1 and created_by_user_id = $2 order by created_at desc limit 50`,
      [orgId, principalUserId]);
    return rows.map((r) => ({ id: r.id, name: r.name, definitionDigest: r.definition_digest, createdAt: r.created_at }));
  });
}

/**
 * Load one pin for execution.
 *
 * The stored definition is REVALIDATED against the current registry before it is returned: save-time
 * validation proved it was legal then, and only this proves it is legal now. An obsolete definition
 * becomes `DEFINITION_UNAVAILABLE` and never a migrated or repaired one.
 */
export async function loadPin(principalUserId: string, id: string): Promise<PinOutcome<PinRecord>> {
  if (!principalUserId || !id) return { ok: false, error: "NOT_AVAILABLE" };
  return withTenant(async (db, orgId) => {
    const { rows } = await db.query<{ id: string; name: string; definition: unknown; definition_digest: string; created_at: string }>(
      `select id, name, definition, definition_digest, created_at from pinned_surface_definitions
        where org_id = $1 and created_by_user_id = $2 and id = $3`,
      [orgId, principalUserId, id]);
    // Not found and not-yours are the SAME answer: a peer must not be able to probe existence.
    if (!rows[0]) return { ok: false as const, error: "NOT_AVAILABLE" as const };
    const checked = validatePersistedDefinition(rows[0].definition);
    if (!checked.ok) return { ok: false as const, error: "DEFINITION_UNAVAILABLE" as const, detail: checked.detail };
    return {
      ok: true as const,
      value: {
        id: rows[0].id, name: rows[0].name, definitionDigest: rows[0].definition_digest,
        createdAt: rows[0].created_at, definition: checked.definition,
      },
    };
  });
}

/** Rename. METADATA ONLY — the definition bytes and the digest are untouched by construction. */
export async function renamePin(principalUserId: string, id: string, name: string): Promise<PinOutcome<PinSummary>> {
  const trimmed = (name ?? "").trim();
  if (!principalUserId || !id) return { ok: false, error: "NOT_AVAILABLE" };
  if (trimmed.length === 0 || trimmed.length > NAME_MAX) return { ok: false, error: "INVALID", detail: "a pin needs a name" };
  return withTenant(async (db, orgId) => {
    const { rows } = await db.query<{ id: string; definition_digest: string; created_at: string }>(
      `update pinned_surface_definitions set name = $4, updated_at = now()
        where org_id = $1 and created_by_user_id = $2 and id = $3
        returning id, definition_digest, created_at`,
      [orgId, principalUserId, id, trimmed]);
    if (!rows[0]) return { ok: false as const, error: "NOT_AVAILABLE" as const };
    return { ok: true as const, value: { id: rows[0].id, name: trimmed, definitionDigest: rows[0].definition_digest, createdAt: rows[0].created_at } };
  });
}

/**
 * Hard delete — the saved definition and nothing else.
 *
 * There is no soft-delete column anywhere in this schema, so this follows the product's existing
 * pattern rather than inventing durable pin history the slice has no requirement for. It touches no
 * canonical business data, no P2/P6 state, no pursuit and no execution history held elsewhere.
 */
export async function deletePin(principalUserId: string, id: string): Promise<PinOutcome<{ id: string }>> {
  if (!principalUserId || !id) return { ok: false, error: "NOT_AVAILABLE" };
  return withTenant(async (db, orgId) => {
    const { rows } = await db.query<{ id: string }>(
      `delete from pinned_surface_definitions
        where org_id = $1 and created_by_user_id = $2 and id = $3 returning id`,
      [orgId, principalUserId, id]);
    if (!rows[0]) return { ok: false as const, error: "NOT_AVAILABLE" as const };
    return { ok: true as const, value: { id: rows[0].id } };
  });
}
