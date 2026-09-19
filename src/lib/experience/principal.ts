/**
 * P7 — WHO IS ASKING. The organization is resolved from a credential, never named by a request.
 *
 * THE INVARIANT THIS ENFORCES IN CODE: *interface possession does not confer authority.* The
 * execution boundary previously accepted `{ orgId }`, which a transport could have filled from
 * caller input — the boundary could not tell a credential-derived org from a query parameter, so
 * the transport would have carried the whole burden. It does not any more: the boundary accepts an
 * `ExecutionPrincipal`, and an `ExecutionPrincipal` cannot be constructed from plain data.
 *
 * HOW THAT IS ENFORCED, not merely asked for. The brand below is a module-private symbol. Nothing
 * outside this file can produce a value of that type — `{ orgId: req.query.org }` does not
 * type-check and does not pass the runtime guard. The only ways to obtain one are:
 *
 *   • the WEB PATH — no principal at all. `executePursuitQuery` then resolves the organization
 *     through `withTenant`, from the authenticated application session, exactly as every screen does.
 *   • a FUTURE API/MCP transport — which must add a resolver here that derives the org from its own
 *     authenticated credential (the MCP surface already resolves an org from an API key). It is not
 *     written yet, because Slice 1 ships no such transport and speculative infrastructure is worse
 *     than none.
 *   • `testFixturePrincipal` — refused unless the process is explicitly a test run, and structurally
 *     barred from any production transport by a test that fails if `src/app` ever imports it.
 */

const BRAND: unique symbol = Symbol("p7.execution-principal");

export type PrincipalSource = "web-session" | "api-credential" | "test-fixture";

/**
 * An organization that a trusted resolver has established. Opaque by construction: the brand is a
 * module-private symbol, so this type cannot be forged from request data.
 */
export interface ExecutionPrincipal {
  readonly [BRAND]: true;
  readonly orgId: string;
  readonly source: PrincipalSource;
}

function mint(orgId: string, source: PrincipalSource): ExecutionPrincipal {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(orgId)) {
    throw new Error("an execution principal needs a canonical organization id");
  }
  return { [BRAND]: true, orgId, source };
}

/**
 * TEST ONLY. A suite has no web session and must still execute AS a named organization — the org it
 * planted itself. This is refused outside a test run, so it cannot become a production transport
 * that takes an org from its caller.
 *
 * `NODE_ENV=test` is set by the unit runner; `P7_TEST_PRINCIPAL=allow` is the explicit opt-in a
 * database-backed verifier sets for itself. Neither is set on a deployment.
 */
export function testFixturePrincipal(orgId: string): ExecutionPrincipal {
  const allowed = process.env.NODE_ENV === "test" || process.env.P7_TEST_PRINCIPAL === "allow";
  if (!allowed) {
    throw new Error(
      "testFixturePrincipal is refused outside a test run — an organization must come from a credential, never from caller input",
    );
  }
  return mint(orgId, "test-fixture");
}

/**
 * THE WEB ADAPTER'S RESOLVER (Slice 13, ruling B).
 *
 * Slice 1 recorded that the web path passes no principal and lets `withTenant` resolve the org from
 * the authenticated session. That was right while the web route WAS the execution boundary. Once the
 * canonical executor requires a branded principal — so that no headless caller can ever inherit an
 * ambient session — the web layer needs to mint one the same way any other transport must: from its
 * own already-authenticated context, never from request data.
 *
 * The org still comes from exactly where it came from before (the session, via `withTenant`), so
 * this changes no authority; it only makes the web path state its identity explicitly instead of
 * relying on the executor to go and find one.
 *
 * The import is dynamic so this module stays pure for unit tests that never touch a database.
 */
export async function webSessionPrincipal(): Promise<ExecutionPrincipal> {
  const { withTenant } = await import("@/lib/db/tenant");
  const orgId = await withTenant(async (_db, org) => org);
  return mint(orgId, "web-session");
}

/**
 * THE API-CREDENTIAL RESOLVER (Slice 14).
 *
 * The transport this module's header anticipated in Slice 1 — *"a FUTURE API/MCP transport, which
 * must add a resolver here that derives the org from its own authenticated credential"* — and the
 * `"api-credential"` source has been sitting unused ever since, waiting for it.
 *
 * `orgId` comes from the API key's own record, resolved server-side by `resolve_api_key()` before
 * any tenant scope exists. It is never a request field: an MCP caller cannot name an organization,
 * because the credential already names one. **Selection and authority are the same act — issuing
 * the key.**
 *
 * NO HUMAN USER IS SYNTHESIZED. An API key is a service credential bound to an organization, and
 * `ExecutionPrincipal` is organization-scoped by construction, so the shapes already match. Inventing
 * a person here to satisfy a type would be inventing authority.
 */
export function apiCredentialPrincipal(orgId: string): ExecutionPrincipal {
  return mint(orgId, "api-credential");
}

/** Read-only accessor, so callers need no knowledge of the brand. */
export const principalOrgId = (p: ExecutionPrincipal): string => p.orgId;
