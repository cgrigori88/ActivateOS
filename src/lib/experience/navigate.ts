/**
 * P7 Slice 4 — DETERMINISTIC GO TO. Pure, synchronous, and unable to reach anything.
 *
 * THE ORDER IS THE WHOLE SAFETY ARGUMENT (ruling 5):
 *
 *   principal → fixed PursuitQuery → existing governance/disclosure → GOVERNED ROW → NavigationTarget
 *
 * **The existence of the governed row is the authorization basis.** Route resolution happens only
 * after it, so a target is never formed for an object whose existence is undisclosable — it is not
 * built and then withheld; there was never anything to withhold. Like `explain()` and `analyze()`,
 * this module holds no database handle: a function that cannot reach the database cannot establish
 * that something exists.
 *
 * A ROUTE IS PRESENTATION METADATA, NEVER AUTHORITY. The path it emits grants nothing; the
 * destination enforces its own governance when it renders. What this module decides is only whether a
 * link may be *offered*, and to whom.
 *
 * TWO ABSENCES, NEVER CONFLATED (rulings 2 and 7):
 *   · NOT_AVAILABLE      — unauthorized OR nonexistent. Indistinguishable, by construction: this
 *                          module is never even called, because governance returned no row.
 *   · UNAVAILABLE_TARGET — existence ALREADY authorized, but the registered surface has no usable
 *                          destination. Acknowledging the object discloses nothing new, because the
 *                          principal already sees it in their governed set.
 */
import { CANONICAL_ID, DESTINATIONS, destinationKey, pathFor, type DestinationDef } from "./registry";
import type { GoToOutcome, GoToRequest, GovernedRow, SurfaceKey } from "./types";

const SURFACES: readonly SurfaceKey[] = ["canonical"];

export type GoToValidation =
  | { ok: true; request: GoToRequest; destination: DestinationDef }
  | { ok: false; detail: string };

/**
 * Validate an untrusted navigation request. `unknown` on purpose: in later slices it may arrive from
 * a transport or a model, and the type system must not be the only thing between an arbitrary object
 * and a resolution. Everything here runs BEFORE any database work — a malformed id never becomes
 * query input, and an unregistered class or surface never causes so much as a connection.
 */
export function validateGoToRequest(candidate: unknown): GoToValidation {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return { ok: false, detail: "request must be an object" };
  const r = candidate as Record<string, unknown>;

  // Unknown keys are REJECTED, not ignored. This is what makes a url, pathname, fragment, route
  // parameter, organization or label unrepresentable rather than merely unused (ruling 1).
  for (const k of Object.keys(r)) {
    if (k !== "requestVersion" && k !== "ref" && k !== "surface") return { ok: false, detail: `unknown request key ${k}` };
  }
  if (r.requestVersion !== 1) return { ok: false, detail: "requestVersion must be 1" };

  if (typeof r.surface !== "string" || !SURFACES.includes(r.surface as SurfaceKey)) {
    return { ok: false, detail: `unknown surface ${String(r.surface)}` };
  }
  const ref = r.ref as { class?: unknown; id?: unknown } | undefined;
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) return { ok: false, detail: "ref is required" };
  for (const k of Object.keys(ref)) if (k !== "class" && k !== "id") return { ok: false, detail: `unknown ref key ${k}` };
  if (typeof ref.class !== "string") return { ok: false, detail: "ref.class is required" };
  if (typeof ref.id !== "string" || !CANONICAL_ID.test(ref.id)) return { ok: false, detail: "ref.id must be a canonical uuid" };

  const destination = DESTINATIONS[destinationKey(ref.class, r.surface)];
  if (!destination) return { ok: false, detail: `unknown destination ${ref.class}@${r.surface}` };

  return { ok: true, request: { requestVersion: 1, ref: { class: destination.class, id: ref.id }, surface: destination.surface }, destination };
}

/**
 * Form the target from a row governance ALREADY admitted. By the time this runs, the recipient's
 * authority to know the object exists has been established — which is precisely why this function
 * may acknowledge the object at all.
 */
export function navigate(row: GovernedRow, request: GoToRequest, def: DestinationDef): GoToOutcome {
  // The destination must be usable for THIS recipient: every required ref present and its existence
  // authorized. A ref whose existence is unauthorized is not a usable destination input, and no
  // alternate route, diagnostic or hidden path is offered in its place (ruling 2).
  for (const ref of def.requires) {
    const cell = row.cells[ref];
    if (!cell || cell.existence !== "AUTHORIZED") return { ok: false, error: "UNAVAILABLE_TARGET" };
  }

  return {
    ok: true,
    target: {
      ref: request.ref,
      surface: request.surface,
      // Only the canonical id the caller already named reaches the path. No slug: a slug would put an
      // account name into the URL, the browser history, the referrer header and every log in between.
      path: pathFor(def, row.objectRef.id),
      label: labelFor(row, def),
    },
  };
}

/**
 * The label, governed (ruling 4). The registered cell is used ONLY if it survived disclosure for this
 * recipient; otherwise the fixed class-generic fallback, which describes the class and never the
 * object. No second read is ever performed to obtain a label — if the governed row did not already
 * carry it, the answer is the fallback.
 */
function labelFor(row: GovernedRow, def: DestinationDef): string {
  const cell = row.cells[def.labelFrom];
  const disclosed = cell && cell.existence === "AUTHORIZED" && cell.visibility !== "SUPPRESSED"
    && typeof cell.value === "string" && cell.value.length > 0;
  return disclosed ? (cell.value as string) : def.fallbackLabel;
}
