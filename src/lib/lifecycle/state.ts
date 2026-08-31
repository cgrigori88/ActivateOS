import type { Pool, PoolClient } from "pg";

/**
 * Lifecycle date states (P2A). DERIVED from the existing canonical fact columns — no new stored
 * status, no new table, no second timing score. Everything below is a reading of `facts` +
 * `fact_predicates` + `fact_contradictions` + `fact_evidence`.
 *
 *   VERIFIED DATE     trusted, current evidence supports a SPECIFIC date
 *   INFERRED WINDOW   evidence supports a bounded PERIOD but not a precise date
 *   STALE DATE        a prior date exists but is beyond its validity/decay policy
 *   CONFLICTING DATE  active canonical facts contradict one another
 *   UNKNOWN           no authoritative lifecycle evidence
 *
 * CONFLICTING and STALE are never collapsed into UNKNOWN: "we disagree with ourselves" and "we knew
 * this once" are different commercial situations from "we never knew".
 *
 * Precedence when several apply to one account+predicate: CONFLICTING > VERIFIED > INFERRED_WINDOW
 * > STALE > UNKNOWN. A conflict outranks a verified date because acting on one of two disagreeing
 * dates is the more dangerous error.
 */

export type LifecycleState = "VERIFIED_DATE" | "INFERRED_WINDOW" | "STALE_DATE" | "CONFLICTING_DATE" | "UNKNOWN";

/** Provenance classes that may support a PRECISE verified date (the false-precision boundary). */
export const TRUSTED_FOR_PRECISE_DATE = new Set([
  "FIRST_PARTY", "SECOND_PARTY", "THIRD_PARTY_VERIFIED", "CUSTOMER_DECLARED", "HUMAN_ASSERTED",
]);

/** The lifecycle predicate vocabulary this read model reasons over (registry keys, 0069 + 0098). */
export const LIFECYCLE_PREDICATES = [
  "renewal_date", "contract_expires", "subscription_term_end", "migration_deadline",
  "end_of_life_date", "end_of_support_date", "renewal_window", "support_lifecycle_phase",
  "compliance_deadline",
] as const;

export const PREDICATE_LABEL: Record<string, string> = {
  renewal_date: "Renewal", contract_expires: "Contract expiry", subscription_term_end: "Subscription term end",
  migration_deadline: "Migration deadline", end_of_life_date: "End of life", end_of_support_date: "End of support",
  renewal_window: "Renewal window", support_lifecycle_phase: "Support lifecycle", compliance_deadline: "Compliance deadline",
};

export const STATE_LABEL: Record<LifecycleState, string> = {
  VERIFIED_DATE: "verified", INFERRED_WINDOW: "inferred window", STALE_DATE: "stale",
  CONFLICTING_DATE: "conflicting", UNKNOWN: "unknown",
};

/** One lifecycle fact as stored, before state derivation. */
export interface LifecycleFactRow {
  factId: string;
  companyId: string;
  predicateKey: string;
  status: string;                      // facts.status
  provenanceClass: string;             // facts.provenance_class
  freshnessPolicy: string;             // facts.freshness_policy
  halfLifeDays: number | null;
  dateValue: Date | null;
  validFrom: Date | null;
  validUntil: Date | null;
  asOf: Date;
  observedLastAt: Date;
  confidence: number;
  supersededBy: string | null;
  contradictionOpen: boolean;          // an open row in fact_contradictions touches this fact
  /** The other facts an OPEN contradiction links this one to. A contradiction is frequently
   *  CROSS-PREDICATE (a `contract_expires` disagreeing with a `renewal_date`), so the competing
   *  side often lives outside this predicate's own rows. */
  contradictsFactIds: string[];
  evidenceCount: number;
  sourceLabel: string | null;          // the fact's subject label / originating source hint
}

/** A lifecycle event as the product speaks about it. */
export interface LifecycleEvent {
  predicateKey: string;
  label: string;
  state: LifecycleState;
  /** A precise date — present ONLY for VERIFIED_DATE and STALE_DATE. */
  date: string | null;
  /** A bounded window — present for INFERRED_WINDOW (and for any fact carrying valid_from/until). */
  window: { from: string | null; to: string | null } | null;
  /** Days until the date, or until the NEAR edge of the window. Null when unknowable. */
  daysUntil: number | null;
  /** Competing values when CONFLICTING — every side, never a pick. */
  competing: { factId: string; date: string | null; provenanceClass: string; sourceLabel: string | null; predicateKey: string }[];
  facts: LifecycleFactRow[];           // the underlying facts, for progressive disclosure
  evidenceCount: number;
  /** Why the state is what it is — one plain sentence, always renderable. */
  because: string;
  /** What would move this to VERIFIED_DATE. Null when already verified. */
  whatWouldChangeIt: string | null;
}

const DAY = 86_400_000;
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const daysBetween = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / DAY);

