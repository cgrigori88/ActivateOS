import type { ResolveContext, IntentResult, Slots } from "@/lib/search/registry";
import { money } from "@/lib/search/significance";
import { getLifecycleHorizon } from "./horizon";
import { loadLifecycleFacts, eventsForAccount, primaryLifecycleEvent, STATE_LABEL } from "./state";

/**
 * Lifecycle ⌘K intents (P2A), registered through the P2C-0 registry — there is no bespoke parser
 * outside it. All three modes are deterministic reads over the same canonical horizon/state model
 * the rooms use, so a query and a screen can never disagree.
 */

const DEFAULT_DAYS = 90;

/** Parse the lifecycle utterance into a mode + window. Returns null when this is not lifecycle. */
export function parseLifecycleShowMe(q: string): { mode: "horizon" | "conflicting" | "unknown"; days: number | null } | null {
  const lifecycleish = /renew|lifecycle|contract|expir|end[- ]of[- ](life|support)|\beol\b|\beos\b|subscription|what changes/i.test(q);
  if (!lifecycleish) return null;

  if (/conflict|disagree|contradict/i.test(q)) return { mode: "conflicting", days: null };
  if (/unknown|no (renewal|lifecycle) (timing|date)|missing (renewal|lifecycle)/i.test(q)) return { mode: "unknown", days: null };

  // A horizon question needs a window: an explicit "next N days" or the canonical "what changes".
  const m = q.match(/(?:next|within|coming)\s+(\d{1,3})\s*(day|week|month)/i);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2].toLowerCase();
    const days = unit === "day" ? n : unit === "week" ? n * 7 : n * 30;
    return { mode: "horizon", days };
  }
  if (/what changes|next \d+|upcoming|entering/i.test(q)) return { mode: "horizon", days: DEFAULT_DAYS };
  // "Which pursuits renew?" with no window still means the default horizon.
  if (/renew|expir|end[- ]of[- ](life|support)/i.test(q)) return { mode: "horizon", days: DEFAULT_DAYS };
  return null;
}

export async function resolveLifecycleShowMe(
  ctx: ResolveContext, mode: "horizon" | "conflicting" | "unknown", days: number | null,
): Promise<IntentResult> {
  const window = days ?? DEFAULT_DAYS;

  if (mode === "horizon") {
    const view = await getLifecycleHorizon(ctx.db, ctx.orgId, { days: window, companyIds: ctx.companyIds });
    const hits = view.items.map((i) => ({
      group: `Entering a window · next ${view.days} days`,
      label: i.accountLabel,
      sub: `${i.event.label} · ${STATE_LABEL[i.event.state]}${i.event.daysUntil != null ? ` · ${i.event.daysUntil}d` : ""}` +
           `${i.expectedValue != null ? ` · $${Math.round(i.expectedValue / 1000)}k` : ""}`,
      href: i.pursuitId ? `/pursuits/${i.pursuitId}#whynow` : `/accounts/${i.companyId}`,
    }));
    return {
      hits,
      interpreted: `Lifecycle events entering the next ${view.days} days — ranked by state then proximity then value` +
        ` (${view.counts.VERIFIED_DATE} verified · ${view.counts.INFERRED_WINDOW} inferred · ${view.counts.CONFLICTING_DATE} conflicting` +
        ` · ${view.unknownAccounts} accounts with no lifecycle evidence)`,
      note: hits.length === 0
        ? `Nothing enters a lifecycle window in the next ${view.days} days. ${view.unknownAccounts} accounts in scope have no lifecycle evidence at all — UNKNOWN, not zero.`
        : undefined,
      significance: money("Expected value entering the window",
        view.items.reduce((a, i) => a + (i.expectedValue ?? 0), 0),
        `sum of expected value across ${view.items.length} pursuit(s) with a lifecycle event inside ${view.days} days`),
      nextAction: view.items[0]?.pursuitId
        ? { label: `Open the nearest event — ${view.items[0].accountLabel}`, href: `/pursuits/${view.items[0].pursuitId}#whynow` }
        : null,
    };
  }

  // Conflicting / unknown both read the same canonical state, filtered honestly.
  const factsBy = await loadLifecycleFacts(ctx.db, ctx.orgId, ctx.companyIds);
  const scoped = ctx.companyIds != null;
  const { rows: accounts } = await ctx.db.query<{ company_id: string; legal_name: string; pursuit_id: string | null; ev: string | null }>(
    `select c.id company_id, c.legal_name,
            pu.id pursuit_id, pu.expected_value_weighted ev
       from companies c
       left join lateral (
         select p.id, p.expected_value_weighted from pursuits p
          where p.account_id = c.id and p.org_id = $1 and p.status not in ('WON','LOST','DISQUALIFIED')
          order by p.expected_value_weighted desc nulls last limit 1) pu on true
      where ($3::boolean is false or c.id = any($2))
        and exists (select 1 from pursuits p where p.account_id = c.id and p.org_id = $1)`,
    [ctx.orgId, ctx.companyIds ?? [], scoped]);

  const hits: IntentResult["hits"] = [];
  for (const a of accounts) {
    const events = eventsForAccount(factsBy.get(a.company_id) ?? []);
    const primary = primaryLifecycleEvent(events);
    const ev = a.ev == null ? null : Number(a.ev);

    if (mode === "conflicting") {
      if (!primary || primary.state !== "CONFLICTING_DATE") continue;
      hits.push({
        group: "Conflicting lifecycle dates",
        label: a.legal_name,
        sub: `${primary.label} · ${primary.competing.length} competing dates${ev != null ? ` · $${Math.round(ev / 1000)}k` : ""}`,
        href: a.pursuit_id ? `/pursuits/${a.pursuit_id}#whynow` : `/accounts/${a.company_id}`,
      });
    } else {
      // UNKNOWN: no lifecycle evidence at all. High value first — the gap that costs the most.
      if (primary != null) continue;
      hits.push({
        group: "No lifecycle evidence (UNKNOWN)",
        label: a.legal_name,
        sub: `${ev != null ? `$${Math.round(ev / 1000)}k · ` : ""}no renewal, contract or support-lifecycle fact on record`,
        href: a.pursuit_id ? `/pursuits/${a.pursuit_id}#whynow` : `/accounts/${a.company_id}`,
      });
    }
  }
  if (mode === "unknown") {
    hits.sort((x, y) => (parseInt(y.sub?.match(/\$(\d+)k/)?.[1] ?? "0") - parseInt(x.sub?.match(/\$(\d+)k/)?.[1] ?? "0")));
  }

  return {
    hits,
    interpreted: mode === "conflicting"
      ? "Accounts whose active lifecycle facts contradict one another (neither side is chosen)"
      : "Accounts with no authoritative lifecycle evidence — UNKNOWN, distinct from a date of zero",
    note: hits.length === 0
      ? (mode === "conflicting" ? "No lifecycle dates are currently in conflict." : "Every account in scope carries some lifecycle evidence.")
      : undefined,
    significance: money(
      mode === "conflicting" ? "Expected value behind a contested date" : "Expected value with no lifecycle evidence",
      accounts.filter((a) => hits.some((h) => h.label === a.legal_name)).reduce((t, a) => t + Number(a.ev ?? 0), 0),
      `sum of expected value across ${hits.length} account(s) in this state`),
    nextAction: hits[0] ? { label: `Open ${hits[0].label}`, href: hits[0].href } : null,
  };
}

