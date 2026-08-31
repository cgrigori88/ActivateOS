import type { PoolClient } from "pg";
import { loadLifecycleFacts, eventsForAccount, primaryLifecycleEvent, type LifecycleEvent, type LifecycleState } from "./state";
import type { ConstraintView } from "@/components/intel/constraint-language";

/**
 * Lifecycle horizon (P2A) — "what changes in the next N days?".
 *
 * Ranking is by EXISTING canonical factors only: lifecycle proximity (days until the event),
 * commercial materiality (the pursuit's expected value), and the state's confidence ordering. There
 * is deliberately NO new composite score and nothing is stored — the ordering is computed at read
 * time from values that already exist, exactly like the Motion funnel's cohorts.
 *
 * UNKNOWN accounts are returned SEPARATELY, never padded into the ranked list: "we don't know" is
 * reported as its own quantity so the answer states its own blind spot.
 */

export interface HorizonItem {
  companyId: string;
  accountLabel: string;
  pursuitId: string | null;
  expectedValue: number | null;
  /** The event driving this item. */
  event: LifecycleEvent;
  /** Why it matters, in one sentence, grounded in canonical state. */
  whyItMatters: string;
  /** The governed next action where one exists — otherwise null (never invented). */
  nextAction: { label: string; deepLink: string } | null;
}

export interface HorizonView {
  days: number;
  items: HorizonItem[];
  /** Σ expected value of the ranked items — the exposure entering the window. */
  exposureUsd: number;
  counts: Record<LifecycleState, number>;
  /** Accounts in scope with NO lifecycle evidence at all — the honest blind spot. */
  unknownAccounts: number;
  truncated: boolean;
}

const CAP = 40;

/** State ordering for the ranked list: a conflict outranks a verified date at equal proximity. */
const STATE_RANK: Record<LifecycleState, number> = {
  CONFLICTING_DATE: 0, VERIFIED_DATE: 1, INFERRED_WINDOW: 2, STALE_DATE: 3, UNKNOWN: 4,
};

export async function getLifecycleHorizon(
  db: PoolClient, orgId: string, opts: { days?: number; companyIds?: string[] | null } = {},
): Promise<HorizonView> {
  const days = opts.days ?? 90;
  const companyIds = opts.companyIds ?? null;
  const now = new Date();

  const factsBy = await loadLifecycleFacts(db, orgId, companyIds);

  // Canonical account + pursuit context for everything in scope (never widens: the same narrowing
  // predicate the rest of the platform uses).
  const scoped = companyIds != null;
  const { rows: accounts } = await db.query<{
    company_id: string; legal_name: string; pursuit_id: string | null; ev: string | null;
  }>(
    `select c.id company_id, c.legal_name,
            pu.id pursuit_id, pu.expected_value_weighted ev
       from companies c
       left join lateral (
         select p.id, p.expected_value_weighted from pursuits p
          where p.account_id = c.id and p.org_id = $1 and p.status not in ('WON','LOST','DISQUALIFIED')
          order by p.expected_value_weighted desc nulls last limit 1) pu on true
      where ($3::boolean is false or c.id = any($2))
        and (exists (select 1 from pursuits p where p.account_id = c.id and p.org_id = $1)
          or exists (select 1 from revenue_motions m where m.company_id = c.id and m.org_id = $1))`,
    [orgId, companyIds ?? [], scoped]);

  const counts: Record<LifecycleState, number> = {
    VERIFIED_DATE: 0, INFERRED_WINDOW: 0, STALE_DATE: 0, CONFLICTING_DATE: 0, UNKNOWN: 0,
  };
  const items: HorizonItem[] = [];
  let unknownAccounts = 0;

  for (const a of accounts) {
    const rows = factsBy.get(a.company_id) ?? [];
    const events = eventsForAccount(rows, now);
    if (events.length === 0) { unknownAccounts++; counts.UNKNOWN++; continue; }

    const primary = primaryLifecycleEvent(events)!;
    counts[primary.state]++;

    // In-window test. A CONFLICTING event is in-window if ANY competing date falls inside it —
    // a disagreement about a near date is exactly what the operator needs to see.
    const inWindow = (() => {
      if (primary.state === "CONFLICTING_DATE") {
        return primary.competing.some((c) => c.date != null && withinDays(new Date(c.date), now, days));
      }
      if (primary.daysUntil == null) return false;
      return primary.daysUntil >= 0 && primary.daysUntil <= days;
    })();
    if (!inWindow) continue;

    items.push({
      companyId: a.company_id, accountLabel: a.legal_name, pursuitId: a.pursuit_id,
      expectedValue: a.ev == null ? null : Number(a.ev),
      event: primary,
      whyItMatters: whyItMatters(primary, a.ev == null ? null : Number(a.ev)),
      nextAction: nextAction(primary, a.pursuit_id),
    });
  }

  items.sort((x, y) =>
    STATE_RANK[x.event.state] - STATE_RANK[y.event.state] ||
    (x.event.daysUntil ?? 9999) - (y.event.daysUntil ?? 9999) ||
    (y.expectedValue ?? 0) - (x.expectedValue ?? 0));

  return {
    days,
    items: items.slice(0, CAP),
    exposureUsd: items.reduce((s, i) => s + (i.expectedValue ?? 0), 0),
    counts, unknownAccounts, truncated: items.length > CAP,
  };
}