/** Beyond its decay policy? VALID_UNTIL facts expire by date; DECAYING facts age out on half-life. */
export function isStale(f: LifecycleFactRow, now: Date): boolean {
  if (f.status === "STALE" || f.status === "EXPIRED") return true;
  if (f.freshnessPolicy === "VALID_UNTIL") {
    const edge = f.validUntil ?? f.dateValue;
    return edge != null && edge.getTime() < now.getTime();
  }
  if (f.halfLifeDays != null) {
    return now.getTime() - f.observedLastAt.getTime() > f.halfLifeDays * DAY;
  }
  return false;
}

/**
 * Derive the state of ONE lifecycle predicate at ONE account from its facts. Pure and total —
 * every input produces a state, and an empty input produces UNKNOWN rather than an exception.
 */
export function deriveLifecycleEvent(
  predicateKey: string, rows: LifecycleFactRow[], now = new Date(), peers: LifecycleFactRow[] = [],
): LifecycleEvent {
  const label = PREDICATE_LABEL[predicateKey] ?? predicateKey.replace(/_/g, " ");
  const base = {
    predicateKey, label, date: null as string | null, window: null as LifecycleEvent["window"],
    daysUntil: null as number | null, competing: [] as LifecycleEvent["competing"],
    facts: rows, evidenceCount: rows.reduce((s, r) => s + r.evidenceCount, 0),
  };

  // Only rows that are still part of the current picture. Superseded rows are history, not truth.
  const live = rows.filter((r) => r.supersededBy == null && r.status !== "SUPERSEDED" && r.status !== "REJECTED");
  if (live.length === 0) {
    return { ...base, state: "UNKNOWN", because: "No authoritative lifecycle evidence on this account.",
      whatWouldChangeIt: "A customer-confirmed date, or a first-party contract record." };
  }

  // ── CONFLICTING: an open contradiction, or two live facts asserting different dates ──────────
  const dated = live.filter((r) => r.dateValue != null);
  const distinctDates = new Set(dated.map((r) => r.dateValue!.toISOString().slice(0, 10)));
  const contradicted = live.some((r) => r.contradictionOpen) || r0(live).some((r) => r.status === "DISPUTED");
  if (contradicted || distinctDates.size > 1) {
    // The competing set is the union of this predicate's own dated rows and every fact an OPEN
    // contradiction links them to — including facts under a DIFFERENT predicate. Showing one date
    // beside the word "conflicting" would be the exact false confidence this state exists to remove.
    const linked = new Set(live.flatMap((r) => r.contradictsFactIds));
    const counterparts = peers.filter((p) => linked.has(p.factId) && p.dateValue != null);
    const seen = new Set<string>();
    const competing = [...dated, ...counterparts]
      .filter((r) => (seen.has(r.factId) ? false : (seen.add(r.factId), true)))
      .map((r) => ({
        factId: r.factId, date: iso(r.dateValue), provenanceClass: r.provenanceClass,
        sourceLabel: r.sourceLabel, predicateKey: r.predicateKey,
      }))
      .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
    const distinct = new Set(competing.map((c) => c.date?.slice(0, 10)).filter(Boolean));
    return {
      ...base, state: "CONFLICTING_DATE", competing,
      because: distinct.size > 1
        ? `${distinct.size} active sources give different dates.`
        : "An open contradiction is recorded against this date.",
      whatWouldChangeIt: "Verify the commercial date with the customer — the disagreement is resolved by evidence, not by choosing.",
    };
  }

  // ── The single live fact that speaks for this predicate (highest confidence, freshest) ───────
  const best = [...live].sort((a, b) => b.confidence - a.confidence || b.observedLastAt.getTime() - a.observedLastAt.getTime())[0];
  const stale = isStale(best, now);
  const trusted = TRUSTED_FOR_PRECISE_DATE.has(best.provenanceClass);
  const window = best.validFrom || best.validUntil ? { from: iso(best.validFrom), to: iso(best.validUntil) } : null;

  // ── STALE: we knew this once. Distinct from UNKNOWN, and the date is still shown as history. ─
  if (stale) {
    const d = best.dateValue ?? best.validUntil;
    return {
      ...base, state: "STALE_DATE", date: iso(best.dateValue), window,
      daysUntil: d ? daysBetween(d, now) : null,
      because: best.freshnessPolicy === "VALID_UNTIL"
        ? "The date this was valid until has already passed."
        : `Last observed ${daysBetween(now, best.observedLastAt)} days ago — beyond this predicate's freshness policy.`,
      whatWouldChangeIt: "Re-confirm the date; the previous value is kept as history either way.",
    };
  }

  // ── INFERRED WINDOW: no precise date, or a source not trusted for precision. ─────────────────
  if (best.dateValue == null || !trusted) {
    const near = best.validFrom ?? best.dateValue;
    return {
      ...base, state: "INFERRED_WINDOW",
      date: null,                          // never present a window as a day
      window: window ?? (best.dateValue ? { from: iso(best.dateValue), to: iso(best.dateValue) } : null),
      daysUntil: near ? daysBetween(near, now) : null,
      because: best.dateValue == null
        ? "Evidence supports a period, not a specific date."
        : `The source (${best.provenanceClass.replace(/_/g, " ").toLowerCase()}) is not trusted for a precise date.`,
      whatWouldChangeIt: "A customer-confirmed renewal date, or a first-party contract record.",
    };
  }

  // ── VERIFIED DATE ────────────────────────────────────────────────────────────────────────────
  return {
    ...base, state: "VERIFIED_DATE", date: iso(best.dateValue), window,
    daysUntil: daysBetween(best.dateValue, now),
    because: `${best.provenanceClass.replace(/_/g, " ").toLowerCase()} evidence supports this date.`,
    whatWouldChangeIt: null,
  };
}

