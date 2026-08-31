import type { PoolClient } from "pg";
import type { QueryHit, Explanation } from "./query";

/**
 * The intent registry (P2C-0). ONE declarative table of everything the query layer can answer,
 * replacing the hand-ordered `if / else if / else` parser chain that previously lived inside the
 * palette route — where precedence was expressed by SOURCE ORDER and adding a capability meant
 * adding a branch.
 *
 * Why this exists: with three capabilities the chain was already fragile; lifecycle (P2A) and value
 * (P2B) would have made it five mutually-shadowing branches. Precedence is now an explicit integer
 * on each intent, ambiguity is a first-class outcome, and registering an intent is a data change.
 *
 * ARCHITECTURE (the contract P2C-1 will later plug into, and may not bypass):
 *
 *     natural language
 *        ↓  match()            deterministic parser — the ONLY path today
 *        ↓  (future) LLM       may emit { intentKey, slots } ONLY
 *        ↓  slot validation    against the intent's declared slots
 *        ↓  resolve()          canonical deterministic resolver — ALWAYS authoritative
 *        ↓  authorized, evidence-grounded answer
 *
 * The interpreter tier may translate intent. It never becomes authoritative for records, facts,
 * amounts, dates, routes, stakeholders, attribution, readiness or outcomes. An intent that cannot
 * be matched, or whose slots do not validate, returns UNSUPPORTED — never an invented answer.
 */

export type IntentClass = "goto" | "showme" | "explain";

/** Slot values a resolver may receive. Deliberately narrow — no free-form objects. */
export type SlotValue = string | number | boolean | null | string[];
export type Slots = Record<string, SlotValue>;

/**
 * Slot types (P2C-1 §2). `account` and `partner` are ENTITY slots: the interpreter may propose the
 * string a human typed, and canonical resolution happens afterwards inside the authorized set —
 * the model never assigns an internal id. Everything else is a scalar the validator coerces.
 */
export type SlotType = "string" | "number" | "boolean" | "string[]" | "account" | "partner";

export interface SlotSpec {
  type: SlotType;
  /** Shown to the interpreter. One line, no examples of real records. */
  description: string;
  /** Closed vocabulary. A value outside it is rejected, never coerced to the nearest member. */
  enum?: string[];
  min?: number;
  max?: number;
}

export type SlotValidation =
  | { ok: true; slots: Slots }
  | { ok: false; error: string };

const asString = (v: SlotValue): string | null => (typeof v === "string" ? v : v == null ? null : String(v));

/**
 * Validate and coerce a slot bag against an intent's declared contract (P2C-1 §2/§12).
 *
 * Strict in BOTH directions, because this is the door an interpreter tier comes through:
 *   · an undeclared slot name is REJECTED — a model cannot smuggle an operator, a filter, an org
 *     id, or a fragment of SQL into a resolver by inventing a parameter for it;
 *   · a missing required slot is REJECTED;
 *   · a value outside a declared enum is REJECTED, never snapped to the nearest member;
 *   · a value that will not coerce to the declared type is REJECTED.
 *
 * An explicit `null` on an OPTIONAL slot is legal and means "absent" — deterministic parsers emit
 * it routinely. On a required slot it is a missing slot, which is the honest reading.
 */
export function validateSlots(def: IntentDefinition, raw: Slots): SlotValidation {
  const declared = new Set([...def.requiredSlots, ...def.optionalSlots]);
  const out: Slots = {};

  for (const [key, value] of Object.entries(raw)) {
    if (!declared.has(key)) return { ok: false, error: `${def.intentKey} has no slot "${key}"` };
    if (value === null || value === undefined) { out[key] = null; continue; }

    const spec = def.slots?.[key];
    const type = spec?.type ?? "string";
    if (type === "number") {
      const n = typeof value === "number" ? value : Number(asString(value));
      if (!Number.isFinite(n)) return { ok: false, error: `slot "${key}" is not a number` };
      if (spec?.min != null && n < spec.min) return { ok: false, error: `slot "${key}" is below its minimum` };
      if (spec?.max != null && n > spec.max) return { ok: false, error: `slot "${key}" is above its maximum` };
      out[key] = n;
    } else if (type === "boolean") {
      if (typeof value === "boolean") out[key] = value;
      else {
        const s = (asString(value) ?? "").toLowerCase();
        if (s !== "true" && s !== "false") return { ok: false, error: `slot "${key}" is not a boolean` };
        out[key] = s === "true";
      }
    } else if (type === "string[]") {
      const arr = Array.isArray(value) ? value.map(String) : String(value).split(",").map((s) => s.trim()).filter(Boolean);
      if (spec?.enum) {
        const bad = arr.find((v) => !spec.enum!.includes(v));
        if (bad != null) return { ok: false, error: `slot "${key}" does not accept "${bad}"` };
      }
      out[key] = arr;
    } else {
      // string / account / partner — entity slots stay strings here; canonical resolution is a
      // separate, scope-bound step that this function deliberately does not perform.
      const s = asString(value);
      if (s == null || s.trim() === "") return { ok: false, error: `slot "${key}" is empty` };
      if (spec?.enum && !spec.enum.includes(s)) return { ok: false, error: `slot "${key}" does not accept "${s}"` };
      out[key] = s;
    }
  }

  for (const req of def.requiredSlots) {
    if (out[req] === undefined || out[req] === null) return { ok: false, error: `${def.intentKey} is missing a required slot` };
  }
  return { ok: true, slots: out };
}

