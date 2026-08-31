import { registerIntent, type Slots, type SlotSpec } from "./registry";
import {
  parseShowMe, resolveShowMeWithTotals,
  parseMotionShowMe, resolveMotionShowMe,
  parseStakeholderShowMe, resolveStakeholderShowMe,
  resolveExplain, EXPLAIN_ASPECTS, type ExplainAspect,
  type ParsedQuery,
} from "./query";
import { parseLifecycleShowMe, resolveLifecycleShowMe, resolveLifecycleExplain } from "@/lib/lifecycle/intents";
import { parseValueShowMe, parseValueExplain, resolveValueShowMe, resolveValueExplain, type ValueShowMode } from "@/lib/value/intents";
import { parseAttention, resolveAttention, parseMotionConstrained, resolveMotionConstrained, type AttentionMode } from "./attention";
import { parseChanges, resolveChanges } from "./changes";
import { parseCompound, filtersFromSlots, resolveCompound, MISSING_ROLES, VALUE_STATES, CONDITIONS, STAGES } from "./compound";
import { parsePartnerActivation, resolvePartnerActivation } from "./partner-activation";
import { money } from "./significance";

/** Reusable slot specs — declared once so the same concept reads identically to an interpreter. */
const SLOT: Record<string, SlotSpec> = {
  account: { type: "account", description: "The customer account named in the question, exactly as the user wrote it." },
  partner: { type: "partner", description: "The partner/reseller named in the question, exactly as the user wrote it." },
  days: { type: "number", description: "A time window in days.", min: 1, max: 3650 },
};

/**
 * Intent registrations (P2C-0). The three pre-existing deterministic intents migrated VERBATIM —
 * same parsers, same resolvers, same semantics — plus the P2A lifecycle intents. What changed is
 * only HOW they are selected: an explicit `precedence` integer instead of the position of an
 * `else if` inside the palette route.
 *
 * PRECEDENCE RATIONALE (higher wins; the previous chain's order is preserved exactly):
 *   95  pursuit.compound           P2C-1 §7: only matches a request spanning TWO OR MORE families
 *   93  motion.constrained_revenue narrower than attention: names Motions AND constraint
 *   92  attention.today            narrow: names the operator's own attention
 *   91  change.recent              narrow: names change over a window
 *   90  motion.execution_ready     was checked first  — a narrow, unambiguous phrase
 *   88  value.no_case              narrow: names the absence of a Value Case
 *   87  value.conflicting          narrow: names contested economics
 *   86  value.confirmed            narrow: names evidenced economics
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
 *
 * `pursuit.compound` sits at the very top and is still safe, because its own parser DECLINES every
 * single-family request — a specialist answers those with its own vocabulary. Precedence is what
 * decides a contest; refusing to enter the contest is what prevents one.
 *
 * P2C-1: every intent below also declares a TYPED slot schema. That schema is what an interpreter
 * tier is shown and what its output is validated against, so the registry remains the single
 * source of supported intents and there is no second catalog to drift out of sync.
 */