/** Tiny helper kept separate so the CONFLICTING branch reads as one condition. */
function r0(rows: LifecycleFactRow[]): LifecycleFactRow[] { return rows; }

/** The single most commercially relevant event for an account (soonest actionable, conflicts first). */
export function primaryLifecycleEvent(events: LifecycleEvent[]): LifecycleEvent | null {
  if (events.length === 0) return null;
  const rank: Record<LifecycleState, number> = {
    CONFLICTING_DATE: 0, VERIFIED_DATE: 1, INFERRED_WINDOW: 2, STALE_DATE: 3, UNKNOWN: 4,
  };
  return [...events].sort((a, b) =>
    rank[a.state] - rank[b.state] ||
    (a.daysUntil ?? Number.MAX_SAFE_INTEGER) - (b.daysUntil ?? Number.MAX_SAFE_INTEGER))[0];
}

/** Load the lifecycle facts for a set of accounts. RLS-scoped; company narrowing is caller-supplied. */
export async function loadLifecycleFacts(
  db: Pool | PoolClient, orgId: string, companyIds: string[] | null,
): Promise<Map<string, LifecycleFactRow[]>> {
  const scoped = companyIds != null;
  const { rows } = await db.query<{
    fact_id: string; company_id: string; predicate_key: string; status: string; provenance_class: string;
    freshness_policy: string; half_life_days: number | null; date_value: Date | null; valid_from: Date | null;
    valid_until: Date | null; as_of: Date; observed_last_at: Date; confidence: string; superseded_by: string | null;
    contradiction_open: boolean; contradicts: string[]; evidence_count: string; source_label: string | null;
  }>(
    `select f.id fact_id, f.company_id, f.predicate_key, f.status, f.provenance_class,
            f.freshness_policy, f.half_life_days, f.date_value, f.valid_from, f.valid_until,
            f.as_of, f.observed_last_at, f.confidence, f.superseded_by,
            exists (select 1 from fact_contradictions fc
                     where fc.status = 'open' and (fc.fact_id_a = f.id or fc.fact_id_b = f.id)) contradiction_open,
            coalesce((select array_agg(case when fc.fact_id_a = f.id then fc.fact_id_b else fc.fact_id_a end)
                        from fact_contradictions fc
                       where fc.status = 'open' and (fc.fact_id_a = f.id or fc.fact_id_b = f.id)), '{}') contradicts,
            (select count(*) from fact_evidence fe where fe.fact_id = f.id)::text evidence_count,
            f.subject_label source_label
       from facts f
      where f.org_id = $1
        and f.predicate_key = any($2)
        and f.company_id is not null
        and ($4::boolean is false or f.company_id = any($3))
      order by f.company_id, f.predicate_key, f.confidence desc`,
    [orgId, [...LIFECYCLE_PREDICATES], companyIds ?? [], scoped]);

  const by = new Map<string, LifecycleFactRow[]>();
  for (const r of rows) {
    const row: LifecycleFactRow = {
      factId: r.fact_id, companyId: r.company_id, predicateKey: r.predicate_key, status: r.status,
      provenanceClass: r.provenance_class, freshnessPolicy: r.freshness_policy, halfLifeDays: r.half_life_days,
      dateValue: r.date_value, validFrom: r.valid_from, validUntil: r.valid_until, asOf: r.as_of,
      observedLastAt: r.observed_last_at, confidence: Number(r.confidence), supersededBy: r.superseded_by,
      contradictionOpen: r.contradiction_open, contradictsFactIds: r.contradicts ?? [],
      evidenceCount: Number(r.evidence_count), sourceLabel: r.source_label,
    };
    const list = by.get(r.company_id) ?? [];
    list.push(row);
    by.set(r.company_id, list);
  }
  return by;
}

/** Derive every lifecycle event for one account from its loaded facts. */
export function eventsForAccount(rows: LifecycleFactRow[], now = new Date()): LifecycleEvent[] {
  const byPredicate = new Map<string, LifecycleFactRow[]>();
  for (const r of rows) {
    const list = byPredicate.get(r.predicateKey) ?? [];
    list.push(r);
    byPredicate.set(r.predicateKey, list);
  }
  // Every OTHER lifecycle fact on this account is available as a peer, so a cross-predicate
  // contradiction can name both sides instead of each predicate asserting its own date alone.
  return [...byPredicate.entries()].map(([k, v]) =>
    deriveLifecycleEvent(k, v, now, rows.filter((r) => r.predicateKey !== k)));
}
