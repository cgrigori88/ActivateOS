import type { PoolClient } from "pg";
import {
  routeIntent, resolveStructured, validateSlots, getIntent,
  type IntentClass, type Slots, type IntentResult,
} from "@/lib/search/registry";
import "@/lib/search/intents";   // registers every intent (side-effect import)
import { classifyIntent, type QueryHit, type Explanation } from "@/lib/search/query";
import { interpret, type Interpretation, type InterpretTransport } from "./interpreter";
import { resolveEntitySlots } from "./entities";
import { catalogVersion } from "./catalog";

/**
 * THE answer stack (P2C-1 §1/§10/§12). ⌘K and Ask both call this; there is one interpretation
 * tier and one resolver tier, not two AI systems that will drift apart.
 *
 *   natural language
 *     → scope (already narrowed by the caller)
 *     → deterministic registry     ← tried FIRST, always
 *     → LLM interpreter            ← only where the deterministic parser found nothing
 *     → schema validation
 *     → canonical entity resolution, inside the authorized set
 *     → deterministic resolver     ← produces EVERY record, amount, date and state
 *     → authorized, evidence-grounded answer
 *
 * THE ORDERING IS THE SAFETY PROPERTY. Because the model is consulted only after the deterministic
 * registry has already declined, the interpreter can add coverage but is structurally incapable of
 * subtracting reliability: no query that worked before can start failing because a model was
 * introduced, and no model outage can take a working query offline (§12). It also keeps the model
 * off the hot path for everything the parsers already handle, which is most of the volume (§16).
 *
 * The prose in an answer is composed HERE, from the resolver's own read-back and note. No model
 * writes any part of it. §8 permits a paraphrasing renderer over supplied fields; we deliberately
 * do not build one, so there is no synthesis surface to police.
 */

export type AnswerPath = "GOTO" | "DETERMINISTIC" | "INTERPRETED";
export type AnswerOutcome = "MATCHED" | "AMBIGUOUS" | "UNSUPPORTED" | "UNKNOWN";

export interface AnswerEnvelope {
  question: string;
  intentClass: IntentClass;
  outcome: AnswerOutcome;
  path: AnswerPath;
  intentKey: string | null;
  /** The validated slots the resolver actually ran on — never the model's raw output. */
  slots: Slots | null;
  /** The resolver's own read-back of what the query was understood to mean. */
  interpreted: string | null;
  /** One composed line. Assembled from resolver output; no model authored any of it. */
  answer: string;
  hits: QueryHit[];
  explanation: Explanation | null;
  /** One short question, when the request genuinely admits more than one reading. */
  clarification: string | null;
  scopeNote: string;
  /** The canonical records this answer stands on — hrefs, for audit without storing payloads. */
  recordIds: string[];
  grounding: string[];
  latency: { interpretMs: number | null; resolveMs: number; totalMs: number };
  model: string | null;
  /** Set when a model interpretation was thrown away. Diagnostic, never shown as an answer. */
  rejection: string | null;
}

export interface AnswerOptions {
  /** Force a retrieval class. ⌘K knows it from the keystroke; Ask classifies. */
  intentClass?: IntentClass;
  /** Authorized company set. `null` = no narrowing. Passed straight to resolvers. */
  companyIds?: string[] | null;
  /** Tenant-supplied model key (BYO-model) — the interpretation runs on their contract. */
  apiKey?: string | null;
  /** Skip the model entirely (used by the verification suite to measure deterministic coverage). */
  deterministicOnly?: boolean;
  /** Provider seam (§13). Injected by the verification suite to drive the contract deterministically. */
  transport?: InterpretTransport;
}

/** §13: the interpreter is a replaceable tier behind the existing provider seam, and it is gated. */
export function interpreterEnabled(): boolean {
  const v = (process.env.INTERPRETER_ENABLED ?? "on").trim().toLowerCase();
  return v === "true" || v === "1" || v === "on" || v === "yes";
}

