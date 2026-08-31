import { listIntents, type ResolveContext, type IntentResult, type Slots } from "./registry";
import { renewalProjection } from "@/lib/lifecycle/projection";
import { getValueCase } from "@/lib/value/case";
import { opportunityCondition, CONDITION_LABEL, type ConditionState } from "@/lib/opportunities/condition";

/**
 * Compound pursuit filter (P2C-1 §7). ONE intent that can express a request spanning several
 * constraint families at once — "WWT pursuits over $500K renewing in 90 days without a verified
 * economic buyer" — which the single-family intents structurally cannot: each of them answers its
 * own question completely and none of them intersects.
 *
 * Two rules make this safe:
 *
 *  1. THE SLOT SET IS CLOSED. Every filter below is a named, typed, enumerated slot resolved by
 *     this file's own parameterised SQL. An interpreter tier can select filters; it can never
 *     supply a predicate, an operator, a column or a fragment of SQL, because there is no slot
 *     shaped like one. §7's "do not create ad hoc SQL from the model output" is enforced by the
 *     shape of the contract, not by asking a model nicely.
 *
 *  2. IT ONLY CLAIMS WHAT IT CAN REPRESENT. A request naming a constraint outside this set is
 *     UNSUPPORTED — reported with the part that could not be represented, rather than silently
 *     dropping the constraint and returning a confidently wrong, over-broad list. Dropping an
 *     unrepresentable filter is the dangerous failure here: it returns MORE rows, not fewer.
 *
 * Each family is evaluated by the same canonical source the dedicated surface uses — the renewal
 * projection for lifecycle, `assertion_state` for stakeholder coverage, the Value Case for
 * economics — so a compound answer can never disagree with the room it links to.
 */

export const COMPOUND_FAMILIES = ["partner", "amount", "lifecycle", "stakeholder", "value", "condition", "stage"] as const;
export type CompoundFamily = (typeof COMPOUND_FAMILIES)[number];

export const MISSING_ROLES = ["economic_buyer", "champion", "technical_buyer"] as const;
export const VALUE_STATES = ["none", "conflicting", "defensible"] as const;
export const CONDITIONS = ["at_risk", "stalling", "healthy"] as const;
export const STAGES = ["discovery", "qualification", "business_validation", "proposal", "negotiation"] as const;

export interface CompoundFilters {
  partner: string | null;
  amountGt: number | null;
  amountLt: number | null;
  renewalWithinDays: number | null;
  missingRole: string | null;
  valueState: string | null;
  condition: string | null;
  stages: string[] | null;
}

/** Which families a filter bag actually constrains. Used for the ≥2 rule and for the read-back. */
export function familiesOf(f: CompoundFilters): CompoundFamily[] {
  const out: CompoundFamily[] = [];
  if (f.partner) out.push("partner");
  if (f.amountGt != null || f.amountLt != null) out.push("amount");
  if (f.renewalWithinDays != null) out.push("lifecycle");
  if (f.missingRole) out.push("stakeholder");
  if (f.valueState) out.push("value");
  if (f.condition) out.push("condition");
  if (f.stages && f.stages.length) out.push("stage");
  return out;
}

export function filtersFromSlots(slots: Slots): CompoundFilters {
  const s = (k: string) => (typeof slots[k] === "string" ? (slots[k] as string) : null);
  const n = (k: string) => (typeof slots[k] === "number" ? (slots[k] as number) : null);
  return {
    partner: s("partner"),
    amountGt: n("amountGt"),
    amountLt: n("amountLt"),
    renewalWithinDays: n("renewalWithinDays"),
    missingRole: s("missingRole"),
    valueState: s("valueState"),
    condition: s("condition"),
    stages: Array.isArray(slots.stages) ? (slots.stages as string[]) : null,
  };
}

const money = (raw: string): number | null => {
  const m = raw.replace(/[, ]/g, "").match(/\$?([\d.]+)\s*([mk])?/i);
  if (!m) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return null;
  const u = (m[2] ?? "").toLowerCase();
  return u === "m" ? v * 1_000_000 : u === "k" ? v * 1000 : v;
};

/**
 * Is this family set already representable by ONE registered intent?
 *
 * Derived from the registry's own `families` declarations rather than hardcoded, so adding a
 * capability to a specialist automatically narrows what the compound intent claims. This is the
 * exact criterion §7 sets out — "support compound requests only where the current registry can
 * represent them" — read from the registry instead of restated beside it.
 *
 * A count-based rule ("two or more constraints") is NOT good enough and was the first thing tried:
 * "at-risk late-stage opportunities over $500k" spans three families that `opportunity.filter`
 * already handles jointly, and routing it here would have taken a well-answered query away from
 * the specialist that owns its vocabulary.
 */
