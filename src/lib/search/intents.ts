import { registerIntent, type Slots } from "./registry";
import {
  parseShowMe, resolveShowMe,
  parseMotionShowMe, resolveMotionShowMe,
  parseStakeholderShowMe, resolveStakeholderShowMe,
  resolveExplain,
  type ParsedQuery,
} from "./query";
import { parseLifecycleShowMe, resolveLifecycleShowMe, resolveLifecycleExplain } from "@/lib/lifecycle/intents";

/**
 * Intent registrations (P2C-0). The three pre-existing deterministic intents migrated VERBATIM —
 * same parsers, same resolvers, same semantics — plus the P2A lifecycle intents. What changed is
 * only HOW they are selected: an explicit `precedence` integer instead of the position of an
 * `else if` inside the palette route.
 *
 * PRECEDENCE RATIONALE (higher wins; the previous chain's order is preserved exactly):
 *   90  motion.execution_ready     was checked first  — a narrow, unambiguous phrase
 *   85  lifecycle.horizon          narrow: an explicit time window over lifecycle events
 *   84  lifecycle.conflicting      narrow: names the conflicting state
 *   83  lifecycle.unknown_timing   narrow: names UNKNOWN lifecycle timing
 *   80  stakeholder.coverage_gap   was checked second — narrow: names a buying role
 *   10  opportunity.filter         was the fallback   — the broadest allowlist grammar
 *
 * The narrow intents sit above the broad one deliberately: the generic opportunity grammar matches
 * many lifecycle/stakeholder utterances incidentally (it recognises the bare token "renewal"), so a
 * tie would otherwise be decided by accident. No two intents share a precedence, so a genuine tie
 * (which `routeIntent` reports as AMBIGUOUS rather than guessing) signals a registry design error.
 */

// ---- SHOW ME · Motion execution-readiness (P1A) — precedence 90 -------------------------------
registerIntent({
  intentKey: "motion.execution_ready",
  intentClass: "showme",
  precedence: 90,
  description: "Accounts that pass every Motion funnel gate, optionally within one hypothesis.",
  requiredSlots: [],
  optionalSlots: ["hypothesis"],
  scope: "COMPANY_SCOPED",
  match: (q) => {
    const parsed = parseMotionShowMe(q);
    return parsed ? { hypothesis: parsed.hypothesis } : null;
  },
  resolve: async (ctx, slots) => {
    const { hits, interpreted } = await resolveMotionShowMe(
      ctx.db, ctx.orgId, { hypothesis: (slots.hypothesis as string | null) ?? null }, ctx.companyIds);
    return { hits, interpreted, note: hits.length === 0 ? "No execution-ready accounts in that cut." : undefined };
  },
  examples: ["show execution-ready pursuits", "execution-ready accounts in Virtualization"],
});

// ---- SHOW ME · Stakeholder coverage gap (P1C) — precedence 80 ---------------------------------
registerIntent({
  intentKey: "stakeholder.coverage_gap",
  intentClass: "showme",
  precedence: 80,
  description: "Pursuits with a linked opportunity but no VERIFIED assertion for a buying role.",
  requiredSlots: ["role"],
  optionalSlots: ["partner"],
  scope: "COMPANY_SCOPED",
  match: (q) => {
    const parsed = parseStakeholderShowMe(q);
    return parsed ? { role: parsed.role, partner: parsed.partner } : null;
  },
  resolve: async (ctx, slots) => {
    const { hits, interpreted } = await resolveStakeholderShowMe(
      ctx.db, ctx.orgId, { role: String(slots.role), partner: (slots.partner as string | null) ?? null }, ctx.companyIds);
    return {
      hits, interpreted,
      note: hits.length === 0
        ? "No pursuits with that coverage gap — or coverage is not yet established (pre-opportunity pursuits are UNKNOWN, not gaps)."
        : undefined,
    };
  },
  examples: ["which high-value pursuits lack an economic buyer", "show WWT pursuits missing a verified champion"],
});