/**
 * Retrieval-class classification, registry-aware (P2C-1).
 *
 * `classifyIntent` is a keyword heuristic: an EXPLAIN anchor at the front of the sentence, or one
 * of a fixed token list for SHOW ME, else GO TO. That list was written when three intents existed
 * and it does not know about the ones added since — so on the Ask surface, where no class is
 * supplied by the keystroke, "What should I focus on today?" was classified as NAVIGATION, searched
 * for an account called "What should I focus on today", and honestly reported finding none. The
 * intent existed; nothing ever asked it.
 *
 * The fix is to let the registry answer the question it is already able to answer: if a registered
 * parser matches the utterance, that is far better evidence of its class than a token list. The
 * heuristic still goes first (it is free, and its EXPLAIN anchor is a genuinely good signal); the
 * registry only ever promotes GO TO to something more specific, never demotes.
 *
 * `record.explain` is excluded from the promotion because its parser matches EVERY utterance — it
 * is the EXPLAIN catch-all. Including it would classify every typed character as an explanation and
 * destroy navigation.
 */
export function classifyForAnswer(q: string): IntentClass {
  const base = classifyIntent(q);
  if (base !== "goto") return base;
  if (routeIntent(q, "showme").kind === "MATCHED") return "showme";
  const ex = routeIntent(q, "explain");
  if (ex.kind === "MATCHED" && ex.intent.intentKey !== "record.explain") return "explain";
  return "goto";
}

const scopeNoteFor = (companyIds: string[] | null): string =>
  companyIds == null
    ? "Whole book — no ecosystem scope is active."
    : companyIds.length === 0
      ? "The active ecosystem scope contains no accounts, so nothing was read."
      : `Narrowed to the ${companyIds.length} account(s) in the active ecosystem scope.`;

/** Compose the answer line from resolver output alone. Deterministic, and never a model's words. */
function compose(result: IntentResult, outcome: AnswerOutcome, clarification: string | null): string {
  if (outcome === "AMBIGUOUS") return clarification ?? "That could mean more than one thing — narrow the question.";
  if (outcome === "UNSUPPORTED") return result.note ?? "That question is not supported yet.";
  if (result.explanation) {
    // ALL the explanation's lines, not just the first. Showing one line made "why is Globex routed
    // through WWT?" answer "Recommended: CDW" — true, and read as though the answer were CDW, when
    // the very next line says the human SELECTED WWT. An explanation whose lines qualify each
    // other cannot be truncated to its first line without changing what it says.
    const lines = result.explanation.lines.slice(0, 4).map((l) => `${l.label}: ${l.value}`).join(" · ");
    return `${result.explanation.subtitle}${lines ? ` ${lines}` : ""}`.trim();
  }
  const n = result.hits?.length ?? 0;
  if (n === 0) return result.note ?? "No matching records.";
  return `${n} result${n === 1 ? "" : "s"}${result.note ? ` — ${result.note}` : "."}`;
}

const groundingOf = (r: IntentResult): string[] => r.explanation?.grounding ?? [];
// Deduplicated: several hits legitimately point at one room (six blocker families all live on
// /motions), and a provenance list that repeats the same link six times reads as six records.
const idsOf = (r: IntentResult): string[] => [...new Set((r.hits ?? []).map((h) => h.href))].slice(0, 25);

/** GO TO: pure entity navigation. No model, ever — "Globex" must not cost a round trip (§16). */
async function goto(db: PoolClient, orgId: string, q: string, companyIds: string[] | null): Promise<QueryHit[]> {
  const pat = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const scoped = companyIds != null;
  const [accounts, partners] = await Promise.all([
    db.query<{ id: string; legal_name: string; industry: string | null }>(
      `select c.id, c.legal_name, c.industry from companies c
        where c.legal_name ilike $2 and ($4::boolean is false or c.id = any($3))
          and (exists (select 1 from pursuits p where p.account_id = c.id and p.org_id = $1)
            or exists (select 1 from revenue_motions m where m.company_id = c.id and m.org_id = $1)
            or exists (select 1 from campaigns ca where ca.company_id = c.id and ca.org_id = $1)
            or exists (select 1 from population_members pm join account_populations ap on ap.id = pm.population_id
                        where pm.company_id = c.id and ap.org_id = $1))
        order by c.legal_name limit 5`, [orgId, pat, companyIds ?? [], scoped]),
    db.query<{ id: string; name: string; partner_type: string | null }>(
      `select id, name, partner_type from partners where org_id = $1 and name ilike $2 order by name limit 5`, [orgId, pat]),
  ]);
  return [
    ...accounts.rows.map((r) => ({ group: "Accounts", label: r.legal_name, sub: r.industry, href: `/accounts/${r.id}` })),
    ...partners.rows.map((r) => ({ group: "Partners", label: r.name, sub: r.partner_type, href: `/partners/${r.id}` })),
  ];
}

