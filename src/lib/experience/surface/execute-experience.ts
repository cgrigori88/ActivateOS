import { getPool } from "@/db/client";
import { assertCanonicalSubstrate } from "@/lib/env/db-posture";
import { executePursuitQuery } from "../execute";
import { buildContextManifest, EMPTY_MANIFEST } from "../intent/context";
import { isViewKey, PLANS, type ViewKey } from "../plans";
import type { ContextManifest } from "../intent/schema";
import type { ExecutionPrincipal } from "../principal";
import { compileSurface } from "./compile";
import { assembleSurface } from "./assemble";
import type { SurfaceOutcome } from "./schema";

/**
 * P7 Slice 13 — THE CANONICAL PURSUIT-EXPERIENCE EXECUTOR.
 *
 * > **P7 owns governed experience semantics independent of interface. An adapter may transport or
 * > render those semantics; it may not redefine truth, authority, metrics, selectors, state
 * > transitions or write behavior.**
 *
 * ── WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT ───────────────────────────────────────────────
 *
 * This is an EXTRACTION, not an architecture. Everything it calls was already headless: `src/lib`
 * imports React in no file, `SurfaceResult` has always been the framework-free result, and the
 * principal already threaded end to end. The only thing living inside React was this orchestration
 * sequence — resolve context, compile, assemble — duplicated across two page components. It contains
 * no governance, no metric, no selector and no disclosure decision, and it acquires none here.
 *
 * So there is no second compiler, no second context system, no second result model and no new
 * registry. If a later change starts adding any of those to this file, the extraction boundary was
 * drawn in the wrong place.
 *
 * ── THE TWO PARAMETERS ARE THE WHOLE POINT ──────────────────────────────────────────────────────
 *
 * > **The request describes WHAT operation is requested. The trusted execution boundary establishes
 * > WHO is asking and what they may do.**
 *
 * They are separate parameters because they have separate provenance. The request is untrusted — it
 * may come from a query string, a saved definition or a model proposal, and it is deterministically
 * validated either way. The principal is unforgeable: `ExecutionPrincipal` is branded with a
 * module-private symbol, so `{ orgId: req.query.org }` neither type-checks nor passes the guard.
 *
 * The principal is REQUIRED, with no `undefined` fallback. The web route's old behaviour — pass
 * nothing and let `withTenant` find the session org — is correct for a web request and catastrophic
 * for a headless one, because a background or transport caller would silently execute as whatever
 * ambient session happened to exist. The web layer now resolves its own principal and passes it, so
 * it is an adapter like any other rather than a privileged path.
 *
 * ── WHY THE WEB CALLS THIS TOO ──────────────────────────────────────────────────────────────────
 *
 * Both page call sites were refactored onto this function. Leaving the web orchestration in place
 * beside a headless twin would mean certifying that two implementations happen to agree — and this
 * codebase has repeatedly found that an assertion about two paths agreeing is weaker than there
 * being one path. Parity is true by construction here, and the parity test proves the adapter does
 * not mutate semantics rather than proving two engines coincide.
 *
 * ── ACTIONS: PRESERVED, NOT EXPOSED ─────────────────────────────────────────────────────────────
 *
 * This function does NOT refuse ACTION-bearing specs. The Slice 9/10 web action surfaces already
 * flow through the orchestration being extracted, and refusing here would break certified product
 * behaviour to satisfy a scope boundary that is already held by other means: the first certified
 * headless vertical is read-only, and no external transport exists to call this at all. An
 * action-capable headless interface needs its own ruling, and nothing here advertises one.
 *
 * ── NO MODEL ────────────────────────────────────────────────────────────────────────────────────
 *
 * There is no provider dependency and no natural language. The model remains an OPTIONAL upstream
 * compiler — prose → untrusted proposal → deterministic validation → canonical request → this
 * function — and removing it changes neither execution semantics nor authority.
 */

/**
 * Where recipient context comes from. CLOSED, and it carries no context: it names a REGISTERED plan
 * and nothing else.
 *
 * A caller can therefore not supply a `ContextManifest`, a canonical subject id, a slot, or a
 * `PursuitQuery` of its own — the three ways a request could otherwise smuggle in identity it was
 * never entitled to. `{ kind: "NONE" }` is the honest input for a definition that needs no context,
 * and it is what an opened Slice 12 pin uses, because a persisted definition structurally cannot
 * carry a context binding.
 */
export type ContextSource =
  | { kind: "NONE" }
  | { kind: "PLAN"; planKey: ViewKey };

/**
 * WHAT experience is requested. Never WHO is asking, and never what was resolved.
 *
 * Deliberately absent, by construction rather than by validation: `ContextManifest`, any canonical
 * subject id, `ValidatedSurfaceSpec`, `CompiledIntent`, `ExecutionPrincipal`, org/user/role, any
 * `SurfaceResult`, and arbitrary query or SQL. A field that does not exist cannot be checked
 * incorrectly.
 */