// ---- SHOW ME · Opportunity allowlist filter (the original grammar) — precedence 10 ------------
registerIntent({
  intentKey: "opportunity.filter",
  intentClass: "showme",
  precedence: 10,
  description: "The allowlisted opportunity grammar: condition, stage, partner, amount bounds.",
  requiredSlots: [],
  optionalSlots: ["conditions", "stages", "partner", "amountGt", "amountLt", "interpreted"],
  scope: "COMPANY_SCOPED",
  match: (q) => {
    const parsed = parseShowMe(q);
    if (!parsed) return null;
    // The parsed query is carried through as discrete slots; `resolveShowMe` still receives the
    // exact same ParsedQuery object shape it always did.
    return {
      conditions: parsed.query.conditions as unknown as string[],
      stages: parsed.query.stages,
      partner: parsed.query.partner,
      amountGt: parsed.query.amountGt,
      amountLt: parsed.query.amountLt,
      interpreted: parsed.interpreted,
    };
  },
  resolve: async (ctx, slots) => {
    const query = {
      entity: "opportunity",
      conditions: (slots.conditions ?? []) as ParsedQuery["conditions"],
      stages: (slots.stages ?? []) as string[],
      partner: (slots.partner as string | null) ?? null,
      amountGt: (slots.amountGt as number | null) ?? null,
      amountLt: (slots.amountLt as number | null) ?? null,
    } as ParsedQuery;
    const hits = await resolveShowMe(ctx.db, ctx.orgId, query, ctx.companyIds);
    return {
      hits,
      interpreted: (slots.interpreted as string | undefined) ?? undefined,
      note: hits.length === 0 ? "No matching records." : undefined,
    };
  },
  examples: ["at-risk late-stage opportunities over $500k", "stalling deals through WWT"],
});

// ---- SHOW ME · Lifecycle intents (P2A) --------------------------------------------------------
const lifecycleShowMe = (intentKey: string, precedence: number, mode: "horizon" | "conflicting" | "unknown", description: string, examples: string[]) =>
  registerIntent({
    intentKey, intentClass: "showme", precedence, description,
    requiredSlots: [], optionalSlots: ["days"], scope: "COMPANY_SCOPED",
    match: (q) => {
      const parsed = parseLifecycleShowMe(q);
      return parsed && parsed.mode === mode ? { days: parsed.days } : null;
    },
    resolve: async (ctx, slots) => resolveLifecycleShowMe(ctx, mode, (slots.days as number | null) ?? null),
    examples,
  });

lifecycleShowMe("lifecycle.horizon", 85, "horizon",
  "Pursuits with a lifecycle event entering a window (default 90 days), ranked by materiality.",
  ["what changes in the next 90 days", "which pursuits renew in the next 90 days"]);
lifecycleShowMe("lifecycle.conflicting", 84, "conflicting",
  "Lifecycle dates where active canonical facts contradict one another.",
  ["show renewals with conflicting dates"]);
lifecycleShowMe("lifecycle.unknown_timing", 83, "unknown",
  "High-value pursuits with no authoritative lifecycle evidence — UNKNOWN, not zero.",
  ["which high-value pursuits have unknown renewal timing"]);

// ---- EXPLAIN · lifecycle driver (P2A) — precedence 60 -----------------------------------------
registerIntent({
  intentKey: "lifecycle.explain",
  intentClass: "explain",
  precedence: 60,
  description: "Which lifecycle event is driving an account's timing, with its state and evidence.",
  requiredSlots: ["account"],
  optionalSlots: [],
  scope: "COMPANY_SCOPED",
  match: (q) => {
    if (!/lifecycle|renewal|contract|expir|end[- ]of[- ](life|support)|eol|eos/i.test(q)) return null;
    const account = accountFromUtterance(q);
    return account ? { account } : null;
  },
  resolve: async (ctx, slots) => resolveLifecycleExplain(ctx, String(slots.account)),
  examples: ["what lifecycle event is driving Globex", "why is the renewal for Umbrella conflicting"],
});

// ---- EXPLAIN · the canonical record explainer (route / timing / motion / stakeholder) ---------
registerIntent({
  intentKey: "record.explain",
  intentClass: "explain",
  precedence: 10,
  description: "Evidence-bound explanation of an existing record: route, timing, readiness, coverage.",
  requiredSlots: [],
  optionalSlots: [],
  scope: "ORG_SCOPED",
  match: (q) => ({ q }),   // the existing resolver does its own subject resolution
  resolve: async (ctx, slots) => {
    const ex = await resolveExplain(ctx.db, String(slots.q), ctx.orgId);
    return "note" in ex ? { note: ex.note } : { explanation: ex };
  },
  examples: ["why is Globex routed through WWT", "why is Globex not execution-ready"],
});

/**
 * Shared account-name extraction for EXPLAIN intents. Leading question words are stripped so
 * "What lifecycle event is driving Globex?" grounds against Globex, not "What".
 */
export function accountFromUtterance(q: string): string | null {
  const body = q.replace(/^\s*(who|whom|what|why|which|where|when|how|show|list|is|does|do)\b\s*/i, "");
  const m = body.match(/\b(?:is|are|was|for|at|of|to|driving|drives)?\s*([A-Z][\w&.'-]+(?:\s+[A-Z][\w&.'-]+){0,3})/);
  return m ? m[1].trim() : null;
}

/** Import for side effects. Kept explicit so registration order can never matter. */
export const INTENTS_REGISTERED = true;