/** EXPLAIN: which lifecycle event is driving this account, with its state and evidence. */
export async function resolveLifecycleExplain(ctx: ResolveContext, accountName: string): Promise<IntentResult> {
  const co = (await ctx.db.query<{ id: string; legal_name: string }>(
    `select id, legal_name from companies c
      where c.legal_name ilike $1
      order by (exists (select 1 from pursuits p where p.account_id = c.id)) desc, length(c.legal_name) asc
      limit 1`, [`%${accountName}%`])).rows[0];
  if (!co) return { note: "No matching records." };
  // Scope narrowing applies to EXPLAIN too — an out-of-scope account is not answerable.
  if (ctx.companyIds != null && !ctx.companyIds.includes(co.id)) return { note: "That account is outside the current ecosystem scope." };

  const events = eventsForAccount((await loadLifecycleFacts(ctx.db, ctx.orgId, [co.id])).get(co.id) ?? []);
  if (events.length === 0) {
    return { note: `No lifecycle evidence on record for ${co.legal_name} — UNKNOWN, not zero. A customer-confirmed renewal date or a first-party contract record would establish it.` };
  }
  const primary = primaryLifecycleEvent(events)!;
  const lines: { label: string; value: string }[] = [
    { label: primary.label, value: STATE_LABEL[primary.state].toUpperCase() },
  ];
  if (primary.date) lines.push({ label: "Date", value: primary.date.slice(0, 10) });
  if (primary.window) lines.push({ label: "Window", value: `${primary.window.from?.slice(0, 10) ?? "—"} → ${primary.window.to?.slice(0, 10) ?? "—"}` });
  if (primary.daysUntil != null) lines.push({ label: "Days until", value: String(primary.daysUntil) });
  for (const c of primary.competing) {
    lines.push({ label: `Competing (${c.provenanceClass.replace(/_/g, " ").toLowerCase()})`, value: c.date?.slice(0, 10) ?? "—" });
  }
  lines.push({ label: "Why", value: primary.because });
  lines.push({ label: "Evidence", value: `${primary.evidenceCount} source${primary.evidenceCount === 1 ? "" : "s"}` });
  if (primary.whatWouldChangeIt) lines.push({ label: "What changes it", value: primary.whatWouldChangeIt });

  return {
    explanation: {
      title: `${primary.label} — ${co.legal_name}`,
      subtitle: "Derived from canonical facts: state, provenance and decay. No date is invented.",
      lines,
      grounding: ["facts (lifecycle predicates)", "fact_contradictions", "fact_evidence", "fact_predicates (freshness policy)"],
    },
  };
}

/** Re-export for the registry's slot typing. */
export type { Slots };