export function coveredBySingleIntent(families: CompoundFamily[]): boolean {
  return listIntents().some((d) =>
    d.intentClass === "showme"
    && d.intentKey !== "pursuit.compound"
    && d.families != null
    && families.every((f) => d.families!.includes(f)));
}

/**
 * Deterministic parse. Returns null unless the requested constraints span MORE than any single
 * registered intent can represent — a request a specialist owns belongs to that specialist, which
 * answers it better and with its own vocabulary. That rule is what lets this intent sit at the top
 * of the precedence order without shadowing anything: it declines every query a specialist owns.
 */
export function parseCompound(q: string): CompoundFilters | null {
  const lower = q.toLowerCase();

  const pm = q.match(/\b([A-Z][\w&.-]{1,20})\s+(?:pursuits?|opportunit\w*|deals?)\b/)
    ?? q.match(/\b(?:through|via|with)\s+([A-Z][\w&.-]{1,20})\b/);
  const partner = pm && !/^(Show|List|Which|What|The|All|High|Our|My)$/i.test(pm[1]) ? pm[1] : null;

  // `\s*` BEFORE the optional `$` — see the same fix in query.ts. Without it "over $500K" parses
  // to no bound at all, and a dropped amount filter returns more rows than were asked for.
  const gt = lower.match(/(?:over|above|greater than|more than|>)\s*\$?\s*([\d.,]+\s*[mk]?)/);
  const lt = lower.match(/(?:under|below|less than|<)\s*\$?\s*([\d.,]+\s*[mk]?)/);

  // A renewal window: "renewing in 90 days", "renewals in the next quarter", "expiring within 60 days".
  let renewalWithinDays: number | null = null;
  if (/renew|expir|end[- ]of[- ](life|support)|contract\s+end/i.test(lower)) {
    const d = lower.match(/(\d{1,3})\s*days?/);
    const mo = lower.match(/(\d{1,2})\s*months?/);
    renewalWithinDays = d ? Number(d[1]) : mo ? Number(mo[1]) * 30 : /quarter/.test(lower) ? 90 : 90;
  }

  const lacking = /\b(without|missing|lack(?:s|ing)?|no verified|un(?:covered|identified))\b/i.test(q);
  const missingRole = lacking
    ? (/economic\s+buyer/i.test(q) ? "economic_buyer"
      : /champion/i.test(q) ? "champion"
      : /technical\s+(?:buyer|validator)/i.test(q) ? "technical_buyer" : null)
    : null;

  const valueState = /conflicting\s+(economics|value)|contested\s+economics/i.test(q) ? "conflicting"
    : (lacking && /value case|business case|economics/i.test(q)) ? "none"
    : /defensible\s+value case/i.test(q) ? "defensible" : null;

  const condition = /at[- ]risk/.test(lower) ? "at_risk" : /stalling/.test(lower) ? "stalling" : null;

  const stages: string[] = [];
  if (/late[- ]stage/.test(lower)) stages.push("proposal", "negotiation");
  else for (const st of STAGES) if (lower.includes(st.replace(/_/g, " "))) stages.push(st);

  const filters: CompoundFilters = {
    partner,
    amountGt: gt ? money(gt[1]) : null,
    amountLt: lt ? money(lt[1]) : null,
    renewalWithinDays,
    missingRole,
    valueState,
    condition,
    stages: stages.length ? [...new Set(stages)] : null,
  };
  const fams = familiesOf(filters);
  return fams.length >= 2 && !coveredBySingleIntent(fams) ? filters : null;
}

interface Row {
  id: string; account_id: string; legal_name: string; ev: string | null;
  amount: string | null; stage: string | null; updated_at: Date | null; partner: string | null;
}

export function readBack(f: CompoundFilters): string {
  const parts: string[] = [];
  if (f.partner) parts.push(`routed via ${f.partner}`);
  if (f.amountGt != null) parts.push(`amount > $${Math.round(f.amountGt / 1000)}k`);
  if (f.amountLt != null) parts.push(`amount < $${Math.round(f.amountLt / 1000)}k`);
  if (f.renewalWithinDays != null) parts.push(`lifecycle event within ${f.renewalWithinDays} days`);
  if (f.missingRole) parts.push(`no VERIFIED ${f.missingRole.replace(/_/g, " ")}`);
  if (f.valueState) parts.push(f.valueState === "none" ? "no defensible Value Case"
    : f.valueState === "conflicting" ? "contested economics" : "a defensible Value Case");
  if (f.condition) parts.push(CONDITION_LABEL[f.condition as ConditionState] ?? f.condition);
  if (f.stages?.length) parts.push(`stage ∈ {${f.stages.map((s) => s.replace(/_/g, " ")).join(", ")}}`);
  return `Pursuits — ${parts.join(" AND ")}`;
}