// ---- SHOW ME · Motion execution-readiness (P1A) — precedence 90 -------------------------------
registerIntent({
  intentKey: "motion.execution_ready",
  intentClass: "showme",
  precedence: 90,
  description: "Accounts that pass every Motion funnel gate, optionally within one hypothesis.",
  requiredSlots: [],
  optionalSlots: ["hypothesis"],
  slots: { hypothesis: { type: "string", description: "The Motion / solution hypothesis to narrow to, if the question names one." } },
  families: ["motion"],
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
  slots: {
    role: { type: "string", description: "Which buying role has no verified assertion.", enum: ["economic_buyer", "champion", "technical_buyer"] },
    partner: SLOT.partner,
  },
  // Declares BOTH families it can represent: this intent already narrows by partner, so a
  // "WWT pursuits missing a champion" question is fully answered here and must not be handed to
  // the compound resolver.
  families: ["stakeholder", "partner"],
  scope: "COMPANY_SCOPED",
  match: (q) => {
    const parsed = parseStakeholderShowMe(q);
    return parsed ? { role: parsed.role, partner: parsed.partner } : null;
  },
  resolve: async (ctx, slots) => {
    const role = String(slots.role);
    const { hits, interpreted, exposureUsd, top } = await resolveStakeholderShowMe(
      ctx.db, ctx.orgId, { role, partner: (slots.partner as string | null) ?? null }, ctx.companyIds);
    return {
      hits, interpreted,
      note: hits.length === 0
        ? "No pursuits with that coverage gap — or coverage is not yet established (pre-opportunity pursuits are UNKNOWN, not gaps)."
        : undefined,
      significance: money(`Expected value with no verified ${role.replace(/_/g, " ")}`, exposureUsd,
        `sum of expected value across ${hits.length} pursuit(s) that have a linked opportunity but no VERIFIED assertion for that role`),
      nextAction: top ? { label: `Assert the ${role.replace(/_/g, " ")} on ${top.label}`, href: top.href } : null,
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
  slots: {
    conditions: { type: "string[]", description: "Deal condition states to keep.", enum: [...CONDITIONS] },
    stages: { type: "string[]", description: "Opportunity stages to keep.", enum: [...STAGES] },
    partner: SLOT.partner,
    amountGt: { type: "number", description: "Keep opportunities with an amount strictly above this many US dollars.", min: 0 },
    amountLt: { type: "number", description: "Keep opportunities with an amount strictly below this many US dollars.", min: 0 },
    // `interpreted` is the deterministic parser's own read-back. It is NOT offered to an
    // interpreter tier (see the catalog builder, which withholds it) — a model-authored read-back
    // would be prose about the answer, which is precisely what this architecture does not permit.
    interpreted: { type: "string", description: "Internal: read-back text produced by the deterministic parser." },
  },
  families: ["condition", "stage", "partner", "amount"],
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
    const { hits, amountUsd } = await resolveShowMeWithTotals(ctx.db, ctx.orgId, query, ctx.companyIds);
    return {
      hits,
      interpreted: (slots.interpreted as string | undefined) ?? undefined,
      note: hits.length === 0 ? "No matching records." : undefined,
      significance: money("Open opportunity value in this cut", amountUsd,
        `sum of the opportunity amount across the ${hits.length} matching open opportunit${hits.length === 1 ? "y" : "ies"}`),
      nextAction: hits[0] ? { label: `Open ${hits[0].label.split(" — ")[0]}`, href: hits[0].href } : null,
    };
  },
  examples: ["at-risk late-stage opportunities over $500k", "stalling deals through WWT"],
});

// ---- SHOW ME · Lifecycle intents (P2A) --------------------------------------------------------
const lifecycleShowMe = (intentKey: string, precedence: number, mode: "horizon" | "conflicting" | "unknown", description: string, examples: string[]) =>
  registerIntent({
    intentKey, intentClass: "showme", precedence, description,
    requiredSlots: [], optionalSlots: ["days"],
    slots: { days: { ...SLOT.days, description: "The lifecycle horizon in days (defaults to 90 when the question does not say)." } },
    families: ["lifecycle"],
    scope: "COMPANY_SCOPED",
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

// ---- SHOW ME · Value Case intents (P2B §15) ---------------------------------------------------
// Placed at 88–86: above the broad opportunity grammar, below the motion funnel. Distinct
// precedences, so a value phrase can never be resolved by whichever parser was registered first.
const valueShowMe = (intentKey: string, precedence: number, mode: ValueShowMode, description: string, examples: string[]) =>
  registerIntent({
    intentKey, intentClass: "showme", precedence, description,
    requiredSlots: [], optionalSlots: [], slots: {}, families: ["value"],
    scope: "COMPANY_SCOPED",
    match: (q) => {
      const parsed = parseValueShowMe(q);
      return parsed && parsed.mode === mode ? {} : null;
    },
    resolve: async (ctx) => resolveValueShowMe(ctx, mode),
    examples,
  });

valueShowMe("value.no_case", 88, "no_case",
  "Pursuits with no defensible Value Case — absence is UNKNOWN, never zero.",
  ["which high-value pursuits have no defensible value case", "pursuits lacking a business case"]);
valueShowMe("value.conflicting", 87, "conflicting_economics",
  "Value Cases whose economic facts contradict one another — every figure shown, none chosen.",
  ["which value cases contain conflicting economic facts"]);
valueShowMe("value.confirmed", 86, "confirmed_economics",
  "Pursuits carrying verified or customer-confirmed economics.",
  ["show pursuits with customer-confirmed economics"]);

// ---- EXPLAIN · Value Case (P2B §15) — precedence 62, above the lifecycle explainer ------------
registerIntent({
  intentKey: "value.explain",
  intentClass: "explain",
  precedence: 62,
  description: "The Value Case for one account: the three economic truths, evidence quality, and what would strengthen it.",
  requiredSlots: ["account"],
  optionalSlots: ["strengthen"],
  slots: {
    account: SLOT.account,
    strengthen: { type: "boolean", description: "True when the question asks what would STRENGTHEN or improve the case, rather than what it is." },
  },
  families: ["value"],
  scope: "COMPANY_SCOPED",
  match: (q) => {
    const parsed = parseValueExplain(q);
    return parsed ? { account: parsed.account, strengthen: parsed.strengthen } : null;
  },
  resolve: async (ctx, slots) => resolveValueExplain(ctx, String(slots.account), slots.strengthen === true),
  examples: ["what is the value case for Globex", "what would strengthen Umbrella's value case"],
});

// ---- EXPLAIN · lifecycle driver (P2A) — precedence 60 -----------------------------------------
registerIntent({
  intentKey: "lifecycle.explain",
  intentClass: "explain",
  precedence: 60,
  description: "Which lifecycle event is driving an account's timing, with its state and evidence.",
  requiredSlots: ["account"],
  optionalSlots: [],
  slots: { account: SLOT.account },
  families: ["lifecycle"],
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
  description: "Evidence-bound explanation of an existing record: route, timing, readiness, qualification, seller path, stakeholder coverage.",
  requiredSlots: [],
  // `q` is the deterministic parser's channel (the verbatim utterance, which the resolver still
  // parses itself). `account` + `aspect` are the STRUCTURED channel an interpreter tier uses —
  // structured intent is exactly what an interpreter may produce, and it removes the need for a
  // paraphrase to survive the resolver's own keyword sniffing.
  optionalSlots: ["q", "account", "aspect"],
  slots: {
    q: { type: "string", description: "Internal: the verbatim utterance, supplied by the deterministic parser." },
    account: SLOT.account,
    aspect: { type: "string", description: "Which facet of the record is being asked about.", enum: [...EXPLAIN_ASPECTS] },
  },
  scope: "ORG_SCOPED",
  match: (q) => ({ q }),   // the existing resolver does its own subject resolution
  resolve: async (ctx, slots) => {
    // With no verbatim utterance, the account NAME becomes the subject text — the resolver's own
    // canonical company lookup runs on it exactly as before, so the record is still chosen by the
    // resolver and never by the interpreter.
    const subject = (slots.q as string | undefined) ?? (slots.account as string | undefined);
    if (!subject) return { note: "This question needs a named account." };
    const aspect = (slots.aspect as ExplainAspect | undefined) ?? null;
    const ex = await resolveExplain(ctx.db, subject, ctx.orgId, aspect);
    return "note" in ex ? { note: ex.note } : { explanation: ex };
  },
  examples: ["why is Globex routed through WWT", "why is Globex not execution-ready", "who is the economic buyer for Globex"],
});

// ---- SHOW ME · Compound multi-constraint filter (P2C-1 §7) — precedence 95 --------------------
registerIntent({
  intentKey: "pursuit.compound",
  intentClass: "showme",
  precedence: 95,
  description:
    "Pursuits satisfying SEVERAL constraints at once (partner, amount, lifecycle window, missing buying role, Value Case state, deal condition, stage). " +
    "Use ONLY when the question constrains two or more of those; a single-constraint question belongs to its specialist intent.",
  requiredSlots: [],
  optionalSlots: ["partner", "amountGt", "amountLt", "renewalWithinDays", "missingRole", "valueState", "condition", "stages"],
  slots: {
    partner: SLOT.partner,
    amountGt: { type: "number", description: "Opportunity amount strictly above this many US dollars.", min: 0 },
    amountLt: { type: "number", description: "Opportunity amount strictly below this many US dollars.", min: 0 },
    renewalWithinDays: { ...SLOT.days, description: "Keep pursuits whose lifecycle event (renewal / contract expiry / EOL) falls within this many days." },
    missingRole: { type: "string", description: "Keep pursuits with NO verified assertion for this buying role.", enum: [...MISSING_ROLES] },
    valueState: { type: "string", description: "Keep pursuits whose Value Case is in this state.", enum: [...VALUE_STATES] },
    condition: { type: "string", description: "Keep pursuits whose open opportunity is in this condition.", enum: [...CONDITIONS] },
    stages: { type: "string[]", description: "Keep pursuits whose open opportunity is at one of these stages.", enum: [...STAGES] },
  },
  families: ["partner", "amount", "lifecycle", "stakeholder", "value", "condition", "stage"],
  scope: "COMPANY_SCOPED",
  match: (q) => (parseCompound(q) as unknown as Slots | null),
  resolve: async (ctx, slots) => resolveCompound(ctx, filtersFromSlots(slots)),
  examples: [
    "show WWT pursuits over $500K renewing in 90 days without a verified economic buyer",
    "at-risk late-stage deals over $1M with no defensible value case",
  ],
});

// ---- SHOW ME · Attention (P2C-1 §6) — precedence 92 -------------------------------------------
registerIntent({
  intentKey: "attention.today",
  intentClass: "showme",
  precedence: 92,
  description: "What the operator should attend to: today's decision queue, revenue behind a gating constraint, or decisions awaiting them personally.",
  requiredSlots: ["mode"],
  optionalSlots: [],
  slots: {
    mode: {
      type: "string",
      enum: ["focus", "blocked", "waiting"],
      description: "focus = today's queue in materiality order; blocked = revenue behind a gating Motion constraint; waiting = decisions the record is holding for this operator.",
    },
  },
  families: ["attention"],
  scope: "COMPANY_SCOPED",
  match: (q) => {
    const parsed = parseAttention(q);
    return parsed ? { mode: parsed.mode } : null;
  },
  resolve: async (ctx, slots) => resolveAttention(ctx, slots.mode as AttentionMode),
  examples: ["what should I focus on today", "where is revenue blocked", "what is waiting on me"],
});

// ---- SHOW ME · What changed (P2C-1 §9) — precedence 91 ----------------------------------------
registerIntent({
  intentKey: "change.recent",
  intentClass: "showme",
  precedence: 91,
  description: "What changed over a window, from the append-only change ledger — ordered by materiality first, then time.",
  requiredSlots: [],
  optionalSlots: ["account", "days", "materialOnly"],
  slots: {
    account: SLOT.account,
    days: { ...SLOT.days, description: "How far back to look, in days. Defaults to 7 when the question does not say.", max: 365 },
    materialOnly: { type: "boolean", description: "True (the default) keeps only HIGH/CRITICAL changes; false includes every recorded change." },
  },
  families: ["change"],
  scope: "COMPANY_SCOPED",
  match: (q) => {
    const parsed = parseChanges(q);
    return parsed ? { account: parsed.account, days: parsed.days, materialOnly: parsed.materialOnly } : null;
  },
  resolve: async (ctx, slots) => resolveChanges(ctx, {
    account: (slots.account as string | null) ?? null,
    days: (slots.days as number | null) ?? 7,
    materialOnly: slots.materialOnly !== false,
  }),
  examples: ["what changed on Globex this week", "what materially changed since Friday", "what changed in the last 30 days"],
});

// ---- SHOW ME · Constrained revenue by Motion (P2C-1 §6) — precedence 93 -----------------------
registerIntent({
  intentKey: "motion.constrained_revenue",
  intentClass: "showme",
  // ABOVE attention.today (92): "which motion has the most constrained revenue" contains the
  // phrase "constrained revenue", which the attention parser also recognises. The question that
  // NAMES Motions is the more specific one, so it wins — and the two never tie.
  precedence: 93,
  description: "Motions ranked by the expected value sitting behind a gating constraint.",
  requiredSlots: [],
  optionalSlots: [],
  slots: {},
  families: ["motion"],
  scope: "COMPANY_SCOPED",
  match: (q) => (parseMotionConstrained(q) ? {} : null),
  resolve: async (ctx) => resolveMotionConstrained(ctx),
  examples: ["which motion has the most constrained revenue", "which motions are most blocked"],
});

// ---- EXPLAIN · Partner activation (P2C-1 §6) — precedence 63 ----------------------------------
registerIntent({
  intentKey: "partner.activation",
  intentClass: "explain",
  precedence: 63,
  description: "Where a named partner activates well — observed activation by category, with the sufficiency of each cell's evidence.",
  requiredSlots: ["partner"],
  optionalSlots: [],
  slots: { partner: SLOT.partner },
  families: ["partner"],
  scope: "COMPANY_SCOPED",
  match: (q) => {
    const parsed = parsePartnerActivation(q);
    return parsed ? { partner: parsed.partner } : null;
  },
  resolve: async (ctx, slots) => resolvePartnerActivation(ctx, String(slots.partner)),
  examples: ["where does CDW activate well", "which categories does WWT execute well in"],
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
