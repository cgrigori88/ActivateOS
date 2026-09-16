import type { Pool, PoolClient } from "pg";
import { compareProvenance, resolveTie, type Resolution } from "@/lib/facts/provenance-precedence";

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

/** Two nullable instants are the same instant (or both absent). */
const sameInstant = (a: Date | null, b: Date | null): boolean =>
  a == null || b == null ? a === b : a.getTime() === b.getTime();
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

  // ── The single live fact that speaks for this predicate ──────────────────────────────────────
  // D-G8-4A: confidence, then recency, then the canonical provenance precedence
  // (PROVENANCE_STRENGTH). Every surviving row here already agrees on the DATE — the CONFLICTING
  // branch above returned when they did not — so a residual tie can only move the window, the
  // provenance word and the precise-date trust flag. Where those agree the rows are genuinely
  // equivalent and collapse; where they differ the tie is UNRESOLVED, and it is disclosed and
  // resolved CONSERVATIVELY rather than decided by row order.
  const pick = resolveTie(
    live,
    (a, b) => b.confidence - a.confidence
      || b.observedLastAt.getTime() - a.observedLastAt.getTime()
      || compareProvenance(a.provenanceClass, b.provenanceClass),
    (a, b) => a.provenanceClass === b.provenanceClass
      && sameInstant(a.dateValue, b.dateValue) && sameInstant(a.validFrom, b.validFrom)
      && sameInstant(a.validUntil, b.validUntil) && a.freshnessPolicy === b.freshnessPolicy
      && a.halfLifeDays === b.halfLifeDays,
  );
  const tiedGroup = pick.kind === "UNRESOLVED" ? pick.tied : null;
  const best = pick.kind === "RESOLVED" ? pick.value : pick.kind === "UNRESOLVED" ? pick.tied[0] : live[0];
  const stale = tiedGroup ? tiedGroup.every((f) => isStale(f, now)) : isStale(best, now);
  // Conservative on an unresolved tie: "trusted for a precise date" only if EVERY tied source is.
  const trusted = tiedGroup
    ? tiedGroup.every((f) => TRUSTED_FOR_PRECISE_DATE.has(f.provenanceClass))
    : TRUSTED_FOR_PRECISE_DATE.has(best.provenanceClass);
  // ... and the window is only asserted when every tied source asserts the same one.
  const windowAgrees = !tiedGroup || tiedGroup.every((f) =>
    sameInstant(f.validFrom, best.validFrom) && sameInstant(f.validUntil, best.validUntil));
  const window = windowAgrees && (best.validFrom || best.validUntil)
    ? { from: iso(best.validFrom), to: iso(best.validUntil) } : null;
  const tieNote = tiedGroup
    ? ` Equally-strong sources support this date (${[...new Set(tiedGroup.map((f) => f.provenanceClass))].join(", ")}); none outranks the other.`
    : "";

  // ── STALE: we knew this once. Distinct from UNKNOWN, and the date is still shown as history. ─
  if (stale) {
    const d = best.dateValue ?? best.validUntil;
    return {
      ...base, state: "STALE_DATE", date: iso(best.dateValue), window,
      daysUntil: d ? daysBetween(d, now) : null,
      because: best.freshnessPolicy === "VALID_UNTIL"
        ? `The date this was valid until has already passed.${tieNote}`
        : `Last observed ${daysBetween(now, best.observedLastAt)} days ago — beyond this predicate's freshness policy.${tieNote}`,
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
        ? `Evidence supports a period, not a specific date.${tieNote}`
        : `The source (${best.provenanceClass.replace(/_/g, " ").toLowerCase()}) is not trusted for a precise date.${tieNote}`,
      whatWouldChangeIt: "A customer-confirmed renewal date, or a first-party contract record.",
    };
  }

  // ── VERIFIED DATE ────────────────────────────────────────────────────────────────────────────
  return {
    ...base, state: "VERIFIED_DATE", date: iso(best.dateValue), window,
    daysUntil: daysBetween(best.dateValue, now),
    because: `${best.provenanceClass.replace(/_/g, " ").toLowerCase()} evidence supports this date.${tieNote}`,
    whatWouldChangeIt: null,
  };
}

/** Tiny helper kept separate so the CONFLICTING branch reads as one condition. */
function r0(rows: LifecycleFactRow[]): LifecycleFactRow[] { return rows; }

/** The documented lifecycle-state precedence (see the module header): conflicts first. */
export const LIFECYCLE_STATE_RANK: Record<LifecycleState, number> = {
  CONFLICTING_DATE: 0, VERIFIED_DATE: 1, INFERRED_WINDOW: 2, STALE_DATE: 3, UNKNOWN: 4,
};

/**
 * The single most commercially relevant event for an account (soonest actionable, conflicts first).
 *
 * D-G8-4A: this is NOT a provenance question and PROVENANCE_STRENGTH is deliberately not used here.
 * The existing semantics are the lifecycle-state rank, then timing. Anything still tied after those
 * shares BOTH its state and its daysUntil; where the tied events would also render identically they
 * collapse, and where they would not, the answer is UNRESOLVED rather than whichever event the array
 * happened to hold first.
 */
export function primaryLifecycleOutcome(events: LifecycleEvent[]): Resolution<LifecycleEvent> {
  return resolveTie(
    events,
    (a, b) => LIFECYCLE_STATE_RANK[a.state] - LIFECYCLE_STATE_RANK[b.state] ||
      (a.daysUntil ?? Number.MAX_SAFE_INTEGER) - (b.daysUntil ?? Number.MAX_SAFE_INTEGER),
    (a, b) => a.label === b.label && a.state === b.state && a.date === b.date
      && a.daysUntil === b.daysUntil && JSON.stringify(a.window) === JSON.stringify(b.window),
  );
}

/** The resolved primary event, or null when there is none OR when it is genuinely undecidable. */
export function primaryLifecycleEvent(events: LifecycleEvent[]): LifecycleEvent | null {
  const r = primaryLifecycleOutcome(events);
  return r.kind === "RESOLVED" ? r.value : null;
}

/**
 * The primary event for a surface that must show SOMETHING (D-G8-4A).
 *
 * A tie here is always on BOTH the lifecycle state and the timing — those are the keys it survived —
 * so the state, date, window and daysUntil are already common to every tied event. Only the
 * predicate label and the competing set differ. Rather than pick one (the old row-order behaviour)
 * or drop the account entirely, this DISCLOSES the tie: the shared state and timing, both labels,
 * and the union of the competing dates. Nothing is chosen, and nothing is hidden.
 */
export function primaryLifecycleDisclosed(events: LifecycleEvent[]): LifecycleEvent | null {
  const r = primaryLifecycleOutcome(events);
  if (r.kind === "NONE") return null;
  if (r.kind === "RESOLVED") return r.value;
  const seen = new Set<string>();
  const competing = r.tied.flatMap((t) => t.competing)
    .filter((c) => (seen.has(c.factId) ? false : (seen.add(c.factId), true)))
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.factId.localeCompare(b.factId));
  return {
    ...r.tied[0],
    label: r.tied.map((t) => t.label).join(" / "),
    competing,
    facts: r.tied.flatMap((t) => t.facts),
    evidenceCount: r.tied.reduce((s, t) => s + t.evidenceCount, 0),
    because: `${r.tied.length} lifecycle events tie on state and timing (${r.tied.map((t) => t.label).join(", ")}); none outranks the other.`,
  };
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