/**
 * What a resolver produces. `hits` for list answers, `explanation` for evidence-bound answers.
 *
 * `significance` and `nextAction` exist so an executive-facing surface can lead with what the
 * answer MEANS commercially and what to do about it — without any surface inventing either. Both
 * are optional and both are frequently absent on purpose: a resolver that has no honest single
 * figure (a list of ledger changes; a partner's activation profile) supplies none, and the UI shows
 * none. An empty slot is the correct output when the canonical data does not support the claim.
 */
export interface IntentResult {
  hits?: QueryHit[];
  explanation?: Explanation;
  /** Human-readable read-back of what the query was understood to mean. */
  interpreted?: string;
  /** Honest failure text when the intent resolved but the record holds no answer. */
  note?: string;
  /**
   * What is commercially at stake in this answer — computed by the resolver from the same rows it
   * returned, never derived by a surface and never estimated. `basis` states what the figure sums,
   * because an unexplained total is exactly the confident-garbage problem.
   */
  significance?: { label: string; value: string; basis: string } | null;
  /** The single most useful next step, as a deep link into a canonical room. */
  nextAction?: { label: string; href: string } | null;
}

/** Everything a resolver is allowed to know. Scope is narrowing-only and never widened here. */
export interface ResolveContext {
  db: PoolClient;
  orgId: string;
  /** The authorized company set, already narrowed. `null` = the full RLS-scoped set (no narrowing). */
  companyIds: string[] | null;
}

export interface IntentDefinition {
  /** Stable identifier — also the key an interpreter tier may emit. */
  intentKey: string;
  /** Which retrieval class this intent answers within. */
  intentClass: IntentClass;
  /** Higher wins when several intents match. Explicit — never source order. */
  precedence: number;
  description: string;
  /** Slot names the resolver requires; a match missing any of these is not a match. */
  requiredSlots: string[];
  /** Slot names the resolver may use when present. */
  optionalSlots: string[];
  /**
   * Typed schema for each slot (P2C-1 §2). This is what an interpreter tier is shown and what its
   * output is validated against — the registry stays the single source of supported intents, so
   * there is no second catalog to drift. A slot with no spec validates as a plain string.
   */
  slots?: Record<string, SlotSpec>;
  /**
   * Constraint families this intent covers, for compound-query routing (P2C-1 §7). Declared so the
   * compound resolver can say WHICH part of a multi-constraint request it could not represent.
   */
  families?: string[];
  /**
   * Does this intent read company-scoped data? Scope-bearing intents receive the narrowed
   * `companyIds`; scope-free intents (pure explanations of a named record) still run under RLS.
   */
  scope: "COMPANY_SCOPED" | "ORG_SCOPED";
  /** Deterministic parser. Returns slots when this utterance is this intent, else null. */
  match: (q: string) => Slots | null;
  /** The canonical resolver. Always authoritative. */
  resolve: (ctx: ResolveContext, slots: Slots) => Promise<IntentResult>;
  /** Utterances this intent is expected to answer — used by the registry's own tests. */
  examples: string[];
}

/** The outcome of routing an utterance. Ambiguity and unsupported are first-class. */
export type RoutingOutcome =
  | { kind: "MATCHED"; intent: IntentDefinition; slots: Slots }
  | { kind: "AMBIGUOUS"; candidates: IntentDefinition[]; note: string }
  | { kind: "UNSUPPORTED"; note: string };

