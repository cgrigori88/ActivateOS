/**
 * P7 Slice 5 — THE CONTEXT MANIFEST (ruling 2).
 *
 * Built by deterministic code **before the model is called**, from material the recipient is ALREADY
 * authorized to see: rows a governed execution returned for this principal. Nothing is looked up here
 * and nothing is discovered — a manifest can only narrow what the caller already had on screen.
 *
 * WHY IT IS IMMUTABLE AND DIGESTED. A proposal says `{fromContext: 2}`. If that index could be
 * resolved against a *different* manifest than the one the model was shown, an attacker who could
 * influence ordering could retarget a reference at an object the user never had. So the digest covers
 * the ORDERED slots **and their ids**, the proposal is bound to exactly one manifest, and a mismatch
 * refuses rather than resolving.
 *
 * THE IDS NEVER REACH THE MODEL. `toPrompt()` is the only shape that leaves this module for a prompt,
 * and it carries labels and a count — no identifier the model could echo back, and therefore no way
 * for the model to name an object it was not given.
 */
import { createHash } from "node:crypto";
import { DESTINATIONS, destinationKey } from "../registry";
import type { ContextManifest, ContextSlot, ResolutionContext } from "./schema";
import type { GovernedRow } from "../types";

/** The label rule is Slice 4's, unchanged: a disclosed registered cell, or the class-generic fallback. */
function labelOf(row: GovernedRow): string {
  const def = DESTINATIONS[destinationKey("pursuit", "canonical")];
  const cell = row.cells[def.labelFrom];
  const disclosed = cell && cell.existence === "AUTHORIZED" && cell.visibility !== "SUPPRESSED"
    && typeof cell.value === "string" && cell.value.length > 0;
  return disclosed ? (cell.value as string) : def.fallbackLabel;
}

/**
 * Build the manifest from governed rows. The caller passes rows it just received from the certified
 * boundary for THIS principal — so every slot is, by construction, already disclosable to them.
 */
export function buildContextManifest(rows: readonly GovernedRow[]): ContextManifest {
  const slots: ContextSlot[] = rows.map((r) => ({ class: "pursuit", label: labelOf(r) }));
  const ids = rows.map((r) => r.objectRef.id);
  // The digest covers order, labels AND ids: reordering or substituting produces a different manifest.
  const digest = createHash("sha256")
    .update(JSON.stringify(ids.map((id, i) => [i, id, slots[i].class, slots[i].label])))
    .digest("hex").slice(0, 16);
  return { manifestVersion: 1, origin: "RECIPIENT", slots, digest, ids: Object.freeze([...ids]) };
}

/** The empty manifest. EXPLAIN and GO_TO are simply unavailable against it — there is nothing to name. */
export const EMPTY_MANIFEST: ContextManifest = buildContextManifest([]);

/**
 * What the model is shown. Labels and a count — never an id (ruling 2), never a governed value beyond
 * the already-disclosed label, never an organization.
 */
export function toPrompt(manifest: ContextManifest): { count: number; slots: ContextSlot[] } {
  // THE RUNTIME HALF OF THE SLICE 8 GUARD. The type already refuses a `DerivedIdentityContext` — it
  // has no `slots` — but a structural guard that only exists in the type system disappears the moment
  // something reaches this from untyped JSON. An execution-derived identity must never be describable
  // to a provider, so this refuses rather than serializing anything it was not certified to show.
  if (manifest.origin !== "RECIPIENT") {
    throw new Error("only recipient context may be described to a provider");
  }
  return { count: manifest.slots.length, slots: manifest.slots.map((s) => ({ class: s.class, label: s.label })) };
}

/**
 * Resolve a reference against EXACTLY the manifest it was bound to. Returns null — never a guess, and
 * never a neighbouring slot — for an out-of-range index, a non-integer, or a digest mismatch.
 */
export function resolveContextRef(
  manifest: ResolutionContext, boundDigest: string, index: unknown,
): string | null {
  if (manifest.digest !== boundDigest) return null;                       // stale or substituted context
  if (typeof index !== "number" || !Number.isInteger(index)) return null;
  if (index < 0 || index >= manifest.ids.length) return null;
  return manifest.ids[index];
}
