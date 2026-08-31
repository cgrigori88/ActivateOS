/**
 * Ecosystem scope model (scale-disclosure §1). A scope is a NARROWING filter over the
 * tenant's already-RLS-scoped, server-authorized set — never a widener and never global
 * platform data. ALL means "every record the authenticated principal is authorized to see."
 *
 * This module is PURE (no `pg`, no server-only imports) so the client scope selector can
 * import the types, the (de)serializer, and the labels. All authorization and data derivation
 * live in `./server` and are re-evaluated server-side on every request.
 */

export type ScopeKind = "ALL" | "PARTNER" | "VENDOR" | "TERRITORY" | "SELLER" | "PERSONAL";

export interface Scope {
  kind: ScopeKind;
  /** Entity id (partner/vendor/seller uuid) or territory label. null for ALL / PERSONAL. */
  id: string | null;
}

/** A selectable option, derived from the tenant's data (server-side). */
export interface ScopeOption {
  kind: ScopeKind;
  id: string | null;
  /** Human label ("CDW", "West", "Me"). */
  label: string;
  /** Group heading in the selector ("Partner", "Vendor", …). Empty for ALL. */
  group: string;
}

/** The active scope plus its resolved chip summary (for persistent scope awareness, §1.2/R2). */
export interface ScopeContext {
  scope: Scope;
  label: string;
  /** Compact "N accounts · M motions" style facts, already scoped. Empty for ALL. */
  facts: string[];
}

export const SCOPE_COOKIE = "pos:scope";
export const SCOPE_PARAM = "scope";
export const ALL_SCOPE: Scope = { kind: "ALL", id: null };

const KINDS: ReadonlySet<ScopeKind> = new Set(["ALL", "PARTNER", "VENDOR", "TERRITORY", "SELLER", "PERSONAL"]);
const NARROWING: ReadonlySet<ScopeKind> = new Set(["PARTNER", "VENDOR", "TERRITORY", "SELLER"]);

/** Serialize a scope for the URL / cookie: "all" | "personal" | "partner:<id>" | "territory:<label>". */
export function serializeScope(s: Scope): string {
  if (s.kind === "ALL") return "all";
  if (s.kind === "PERSONAL") return "personal";
  if (NARROWING.has(s.kind) && s.id) return `${s.kind.toLowerCase()}:${s.id}`;
  return "all";
}

/**
 * Parse a scope token. Fail-SAFE: anything unrecognized, malformed, or missing an id where one
 * is required collapses to ALL. A client-supplied id is never trusted here beyond shape — the
 * server re-derives authorization when it resolves the scope to rows.
 */
export function parseScope(raw: string | null | undefined): Scope {
  if (!raw) return ALL_SCOPE;
  const idx = raw.indexOf(":");
  const head = (idx === -1 ? raw : raw.slice(0, idx)).trim().toUpperCase();
  const tail = idx === -1 ? "" : raw.slice(idx + 1).trim();
  const kind = head as ScopeKind;
  if (!KINDS.has(kind) || kind === "ALL") return ALL_SCOPE;
  if (kind === "PERSONAL") return { kind, id: null };
  if (!tail || tail.length > 128) return ALL_SCOPE;
  return { kind, id: tail };
}

export function scopesEqual(a: Scope, b: Scope): boolean {
  return a.kind === b.kind && a.id === b.id;
}

export function isAllScope(s: Scope): boolean {
  return s.kind === "ALL";
}

/** Default human label for a scope before the server attaches the real entity name. */
export function scopeKindLabel(kind: ScopeKind): string {
  return { ALL: "All", PARTNER: "Partner", VENDOR: "Vendor", TERRITORY: "Territory", SELLER: "Seller", PERSONAL: "My active book" }[kind];
}
