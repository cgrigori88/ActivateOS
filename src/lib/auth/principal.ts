/**
 * WHO the gate authenticated — the one fact server rendering needs before it may read a tenant.
 *
 * THE INVARIANT THIS EXISTS TO ENCODE: *an unauthenticated request must not acquire an organization
 * merely because no authenticated organization exists.* Presentation used to derive one anyway. With
 * no session, `sessionOrgId()` resolves `resolve_user_org(null)`, which falls back to the OLDEST
 * organization, so the root layout ran its role and badge queries — and `getShellScope()` derived
 * scope options — against a tenant the caller had no claim to. On the routes that legitimately pass
 * the gate without a principal (`/join`, `/join/<code>`, `/login`) those props were serialized into
 * the RSC payload of an anonymous response: partner and seller names with their row ids, plus
 * `isOwner: true` from `currentRole`'s no-user fallback. `Shell` renders those routes "bare", so
 * none of it was ever on screen — it was in the payload, which is all an anonymous fetch needs.
 *
 * WHY A HEADER RATHER THAN "IS THERE A SUPABASE USER". Absence of an identity session does not mean
 * absence of a principal: a Basic-Auth deployment authenticates at the edge and has no user object.
 * Only the gate knows which credential passed, so the gate states it and rendering obeys. The
 * header is stamped on the FORWARDED REQUEST by `src/proxy.ts`, which deletes any inbound value
 * first — a client cannot award itself a principal.
 *
 * FAIL-CLOSED BY CONSTRUCTION. Anything other than a value the gate sets — absent, empty, unknown,
 * client-supplied — is read as "no principal", and the worst case is a chrome-less shell for a
 * caller who deserved chrome. There is no input that turns an anonymous request into a tenant read.
 */

export const PRINCIPAL_HEADER = "x-pursuitos-principal";

/**
 * `open`     — no authentication is configured at all (local dev); the deployment has no tenant
 *              boundary to enforce, which is already how every screen behaves there.
 * `basic`    — Basic Auth verified by the gate. No identity session exists, and that is not a
 *              missing principal: on the demo deployments it IS the principal.
 * `identity` — a Supabase session with a user.
 */
export type Principal = "open" | "basic" | "identity";

const PRINCIPALS: readonly string[] = ["open", "basic", "identity"];

/**
 * Did the gate authenticate this caller? Only the exact values the gate sets count; everything
 * else — including a spoofed or unknown value — is no principal.
 */
export function hasAuthenticatedPrincipal(header: string | null | undefined): boolean {
  return typeof header === "string" && PRINCIPALS.includes(header);
}
