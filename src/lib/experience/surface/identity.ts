/**
 * P7 Slice 8 — DERIVED IDENTITY. Pure, synchronous, and execution-only.
 *
 * > **A component may consume an explicitly exported governed identity handle from another certified
 * > component. It may not consume raw rows, hidden fields, rendered text or arbitrary result values.**
 *
 * ── WHY THIS IS NOT A ContextManifest (ruling B) ────────────────────────────────────────────────
 *
 * > **Recipient context is available before composition. Derived identity is an execution artifact
 * > created after a governed upstream operation. They may share resolver mechanics; they are not the
 * > same semantic object.**
 *
 * The temptation is to build a one-slot `ContextManifest` and be done: the resolver would work, the
 * compiler would accept it, and nothing would visibly break. What it would cost is the DISTINCTION —
 * recipient context is something the recipient already had and a provider may be told about, and this
 * is something that did not exist when the request was made. Collapsing them would make
 * provider-visibility a matter of remembering which instance you were holding.
 *
 * So this is a different type with no `slots`, and it is therefore **not assignable** to `toPrompt`.
 * That is the structural half of the guard; `toPrompt` also checks `origin` at runtime, so the guard
 * survives a caller that arrived through untyped JSON. Both halves are proven by the suite.
 *
 * IT SHARES THE RESOLVER, NOT A SECOND ALGORITHM. `asResolutionContext()` hands the certified
 * `resolveContextRef` exactly what it needs — a digest and the ordered ids — so there is one identity
 * resolution algorithm in this codebase, not two that must be kept in agreement forever.
 *
 * WHAT IT CANNOT DO. It cannot be appended to or merge into the recipient manifest, cannot be
 * persisted, cannot be rendered, and confers NO authority: it names a candidate, and every downstream
 * component still executes through its own certified P6/P7 boundary under the current principal.
 */
import { createHash } from "node:crypto";
import { DESTINATIONS, destinationKey } from "../registry";
import { PLANS, isSelectorKey, type SelectorKey, type ViewKey } from "../plans";
import type { ResolutionContext } from "../intent/schema";
import type { ComponentKey } from "./schema";
import type { GovernedResultSet, GovernedRow } from "../types";

/**
 * One governed identity, exported by one certified component, for one surface execution.
 *
 * WHAT IS DELIBERATELY ABSENT: the row. There is no `cells`, no metric, no account field, no status,
 * no sort value, no omission and no count — so a downstream component cannot inspect an upstream
 * payload, because it was never handed one. **Components export identity capability, not rows.**
 */
export interface DerivedIdentityContext {
  /** Distinguishes this from recipient context at runtime as well as in the type system. */
  origin: "DERIVED";
  /** WHICH certified component produced it. */
  sourceComponent: ComponentKey;
  /** The exact governed result set it came from — a bind is bound to that result, not to a row. */
  sourceResultDigest: string;
  selector: SelectorKey;
  /** The canonical id and the Slice 4 label rule. Internal: never rendered, never sent to a provider. */
  identity: { class: "pursuit"; id: string; label: string };
  /** Binds a downstream reference to exactly this derivation. */
  digest: string;
}

/** The label rule is Slice 4's, unchanged: a disclosed registered cell, or the class-generic fallback. */
function labelOf(row: GovernedRow): string {
  const def = DESTINATIONS[destinationKey("pursuit", "canonical")];
  const cell = row.cells[def.labelFrom];
  const disclosed = cell && cell.existence === "AUTHORIZED" && cell.visibility !== "SUPPRESSED"
    && typeof cell.value === "string" && cell.value.length > 0;
  return disclosed ? (cell.value as string) : def.fallbackLabel;
}

/** May this plan export identity for this selector? Absent metadata means NO (ruling F). */
export function mayExportIdentity(view: ViewKey, selector: unknown): boolean {
  if (!isSelectorKey(selector)) return false;
  const declared = PLANS[view].identityExport;
  return !!declared && declared.selectors.includes(selector);
}

/**
 * Apply a registered selector to a governed result set.
 *
 * IT READS NO CELL. `first` takes element zero of the ordered rows the certified operation already
 * produced — so no value, hidden or disclosed, influences the choice beyond the plan's own certified
 * ordering. A suppressed value cannot promote a row here because it could not promote it there.
 *
 * `null` means THERE WAS NOTHING TO SELECT. It is not an error, not a fallback, and the caller must
 * not turn it into one: no nearest row, no default, no previous context.
 */
export function selectIdentity(
  result: GovernedResultSet, selector: SelectorKey, sourceComponent: ComponentKey,
): DerivedIdentityContext | null {
  if (selector !== "first") return null;
  const row = result.rows[0];
  if (!row) return null;

  const identity = { class: "pursuit" as const, id: row.objectRef.id, label: labelOf(row) };
  // The result's identity, not its contents: the plan digest plus the ORDERED governed ids. Two
  // result sets that would select differently cannot share this value.
  const sourceResultDigest = createHash("sha256")
    .update(JSON.stringify(["p7s8.result", result.planDigest, result.rows.map((r) => r.objectRef.id)]))
    .digest("hex").slice(0, 16);
  const digest = createHash("sha256")
    .update(JSON.stringify(["p7s8.derived", sourceComponent, sourceResultDigest, selector, identity.id]))
    .digest("hex").slice(0, 16);

  return { origin: "DERIVED", sourceComponent, sourceResultDigest, selector, identity, digest };
}

/**
 * The narrow adapter at the execution boundary (ruling B): hand the CERTIFIED resolver exactly what
 * it needs. One slot, because a derived context names one candidate — `{fromContext: 1}` resolves to
 * nothing here, exactly as it would against any one-slot context.
 */
export function asResolutionContext(derived: DerivedIdentityContext): ResolutionContext {
  return { digest: derived.digest, ids: Object.freeze([derived.identity.id]) };
}

/**
 * THE EXECUTION DIGEST (ruling E). Domain-separated, over the ordered dynamic-binding facts only.
 *
 * The canonical identity participates in the HASH INPUT and is not serialized by doing so — the
 * output is 16 hex characters. This is provenance and replay identity: **not authority, not a bearer
 * token, and not a substitute for current governance**, which every downstream component re-runs.
 *
 * A surface with no dynamic binding produces `null` and keeps its Slice 7 provenance byte-for-byte.
 */
export function executionDigest(
  bindings: readonly { consumer: ComponentKey; derived: DerivedIdentityContext }[],
): string | null {
  if (bindings.length === 0) return null;
  return createHash("sha256")
    .update(JSON.stringify(["p7s8.execution", bindings.map((b) => [
      b.consumer, b.derived.sourceComponent, b.derived.sourceResultDigest,
      b.derived.selector, b.derived.identity.id,
    ])]))
    .digest("hex").slice(0, 16);
}
