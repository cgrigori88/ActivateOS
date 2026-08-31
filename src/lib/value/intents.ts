import type { ResolveContext, IntentResult } from "@/lib/search/registry";
import { getValueCase, bounds, usd, qualityLine, STATE_LABEL, type ValueCase } from "./case";
import { LADDER_LABEL } from "./drivers";
import { money } from "@/lib/search/significance";

/** Build the canonical Explanation object every EXPLAIN intent returns. */
const expl = (title: string, subtitle: string, lines: { label: string; value: string }[]) => ({
  title, subtitle, lines,
  grounding: ["facts (economic predicates)", "fact_predicates (driver roles)", "fact_contradictions", "opportunities.amount_usd", "pursuits.expected_value_weighted"],
});

/**
 * Value Case ⌘K intents (P2B §15), registered through the P2C-0 registry — no bespoke parser lives
 * outside it. Every answer is produced by the deterministic resolver reading the same canonical
 * model the rooms render; the LLM answers nothing here. P2C-1 is not implemented.
 */

export type ValueShowMode = "no_case" | "confirmed_economics" | "conflicting_economics";

/**
 * SHOW ME parse. Returns null when the utterance is not about the Value Case.
 *
 * "Economic BUYER" is a stakeholder role, not economics — the word "economic" alone must never
 * pull a buying-committee question into the Value Case. Without this the value intents (88–86)
 * would shadow `stakeholder.coverage_gap` (80), which is exactly the silent capture the explicit
 * precedence registry exists to prevent.
 */
export function parseValueShowMe(q: string): { mode: ValueShowMode } | null {
  if (/economic\s+buyer|champion|decision\s+maker|buying\s+(committee|team)|stakeholder/i.test(q)) return null;
  const valueish = /value case|business value|business case|economics|roi\b|customer impact|economic (fact|input|driver|baseline)/i.test(q);
  if (!valueish) return null;
  if (/conflict|disagree|contradict|contested/i.test(q)) return { mode: "conflicting_economics" };
  if (/customer[- ]confirmed|confirmed economics|verified economics/i.test(q)) return { mode: "confirmed_economics" };
  if (/no (defensible )?(value case|business case)|lack|without|missing|undefended|not defensible/i.test(q)) return { mode: "no_case" };
  return null;
}