export interface PursuitExperienceRequest {
  requestVersion: 1;
  /** The structural spec, UNTRUSTED. The compiler is the only thing that decides it is legal. */
  spec: unknown;
  contextSource: ContextSource;
  /** Non-authoritative audit provenance, exactly as Slice 5 defined it. */
  source: "HAND_AUTHORED" | "MODEL";
  modelId: string | null;
  promptTemplateVersion: string | null;
  /**
   * OPTIMISTIC-CONCURRENCY PRECONDITION ONLY — never authority, never selection.
   *
   * A caller that composed a spec against a context it was shown may state which context that was.
   * The compiler compares it with the context resolved NOW and refuses on mismatch, so a spec built
   * against a stale recipient context cannot silently execute against a different one. It is a
   * digest: it names no object, discloses nothing, and grants nothing. `null` means "compare against
   * the context resolved for this request", which is what a request with no prior view supplies.
   */
  boundContextDigest: string | null;
}

export const EXPERIENCE_REQUEST_VERSION = 1;

/**
 * Resolve the recipient context a request declares. Exported for ONE reason: an adapter whose
 * upstream compiler is a model must show that model the context before a spec exists to execute
 * (Slice 5 — labels and a count, never an id). It obtains the manifest here, gets a proposal, and
 * then calls `executeExperience`, which resolves context again for itself.
 *
 * That is a second governed read on the compose path, and it is the honest cost of never accepting a
 * `ContextManifest` as a request payload: the alternative — letting the adapter hand its manifest to
 * the executor — is exactly the caller-manufactured context this slice forbids. If the context moved
 * between the two reads, `boundContextDigest` makes that a refusal rather than a silent substitution.
 */
export async function resolveExperienceContext(
  source: ContextSource, principal: ExecutionPrincipal,
): Promise<{ ok: true; manifest: ContextManifest } | { ok: false; error: "CAPABILITY_DENIED" | "FAILED" | "INVALID" }> {
  if (source.kind === "NONE") return { ok: true, manifest: EMPTY_MANIFEST };
  if (!isViewKey(source.planKey)) return { ok: false, error: "INVALID" };
  const base = await executePursuitQuery(PLANS[source.planKey].plan, principal);
  // A capability denial on the context read is a capability denial for the surface: same
  // organization, same entitlement. Reporting it as anything else would describe governance falsely.
  if (!base.ok) return { ok: false, error: base.error === "CAPABILITY_DENIED" ? "CAPABILITY_DENIED" : "FAILED" };
  return { ok: true, manifest: buildContextManifest(base.result.rows) };
}

/**
 * Execute a certified experience request under an established principal.
 *
 * The returned `SurfaceOutcome` is the canonical recipient-facing result and the ONLY semantic result
 * model: a transport serializes it, and never replaces it.
 */
export async function executeExperience(
  request: PursuitExperienceRequest,
  principal: ExecutionPrincipal,
): Promise<SurfaceOutcome> {
  /**
   * THE SUBSTRATE IS PART OF THE TRUSTED BOUNDARY (Slice 13, D-S13-EXEC-CONTEXT).
   *
   * Asked FIRST, before the context plan, before any governed read, before compilation and before
   * assembly — because the thing it protects is the meaning of everything that follows. The same
   * request and the same branded principal returned a different governed row set under the owner
   * than under `app_rw`, so executing on an uncertified substrate would not be a degraded answer; it
   * would be a different one, silently.
   *
   * The refusal is an internal CONFIGURATION failure, never a governed outcome: `FAILED` is the
   * certified disposition for "this did not work", and relabelling a misconfigured runtime as
   * `NOT_AVAILABLE` would tell a recipient something false about governance. The diagnostic — which
   * role was actually present — stays in the thrown error, where tests and server logs can read it
   * and a recipient cannot.
   */
  try { await assertCanonicalSubstrate(getPool()); }
  catch { return { ok: false, error: "FAILED" }; }

  if (request.requestVersion !== EXPERIENCE_REQUEST_VERSION) return { ok: false, error: "INVALID" };

  // ── CONTEXT IS DERIVED, NEVER SUPPLIED ────────────────────────────────────────────────────────
  // For PLAN, the registered plan runs through the ordinary governed query path under THIS
  // principal, and the manifest is built from the governed rows it returned. So the recipient
  // context is a product of governed execution, not a payload — and an unregistered key is refused
  // before anything executes.
  const context = await resolveExperienceContext(request.contextSource, principal);
  if (!context.ok) return { ok: false, error: context.error };
  const manifest = context.manifest;

  const compiled = compileSurface({
    spec: request.spec,
    manifest,
    boundContextDigest: request.boundContextDigest ?? manifest.digest,
    source: request.source,
    modelId: request.source === "MODEL" ? request.modelId : null,
    promptTemplateVersion: request.source === "MODEL" ? request.promptTemplateVersion : null,
  });
  // THE COMPILER'S `detail` STOPS HERE. It is internal diagnostic material and there is no field on
  // the recipient contract that could carry it (ruling F) — the leak is unrepresentable, not merely
  // declined.
  if (!compiled.ok) return { ok: false, error: "INVALID" };

  return assembleSurface(compiled.validated, principal);
}