function withinDays(d: Date, now: Date, days: number): boolean {
  const delta = Math.round((d.getTime() - now.getTime()) / 86_400_000);
  return delta >= 0 && delta <= days;
}

function whyItMatters(e: LifecycleEvent, ev: number | null): string {
  const money = ev == null ? "This pursuit" : ev >= 1_000_000 ? `$${(ev / 1_000_000).toFixed(1)}M` : `$${Math.round(ev / 1000)}k`;
  switch (e.state) {
    case "CONFLICTING_DATE":
      return `${money} sits on a ${e.label.toLowerCase()} that two active sources disagree about — the commercial window cannot be planned until it is resolved.`;
    case "VERIFIED_DATE":
      return `${money} enters a ${e.label.toLowerCase()} window in ${e.daysUntil} days on a confirmed date.`;
    case "INFERRED_WINDOW":
      return `${money} is believed to enter a ${e.label.toLowerCase()} window — the period is bounded, the exact date is not known.`;
    case "STALE_DATE":
      return `${money} has a ${e.label.toLowerCase()} on record that is past its validity — it may already have happened.`;
    default:
      return `${money} has no authoritative lifecycle evidence.`;
  }
}

function nextAction(e: LifecycleEvent, pursuitId: string | null): { label: string; deepLink: string } | null {
  if (!pursuitId) return null;
  const link = `/pursuits/${pursuitId}#whynow`;
  switch (e.state) {
    case "CONFLICTING_DATE": return { label: "Resolve the date", deepLink: link };
    case "INFERRED_WINDOW":
    case "STALE_DATE": return { label: "Confirm the date", deepLink: link };
    default: return null;   // a verified date needs no evidence action — never invent one
  }
}

/**
 * Lifecycle as a canonical constraint — the SHARED constraint language (P1AB), computed at render
 * time. Non-gating everywhere: lifecycle informs WHY NOW and attention; it does not become a
 * funnel gate (locked P1A semantics — only the declared gates gate).
 */
export function lifecycleConstraint(e: LifecycleEvent, exposureUsd: number | null, pursuitId: string | null): ConstraintView | null {
  if (e.state === "VERIFIED_DATE" || e.state === "UNKNOWN") return null;
  const action = nextAction(e, pursuitId);
  return {
    blockedBy: e.state === "CONFLICTING_DATE" ? `${e.label} date conflicting`
      : e.state === "STALE_DATE" ? `${e.label} date stale`
      : `${e.label} window inferred, not confirmed`,
    why: e.because,
    exposureUsd,
    severity: e.state === "CONFLICTING_DATE" ? "SOFT" : "UNKNOWN",
    action: action ? { label: action.label, deepLink: action.deepLink } : null,
  };
}