const REGISTRY = new Map<string, IntentDefinition>();

export function registerIntent(def: IntentDefinition): void {
  if (REGISTRY.has(def.intentKey)) throw new Error(`duplicate intentKey: ${def.intentKey}`);
  REGISTRY.set(def.intentKey, def);
}

export function listIntents(): IntentDefinition[] {
  return [...REGISTRY.values()].sort((a, b) => b.precedence - a.precedence || a.intentKey.localeCompare(b.intentKey));
}

export function getIntent(key: string): IntentDefinition | undefined {
  return REGISTRY.get(key);
}

/** Slots satisfy the intent's declared contract (every required slot present and non-null). */
export function slotsValid(def: IntentDefinition, slots: Slots): boolean {
  return def.requiredSlots.every((s) => slots[s] !== undefined && slots[s] !== null);
}

/**
 * Route an utterance to exactly one intent — deterministically.
 *
 *  1. every intent in the class gets `match()`;
 *  2. matches whose slots do not satisfy the declared contract are discarded;
 *  3. the highest `precedence` wins;
 *  4. a TIE at the top precedence is AMBIGUOUS — an honest answer, never a coin flip on
 *     source order. Ties are a registry design error and the note says so.
 *
 * Registration order is irrelevant: `listIntents()` sorts by precedence then key.
 */
export function routeIntent(q: string, intentClass: IntentClass): RoutingOutcome {
  const candidates: { def: IntentDefinition; slots: Slots }[] = [];
  for (const def of listIntents()) {
    if (def.intentClass !== intentClass) continue;
    let slots: Slots | null = null;
    try { slots = def.match(q); } catch { slots = null; }
    if (!slots) continue;
    if (!slotsValid(def, slots)) continue;
    candidates.push({ def, slots });
  }
  if (candidates.length === 0) return { kind: "UNSUPPORTED", note: "This question is not supported yet." };

  const top = candidates[0].def.precedence;
  const tied = candidates.filter((c) => c.def.precedence === top);
  if (tied.length > 1) {
    return {
      kind: "AMBIGUOUS",
      candidates: tied.map((c) => c.def),
      note: `That could mean ${tied.length} different things (${tied.map((c) => c.def.intentKey).join(", ")}) — narrow the question.`,
    };
  }
  return { kind: "MATCHED", intent: candidates[0].def, slots: candidates[0].slots };
}

/**
 * Route AND resolve. The single entry point every surface uses — the palette route, the Ask
 * surface, and (later) an interpreter tier that supplies `{intentKey, slots}` instead of prose.
 */
export async function resolveUtterance(
  ctx: ResolveContext, q: string, intentClass: IntentClass,
): Promise<IntentResult & { intentKey: string | null; outcome: RoutingOutcome["kind"] }> {
  const routed = routeIntent(q, intentClass);
  if (routed.kind !== "MATCHED") return { intentKey: null, outcome: routed.kind, note: routed.note };
  const result = await routed.intent.resolve(ctx, routed.slots);
  return { ...result, intentKey: routed.intent.intentKey, outcome: "MATCHED" };
}

/**
 * Resolve from an already-structured intent + slots — the ONLY door an interpreter tier (P2C-1)
 * may use. It cannot reach a resolver that is not registered, cannot skip slot validation, and
 * cannot supply an answer of its own: the canonical resolver produces every answer.
 */
export async function resolveStructured(
  ctx: ResolveContext, intentKey: string, slots: Slots,
): Promise<IntentResult & { intentKey: string | null; outcome: RoutingOutcome["kind"] }> {
  const def = REGISTRY.get(intentKey);
  if (!def) return { intentKey: null, outcome: "UNSUPPORTED", note: `Unsupported: unknown intent ${intentKey}.` };
  // Full contract validation, not just presence: an undeclared slot name, an out-of-vocabulary
  // enum value, or an uncoercible type is rejected here — before any resolver runs.
  const checked = validateSlots(def, slots);
  if (!checked.ok) {
    const note = /missing a required slot/.test(checked.error)
      ? `Unsupported: ${intentKey} is missing a required slot.`
      : `Unsupported: ${checked.error}.`;
    return { intentKey: null, outcome: "UNSUPPORTED", note };
  }
  const result = await def.resolve(ctx, checked.slots);
  return { ...result, intentKey, outcome: "MATCHED" };
}
