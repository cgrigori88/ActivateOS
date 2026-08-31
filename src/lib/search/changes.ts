import type { ResolveContext, IntentResult } from "./registry";

/**
 * "What changed?" (P2C-1 §9). Materiality BEFORE chronology, over the append-only change ledger —
 * which already carries every governed decision, route recommendation change, fact promotion and
 * supersession, stakeholder assertion, lifecycle date confirmation, economic assertion, team
 * movement and recorded outcome, each with its own materiality and reason.
 *
 * This is deliberately NOT a generic activity summary. It answers from one canonical, append-only
 * table using that table's own materiality column; it does not rank, score, summarise or narrate.
 * A LOW-materiality event is not promoted because it is recent, and a CRITICAL one is not buried
 * because it is old — which is the whole point of asking "what materially changed".
 */

const DAY_MS = 86_400_000;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Materiality rank — the ledger's own vocabulary, ordered. */
const RANK: Record<string, number> = { CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0 };

export interface ChangeWindow {
  days: number;
  /** How the window was chosen, stated in the answer so a default is never mistaken for a reading. */
  basis: string;
}

/**
 * Resolve a time window from the words. Everything here is arithmetic on the clock — no anchor is
 * inferred from data the record does not hold. "Since my last review" has NO canonical anchor
 * (PursuitOS stores no per-operator review timestamp), so it falls back to seven days and the
 * answer says so rather than implying it knows when you last looked.
 */
