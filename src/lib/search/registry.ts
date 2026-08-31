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

/** What a resolver produces. `hits` for list answers, `explanation` for evidence-bound answers. */
export interface IntentResult {
  hits?: QueryHit[];
  explanation?: Explanation;
  /** Human-readable read-back of what the query was understood to mean. */
  interpreted?: string;
  /** Honest failure text when the intent resolved but the record holds no answer. */
  note?: string;
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
  if (!slotsValid(def, slots)) {
    return { intentKey: null, outcome: "UNSUPPORTED", note: `Unsupported: ${intentKey} is missing a required slot.` };
  }
  const result = await def.resolve(ctx, slots);
  return { ...result, intentKey, outcome: "MATCHED" };
}