export async function answerQuestion(
  db: PoolClient, orgId: string, question: string, opts: AnswerOptions = {},
): Promise<AnswerEnvelope> {
  const t0 = Date.now();
  const companyIds = opts.companyIds ?? null;
  const q = question.trim().slice(0, 600);
  const intentClass: IntentClass = opts.intentClass ?? classifyForAnswer(q);
  const scopeNote = scopeNoteFor(companyIds);

  const base = {
    question: q, intentClass, scopeNote, clarification: null as string | null,
    explanation: null as Explanation | null, rejection: null as string | null,
  };

  // ---- GO TO: no interpretation tier at all -------------------------------------------------
  if (intentClass === "goto") {
    const hits = await goto(db, orgId, q, companyIds);
    return {
      ...base, path: "GOTO", outcome: hits.length > 0 ? "MATCHED" : "UNKNOWN",
      intentKey: null, slots: null, interpreted: null,
      answer: hits.length > 0 ? `${hits.length} record${hits.length === 1 ? "" : "s"} match that name.` : "No record matches that name in scope.",
      hits, recordIds: hits.map((h) => h.href), grounding: [],
      latency: { interpretMs: null, resolveMs: Date.now() - t0, totalMs: Date.now() - t0 },
      model: null,
    };
  }

  // ---- 1. DETERMINISTIC FIRST ----------------------------------------------------------------
  const routed = routeIntent(q, intentClass);
  if (routed.kind === "MATCHED") {
    const r0 = Date.now();
    const result = await routed.intent.resolve({ db, orgId, companyIds }, routed.slots);
    const resolveMs = Date.now() - r0;
    return {
      ...base, path: "DETERMINISTIC", outcome: "MATCHED",
      intentKey: routed.intent.intentKey, slots: routed.slots,
      interpreted: result.interpreted ?? null,
      answer: compose(result, "MATCHED", null),
      hits: result.hits ?? [], explanation: result.explanation ?? null,
      recordIds: idsOf(result), grounding: groundingOf(result),
      latency: { interpretMs: null, resolveMs, totalMs: Date.now() - t0 },
      model: null,
    };
  }

  // ---- 2. THE INTERPRETER — only where the deterministic registry found nothing ---------------
  const deterministicFallback = (rejection: string | null): AnswerEnvelope => ({
    ...base,
    path: "DETERMINISTIC",
    outcome: routed.kind === "AMBIGUOUS" ? "AMBIGUOUS" : "UNSUPPORTED",
    intentKey: null, slots: null, interpreted: null,
    answer: routed.note,
    hits: [], recordIds: [], grounding: [],
    latency: { interpretMs: null, resolveMs: 0, totalMs: Date.now() - t0 },
    model: null,
    rejection,
  });

  if (opts.deterministicOnly || !interpreterEnabled()) return deterministicFallback(null);

  let interpretation: Interpretation;
  try {
    interpretation = await interpret(q, {
      intentClass,
      scopeSize: companyIds?.length ?? null,
      apiKey: opts.apiKey ?? null,
      transport: opts.transport,
    });
  } catch {
    // `interpret` is written not to throw; this is belt-and-braces so a surface can never 500
    // because of the model tier.
    return deterministicFallback("interpreter threw");
  }

  const interpretMs = interpretation.latencyMs;

  if (interpretation.outcome === "REJECTED") {
    // §12: reject, do not execute, fall back. The operator sees the deterministic answer, and the
    // reason the interpretation was discarded is logged rather than rendered.
    return { ...deterministicFallback(interpretation.rejection), latency: { interpretMs, resolveMs: 0, totalMs: Date.now() - t0 } };
  }

  if (interpretation.outcome === "UNSUPPORTED") {
    return {
      ...base, path: "INTERPRETED", outcome: "UNSUPPORTED",
      intentKey: null, slots: null, interpreted: null,
      answer: "That question is not something PursuitOS can answer from the record yet.",
      hits: [], recordIds: [], grounding: [],
      latency: { interpretMs, resolveMs: 0, totalMs: Date.now() - t0 },
      model: interpretation.model,
    };
  }

  if (interpretation.outcome === "AMBIGUOUS") {
    const named = interpretation.candidates.map((k) => getIntent(k)?.description).filter(Boolean) as string[];
    return {
      ...base, path: "INTERPRETED", outcome: "AMBIGUOUS",
      intentKey: null, slots: null, interpreted: null,
      clarification: interpretation.clarification,
      answer: interpretation.clarification
        ?? `That could mean ${named.length || interpretation.candidates.length} different things — narrow the question.`,
      hits: named.slice(0, 4).map((d, i) => ({ group: "Did you mean", label: d, sub: interpretation.candidates[i] ?? null, href: "#" })),
      recordIds: [], grounding: [],
      latency: { interpretMs, resolveMs: 0, totalMs: Date.now() - t0 },
      model: interpretation.model,
    };
  }

  // ---- 3. VALIDATE the model's structured output against the registry ------------------------
  const def = getIntent(interpretation.intentKey!);
  if (!def || def.intentClass !== intentClass) {
    return { ...deterministicFallback(`intent ${interpretation.intentKey} is not in class ${intentClass}`), latency: { interpretMs, resolveMs: 0, totalMs: Date.now() - t0 } };
  }
  const checked = validateSlots(def, interpretation.slots);
  if (!checked.ok) {
    return { ...deterministicFallback(`slot validation failed: ${checked.error}`), latency: { interpretMs, resolveMs: 0, totalMs: Date.now() - t0 } };
  }

  // ---- 4. CANONICAL ENTITY RESOLUTION, inside the authorized set ------------------------------
  const entities = await resolveEntitySlots(db, orgId, def.intentKey, checked.slots, companyIds);
  if (!entities.ok) {
    return {
      ...base, path: "INTERPRETED", outcome: entities.outcome,
      intentKey: def.intentKey, slots: checked.slots, interpreted: null,
      clarification: entities.outcome === "AMBIGUOUS" ? entities.note : null,
      answer: entities.note,
      hits: [], recordIds: [], grounding: [],
      latency: { interpretMs, resolveMs: 0, totalMs: Date.now() - t0 },
      model: interpretation.model,
    };
  }

  // ---- 5. THE DETERMINISTIC RESOLVER produces the answer --------------------------------------
  const r0 = Date.now();
  const resolved = await resolveStructured({ db, orgId, companyIds }, def.intentKey, entities.slots);
  const resolveMs = Date.now() - r0;

  if (resolved.outcome !== "MATCHED") {
    return { ...deterministicFallback(`resolver rejected structured call: ${resolved.note ?? ""}`), latency: { interpretMs, resolveMs, totalMs: Date.now() - t0 } };
  }

  const hits = resolved.hits ?? [];
  // A resolver that ran cleanly but found nothing is UNKNOWN, not UNSUPPORTED: the question was
  // understood and the record simply does not hold the answer. Collapsing the two would tell an
  // operator their question is unanswerable when it is merely unanswered.
  const outcome: AnswerOutcome = hits.length === 0 && !resolved.explanation ? "UNKNOWN" : "MATCHED";

  return {
    ...base, path: "INTERPRETED", outcome,
    intentKey: def.intentKey, slots: entities.slots,
    interpreted: resolved.interpreted ?? null,
    answer: compose(resolved, outcome === "UNKNOWN" ? "MATCHED" : outcome, null),
    hits, explanation: resolved.explanation ?? null,
    recordIds: idsOf(resolved), grounding: groundingOf(resolved),
    latency: { interpretMs, resolveMs, totalMs: Date.now() - t0 },
    model: interpretation.model,
  };
}

export { catalogVersion };
