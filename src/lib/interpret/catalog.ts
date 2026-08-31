import { listIntents, type IntentClass, type IntentDefinition } from "@/lib/search/registry";

/**
 * The model-visible catalog (P2C-1 §2/§3).
 *
 * This is the ONLY description of PursuitOS the interpreter ever receives, and it is DERIVED from
 * the intent registry rather than written beside it — so there is no second list of supported
 * intents to drift, and registering an intent is still a single data change.
 *
 * What it contains: intent keys, one-line descriptions, slot names with their types and closed
 * vocabularies, and a couple of example utterances per intent.
 *
 * What it deliberately does NOT contain, and must never contain:
 *   · any commercial record — no account, partner, amount, date, person or pursuit;
 *   · the operator's scoped account list (only its SIZE reaches the model);
 *   · table names, column names, or anything else that would let a model reason about storage.
 *
 * That is the structural answer to "the model is only interpreting, so it is safe to show it the
 * data": we never show it the data at all. A prompt-injection attempt in the user's own text can
 * therefore only cause the model to emit some intent key and slots, both of which are validated
 * against this same registry and then executed by a deterministic resolver under RLS.
 */

/** Slots that exist for the deterministic parser's own bookkeeping and are never offered to a model. */
const INTERNAL_SLOTS = new Set(["q", "interpreted"]);

export interface CatalogSlot {
  name: string;
  type: string;
  required: boolean;
  description: string;
  enum?: string[];
  min?: number;
  max?: number;
}

export interface CatalogIntent {
  intentKey: string;
  intentClass: IntentClass;
  description: string;
  slots: CatalogSlot[];
  examples: string[];
}

export function catalogFor(def: IntentDefinition): CatalogIntent {
  const names = [...def.requiredSlots, ...def.optionalSlots].filter((n) => !INTERNAL_SLOTS.has(n));
  return {
    intentKey: def.intentKey,
    intentClass: def.intentClass,
    description: def.description,
    slots: names.map((name) => {
      const spec = def.slots?.[name];
      return {
        name,
        type: spec?.type ?? "string",
        required: def.requiredSlots.includes(name),
        description: spec?.description ?? name,
        ...(spec?.enum ? { enum: spec.enum } : {}),
        ...(spec?.min != null ? { min: spec.min } : {}),
        ...(spec?.max != null ? { max: spec.max } : {}),
      };
    }),
    examples: def.examples.slice(0, 2),
  };
}

/** The full catalog, highest precedence first — the same order `routeIntent` resolves in. */
export function buildCatalog(intentClass?: IntentClass): CatalogIntent[] {
  return listIntents()
    .filter((d) => intentClass == null || d.intentClass === intentClass)
    .map(catalogFor);
}

/** Every intent key the interpreter is permitted to emit. Used to reject invented keys early. */
export function allowedIntentKeys(intentClass?: IntentClass): string[] {
  return buildCatalog(intentClass).map((c) => c.intentKey);
}

/**
 * Render the catalog as compact text for the prompt. Compact on purpose: the interpreter is a
 * cheap-tier classifier, and every token here is a token of budget and latency on a keystroke path.
 */
export function catalogText(intentClass?: IntentClass): string {
  const lines: string[] = [];
  for (const c of buildCatalog(intentClass)) {
    const slots = c.slots.length === 0
      ? "no slots"
      : c.slots.map((s) => {
          const bits = [`${s.name}:${s.type}${s.required ? "!" : ""}`];
          if (s.enum) bits.push(`one of {${s.enum.join("|")}}`);
          if (s.min != null || s.max != null) bits.push(`range ${s.min ?? "-"}..${s.max ?? "-"}`);
          return `${bits.join(" ")} — ${s.description}`;
        }).join("; ");
    lines.push(`- ${c.intentKey} [${c.intentClass}] ${c.description}`);
    lines.push(`    slots: ${slots}`);
    if (c.examples.length) lines.push(`    e.g. ${c.examples.map((e) => `"${e}"`).join(" / ")}`);
  }
  return lines.join("\n");
}

/** A stable fingerprint of the catalog, stored beside an interpretation so drift is detectable. */
export function catalogVersion(): string {
  const keys = buildCatalog().map((c) => `${c.intentKey}:${c.slots.map((s) => s.name).join(",")}`).join("|");
  let h = 5381;
  for (let i = 0; i < keys.length; i++) h = ((h << 5) + h + keys.charCodeAt(i)) >>> 0;
  return `v1-${h.toString(16)}`;
}