export async function resolveCompound(ctx: ResolveContext, f: CompoundFilters): Promise<IntentResult> {
  const fams = familiesOf(f);
  if (fams.length < 2 || coveredBySingleIntent(fams)) {
    return { hits: [], note: "A single registered intent already answers that combination — ask it directly and the specialist answer is better." };
  }

  const scoped = ctx.companyIds != null;
  const params: unknown[] = [ctx.orgId, ctx.companyIds ?? [], scoped];
  const P = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const where: string[] = [
    "pu.org_id = $1",
    "pu.status not in ('WON','LOST','DISQUALIFIED')",
    "($3::boolean is false or pu.account_id = any($2))",
  ];

  if (f.partner) where.push(`sp.name ilike ${P(`%${f.partner}%`)}`);
  if (f.amountGt != null) where.push(`o.amount_usd > ${P(f.amountGt)}`);
  if (f.amountLt != null) where.push(`o.amount_usd < ${P(f.amountLt)}`);
  if (f.stages?.length) where.push(`o.stage = any(${P(f.stages)})`);
  if (f.missingRole) {
    // Coverage is only ESTABLISHED once an opportunity exists (P1C). A pre-opportunity pursuit is
    // UNKNOWN, not a gap, so it must not be returned as one.
    where.push(`exists (select 1 from opportunities o2 where o2.pursuit_id = pu.id)`);
    where.push(
      `not exists (select 1 from opportunities o2 join stakeholders st on st.opportunity_id = o2.id
                    where o2.pursuit_id = pu.id and st.role = ${P(f.missingRole)} and st.assertion_state = 'verified')`);
  }
  if (f.condition || f.amountGt != null || f.amountLt != null || f.stages?.length) {
    where.push(`o.id is not null`);
  }

  const { rows } = await ctx.db.query<Row>(
    `select distinct on (pu.id) pu.id, pu.account_id, c.legal_name, pu.expected_value_weighted ev,
            o.amount_usd amount, o.stage, o.updated_at, sp.name partner
       from pursuits pu
       join companies c on c.id = pu.account_id
       left join pursuit_route_snapshots s on s.pursuit_id = pu.id and s.is_current
       left join partners sp on sp.id = coalesce(s.selected_partner_id, s.recommended_partner_id)
       left join opportunities o on o.pursuit_id = pu.id and o.stage not in ('closed_won','closed_lost')
      where ${where.join(" and ")}
      order by pu.id, o.amount_usd desc nulls last
      limit 300`, params);

  // Post-SQL families. Each is evaluated by the canonical engine that owns it — a second reading
  // of a renewal date or an economic figure here is exactly the divergence P2A and P2B removed.
  let kept = rows;

  if (f.condition) {
    kept = kept.filter((r) => r.stage && r.updated_at
      && opportunityCondition({ stage: r.stage, updatedAt: r.updated_at.toISOString() }).state === f.condition);
  }

  if (f.renewalWithinDays != null) {
    const proj = await renewalProjection(ctx.db, ctx.orgId, {
      days: f.renewalWithinDays,
      companyIds: ctx.companyIds,
      limit: 500,
    });
    const inWindow = new Set(proj.map((p) => p.companyId));
    kept = kept.filter((r) => inWindow.has(r.account_id));
  }

  if (f.valueState) {
    const out: Row[] = [];
    for (const r of kept.slice(0, 60)) {
      const vc = await getValueCase(ctx.db, ctx.orgId, r.id);
      const match = f.valueState === "none" ? !vc || !vc.defensible
        : f.valueState === "conflicting" ? vc?.state === "CONFLICTING"
        : !!vc?.defensible;
      if (match) out.push(r);
    }
    kept = out;
  }

  kept.sort((a, b) => Number(b.ev ?? 0) - Number(a.ev ?? 0));

  const usd = (v: string | null) => (v == null ? null : `$${Math.round(Number(v) / 1000)}k`);
  return {
    hits: kept.slice(0, 20).map((r) => ({
      group: `Matches all ${fams.length} constraints`,
      label: r.legal_name,
      sub: [usd(r.amount) ?? (r.ev ? `${usd(r.ev)} expected` : null), r.stage?.replace(/_/g, " "), r.partner ? `via ${r.partner}` : null]
        .filter(Boolean).join(" · ") || "open pursuit",
      href: `/pursuits/${r.id}`,
    })),
    interpreted: `${readBack(f)} — every constraint applied, none dropped`,
    note: kept.length === 0
      ? `No pursuit satisfies all ${fams.length} constraints together. Each one alone may still return rows.`
      : `${kept.length} pursuit${kept.length === 1 ? "" : "s"} satisfy all ${fams.length} constraints.`,
  };
}