/** EXPLAIN parse: "what is the value case for X" / "what would strengthen X's value case". */
export function parseValueExplain(q: string): { account: string; strengthen: boolean } | null {
  // Same rule as SHOW ME: a buying-role question is not a Value Case question.
  if (/economic\s+buyer|champion|decision\s+maker|buying\s+(committee|team)|stakeholder/i.test(q)) return null;
  if (!/value case|business value|business case|economics|economic (fact|input|driver|baseline)/i.test(q)) return null;
  const strengthen = /strengthen|improve|firm up|shore up|what would/i.test(q);
  // Strip the leading question words so a name match cannot ground on "What".
  const stripped = q.replace(/^\s*(what|which|who|how|show|list|explain|is|are|does|do|would)\b\s*/i, "");
  const m = stripped.match(/\b(?:for|of|on|about)\s+([A-Z][\w.&'-]*(?:\s+[A-Z][\w.&'-]*)*)/)
    ?? stripped.match(/\b([A-Z][\w.&'-]*(?:\s+[A-Z][\w.&'-]*)*)(?:'s)?\b/);
  const account = m?.[1]?.replace(/'s$/, "").trim();
  if (!account || /^(Value|Business|Case|Economic|Pursuits?|Accounts?)$/i.test(account)) return null;
  return { account, strengthen };
}

/** Every open pursuit's Value Case in scope, de-duplicated by account (economics are account-scoped). */
async function casesInScope(ctx: ResolveContext, cap = 40): Promise<ValueCase[]> {
  const scoped = ctx.companyIds != null;
  const { rows } = await ctx.db.query<{ id: string; account_id: string }>(
    `select p.id, p.account_id from pursuits p
      where p.org_id = $1 and p.status not in ('CLOSED','ARCHIVED')
        and ($3::boolean is false or p.account_id = any($2))
      order by p.expected_value_weighted desc nulls last limit $4`,
    [ctx.orgId, ctx.companyIds ?? [], scoped, cap]);
  const seen = new Set<string>();
  const out: ValueCase[] = [];
  for (const r of rows) {
    if (seen.has(r.account_id)) continue;
    seen.add(r.account_id);
    const vc = await getValueCase(ctx.db, ctx.orgId, r.id);
    if (vc) out.push(vc);
  }
  return out;
}

export async function resolveValueShowMe(ctx: ResolveContext, mode: ValueShowMode): Promise<IntentResult> {
  const cases = await casesInScope(ctx);

  if (mode === "conflicting_economics") {
    const hits = cases.filter((c) => c.state === "CONFLICTING").map((c) => ({
      group: "Contested economics",
      label: c.accountLabel,
      sub: `${c.conflicts.map((d) => d.label).join(", ")} — ${c.because}`,
      href: `/pursuits/${c.pursuitId}#value`,
    }));
    const contested = cases.filter((c) => c.state === "CONFLICTING");
    return {
      hits,
      interpreted: "Value Cases whose economic facts contradict one another — both figures shown, neither chosen",
      note: hits.length === 0 ? "No Value Case in scope has contested economics." : undefined,
      // The DEAL amount, deliberately — not the contested customer-impact figures, which are the
      // very numbers in dispute. Summing disputed economics to report their size would be averaging
      // a conflict by another route (P2B §17).
      significance: money("Deal value behind contested economics",
        contested.reduce((a, c) => a + (c.dealAmount ?? 0), 0),
        `sum of the deal amount across ${contested.length} pursuit(s) whose economic facts contradict one another — the contested customer-impact figures are NOT summed`),
      nextAction: contested[0] ? { label: `Reconcile ${contested[0].accountLabel}`, href: `/pursuits/${contested[0].pursuitId}#value` } : null,
    };
  }

  if (mode === "confirmed_economics") {
    const hits = cases
      .filter((c) => c.quality.CUSTOMER_CONFIRMED > 0 || c.quality.VERIFIED > 0)
      .map((c) => ({
        group: "Evidenced economics",
        label: c.accountLabel,
        sub: `${qualityLine(c.quality)}${c.defensible && c.modeledImpact ? ` · modeled ${bounds(c.modeledImpact)}` : ""}`,
        href: `/pursuits/${c.pursuitId}#value`,
      }));
    const evidenced = cases.filter((c) => c.quality.CUSTOMER_CONFIRMED > 0 || c.quality.VERIFIED > 0);
    const defensible = evidenced.filter((c) => c.defensible && c.modeledImpact);
    return {
      hits,
      interpreted: "Pursuits carrying verified or customer-confirmed economic facts",
      note: hits.length === 0 ? "No Value Case in scope carries verified or customer-confirmed economics yet." : undefined,
      // The LOW end of the modeled range, across defensible cases only. The floor is the defensible
      // claim; quoting the high end as the total would be the optimistic reading of a bounded model.
      significance: money("Defensible modeled customer impact (floor)",
        defensible.reduce((a, c) => a + (c.modeledImpact?.low ?? 0), 0),
        `sum of the LOW bound of the modeled range across ${defensible.length} defensible Value Case(s) — the floor, not the midpoint or the ceiling`),
      nextAction: evidenced[0] ? { label: `Open ${evidenced[0].accountLabel}'s Value Case`, href: `/pursuits/${evidenced[0].pursuitId}#value` } : null,
    };
  }

  // no_case — high-value pursuits with nothing defensible behind them.
  const hits = cases.filter((c) => !c.defensible).map((c) => ({
    group: "No defensible Value Case",
    label: c.accountLabel,
    sub: `${STATE_LABEL[c.state]} — ${c.because}`,
    href: `/pursuits/${c.pursuitId}#value`,
  }));
  const undefended = cases.filter((c) => !c.defensible);
  return {
    hits,
    interpreted: "Pursuits with no defensible Value Case — nothing is assumed to be zero",
    note: hits.length === 0
      ? "Every Value Case in scope is defensible."
      : `${hits.length} of ${cases.length} pursuits in scope cannot state a defensible modeled range.`,
    significance: money("Deal value with no defensible business case",
      undefended.reduce((a, c) => a + (c.dealAmount ?? 0), 0),
      `sum of the deal amount across ${undefended.length} pursuit(s) that cannot state a defensible modeled range`),
    nextAction: undefended[0] ? { label: `Build the case for ${undefended[0].accountLabel}`, href: `/pursuits/${undefended[0].pursuitId}#value` } : null,
  };
}

export async function resolveValueExplain(
  ctx: ResolveContext, account: string, strengthen: boolean,
): Promise<IntentResult> {
  const scoped = ctx.companyIds != null;
  const { rows } = await ctx.db.query<{ id: string; legal_name: string }>(
    `select p.id, c.legal_name from pursuits p join companies c on c.id = p.account_id
      where p.org_id = $1 and c.legal_name ilike $2
        and ($4::boolean is false or p.account_id = any($3))
      order by length(c.legal_name) limit 1`,
    [ctx.orgId, `%${account}%`, ctx.companyIds ?? [], scoped]);

  if (!rows[0]) {
    // Distinguish "outside scope" from "does not exist" — a scoped-out account is not a nonexistent one.
    if (scoped) {
      const any = await ctx.db.query(
        `select 1 from pursuits p join companies c on c.id = p.account_id
          where p.org_id = $1 and c.legal_name ilike $2 limit 1`, [ctx.orgId, `%${account}%`]);
      if (any.rows.length > 0) {
        return { explanation: expl("Outside scope", "That account is outside the current ecosystem scope.", []), note: "Scope narrows what can be read." };
      }
    }
    return { explanation: expl("Not found", `No pursuit found for "${account}".`, []) };
  }

  const vc = await getValueCase(ctx.db, ctx.orgId, rows[0].id);
  if (!vc) return { explanation: expl("Value case", `No Value Case is available for ${rows[0].legal_name}.`, []) };

  if (vc.state === "NOT_ESTABLISHED") {
    return {
      explanation: expl(`Value case — ${vc.accountLabel}`, "NOT ESTABLISHED. Nothing is assumed to be zero.",
        [{ label: "Why", value: vc.because }]),
      hits: [{ group: "Value case", label: vc.accountLabel, sub: "not established", href: `/pursuits/${vc.pursuitId}#value` }],
    };
  }

  if (strengthen) {
    // The signature interaction, answered deterministically. Range widths are interval arithmetic;
    // no confidence percentage is claimed, because no calibrated model for one exists.
    const lines: string[] = [];
    lines.push(vc.defensible && vc.modeledImpact
      ? `Current modeled range ${bounds(vc.modeledImpact)} (width ${usd(vc.modeledImpact.high - vc.modeledImpact.low)}).`
      : `Value case not yet defensible — ${vc.because}`);
    for (const s of vc.sensitivity.slice(0, 3)) {
      lines.push(
        `${s.label} — ${s.conflicting ? "conflicting" : LADDER_LABEL[s.ladder]}. ` +
        (s.narrowsRangeBy != null && s.narrowsRangeBy > 0
          ? `Verifying it within current bounds narrows the range by ${usd(s.narrowsRangeBy)}. `
          : s.narrowsRangeBy == null ? "Its effect on the range cannot be calculated yet. " : "") +
        s.ask);
    }
    return {
      explanation: expl(`What would strengthen it — ${vc.accountLabel}`,
        "Deterministic sensitivity: range widths are interval arithmetic over the drivers. No confidence percentage is claimed.",
        lines.map((t, i) => ({ label: i === 0 ? "Current range" : `Driver ${i}`, value: t }))),
      significance: vc.defensible && vc.modeledImpact
        ? { label: "Modeled customer impact", value: `${bounds(vc.modeledImpact)}`,
            basis: `interval arithmetic over the evidenced economic drivers; width ${usd(vc.modeledImpact.high - vc.modeledImpact.low)}` }
        : null,
      nextAction: vc.sensitivity[0]
        ? { label: `Strengthen: ${vc.sensitivity[0].label}`, href: `/pursuits/${vc.pursuitId}#value` }
        : null,
      hits: vc.sensitivity.slice(0, 3).map((s) => ({
        group: "What would strengthen it",
        label: s.label,
        sub: s.narrowsRangeBy != null && s.narrowsRangeBy > 0
          ? `narrows the range by ${usd(s.narrowsRangeBy)} · ${s.conflicting ? "conflicting" : LADDER_LABEL[s.ladder]}`
          : `${s.reason}`,
        href: `/pursuits/${vc.pursuitId}#value`,
      })),
    };
  }

  // The three economic truths, labelled — never three bare dollar amounts.
  const parts = [
    `${vc.accountLabel} — value case ${STATE_LABEL[vc.state]}.`,
    vc.defensible && vc.modeledImpact
      ? `Modeled customer impact ${bounds(vc.modeledImpact)} (the customer's business impact, not our revenue).`
      : "No defensible modeled range yet.",
    vc.dealAmount != null ? `Deal amount ${usd(vc.dealAmount)} (what we would book).` : "Deal amount UNKNOWN.",
    vc.expectedValue != null ? `Expected value ${usd(vc.expectedValue)} (probability-weighted).` : "Expected value UNKNOWN.",
    vc.baseline ? `At stake today ${bounds(vc.baseline)} recurring current-state cost.` : "",
    `Evidence: ${qualityLine(vc.quality)}.`,
    vc.because,
  ].filter(Boolean);

  return {
    explanation: expl(`Value case — ${vc.accountLabel}`,
      "Three economic truths, kept distinct. Modeled impact is the customer's business impact, not our revenue.",
      parts.map((t, i) => ({ label: ["State", "Modeled impact", "Deal amount", "Expected value", "At stake today", "Evidence", "Why"][i] ?? "Note", value: t }))),
    significance: vc.defensible && vc.modeledImpact
      ? { label: "Modeled customer impact", value: bounds(vc.modeledImpact),
          basis: "the customer's business impact, distinct from the deal amount and from expected value" }
      : vc.dealAmount != null
        ? { label: "Deal amount", value: usd(vc.dealAmount),
            basis: "what we would book — no defensible modeled customer impact exists yet, so none is stated" }
        : null,
    nextAction: { label: `Open the Value Case for ${vc.accountLabel}`, href: `/pursuits/${vc.pursuitId}#value` },
    hits: vc.drivers.slice(0, 6).map((d) => ({
      group: "Economic drivers",
      label: d.label,
      sub: d.conflicting
        ? `conflicting — ${d.values.map((v) => (v.low === v.high ? usd(v.low) : `${usd(v.low)}–${usd(v.high)}`)).join(" vs ")}`
        : `${LADDER_LABEL[d.ladder]} — ${d.value ? (d.value.low === d.value.high ? usd(d.value.low) : `${usd(d.value.low)}–${usd(d.value.high)}`) : "—"}`,
      href: `/pursuits/${vc.pursuitId}#value`,
    })),
  };
}