export function parseChangeWindow(q: string, now = new Date()): ChangeWindow {
  const m = q.match(/\b(?:last|past|previous)\s+(\d{1,3})\s*(day|week)s?\b/i);
  if (m) {
    const n = Number(m[1]) * (/week/i.test(m[2]) ? 7 : 1);
    return { days: Math.min(n, 365), basis: `the last ${n} days` };
  }
  if (/\btoday\b/i.test(q)) return { days: 1, basis: "today" };
  if (/\byesterday\b/i.test(q)) return { days: 2, basis: "since yesterday" };
  if (/\bthis\s+week\b/i.test(q)) return { days: 7, basis: "this week" };
  if (/\blast\s+week\b/i.test(q)) return { days: 14, basis: "the last two weeks" };
  if (/\bthis\s+month\b|\blast\s+month\b/i.test(q)) return { days: 30, basis: "the last 30 days" };
  if (/\bthis\s+quarter\b/i.test(q)) return { days: 90, basis: "the last 90 days" };

  const wd = q.match(/\bsince\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
  if (wd) {
    const target = WEEKDAYS.indexOf(wd[1].toLowerCase());
    // The most recent PAST occurrence. "Since Friday" asked on a Friday means a week ago, not
    // zero days ago — an empty window would be a wrong answer, not a precise one.
    const delta = ((now.getUTCDay() - target + 7) % 7) || 7;
    return { days: delta, basis: `since ${WEEKDAYS[target].replace(/^\w/, (c) => c.toUpperCase())} (${delta} days)` };
  }
  if (/\b(my\s+)?last\s+(review|visit|check[- ]?in|login)\b/i.test(q)) {
    return { days: 7, basis: "the last 7 days — the record holds no timestamp for when you last reviewed it, so no such anchor was assumed" };
  }
  return { days: 7, basis: "the last 7 days (default window)" };
}

export interface ParsedChange { account: string | null; days: number; materialOnly: boolean }

/** Deterministic parse. Returns null when this is not a "what changed" question. */
export function parseChanges(q: string): ParsedChange | null {
  // Up to two intervening words, so "what materially changed" and "what has actually changed"
  // read the same as "what changed" — a paraphrase this narrow should not need a model.
  if (!/\bwhat\b(?:\s+[\w']+){0,2}\s+changed\b|\bchanges?\s+since\b|\brecent\s+changes\b|\bwhat(?:'s| is)\s+new\b/i.test(q)) return null;
  const w = parseChangeWindow(q);
  // "materially" asks for the HIGH/CRITICAL cut explicitly; the default is already that cut,
  // because "what changed" over a live commercial record is otherwise a firehose.
  const materialOnly = !/\ball\s+changes\b|\beverything\b|\bincluding\s+minor\b/i.test(q);
  const m = q.match(/\b(?:on|for|at|about)\s+([A-Z][\w.&'-]*(?:\s+[A-Z][\w.&'-]*)*)/);
  const account = m?.[1]?.trim() ?? null;
  return { account, days: w.days, materialOnly };
}

interface LedgerRow {
  change_type: string; materiality: string; reason: string | null;
  entity_type: string; occurred_at: Date; actor_type: string | null;
  pursuit_id: string | null; account_label: string | null; company_id: string | null;
}

export async function resolveChanges(
  ctx: ResolveContext, opts: { account: string | null; days: number; materialOnly: boolean },
): Promise<IntentResult> {
  const scoped = ctx.companyIds != null;

  // An account filter is resolved to ids INSIDE the authorized set — never globally and then
  // filtered, so a look-alike outside scope can neither be read nor cause the wrong refusal.
  let companyFilter: string[] | null = null;
  if (opts.account) {
    const { rows } = await ctx.db.query<{ id: string }>(
      `select c.id from companies c
        where c.legal_name ilike $1 and ($3::boolean is false or c.id = any($2))
        order by length(c.legal_name) limit 5`,
      [`%${opts.account}%`, ctx.companyIds ?? [], scoped]);
    if (rows.length === 0) {
      return { hits: [], interpreted: `Changes on "${opts.account}"`, note: `No account matching "${opts.account}" is readable in the current scope.` };
    }
    companyFilter = rows.map((r) => r.id);
  }

  const { rows } = await ctx.db.query<LedgerRow>(
    `select cl.change_type, cl.materiality, cl.reason, cl.entity_type, cl.occurred_at, cl.actor_type,
            cl.pursuit_id, c.legal_name account_label, c.id company_id
       from change_ledger cl
       left join pursuits pu on pu.id = cl.pursuit_id
       left join companies c on c.id = pu.account_id
      where cl.org_id = $1
        and cl.occurred_at >= now() - ($2 || ' days')::interval
        and ($3::boolean is false or cl.materiality in ('HIGH','CRITICAL'))
        and ($5::boolean is false or pu.account_id = any($4))
        and ($7::boolean is false or pu.account_id = any($6))
      order by cl.occurred_at desc
      limit 400`,
    [ctx.orgId, String(opts.days), opts.materialOnly,
     ctx.companyIds ?? [], scoped,
     companyFilter ?? [], companyFilter != null]);

  // MATERIALITY BEFORE CHRONOLOGY (§9). The SQL orders by time only so the LIMIT takes the most
  // recent slice of a long window; the presented order is materiality first, time second.
  const sorted = [...rows].sort(
    (a, b) => (RANK[b.materiality] ?? 0) - (RANK[a.materiality] ?? 0) || b.occurred_at.getTime() - a.occurred_at.getTime());

  const word = (t: string) => t.replace(/_/g, " ").toLowerCase();
  const ago = (d: Date) => {
    const days = Math.floor((Date.now() - d.getTime()) / DAY_MS);
    return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days}d ago`;
  };

  const hits = sorted.slice(0, 15).map((r) => ({
    group: `${r.materiality === "CRITICAL" ? "Critical" : r.materiality === "HIGH" ? "Material" : "Other"} change`,
    label: `${r.account_label ?? word(r.entity_type)} — ${word(r.change_type)}`,
    sub: `${r.reason ?? "no reason recorded"} · ${ago(r.occurred_at)}${r.actor_type ? ` · ${r.actor_type.toLowerCase()}` : ""}`,
    // Today lives at the root, not at /today — a ledger entry with no pursuit or account behind it
    // has to land somewhere real, and "/today" is a 404.
    href: r.pursuit_id ? `/pursuits/${r.pursuit_id}` : r.company_id ? `/accounts/${r.company_id}` : "/",
  }));

  const counts = sorted.reduce<Record<string, number>>((a, r) => ({ ...a, [r.materiality]: (a[r.materiality] ?? 0) + 1 }), {});
  const summary = ["CRITICAL", "HIGH", "MEDIUM", "LOW"]
    .filter((k) => counts[k]).map((k) => `${counts[k]} ${k.toLowerCase()}`).join(", ");

  return {
    hits,
    interpreted:
      `Change ledger${opts.account ? ` for ${opts.account}` : ""} over the last ${opts.days} day${opts.days === 1 ? "" : "s"}` +
      `${opts.materialOnly ? ", material changes only (HIGH/CRITICAL)" : ", every recorded change"} — ordered by materiality, then time`,
    note: sorted.length === 0
      ? `Nothing${opts.materialOnly ? " material" : ""} was recorded in that window.`
      : `${summary}${sorted.length > hits.length ? ` · showing the top ${hits.length}` : ""}.`,
    // No dollar figure. The ledger records WHAT changed and how material it was; it does not carry
    // a commercial value per entry, and summing the pursuits behind the entries would double-count
    // an account that changed three times. An absent figure is the correct output.
    significance: null,
    nextAction: hits[0] ? { label: `Open ${hits[0].label.split(" — ")[0]}`, href: hits[0].href } : null,
  };
}
